-- 151_points_nudge.sql
--
-- Quick +/- point taps on the Rota tips table, next to each person's
-- points, like the £ taps (tip_unallocated, migration 119). Each tap moves
-- half a point between a person and the week's spare points:
--   minus  takes 0.5 off the person and puts it in the spare points
--   plus   takes 0.5 out of the spare points and gives it to the person
-- points_nudge is the person's net change for the week; the week's spare
-- points are minus the sum of everyone's value. Spare points keep their
-- share of each points pot, and what they are worth at the end of the week
-- is carried over to the next week with the rest of the unallocated tips.

BEGIN;

ALTER TABLE rota_week_staff
  ADD COLUMN IF NOT EXISTS points_nudge numeric(8,2) NOT NULL DEFAULT 0;

COMMIT;
