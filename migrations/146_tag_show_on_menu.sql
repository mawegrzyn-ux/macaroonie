-- 146_tag_show_on_menu.sql
--
-- menu_dietary_tags.show_on_menu: off = the tag is left off everything
-- guests see (website menu block, printed menus and their keys, the
-- dietary list, online ordering) but stays in the Allergen matrix, the
-- allergen lookup and the menu editor. For example, show Gluten-free on
-- menus and keep the Gluten allergen for staff only.

BEGIN;

ALTER TABLE menu_dietary_tags
  ADD COLUMN IF NOT EXISTS show_on_menu boolean NOT NULL DEFAULT true;

COMMIT;
