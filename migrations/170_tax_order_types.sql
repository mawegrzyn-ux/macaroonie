-- 170_tax_order_types.sql
-- Tax rates, order types and revenue streams. shared/tax.js, docs/POS.md
-- section 8.
--
--   tax_rates                the tenant's rates (Standard 20%, Zero 0%, ...);
--                            one is the default (used when nothing is set)
--   tax_rate_values          a location that charges another % for a rate
--   order_types              the tenant's order types (Eat in, Take out,
--                            Delivery, Collection, any added): decide how
--                            tickets behave and can change a dish's tax
--   pos_revenue_centres  ->  pos_revenue_streams: a till grouping for
--                            recognising revenue by place and/or device;
--                            no longer decides VAT (vat_mode dropped)
--   pos_stream_order_types   per stream and order type: on/off, ask for a
--                            customer name, ask for a tent number
--                            (off | ask | required). No row = off.
--   menus.tax, menu_sections.tax, menu_items.tax
--                            { rate, rules: [{ venues, streams, types, rate }] }
--                            the dish's setting wins over its section's, the
--                            section's over its menu's (shared/tax.js)
--   ordering_settings        order_type_ids { collection, delivery, eat_in },
--                            revenue_stream_id (online orders' context)
--   deliveroo_settings       order_type_id, revenue_stream_id
--   orders                   order_type_id, revenue_stream_id
--   pos_checks               revenue_stream_id (renamed), order_type_id, tent
--   pos_check_lines          revenue_stream_id (renamed), tax_rate_id
--
-- Replaces the dish / section eat-in and takeaway VAT %s (now: the eat-in %
-- as the setting's rate, the takeaway % as an exception for Take out,
-- Delivery and Collection, with a rate made for any % not in the list), the
-- venue VAT defaults on Till setup and Ordering setup (dropped: the tenant's
-- default rate applies), revenue centres' VAT mode (now the stream's default
-- order type) and the kitchen flow's fixed order types (now the tenant's).
-- Published menu versions are rewritten the same way and re-hashed at API
-- start (content_hash '' = re-hash, backfillFirstReleases()).

BEGIN;

