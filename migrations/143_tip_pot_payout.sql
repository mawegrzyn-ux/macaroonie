-- 143_tip_pot_payout.sql
--
-- How a tip pot is paid out (Rota setup, per pot):
--   tip_pots.payout_method  cash | bank       paid in cash or by bank transfer
--   tip_pots.payout_to      shares | people   each person gets their own share
--                                             of the pot, or the whole pot goes
--                                             to the people picked for the week
-- Picking people (Rota page, per venue week): rota_week_pot_payees holds the
-- staff a pot is paid to that week. A week with no row uses the latest
-- earlier week's pick, so it is set once and carries forward; an empty
-- staff_ids array means nobody (the pot is then paid as shared).
--
-- When a pot is paid to specific people, everyone's other tips are adjusted
-- so each person still receives their share overall (services/rotaCalc.js).

BEGIN;

ALTER TABLE tip_pots
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'cash'
    CHECK (payout_method IN ('cash', 'bank')),
  ADD COLUMN IF NOT EXISTS payout_to text NOT NULL DEFAULT 'shares'
    CHECK (payout_to IN ('shares', 'people'));

CREATE TABLE IF NOT EXISTS rota_week_pot_payees (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  week_start  date        NOT NULL,
  pot_id      uuid        NOT NULL REFERENCES tip_pots(id) ON DELETE CASCADE,
  staff_ids   uuid[]      NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, week_start, pot_id)
);
CREATE INDEX IF NOT EXISTS rota_week_pot_payees_lookup
  ON rota_week_pot_payees (tenant_id, venue_id, pot_id, week_start DESC);
ALTER TABLE rota_week_pot_payees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rota_week_pot_payees_tenant ON rota_week_pot_payees;
CREATE POLICY rota_week_pot_payees_tenant ON rota_week_pot_payees
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
