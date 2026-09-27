-- 119_tip_unallocated.sql
--
-- Quick +/- tip nudges on the Rota tips table. Each tap moves 0.50 between
-- a person's tip total and the week's unallocated pot:
--   minus  takes 0.50 off the person and puts it in the unallocated pot
--   plus   takes 0.50 out of the unallocated pot and gives it to the person
-- tip_unallocated is the person's net nudge for the week (negative after
-- more minus taps than plus). The week's unallocated pot is minus the sum
-- of every person's value, and may be left with money in it.

BEGIN;

ALTER TABLE rota_week_staff
  ADD COLUMN IF NOT EXISTS tip_unallocated numeric(10,2) NOT NULL DEFAULT 0;

COMMIT;
