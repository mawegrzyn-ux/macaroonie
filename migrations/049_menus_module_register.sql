-- ============================================================
-- 049_menus_module_register.sql
--
-- Register the new 'menus' module on every existing tenant so the
-- nav entry shows up + the permission check in /api/menus passes.
-- New tenants pick it up automatically via the regular onboarding flow.
-- ============================================================

BEGIN;

INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'menus', true
  FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- Default permissions on built-in roles for the 'menus' module.
-- Owner + admin can manage; operator + viewer can view.
UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('menus',
                          CASE key
                            WHEN 'owner'    THEN 'manage'
                            WHEN 'admin'    THEN 'manage'
                            WHEN 'operator' THEN 'view'
                            ELSE 'view'
                          END)
 WHERE is_builtin = true
   AND NOT (permissions ? 'menus');

COMMIT;
