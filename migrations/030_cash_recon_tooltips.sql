-- 030_cash_recon_tooltips.sql
--
-- Adds a tooltip/description field to cash recon config items
-- (income sources, payment channels, SC sources).
-- Displayed under the item name in the daily declaration view.

BEGIN;

ALTER TABLE cash_income_sources   ADD COLUMN IF NOT EXISTS tooltip text;
ALTER TABLE cash_payment_channels ADD COLUMN IF NOT EXISTS tooltip text;
ALTER TABLE cash_sc_sources       ADD COLUMN IF NOT EXISTS tooltip text;

COMMIT;
