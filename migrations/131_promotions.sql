-- ============================================================
-- 131_promotions.sql
--
-- Promotions for online ordering: basket or dish discounts (% or £),
-- buy X get Y, conditions (minimum spend, a dish in the basket), promo
-- codes, a limited number of uses, dates and times, where they apply,
-- how guests get them (automatic, tap to apply, code), priority and
-- exclusivity. The rules live in shared/promotions.js; the server prices
-- every order with them (services/orderSvc.js).
--
--   promotions        one row per promotion (tenant-wide, optional venues)
--   order_promotions  which promotions an order used, and how much each saved
--   orders.discount_pence, order_items.discount_pence
-- ============================================================


CREATE TABLE IF NOT EXISTS promotions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text        NOT NULL,                 -- shown to guests ("10% off lunch")
  description         text,                                 -- optional guest-facing detail
  badge_text          text,                                 -- optional label on the dishes it covers
  is_active           boolean     NOT NULL DEFAULT true,
  kind                text        NOT NULL DEFAULT 'basket' CHECK (kind IN ('basket', 'item', 'bogo')),
  -- basket and item offers
  discount_type       text        NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'amount')),
  discount_value      int         NOT NULL DEFAULT 0 CHECK (discount_value >= 0),  -- percent, or pence
  -- which dishes an item / buy X get Y offer covers (both empty = every dish)
  item_ids            uuid[]      NOT NULL DEFAULT '{}',
  section_ids         uuid[]      NOT NULL DEFAULT '{}',
  -- buy X get Y: every buy_qty + get_qty covered dishes, the get_qty
  -- cheapest are get_percent off (100 = free)
  buy_qty             int         NOT NULL DEFAULT 1 CHECK (buy_qty >= 1),
  get_qty             int         NOT NULL DEFAULT 1 CHECK (get_qty >= 1),
  get_percent         int         NOT NULL DEFAULT 100 CHECK (get_percent BETWEEN 1 AND 100),
  -- conditions
  min_subtotal_pence  int         NOT NULL DEFAULT 0 CHECK (min_subtotal_pence >= 0),
  required_item_ids   uuid[]      NOT NULL DEFAULT '{}',    -- any one of these must be in the basket
  max_discount_pence  int         CHECK (max_discount_pence IS NULL OR max_discount_pence > 0),
  -- how guests get it
  apply_mode          text        NOT NULL DEFAULT 'auto' CHECK (apply_mode IN ('auto', 'manual', 'code')),
  code                text,                                 -- apply_mode = 'code'
  max_uses            int         CHECK (max_uses IS NULL OR max_uses > 0),
  -- when and where: { from, until, times: [{ days, start, end }] } like
  -- ordering_settings.menu_schedules; empty venue_ids = every venue
  schedule            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  venue_ids           uuid[]      NOT NULL DEFAULT '{}',
  -- combining: list order is priority (first applies first); an exclusive
  -- promotion is never combined with another
  exclusive           boolean     NOT NULL DEFAULT false,
  sort_order          int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (apply_mode <> 'code' OR (code IS NOT NULL AND length(trim(code)) > 0)),
  CHECK (kind = 'bogo' OR discount_type <> 'percent' OR discount_value <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS promotions_code_uniq
  ON promotions (tenant_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotions_tenant_idx ON promotions (tenant_id, sort_order);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotions_tenant ON promotions;
CREATE POLICY promotions_tenant ON promotions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_promotions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  promotion_id    uuid        REFERENCES promotions(id) ON DELETE SET NULL,
  name            text        NOT NULL,          -- copy: survives edits and deletion
  code            text,
  discount_pence  int         NOT NULL CHECK (discount_pence >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_promotions_order_idx ON order_promotions (order_id);
CREATE INDEX IF NOT EXISTS order_promotions_promo_idx ON order_promotions (promotion_id);

ALTER TABLE order_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_promotions_tenant ON order_promotions;
CREATE POLICY order_promotions_tenant ON order_promotions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Totals: subtotal stays the full price of the dishes; the discount is
-- taken off it (total = subtotal - discount + tip). VAT is on what the
-- guest pays for each line (line total - line discount).
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS discount_pence int NOT NULL DEFAULT 0 CHECK (discount_pence >= 0);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_pence int NOT NULL DEFAULT 0 CHECK (discount_pence >= 0);

-- Module: part of the web_ordering group, so it follows that switch.
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT tm.tenant_id, 'promotions', tm.is_enabled
  FROM tenant_modules tm
 WHERE tm.module_key = 'web_orders'
ON CONFLICT DO NOTHING;

-- Nav: "Promotions" under "Online orders", after "Ordering setup".
-- New tenants get it from defaultNav.js.
DO $$
DECLARE
  t          record;
  parent     uuid;
  after_sort int;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/promotions') THEN
      CONTINUE;
    END IF;
    SELECT id INTO parent FROM nav_items WHERE tenant_id = t.id AND route = '/orders' ORDER BY sort_order LIMIT 1;
    IF parent IS NULL THEN
      CONTINUE;
    END IF;
    SELECT COALESCE(MAX(sort_order), -1) INTO after_sort FROM nav_items
     WHERE tenant_id = t.id AND parent_id = parent;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, parent, 'link', 'Promotions', 'BadgePercent', '/promotions', 'promotions', after_sort + 1);
  END LOOP;
END $$;

