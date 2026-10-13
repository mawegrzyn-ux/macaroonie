-- 158_staging_password.sql
--
-- Optional password on a tenant's staging site (staging-{slug}.{root}).
-- No row = staging is open to anyone with the link, as before.
--
--   staging_access   one per tenant: the password as an scrypt hash
--                    ("s1$<salt>$<hash>", services/stagingAccess.js), who
--                    set it and when. Kept out of tenant_site on purpose:
--                    tenant_site is read with SELECT * by the site renderer
--                    and returned whole by the admin routes, and the hash
--                    must never leave the server. The hash also signs the
--                    staging cookie and preview links, so changing or
--                    removing the password signs everyone out.

BEGIN;

CREATE TABLE staging_access (
  tenant_id      uuid         PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  password_hash  text         NOT NULL,
  updated_by     text,
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE staging_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staging_access
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
