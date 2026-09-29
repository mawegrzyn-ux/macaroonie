-- 129_rota_entry_status.sql
--
-- A rota entry can record time off as well as work. status:
--   on    working (the only status before this migration)
--   sick  off sick           (unpaid on the rota, no tip points)
--   pto   paid time off      (paid like the shift, no tip points)
--   uto   unpaid time off    (unpaid, no tip points)
--   abs   absent / no-show   (unpaid, no tip points)
-- Pay and points rules live in api/src/services/rotaCalc.js.

ALTER TABLE rota_entries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'on';

DO $$ BEGIN
  ALTER TABLE rota_entries ADD CONSTRAINT rota_entries_status_check
    CHECK (status IN ('on', 'sick', 'pto', 'uto', 'abs'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
