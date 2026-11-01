-- Till: one company list of charges, put on checks by a matrix at each
-- location; and covers and courses per revenue stream.
--
-- pos_charges        the company's charges (shared/pos/charges.js): a service
--                    charge, a packaging or delivery fee, a cup deposit...
--                    A percent or an amount; optional or not; from N guests;
--                    a VAT rate or none; on the whole check or only on named
--                    dishes (item_ids, section_ids: a dish, or every dish of a
--                    menu section); an amount once, or for each dish it counts.
-- pos_charge_rules   at each location, which charges a check of a revenue
--                    stream and an order type gets: one row per charge, stream
--                    and order type (the matrix on Store tech > Charges).
--
-- The order types' own charges (order_types.charges, migration 225) move to
-- the list: each different charge once per group, on every stream of every
-- location that offers the order type. The column goes.
--
-- pos_revenue_streams.covers    'off' | 'ask' | 'must': whether the till asks
--                               how many guests when a table opens (ask = it
--                               can be skipped; must = it can't, and a table's
--                               check without them asks again before Send
--                               and Pay). Off also leaves out seat numbers.
-- pos_revenue_streams.courses   whether the till uses courses for the
--                               stream's checks.
-- A till can choose its own (device settings covers, courses). The venue's
-- one switch, pos_settings.require_covers, moves to its streams ('must' where
-- it was on, 'off' where it was off) and goes.

CREATE TABLE IF NOT EXISTS pos_charges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind         text NOT NULL CHECK (kind IN ('percent', 'amount')),
  -- A percent (0.01-50, two decimals) or pence (1-100000, whole).
  value        numeric(10, 2) NOT NULL CHECK (
                 (kind = 'percent' AND value > 0 AND value <= 50)
                 OR (kind = 'amount' AND value >= 1 AND value <= 100000 AND value = trunc(value))),
  optional     boolean NOT NULL DEFAULT false,
  min_covers   integer NOT NULL DEFAULT 0 CHECK (min_covers BETWEEN 0 AND 100),
  tax_rate_id  uuid REFERENCES tax_rates(id) ON DELETE SET NULL,
  basis        text NOT NULL DEFAULT 'check' CHECK (basis IN ('check', 'dishes')),
  per          text NOT NULL DEFAULT 'check' CHECK (per IN ('check', 'dish')),
  -- The dishes named (basis 'dishes'). No foreign keys: menu rows are
  -- re-inserted under their ids on every menu save.
  item_ids     uuid[] NOT NULL DEFAULT '{}',
  section_ids  uuid[] NOT NULL DEFAULT '{}',
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (basis = 'check' OR cardinality(item_ids) + cardinality(section_ids) > 0),
  CHECK (cardinality(item_ids) <= 100 AND cardinality(section_ids) <= 30)
);
CREATE INDEX IF NOT EXISTS pos_charges_tenant_idx ON pos_charges (tenant_id, sort_order);

ALTER TABLE pos_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_charges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_charges;
CREATE POLICY tenant_isolation ON pos_charges
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE IF NOT EXISTS pos_charge_rules (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  charge_id          uuid NOT NULL REFERENCES pos_charges(id) ON DELETE CASCADE,
  revenue_stream_id  uuid NOT NULL REFERENCES pos_revenue_streams(id) ON DELETE CASCADE,
  order_type_id      uuid NOT NULL REFERENCES order_types(id) ON DELETE CASCADE,
  PRIMARY KEY (charge_id, revenue_stream_id, order_type_id)
);
CREATE INDEX IF NOT EXISTS pos_charge_rules_venue_idx ON pos_charge_rules (tenant_id, venue_id);

