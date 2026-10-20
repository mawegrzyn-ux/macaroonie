-- 196: the main menu, grouped by job.
--
-- Every tenant's menu (nav_items) is replaced by the new default tree:
-- Home, Service, Money, Health & safety, Stock, People, Menus, Brand & web,
-- Venues, Admin, Help. It adds Brand & theme (/brand), which moved out of the
-- website builder. Changes made in Navigation (labels, order, hidden roles,
-- quick-access tiles) are not kept (pre-production), and every tenant goes
-- back to the sidebar (a launcher with no tiles would leave nothing to tap).
--
-- The tree below is api/src/config/defaultNav.js's DEFAULT_NAV_TREE as JSON
-- (api/test/nav-default.test.mjs checks they match).

CREATE FUNCTION pg_temp.seed_nav(p_tenant uuid, p_parent uuid, p_nodes jsonb) RETURNS void AS $$
DECLARE
  n   jsonb;
  pos bigint;
  new_id uuid;
BEGIN
  FOR n, pos IN SELECT value, ordinality FROM jsonb_array_elements(p_nodes) WITH ORDINALITY LOOP
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (p_tenant, p_parent, CASE WHEN n ? 'route' THEN 'link' ELSE 'section' END,
            n->>'label', n->>'icon', n->>'route', n->>'module', pos - 1)
    RETURNING id INTO new_id;
    IF n ? 'children' THEN
      PERFORM pg_temp.seed_nav(p_tenant, new_id, n->'children');
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t record;
  tree jsonb := $nav$
