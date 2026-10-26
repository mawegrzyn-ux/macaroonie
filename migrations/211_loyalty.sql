-- 211_loyalty.sql
--
-- Loyalty: points, stamp cards and rewards, earned and spent at every venue
-- of a tenant taking part, on the till, the self-order kiosks and online
-- ordering; a guest web app (/loyalty) with email code sign-in; Apple and
-- Google Wallet cards; a members list (basic CRM) with export and erasure.
-- The rules are shared/loyalty.js; the service is api/src/services/loyaltySvc.js.
--
--   loyalty_identities   one per email address across Macaroonie (only its
--                        sha-256), global, no tenant: links a person's
--                        memberships in different tenants for the network
--                        programme. Found and changed in system mode only.
--   loyalty_programmes   a tenant's programme (scope 'tenant', one per
--                        tenant, settings = normaliseProgramme()) or
--                        Macaroonie's own (scope 'network', tenant_id NULL,
--                        seeded switched off; not built further yet)
--   loyalty_rewards      what members can get: money off, percent off, a
--                        free dish (data = normaliseReward()); points_cost
--                        set = on offer for points
--   loyalty_stamp_cards  buy N dishes (or visit N times) for a reward
--   loyalty_members      a tenant's member: name, email, phone, the member
--                        number (9 digits, Luhn) and card token (the QR
--                        code), points balance, consents, staff notes and
--                        tags. Linked to customers. Erased = personal data
--                        cleared, numbers kept.
--   loyalty_ledger       every change of points or stamps, with its source
--                        (a check, an online order, a redemption, staff,
--                        joining, expiry). A sale's points are worked out
--                        again whenever it changes (refunds, a member put
--                        on later) and the difference added.
--   loyalty_member_rewards  rewards a member holds (from a full stamp card,
--                        or given by staff), until used or past their date
--   loyalty_redemptions  a reward taken out to spend: reserved for a check
--                        or an order (points taken at once), used when the
--                        check's discount or the order is in, released (and
--                        points given back) when the discount comes off, the
--                        order is cancelled or it is never used
--   loyalty_codes, loyalty_sessions  the web app's emailed sign-in codes and
--                        sign-ins (hashes only)
--   loyalty_wallet_settings  a tenant's own Apple / Google Wallet accounts
--                        (sealed), used instead of Macaroonie's (platform_secrets)
--   loyalty_wallet_devices  Apple Wallet's devices holding a member's pass
--                        (push tokens sealed), for balance updates. A member
--                        whose wallet_updated_at is after wallet_pushed_at
--                        is pushed (Apple) and updated (Google) by the sweep.

