-- 290_cash_ext_sales.sql
--
-- Sales from other tills, phase 1 (docs/SALES_IMPORT.md 3.3 and 3.4): one
-- shape for every system's sales, normalised from the raw copies
-- (ext_documents). Money is integer pence exactly as the other till recorded
-- it, never worked out again by our pricing rules (shared/externalSales.js
-- toPence); a refund receipt's amounts are kept as the other till signs them.
-- A receipt that changes (refunded, cancelled) is normalised again from its
-- new raw copy: the check is updated in place and its child rows replaced.
--
--   ext_checks           one per receipt: venue, business_date (the venue's
--                        trading day, pos_connection_venues.day_starts_at,
--                        businessDate() in shared/pos/reports.js), sale or
--                        refund (refund_for_ref = the other till's id of the
--                        receipt it refunds, refund_for_id ours once both are
--                        in), cancelled, dining option, device, employee and
--                        customer as the other till's ids only (decision D3),
--                        totals.
--   ext_check_lines      item lines and, under them (parent_line_id), their
--                        modifiers or condiments. An item line's money
--                        includes its modifiers' (as Loyverse records it): add
--                        up item lines only. The mapped columns (item_id,
--                        option_id, combo_id, rule_id, allocated_net_pence)
--                        are filled by the mapping (phase 2).
--   ext_check_payments   tenders as named on the other till.
--   ext_check_discounts  discounts on the check (line_id null) or a line.
--   ext_check_taxes      taxes on the check (line_id null) or a line, with
--                        type INCLUDED / ADDED as the other till says.
--   ext_catalog          master data, one row per external object (item,
--                        variant, modifier, modifier option, category, tax,
--                        discount, payment type, store, employee, device,
--                        dining option): what the mapping tool shows.

CREATE TABLE ext_checks (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id        uuid        NOT NULL REFERENCES pos_connections(id) ON DELETE CASCADE,
  venue_id             uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  document_id          uuid        REFERENCES ext_documents(id) ON DELETE SET NULL,
  external_id          text        NOT NULL,
  number               text,
  kind                 text        NOT NULL CHECK (kind IN ('sale', 'refund')),
  refund_for_ref       text,
  refund_for_id        uuid        REFERENCES ext_checks(id) ON DELETE SET NULL,
  business_date        date        NOT NULL,
  opened_at            timestamptz,
  closed_at            timestamptz,
  cancelled            boolean     NOT NULL DEFAULT false,
  cancelled_at         timestamptz,
  source               text,
  order_type           text,
  device_ref           text,
  employee_ref         text,
  customer_ref         text,
  location_ref         text,
  gross_pence          integer     NOT NULL DEFAULT 0,
  discount_pence       integer     NOT NULL DEFAULT 0,
  charge_pence         integer     NOT NULL DEFAULT 0,
  tax_pence            integer     NOT NULL DEFAULT 0,
  tip_pence            integer     NOT NULL DEFAULT 0,
  total_pence          integer     NOT NULL DEFAULT 0,
  currency             text,
  external_updated_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX ext_checks_day        ON ext_checks (tenant_id, venue_id, business_date);
CREATE INDEX ext_checks_refund_for ON ext_checks (connection_id, refund_for_ref) WHERE refund_for_ref IS NOT NULL;

CREATE TABLE ext_check_lines (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id             uuid          NOT NULL REFERENCES ext_checks(id) ON DELETE CASCADE,
  line_no              integer       NOT NULL,
  external_line_id     text,
  parent_line_id       uuid          REFERENCES ext_check_lines(id) ON DELETE CASCADE,
  line_kind            text          NOT NULL CHECK (line_kind IN ('item', 'modifier', 'condiment', 'discount', 'charge')),
  item_ref             text,
  variant_ref          text,
  option_ref           text,
  sku                  text,
  name                 text          NOT NULL,
  variant_name         text,
  group_name           text,
  prefix               text,
  qty                  numeric(12,3) NOT NULL DEFAULT 1,
  unit_price_pence     integer       NOT NULL DEFAULT 0,
  gross_pence          integer       NOT NULL DEFAULT 0,
  discount_pence       integer       NOT NULL DEFAULT 0,
  tax_pence            integer       NOT NULL DEFAULT 0,
  net_pence            integer       NOT NULL DEFAULT 0,
  cost_pence           integer,
  note                 text,
  -- Filled by the mapping (phase 2); plain ids until its rules table exists.
  item_id              uuid,
  option_id            uuid,
  combo_id             uuid,
  rule_id              uuid,
  allocated_net_pence  integer,
  UNIQUE (check_id, line_no)
);
CREATE INDEX ext_check_lines_tenant ON ext_check_lines (tenant_id, check_id);
CREATE INDEX ext_check_lines_item   ON ext_check_lines (tenant_id, item_ref, variant_ref);

CREATE TABLE ext_check_payments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id           uuid        NOT NULL REFERENCES ext_checks(id) ON DELETE CASCADE,
  payment_type_ref   text,
  name               text        NOT NULL,
  type               text,
  amount_pence       integer     NOT NULL DEFAULT 0,
  card_brand         text,
  paid_at            timestamptz
);
CREATE INDEX ext_check_payments_check ON ext_check_payments (tenant_id, check_id);

CREATE TABLE ext_check_discounts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id           uuid        NOT NULL REFERENCES ext_checks(id) ON DELETE CASCADE,
  line_id            uuid        REFERENCES ext_check_lines(id) ON DELETE CASCADE,
  discount_ref       text,
  name               text        NOT NULL,
  type               text,
  percentage         numeric(8,3),
  amount_pence       integer     NOT NULL DEFAULT 0
);
CREATE INDEX ext_check_discounts_check ON ext_check_discounts (tenant_id, check_id);

CREATE TABLE ext_check_taxes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id           uuid        NOT NULL REFERENCES ext_checks(id) ON DELETE CASCADE,
  line_id            uuid        REFERENCES ext_check_lines(id) ON DELETE CASCADE,
  tax_ref            text,
  name               text        NOT NULL,
  type               text,
  rate               numeric(8,3),
  amount_pence       integer     NOT NULL DEFAULT 0
);
CREATE INDEX ext_check_taxes_check ON ext_check_taxes (tenant_id, check_id);

CREATE TABLE ext_catalog (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id        uuid        NOT NULL REFERENCES pos_connections(id) ON DELETE CASCADE,
  kind                 text        NOT NULL CHECK (kind IN ('item', 'variant', 'modifier', 'modifier_option', 'category', 'tax', 'discount',
                                                            'payment_type', 'store', 'employee', 'pos_device', 'dining_option')),
  external_id          text        NOT NULL,
  parent_ref           text,
  name                 text        NOT NULL,
  sku                  text,
  price_pence          integer,
  category_ref         text,
  attrs                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  deleted_at           timestamptz,
  external_updated_at  timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, kind, external_id)
);
CREATE INDEX ext_catalog_tenant ON ext_catalog (tenant_id, connection_id, kind);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ext_checks', 'ext_check_lines', 'ext_check_payments', 'ext_check_discounts', 'ext_check_taxes', 'ext_catalog']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY %I ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.bypass_rls', true) = 'on')$f$, t || '_tenant', t);
  END LOOP;
END $$;
