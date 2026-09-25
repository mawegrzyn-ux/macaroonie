-- ============================================================
-- 099_expense_vat_amount.sql
--
-- Adds a VAT amount field to petty cash expenses, alongside the
-- existing (gross) amount. Purely informational — VAT is never added
-- to or deducted from anything in reconciliation, since `amount` is
-- already the gross (VAT-inclusive) figure that all recon math uses.
-- Recorded so the figure is available for accounting/bookkeeping.
-- ============================================================

BEGIN;

ALTER TABLE cash_expenses
  ADD COLUMN IF NOT EXISTS vat_amount numeric(10,2) NOT NULL DEFAULT 0;

COMMIT;
