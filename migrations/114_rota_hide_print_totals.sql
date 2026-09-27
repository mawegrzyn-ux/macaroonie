-- 114_rota_hide_print_totals.sql
--
-- Rota setup: one switch that leaves the totals off the rota printout and
-- image (the per-day "Working" count row and each person's Hours column).
-- Tenant-wide, like the other rota print settings. The on-screen grid is
-- unaffected.

BEGIN;

ALTER TABLE rota_settings
  ADD COLUMN IF NOT EXISTS hide_totals_on_print boolean NOT NULL DEFAULT false;

COMMIT;