-- ── Tax rates ──────────────────────────────────────────────────
CREATE TABLE tax_rates (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text         NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  rate        numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  is_default  boolean      NOT NULL DEFAULT false,
  sort_order  int          NOT NULL DEFAULT 0,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX tax_rates_tenant ON tax_rates (tenant_id, sort_order);
CREATE UNIQUE INDEX tax_rates_default_uq ON tax_rates (tenant_id) WHERE is_default;
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_rates USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE tax_rate_values (
  tax_rate_id  uuid         NOT NULL REFERENCES tax_rates(id) ON DELETE CASCADE,
  venue_id     uuid         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id    uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rate         numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  PRIMARY KEY (tax_rate_id, venue_id)
);
ALTER TABLE tax_rate_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_rate_values USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

INSERT INTO tax_rates (tenant_id, name, rate, is_default, sort_order)
SELECT id, 'Standard', 20, true, 0 FROM tenants;
INSERT INTO tax_rates (tenant_id, name, rate, is_default, sort_order)
SELECT id, 'Zero', 0, false, 1 FROM tenants;

-- ── Order types ────────────────────────────────────────────────
CREATE TABLE order_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  colour      text,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_types_tenant ON order_types (tenant_id, sort_order);
ALTER TABLE order_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_types USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

INSERT INTO order_types (tenant_id, name, sort_order)
SELECT t.id, x.name, x.ord
  FROM tenants t
 CROSS JOIN (VALUES ('Eat in', 0), ('Take out', 1), ('Delivery', 2), ('Collection', 3)) AS x(name, ord);

-- The seeded type standing for one of the old fixed keys.
CREATE FUNCTION pg_temp.ot(t uuid, k text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM order_types
   WHERE tenant_id = t
     AND name = CASE k WHEN 'eat_in' THEN 'Eat in' WHEN 'takeaway' THEN 'Take out'
                       WHEN 'delivery' THEN 'Delivery' WHEN 'collection' THEN 'Collection' END
   ORDER BY sort_order LIMIT 1
$$;

-- ── Revenue streams ────────────────────────────────────────────
ALTER TABLE pos_revenue_centres RENAME TO pos_revenue_streams;
ALTER INDEX pos_revenue_centres_venue RENAME TO pos_revenue_streams_venue;
ALTER TABLE pos_revenue_streams ADD COLUMN default_order_type_id uuid REFERENCES order_types(id) ON DELETE SET NULL;
UPDATE pos_revenue_streams
   SET default_order_type_id = pg_temp.ot(tenant_id, CASE WHEN vat_mode = 'takeaway' THEN 'takeaway' ELSE 'eat_in' END);

CREATE TABLE pos_stream_order_types (
  stream_id      uuid    NOT NULL REFERENCES pos_revenue_streams(id) ON DELETE CASCADE,
  order_type_id  uuid    NOT NULL REFERENCES order_types(id) ON DELETE CASCADE,
  tenant_id      uuid    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT true,
  ask_name       text    NOT NULL DEFAULT 'off' CHECK (ask_name IN ('off', 'ask', 'required')),
  ask_tent       text    NOT NULL DEFAULT 'off' CHECK (ask_tent IN ('off', 'ask', 'required')),
  PRIMARY KEY (stream_id, order_type_id)
);
ALTER TABLE pos_stream_order_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_stream_order_types USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Every stream offers Eat in and Take out, asking for a name (the counter's
-- optional "Name for the order" before).
INSERT INTO pos_stream_order_types (stream_id, order_type_id, tenant_id, enabled, ask_name)
SELECT s.id, o.id, s.tenant_id, true, 'ask'
  FROM pos_revenue_streams s
  JOIN order_types o ON o.tenant_id = s.tenant_id AND o.name IN ('Eat in', 'Take out');

ALTER TABLE pos_revenue_streams DROP COLUMN vat_mode;

ALTER TABLE pos_settings DROP COLUMN default_vat_rate_eat_in;
ALTER TABLE pos_settings DROP COLUMN default_vat_rate_takeaway;
ALTER TABLE pos_settings DROP COLUMN counter_revenue_centre_id;

ALTER TABLE floor_areas RENAME COLUMN revenue_centre_id TO revenue_stream_id;

UPDATE pos_devices SET settings = replace(settings::text, '"revenue_centre_id"', '"revenue_stream_id"')::jsonb
 WHERE settings ? 'revenue_centre_id';

-- ── Trading data ───────────────────────────────────────────────
ALTER TABLE pos_checks RENAME COLUMN revenue_centre_id TO revenue_stream_id;
ALTER TABLE pos_checks ADD COLUMN order_type_id uuid;
ALTER TABLE pos_checks ADD COLUMN tent text;
ALTER TABLE pos_check_lines RENAME COLUMN revenue_centre_id TO revenue_stream_id;
ALTER TABLE pos_check_lines ADD COLUMN tax_rate_id uuid;

UPDATE pos_checks c
   SET order_type_id = s.default_order_type_id
  FROM pos_revenue_streams s
 WHERE s.id = c.revenue_stream_id;
UPDATE pos_checks
   SET state = replace(state::text, '"revenue_centre_id"', '"revenue_stream_id"')::jsonb
            || jsonb_build_object('order_type_id', order_type_id, 'tent', NULL);

UPDATE pos_events SET type = 'check.stream_set' WHERE type = 'check.rc_set';
UPDATE pos_events SET payload = replace(payload::text, '"revenue_centre_id"', '"revenue_stream_id"')::jsonb
 WHERE payload::text LIKE '%"revenue_centre_id"%';

-- Closed days keep their figures: sales by revenue stream; no order types.
UPDATE pos_days
   SET figures = (figures - 'revenue_centres')
              || jsonb_build_object('revenue_streams', COALESCE(figures->'revenue_centres', '[]'::jsonb), 'order_types', '[]'::jsonb)
 WHERE figures ? 'revenue_centres';

-- Kitchen orders: the fixed type key becomes the tenant's order type.
UPDATE kds_orders k
   SET state = (replace(k.state::text, '"revenue_centre_id"', '"revenue_stream_id"')::jsonb)
            || jsonb_build_object(
                 'type', pg_temp.ot(k.tenant_id, k.state->>'type'),
                 'type_name', (SELECT name FROM order_types WHERE id = pg_temp.ot(k.tenant_id, k.state->>'type')),
                 'tent', NULL);

-- Kitchen flow links and printer routes name revenue streams; order type
-- filters name the tenant's types.
UPDATE kds_flow_edges e
   SET targets = COALESCE((
         SELECT jsonb_agg(CASE
                  WHEN t->>'kind' = 'revenue_centre' THEN jsonb_build_object('kind', 'revenue_stream', 'id', t->'id')
                  WHEN t->>'kind' = 'order_type' THEN jsonb_build_object('kind', 'order_type', 'id', pg_temp.ot(e.tenant_id, t->>'id'))
                  ELSE t END ORDER BY n)
           FROM jsonb_array_elements(e.targets) WITH ORDINALITY AS x(t, n)
          WHERE t->>'kind' <> 'order_type' OR pg_temp.ot(e.tenant_id, t->>'id') IS NOT NULL), '[]'::jsonb)
 WHERE e.targets <> '[]'::jsonb;

ALTER TABLE pos_print_routes DROP CONSTRAINT IF EXISTS pos_print_routes_target_kind_check;
UPDATE pos_print_routes SET target_kind = 'revenue_stream' WHERE target_kind = 'revenue_centre';
ALTER TABLE pos_print_routes ADD CONSTRAINT pos_print_routes_target_kind_check
  CHECK (target_kind IN ('item', 'section', 'revenue_stream', 'default'));

-- ── Menu tax settings ──────────────────────────────────────────
ALTER TABLE menus         ADD COLUMN tax jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE menu_sections ADD COLUMN tax jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE menu_items    ADD COLUMN tax jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A tenant's rate for a %, made ("VAT 12.5%") when it has none.
CREATE FUNCTION pg_temp.rate_for(t uuid, pct numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r uuid;
BEGIN
  IF pct IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO r FROM tax_rates WHERE tenant_id = t AND rate = pct ORDER BY is_default DESC, sort_order LIMIT 1;
  IF r IS NULL THEN
    INSERT INTO tax_rates (tenant_id, name, rate, sort_order)
    VALUES (t, 'VAT ' || rtrim(rtrim(pct::text, '0'), '.') || '%', pct,
            (SELECT COALESCE(max(sort_order), 0) + 1 FROM tax_rates WHERE tenant_id = t))
    RETURNING id INTO r;
  END IF;
  RETURN r;
END $$;

-- Old eat-in / takeaway %s as a tax setting.
CREATE FUNCTION pg_temp.vat_tax(t uuid, eat numeric, take numeric) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE base uuid; tk uuid;
BEGIN
  IF eat IS NULL AND take IS NULL THEN RETURN '{}'::jsonb; END IF;
  base := pg_temp.rate_for(t, eat);
  tk := pg_temp.rate_for(t, take);
  RETURN jsonb_build_object('rate', base, 'rules',
    CASE WHEN tk IS NOT NULL AND tk IS DISTINCT FROM base THEN
      jsonb_build_array(jsonb_build_object(
        'venues', '[]'::jsonb, 'streams', '[]'::jsonb,
        'types', to_jsonb(array_remove(ARRAY[pg_temp.ot(t, 'takeaway'), pg_temp.ot(t, 'delivery'), pg_temp.ot(t, 'collection')], NULL)),
        'rate', tk))
    ELSE '[]'::jsonb END);
END $$;

UPDATE menu_sections SET tax = pg_temp.vat_tax(tenant_id, vat_rate_eat_in, vat_rate_takeaway)
 WHERE vat_rate_eat_in IS NOT NULL OR vat_rate_takeaway IS NOT NULL;
UPDATE menu_items SET tax = pg_temp.vat_tax(tenant_id, vat_rate_eat_in, vat_rate_takeaway)
 WHERE vat_rate_eat_in IS NOT NULL OR vat_rate_takeaway IS NOT NULL;

-- Published versions: the same, re-hashed by the API at start.
UPDATE menu_releases r
   SET snapshot = (r.snapshot || jsonb_build_object('tax', '{}'::jsonb))
               || jsonb_build_object('sections', COALESCE((
         SELECT jsonb_agg(
                  (s - 'vat_rate_takeaway' - 'vat_rate_eat_in')
                  || jsonb_build_object(
                       'tax', pg_temp.vat_tax(r.tenant_id, (s->>'vat_rate_eat_in')::numeric, (s->>'vat_rate_takeaway')::numeric),
                       'items', COALESCE((
                         SELECT jsonb_agg(
                                  (i - 'vat_rate_takeaway' - 'vat_rate_eat_in')
                                  || jsonb_build_object('tax', pg_temp.vat_tax(r.tenant_id, (i->>'vat_rate_eat_in')::numeric, (i->>'vat_rate_takeaway')::numeric))
                                  ORDER BY io)
                           FROM jsonb_array_elements(COALESCE(s->'items', '[]'::jsonb)) WITH ORDINALITY AS y(i, io)), '[]'::jsonb))
                  ORDER BY so)
           FROM jsonb_array_elements(r.snapshot->'sections') WITH ORDINALITY AS x(s, so)), '[]'::jsonb)),
       content_hash = ''
 WHERE jsonb_typeof(r.snapshot->'sections') = 'array';

ALTER TABLE menu_sections DROP COLUMN vat_rate_takeaway;
ALTER TABLE menu_sections DROP COLUMN vat_rate_eat_in;
ALTER TABLE menu_items DROP COLUMN vat_rate_takeaway;
ALTER TABLE menu_items DROP COLUMN vat_rate_eat_in;

-- ── Online ordering, Deliveroo, orders ─────────────────────────
ALTER TABLE ordering_settings DROP COLUMN default_vat_rate_takeaway;
ALTER TABLE ordering_settings DROP COLUMN default_vat_rate_eat_in;
ALTER TABLE ordering_settings ADD COLUMN order_type_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ordering_settings ADD COLUMN revenue_stream_id uuid REFERENCES pos_revenue_streams(id) ON DELETE SET NULL;
UPDATE ordering_settings
   SET order_type_ids = jsonb_strip_nulls(jsonb_build_object(
         'collection', pg_temp.ot(tenant_id, 'collection'),
         'delivery', pg_temp.ot(tenant_id, 'delivery'),
         'eat_in', pg_temp.ot(tenant_id, 'eat_in')));

ALTER TABLE deliveroo_settings ADD COLUMN order_type_id uuid REFERENCES order_types(id) ON DELETE SET NULL;
ALTER TABLE deliveroo_settings ADD COLUMN revenue_stream_id uuid REFERENCES pos_revenue_streams(id) ON DELETE SET NULL;
UPDATE deliveroo_settings SET order_type_id = pg_temp.ot(tenant_id, 'delivery');

ALTER TABLE orders ADD COLUMN order_type_id uuid REFERENCES order_types(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN revenue_stream_id uuid REFERENCES pos_revenue_streams(id) ON DELETE SET NULL;
UPDATE orders SET order_type_id = pg_temp.ot(tenant_id, fulfilment);

-- Nav: "Tax rates" under each tenant's /menus link.
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
SELECT m.tenant_id, m.id, 'link', 'Tax rates', 'Percent', '/menus/tax', 'menus',
       COALESCE((SELECT MAX(c.sort_order) + 1 FROM nav_items c WHERE c.parent_id = m.id), 0)
  FROM nav_items m
 WHERE m.route = '/menus'
   AND m.id = (SELECT n.id FROM nav_items n
                WHERE n.tenant_id = m.tenant_id AND n.route = '/menus'
                ORDER BY n.sort_order LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM nav_items x
                    WHERE x.tenant_id = m.tenant_id AND x.route = '/menus/tax');

COMMIT;
