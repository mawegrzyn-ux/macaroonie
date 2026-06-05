-- 066_order_sheet_setup_module.sql
-- Splits order_sheets into two RBAC modules:
--   order_sheets      — fill/view orders (operator: view, manage = also create)
--   order_sheet_setup — template + category management (admin/owner only)

-- Seed order_sheet_setup for all tenants that already have order_sheets enabled
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT tenant_id, 'order_sheet_setup', is_enabled
FROM tenant_modules
WHERE module_key = 'order_sheets'
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- Update built-in role permissions:
--   order_sheets: owner=manage, admin=manage, operator=view, viewer=none
--   order_sheet_setup: owner=manage, admin=manage, operator=none, viewer=none
UPDATE tenant_roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || '{"order_sheets": "manage", "order_sheet_setup": "manage"}'::jsonb
WHERE key IN ('owner', 'admin');

UPDATE tenant_roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || '{"order_sheets": "view", "order_sheet_setup": "none"}'::jsonb
WHERE key = 'operator';

UPDATE tenant_roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || '{"order_sheets": "none", "order_sheet_setup": "none"}'::jsonb
WHERE key = 'viewer';
