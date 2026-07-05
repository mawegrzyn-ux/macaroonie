-- 067_test_data_module.sql
-- Registers the `test_data` module (dummy booking generator + bulk clear,
-- pre-prod QA tooling) under the existing `bookings` module group.

-- Inherit the bookings group's current enablement per tenant, same pattern
-- as migration 066 — a tenant that already disabled the bookings group
-- shouldn't have this new member silently turned back on.
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT tenant_id, 'test_data', is_enabled
FROM tenant_modules
WHERE module_key = 'widget_test'
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- Built-in role permissions: owner/admin manage, operator/viewer none —
-- this is a destructive dev tool, kept off by default for lower roles.
UPDATE tenant_roles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"test_data": "manage"}'::jsonb
WHERE key IN ('owner', 'admin');

UPDATE tenant_roles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"test_data": "none"}'::jsonb
WHERE key IN ('operator', 'viewer');
