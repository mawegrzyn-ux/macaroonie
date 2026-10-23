-- 198_option_group_display_name.sql
--
-- An option group's display name.
--
--   menu_variant_groups.display_name   what guests see (kiosks, online
--                                      ordering, the website, printed
--                                      menus, menu screens) and the tills;
--                                      NULL = the group's name. The name
--                                      stays the one staff tell groups apart
--                                      by on the Variant groups page and the
--                                      Menus page ("Flavour x2 (copy)" shown
--                                      as "Choose your flavours").
--
-- A dish's attached groups go into a menu's releases (shared/menuDiff.js
-- releaseContent() writes the display name as the group's name there), so a
-- new display name reaches guests when the menu is published, like a rename.

ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS display_name text CHECK (length(display_name) <= 80);
