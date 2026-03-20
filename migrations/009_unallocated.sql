-- 009_unallocated.sql
-- Adds is_unallocated flag to the tables table.
--
-- The "Unallocated" virtual table is auto-created per venue by the API
-- whenever the smart-relocate algorithm cannot cascade a displaced booking
-- to a real free table.  Bookings assigned here appear in a special
-- top-of-timeline section (pick-up only; cannot be manually dropped onto).
--
-- is_unallocated = true tables are excluded from:
--   • slot availability (get_available_slots function)
--   • normal table editors
--   • new-booking table selection
-- They ARE included in booking queries so displaced bookings can be displayed.

ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS is_unallocated boolean NOT NULL DEFAULT false;

-- Partial index for fast lookup of the unallocated table per venue
CREATE INDEX IF NOT EXISTS idx_tables_unallocated
  ON tables (venue_id)
  WHERE is_unallocated = true;
