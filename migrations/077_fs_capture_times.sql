-- ============================================================
-- 077_fs_capture_times.sql
--
-- Scheduled capture-time slots for food safety temperature logs
-- (e.g. "Morning check" 09:00, "Evening check" 18:00), configured
-- per venue. fs_temp_logs gets a nullable link to the slot it was
-- recorded against, with a partial unique index so re-logging the
-- same equipment/slot/day updates the existing reading (via
-- ON CONFLICT) instead of piling up duplicate rows. Ad-hoc readings
-- (capture_time_id NULL) are unaffected — the partial index doesn't
-- constrain them.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS fs_capture_times (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  label       text        NOT NULL,
  time_of_day time        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_capture_times_venue
  ON fs_capture_times (tenant_id, venue_id, is_active, time_of_day);

ALTER TABLE fs_capture_times ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_capture_times' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_capture_times
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fs_capture_times_updated_at ON fs_capture_times;
CREATE TRIGGER trg_fs_capture_times_updated_at
  BEFORE UPDATE ON fs_capture_times
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fs_temp_logs
  ADD COLUMN IF NOT EXISTS capture_time_id uuid REFERENCES fs_capture_times(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_temp_logs_unique_slot
  ON fs_temp_logs (equipment_id, log_date, capture_time_id)
  WHERE capture_time_id IS NOT NULL;

COMMIT;
