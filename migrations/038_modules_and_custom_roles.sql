-- ============================================================
-- 038_modules_and_custom_roles.sql
--
-- Configurable RBAC + per-tenant module switches.
--
-- Two new tables, both tenant-scoped with RLS:
--
--   1. tenant_modules
--      Master on/off switch per (tenant_id, module_key). When
--      a module is disabled, NOBODY in that tenant — including
--      owner — can use it. The frontend hides the nav entry and
--      the API rejects mutations on routes belonging to that
--      module. Disabled-by-default for net-new modules so they
--      can be soft-rolled-out.
--
--   2. tenant_roles
--      Custom roles per tenant. Permissions JSONB maps
--      module_key → 'manage' | 'view' | 'none'.
--      Four built-in roles (owner/admin/operator/viewer) are
--      seeded automatically; built-in permissions can be edited
--      but the rows can't be deleted (is_builtin = true).
--
-- users.custom_role_id (nullable) optionally links a user to a
-- tenant_roles row. When NULL, legacy users.role enum is used
-- and mapped to the seeded built-in role with the same key.
-- ============================================================

BEGIN;

-- ── tenant_modules ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_modules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key  text        NOT NULL,
  is_enabled  boolean     NOT NULL DEFAULT true,
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_key)
);

ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tenant_modules' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON tenant_modules
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE TRIGGER trg_tenant_modules_updated_at
  BEFORE UPDATE ON tenant_modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── tenant_roles ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         text        NOT NULL,
  label       text        NOT NULL,
  description text,
  is_builtin  boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  permissions jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

ALTER TABLE tenant_roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tenant_roles' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON tenant_roles
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE TRIGGER trg_tenant_roles_updated_at
  BEFORE UPDATE ON tenant_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── users.custom_role_id ──────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES tenant_roles(id) ON DELETE SET NULL;


-- ── Seed: built-in roles + every module enabled for each tenant ──
--
-- For each existing tenant insert the 4 default roles and enable
-- every known module. Idempotent via ON CONFLICT.

WITH builtin AS (
  SELECT * FROM (VALUES
    ('owner',    'Owner',    'Full access to all enabled modules + can manage team and roles.', 1,
     '{"bookings":"manage","venues":"manage","tables":"manage","schedule":"manage","rules":"manage","customers":"manage","website":"manage","email_templates":"manage","cash_recon":"manage","team":"manage","settings":"manage","dashboard":"manage","widget_test":"manage","documentation":"manage"}'::jsonb),
    ('admin',    'Admin',    'Manages venues, rules, website, emails, schedule. Cannot manage team or roles.', 2,
     '{"bookings":"manage","venues":"manage","tables":"manage","schedule":"manage","rules":"manage","customers":"manage","website":"manage","email_templates":"manage","cash_recon":"manage","team":"view","settings":"manage","dashboard":"manage","widget_test":"manage","documentation":"manage"}'::jsonb),
    ('operator', 'Operator', 'Front-of-house. Manages bookings, views the timeline, handles walk-ins.', 3,
     '{"bookings":"manage","venues":"view","tables":"view","schedule":"view","rules":"view","customers":"view","website":"none","email_templates":"none","cash_recon":"manage","team":"none","settings":"view","dashboard":"view","widget_test":"view","documentation":"view"}'::jsonb),
    ('viewer',   'Viewer',   'Read-only access to bookings and timeline.', 4,
     '{"bookings":"view","venues":"view","tables":"view","schedule":"view","rules":"none","customers":"view","website":"none","email_templates":"none","cash_recon":"none","team":"none","settings":"none","dashboard":"view","widget_test":"none","documentation":"view"}'::jsonb)
  ) AS r(key, label, description, sort_order, permissions)
)
INSERT INTO tenant_roles (tenant_id, key, label, description, is_builtin, sort_order, permissions)
SELECT t.id, b.key, b.label, b.description, true, b.sort_order, b.permissions
  FROM tenants t
  CROSS JOIN builtin b
  ON CONFLICT (tenant_id, key) DO NOTHING;


WITH modules AS (
  SELECT * FROM (VALUES
    ('bookings'),('venues'),('tables'),('schedule'),('rules'),
    ('customers'),('website'),('email_templates'),('cash_recon'),
    ('team'),('settings'),('dashboard'),('widget_test'),('documentation')
  ) AS m(module_key)
)
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, m.module_key, true
  FROM tenants t
  CROSS JOIN modules m
  ON CONFLICT (tenant_id, module_key) DO NOTHING;


-- ── Backfill: link existing users to their built-in role ──
--
-- For users whose custom_role_id is NULL, link them to the
-- tenant_role row that matches their legacy users.role enum.

UPDATE users u
   SET custom_role_id = r.id
  FROM tenant_roles r
 WHERE u.tenant_id     = r.tenant_id
   AND r.key           = u.role::text
   AND u.custom_role_id IS NULL;

COMMIT;
