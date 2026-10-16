-- 168_kitchen_screens.sql
-- Kitchen screens (KDS). docs/POS.md section 9.
--
--   kds_stations       a venue's kitchen stations. kind 'prep' (grill, fryer,
--                      bar ...) shows the dishes routed to it; 'expo' (the
--                      pass) shows whole orders and marks them ready.
--                      settings: { target_mins, late_mins, show_held,
--                      summary_groups: [{ id, name, members: [{ kind: 'dish'
--                      | 'option', id?, label, qty }] }] }
--   kds_routes         what goes to which prep station: dish, else its menu
--                      section, else its revenue centre, else 'default'
--                      (same order as pos_print_routes; routeFor() in
--                      shared/pos/printing.js)
--   kds_orders         a projection, like pos_checks: one row per order in
--                      the kitchen (a till check: id = check id; an online
--                      order: id = 'web-' || orders.id). state = the order
--                      as shared/pos/kitchen.js keeps it. Written only by the
--                      sequencer, from till events and kitchen events in
--                      pos_events.
--   kds_log            speed of service: one row per bump (seconds from the
--                      dishes going live to the bump), recall and remake
--   pos_devices.kind   'kds' = a kitchen screen (paired like a till; it runs
--                      the same app at pos.<domain> and opens the kitchen
--                      screen). settings: { station_ids, view, columns,
--                      text_size, sound }
--   pos_settings.kds_* what happens to online orders in the kitchen

BEGIN;

CREATE TABLE kds_stations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  kind        text        NOT NULL DEFAULT 'prep' CHECK (kind IN ('prep', 'expo')),
  colour      text,
  settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kds_stations_venue ON kds_stations (venue_id, sort_order);

-- target_id: a dish / section / revenue centre id (NULL for 'default').
-- No foreign key: dishes and sections are re-inserted by menu saves.
CREATE TABLE kds_routes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  station_id   uuid        NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
  target_kind  text        NOT NULL CHECK (target_kind IN ('item', 'section', 'revenue_centre', 'default')),
  target_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind = 'default') = (target_id IS NULL))
);
CREATE UNIQUE INDEX kds_routes_uq ON kds_routes (venue_id, station_id, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE kds_orders (
  id            text        PRIMARY KEY,
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  source        text        NOT NULL CHECK (source IN ('till', 'online')),
  check_id      text,
  order_id      uuid,
  status        text        NOT NULL,
  created_at    timestamptz,
  ready_at      timestamptz,
  collected_at  timestamptz,
  state         jsonb       NOT NULL,
  last_seq      bigint      NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kds_orders_venue_status ON kds_orders (venue_id, status);
CREATE INDEX kds_orders_venue_seq ON kds_orders (venue_id, last_seq);
CREATE INDEX kds_orders_venue_created ON kds_orders (venue_id, created_at DESC);
CREATE INDEX kds_orders_order ON kds_orders (order_id) WHERE order_id IS NOT NULL;

CREATE TABLE kds_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('bump', 'remake')),
  kitchen_order_id  text        NOT NULL,
  event_id          text        NOT NULL,
  station_id        uuid        REFERENCES kds_stations(id) ON DELETE SET NULL,
  station_name      text,
  station_kind      text,
  at                timestamptz NOT NULL,
  -- bump: seconds from the earliest of its dishes going live to the bump
  seconds           int,
  items             int,
  -- remake: the dish
  item_name         text,
  reason            text,
  order_source      text,
  order_type        text,
  order_number      text,
  recalled_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kds_log_venue_at ON kds_log (venue_id, at DESC);
CREATE INDEX kds_log_event ON kds_log (event_id);

ALTER TABLE pos_devices DROP CONSTRAINT IF EXISTS pos_devices_kind_check;
ALTER TABLE pos_devices ADD CONSTRAINT pos_devices_kind_check CHECK (kind IN ('terminal', 'hub', 'kds'));

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS kds_online_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS kds_online_ready  boolean NOT NULL DEFAULT true;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kds_stations', 'kds_routes', 'kds_orders', 'kds_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

COMMIT;
