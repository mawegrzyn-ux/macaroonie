-- ============================================================
-- 094_menu_item_calories.sql
--
-- Optional calorie count per menu item (kcal), shown alongside price
-- on the website menu block, the printable menu, and the page-builder
-- canvas preview. Nullable — most dishes won't have it filled in on
-- day one, and nothing should require it.
-- ============================================================

BEGIN;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS calories int CHECK (calories IS NULL OR calories >= 0);

COMMIT;
