-- ============================================================
-- 137_rota_pay_adjustments.sql
--
-- Rota pay adjustments, per person per venue week, on top of the
-- rota's computed pay (or its pay_override):
--   extra          + this week (bonus, extra hours, ...)
--   deduction      - this week
--   advance        + this week: cash handed over early, out of the till
--   advance_repay  - next week: created with every advance (source_id),
--                  so the advance comes off the following week's pay.
--                  Deleting the advance deletes its repayment.
--
-- Money a person wasn't paid in full last week (Cash Recon wages
-- total - cash paid) is not stored here: services/rotaCalc.js adds it
-- to the next week's pay from the wage rows.
--
-- Also drops the Cash Recon wage report submit state: wages are no
-- longer submitted (the days are), so they never lock.
-- ============================================================

CREATE TABLE IF NOT EXISTS rota_pay_adjustments (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  venue_id    uuid          NOT NULL REFERENCES venues(id)     ON DELETE CASCADE,
  staff_id    uuid          NOT NULL REFERENCES cash_staff(id) ON DELETE CASCADE,
  week_start  date          NOT NULL,
  kind        text          NOT NULL CHECK (kind IN ('extra', 'deduction', 'advance', 'advance_repay')),
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  note        text,
  source_id   uuid          REFERENCES rota_pay_adjustments(id) ON DELETE CASCADE,
  created_by  text,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rota_pay_adjustments_week_idx ON rota_pay_adjustments (venue_id, week_start);

ALTER TABLE rota_pay_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_pay_adjustments_tenant ON rota_pay_adjustments;
CREATE POLICY rota_pay_adjustments_tenant ON rota_pay_adjustments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE cash_wage_reports DROP COLUMN IF EXISTS status;
ALTER TABLE cash_wage_reports DROP COLUMN IF EXISTS submitted_at;
