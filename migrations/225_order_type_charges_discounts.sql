-- Till: charges per order type, and discounts set up in Store tech.
--
-- order_types.charges   the charges a check of this type gets (shared/pos/
--                       charges.js): [{ id, name, kind 'percent' | 'amount',
--                       value, optional, min_covers, tax_rate_id }], in the
--                       order they show. Several per type: a service charge,
--                       a packaging or delivery fee... Optional ones staff may
--                       take off the bill; others need a manager.
-- pos_discounts         the company's discounts the till offers by name
--                       (shared/pos/discounts.js): percent or amount, on the
--                       whole check, on items or either, and whether each
--                       needs a manager every time.
--
-- The revenue stream's single service charge (service_charge_percent, from
-- N covers) and the venue's service charge label give way to the order
-- types' charges. A group whose active streams all charged the same goes on
-- with it as an optional charge on its Eat in type.

ALTER TABLE order_types ADD COLUMN IF NOT EXISTS charges jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE order_types DROP CONSTRAINT IF EXISTS order_types_charges_check;
ALTER TABLE order_types ADD CONSTRAINT order_types_charges_check CHECK (jsonb_typeof(charges) = 'array');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'pos_revenue_streams' AND column_name = 'service_charge_percent') THEN
    WITH sc AS (
      SELECT tenant_id,
             min(service_charge_percent) AS pct,
             min(COALESCE(service_charge_min_covers, 0)) AS covers,
             count(DISTINCT (service_charge_percent, COALESCE(service_charge_min_covers, 0))) AS kinds
        FROM pos_revenue_streams
       WHERE is_active AND service_charge_percent > 0
       GROUP BY tenant_id
    )
    UPDATE order_types t
       SET charges = jsonb_build_array(jsonb_build_object(
             'id', gen_random_uuid(), 'name', 'Service charge', 'kind', 'percent',
             'value', LEAST(sc.pct, 50), 'optional', true, 'min_covers', LEAST(sc.covers, 100), 'tax_rate_id', NULL))
      FROM sc
     WHERE sc.kinds = 1 AND t.tenant_id = sc.tenant_id
       AND lower(t.name) = 'eat in' AND t.charges = '[]'::jsonb;
  END IF;
END $$;

ALTER TABLE pos_revenue_streams DROP COLUMN IF EXISTS service_charge_percent;
ALTER TABLE pos_revenue_streams DROP COLUMN IF EXISTS service_charge_min_covers;
ALTER TABLE pos_settings DROP COLUMN IF EXISTS service_charge_label;

CREATE TABLE IF NOT EXISTS pos_discounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind          text NOT NULL CHECK (kind IN ('percent', 'amount')),
  -- A percent (0.01-100, two decimals) or pence (1-100000, whole).
  value         numeric(10, 2) NOT NULL CHECK (
                  (kind = 'percent' AND value > 0 AND value <= 100)
                  OR (kind = 'amount' AND value >= 1 AND value <= 100000 AND value = trunc(value))),
  scope         text NOT NULL DEFAULT 'any' CHECK (scope IN ('any', 'check', 'line')),
  needs_manager boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_discounts_tenant_idx ON pos_discounts (tenant_id, sort_order);

ALTER TABLE pos_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_discounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_discounts;
CREATE POLICY tenant_isolation ON pos_discounts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- A Discounts link in every group's Store tech menu, just after Order types,
-- seen by the same roles.
UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/pos/types' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = r.tenant_id AND x.route = '/pos/discounts');

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Discounts', 'BadgePercent', '/pos/discounts', 'pos_setup', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/pos/types'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/discounts');
