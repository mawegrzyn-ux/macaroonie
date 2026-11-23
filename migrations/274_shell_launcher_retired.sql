-- Launcher mode retired (Pepper-first step 2d, reports/AI first back office
-- strategy.md: "Launcher mode is retired and its tiles become pins"). The
-- sidebar is the only menu; each person's pins on Home (migration 272) are
-- their shortcuts.
--
-- 1. In a group that was in launcher mode, each active member with a login
--    who has no pins yet gets the group's tiles as pins, in the tiles' order,
--    at most 12, each page once. A pin whose page isn't in the person's own
--    menu is simply not shown (GET /api/pins filters by the menu), so the
--    roles need no check here.
-- 2. tenants.nav_style, nav_items.show_in_launcher and launcher_sort_order
--    (and the launcher index) go.

INSERT INTO home_pins (tenant_id, user_sub, sort_order, path)
SELECT tenant_id, user_sub, n - 1, route
  FROM (
    SELECT t.tenant_id, t.user_sub, t.route,
           row_number() OVER (PARTITION BY t.tenant_id, t.user_sub ORDER BY t.launcher_sort_order, t.sort_order, t.route) AS n
      FROM (
        SELECT DISTINCT ON (u.tenant_id, u.auth0_user_id, i.route)
               u.tenant_id, u.auth0_user_id AS user_sub, i.route, i.launcher_sort_order, i.sort_order
          FROM users u
          JOIN tenants g ON g.id = u.tenant_id AND g.nav_style = 'launcher'
          JOIN nav_items i ON i.tenant_id = u.tenant_id AND i.kind = 'link' AND i.show_in_launcher AND i.is_active
         WHERE u.is_active AND u.auth0_user_id IS NOT NULL
           AND i.route ~ '^/[a-z0-9/-]*$' AND char_length(i.route) <= 100
           AND NOT EXISTS (SELECT 1 FROM home_pins p WHERE p.tenant_id = u.tenant_id AND p.user_sub = u.auth0_user_id)
         ORDER BY u.tenant_id, u.auth0_user_id, i.route, i.launcher_sort_order, i.sort_order
      ) t
  ) ranked
 WHERE n <= 12;

DROP INDEX IF EXISTS idx_nav_items_launcher;
ALTER TABLE nav_items DROP COLUMN IF EXISTS show_in_launcher;
ALTER TABLE nav_items DROP COLUMN IF EXISTS launcher_sort_order;
ALTER TABLE tenants DROP COLUMN IF EXISTS nav_style;
