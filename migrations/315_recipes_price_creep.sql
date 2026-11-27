-- Inventory phase 7b (docs/INVENTORY.md 8.2, 10.4): price creep. When a
-- supplier price changes (a price list imported, an invoice's prices applied,
-- a price typed in or edited), the dishes whose recipes use the changed items
-- are costed before and after the change, and those that crossed their cost
-- target or limit are recorded here (services/priceCreepSvc.js), for the Menu
-- margins page, Today and the report subject Cost alerts; the rule trigger
-- dish_over_target fires from the same place (cost_target_states, migration
-- 313, kept by one function shared with the hourly sweep).
--
-- Dish ids are plain (the menu save deletes and re-inserts dishes under the
-- same ids): nothing here points at menu_items with a foreign key.

-- The price history (migration 153) kept each pack price but not the pack it
-- was for, so a cost per base unit at a past moment couldn't be read back
-- when a pack size changed. Each row now keeps the pack's size in the item's
-- base unit (written from here on, also when only the pack changes); the
-- latest company row of each supplier price takes the pack it has now, which
-- is what it was for since that row was written. Older rows stay unknown.
ALTER TABLE inv_price_history ADD COLUMN IF NOT EXISTS pack_base_qty numeric(16,4)
  CHECK (pack_base_qty IS NULL OR pack_base_qty > 0);

UPDATE inv_price_history h
   SET pack_base_qty = q.pack_base_qty
  FROM inv_quotes q
 WHERE q.id = h.quote_id AND q.tenant_id = h.tenant_id AND h.pack_base_qty IS NULL AND h.venue_id IS NULL
   AND h.id = (SELECT h2.id FROM inv_price_history h2
                WHERE h2.tenant_id = h.tenant_id AND h2.quote_id = h.quote_id AND h2.venue_id IS NULL
                ORDER BY h2.changed_at DESC, h2.id DESC LIMIT 1);

CREATE INDEX IF NOT EXISTS inv_price_history_tenant_quote ON inv_price_history (tenant_id, quote_id, changed_at);

-- A dish at a venue that crossed its cost target (watch) or its limit (over)
-- when a supplier price changed: its cost % before and after at its worst
-- order type, the threshold it crossed, what moved (causes: the items whose
-- cost per base unit changed, with the figures; cause: the same in words,
-- no money), where the change came from, and who marked it seen.
CREATE TABLE cost_alerts (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id       uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  dish_id        uuid          NOT NULL,
  name           text          NOT NULL,
  menu_id        uuid,
  menu           text,
  section        text,
  order_type_id  uuid,
  order_type     text,
  old_cost_pct   numeric(8,2),
  new_cost_pct   numeric(8,2)  NOT NULL,
  old_band       text          CHECK (old_band IS NULL OR old_band IN ('good', 'watch', 'over')),
  new_band       text          NOT NULL CHECK (new_band IN ('watch', 'over')),
  threshold_pct  numeric(6,2)  NOT NULL,
  target_pct     numeric(6,2),
  limit_pct      numeric(6,2),
  source         text          NOT NULL CHECK (source IN ('manual', 'import', 'price_update', 'invoice')),
  cause          text          NOT NULL,
  causes         jsonb         NOT NULL DEFAULT '[]'::jsonb,
  po_id          uuid          REFERENCES purchase_orders(id) ON DELETE SET NULL,
  changed_by     text,
  day            date          NOT NULL,
  at             timestamptz   NOT NULL DEFAULT now(),
  seen_by        text,
  seen_at        timestamptz
);
CREATE INDEX cost_alerts_venue ON cost_alerts (tenant_id, venue_id, at DESC);
CREATE INDEX cost_alerts_unseen ON cost_alerts (tenant_id, at DESC) WHERE seen_at IS NULL;

ALTER TABLE cost_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY cost_alerts_tenant ON cost_alerts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
