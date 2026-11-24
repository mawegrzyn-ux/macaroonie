-- Pepper-first step 8B1 (docs/PEPPER_FIRST.md 13, decision 5): a group's own
-- fields on a few business objects (customers, staff members, suppliers and
-- inventory items), registered in the same field registry as everything else
-- so the plain forms, the report catalogue and Pepper's tools pick them up.
-- No tenant-defined tables: one table of definitions, and the values on the
-- object's own row in a jsonb column `custom`, by the field's key.
--
-- object_key is a key of the object registry (shared/registry); the rules of
-- a definition and of its values are shared/customFields.js (checked by the
-- API: the CHECKs here are the backstop).

CREATE TABLE custom_fields (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key  text        NOT NULL CHECK (object_key IN ('guests.customers', 'staff.people', 'purchasing.suppliers', 'purchasing.items')),
  field_key   text        NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label       text        NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  type        text        NOT NULL CHECK (type IN ('text', 'number', 'yesno', 'date', 'choice')),
  options     text[]      NOT NULL DEFAULT '{}',
  required    boolean     NOT NULL DEFAULT false,
  help        text        CHECK (help IS NULL OR length(help) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, object_key, field_key)
);
CREATE UNIQUE INDEX custom_fields_label ON custom_fields (tenant_id, object_key, lower(label));

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_fields FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_fields_tenant ON custom_fields
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE customers  ADD COLUMN custom jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object');
ALTER TABLE cash_staff ADD COLUMN custom jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object');
ALTER TABLE suppliers  ADD COLUMN custom jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object');
ALTER TABLE inv_items  ADD COLUMN custom jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom) = 'object');
