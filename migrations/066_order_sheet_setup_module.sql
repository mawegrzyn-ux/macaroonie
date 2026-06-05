-- migration 066: add order_sheet_setup module
-- Splits order_sheets into two modules:
--   order_sheets      = filling/viewing/creating orders (view = fill; manage = also create)
--   order_sheet_setup = managing templates and categories (manage only)

-- Seed tenant_modules for the new module (enabled by default for all tenants that
-- already have order_sheets enabled).
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT tenant_id, 'order_sheet_setup', is_enabled
FROM   tenant_modules
WHERE  module_key = 'order_sheets'
ON CONFLICT DO NOTHING;

-- Add order_sheet_setup permission to built-in roles:
--   owner  → manage
--   admin  → manage
--   operator → none
--   viewer → none
UPDATE tenant_roles
SET    permissions = COALESCE(permissions, '{}'::jsonb) ||'{"order_sheet_setup": "manage"}'::jsonb
WHERE  is_builtin = true
  AND  key IN ('owner', 'admin');

UPDATE tenant_roles
SET    permissions = COALESCE(permissions, '{}'::jsonb) ||'{"order_sheet_setup": "none"}'::jsonb
WHERE  is_builtin = true
  AND  key IN ('operator', 'viewer');

-- Also fix the operator default for order_sheets from 'manage' → 'view'
UPDATE tenant_roles
SET    permissions = COALESCE(permissions, '{}'::jsonb) ||'{"order_sheets": "view"}'::jsonb
WHERE  is_builtin = true
  AND  key = 'operator';

UPDATE tenant_roles
SET    permissions = COALESCE(permissions, '{}'::jsonb) ||'{"order_sheets": "none"}'::jsonb
WHERE  is_builtin = true
  AND  key = 'viewer';
