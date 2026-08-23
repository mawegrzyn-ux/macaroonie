-- ============================================================
-- 076_food_safety_logs.sql
--
-- SFBB-style food safety temperature & delivery logs (per venue).
-- Phase 1: equipment list + daily temp logs + delivery checks +
-- hot/cold hold checks + cooking checks.
-- Checklists (opening/closing etc.) follow in a later migration.
--
-- SFBB / FSA reference targets (England, Wales, NI):
--   Fridge:    legal ≤ 8°C, best-practice target ≤ 5°C
--   Freezer:   ≤ −18°C
--   Hot hold:  ≥ 63°C
--   Cooking:   core 75°C for 30 seconds (or FSA equivalents)
--
-- Tables are tenant-scoped via RLS (app.tenant_id).
-- ============================================================

BEGIN;

-- ── fs_equipment ─────────────────────────────────────────────
-- User-defined list of fridges, freezers, hot-hold units, etc.
CREATE TABLE IF NOT EXISTS fs_equipment (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name          text        NOT NULL,
  equipment_type text       NOT NULL DEFAULT 'fridge'
                            CHECK (equipment_type IN (
                              'fridge', 'freezer', 'hot_hold', 'cold_hold', 'other'
                            )),
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

CREATE INDEX IF NOT EXISTS idx_fs_equipment_venue
  ON fs_equipment (tenant_id, venue_id, is_active);

ALTER TABLE fs_equipment ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_equipment' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_equipment
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_fs_equipment_updated_at ON fs_equipment;
CREATE TRIGGER trg_fs_equipment_updated_at
  BEFORE UPDATE ON fs_equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── fs_temp_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_temp_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  equipment_id      uuid        NOT NULL REFERENCES fs_equipment(id) ON DELETE CASCADE,
  log_date          date        NOT NULL DEFAULT CURRENT_DATE,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  temperature_c     numeric(5,1) NOT NULL,
  is_within_range   boolean,
  corrective_action text,
  notes             text,
  recorded_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_temp_logs_venue_date
  ON fs_temp_logs (tenant_id, venue_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_fs_temp_logs_equipment
  ON fs_temp_logs (equipment_id, log_date DESC);

ALTER TABLE fs_temp_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_temp_logs' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_temp_logs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ── fs_delivery_checks ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_delivery_checks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  delivery_date     date        NOT NULL DEFAULT CURRENT_DATE,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  vendor_name       text        NOT NULL,
  packaging_ok      boolean     NOT NULL DEFAULT true,
  damage_ok         boolean     NOT NULL DEFAULT true,
  quality_ok        boolean     NOT NULL DEFAULT true,
  temp_ok           boolean     NOT NULL DEFAULT true,
  product_temp_c    numeric(5,1),
  items             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  accepted          boolean     NOT NULL DEFAULT true,
  corrective_action text,
  notes             text,
  recorded_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_delivery_checks_venue_date
  ON fs_delivery_checks (tenant_id, venue_id, delivery_date DESC);

ALTER TABLE fs_delivery_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_delivery_checks' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_delivery_checks
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ── fs_hold_checks ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_hold_checks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  check_date        date        NOT NULL DEFAULT CURRENT_DATE,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  hold_type         text        NOT NULL
                            CHECK (hold_type IN ('hot_hold', 'cold_hold')),
  item_name         text        NOT NULL,
  temperature_c     numeric(5,1) NOT NULL,
  is_within_range   boolean,
  corrective_action text,
  notes             text,
  recorded_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_hold_checks_venue_date
  ON fs_hold_checks (tenant_id, venue_id, check_date DESC);

ALTER TABLE fs_hold_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_hold_checks' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_hold_checks
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ── fs_cooking_checks ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_cooking_checks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  check_date        date        NOT NULL DEFAULT CURRENT_DATE,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  dish_name         text        NOT NULL,
  core_temp_c       numeric(5,1) NOT NULL,
  hold_seconds      int,
  is_within_range   boolean,
  corrective_action text,
  notes             text,
  recorded_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_cooking_checks_venue_date
  ON fs_cooking_checks (tenant_id, venue_id, check_date DESC);

ALTER TABLE fs_cooking_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'fs_cooking_checks' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON fs_cooking_checks
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ── Register module for all existing tenants ─────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'food_safety', true
  FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('food_safety',
                          CASE key
                            WHEN 'owner'    THEN 'manage'
                            WHEN 'admin'    THEN 'manage'
                            WHEN 'operator' THEN 'manage'
                            ELSE 'view'
                          END)
 WHERE is_builtin = true
   AND NOT (permissions ? 'food_safety');

COMMIT;
