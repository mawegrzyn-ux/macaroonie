-- ============================================================
-- 090_hold_stations_cooking_sessions.sql
--
-- Two redesigns of the Food Safety module's Holds and Cooking checks,
-- both replacing a one-off free-text "New check" modal with something
-- closer to how equipment/temp logs already work.
--
-- HOLD CHECKS — "fridges-style" setup, kept as its own tab (not merged
-- into fs_equipment, even though equipment_type already has hot_hold/
-- cold_hold options — those stay for ad-hoc equipment; hold stations
-- are their own concept with their own management UI). Mirrors
-- fs_equipment + fs_capture_times + fs_temp_logs exactly:
--   fs_hold_stations       — named stations ("Bain-marie 1", "Salad bar")
--   fs_hold_capture_times  — scheduled check times, same shape as
--                            fs_capture_times but scoped to holds
--   fs_hold_checks         — gains station_id + capture_time_id, loses
--                            the old free-text item_name (pre-prod: no
--                            real data to preserve, so this is a clean
--                            TRUNCATE + restructure rather than a
--                            nullable bolt-on column)
--
-- COOKING CHECKS — menu-item-driven entry instead of typing a dish name
-- each time, with configurable sessions (how many times a day) each
-- carrying a target (how many items must be checked to meet criteria):
--   fs_cooking_sessions    — named sessions ("Lunch service") with an
--                            optional time_of_day and a required item
--                            count target
--   fs_cooking_checks      — gains session_id + menu_item_id (nullable —
--                            an off-menu/ad-hoc dish is still loggable
--                            by typing a name, same as before)
-- ============================================================

BEGIN;

-- ── fs_hold_stations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_hold_stations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name          text        NOT NULL,
  hold_type     text        NOT NULL CHECK (hold_type IN ('hot_hold', 'cold_hold')),
  target_temp_c numeric(5,1),
  min_temp_c    numeric(5,1),
  max_temp_c    numeric(5,1),
  location      text,
  notes         text,
  is_active     boolean     NOT NULL DEFAULT true,
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_hold_stations_venue
  ON fs_hold_stations (tenant_id, venue_id, is_active, sort_order);

ALTER TABLE fs_hold_stations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_hold_stations' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_hold_stations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fs_hold_stations_updated_at ON fs_hold_stations;
CREATE TRIGGER trg_fs_hold_stations_updated_at
  BEFORE UPDATE ON fs_hold_stations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── fs_hold_capture_times ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_hold_capture_times (
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

CREATE INDEX IF NOT EXISTS idx_fs_hold_capture_times_venue
  ON fs_hold_capture_times (tenant_id, venue_id, is_active, time_of_day);

ALTER TABLE fs_hold_capture_times ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_hold_capture_times' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_hold_capture_times
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fs_hold_capture_times_updated_at ON fs_hold_capture_times;
CREATE TRIGGER trg_fs_hold_capture_times_updated_at
  BEFORE UPDATE ON fs_hold_capture_times
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── fs_hold_checks restructure ───────────────────────────────
-- Pre-prod: no real check history to preserve. Clear the table rather
-- than bolting a nullable station_id onto old free-text rows.
-- `hold_type` also drops — same as fs_temp_logs never denormalising
-- fs_equipment.equipment_type, it's read via a join to fs_hold_stations
-- instead, so a station's type can never drift out of sync with its logs.
TRUNCATE fs_hold_checks;

ALTER TABLE fs_hold_checks
  DROP COLUMN item_name,
  DROP COLUMN hold_type,
  ADD COLUMN station_id uuid NOT NULL REFERENCES fs_hold_stations(id) ON DELETE CASCADE,
  ADD COLUMN capture_time_id uuid REFERENCES fs_hold_capture_times(id) ON DELETE SET NULL;

-- Slot-linked readings upsert (re-logging the same station/slot/day
-- corrects the existing row) — same pattern as fs_temp_logs. Ad-hoc
-- readings (capture_time_id NULL) always insert a new row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_hold_checks_unique_slot
  ON fs_hold_checks (station_id, check_date, capture_time_id)
  WHERE capture_time_id IS NOT NULL;

-- ── fs_cooking_sessions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_cooking_sessions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id              uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  label                 text        NOT NULL,
  time_of_day           time,
  required_items_count  int         NOT NULL DEFAULT 1 CHECK (required_items_count >= 1),
  sort_order            int         NOT NULL DEFAULT 0,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_cooking_sessions_venue
  ON fs_cooking_sessions (tenant_id, venue_id, is_active, sort_order);

ALTER TABLE fs_cooking_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_cooking_sessions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_cooking_sessions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fs_cooking_sessions_updated_at ON fs_cooking_sessions;
CREATE TRIGGER trg_fs_cooking_sessions_updated_at
  BEFORE UPDATE ON fs_cooking_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── fs_cooking_checks additions ───────────────────────────────
-- dish_name stays required — a durable compliance record must keep
-- showing what was checked even if the menu item is later renamed or
-- removed, so it's populated from the item's name at insert time
-- rather than looked up live via menu_item_id.
ALTER TABLE fs_cooking_checks
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES fs_cooking_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL;

COMMIT;
