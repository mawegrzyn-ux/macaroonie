-- 148_ai_assistant.sql
--
-- AI chat and MCP for bookings.
--
--   ai_settings          one row per tenant: which AI features are on and the
--                        monthly token limit for chats (the platform pays; set
--                        by a platform admin). No row = defaults.
--   ai_usage             tokens and calls per tenant per month per channel
--                        (staff_chat / guest_chat count model tokens;
--                        staff_mcp / guest_mcp count tool calls).
--   ai_conversations     chats in the admin assistant and the website chat,
--                        with the system prompt they started with (a
--                        conversation is sent to the model byte for byte the
--                        same every turn, so it never changes).
--   ai_messages          their messages, append-only, stored as the API's
--                        content blocks so a conversation replays unchanged.
--   ai_pending_actions   a change the assistant proposed in a chat, waiting
--                        for the person to press Confirm on its card.
--   ai_actions           audit log of every tool call that touches a booking.
--   ai_booking_codes     6-digit codes emailed to a guest who wants to change
--                        or cancel a booking through an AI.
--   ai_booking_grants    short-lived access keys issued for a verified code.
--   ai_access_tokens     personal access tokens for the staff MCP. Looked up
--                        by hash during auth, before any tenant context, so
--                        like platform_admins it has no RLS; every query
--                        filters tenant_id itself.
--   bookings.source      which AI channel made a booking (NULL = not AI).
--   module ai_assistant  the staff assistant and staff MCP.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_settings (
  tenant_id            uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  guest_mcp_enabled    boolean     NOT NULL DEFAULT true,
  guest_chat_enabled   boolean     NOT NULL DEFAULT false,
  staff_enabled        boolean     NOT NULL DEFAULT true,
  monthly_token_limit  bigint      NOT NULL DEFAULT 2000000 CHECK (monthly_token_limit >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month               date        NOT NULL,
  channel             text        NOT NULL CHECK (channel IN ('staff_chat', 'guest_chat', 'staff_mcp', 'guest_mcp')),
  requests            int         NOT NULL DEFAULT 0,
  input_tokens        bigint      NOT NULL DEFAULT 0,
  output_tokens       bigint      NOT NULL DEFAULT 0,
  cache_read_tokens   bigint      NOT NULL DEFAULT 0,
  cache_write_tokens  bigint      NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month, channel)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel     text        NOT NULL CHECK (channel IN ('staff_chat', 'guest_chat')),
  user_sub    text,
  user_email  text,
  guest_key   text,
  venue_id    uuid        REFERENCES venues(id) ON DELETE SET NULL,
  title       text,
  system_prompt text      NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations (tenant_id, channel, user_sub, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq              int         NOT NULL,
  role             text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          jsonb       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);

CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid        NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tool_use_id      text        NOT NULL,
  tool             text        NOT NULL,
  input            jsonb       NOT NULL,
  card             jsonb       NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'done', 'cancelled', 'failed')),
  result           jsonb,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);

CREATE TABLE IF NOT EXISTS ai_actions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        REFERENCES tenants(id) ON DELETE CASCADE,
  channel          text        NOT NULL CHECK (channel IN ('staff_chat', 'guest_chat', 'staff_mcp', 'guest_mcp')),
  actor            text,
  tool             text        NOT NULL,
  input            jsonb,
  ok               boolean     NOT NULL,
  result           jsonb,
  booking_id       uuid,
  conversation_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_actions_tenant ON ai_actions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_booking_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  uuid        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,
  attempts    int         NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_booking_codes_booking ON ai_booking_codes (booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_booking_grants (
  token_hash  text        PRIMARY KEY,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  uuid        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_access_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  token_prefix  text        NOT NULL,
  token_hash    text        NOT NULL UNIQUE,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_access_tokens_user ON ai_access_tokens (tenant_id, user_id);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text;
-- Looking a booking up by its reference (first 8 characters of the id) and
-- the guest's email, across tenants, for the emailed code.
CREATE INDEX IF NOT EXISTS idx_bookings_guest_email ON bookings (lower(guest_email));

-- RLS on every tenant table except ai_access_tokens (see above).
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ai_settings', 'ai_usage', 'ai_conversations', 'ai_messages',
                            'ai_pending_actions', 'ai_actions', 'ai_booking_codes', 'ai_booking_grants'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', tbl);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_ai_settings_updated_at ON ai_settings;
CREATE TRIGGER trg_ai_settings_updated_at
  BEFORE UPDATE ON ai_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Module: same tenant switch as bookings (AI booking is part of bookings).
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT tm.tenant_id, 'ai_assistant', tm.is_enabled
  FROM tenant_modules tm
 WHERE tm.module_key = 'bookings'
ON CONFLICT DO NOTHING;

-- Role permissions: the module registry's defaults for the built-in roles,
-- none for custom roles (an owner turns it on in Access).
UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('ai_assistant',
                          CASE WHEN is_builtin AND key IN ('owner', 'admin') THEN 'manage'
                               WHEN is_builtin AND key = 'operator' THEN 'view'
                               ELSE 'none' END)
 WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'ai_assistant');

-- Nav: "AI assistant" after Settings. New tenants get it from defaultNav.js.
DO $$
DECLARE
  t         record;
  anchor    record;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/ai') THEN
      CONTINUE;
    END IF;
    SELECT parent_id, sort_order INTO anchor FROM nav_items
     WHERE tenant_id = t.id AND route = '/settings' ORDER BY sort_order LIMIT 1;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = t.id AND parent_id IS NOT DISTINCT FROM anchor.parent_id
       AND sort_order > anchor.sort_order;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, anchor.parent_id, 'link', 'AI assistant', 'Sparkles', '/ai', 'ai_assistant', anchor.sort_order + 1);
  END LOOP;
END $$;

COMMIT;
