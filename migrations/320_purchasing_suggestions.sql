-- 320_purchasing_suggestions.sql
--
-- Inventory phase 9a (27 Nov 2026; docs/INVENTORY.md 9): what the order
-- form's Suggest proposed for a line, kept beside what was ordered, so the
-- suggestion can be judged (the report subject Suggested orders). Written
-- when the suggestion is made (POST /api/purchasing/orders/:id/suggest), the
-- latest one per line; the line's own qty is what the person then ordered
-- (a suggestion changes it only when they press OK, or type over it).
--
--   suggested_qty        packs of suggestion_quote_id suggested
--   suggested_base       the same in the item's base unit (packs x the pack's size then)
--   suggestion_quote_id  the supplier price it was suggested on
--   suggestion_basis     'forecast' (usage from sales) or 'par' (no sales use in four weeks)
--   forecast_base        the forecast use over the window, base unit (null on par)
--   window_from          the trading day it was suggested on (the window's first day)
--   window_to            the delivery after next: the window runs up to the day before it
--   suggestion           the working: on hand, on order, the buffer, each day's forecast, the words
--   suggested_at / _by   when and by whom (the person, as the stock documents keep them)
--
-- supply_order_lines already has RLS enabled and forced (migrations 153 and 176).

ALTER TABLE supply_order_lines
  ADD COLUMN suggested_qty        numeric(10,3) CHECK (suggested_qty >= 0),
  ADD COLUMN suggested_base       numeric(16,4),
  ADD COLUMN suggestion_quote_id  uuid REFERENCES inv_quotes(id) ON DELETE SET NULL,
  ADD COLUMN suggestion_basis     text CHECK (suggestion_basis IN ('forecast', 'par')),
  ADD COLUMN forecast_base        numeric(16,4),
  ADD COLUMN window_from          date,
  ADD COLUMN window_to            date,
  ADD COLUMN suggestion           jsonb,
  ADD COLUMN suggested_at         timestamptz,
  ADD COLUMN suggested_by         text;

CREATE INDEX supply_order_lines_suggested ON supply_order_lines (tenant_id, suggested_at) WHERE suggested_at IS NOT NULL;
