-- ============================================================
-- 033_sc_included_in_sales.sql
--
-- Adds an `included_in_sales` flag on service charge / tips
-- sources. Works independently of the existing
-- `included_in_takings` flag so operators can model three
-- scenarios:
--
--   1. SC retained by the business as revenue AND expected in
--      the till (counts toward both KPIs):
--        included_in_sales   = true
--        included_in_takings = true
--      → figure appears in BOTH the "Total Sales" figure and
--        the reconciliation variance math.
--
--   2. SC collected in cash but paid out to staff as tips
--      (not business revenue, not expected in till at close):
--        included_in_sales   = false
--        included_in_takings = false
--
--   3. SC must balance in the till but is NOT reported as
--      business revenue (e.g. held on behalf of staff for later
--      distribution):
--        included_in_sales   = false
--        included_in_takings = true
--
-- The admin page treats these as two independent toggles per
-- SC source.  When included_in_sales is true, the source's
-- daily amount is added to the "Total Income / Sales" KPI;
-- the takings variance calculation stays governed by
-- included_in_takings.
-- ============================================================

ALTER TABLE cash_sc_sources
  ADD COLUMN IF NOT EXISTS included_in_sales boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cash_sc_sources.included_in_sales IS
  'When true, this service charge source''s daily amount is counted as part of the venue''s Total Sales (revenue). Independent of included_in_takings, which governs reconciliation variance.';
