-- 208_kiosk_journeys.sql
--
-- Kiosk journeys: each guest's visit to a self-order kiosk, recorded on the
-- kiosk as it happened (pos/src/kiosk/journey.js), sent with
-- POST /pos-api/kiosk/journeys and summed up on arrival
-- (shared/kioskJourney.js summariseJourney()). Kiosk analytics (Money in the main menu)
-- reports on them (routes/kioskAnalytics.js) and plays one back on the
-- kiosk mock-up.
--
--   kiosk_sessions   one row per visit, its id made on the kiosk (a ULID, so
--                    a visit sent twice is stored once). The columns the
--                    report filters and sums on, the whole summary (summary),
--                    the names of what the visit touched (names: dishes,
--                    sections, order types, tags, in the menu's language)
--                    and the visit itself (events). events is cleared after
--                    90 days (events_cleared_at): the summary stays for the
--                    report, the playback goes. Rows go after 400 days.
--
-- No personal data: nothing a guest types is recorded (a name or tent number
-- only as its length, a touch on the keyboard at the keyboard's middle).
--
-- The design can switch recording off (kiosk_designs.settings
-- behaviour.record_journeys, shared/kiosk.js normaliseDesign(); no column).

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id                  text NOT NULL CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  venue_id            uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  device_id           uuid REFERENCES pos_devices(id) ON DELETE SET NULL,
  design_id           uuid REFERENCES kiosk_designs(id) ON DELETE SET NULL,
  revenue_stream_id   uuid REFERENCES pos_revenue_streams(id) ON DELETE SET NULL,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz NOT NULL,
  duration_ms         integer NOT NULL DEFAULT 0,
  outcome             text NOT NULL CHECK (outcome IN ('ordered', 'started_again', 'timed_out', 'left', 'interrupted')),
  furthest            text NOT NULL DEFAULT 'start',
  last_screen         text,
  order_no            text,
  check_id            text,
  total_pence         integer,
  basket_value_pence  integer NOT NULL DEFAULT 0,
  items_added         integer NOT NULL DEFAULT 0,
  taps                integer NOT NULL DEFAULT 0,
  dead_taps           integer NOT NULL DEFAULT 0,
  lang                text,
  event_count         integer NOT NULL DEFAULT 0,
  truncated           boolean NOT NULL DEFAULT false,
  summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
  names               jsonb NOT NULL DEFAULT '{}'::jsonb,
  viewport            jsonb,
  config_version      text,
  app_version         text,
  events              jsonb,
  events_cleared_at   timestamptz,
  received_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS kiosk_sessions_venue_started ON kiosk_sessions (tenant_id, venue_id, started_at DESC);
CREATE INDEX IF NOT EXISTS kiosk_sessions_device_started ON kiosk_sessions (tenant_id, device_id, started_at DESC);

ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kiosk_sessions;
CREATE POLICY tenant_isolation ON kiosk_sessions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- The report's link in the main menu, beside Till reports (every tenant's
-- menu; skipped where it is already there or Till reports isn't).
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Kiosk analytics', 'Activity', '/pos/kiosk-analytics', 'pos_reports', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/pos/reports'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/kiosk-analytics');

-- Make room after Till reports in each of those lists.
UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/pos/reports' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order AND n.route IS DISTINCT FROM '/pos/kiosk-analytics';
