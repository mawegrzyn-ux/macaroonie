-- ============================================================
-- 093_dashboard_tiles.sql
--
-- Turns the Dashboard (renamed "Overview") into a tile-based layout —
-- same layout-control pattern as hs_dashboard_widgets (col_span,
-- height_px, sort_order) but simpler: one implicit layout per tenant
-- (no multiple named dashboards, since Overview is tenant-wide, not
-- per-venue), plus per-role visibility on each tile via hidden_role_ids
-- (same convention as nav_items).
--
-- The four tiles that already existed as fixed page sections (quick
-- access shortcuts, today's stats, upcoming bookings, venues status)
-- become the default tile set for every existing tenant, in their
-- current visual order, so nobody's Overview page changes shape on
-- deploy. Two new tile types ship disabled-by-default (not seeded) —
-- an admin adds them via "Customise" if they want them:
--   hs_today_status — combined Checklists + Food safety status for today
--   hs_week_status  — same, as a Mon-Sun 7-day strip
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_tiles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tile_type        text        NOT NULL CHECK (tile_type IN (
                      'quick_access', 'stats_today', 'upcoming_bookings',
                      'venues_status', 'hs_today_status', 'hs_week_status'
                    )),
  title_override   text,
  hidden_role_ids  uuid[]      NOT NULL DEFAULT '{}',
  col_span         int         NOT NULL DEFAULT 2,
  height_px        int         NOT NULL DEFAULT 320,
  sort_order       int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_tiles_tenant
  ON dashboard_tiles (tenant_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_tiles_tenant_type
  ON dashboard_tiles (tenant_id, tile_type);

ALTER TABLE dashboard_tiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dashboard_tiles' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON dashboard_tiles
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_dashboard_tiles_updated_at ON dashboard_tiles;
CREATE TRIGGER trg_dashboard_tiles_updated_at
  BEFORE UPDATE ON dashboard_tiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Seed the existing fixed layout as tiles, for every tenant that
--    doesn't already have any (idempotent) ─────────────────────
INSERT INTO dashboard_tiles (tenant_id, tile_type, col_span, height_px, sort_order)
SELECT t.id, v.tile_type, v.col_span, v.height_px, v.sort_order
  FROM tenants t
 CROSS JOIN (VALUES
    ('quick_access',       4, 200, 0),
    ('stats_today',        4, 180, 1),
    ('upcoming_bookings',  2, 420, 2),
    ('venues_status',      2, 280, 3)
 ) AS v(tile_type, col_span, height_px, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM dashboard_tiles WHERE tenant_id = t.id)
ON CONFLICT DO NOTHING;

-- ── Rename "Dashboard" to "Overview" everywhere it's the home nav item ──
UPDATE nav_items SET label = 'Overview' WHERE label = 'Dashboard' AND route = '/';

COMMIT;
