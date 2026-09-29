-- ============================================================
-- 132_promotion_extras.sql
--
-- Three more promotion kinds (rules in shared/promotions.js):
--   free_item  when the order qualifies, get_qty of the dishes it covers
--              (item_ids / section_ids) are free (or get_percent off);
--              the minimum spend doesn't count the free dish itself
--   bundle     a meal deal: one of each component for bundle_price_pence
--              bundle = [{ label, item_ids, section_ids, qty }]
--   tiered     spend more, save more: tiers = [{ min_pence, value }],
--              value in discount_type (% or pence), the highest tier
--              reached applies to the whole order
-- ============================================================

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_kind_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_kind_check
  CHECK (kind IN ('basket', 'item', 'bogo', 'free_item', 'bundle', 'tiered'));

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS bundle             jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS bundle_price_pence int   CHECK (bundle_price_pence IS NULL OR bundle_price_pence >= 0);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS tiers              jsonb NOT NULL DEFAULT '[]'::jsonb;