[
  {"label":"Home", "children": [
    {"label":"Overview","icon":"LayoutDashboard","route":"/","module":"dashboard"},
    {"label":"Dashboards","icon":"LayoutTemplate","route":"/dashboards","module":"custom_dashboard"},
    {"label":"Pepper","icon":"Sparkles","route":"/ai","module":"ai_assistant"}
  ]},
  {"label":"Service", "children": [
    {"label":"Timeline","icon":"CalendarDays","route":"/timeline","module":"bookings"},
    {"label":"Bookings","icon":"BookOpen","route":"/bookings","module":"bookings"},
    {"label":"Customers","icon":"UserRound","route":"/customers","module":"customers"},
    {"label":"Online orders","icon":"ShoppingBag","route":"/orders","module":"web_orders"}
  ]},
  {"label":"Money", "children": [
    {"label":"Till reports","icon":"BarChart3","route":"/pos/reports","module":"pos_reports"},
    {"label":"Cash recon","icon":"Wallet","route":"/cash-recon","module":"cash_recon"},
    {"label":"Cash dashboard","icon":"LayoutGrid","route":"/cash-dashboard","module":"cash_dashboard"}
  ]},
  {"label":"Health & safety", "children": [
    {"label":"Food safety","icon":"Thermometer","route":"/food-safety","module":"food_safety"},
    {"label":"Checklists","icon":"ListChecks","route":"/checklists","module":"checklists"},
    {"label":"H&S dashboard","icon":"LayoutGrid","route":"/hs-dashboard","module":"hs_dashboard"},
    {"label":"Action log","icon":"ClipboardCheck","route":"/hs-action-log","module":"hs_action_log"}
  ]},
  {"label":"Stock", "children": [
    {"label":"Purchasing","icon":"ShoppingCart","route":"/purchasing","module":"purchasing", "children": [
      {"label":"Order lists","icon":"ClipboardList","route":"/purchasing/lists","module":"purchasing_setup"},
      {"label":"Inventory","icon":"Package","route":"/inventory","module":"purchasing_setup"},
      {"label":"Suppliers","icon":"Truck","route":"/suppliers","module":"purchasing_setup"}
    ]}
  ]},
  {"label":"People", "children": [
    {"label":"Staff","icon":"UsersRound","route":"/staff","module":"staff", "children": [
      {"label":"Roles","icon":"BadgeCheck","route":"/staff/roles","module":"staff"}
    ]},
    {"label":"Rota","icon":"CalendarRange","route":"/rota","module":"rota", "children": [
      {"label":"Rota setup","icon":"Settings2","route":"/rota/setup","module":"staff"}
    ]},
    {"label":"Rota dashboard","icon":"LayoutGrid","route":"/rota-dashboard","module":"rota_dashboard"}
  ]},
  {"label":"Menus", "children": [
    {"label":"Menus","icon":"ChefHat","route":"/menus","module":"menus", "children": [
      {"label":"Variant groups","icon":"Layers","route":"/menus/variant-groups","module":"menus"},
      {"label":"Allergens & dietary","icon":"Tag","route":"/menus/dietary-tags","module":"menus"},
      {"label":"Allergen matrix","icon":"Grid3x3","route":"/menus/allergens","module":"menus"},
      {"label":"Tax rates","icon":"Percent","route":"/menus/tax","module":"menus"},
      {"label":"Translations","icon":"Languages","route":"/menus/translations","module":"menus"},
      {"label":"Deliveroo menu","icon":"Bike","route":"/menus/deliveroo","module":"menus"}
    ]},
    {"label":"Promotions","icon":"BadgePercent","route":"/promotions","module":"promotions"},
    {"label":"Menu screens","icon":"Monitor","route":"/screens","module":"screens"}
  ]},
  {"label":"Brand & web", "children": [
    {"label":"Brand & theme","icon":"Palette","route":"/brand","module":"website"},
    {"label":"Website","icon":"Globe","route":"/website","module":"website"},
    {"label":"Media","icon":"FolderOpen","route":"/media","module":"website"},
    {"label":"Reviews","icon":"MessageSquare","route":"/reviews","module":"website"},
    {"label":"Emails","icon":"Mail","route":"/email-templates","module":"email_templates", "children": [
      {"label":"Monitor","icon":"Activity","route":"/email-monitoring","module":"email_templates"}
    ]}
  ]},
  {"label":"Venues", "children": [
    {"label":"Venues","icon":"Building2","route":"/venues","module":"venues", "children": [
      {"label":"New venue","icon":"Store","route":"/new-location","module":"venues"}
    ]},
    {"label":"Schedule","icon":"Clock","route":"/schedule","module":"schedule"},
    {"label":"Tables","icon":"Table2","route":"/tables","module":"tables"},
    {"label":"Booking rules","icon":"Settings","route":"/rules","module":"rules"},
    {"label":"Till setup","icon":"MonitorSmartphone","route":"/pos","module":"pos_setup", "children": [
      {"label":"Floor plan","icon":"LayoutPanelTop","route":"/pos/floor","module":"pos_setup"}
    ]},
    {"label":"Ordering setup","icon":"Settings2","route":"/orders/settings","module":"web_ordering_setup"}
  ]},
  {"label":"Admin", "children": [
    {"label":"Team","icon":"Users","route":"/team","module":"team"},
    {"label":"Access","icon":"Shield","route":"/access","module":"team"},
    {"label":"Settings","icon":"SlidersHorizontal","route":"/settings","module":"settings"},
    {"label":"Navigation","icon":"Compass","route":"/nav-designer","module":"nav_designer"},
    {"label":"Widget test","icon":"LayoutTemplate","route":"/widget-test","module":"widget_test"},
    {"label":"Test data","icon":"FlaskConical","route":"/test-data","module":"test_data"},
    {"label":"Legacy import","icon":"FileSpreadsheet","route":"/legacy-import","module":"test_data"}
  ]},
  {"label":"Help", "children": [
    {"label":"Help","icon":"HelpCircle","route":"/help","module":"documentation"},
    {"label":"Documentation","icon":"BookMarked","route":"/docs","module":"documentation"},
    {"label":"What's new","icon":"Newspaper","route":"/changelog","module":"changelog"},
    {"label":"Issues","icon":"AlertCircle","route":"/issues","module":"issue_log"},
    {"label":"Feature requests","icon":"Lightbulb","route":"/feature-requests","module":"feature_requests"}
  ]}
]
$nav$::jsonb;
BEGIN
  DELETE FROM nav_items;
  UPDATE tenants SET nav_style = 'sidebar' WHERE nav_style <> 'sidebar';
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM pg_temp.seed_nav(t.id, NULL, tree);
  END LOOP;
END $$;
