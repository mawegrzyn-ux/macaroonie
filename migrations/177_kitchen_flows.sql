-- ============================================================
-- 177_kitchen_flows.sql
-- Several kitchen flows per venue, one in use at a time (Till setup >
-- Kitchen screens > Kitchen flows), switched from the admin or from a
-- kitchen screen's top bar. docs/POS.md section 9.
--
--   kds_flows                 a named flow: its links (kds_flow_edges) and
--                             where the designer draws each box (layout,
--                             was pos_settings.kds_flow_layout). Names are
--                             unique per venue (the kitchen screen lists
--                             them by name).
--   kds_flow_edges.flow_id    the flow a link belongs to; one link per pair
--                             of boxes per flow
--   pos_settings
--     kds_active_flow_id      the flow dishes follow when they are sent. A
--                             dish keeps the way it got (item.route), so a
--                             switch counts for dishes sent after it. NULL
--                             (or a flow that is gone) = the venue's first
--                             flow.
--     kds_flow_switched_at /  the last switch, and who made it (a kitchen
--     kds_flow_switched_by    screen's name or a person's email)
--
-- Each venue with a kitchen station or a link gets one flow, "Main flow",
-- holding its links and layout, in use.
-- ============================================================

BEGIN;

CREATE TABLE kds_flows (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  layout      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kds_flows_venue ON kds_flows (venue_id, sort_order);
CREATE UNIQUE INDEX kds_flows_name ON kds_flows (venue_id, lower(btrim(name)));

-- As every tenant table since migration 176: forced, with system mode.
ALTER TABLE kds_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_flows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kds_flows
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

INSERT INTO kds_flows (tenant_id, venue_id, name, layout)
SELECT v.tenant_id, v.id, 'Main flow', COALESCE(ps.kds_flow_layout, '{}'::jsonb)
  FROM venues v
  LEFT JOIN pos_settings ps ON ps.venue_id = v.id
 WHERE EXISTS (SELECT 1 FROM kds_stations s WHERE s.venue_id = v.id)
    OR EXISTS (SELECT 1 FROM kds_flow_edges e WHERE e.venue_id = v.id);

ALTER TABLE kds_flow_edges ADD COLUMN flow_id uuid REFERENCES kds_flows(id) ON DELETE CASCADE;
UPDATE kds_flow_edges e SET flow_id = f.id FROM kds_flows f WHERE f.venue_id = e.venue_id;
DELETE FROM kds_flow_edges WHERE flow_id IS NULL;
ALTER TABLE kds_flow_edges ALTER COLUMN flow_id SET NOT NULL;

DROP INDEX kds_flow_edges_uq;
CREATE UNIQUE INDEX kds_flow_edges_uq ON kds_flow_edges (flow_id, COALESCE(from_station_id, '00000000-0000-0000-0000-000000000000'::uuid), to_station_id);
DROP INDEX kds_flow_edges_venue;
CREATE INDEX kds_flow_edges_flow ON kds_flow_edges (flow_id, sort_order);

ALTER TABLE pos_settings
  ADD COLUMN kds_active_flow_id   uuid REFERENCES kds_flows(id) ON DELETE SET NULL,
  ADD COLUMN kds_flow_switched_at timestamptz,
  ADD COLUMN kds_flow_switched_by text;
UPDATE pos_settings ps SET kds_active_flow_id = f.id FROM kds_flows f WHERE f.venue_id = ps.venue_id;
ALTER TABLE pos_settings DROP COLUMN kds_flow_layout;

COMMIT;
