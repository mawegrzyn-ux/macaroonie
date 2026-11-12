-- 241_nav_descriptions_designers.sql
--
-- Two changes to the main menu (12 Nov 2026).
--
-- 1. Descriptions. Every menu entry can carry a very brief description
--    (260 characters at most): shown under the entry's name in the menu
--    search's results and in the Navigation designer, and searched by the
--    menu search (below the entry's name and its page's search words).
--    NULL = the page's standard description (shared/navSearch.js
--    NAV_DESCRIPTIONS, or NAV_SECTION_DESCRIPTIONS for a section of the
--    standard menu); a group writes its own in the Navigation designer.
--
-- 2. Designers get their own menu links. They used to sit inside other
--    pages (a list at the bottom of Kiosks, a tab of Menu screens, a card on
--    Kitchen screens, a button in the menu editor, a section of Website), so
--    the menu search couldn't find them by name. Each now has its own page:
--
--      Kiosk designer             /pos/kiosk-designs     after Kiosks
--      Kitchen flow designer      /pos/kitchen-flow      after Kitchen screens
--      Screen board designer      /screens/boards        after Menu screens
--      Screen playlists           /screens/playlists     after the board designer
--      Screen walls               /screens/walls         after the playlists
--      Receipt & ticket designer  /pos/print-designs     after Printing
--      Menu print designer        /menus/print-designs   after Menu times
--      Page builder               /website/builder       after Website
--      Reservations widget        /website/reservations-widget   after the page builder
--
--    Each link goes straight after its anchor's first place in a group's
--    menu (same parent, hidden from the same roles), or after the fallback
--    anchor when the group took the first one out. A group that has neither
--    gets no link (the Navigation designer can add it), and a group that
--    already has the page keeps its menu as it is. The default tree for new
--    groups is api/src/config/defaultNav.js; api/test/nav-default.test.mjs
--    checks the two agree.

ALTER TABLE nav_items ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE nav_items DROP CONSTRAINT IF EXISTS nav_items_description_len;
ALTER TABLE nav_items ADD CONSTRAINT nav_items_description_len
  CHECK (description IS NULL OR char_length(description) <= 260);

DO $$
DECLARE
  l record;
BEGIN
  FOR l IN
    SELECT * FROM (VALUES
      (1, '/pos/kiosk-designs',   'Kiosk designer',            'Paintbrush',    'pos_setup', '/pos/kiosks',        '/pos/kiosks'),
      (2, '/pos/kitchen-flow',    'Kitchen flow designer',     'Route',         'pos_setup', '/pos/kitchen',       '/pos/kitchen'),
      (3, '/screens/boards',      'Screen board designer',     'Presentation',  'screens',   '/screens',           '/screens'),
      (4, '/screens/playlists',   'Screen playlists',          'ListVideo',     'screens',   '/screens/boards',    '/screens'),
      (5, '/screens/walls',       'Screen walls',              'Grid2x2',       'screens',   '/screens/playlists', '/screens'),
      (6, '/pos/print-designs',   'Receipt & ticket designer', 'ScrollText',    'pos_setup', '/pos/printing',      '/pos/printing'),
      (7, '/menus/print-designs', 'Menu print designer',       'BookOpenText',  'menus',     '/menus/times',       '/menus'),
      (8, '/website/builder',     'Page builder',              'Blocks',        'website',   '/website',           '/website'),
      (9, '/website/reservations-widget', 'Reservations widget',       'CalendarCheck', 'website',   '/website/builder',   '/website')
    ) AS t(ord, route, label, icon, module, anchor, fallback)
    ORDER BY ord
  LOOP
    WITH a AS (
      -- Each group's anchor: the page the new link goes after, at its first
      -- place in that group's menu; groups that already have the new page
      -- are left out.
      SELECT DISTINCT ON (n.tenant_id) n.id, n.tenant_id, n.parent_id, n.sort_order, n.hidden_role_ids
        FROM nav_items n
       WHERE n.route IN (l.anchor, l.fallback)
         AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = l.route)
       ORDER BY n.tenant_id, (n.route = l.anchor) DESC, n.created_at, n.sort_order, n.id
    ), room AS (
      UPDATE nav_items n SET sort_order = n.sort_order + 1
        FROM a
       WHERE n.tenant_id = a.tenant_id
         AND n.parent_id IS NOT DISTINCT FROM a.parent_id
         AND n.sort_order > a.sort_order
      RETURNING n.id
    )
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
    SELECT a.tenant_id, a.parent_id, 'link', l.label, l.icon, l.route, l.module, a.sort_order + 1, a.hidden_role_ids, false
      FROM a;
  END LOOP;
END $$;
