-- 065_reseed_order_sheet_data_final.sql
-- Definitive fix using PL/pgSQL DO block so every DELETE/INSERT runs with
-- the correct app.tenant_id, satisfying RLS. Previous migrations used bare
-- DELETE which is silently blocked by RLS, and TRUNCATE which may fail if
-- the app user lacks TRUNCATE privilege. The DO block + set_config approach
-- is guaranteed to work with the same credentials the app uses.

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  FOR v_tenant_id IN SELECT id FROM tenants WHERE is_active = true LOOP
    PERFORM set_config('app.tenant_id', v_tenant_id::text, true);

    -- Clear in FK-safe order --------------------------------------------------

    -- 1. order_sheet_order_items (RESTRICT ref → order_sheet_items + order_sheets)
    DELETE FROM order_sheet_order_items
    WHERE order_id IN (SELECT id FROM order_sheets);

    -- 2. order_sheets (RESTRICT ref → order_sheet_templates)
    DELETE FROM order_sheets;

    -- 3. order_sheet_template_venues + items (both reference templates)
    DELETE FROM order_sheet_template_venues
    WHERE template_id IN (SELECT id FROM order_sheet_templates);

    -- order_sheet_suggested_qty cascades from items, no explicit delete needed
    DELETE FROM order_sheet_items
    WHERE template_id IN (SELECT id FROM order_sheet_templates);

    -- 4. templates + categories (now safe to delete)
    DELETE FROM order_sheet_templates;
    DELETE FROM order_sheet_categories;

    -- Reseed 12 shared categories for this tenant -----------------------------
    INSERT INTO order_sheet_categories (tenant_id, name, sort_order) VALUES
      (v_tenant_id, 'Vegetables',                  0),
      (v_tenant_id, 'Fruit',                       1),
      (v_tenant_id, 'Herbs & Garnish',             2),
      (v_tenant_id, 'Meat & Poultry',              3),
      (v_tenant_id, 'Fish & Seafood',              4),
      (v_tenant_id, 'Dairy & Eggs',                5),
      (v_tenant_id, 'Dry Goods',                   6),
      (v_tenant_id, 'Oils, Sauces & Condiments',   7),
      (v_tenant_id, 'Bakery',                      8),
      (v_tenant_id, 'Beverages',                   9),
      (v_tenant_id, 'Cleaning Supplies',           10),
      (v_tenant_id, 'Packaging',                   11);

  END LOOP;
END;
$$;

-- Templates + items are seeded by scripts/migrate.js runSeeds() after this
-- migration runs. runSeeds now uses SET LOCAL within a transaction so it
-- can read categories under RLS, and it force-recreates templates that have
-- 0 items (previous runSeeds calls created templates with null category_ids
-- because the RLS-blocked category lookup returned empty).
