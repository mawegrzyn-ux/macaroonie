-- The venue hub gets its own Store tech page (/pos/hub): it is more than a
-- printer hub now (hub first, migration 218), so it moves off the Printers
-- page. A Venue hub link in every group's Store tech menu, just before
-- Printers, seen by the same roles as Printers.

UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/pos/printers' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order >= r.sort_order
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = r.tenant_id AND x.route = '/pos/hub');

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Venue hub', 'Server', '/pos/hub', 'pos_setup', n.sort_order - 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/pos/printers'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/hub');
