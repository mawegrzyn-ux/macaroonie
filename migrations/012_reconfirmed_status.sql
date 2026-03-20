-- ============================================================
-- 012_reconfirmed_status.sql
-- Adds 'reconfirmed' booking status (optional — toggled per venue)
-- and the rule flag that enables it.
--
-- 'reconfirmed' means the operator called the guest the day before
-- and confirmed they are still attending.
-- ============================================================

-- Extend the enum — ADD VALUE is transactional in PG 12+
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'reconfirmed' AFTER 'confirmed';

-- Per-venue toggle: when false (default) the status is never offered in the drawer
ALTER TABLE booking_rules
  ADD COLUMN IF NOT EXISTS enable_reconfirmed_status boolean NOT NULL DEFAULT false;
