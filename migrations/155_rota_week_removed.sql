-- 155_rota_week_removed.sql
--
-- Take a person off one week's rota. Every active staff member is a row on
-- the weekly rota; a person who isn't working that week at all (holiday,
-- not needed, about to leave) can be removed from that week only.
--
--   rota_week_staff.removed  true = left off this venue week: no row on the
--                            rota grid, the print / image, or the pay and
--                            tips tables. They have no entries that week
--                            (the rota save refuses entries for a removed
--                            person, and copying a week skips them). They
--                            still show in pay and tips if they have money
--                            that week (a pay adjustment, wages owed from
--                            last week, a tip move, a manual pot amount, or
--                            a pot paid to them).
--
-- Saved with the week's entries (PUT .../weeks/:week/entries,
-- removed_staff_ids). Other weeks are unaffected.

BEGIN;

ALTER TABLE rota_week_staff
  ADD COLUMN IF NOT EXISTS removed boolean NOT NULL DEFAULT false;

COMMIT;
