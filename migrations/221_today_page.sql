-- The chat-first front door (docs/CHAT_FIRST.md): a Today page with what
-- needs doing now and Pepper beside it. A Today link at the top of every
-- group's Home section, just before Overview, seen by the same roles.

UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order >= r.sort_order
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = r.tenant_id AND x.route = '/today');

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Today', 'Sun', '/today', 'dashboard', n.sort_order - 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/today');
