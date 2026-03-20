-- ============================================================
-- 013_doors_close_per_sitting.sql
-- Moves doors_close_time from the day template down to
-- individual sittings, giving operators per-sitting control.
--
-- Example: a venue with a lunch (12:00–15:00) and dinner
-- (18:00–23:00) sitting can set different doors-close times
-- for each (e.g. 14:30 and 22:00).
--
-- The template-level doors_close_time column is kept for
-- backward compatibility but is no longer used by the app.
-- ============================================================

ALTER TABLE venue_sittings
  ADD COLUMN IF NOT EXISTS doors_close_time time;

ALTER TABLE override_sittings
  ADD COLUMN IF NOT EXISTS doors_close_time time;
