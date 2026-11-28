-- 319_stock_forecast.sql
--
-- Inventory phase 9a (27 Nov 2026; docs/INVENTORY.md 9): the forecast and
-- the suggested order. A suggestion is the forecast use until the delivery
-- after next plus a buffer, less what is on hand and on order
-- (shared/forecast.js). The buffer is the group's: a share of the forecast
-- added on top, 10% unless the group says otherwise, saved on its own
-- (PUT /api/stock/forecast-settings), as the variance band is.

ALTER TABLE stock_settings
  ADD COLUMN buffer_pct numeric(6,2) NOT NULL DEFAULT 10 CHECK (buffer_pct >= 0 AND buffer_pct <= 200);
