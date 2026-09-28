-- ============================================================
-- 122_web_ordering.sql
--
-- Web ordering (collection) from the tenant website, with pluggable
-- payment gateways. The gateways themselves live in code
-- (api/src/services/paymentGateways/); the database only records which
-- gateway handled a payment and its reference.
--
--   ordering_settings           one row per venue: on/off, pause, hours,
--                               slots, lead time, menus, payment methods
--   ordering_item_availability  per-venue "sold out" for a dish
--   orders / order_items        the order and its lines (names, prices,
--                               VAT copied at the time of ordering)
--   order_events                status history and audit trail
--   order_payments              one row per payment attempt, per gateway
--
-- Menu additions: dish VAT rates and "can be ordered online"; variant
-- groups get ordering rules (base price vs extra, min/max choices).
-- tenants.ordering_fee_percent: the platform's fee on web orders, set by
-- a platform admin per tenant; each order records its fee.


-- ============================================================

BEGIN;

-- ── Platform fee ────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ordering_fee_percent numeric(5,2) NOT NULL DEFAULT 0
      CHECK (ordering_fee_percent BETWEEN 0 AND 20);

-- ── Menu additions ──────────────────────────────────────────

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS is_orderable      boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vat_rate_takeaway numeric(5,2) CHECK (vat_rate_takeaway BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS vat_rate_eat_in   numeric(5,2) CHECK (vat_rate_eat_in BETWEEN 0 AND 100);

-- 'base'  = the option price is the dish price (Chicken £12.50, Prawns £13.40)
-- 'extra' = the option price is added on top (Extra egg +£1.00)
ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'base'
      CHECK (price_mode IN ('base', 'extra')),
  ADD COLUMN IF NOT EXISTS min_select int  NOT NULL DEFAULT 1 CHECK (min_select >= 0),
  ADD COLUMN IF NOT EXISTS max_select int  NOT NULL DEFAULT 1 CHECK (max_select >= 1);

-- ── ordering_settings ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS ordering_settings (
  venue_id                uuid         PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id               uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_enabled              boolean      NOT NULL DEFAULT false,
  is_paused               boolean      NOT NULL DEFAULT false,
  pause_message           text,
  -- [{ day: 0-6 (0 = Sunday), is_open, open: 'HH:MM', close: 'HH:MM' }]
  hours                   jsonb        NOT NULL DEFAULT '[]'::jsonb,
  menu_ids                uuid[]       NOT NULL DEFAULT '{}',
  allow_asap              boolean      NOT NULL DEFAULT true,
  lead_time_mins          int          NOT NULL DEFAULT 20 CHECK (lead_time_mins BETWEEN 0 AND 240),
  slot_interval_mins      int          NOT NULL DEFAULT 15 CHECK (slot_interval_mins IN (5, 10, 15, 20, 30, 60)),
  max_orders_per_slot     int          CHECK (max_orders_per_slot IS NULL OR max_orders_per_slot >= 1),
  max_days_ahead          int          NOT NULL DEFAULT 0 CHECK (max_days_ahead BETWEEN 0 AND 14),
  min_order_pence         int          NOT NULL DEFAULT 0 CHECK (min_order_pence >= 0),
  auto_accept             boolean      NOT NULL DEFAULT false,
  -- VAT for dishes without their own rate, by order type: takeaway covers
  -- collection and delivery, eat in covers table orders (POS, QR).
  default_vat_rate_takeaway numeric(5,2) NOT NULL DEFAULT 20 CHECK (default_vat_rate_takeaway BETWEEN 0 AND 100),
  default_vat_rate_eat_in   numeric(5,2) NOT NULL DEFAULT 20 CHECK (default_vat_rate_eat_in BETWEEN 0 AND 100),
  tips_enabled            boolean      NOT NULL DEFAULT false,
  tip_percents            int[]        NOT NULL DEFAULT '{10,12,15}',
  -- Gateway keys offered at checkout, in order (see paymentGateways/).
  payment_methods         text[]       NOT NULL DEFAULT '{pay_at_venue}',
  collection_instructions text,
  confirmation_note       text,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE ordering_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ordering_settings_tenant ON ordering_settings;
CREATE POLICY ordering_settings_tenant ON ordering_settings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── ordering_item_availability ──────────────────────────────
-- A menu can be shared by several venues, so "sold out" is per venue.

CREATE TABLE IF NOT EXISTS ordering_item_availability (
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  item_id         uuid        NOT NULL,           -- menu_items.id (no FK: menu saves re-insert items)
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sold_out_until  timestamptz,                    -- NULL = until turned back on
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, item_id)
);

ALTER TABLE ordering_item_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ordering_item_availability_tenant ON ordering_item_availability;
CREATE POLICY ordering_item_availability_tenant ON ordering_item_availability
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── orders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  channel           text        NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'pos', 'table_qr')),
  fulfilment        text        NOT NULL DEFAULT 'collection' CHECK (fulfilment IN ('collection', 'delivery', 'eat_in')),
  service_date      date        NOT NULL,         -- venue-local day, for numbering and reports
  order_number      int         NOT NULL,         -- 1, 2, 3... per venue per day
  public_token      uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status            text        NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment', 'placed', 'accepted', 'preparing', 'ready',
                                      'completed', 'rejected', 'cancelled', 'expired')),
  is_asap           boolean     NOT NULL DEFAULT true,
  requested_for     timestamptz,                  -- chosen collection time (NULL when ASAP)
  promised_at       timestamptz NOT NULL,         -- when it should be ready
  customer_id       uuid        REFERENCES customers(id) ON DELETE SET NULL,
  guest_name        text        NOT NULL,
  guest_email       text,
  guest_phone       text,
  notes             text,
  allergy_note      text,
  marketing_opt_in  boolean     NOT NULL DEFAULT false,
  currency          text        NOT NULL DEFAULT 'GBP',
  subtotal_pence    int         NOT NULL CHECK (subtotal_pence >= 0),
  tip_pence         int         NOT NULL DEFAULT 0 CHECK (tip_pence >= 0),
  total_pence       int         NOT NULL CHECK (total_pence >= 0),
  vat_pence         int         NOT NULL DEFAULT 0,
  -- Platform fee: tenants.ordering_fee_percent of the subtotal (tips
  -- excluded), fixed when the order is placed.
  platform_fee_percent numeric(5,2) NOT NULL DEFAULT 0,
  platform_fee_pence   int          NOT NULL DEFAULT 0,
  payment_method    text        NOT NULL,         -- gateway key
  payment_status    text        NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed',
                                              'partially_refunded', 'refunded')),
  paid_pence        int         NOT NULL DEFAULT 0,
  refunded_pence    int         NOT NULL DEFAULT 0,
  placed_at         timestamptz,
  accepted_at       timestamptz,
  ready_at          timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, service_date, order_number)
);

