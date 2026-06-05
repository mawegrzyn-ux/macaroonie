-- 064_fix_order_sheet_data.sql
-- Fixes category triplication and empty templates caused by migrations 062/063
-- using DELETE which is silently blocked by RLS when app.tenant_id is unset.
-- TRUNCATE bypasses RLS. Run in FK-safe order (no CASCADE needed).

TRUNCATE order_sheet_order_items;
TRUNCATE order_sheets;
TRUNCATE order_sheet_suggested_qty;
TRUNCATE order_sheet_items;
TRUNCATE order_sheet_template_venues;
TRUNCATE order_sheet_templates;
TRUNCATE order_sheet_categories;

-- Reseed exactly 12 categories per tenant
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

-- Templates + items are seeded by scripts/migrate.js runSeeds() after
-- this migration runs. With templates truncated, runSeeds will recreate
-- all 3 supplier sheets with category assignments.
