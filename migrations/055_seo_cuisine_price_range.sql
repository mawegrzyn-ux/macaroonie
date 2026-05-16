-- 055_seo_cuisine_price_range.sql
-- Adds cuisine type and price range to website_config so they can be
-- surfaced in schema.org Restaurant JSON-LD (servesCuisine, priceRange).

ALTER TABLE website_config
  ADD COLUMN IF NOT EXISTS cuisine     text,
  ADD COLUMN IF NOT EXISTS price_range text;
