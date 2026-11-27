-- 311_stock_usage.sql
--
-- Inventory phase 5 (27 Nov 2026; docs/INVENTORY.md 7 and 9, decisions D9
-- and D10): usage from sales. A job (api/src/jobs/stock-usage.js, every few
-- minutes) works out each venue's trading day from what was sold on the
-- till and kiosks, online and on other tills (Loyverse, Square), each sold
-- dish broken into items by usageOf() in shared/costing.js (the cost walk's
-- own lines), and keeps the day here. Stock on hand then takes sales off
-- (services/stockSvc.js MOVE_SOURCES: one move per item per day).
--
-- A day's rows are replaced together in one transaction whenever it is
-- worked out again: a day of the last 14 whose sales changed (late sales: a
-- hub or a till that syncs the next morning, another till's receipts mapped
-- again), every open day after a recipe, a link or an option rule changed
-- (dirty_from), or a manual Recompute. Closed periods (phase 6) never change.
--
-- Menu dishes, revenue streams, order types and recipes are plain ids (no
-- foreign keys): the menu save deletes and re-inserts its dishes under the
-- same ids, and a day's figures keep the names they were worked out with.

-- Refunds from other tills give stock back only when the group says the goods came back (off).
ALTER TABLE stock_settings ADD COLUMN refunds_return_stock boolean NOT NULL DEFAULT false;

-- How a venue's order lists read their pars: 'up_to' (order up to par: what
-- is on hand and on order is taken off) or 'order' (order the par as it is,
-- as before). Null: up to par once the venue has an approved count, else
-- the par as it is.
ALTER TABLE stock_venue_settings ADD COLUMN par_mode text CHECK (par_mode IN ('up_to', 'order'));

-- What a venue's trading day took off stock, per item: qty_base in the
-- item's base unit (above zero: taken off; below, a refund given back),
-- cost_per_base pounds per base unit then (the average paid at the venue
-- over the 90 days before the day's end, else the last paid, else the
-- standard price; cost_how says which, null with none), channels how much
-- came from each ({ till, kiosk, online, imported }), at the move's moment
-- on the ledger (the day's last sale counted).
CREATE TABLE stock_usage_days (
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id       uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day            date          NOT NULL,
  item_id        uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base <> 0),
  cost_per_base  numeric(18,8),
  cost_how       text          CHECK (cost_how IN ('average', 'last', 'standard')),
  channels       jsonb         NOT NULL DEFAULT '{}'::jsonb,
  at             timestamptz   NOT NULL,
  computed_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, venue_id, day, item_id)
);
CREATE INDEX stock_usage_days_item ON stock_usage_days (tenant_id, item_id, venue_id, at);

ALTER TABLE stock_usage_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_usage_days FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_usage_days_tenant ON stock_usage_days
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- What sold at a venue on a day, by dish, revenue stream, order type and
-- channel: qty, sales_pence (after discounts, VAT in), net_pence (VAT out),
-- cost (theoretical, pounds: the items it took off at stock_usage_days'
-- costs), uncosted_qty (how many had a gap: no recipe, an option with no
-- rule or not matched, a unit with no size, a draft not checked yet, an item
-- with no price at all), typical_qty (meal deals costed at their typical
-- picks), left_out (an open item typed in on the till, a service: no recipe
-- needed), gaps (what was missing and how to fix it, the first few). A line
-- with no dish (an open item, another till's line not mapped, GloriaFood's
-- by name) has dish_id null and its name.
CREATE TABLE dish_cost_days (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day                date          NOT NULL,
  channel            text          NOT NULL CHECK (channel IN ('till', 'kiosk', 'online', 'imported', 'gloriafood')),
  dish_id            uuid,
  name               text          NOT NULL,
  section_id         uuid,
  section            text,
  revenue_stream_id  uuid,
  order_type_id      uuid,
  recipe_id          uuid,
  recipe_name        text,
  qty                numeric(14,3) NOT NULL,
  sales_pence        bigint        NOT NULL DEFAULT 0,
  net_pence          bigint        NOT NULL DEFAULT 0,
  cost               numeric(16,6),
  uncosted_qty       numeric(14,3) NOT NULL DEFAULT 0,
  typical_qty        numeric(14,3) NOT NULL DEFAULT 0,
  left_out           text          CHECK (left_out IN ('open', 'service', 'gone')),
  gaps               jsonb         NOT NULL DEFAULT '[]'::jsonb,
  computed_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX dish_cost_days_day  ON dish_cost_days (tenant_id, venue_id, day);
CREATE INDEX dish_cost_days_dish ON dish_cost_days (tenant_id, dish_id, day);

ALTER TABLE dish_cost_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_cost_days FORCE ROW LEVEL SECURITY;
CREATE POLICY dish_cost_days_tenant ON dish_cost_days
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Each worked-out day's fingerprint: per channel how many lines sold, how
-- many and when its sales last changed (till checks, online orders, other
-- tills' receipts and how they are mapped), so a run works a day out again
-- only when its sales changed. lines / uncosted_lines: what it found.
CREATE TABLE stock_usage_marks (
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day             date        NOT NULL,
  fingerprint     text        NOT NULL,
  lines           int         NOT NULL DEFAULT 0,
  uncosted_lines  int         NOT NULL DEFAULT 0,
  last_sale_at    timestamptz,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, venue_id, day)
);

ALTER TABLE stock_usage_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_usage_marks FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_usage_marks_tenant ON stock_usage_marks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Each venue's run: claimed with running_until (FOR UPDATE SKIP LOCKED) so
-- two API processes never work one venue out at once; dirty_from the first
-- open day to work out again (a recipe, link, option rule or setting saved;
-- dirty_at when it was asked, cleared by the run that saw it); the last run
-- and its error.
CREATE TABLE stock_usage_venues (
  venue_id       uuid        PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dirty_from     date,
  dirty_at       timestamptz,
  running_until  timestamptz,
  last_run_at    timestamptz,
  last_error     text
);
CREATE INDEX stock_usage_venues_tenant ON stock_usage_venues (tenant_id);

ALTER TABLE stock_usage_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_usage_venues FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_usage_venues_tenant ON stock_usage_venues
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
