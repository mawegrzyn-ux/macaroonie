-- ============================================================
-- 128_dietary_tags_route.sql
--
-- "Dietary groups" is renamed "Dietary tags" everywhere, matching what the
-- menu editor already calls them. The admin page moved from
-- /menus/dietary-groups to /menus/dietary-tags; point existing nav links
-- at the new route and rename them unless the operator relabelled them.
-- ============================================================

UPDATE nav_items
   SET route = '/menus/dietary-tags',
       label = CASE WHEN label = 'Dietary groups' THEN 'Dietary tags' ELSE label END
 WHERE route = '/menus/dietary-groups';
