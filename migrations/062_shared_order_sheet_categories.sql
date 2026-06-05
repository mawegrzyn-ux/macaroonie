-- 062_shared_order_sheet_categories.sql
-- Replaces per-template categories with tenant-level shared categories.
-- Pre-prod: clears all existing template and item data, then reseeds with
-- logical F&B defaults.

-- 1. Drop per-template categories (CASCADE removes FK from order_sheet_items)
DROP TABLE IF EXISTS order_sheet_template_categories CASCADE;

-- 2. Clear test data (safe: pre-prod, no real orders)
DELETE FROM order_sheet_items;
DELETE FROM order_sheet_templates;

-- 3. Create tenant-level shared categories table
CREATE TABLE order_sheet_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_sheet_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON order_sheet_categories
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 4. Re-add FK on order_sheet_items (column already exists, data is empty)
ALTER TABLE order_sheet_items
  ADD CONSTRAINT order_sheet_items_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES order_sheet_categories(id) ON DELETE SET NULL;

-- 5. Seed logical default categories for all existing tenants
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

-- 6. Seed logical default templates for all existing tenants (items left for operators)
INSERT INTO order_sheet_templates (tenant_id, name, show_prices, delivery_days, is_active)
SELECT id, 'Daily Produce',        false, ARRAY[1,2,3,4,5], true FROM tenants
UNION ALL
SELECT id, 'Meat & Fish',          false, ARRAY[1,4],        true FROM tenants
UNION ALL
SELECT id, 'Weekly Dry Goods',     false, ARRAY[1],          true FROM tenants
UNION ALL
SELECT id, 'Cleaning & Packaging', false, ARRAY[1],          true FROM tenants;
