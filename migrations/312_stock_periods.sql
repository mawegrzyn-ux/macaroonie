-- 312_stock_periods.sql
--
-- Inventory phase 6a (27 Nov 2026; docs/INVENTORY.md 8.1, 11 phase 6,
-- decision D9): stock periods and variance. A period runs between two
-- approved full counts at a venue: made when a full count is approved, the
-- previous approved full count at the venue opening it. For each item in a
-- period, actual usage (opening + received + transfers in - transfers out -
-- returns - closing) is set against theoretical usage (usage from sales in
-- the period) and logged waste, by one rule (shared/variance.js), priced at
-- the average paid at the venue.
--
-- Closing a period (Stock manage) freezes its figures, like a Z: they are
-- kept in figures and never worked out again. The trading days it holds
-- (days_from to days_to) are then closed: usage from sales never works them
-- out again (isDayClosed() in api/src/services/stockUsageSvc.js), and a sale
-- that reaches a closed day late (a hub or a till that syncs later, another
-- till's receipts mapped again) lands in the next open period, marked
-- (stock_usage_late). Reopening is Stock manage, needs a note, and works the
-- period's days out again from the sales, late ones in them.
--
-- Counts, venues and items are foreign keys; nothing here points at a menu row.

-- The variance band the group sets: a venue's period is over the band when
-- its unexplained loss is more than variance_band_pct points of its net food
-- sales; an item is flagged when its unexplained loss is over
-- variance_item_pct of its theoretical usage and over variance_item_pounds.
ALTER TABLE stock_settings
  ADD COLUMN variance_band_pct    numeric(6,2)  NOT NULL DEFAULT 1  CHECK (variance_band_pct >= 0 AND variance_band_pct <= 100),
  ADD COLUMN variance_item_pct    numeric(6,2)  NOT NULL DEFAULT 3  CHECK (variance_item_pct >= 0 AND variance_item_pct <= 1000),
  ADD COLUMN variance_item_pounds numeric(12,2) NOT NULL DEFAULT 50 CHECK (variance_item_pounds >= 0);

-- What a sold dish is (itemType(): food and drink, retail goods or a
-- service), kept with its day so net food sales leave goods and services out.
-- Null: a line with no menu dish (an open item, GloriaFood's by name), counted
-- as food.
ALTER TABLE dish_cost_days ADD COLUMN item_type text CHECK (item_type IN ('food', 'goods', 'service'));

CREATE TABLE stock_periods (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  opening_count_id  uuid        NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  closing_count_id  uuid        NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  from_at           timestamptz NOT NULL,
  to_at             timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- The trading days it holds once closed: usage from sales leaves them alone.
  days_from         date,
  days_to           date,
  -- Its figures as they were when it was closed (the variance view); null while open.
  figures           jsonb,
  closed_by         text,
  closed_at         timestamptz,
  reopened_by       text,
  reopened_at       timestamptz,
  reopen_note       text,
  -- Every closing and reopening: [{ action, by, at, note }].
  history           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (to_at > from_at),
  CHECK (opening_count_id <> closing_count_id),
  UNIQUE (tenant_id, venue_id, closing_count_id)
);
CREATE INDEX stock_periods_venue ON stock_periods (tenant_id, venue_id, to_at);

ALTER TABLE stock_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_periods_tenant ON stock_periods
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- A flagged item looked at (Stock manage, on the Variance tab), with a note.
CREATE TABLE stock_variance_reviews (
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_id    uuid        NOT NULL REFERENCES stock_periods(id) ON DELETE CASCADE,
  item_id      uuid        NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  reviewed_by  text,
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  note         text        CHECK (note IS NULL OR length(note) <= 500),
  PRIMARY KEY (period_id, item_id)
);
CREATE INDEX stock_variance_reviews_tenant ON stock_variance_reviews (tenant_id, period_id);

ALTER TABLE stock_variance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_variance_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_variance_reviews_tenant ON stock_variance_reviews
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Sales that reached a closed day late: the day worked out now less what was
-- kept for it (and what landed late before), never written into the day
-- itself. Each batch lands in a period: the first open period after the
-- closed one (period_id), or the one running since the venue's latest
-- approved full count (null) until a full count makes it a period. On the
-- ledger its items sit at the day's last sale (at), so on hand after the
-- closed period's closing count is as it was; in variance they count in the
-- period they landed in, marked. net_food_pence / net_pence / cost: what the
-- late sales add to the day's net food sales, net sales and theoretical cost.
CREATE TABLE stock_usage_late (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day               date          NOT NULL,
  closed_period_id  uuid          REFERENCES stock_periods(id) ON DELETE SET NULL,
  period_id         uuid          REFERENCES stock_periods(id) ON DELETE SET NULL,
  at                timestamptz   NOT NULL,
  lines             int           NOT NULL DEFAULT 0,
  net_pence         bigint        NOT NULL DEFAULT 0,
  net_food_pence    bigint        NOT NULL DEFAULT 0,
  cost              numeric(16,6),
  found_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX stock_usage_late_venue ON stock_usage_late (tenant_id, venue_id, day);
CREATE INDEX stock_usage_late_period ON stock_usage_late (tenant_id, period_id);

ALTER TABLE stock_usage_late ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_usage_late FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_usage_late_tenant ON stock_usage_late
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE stock_usage_late_items (
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  late_id        uuid          NOT NULL REFERENCES stock_usage_late(id) ON DELETE CASCADE,
  item_id        uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base <> 0),
  cost_per_base  numeric(18,8),
  PRIMARY KEY (late_id, item_id)
);
CREATE INDEX stock_usage_late_items_item ON stock_usage_late_items (tenant_id, item_id);

ALTER TABLE stock_usage_late_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_usage_late_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_usage_late_items_tenant ON stock_usage_late_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Periods between the approved full counts already taken at each venue (pre-production: a few test counts).
INSERT INTO stock_periods (tenant_id, venue_id, opening_count_id, closing_count_id, from_at, to_at)
SELECT x.tenant_id, x.venue_id, x.prev_id, x.id, x.prev_at, x.counted_at
  FROM (
    SELECT c.tenant_id, c.venue_id, c.id, c.counted_at,
           lag(c.id) OVER w AS prev_id, lag(c.counted_at) OVER w AS prev_at
      FROM stock_counts c
     WHERE c.status = 'approved' AND c.kind = 'full'
    WINDOW w AS (PARTITION BY c.tenant_id, c.venue_id ORDER BY c.counted_at, c.created_at)
  ) x
 WHERE x.prev_id IS NOT NULL AND x.counted_at > x.prev_at
ON CONFLICT DO NOTHING;
