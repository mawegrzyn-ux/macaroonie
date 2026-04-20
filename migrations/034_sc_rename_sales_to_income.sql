-- ============================================================
-- 034_sc_rename_sales_to_income.sql
--
-- Renames cash_sc_sources.included_in_sales → included_in_income.
--
-- The flag semantics changed: it no longer means "also count as
-- sales revenue", it means "the operator has already bundled this
-- SC amount into the declared income total". The variance math
-- uses both flags together to XOR-adjust the expected-cash figure:
--
--   included_in_income | included_in_takings | variance adjustment
--   -------------------+---------------------+--------------------
--   true               | true                | no change (SC in
--                      |                     | income AND in till)
--   true               | false               | subtract SC (income
--                      |                     | has it, till doesn't)
--   false              | true                | add SC (not in
--                      |                     | income, but in till)
--   false              | false               | no change
--
-- Idempotent: runs only if the old column exists OR the new
-- column is missing.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'cash_sc_sources'
       AND column_name  = 'included_in_sales'
  ) THEN
    ALTER TABLE cash_sc_sources
      RENAME COLUMN included_in_sales TO included_in_income;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'cash_sc_sources'
       AND column_name  = 'included_in_income'
  ) THEN
    ALTER TABLE cash_sc_sources
      ADD COLUMN included_in_income boolean NOT NULL DEFAULT false;
  END IF;
END
$$;

COMMENT ON COLUMN cash_sc_sources.included_in_income IS
  'When true, the operator has already included this SC amount in the declared income total. Works with included_in_takings to XOR-adjust the reconciliation variance.';
