-- ============================================================
-- 133_min_order_qty.sql
--
-- A dish's minimum order quantity for online ordering (e.g. spring
-- rolls, min 2). NULL or 1 = no minimum. Counted per dish across the
-- basket (all its lines, whatever the options); priceBasket() in
-- shared/orderPricing.js rejects a basket below it and the guest page
-- starts the dish at that quantity.
-- ============================================================

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS min_order_qty int
  CHECK (min_order_qty IS NULL OR min_order_qty BETWEEN 1 AND 99);
