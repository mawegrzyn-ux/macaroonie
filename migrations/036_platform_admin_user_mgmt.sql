-- ============================================================
-- 036_platform_admin_user_mgmt.sql
--
-- Foundation for platform-level admin + in-app user management:
--
--   1. platform_admins — users who can manage ALL tenants.
--      Not tenant-scoped (no RLS). Identified by auth0_user_id.
--
--   2. users.auth0_user_id — links our local user record to the
--      Auth0 user for profile sync + management API calls.
--
--   3. users.last_login_at — tracked on each successful auth.
--
-- RBAC hierarchy:
--   platform_admin > owner > admin > operator > viewer
--
-- Platform admins can:
--   - List / create / edit / deactivate tenants
--   - Switch into any tenant's context
--   - Manage users across all tenants
--
-- Tenant roles (owner/admin/operator/viewer) are unchanged —
-- they govern access WITHIN a tenant.
-- ============================================================

BEGIN;

-- ── 1. Platform admins ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_admins (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_user_id  text        NOT NULL UNIQUE,
  email          text        NOT NULL,
  full_name      text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- No RLS — platform_admins is global by design.
-- Access is gated in the API middleware, not at the DB level.

CREATE TRIGGER trg_platform_admins_updated_at
  BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 2. Users table additions ───────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth0_user_id text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at    timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by    uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth0_user_id_idx
  ON users (auth0_user_id) WHERE auth0_user_id IS NOT NULL;

COMMIT;
