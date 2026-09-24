-- ============================================================
-- 092_hs_action_log.sql
--
-- H&S Action Log — a general facilities/compliance to-do list per venue
-- (repairs, records, training, cleaning tasks), migrated from the
-- "ActionLog" tab of the legacy spreadsheet. Columns map 1:1 onto the
-- spreadsheet: Date, Category, Task, Details, Assigned To, Due Date,
-- Priority, Completed, Notes, Attachments — plus completed_by/completed_at
-- audit fields (same convention as checklist_instances) and an
-- attachment_media_id FK into the existing media library rather than a
-- bespoke upload path.
--
-- hs_action_categories mirrors fs_hold_stations / fs_equipment: a small
-- tenant-managed, reorderable named list (soft-deleted via is_active) —
-- not a fixed enum — seeded from the spreadsheet's ActionCategories tab
-- (Repairs, Records, Training, Cleaning) for every existing tenant.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS hs_action_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hs_action_categories_tenant
  ON hs_action_categories (tenant_id, is_active, sort_order);

ALTER TABLE hs_action_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'hs_action_categories' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON hs_action_categories
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_hs_action_categories_updated_at ON hs_action_categories;
CREATE TRIGGER trg_hs_action_categories_updated_at
  BEFORE UPDATE ON hs_action_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS hs_action_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id            uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  category_id         uuid        REFERENCES hs_action_categories(id) ON DELETE SET NULL,
  logged_date         date        NOT NULL DEFAULT CURRENT_DATE,
  task                text        NOT NULL,
  details             text,
  assigned_to         text,
  due_date            date,
  priority            text        NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  is_completed        boolean     NOT NULL DEFAULT false,
  completed_by        text,
  completed_at        timestamptz,
  notes               text,
  attachment_media_id uuid        REFERENCES media_items(id) ON DELETE SET NULL,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hs_action_log_venue
  ON hs_action_log (tenant_id, venue_id, is_completed, logged_date);

ALTER TABLE hs_action_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'hs_action_log' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON hs_action_log
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_hs_action_log_updated_at ON hs_action_log;
CREATE TRIGGER trg_hs_action_log_updated_at
  BEFORE UPDATE ON hs_action_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── H&S Dashboard: allow an action_log widget ──────────────────
ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log'));

-- ── Register module + default role permissions ─────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'hs_action_log', true FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('hs_action_log',
                          CASE key WHEN 'viewer' THEN 'view' ELSE 'manage' END)
 WHERE is_builtin = true
   AND NOT (permissions ? 'hs_action_log');

-- ── Seed default categories for every existing tenant ───────────
INSERT INTO hs_action_categories (tenant_id, name, sort_order)
SELECT t.id, c.name, c.sort_order
  FROM tenants t
 CROSS JOIN (VALUES ('Repairs', 0), ('Records', 1), ('Training', 2), ('Cleaning', 3)) AS c(name, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM hs_action_categories WHERE tenant_id = t.id)
ON CONFLICT DO NOTHING;

-- ── Seed a nav_items link for every existing tenant that doesn't already
--    have one (new tenants pick it up via defaultNav.js; this covers
--    tenants seeded before this migration ran) ───────────────────
DO $$
DECLARE
  t record;
  svc_id uuid;
  max_sort int;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (
      SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/hs-action-log'
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO svc_id FROM nav_items
     WHERE tenant_id = t.id AND kind = 'section' AND label = 'Service'
     ORDER BY sort_order LIMIT 1;

    IF svc_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(sort_order), -1) INTO max_sort
      FROM nav_items WHERE tenant_id = t.id AND parent_id = svc_id;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, svc_id, 'link', 'Action log', 'ClipboardCheck', '/hs-action-log', 'hs_action_log', max_sort + 1);
  END LOOP;
END $$;

COMMIT;
