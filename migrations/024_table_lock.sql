-- 024_table_lock.sql
-- Add table_locked flag to bookings.
-- When true, the /relocate cascade-displacement engine will not move this
-- booking to make room for another booking. The operator must unlock it first.
-- Default false — all existing bookings are unlocked.

ALTER TABLE bookings
  ADD COLUMN table_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.table_locked IS
  'When true, this booking cannot be cascade-displaced by the /relocate engine.';
