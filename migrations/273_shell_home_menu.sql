-- One Home at / (Pepper-first step 2b, reports/AI first back office
-- strategy.md "Home: the day comes to the person", decision 2): the address /
-- is Home (the ask bar, the person's pins, the Today feed and the week
-- ahead) for every group and role. The Overview's tiles move to /overview,
-- and /today goes to /.
--
-- Every group's saved menu, in four steps:
--   1. the Overview link (route /) moves to /overview, keeping its name,
--      icon, module and hidden roles;
--   2. the Today link becomes the Home link at /: Today's name and icon
--      become Home's where the group hadn't changed them; no module and no
--      hidden roles, as Home is for everyone (decision 2; Today had neither
--      since migration 227 unless a group set them);
--   3. Home goes first among its siblings (it already is in the standard
--      menu: Today was first in Home);
--   4. a menu with no Home link (Today taken out) gets one, first in the
--      Overview's section, or first at the top when there is no Overview.
-- A second run changes nothing (step 1 only where /overview isn't there yet).

UPDATE nav_items n SET route = '/overview', updated_at = now()
 WHERE n.route = '/'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/overview');

UPDATE nav_items
   SET route = '/',
       label = CASE WHEN label = 'Today' THEN 'Home' ELSE label END,
       icon  = CASE WHEN icon = 'Sun' THEN 'Home' ELSE icon END,
       module = NULL, hidden_role_ids = '{}', updated_at = now()
 WHERE route = '/today';

UPDATE nav_items h
   SET sort_order = (SELECT min(x.sort_order) FROM nav_items x
                      WHERE x.tenant_id = h.tenant_id AND x.parent_id IS NOT DISTINCT FROM h.parent_id AND x.id <> h.id) - 1
 WHERE h.route = '/'
   AND EXISTS (SELECT 1 FROM nav_items x
                WHERE x.tenant_id = h.tenant_id AND x.parent_id IS NOT DISTINCT FROM h.parent_id
                  AND x.id <> h.id AND x.sort_order <= h.sort_order);

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
SELECT t.id, o.parent_id, 'link', 'Home', 'Home', '/', NULL,
       coalesce((SELECT min(x.sort_order) FROM nav_items x
                  WHERE x.tenant_id = t.id AND x.parent_id IS NOT DISTINCT FROM o.parent_id), 1) - 1
  FROM tenants t
  LEFT JOIN LATERAL (SELECT parent_id FROM nav_items WHERE tenant_id = t.id AND route = '/overview' ORDER BY sort_order LIMIT 1) o ON true
 WHERE EXISTS (SELECT 1 FROM nav_items n WHERE n.tenant_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM nav_items n WHERE n.tenant_id = t.id AND n.route = '/');
