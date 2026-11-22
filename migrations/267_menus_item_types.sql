-- Menus as catalogues, step 1 (docs/CATALOGUE.md 4.1, 4.5; decisions D1 to D4
-- agreed 22 Nov 2026): what a sold item is. 'food' (food and drink: the
-- allergen rules), 'goods' (retail goods) or 'service' (time or labour).
-- Set on the menu (required) and overridden on a section or a dish (null =
-- the level above), the most specific winning, as tax does. One rule reads
-- it: itemType() in shared/catalogue.js. Every menu is food today.
ALTER TABLE menus
  ADD COLUMN item_type text NOT NULL DEFAULT 'food'
    CHECK (item_type IN ('food', 'goods', 'service'));
ALTER TABLE menu_sections
  ADD COLUMN item_type text
    CHECK (item_type IN ('food', 'goods', 'service'));
ALTER TABLE menu_items
  ADD COLUMN item_type text
    CHECK (item_type IN ('food', 'goods', 'service'));
