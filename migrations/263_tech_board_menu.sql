-- 263: the Tech board in the main menu (22 Nov 2026, OUTSTANDING 44.7).
--
-- Store tech → Tech board (/pos/board): a venue's kit on one page, whether
-- each piece is working and the last thing it did. The link goes first in
-- the Store tech section, just before Tills, wherever Tills is in a tenant's
-- menu (it takes Tills' place and the links after it move down one); the
-- roles Tills is hidden from don't see it either. Skipped where the link is
-- already there or there is no Tills link.

WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order, n.hidden_role_ids
    FROM nav_items n
   WHERE n.route = '/pos/tills'
   ORDER BY n.tenant_id, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order >= a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/pos/board')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT a.tenant_id, a.parent_id, 'link', 'Tech board', 'Activity', '/pos/board', 'pos_setup', a.sort_order,
       COALESCE(a.hidden_role_ids, '{}'::uuid[]), false
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/pos/board');
