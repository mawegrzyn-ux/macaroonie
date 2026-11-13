-- 243_reports.sql
--
-- The report builder, phases 0 and 1 (docs/REPORTS.md, 12 Nov 2026).
--
-- reports        a saved report: its definition (spec, checked by
--                shared/reports/spec.js normaliseReport()), who owns it and
--                who it is shared with. Reports run as the person looking at
--                them, so nothing here says what data anyone may see.
-- report_stars   a person's starred reports (saved ones by id, starter
--                reports by their key in code).
-- report_runs    every run and export: who, which report, with what, how
--                many rows, how long, and any error.
--
-- The till keeps three more breakdowns per check, written by saveCheck()
-- from the same checkTotals() the till's own figures use (never worked out
-- again in SQL): the discounts on a check, its charges and its VAT by rate.
-- pos_checks.proj_v says which checks have them (the API fills in older
-- checks at start, backfillCheckProjections()). A cancelled order's reason,
-- value and who cancelled it, a void's time and approver, and a refund's
-- approver become columns too, so reports need not read the check's JSON.
--
-- The Reports module (View: open and run shared reports; Use: build, save
-- and export; Manage: share with roles, starter reports for the group) and
-- its link in the main menu, after Dashboards.

-- ── Saved reports ─────────────────────────────────────────────

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text,
  -- The subject the definition is about (spec.subject), kept beside it so a
  -- list can leave out reports on data the person may not see.
  subject text NOT NULL,
  spec jsonb NOT NULL,
  owner_sub text NOT NULL,
  owner_email text,
  shared text NOT NULL DEFAULT 'private' CHECK (shared IN ('private', 'roles', 'everyone')),
  shared_role_ids uuid[] NOT NULL DEFAULT '{}',
  -- A report the group offers its own team as a starting point.
  is_starter boolean NOT NULL DEFAULT false,
  -- The starter report (in code) this one was copied from, if any.
  starter_key text,
  tags text[] NOT NULL DEFAULT '{}',
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_tenant ON reports (tenant_id, updated_at DESC);
CREATE INDEX reports_owner ON reports (tenant_id, owner_sub);

CREATE TABLE report_stars (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub text NOT NULL,
  -- A saved report's id, or 'starter:<key>'.
  report_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_sub, report_ref)
);

CREATE TABLE report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
  starter_key text,
  report_name text,
  subject text,
  -- run: a saved or starter report run on its page; export: a file (of a
  -- saved report, a starter, or a definition not saved yet: no report_id).
  -- The builder's own previews aren't recorded.
  kind text NOT NULL CHECK (kind IN ('run', 'export')),
  format text,
  user_sub text NOT NULL,
  user_email text,
  params jsonb NOT NULL DEFAULT '{}',
  row_count integer,
  ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_runs_tenant ON report_runs (tenant_id, created_at DESC);
CREATE INDEX report_runs_report ON report_runs (report_id, created_at DESC) WHERE report_id IS NOT NULL;

-- ── The till's breakdowns per check ───────────────────────────

ALTER TABLE pos_checks
  ADD COLUMN IF NOT EXISTS proj_v integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancel_value integer,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_approved_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_day_id uuid;
CREATE INDEX IF NOT EXISTS pos_checks_cancel_day ON pos_checks (cancel_day_id) WHERE cancel_day_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_checks_unprojected ON pos_checks (venue_id) WHERE proj_v < 1;

ALTER TABLE pos_check_lines
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_approved_by uuid,
  ADD COLUMN IF NOT EXISTS void_waste boolean;
CREATE INDEX IF NOT EXISTS pos_check_lines_void_day ON pos_check_lines (void_day_id) WHERE void_day_id IS NOT NULL;

ALTER TABLE pos_payments
  ADD COLUMN IF NOT EXISTS approved_by uuid;

CREATE TABLE pos_check_discounts (
  check_id text NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  -- The check's trading day (the till counts a discount with its check).
  day_id uuid,
  -- discount | comp | promotion | combo (an automatic meal deal) | reward (loyalty)
  kind text NOT NULL CHECK (kind IN ('discount', 'comp', 'promotion', 'combo', 'reward')),
  name text NOT NULL,
  scope text NOT NULL,
  amount integer NOT NULL,
  reason text,
  applied_by uuid,
  approved_by uuid,
  applied_at timestamptz,
  PRIMARY KEY (check_id, idx)
);
CREATE INDEX pos_check_discounts_day ON pos_check_discounts (day_id);

CREATE TABLE pos_check_charges (
  check_id text NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_id uuid,
  name text NOT NULL,
  kind text NOT NULL,
  optional boolean NOT NULL DEFAULT false,
  -- What it came to on the check (0 when taken off, or waiting for more guests).
  amount integer NOT NULL,
  -- What it would come to.
  would_be integer NOT NULL,
  removed boolean NOT NULL DEFAULT false,
  waiting boolean NOT NULL DEFAULT false,
  vat_rate numeric NOT NULL DEFAULT 0,
  remove_reason text,
  removed_by uuid,
  approved_by uuid,
  PRIMARY KEY (check_id, idx)
);
CREATE INDEX pos_check_charges_day ON pos_check_charges (day_id);

CREATE TABLE pos_check_vat (
  check_id text NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  rate numeric NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day_id uuid,
  net integer NOT NULL,
  vat integer NOT NULL,
  gross integer NOT NULL,
  PRIMARY KEY (check_id, rate)
);
CREATE INDEX pos_check_vat_day ON pos_check_vat (day_id);

-- ── Row-level security, forced, like every tenant table ───────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reports', 'report_stars', 'report_runs',
                           'pos_check_discounts', 'pos_check_charges', 'pos_check_vat'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- ── The module, and its link in the main menu ─────────────────

INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'reports', true FROM tenants t
ON CONFLICT DO NOTHING;

-- After Dashboards in every group's menu (after Overview where Dashboards
-- was taken out); skipped where the link is already there. Nobody is hidden
-- from it to begin with: the module decides who sees it.
WITH anchors AS (
  SELECT DISTINCT ON (n.tenant_id) n.tenant_id, n.parent_id, n.sort_order
    FROM nav_items n
   WHERE n.route IN ('/dashboards', '/')
   ORDER BY n.tenant_id, (n.route = '/dashboards') DESC, n.sort_order
), bumped AS (
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM anchors a
   WHERE n.tenant_id = a.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM a.parent_id
     AND n.sort_order > a.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/reports')
  RETURNING 1
)
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT a.tenant_id, a.parent_id, 'link', 'Reports', 'FileBarChart', '/reports', 'reports', a.sort_order + 1, '{}'::uuid[], false
  FROM anchors a
 WHERE NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = a.tenant_id AND x.route = '/reports');
