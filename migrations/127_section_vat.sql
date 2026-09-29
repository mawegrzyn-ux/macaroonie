-- ============================================================
-- 127_section_vat.sql
--
-- Section (category) level VAT for web ordering. A dish's VAT rate is
-- now resolved: the dish's own rate, else its section's rate, else the
-- venue default in Ordering setup (vatRateFor() in orderSvc.js).
--
--   menu_sections.vat_rate_takeaway   % for collection / delivery orders
--   menu_sections.vat_rate_eat_in     % for table orders
--
-- NULL = use the venue default.
-- ============================================================

ALTER TABLE menu_sections
  ADD COLUMN IF NOT EXISTS vat_rate_takeaway numeric(5,2) CHECK (vat_rate_takeaway BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS vat_rate_eat_in   numeric(5,2) CHECK (vat_rate_eat_in BETWEEN 0 AND 100);
