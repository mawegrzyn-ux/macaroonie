-- 140_staff_pay_method.sql
--
-- How each staff member is paid, and the bank transfer part of each week's
-- wages.
--
-- cash_staff.pay_method: cash (cash in hand, the default), bank (bank
-- transfer) or split (cash_staff.bank_amount by bank each week, the rest
-- cash). The split rule is shared/payMethod.js splitPay().
--
-- cash_wage_entries.bank_amount: the part of the week's total paid by bank
-- transfer. Cash still to pay = total - bank_amount; cash_amount is the
-- cash actually handed over (the only part Cash Recon's variance counts).

BEGIN;

ALTER TABLE cash_staff
  ADD COLUMN IF NOT EXISTS pay_method text NOT NULL DEFAULT 'cash'
    CHECK (pay_method IN ('cash', 'bank', 'split')),
  ADD COLUMN IF NOT EXISTS bank_amount numeric(10,2)
    CHECK (bank_amount IS NULL OR bank_amount >= 0);

ALTER TABLE cash_wage_entries
  ADD COLUMN IF NOT EXISTS bank_amount numeric(10,2) NOT NULL DEFAULT 0
    CHECK (bank_amount >= 0);

COMMIT;
