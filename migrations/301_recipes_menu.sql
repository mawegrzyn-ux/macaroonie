-- 301_recipes_menu.sql
--
-- Inventory phase 1 (27 Nov 2026): the Recipes page (/recipes, module
-- recipes; admin/src/pages/Recipes.jsx) in every group's saved menu. New
-- groups and Reset to defaults take it from shared/nav/recipes.js.

-- The Recipes link in every group's saved menu, straight after Purchasing
-- (after Inventory where there is no Purchasing link); the links after it
-- move down one. Skipped where the link is already there or neither anchor
-- is. A second run changes nothing.
WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order
    FROM nav_items n
   WHERE n.route IN ('/purchasing', '/inventory')
   ORDER BY n.tenant_id, (n.route = '/purchasing') DESC, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order > a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/recipes')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids)
SELECT a.tenant_id, a.parent_id, 'link', 'Recipes', 'ChefHat', '/recipes', 'recipes', a.sort_order + 1, '{}'::uuid[]
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/recipes');
