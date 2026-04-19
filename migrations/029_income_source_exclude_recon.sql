-- 029_income_source_exclude_recon.sql
--
-- Adds exclude_from_recon flag to cash_income_sources.
-- When true the source's declared amount is still stored and displayed,
-- but is NOT included in the reconciliation totals (income total, variance).
-- Useful for delivery providers whose net payout is received separately
-- and should not be reconciled against daily takings.

BEGIN;

ALTER TABLE cash_income_sources
  ADD COLUMN IF NOT EXISTS exclude_from_recon boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cash_income_sources.exclude_from_recon
  IS 'When true, this source is shown in daily declaration but excluded from reconciliation totals.';

COMMIT;
