-- 202: the Store tech section in the main menu.
--
-- Till setup's tabs (tills, kiosks, kitchen screens, printers ...) became
-- pages of their own (/pos/<part>), and each is a link in a new top-level
-- section, Store tech, placed after Venues. Menu screens moves into it from
-- Menus. The old Till setup link (with its Floor plan child) and the Menu
-- screens link are removed wherever they are in a tenant's menu; the roles
-- they were hidden from stay hidden from the new links, and a quick-access
-- tile on either moves to Tills / Menu screens. Other changes made in
-- Navigation are kept. A tenant that already has /pos/tills in its menu is
-- left alone.
--
-- The section below is the Store tech section of api/src/config/defaultNav.js
-- as JSON (api/test/nav-default.test.mjs checks they match).

DO $$
DECLARE
  sect jsonb := $nav$
[
  {"label":"Tills","icon":"MonitorSmartphone","route":"/pos/tills","module":"pos_setup"},
  {"label":"Floor plan","icon":"LayoutPanelTop","route":"/pos/floor","module":"pos_setup"},
  {"label":"Kiosks","icon":"TabletSmartphone","route":"/pos/kiosks","module":"pos_setup"},
  {"label":"Kitchen screens","icon":"CookingPot","route":"/pos/kitchen","module":"pos_setup"},
  {"label":"Menu screens","icon":"Monitor","route":"/screens","module":"screens"},
  {"label":"Printers","icon":"Printer","route":"/pos/printers","module":"pos_setup"},
  {"label":"Printing","icon":"ReceiptText","route":"/pos/printing","module":"pos_setup"},
  {"label":"Card machines","icon":"CreditCard","route":"/pos/cards","module":"pos_setup"},
  {"label":"Order types","icon":"ListOrdered","route":"/pos/types","module":"pos_setup"},
  {"label":"Revenue streams","icon":"Waypoints","route":"/pos/streams","module":"pos_setup"},
  {"label":"Courses","icon":"UtensilsCrossed","route":"/pos/courses","module":"pos_setup"},
  {"label":"Staff and PINs","icon":"KeyRound","route":"/pos/staff","module":"pos_setup"},
  {"label":"Till roles","icon":"ShieldCheck","route":"/pos/roles","module":"pos_setup"},
  {"label":"Receipts and payments","icon":"Receipt","route":"/pos/receipts","module":"pos_setup"},
  {"label":"Cash Recon link","icon":"ArrowRightLeft","route":"/pos/recon","module":"pos_setup"}
]
$nav$;
  t          record;
  n          jsonb;
  i          bigint;
  after_sort integer;
  sect_id    uuid;
  pos_hidden uuid[];
  scr_hidden uuid[];
  pos_tile   boolean;
  scr_tile   boolean;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/pos/tills');

    SELECT COALESCE(array_agg(DISTINCT h), '{}'), COALESCE(bool_or(show_in_launcher), false)
      INTO pos_hidden, pos_tile
      FROM nav_items LEFT JOIN LATERAL unnest(hidden_role_ids) h ON true
     WHERE tenant_id = t.id AND route = '/pos';
    SELECT COALESCE(array_agg(DISTINCT h), '{}'), COALESCE(bool_or(show_in_launcher), false)
      INTO scr_hidden, scr_tile
      FROM nav_items LEFT JOIN LATERAL unnest(hidden_role_ids) h ON true
     WHERE tenant_id = t.id AND route = '/screens';
    pos_hidden := array_remove(pos_hidden, NULL);
    scr_hidden := array_remove(scr_hidden, NULL);

    -- Children go with them (ON DELETE CASCADE).
    DELETE FROM nav_items WHERE tenant_id = t.id AND route IN ('/pos', '/pos/floor', '/screens');

    -- After the top-level item holding Venues, else at the end.
    WITH RECURSIVE up AS (
      SELECT id, parent_id, sort_order FROM nav_items WHERE tenant_id = t.id AND route = '/venues'
      UNION ALL
      SELECT p.id, p.parent_id, p.sort_order FROM nav_items p JOIN up ON p.id = up.parent_id
    )
    SELECT min(sort_order) INTO after_sort FROM up WHERE parent_id IS NULL;
    IF after_sort IS NULL THEN
      SELECT COALESCE(max(sort_order), -1) INTO after_sort FROM nav_items WHERE tenant_id = t.id AND parent_id IS NULL;
    END IF;
    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = t.id AND parent_id IS NULL AND sort_order > after_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, sort_order)
    VALUES (t.id, NULL, 'section', 'Store tech', after_sort + 1)
    RETURNING id INTO sect_id;

    FOR n, i IN SELECT value, ordinality FROM jsonb_array_elements(sect) WITH ORDINALITY LOOP
      INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
      VALUES (t.id, sect_id, 'link', n->>'label', n->>'icon', n->>'route', n->>'module', i - 1,
              CASE WHEN n->>'route' = '/screens' THEN scr_hidden ELSE pos_hidden END,
              CASE n->>'route' WHEN '/screens' THEN scr_tile WHEN '/pos/tills' THEN pos_tile ELSE false END);
    END LOOP;
  END LOOP;
END $$;
