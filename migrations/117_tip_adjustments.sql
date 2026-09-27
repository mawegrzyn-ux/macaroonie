-- 117_tip_adjustments.sql
--
-- Tip moves gain one-sided adjustments alongside the zero-sum "move":
--
--   action 'move'    take from from_staff_id, give to the lines (as before)
--   action 'add'     give the lines extra (e.g. a bonus); nobody loses it
--   action 'remove'  take the lines' amounts off those people; nobody gets it
--
-- from_staff_id is only set for a move. Add and remove carry a reason in
-- note (required by the API). Lines stay positive amounts per person; the
-- action decides the sign.

BEGIN;

ALTER TABLE rota_tip_moves
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'move';
ALTER TABLE rota_tip_moves DROP CONSTRAINT IF EXISTS rota_tip_moves_action_check;
ALTER TABLE rota_tip_moves
  ADD CONSTRAINT rota_tip_moves_action_check CHECK (
    action IN ('move', 'add', 'remove')
    AND (action = 'move') = (from_staff_id IS NOT NULL)
  );
ALTER TABLE rota_tip_moves ALTER COLUMN from_staff_id DROP NOT NULL;

COMMIT;
