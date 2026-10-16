-- 169_kitchen_flow.sql
-- Kitchen flow (Till setup > Kitchen screens > Kitchen flow). docs/POS.md
-- section 9.
--
--   kds_stations.kind   adds 'runner' (takes orders out) and 'board' (an
--                       order ready board: shows an order once every dish on
--                       its way there has arrived; nothing to bump)
--   kds_flow_edges      the links of the flow: from a station (NULL = Orders
--                       in: the till and online orders) to a station.
--                       targets: [] = every dish, else [{ kind: 'item' |
--                       'section' | 'revenue_centre' | 'order_type', id }].
--                       From each point a dish takes the links whose filter
--                       it matches most specifically (dish, section, revenue
--                       centre, order type, then links with no filter);
--                       itemRoute() in shared/pos/kitchen.js.
--   pos_settings.kds_flow_layout  where the designer draws each box:
--                       { [stationId | 'start']: { x, y } }
--
-- Replaces kds_routes: each station's routes become one link from Orders in
-- with those filters, and every prep station links on to every expo (the old
-- pass saw every dish). Kitchen orders are cleared (pre-production: their
-- dishes carry the old station lists, not a way through the flow).

BEGIN;

ALTER TABLE kds_stations DROP CONSTRAINT IF EXISTS kds_stations_kind_check;
ALTER TABLE kds_stations ADD CONSTRAINT kds_stations_kind_check CHECK (kind IN ('prep', 'expo', 'runner', 'board'));

CREATE TABLE kds_flow_edges (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id         uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  from_station_id  uuid        REFERENCES kds_stations(id) ON DELETE CASCADE,
  to_station_id    uuid        NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
  targets          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sort_order       int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_station_id IS DISTINCT FROM to_station_id)
);
CREATE UNIQUE INDEX kds_flow_edges_uq ON kds_flow_edges (venue_id, COALESCE(from_station_id, '00000000-0000-0000-0000-000000000000'::uuid), to_station_id);
CREATE INDEX kds_flow_edges_venue ON kds_flow_edges (venue_id, sort_order);

ALTER TABLE kds_flow_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kds_flow_edges USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS kds_flow_layout jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Each station's routes: one link from Orders in. Only a 'default' route
-- means no filter at all; next to others it stays as { kind: 'default' }
-- (any dish, at the lowest rank), so the dishes the other routes name still
-- rank the same as before.
INSERT INTO kds_flow_edges (tenant_id, venue_id, from_station_id, to_station_id, targets, sort_order)
SELECT r.tenant_id, r.venue_id, NULL, r.station_id,
       CASE WHEN bool_and(r.target_kind = 'default') THEN '[]'::jsonb
            ELSE jsonb_agg(CASE WHEN r.target_kind = 'default' THEN jsonb_build_object('kind', 'default')
                                ELSE jsonb_build_object('kind', r.target_kind, 'id', r.target_id) END
                           ORDER BY r.created_at)
       END,
       min(s.sort_order)
  FROM kds_routes r
  JOIN kds_stations s ON s.id = r.station_id
 GROUP BY r.tenant_id, r.venue_id, r.station_id;

-- Every prep station with a link in goes on to every expo of its venue.
INSERT INTO kds_flow_edges (tenant_id, venue_id, from_station_id, to_station_id, targets, sort_order)
SELECT p.tenant_id, p.venue_id, p.id, x.id, '[]'::jsonb, 100 + x.sort_order
  FROM kds_stations p
  JOIN kds_stations x ON x.venue_id = p.venue_id AND x.kind = 'expo' AND x.is_active
 WHERE p.kind = 'prep' AND p.is_active
   AND EXISTS (SELECT 1 FROM kds_flow_edges e WHERE e.to_station_id = p.id AND e.from_station_id IS NULL)
ON CONFLICT DO NOTHING;

DROP TABLE kds_routes;

DELETE FROM kds_orders;

COMMIT;
