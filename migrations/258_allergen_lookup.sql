-- Allergen lookup without Menus access (OUTSTANDING 44, item 1).
--
-- A module of its own, `allergens`, in the Menus group: the read-only lookup
-- (the Allergens page, the dashboard widget, the Overview tile, the phone's
-- Allergens tile and Pepper's allergy answers) reads the live menus with it.
-- Setting a dish's allergens (the matrix) stays Menus manage.

-- The module switch for every existing tenant (new ones seed from MODULES).
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'allergens', true FROM tenants t
ON CONFLICT DO NOTHING;

-- Custom roles have no module defaults (those are for the four built-in
-- roles), so without this every custom role would lose the lookup. Allergen
-- answers are for everyone who serves guests: View for every custom role
-- that hasn't been given a level.
UPDATE tenant_roles
   SET permissions = permissions || '{"allergens": "view"}'::jsonb
 WHERE NOT is_builtin
   AND NOT (permissions ? 'allergens');

-- The link in the main menu, after Online orders (after Customers where
-- Online orders isn't there); skipped where the link is already there.
WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order
    FROM nav_items n
   WHERE n.route IN ('/orders', '/customers')
   ORDER BY n.tenant_id, (n.route = '/orders') DESC, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order > a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/allergens')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT a.tenant_id, a.parent_id, 'link', 'Allergens', 'Wheat', '/allergens', 'allergens', a.sort_order + 1, '{}'::uuid[], false
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/allergens');
