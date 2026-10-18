-- 184_device_link_codes.sql
--
-- Tills, kitchen screens and kiosks can show a code of their own (with a QR
-- code to the installer app, installer.<root>) for someone signed in to link
-- them from a phone or from Till setup, the way menu screens always have
-- (screen_pairings, migration 166). Typing a code made in Till setup into the
-- device still works.
--
--   pos_pairings   a code a device shows until it is linked: global until
--                  then (no tenant yet), never holds the device's secret,
--                  only its hash. `app` is the kind of device the address it
--                  was shown on runs (pos. till, kitchen. kitchen screen,
--                  kiosk. kiosk; null on a test address), so the code can only
--                  become that kind. Linking copies secret_hash onto the
--                  pos_devices row and the device signs in with its secret.
--
-- Codes of both tables are six characters from one alphabet and never live
-- in both at once (services/linkCodes.js), so a typed code finds one device.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_pairings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash    text        NOT NULL UNIQUE,
  secret_hash  text        NOT NULL,
  app          text        CHECK (app IN ('terminal', 'kds', 'kiosk')),
  device_info  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  claimed_at   timestamptz,
  device_id    uuid        REFERENCES pos_devices(id) ON DELETE CASCADE,
  tenant_id    uuid        REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pos_pairings_expires ON pos_pairings (expires_at);

-- Like screen_pairings (migration 176): an unclaimed code is any tenant's to
-- find; once linked it is the tenant's.
ALTER TABLE pos_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_pairings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_pairings;
CREATE POLICY tenant_isolation ON pos_pairings
  USING (tenant_id IS NULL
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

COMMIT;
