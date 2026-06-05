-- 063_seed_order_sheet_items.sql
-- Clean-slate reseed of order sheet categories + templates.
-- Pre-prod: safe to wipe.
--
-- Why this exists:
--  * Migration 062 left 4 generic placeholder templates AND its category
--    seed had been duplicated on some environments.
--  * The 3 REAL supplier templates (JJ Foods, JJ Oriental, JP Fresh) are
--    seeded by scripts/migrate.js runSeeds() WITH category assignments — so
--    here we only need to (a) clear templates/items so runSeeds recreates
--    them cleanly, and (b) dedupe categories to exactly 12 per tenant.

-- 1. Clear all templates + items (removes 062's generic placeholders too).
--    runSeeds() recreates the 3 supplier templates after migrations finish.
DELETE FROM order_sheet_items;
DELETE FROM order_sheet_templates;

-- 2. Dedupe categories: wipe and reseed exactly 12 shared categories/tenant.
DELETE FROM order_sheet_categories;

INSERT INTO order_sheet_categories (tenant_id, name, sort_order)
SELECT t.id, c.name, c.so
FROM tenants t
CROSS JOIN (VALUES
  ('Vegetables',                 0),
  ('Fruit',                      1),
  ('Herbs & Garnish',            2),
  ('Meat & Poultry',             3),
  ('Fish & Seafood',             4),
  ('Dairy & Eggs',               5),
  ('Dry Goods',                  6),
  ('Oils, Sauces & Condiments',  7),
  ('Bakery',                     8),
  ('Beverages',                  9),
  ('Cleaning Supplies',         10),
  ('Packaging',                 11)
) AS c(name, so);
