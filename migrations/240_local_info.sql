-- 240_local_info.sql
--
-- Local information per venue (8 Nov 2026): weather, traffic, events and
-- incidents around each location, captured on a schedule the operator picks
-- (once a day, every N hours, once a week) plus events typed in by hand.
--
-- local_info_sources: one row per venue per capture (kind + place + how
-- often). Weather reads Open-Meteo (keyless; the place geocoded once and
-- cached on the row until it changes). The other kinds run a web search
-- through Pepper's model (optionally narrowed to one site). The minute-ish
-- sweep in jobs/queues.js claims due rows with running_until.
--
-- local_info_items: what was captured, one row per thing per day(s), deduped
-- per source by external_key (shared/localInfo.js itemKey()), so re-running a
-- capture updates rather than repeats; `hidden` keeps a dismissed captured
-- item stored so the next capture doesn't bring it back (the same idea as
-- reviews' checked). A row with source_id NULL was typed in by hand; one with
-- venue_id NULL applies to every venue of the group.

BEGIN;

CREATE TABLE local_info_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('weather', 'traffic', 'events', 'incidents')),
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'hours', 'weekly')),
  every_hours int CHECK (every_hours BETWEEN 1 AND 24),
  place text NOT NULL DEFAULT '',
  site text,
  query text,
  lat double precision,
  lon double precision,
  geocoded_place text,
  next_run_at timestamptz,
  running_until timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX local_info_sources_venue ON local_info_sources (tenant_id, venue_id);
-- The sweep crosses tenants (system mode): due, enabled sources only.
CREATE INDEX local_info_sources_due ON local_info_sources (next_run_at) WHERE enabled;

CREATE TABLE local_info_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id uuid REFERENCES venues(id) ON DELETE CASCADE,
  source_id uuid REFERENCES local_info_sources(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('weather', 'traffic', 'events', 'incidents')),
  title text NOT NULL,
  details text,
  place text,
  url text,
  starts_on date NOT NULL,
  ends_on date,
  time_text text,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'notice', 'warning')),
  data jsonb,
  external_key text,
  hidden boolean NOT NULL DEFAULT false,
  created_by text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX local_info_items_days ON local_info_items (tenant_id, starts_on);
CREATE UNIQUE INDEX local_info_items_key ON local_info_items (source_id, external_key)
  WHERE source_id IS NOT NULL AND external_key IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['local_info_sources', 'local_info_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- The module switch for every existing tenant (new ones seed from MODULES).
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'local_info', true FROM tenants t
ON CONFLICT DO NOTHING;

-- The dashboard widget.
ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'allergen_lookup', 'local_info',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles',
    'cash_week_expenses', 'cash_week_summary_grid', 'cash_week_staff',
    'cash_tips_payout', 'cash_import',
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips'
  ));

-- The link in the main menu, after Today (every tenant's menu; skipped where
-- it is already there or Today isn't).
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Local info', 'CloudSun', '/local-info', 'local_info', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/today'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/local-info');

UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/today' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order AND n.route IS DISTINCT FROM '/local-info';

COMMIT;
