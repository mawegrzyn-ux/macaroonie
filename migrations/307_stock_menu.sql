-- 307_stock_menu.sql
--
-- Inventory phase 4a (27 Nov 2026): the Stock page (/stock, module stock;
-- admin/src/pages/Stock.jsx) in every group's saved menu. New groups and
-- Reset to defaults take it from shared/nav/stock.js.

-- The Stock link in every group's saved menu, straight after Recipes (after
-- Purchasing, then Inventory, where there is no Recipes link); the links
-- after it move down one. Skipped where the link is already there or no
-- anchor is. A second run changes nothing.
WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order
    FROM nav_items n
   WHERE n.route IN ('/recipes', '/purchasing', '/inventory')
   ORDER BY n.tenant_id, (n.route = '/recipes') DESC, (n.route = '/purchasing') DESC, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order > a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/stock')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids)
SELECT a.tenant_id, a.parent_id, 'link', 'Stock', 'Boxes', '/stock', 'stock', a.sort_order + 1, '{}'::uuid[]
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/stock');
