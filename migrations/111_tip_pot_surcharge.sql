-- 111_tip_pot_surcharge.sql
--
-- A tip pot can carry a surcharge (e.g. a tax or card-processing fee): a
-- percentage taken off the pot's gross (sources + manual lines) before it is
-- shared. rotaCalc.js: available = gross - round2(gross x surcharge_pct / 100).
--
--   surcharge_name  label shown with the deduction (e.g. "Tax"), optional
--   surcharge_pct   0 = no surcharge

BEGIN;

ALTER TABLE tip_pots
  ADD COLUMN IF NOT EXISTS surcharge_name text,
  ADD COLUMN IF NOT EXISTS surcharge_pct  numeric(5,2) NOT NULL DEFAULT 0
    CHECK (surcharge_pct >= 0 AND surcharge_pct <= 100);

COMMIT;