CREATE INDEX IF NOT EXISTS orders_venue_day_idx ON orders (venue_id, service_date, status);
CREATE INDEX IF NOT EXISTS orders_pending_idx   ON orders (created_at) WHERE status = 'pending_payment';
CREATE INDEX IF NOT EXISTS orders_customer_idx  ON orders (customer_id);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant ON orders;
CREATE POLICY orders_tenant ON orders
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── order_items ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_items (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id         uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_item_id      uuid,                          -- no FK: a copy survives menu edits
  name              text         NOT NULL,
  options           jsonb        NOT NULL DEFAULT '[]'::jsonb,   -- [{ group, label, price_pence, mode }]
  qty               int          NOT NULL CHECK (qty BETWEEN 1 AND 99),
  unit_price_pence  int          NOT NULL CHECK (unit_price_pence >= 0),
  line_total_pence  int          NOT NULL CHECK (line_total_pence >= 0),
  vat_rate          numeric(5,2) NOT NULL DEFAULT 0,
  vat_pence         int          NOT NULL DEFAULT 0,
  note              text,
  sort_order        int          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id, sort_order);
CREATE INDEX IF NOT EXISTS order_items_menu_item_idx ON order_items (menu_item_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_tenant ON order_items;
CREATE POLICY order_items_tenant ON order_items
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── order_events ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('status', 'payment', 'refund', 'time', 'note')),
  from_status  text,
  to_status    text,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  actor        text,                                -- staff email, 'guest' or 'system'
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at);

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_events_tenant ON order_events;
CREATE POLICY order_events_tenant ON order_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── order_payments ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gateway         text        NOT NULL,             -- gateway key, or 'cash' / 'card_terminal' at the counter
  gateway_ref     text,                             -- the gateway's own id (e.g. a payment intent)
  amount_pence    int         NOT NULL CHECK (amount_pence >= 0),
  refunded_pence  int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  raw             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS order_payments_gateway_ref_uq
  ON order_payments (gateway, gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_payments_order_idx ON order_payments (order_id);

ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_payments_tenant ON order_payments;
CREATE POLICY order_payments_tenant ON order_payments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── email_log: order emails ─────────────────────────────────

ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

-- ── Nav: "Online orders" in the Service section, after Customers ──
-- New tenants get the same links from defaultNav.js.
DO $$
DECLARE
  t          record;
  svc_id     uuid;
  after_sort int;
  orders_id  uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM nav_items WHERE tenant_id = t.id AND route = '/orders') THEN
      CONTINUE;
    END IF;
    SELECT id INTO svc_id FROM nav_items
     WHERE tenant_id = t.id AND parent_id IS NULL AND kind = 'section' AND label = 'Service'
     ORDER BY sort_order LIMIT 1;
    IF svc_id IS NULL THEN
      CONTINUE;
    END IF;

    after_sort := NULL;
    SELECT sort_order INTO after_sort FROM nav_items
     WHERE tenant_id = t.id AND parent_id = svc_id AND route = '/customers' LIMIT 1;
    IF after_sort IS NULL THEN
      SELECT COALESCE(MAX(sort_order), -1) INTO after_sort FROM nav_items
       WHERE tenant_id = t.id AND parent_id = svc_id;
    END IF;

    UPDATE nav_items SET sort_order = sort_order + 1
     WHERE tenant_id = t.id AND parent_id = svc_id AND sort_order > after_sort;

    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, svc_id, 'link', 'Online orders', 'ShoppingBag', '/orders', 'web_orders', after_sort + 1)
    RETURNING id INTO orders_id;
    INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
    VALUES (t.id, orders_id, 'link', 'Ordering setup', 'Settings2', '/orders/settings', 'web_ordering_setup', 0);
  END LOOP;
END $$;

COMMIT;
