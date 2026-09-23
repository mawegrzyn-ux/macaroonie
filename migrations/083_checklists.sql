-- ============================================================
-- 083_checklists.sql
--
-- Recurring operational checklists (opening/closing/cleaning etc.),
-- per venue, with a fully operator-defined item list and frequency.
--
-- Model:
--   checklist_templates       — one checklist definition (name,
--                                department label, frequency)
--   checklist_template_items  — the ordered list of tasks on it
--   checklist_instances       — one occurrence of a template for a
--                                given period (a day / a week / a
--                                month), with overall completion
--   checklist_instance_items  — the per-task tick state for that
--                                occurrence
--
-- Frequency and periods:
--   'daily'   → period_start is the calendar date itself
--   'weekly'  → period_start is the Monday of that ISO week
--   'monthly' → period_start is the 1st of that month
-- `due_day_of_week` / `due_day_of_month` are advisory only (which
-- day within the period the task is ideally done) — they do not
-- affect how instances are keyed, so there's no Feb-29th-style edge
-- case to reason about.
--
-- checklist_instances is unique per (template_id, period_start), so
-- re-opening the same day/week/month's checklist always resumes the
-- same instance rather than creating a duplicate.
-- ============================================================

BEGIN;

-- ── checklist_templates ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id         uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name             text        NOT NULL,
  department       text,
  frequency        text        NOT NULL DEFAULT 'daily'
                               CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  due_day_of_week  smallint    CHECK (due_day_of_week BETWEEN 0 AND 6),
  due_day_of_month smallint    CHECK (due_day_of_month BETWEEN 1 AND 28),
  is_active        boolean     NOT NULL DEFAULT true,
  sort_order       int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_templates_venue
  ON checklist_templates (tenant_id, venue_id, is_active, sort_order);

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'checklist_templates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON checklist_templates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_checklist_templates_updated_at ON checklist_templates;
CREATE TRIGGER trg_checklist_templates_updated_at
  BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── checklist_template_items ─────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_template_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id uuid        NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template
  ON checklist_template_items (template_id, is_active, sort_order);

ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'checklist_template_items' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON checklist_template_items
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_checklist_template_items_updated_at ON checklist_template_items;
CREATE TRIGGER trg_checklist_template_items_updated_at
  BEFORE UPDATE ON checklist_template_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── checklist_instances ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_instances (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  template_id   uuid        NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  period_start  date        NOT NULL,
  status        text        NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'completed')),
  notes         text,
  completed_by  text,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_checklist_instances_venue_period
  ON checklist_instances (tenant_id, venue_id, period_start DESC);

ALTER TABLE checklist_instances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'checklist_instances' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON checklist_instances
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_checklist_instances_updated_at ON checklist_instances;
CREATE TRIGGER trg_checklist_instances_updated_at
  BEFORE UPDATE ON checklist_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── checklist_instance_items ──────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_instance_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id       uuid        NOT NULL REFERENCES checklist_instances(id)      ON DELETE CASCADE,
  template_item_id  uuid        NOT NULL REFERENCES checklist_template_items(id) ON DELETE CASCADE,
  is_checked        boolean     NOT NULL DEFAULT false,
  notes             text,
  UNIQUE (instance_id, template_item_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_instance_items_instance
  ON checklist_instance_items (instance_id);

ALTER TABLE checklist_instance_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'checklist_instance_items' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON checklist_instance_items
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ── Register module for all existing tenants ─────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'checklists', true
  FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('checklists',
                          CASE key
                            WHEN 'owner'    THEN 'manage'
                            WHEN 'admin'    THEN 'manage'
                            WHEN 'operator' THEN 'manage'
                            ELSE 'view'
                          END)
 WHERE is_builtin = true
   AND NOT (permissions ? 'checklists');

COMMIT;