CREATE TABLE IF NOT EXISTS loyalty_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash  text NOT NULL UNIQUE CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_programmes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  scope       text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant', 'network')),
  enabled     boolean NOT NULL DEFAULT false,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  member_seq  bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant') = (tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_programmes_tenant ON loyalty_programmes (tenant_id) WHERE scope = 'tenant';
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_programmes_network ON loyalty_programmes (scope) WHERE scope = 'network';
INSERT INTO loyalty_programmes (tenant_id, scope, enabled, settings)
SELECT NULL, 'network', false, '{"name":"Macaroonie loyalty"}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM loyalty_programmes WHERE scope = 'network');

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  programme_id  uuid NOT NULL REFERENCES loyalty_programmes(id) ON DELETE CASCADE,
  data          jsonb NOT NULL,
  points_cost   integer CHECK (points_cost IS NULL OR points_cost > 0),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_rewards_tenant ON loyalty_rewards (tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS loyalty_stamp_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  programme_id  uuid NOT NULL REFERENCES loyalty_programmes(id) ON DELETE CASCADE,
  reward_id     uuid REFERENCES loyalty_rewards(id) ON DELETE RESTRICT,
  data          jsonb NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_stamp_cards_tenant ON loyalty_stamp_cards (tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS loyalty_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  programme_id        uuid NOT NULL REFERENCES loyalty_programmes(id) ON DELETE CASCADE,
  identity_id         uuid REFERENCES loyalty_identities(id) ON DELETE SET NULL,
  customer_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  member_no           text NOT NULL CHECK (member_no ~ '^[0-9]{9}$'),
  card_token          text NOT NULL UNIQUE CHECK (card_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'erased')),
  name                text,
  email               text,
  email_hash          text CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  phone               text,
  points              integer NOT NULL DEFAULT 0,
  points_earned       integer NOT NULL DEFAULT 0,
  points_spent        integer NOT NULL DEFAULT 0,
  joined_at           timestamptz NOT NULL DEFAULT now(),
  joined_venue_id     uuid REFERENCES venues(id) ON DELETE SET NULL,
  joined_channel      text CHECK (joined_channel IS NULL OR joined_channel IN ('web', 'till', 'kiosk', 'online', 'staff')),
  last_activity_at    timestamptz NOT NULL DEFAULT now(),
  last_visit_at       timestamptz,
  visits              integer NOT NULL DEFAULT 0,
  spend_pence         bigint NOT NULL DEFAULT 0,
  marketing_opt_in    boolean NOT NULL DEFAULT false,
  marketing_opt_in_at timestamptz,
  consent             jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes               text,
  tags                text[] NOT NULL DEFAULT '{}',
  wallet_token        text,
  wallet_updated_at   timestamptz NOT NULL DEFAULT now(),
  wallet_pushed_at    timestamptz,
  google_saved_at     timestamptz,
  apple_saved_at      timestamptz,
  erased_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, member_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_members_email ON loyalty_members (tenant_id, email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_members_customer ON loyalty_members (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS loyalty_members_identity ON loyalty_members (identity_id);
CREATE INDEX IF NOT EXISTS loyalty_members_joined ON loyalty_members (tenant_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('earn', 'redeem', 'release', 'adjust', 'welcome', 'expire', 'stamps', 'card_full')),
  points         integer NOT NULL DEFAULT 0,
  stamps         integer NOT NULL DEFAULT 0,
  stamp_card_id  uuid REFERENCES loyalty_stamp_cards(id) ON DELETE SET NULL,
  source_kind    text NOT NULL CHECK (source_kind IN ('check', 'order', 'redemption', 'staff', 'join', 'expiry', 'stamp_card')),
  source_id      text,
  venue_id       uuid REFERENCES venues(id) ON DELETE SET NULL,
  channel        text,
  spend_pence    integer,
  note           text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_ledger_member ON loyalty_ledger (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loyalty_ledger_source ON loyalty_ledger (tenant_id, source_kind, source_id);
-- A redemption takes points once and gives them back once.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_ledger_redemption ON loyalty_ledger (member_id, kind, source_id) WHERE source_kind = 'redemption';

CREATE TABLE IF NOT EXISTS loyalty_member_rewards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  reward_id      uuid NOT NULL REFERENCES loyalty_rewards(id) ON DELETE CASCADE,
  source         text NOT NULL CHECK (source IN ('stamp_card', 'staff')),
  source_id      text,
  status         text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'used', 'expired', 'cancelled')),
  expires_at     timestamptz,
  note           text,
  created_by     text,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  used_at        timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_member_rewards_member ON loyalty_member_rewards (member_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_member_rewards_card ON loyalty_member_rewards (member_id, source, source_id) WHERE source = 'stamp_card';

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  reward_id        uuid NOT NULL REFERENCES loyalty_rewards(id) ON DELETE CASCADE,
  member_reward_id uuid REFERENCES loyalty_member_rewards(id) ON DELETE SET NULL,
  points           integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  venue_id         uuid REFERENCES venues(id) ON DELETE SET NULL,
  channel          text NOT NULL CHECK (channel IN ('till', 'kiosk', 'online')),
  status           text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'used', 'released')),
  name             text NOT NULL,
  discount         jsonb NOT NULL,
  check_id         text,
  order_id         uuid,
  used_event_id    text,
  discount_pence   integer,
  device_id        uuid,
  staff_id         uuid,
  reserved_at      timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  used_at          timestamptz,
  released_at      timestamptz,
  release_reason   text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_redemptions_member ON loyalty_redemptions (member_id, reserved_at DESC);
CREATE INDEX IF NOT EXISTS loyalty_redemptions_check ON loyalty_redemptions (tenant_id, check_id) WHERE check_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_redemptions_order ON loyalty_redemptions (tenant_id, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_redemptions_reserved ON loyalty_redemptions (expires_at) WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS loyalty_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_hash  text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_codes_email ON loyalty_codes (tenant_id, email_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS loyalty_sessions (
  token_hash    text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_sessions_member ON loyalty_sessions (member_id);

CREATE TABLE IF NOT EXISTS loyalty_wallet_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  apple_own             boolean NOT NULL DEFAULT false,
  apple_pass_type_id    text,
  apple_team_id         text,
  apple_cert_pem        text,
  apple_key_pem         text,
  apple_wwdr_pem        text,
  apple_hint            text,
  google_own            boolean NOT NULL DEFAULT false,
  google_issuer_id      text,
  google_service_account text,
  google_hint           text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_wallet_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id          uuid NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  device_library_id  text NOT NULL,
  pass_type_id       text NOT NULL,
  push_token         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_library_id, pass_type_id, member_id)
);
CREATE INDEX IF NOT EXISTS loyalty_wallet_devices_member ON loyalty_wallet_devices (member_id);

-- The member on a till check and an online order, and what loyalty last
-- settled for them (loyaltySvc.js settleCheck() / settleOrder(): the sweep
-- settles again whatever changed since).
ALTER TABLE pos_checks ADD COLUMN IF NOT EXISTS loyalty_member_id uuid;
ALTER TABLE pos_checks ADD COLUMN IF NOT EXISTS loyalty_settled_key text;
CREATE INDEX IF NOT EXISTS pos_checks_loyalty ON pos_checks (tenant_id, loyalty_member_id) WHERE loyalty_member_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_member_id uuid REFERENCES loyalty_members(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_settled_key text;
CREATE INDEX IF NOT EXISTS orders_loyalty ON orders (tenant_id, loyalty_member_id) WHERE loyalty_member_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loyalty_programmes', 'loyalty_rewards', 'loyalty_stamp_cards', 'loyalty_members', 'loyalty_ledger',
                           'loyalty_member_rewards', 'loyalty_redemptions', 'loyalty_codes', 'loyalty_sessions',
                           'loyalty_wallet_settings', 'loyalty_wallet_devices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- The modules: Loyalty (programme, rewards, stamp cards, wallet) and
-- Loyalty members (the members list: personal data), on for every tenant;
-- the programme itself starts switched off.
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, m.key, true FROM tenants t CROSS JOIN (VALUES ('loyalty'), ('loyalty_members')) AS m(key)
ON CONFLICT DO NOTHING;

-- The link in the main menu, after Customers (every tenant's menu; skipped
-- where it is already there or Customers isn't).
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Loyalty', 'Gift', '/loyalty', 'loyalty', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/customers'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/loyalty');

UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/customers' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order AND n.route IS DISTINCT FROM '/loyalty';
