-- 159_gloriafood.sql
--
-- GloriaFood online orders: keep the venue's accepted GloriaFood orders, fill
-- Cash Recon from them (like Loyverse, migration 154) and, if switched on,
-- show them on the Online orders board marked as GloriaFood.
--
-- GloriaFood's Accepted Orders API only hands over orders as they are
-- accepted (it has no history to read back), so every order is stored here
-- when it arrives:
--   push  GloriaFood POSTs each accepted order to
--         /webhooks/gloriafood/<push_token> (integration "Push Accepted
--         Order", JSON). The unguessable token in the URL is the check.
--   poll  every minute the API calls GloriaFood's pop endpoint with the
--         venue's key (integration "Poll Accepted Order v2"); each order comes
--         back once.
--
--   gloriafood_venue_links  one per venue: push or poll, the poll key (stored
--                           as typed, never returned; poll_key_hint = last 4),
--                           the GloriaFood restaurant learned from the first
--                           order (later orders from another restaurant are
--                           refused), which time places an order on a day
--                           (fulfil or accepted) and when the trading day
--                           starts, whether orders show on the board, and the
--                           Cash Recon mapping (same shape as Loyverse's:
--                           { income | takings | sc: { <field id>: [term] } },
--                           term = { sign, kind, ref?, label? }).
--   gloriafood_orders       one per GloriaFood order, upserted by order id
--                           (GloriaFood can send the same order twice, and
--                           sends it again when it changes, e.g. cancelled).
--                           Money in pence. Only status 'accepted' counts in
--                           Cash Recon; source 'admin' (GloriaFood's test
--                           orders) never counts. board_status is ours only
--                           (In progress / Ready / Collected on the board);
--                           GloriaFood never hears about it. Guest details
--                           (name, phone, address) are only for the board and
--                           are cleared 30 days after the order; payload keeps
--                           the order as sent, without guest details.
--
-- Filled days record who filled them and when:
--   cash_daily_reports.gloriafood_filled_at / gloriafood_filled_by.

BEGIN;

CREATE TABLE gloriafood_venue_links (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id            uuid        NOT NULL UNIQUE REFERENCES venues(id) ON DELETE CASCADE,
  method              text        NOT NULL DEFAULT 'push' CHECK (method IN ('push', 'poll')),
  push_token          text        NOT NULL UNIQUE,
  poll_key            text,
  poll_key_hint       text,
  gf_restaurant_id    bigint,
  gf_restaurant_name  text,
  day_basis           text        NOT NULL DEFAULT 'fulfill' CHECK (day_basis IN ('fulfill', 'accepted')),
  day_starts_at       text        NOT NULL DEFAULT '00:00' CHECK (day_starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  show_on_board       boolean     NOT NULL DEFAULT false,
  mappings            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_order_at       timestamptz,
  last_poll_at        timestamptz,
  last_error          text,
  last_error_at       timestamptz,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gloriafood_venue_links_tenant ON gloriafood_venue_links (tenant_id);

CREATE TABLE gloriafood_orders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id             uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  gf_order_id          bigint      NOT NULL,
  gf_restaurant_id     bigint,
  restaurant_name      text,
  status               text        NOT NULL,
  order_type           text,
  source               text,
  payment              text,
  used_payment_methods text[]      NOT NULL DEFAULT '{}',
  card_type            text,
  gateway_type         text,
  currency             text,
  total_pence          integer     NOT NULL DEFAULT 0,
  subtotal_pence       integer     NOT NULL DEFAULT 0,
  items_pence          integer     NOT NULL DEFAULT 0,
  discount_pence       integer     NOT NULL DEFAULT 0,
  delivery_fee_pence   integer     NOT NULL DEFAULT 0,
  tip_pence            integer     NOT NULL DEFAULT 0,
  service_fee_pence    integer     NOT NULL DEFAULT 0,
  tax_pence            integer     NOT NULL DEFAULT 0,
  accepted_at          timestamptz,
  fulfill_at           timestamptz,
  gf_updated_at        timestamptz,
  for_later            boolean     NOT NULL DEFAULT false,
  client_name          text,
  client_phone         text,
  client_address       text,
  instructions         text,
  table_number         text,
  persons              integer,
  items                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  payload              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  board_status         text        NOT NULL DEFAULT 'accepted'
                                   CHECK (board_status IN ('accepted', 'preparing', 'ready', 'completed')),
  board_status_by      text,
  board_status_at      timestamptz,
  received_via         text        NOT NULL CHECK (received_via IN ('push', 'poll')),
  received_at          timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, gf_order_id)
);
CREATE INDEX gloriafood_orders_venue_fulfill  ON gloriafood_orders (venue_id, fulfill_at);
CREATE INDEX gloriafood_orders_venue_accepted ON gloriafood_orders (venue_id, accepted_at);

ALTER TABLE cash_daily_reports
  ADD COLUMN gloriafood_filled_at timestamptz,
  ADD COLUMN gloriafood_filled_by text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gloriafood_venue_links', 'gloriafood_orders']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

COMMIT;