ALTER TABLE pos_charge_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_charge_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_charge_rules;
CREATE POLICY tenant_isolation ON pos_charge_rules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- The order types' charges into the list, and where they were into the matrix.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'order_types' AND column_name = 'charges') THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE _old_charges ON COMMIT DROP AS
  SELECT t.tenant_id, t.id AS order_type_id, t.sort_order AS type_sort, x.ord,
         btrim(x.c->>'name') AS name,
         x.c->>'kind' AS kind,
         CASE WHEN x.c->>'kind' = 'percent' THEN round((x.c->>'value')::numeric, 2) ELSE (x.c->>'value')::numeric END AS value,
         COALESCE(x.c->>'optional' = 'true', false) AS optional,
         LEAST(GREATEST(COALESCE(round((x.c->>'min_covers')::numeric), 0), 0), 100)::int AS min_covers,
         r.id AS tax_rate_id
    FROM order_types t
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.charges) = 'array' THEN t.charges ELSE '[]'::jsonb END)
         WITH ORDINALITY AS x(c, ord)
    LEFT JOIN tax_rates r ON r.tenant_id = t.tenant_id AND r.id::text = x.c->>'tax_rate_id'
   WHERE x.c->>'kind' IN ('percent', 'amount')
     AND length(btrim(COALESCE(x.c->>'name', ''))) BETWEEN 1 AND 60
     AND jsonb_typeof(x.c->'value') = 'number';

  DELETE FROM _old_charges
   WHERE NOT ((kind = 'percent' AND value > 0 AND value <= 50)
              OR (kind = 'amount' AND value >= 1 AND value <= 100000 AND value = trunc(value)));

  -- One list charge per different charge in a group, in the order they first showed.
  CREATE TEMP TABLE _new_charges ON COMMIT DROP AS
  SELECT gen_random_uuid() AS id, d.*
    FROM (SELECT tenant_id, name, kind, value, optional, min_covers, tax_rate_id, min(type_sort::numeric * 1000 + ord) AS first_seen
            FROM _old_charges
           GROUP BY tenant_id, name, kind, value, optional, min_covers, tax_rate_id) d;

  INSERT INTO pos_charges (id, tenant_id, name, kind, value, optional, min_covers, tax_rate_id, sort_order)
  SELECT id, tenant_id, name, kind, value, optional, min_covers, tax_rate_id,
         (row_number() OVER (PARTITION BY tenant_id ORDER BY first_seen, name) - 1)::int
    FROM _new_charges;

  -- On every stream that offers the order type, at every location.
  INSERT INTO pos_charge_rules (tenant_id, venue_id, charge_id, revenue_stream_id, order_type_id)
  SELECT DISTINCT o.tenant_id, s.venue_id, n.id, s.id, o.order_type_id
    FROM _old_charges o
    JOIN _new_charges n ON n.tenant_id = o.tenant_id AND n.name = o.name AND n.kind = o.kind AND n.value = o.value
                       AND n.optional = o.optional AND n.min_covers = o.min_covers
                       AND n.tax_rate_id IS NOT DISTINCT FROM o.tax_rate_id
    JOIN pos_stream_order_types x ON x.tenant_id = o.tenant_id AND x.order_type_id = o.order_type_id AND x.enabled
    JOIN pos_revenue_streams s ON s.id = x.stream_id AND s.tenant_id = o.tenant_id
  ON CONFLICT DO NOTHING;
END $$;

ALTER TABLE order_types DROP CONSTRAINT IF EXISTS order_types_charges_check;
ALTER TABLE order_types DROP COLUMN IF EXISTS charges;

-- Covers and courses per revenue stream.
ALTER TABLE pos_revenue_streams ADD COLUMN IF NOT EXISTS covers text NOT NULL DEFAULT 'ask';
ALTER TABLE pos_revenue_streams DROP CONSTRAINT IF EXISTS pos_revenue_streams_covers_check;
ALTER TABLE pos_revenue_streams ADD CONSTRAINT pos_revenue_streams_covers_check CHECK (covers IN ('off', 'ask', 'must'));
ALTER TABLE pos_revenue_streams ADD COLUMN IF NOT EXISTS courses boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'pos_settings' AND column_name = 'require_covers') THEN
    UPDATE pos_revenue_streams s
       SET covers = CASE WHEN p.require_covers THEN 'must' ELSE 'off' END
      FROM pos_settings p
     WHERE p.venue_id = s.venue_id AND p.tenant_id = s.tenant_id;
  END IF;
END $$;
ALTER TABLE pos_settings DROP COLUMN IF EXISTS require_covers;

-- A Charges link in every group's Store tech menu, just after Discounts (else
-- after Order types), seen by the same roles.
DO $$
BEGIN
  UPDATE nav_items n SET sort_order = n.sort_order + 1
    FROM nav_items r
   WHERE r.route = (SELECT CASE WHEN EXISTS (SELECT 1 FROM nav_items y WHERE y.tenant_id = r.tenant_id AND y.route = '/pos/discounts')
                                THEN '/pos/discounts' ELSE '/pos/types' END)
     AND n.tenant_id = r.tenant_id
     AND n.parent_id IS NOT DISTINCT FROM r.parent_id
     AND n.sort_order > r.sort_order
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = r.tenant_id AND x.route = '/pos/charges');

  INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
  SELECT n.tenant_id, n.parent_id, 'link', 'Charges', 'HandCoins', '/pos/charges', 'pos_setup', n.sort_order + 1, n.hidden_role_ids, false
    FROM nav_items n
   WHERE n.route = (SELECT CASE WHEN EXISTS (SELECT 1 FROM nav_items y WHERE y.tenant_id = n.tenant_id AND y.route = '/pos/discounts')
                                THEN '/pos/discounts' ELSE '/pos/types' END)
     AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/charges');
END $$;
