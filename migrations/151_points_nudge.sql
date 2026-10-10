-- 151_points_nudge.sql
--
-- Quick +/- point taps on the Rota tips table, next to each person's
-- points. Each tap adds or takes off half a point:
--   minus  takes 0.5 off the person's points
--   plus   adds 0.5 to the person's points
-- points_nudge is the person's net change for the week. Unlike the £ taps
-- (tip_unallocated, migration 119) there is no pot of spare points: a
-- points pot is always shared by everyone's points as they stand, so taking
-- points off one person gives everyone else a slightly bigger share.

BEGIN;

ALTER TABLE rota_week_staff
  ADD COLUMN IF NOT EXISTS points_nudge numeric(8,2) NOT NULL DEFAULT 0;

COMMIT;
