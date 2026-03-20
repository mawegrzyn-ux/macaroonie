-- ============================================================
-- 012_unconfirmed_status.sql
-- Adds 'unconfirmed' booking status for venues that use a
-- call-to-confirm workflow.
--
-- Flow when enable_unconfirmed_flow = true:
--   guest books → status = 'unconfirmed'
--   operator calls guest, confirms they're coming → status = 'confirmed'
--   (then normal: completed / no_show / cancelled)
--
-- Flow when enable_unconfirmed_flow = false (default):
--   guest books → status = 'confirmed'  (existing behaviour unchanged)
-- ============================================================

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'unconfirmed' BEFORE 'confirmed';

ALTER TABLE booking_rules
  ADD COLUMN IF NOT EXISTS enable_unconfirmed_flow boolean NOT NULL DEFAULT false;
