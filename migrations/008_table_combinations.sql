-- 008_table_combinations.sql
-- Table combinations: push tables together for larger parties.
-- e.g. T1 (1-2) + T2 (1-2) = "T1+T2" for up to 4 covers.
--
-- Design decisions:
--   • booking_holds/bookings keep table_id NOT NULL for backward compat.
--     Combo holds/bookings use the first member table as the canonical table_id.
--     combination_id is stored as additional context.
--   • Slot availability query checks combo holds/bookings via tcm JOIN
--     so ALL member tables appear blocked when a combo is held/booked.

-- ── Table combinations ────────────────────────────────────────

CREATE TABLE table_combinations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  min_covers  int NOT NULL DEFAULT 1,
  max_covers  int NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE table_combination_members (
  combination_id  uuid NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id        uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  PRIMARY KEY (combination_id, table_id)
);

CREATE INDEX ON table_combinations(venue_id);
CREATE INDEX ON table_combination_members(combination_id);
CREATE INDEX ON table_combination_members(table_id);

ALTER TABLE table_combinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tc_tenant ON table_combinations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE table_combination_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcm_tenant ON table_combination_members
  USING (combination_id IN (
    SELECT id FROM table_combinations
     WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
  ));

-- ── Extend booking_holds / bookings with combination_id ───────

ALTER TABLE booking_holds
  ADD COLUMN combination_id uuid REFERENCES table_combinations(id) ON DELETE CASCADE;

ALTER TABLE bookings
  ADD COLUMN combination_id uuid REFERENCES table_combinations(id) ON DELETE SET NULL;

-- Update trigger for table_combinations
CREATE TRIGGER trg_table_combinations_updated_at
  BEFORE UPDATE ON table_combinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
