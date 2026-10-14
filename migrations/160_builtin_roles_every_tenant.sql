-- 160_builtin_roles_every_tenant.sql
--
-- Tenants created after migration 038 never got the four built-in roles
-- (tenant_roles, is_builtin), so their users' module permissions resolved to
-- none for every module and only platform admins could use routes gated by
-- requirePermission(). Add any missing built-in role. Permissions start empty:
-- resolvePermission() falls back to each module's default for the role's key
-- (api/src/config/modules.js) until an owner edits the role on the Access page.
-- New tenants get the same rows from seedBuiltinRoles() in POST /api/platform/tenants.

BEGIN;

INSERT INTO tenant_roles (tenant_id, key, label, description, is_builtin, sort_order, permissions)
SELECT t.id, b.key, b.label, b.description, true, b.sort_order, '{}'::jsonb
  FROM tenants t
 CROSS JOIN (VALUES
   ('owner',    'Owner',    'Full access to all enabled modules + can manage team and roles.', 1),
   ('admin',    'Admin',    'Manages venues, rules, website, emails, schedule. Cannot manage team or roles.', 2),
   ('operator', 'Operator', 'Front-of-house. Manages bookings, views the timeline, handles walk-ins.', 3),
   ('viewer',   'Viewer',   'Read-only access to bookings and timeline.', 4)
 ) AS b(key, label, description, sort_order)
ON CONFLICT (tenant_id, key) DO NOTHING;

COMMIT;
