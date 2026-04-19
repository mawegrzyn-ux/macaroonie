BEGIN;

-- Notes per income/takings/SC entry (operator can add context per line)
ALTER TABLE cash_income_entries  ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE cash_takings_entries ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE cash_sc_entries      ADD COLUMN IF NOT EXISTS notes text;

-- Wage entry type: hourly (hours × rate) or fixed (direct total amount)
ALTER TABLE cash_wage_entries ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'hourly'
  CHECK (entry_type IN ('hourly', 'fixed'));

COMMIT;
