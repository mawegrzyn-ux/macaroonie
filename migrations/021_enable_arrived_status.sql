-- Migration 021: enable_arrived_status flag on booking_rules
-- Controls whether the "Arrived" status appears in the booking drawer.
-- Default: true (enabled, preserving existing behaviour for all venues).

ALTER TABLE booking_rules
  ADD COLUMN IF NOT EXISTS enable_arrived_status boolean NOT NULL DEFAULT true;
