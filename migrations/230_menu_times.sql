-- 230_menu_times.sql
--
-- Menu times (Menus > Menu times, shared/menuTimes.js): when each menu is on
-- at a venue, for the website (online ordering), the self-order kiosks and
-- the tills, in one table. A row per venue and menu: the menu's own times (a
-- schedule, shared/menuSchedule.js; NULL = any time) and one cell per
-- channel, { "use": "off" | "menu" | "always" | "own", "times": schedule }.
-- No row: the menu is on the tills and kiosks at any time. Which menus are
-- online stays ordering_settings.menu_ids (the page writes it), so a stored
-- web cell is never "off".
--
-- Online ordering's own menu times (ordering_settings.menu_schedules,
-- migration 130) move here: they become the menu's times, the website
-- follows them, and kiosks and tills stay on at any time, as they were.
-- The column goes.

CREATE TABLE IF NOT EXISTS menu_times (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  menu_id    uuid NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  times      jsonb,
  web        jsonb NOT NULL DEFAULT '{"use": "menu"}'::jsonb,
  kiosk      jsonb NOT NULL DEFAULT '{"use": "menu"}'::jsonb,
  till       jsonb NOT NULL DEFAULT '{"use": "menu"}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (venue_id, menu_id)
);
CREATE INDEX IF NOT EXISTS menu_times_tenant ON menu_times (tenant_id, venue_id);
CREATE INDEX IF NOT EXISTS menu_times_menu ON menu_times (menu_id);

ALTER TABLE menu_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_times FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu_times;
CREATE POLICY tenant_isolation ON menu_times
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- Online ordering's menu times, for menus the venue can use (shared ones and
-- its own). Matched as text, so a key that isn't a menu id is left behind.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ordering_settings' AND column_name = 'menu_schedules') THEN
    INSERT INTO menu_times (tenant_id, venue_id, menu_id, times, web, kiosk, till)
    SELECT o.tenant_id, o.venue_id, m.id, e.value,
           '{"use": "menu"}'::jsonb, '{"use": "always"}'::jsonb, '{"use": "always"}'::jsonb
      FROM ordering_settings o
     CROSS JOIN LATERAL jsonb_each(COALESCE(o.menu_schedules, '{}'::jsonb)) AS e(key, value)
      JOIN menus m ON m.id::text = e.key AND m.tenant_id = o.tenant_id AND (m.venue_id IS NULL OR m.venue_id = o.venue_id)
     WHERE jsonb_typeof(e.value) = 'object'
    ON CONFLICT (venue_id, menu_id) DO NOTHING;
  END IF;
END $$;

ALTER TABLE ordering_settings DROP COLUMN IF EXISTS menu_schedules;

-- Main menu: Menu times first under every group's Menus link, seen by the
-- same roles as Menus.
UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items m
 WHERE m.route = '/menus' AND n.tenant_id = m.tenant_id AND n.parent_id = m.id
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = m.tenant_id AND x.route = '/menus/times');

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT DISTINCT ON (m.tenant_id) m.tenant_id, m.id, 'link', 'Menu times', 'Clock', '/menus/times', 'menus', 0, m.hidden_role_ids, false
  FROM nav_items m
 WHERE m.route = '/menus'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = m.tenant_id AND x.route = '/menus/times')
 ORDER BY m.tenant_id, m.sort_order;
