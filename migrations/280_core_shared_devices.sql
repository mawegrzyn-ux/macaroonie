-- Shared devices and the person switch (Pepper-first step 6a; docs/PEPPER_FIRST.md
-- 13, decision 6: a PIN person switch before any change on a shared device, a
-- till PIN enough for logging checks and nothing else; decision 9: pay, tips
-- and model-read allergen data need a named person).
--
--   shared_devices         a browser or an Office app install that an admin
--                          marked as shared for a venue. The device keeps a
--                          random token (sha-256 kept here, never the token);
--                          it sends it as X-Shared-Device on every request.
--   user_office_pins       each person's own office PIN (PBKDF2 with a salt of
--                          its own, shared/pos/pin.js, like the till PIN), set
--                          by the person on their own device.
--   shared_device_people   who is using a shared device now: one row per
--                          person switch, with the short-lived token the
--                          device sends as X-Acting-Person. A till PIN
--                          (cash_staff) or an office PIN (users). Ends on
--                          Lock, after ACT_IDLE_SECONDS without a change, or
--                          ACT_MAX_MINUTES after it started.
--   shared_device_pin_tries wrong PINs per device and person ('*' for the
--                          device as a whole): PIN_TRIES wrong locks that
--                          person on that device for PIN_LOCK_MINUTES.
--   shared_device_changes  each change made on a shared device, the person
--                          it was made as, and how it went: the share of
--                          changes on shared devices tied to a named person.
--
-- Read and written only through /api/shared-devices (routes/sharedDevices.js)
-- and the check every change route runs (middleware/sharedDevice.js).

CREATE TABLE IF NOT EXISTS shared_devices (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name          text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind          text        NOT NULL DEFAULT 'browser' CHECK (kind IN ('browser', 'office_app')),
  token_hash    text        NOT NULL UNIQUE,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);
CREATE INDEX IF NOT EXISTS shared_devices_tenant ON shared_devices (tenant_id, venue_id);

CREATE TABLE IF NOT EXISTS user_office_pins (
  user_id    uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pin_hash   text        NOT NULL,
  salt       text        NOT NULL,
  set_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_office_pins_tenant ON user_office_pins (tenant_id);

CREATE TABLE IF NOT EXISTS shared_device_people (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id     uuid        NOT NULL REFERENCES shared_devices(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('till', 'office')),
  user_id       uuid        REFERENCES users(id) ON DELETE CASCADE,
  staff_id      uuid        REFERENCES cash_staff(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  token_hash    text        NOT NULL UNIQUE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  CHECK ((kind = 'till') = (staff_id IS NOT NULL)),
  CHECK ((kind = 'office') = (user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS shared_device_people_device ON shared_device_people (device_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS shared_device_people_tenant ON shared_device_people (tenant_id, started_at);

CREATE TABLE IF NOT EXISTS shared_device_pin_tries (
  device_id        uuid        NOT NULL REFERENCES shared_devices(id) ON DELETE CASCADE,
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_key       text        NOT NULL CHECK (length(person_key) BETWEEN 1 AND 60),
  failures         integer     NOT NULL DEFAULT 0,
  first_failed_at  timestamptz,
  locked_until     timestamptz,
  PRIMARY KEY (device_id, person_key)
);
CREATE INDEX IF NOT EXISTS shared_device_pin_tries_tenant ON shared_device_pin_tries (tenant_id);

CREATE TABLE IF NOT EXISTS shared_device_changes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    uuid        REFERENCES shared_devices(id) ON DELETE SET NULL,
  person_id    uuid        REFERENCES shared_device_people(id) ON DELETE SET NULL,
  person_kind  text        CHECK (person_kind IS NULL OR person_kind IN ('till', 'office')),
  person_name  text,
  method       text        NOT NULL,
  route        text        NOT NULL,
  status       integer     NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shared_device_changes_tenant ON shared_device_changes (tenant_id, at);

-- The audit's person when a Pepper card was confirmed on a shared device.
ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS shared_device_id uuid REFERENCES shared_devices(id) ON DELETE SET NULL;

ALTER TABLE shared_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shared_devices;
CREATE POLICY tenant_isolation ON shared_devices
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE user_office_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_office_pins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_office_pins;
CREATE POLICY tenant_isolation ON user_office_pins
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE shared_device_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_device_people FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shared_device_people;
CREATE POLICY tenant_isolation ON shared_device_people
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE shared_device_pin_tries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_device_pin_tries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shared_device_pin_tries;
CREATE POLICY tenant_isolation ON shared_device_pin_tries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE shared_device_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_device_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shared_device_changes;
CREATE POLICY tenant_isolation ON shared_device_changes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
