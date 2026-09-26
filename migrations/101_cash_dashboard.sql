-- ============================================================
-- 101_cash_dashboard.sql
--
-- Cash Recon Dashboard. Reuses the H&S dashboard tables rather than
-- duplicating them: hs_dashboards gains a `kind` ('hs' | 'cash'), and
-- the API mounts the same routes twice (/api/hs-dashboards filters to
-- kind = 'hs', /api/cash-dashboards to kind = 'cash'), each gated by its
-- own module.
--
-- New widget types (cash dashboards only, enforced in the API):
--   cash_wages_paid   week's wage entries with a Paid checkbox
--   cash_petty_cash   the selected day's petty cash expenses
--   cash_recon_grid   the week reconciliation grid (editable)
--   cash_week_balance week totals down to Cash to bank
--   cash_day_balance  the selected day's totals
--   cash_day_tiles    one tile per day of the week
--
-- New module `cash_dashboard`, in the existing cash_recon group (so the
-- tenant's Cash reconciliation switch covers it). Permissions default
-- the same as cash_recon.
-- ============================================================

BEGIN;

ALTER TABLE hs_dashboards
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'hs';

ALTER TABLE hs_dashboards
  DROP CONSTRAINT IF EXISTS hs_dashboards_kind_check;
ALTER TABLE hs_dashboards
  ADD CONSTRAINT hs_dashboards_kind_check CHECK (kind IN ('hs', 'cash'));

DROP INDEX IF EXISTS idx_hs_dashboards_venue;
CREATE INDEX IF NOT EXISTS idx_hs_dashboards_venue
  ON hs_dashboards (tenant_id, venue_id, kind, is_active, sort_order);

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles'
  ));

-- ── Module switch + role permissions ─────────────────────────
-- Follow each tenant's existing cash_recon switch so turning the new
-- module on never exposes it where Cash reconciliation is disabled.
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'cash_dashboard',
       COALESCE((SELECT m.is_enabled FROM tenant_modules m
                  WHERE m.tenant_id = t.id AND m.module_key = 'cash_recon'), true)
  FROM tenants t
ON CONFLICT (tenant_id, module_key) DO NOTHING;

UPDATE tenant_roles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('cash_dashboard',
                          COALESCE(permissions ->> 'cash_recon',
                                   CASE key WHEN 'viewer' THEN 'none' ELSE 'manage' END))
 WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'cash_dashboard');

-- ── Nav link, right after Cash recon, for existing tenants ───
DO $$
DECLARE
  t         record;
  cr_id     uuid;
  cr_parent uuid;
  cr_sort   int;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/cash-dashboard') THEN
      CONTINUE;
    END IF;

    cr_id := NULL;
    SELECT id, parent_id, sort_order INTO cr_id, cr_parent, cr_sort FROM nav_items
     WHERE tenant_id = t.id AND route = '/cash-recon'
     ORDER BY sort_order LIMIT 1;

    IF cr_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE nav_items
       SET sort_order = sort_order + 1
     WHERE tenant_id = t.id
       AND parent_id IS NOT DISTINCT FROM cr_parent
       AND sort_order > cr_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, cr_parent, 'link', 'Cash dashboard', 'LayoutGrid', '/cash-dashboard', 'cash_dashboard', cr_sort + 1);
  END LOOP;
END $$;

COMMIT;
