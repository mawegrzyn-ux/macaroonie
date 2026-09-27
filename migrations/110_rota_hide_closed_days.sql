-- 110_rota_hide_closed_days.sql
--
-- Rota setup: hide days the venue is closed (from its booking schedule:
-- exceptions, date overrides, weekly template) on the rota grid and/or on
-- the printouts. Two independent tenant-wide switches. A closed day that
-- still has someone rostered is always shown so nothing is hidden by mistake.

BEGIN;

ALTER TABLE rota_settings
  ADD COLUMN IF NOT EXISTS hide_closed_on_rota  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_closed_on_print boolean NOT NULL DEFAULT false;

COMMIT;
