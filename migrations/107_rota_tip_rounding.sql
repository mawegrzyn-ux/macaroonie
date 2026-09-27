-- 107_rota_tip_rounding.sql
--
-- Tip share rounding (tenant-wide, Rota setup). Each person's tip share is
-- rounded to a multiple of tip_round_to (e.g. 0.50, 1, 5); NULL = to the
-- penny (no rounding). tip_round_mode picks nearest / always up / always
-- down. The difference between the rounded total and the pot is shown on
-- the Tips table; see services/rotaCalc.js.

BEGIN;

ALTER TABLE rota_settings
  ADD COLUMN tip_round_to   numeric(8,2) CHECK (tip_round_to IS NULL OR tip_round_to > 0),
  ADD COLUMN tip_round_mode text NOT NULL DEFAULT 'nearest'
    CHECK (tip_round_mode IN ('nearest', 'up', 'down'));

COMMIT;
