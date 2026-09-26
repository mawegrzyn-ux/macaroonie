-- ============================================================
-- 100_expense_paid_by_card.sql
--
-- Lets a petty cash expense be flagged as paid by card instead of
-- from the till. Card-paid expenses are still recorded (for
-- bookkeeping, VAT, receipts) but are excluded from every cash
-- reconciliation figure: the day's Total Expenses, Net Cash, and the
-- week grid's Expenses / Net Cash / Cash to bank rows.
-- ============================================================

BEGIN;

ALTER TABLE cash_expenses
  ADD COLUMN IF NOT EXISTS paid_by_card boolean NOT NULL DEFAULT false;

COMMIT;
