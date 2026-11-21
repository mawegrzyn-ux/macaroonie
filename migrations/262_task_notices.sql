-- Push notices for the Today tasks (OUTSTANDING 44 item 13, docs/PEPPER_FIRST.md
-- 4.8 and phase 6a): a notice when a task is due soon and when it goes late,
-- each sent once, to the people who can do it, by browser push (the office
-- and the phone app's pages) and by the Macaroonie Office app's push.
--
--   push_devices  where a person's notices go: a browser's push subscription
--                 (kind web) or the app's push token (kind app). The
--                 subscription or token is sealed (services/vault.js SEALED);
--                 token_hash keeps one row per device.
--   user_notify   each person's own settings: on or off, which venues and
--                 areas (empty = all), due soon and late, quiet hours (venue
--                 time). No row = on, every venue and area, no quiet hours.
--   task_notices  one row per venue, task, day and kind once sent: the
--                 "each once" (services/notices.js claims it first).

CREATE TABLE IF NOT EXISTS push_devices (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub     text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('web', 'app')),
  token        text        NOT NULL,
  token_hash   text        NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  UNIQUE (tenant_id, token_hash)
);
CREATE INDEX IF NOT EXISTS push_devices_person ON push_devices (tenant_id, user_sub);

CREATE TABLE IF NOT EXISTS user_notify (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub    text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  venue_ids   uuid[]      NOT NULL DEFAULT '{}',
  areas       text[]      NOT NULL DEFAULT '{}',
  due_soon    boolean     NOT NULL DEFAULT true,
  late        boolean     NOT NULL DEFAULT true,
  quiet_from  time,
  quiet_to    time,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_sub)
);

CREATE TABLE IF NOT EXISTS task_notices (
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id   uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  task_key   text        NOT NULL,
  day        date        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('due_soon', 'late')),
  title      text,
  sent_to    integer     NOT NULL DEFAULT 0,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, task_key, day, kind)
);
CREATE INDEX IF NOT EXISTS task_notices_tenant ON task_notices (tenant_id, sent_at);

ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON push_devices;
CREATE POLICY tenant_isolation ON push_devices
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE user_notify ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notify FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_notify;
CREATE POLICY tenant_isolation ON user_notify
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE task_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON task_notices;
CREATE POLICY tenant_isolation ON task_notices
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
