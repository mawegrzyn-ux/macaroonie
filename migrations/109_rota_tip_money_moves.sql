-- 109_rota_tip_money_moves.sql
--
-- Move tips by a £ amount between people for a week, alongside moving
-- points. rota_week_staff.tip_adjustment is added to (or taken off) the
-- person's total tip share after every pot is shared out; moves are
-- zero-sum across the venue week. See services/rotaCalc.js.

BEGIN;

ALTER TABLE rota_week_staff
  ADD COLUMN IF NOT EXISTS tip_adjustment numeric(10,2) NOT NULL DEFAULT 0;

COMMIT;
