-- ============================================================
-- 086_hs_dashboards.sql
--
-- Customisable Health & Safety dashboards, per venue. An operator can
-- build any number of named dashboards (shown as tabs), each holding
-- any number of widgets — either a checklist tick-list (pointing at
-- an existing checklist_templates row) or the equipment temperature
-- grid. A single date navigator on the dashboard page drives every
-- widget on the active dashboard at once; the widgets themselves
-- reuse the exact same data/tick/save logic as the Checklists and
-- Food safety pages (see admin/src/components/{checklists,foodSafety}/shared.jsx).
--
-- Model:
--   hs_dashboards         — one dashboard (a tab), per venue
--   hs_dashboard_widgets  — the ordered widgets on a dashboard
--
-- A 'checklist' widget always points at a checklist_template_id (the
-- template it embeds); a 'temp_checks' widget has none — it always
-- renders the venue's whole equipment x capture-time grid, since
-- that's venue-wide, not per-template.
-- ============================================================

BEGIN;

-- ── hs_dashboards ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hs_dashboards (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hs_dashboards_venue
  ON hs_dashboards (tenant_id, venue_id, is_active, sort_order);

ALTER TABLE hs_dashboards ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'hs_dashboards' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON hs_dashboards
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_hs_dashboards_updated_at ON hs_dashboards;
CREATE TRIGGER trg_hs_dashboards_updated_at
  BEFORE UPDATE ON hs_dashboards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── hs_dashboard_widgets ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS hs_dashboard_widgets (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  dashboard_id           uuid        NOT NULL REFERENCES hs_dashboards(id) ON DELETE CASCADE,
  widget_type            text        NOT NULL CHECK (widget_type IN ('checklist', 'temp_checks')),
  checklist_template_id  uuid        REFERENCES checklist_templates(id) ON DELETE CASCADE,
  title_override         text,
  is_active              boolean     NOT NULL DEFAULT true,
  sort_order             int         NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (widget_type = 'checklist'   AND checklist_template_id IS NOT NULL) OR
    (widget_type = 'temp_checks' AND checklist_template_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hs_dashboard_widgets_dashboard
  ON hs_dashboard_widgets (dashboard_id, is_active, sort_order);

ALTER TABLE hs_dashboard_widgets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'hs_dashboard_widgets' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON hs_dashboard_widgets
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_hs_dashboard_widgets_updated_at ON hs_dashboard_widgets;
CREATE TRIGGER trg_hs_dashboard_widgets_updated_at
  BEFORE UPDATE ON hs_dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Register module for all existing tenants ─────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'hs_dashboard', true
  FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('hs_dashboard',
                          CASE key
                            WHEN 'owner'    THEN 'manage'
                            WHEN 'admin'    THEN 'manage'
                            WHEN 'operator' THEN 'manage'
                            ELSE 'view'
                          END)
 WHERE is_builtin = true
   AND NOT (permissions ? 'hs_dashboard');

COMMIT;
