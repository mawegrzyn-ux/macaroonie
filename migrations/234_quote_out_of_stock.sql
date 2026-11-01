-- 234_quote_out_of_stock.sql
--
-- Purchasing step 4 (1 Nov 2026): a supplier price the supplier can't
-- supply for a while. The price stays as it is (still ordered on, still
-- the usual one); orders for a delivery before the date say so and offer
-- the item's other prices. Nothing moves to another price by itself.
--   out_of_stock_until  the first day it can be delivered again
--   out_of_stock_note   what the supplier said (optional)
--   out_of_stock_by/at  who marked it and when
-- A date that has passed means it is in stock again; nothing clears it.

ALTER TABLE inv_quotes
  ADD COLUMN out_of_stock_until date,
  ADD COLUMN out_of_stock_note  text CHECK (out_of_stock_note IS NULL OR length(out_of_stock_note) <= 500),
  ADD COLUMN out_of_stock_by    text,
  ADD COLUMN out_of_stock_at    timestamptz;
