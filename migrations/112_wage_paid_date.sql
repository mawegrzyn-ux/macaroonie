-- 112_wage_paid_date.sql
--
-- The day a wage was paid out of the till. Staff pay cash wages before
-- counting, so that day's counted cash is short by the wage; Cash Recon's
-- day variance adds back wages paid that day (reconCalc in CashRecon.jsx,
-- GET .../week and .../week-detail in cashRecon.js). NULL = not assigned to
-- a day: the amount then only balances in the week's variance.

BEGIN;

ALTER TABLE cash_wage_entries
  ADD COLUMN IF NOT EXISTS paid_date date;

COMMIT;
