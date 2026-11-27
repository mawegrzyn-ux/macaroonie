-- 310_stock_void_waste.sql
--
-- Inventory phase 4b review fixes (27 Nov 2026; docs/INVENTORY.md 6.3,
-- decision D9): what a till void marked wasted took off stock, kept. A void
-- (pos_check_lines with void_waste) is waste by itself and stays the till's
-- record, but its breakdown into items comes from the recipe its dish used,
-- which reads today's menus and recipes: broken in afresh on every read, a
-- dish that later left every menu (or a link changed) took the void's waste
-- out of on hand, the ledger, count reviews and the Waste report back in
-- time. So the breakdown is kept here the first time stock reads the void
-- (api/src/services/stockSvc.js loadWastedVoids(), and the sweep every few
-- minutes, jobs/stock-voids.js), with each item's cost at the void's moment.
-- While the void's till day is open it is broken in again on each read (D9:
-- open days are recomputed), unless its dish is on no menu now; once the
-- day is closed, the kept breakdown is final.
--
-- Keyed by the till line's id with no foreign key to pos_check_lines: the
-- till rewrites a check's lines on every save (posSvc.js saveCheck()), so a
-- cascade from them would drop the breakdown each time. The check is kept
-- (pos_checks rows are only ever updated), so the breakdown goes with it.
-- at and qty are the void's moment and quantity it was broken in for: a void
-- whose own record changed since (voided again, another quantity) is broken
-- in again.

CREATE TABLE stock_void_waste (
  tenant_id    uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  line_id      text          NOT NULL,
  check_id     text          NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  venue_id     uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  at           timestamptz   NOT NULL,
  qty          numeric(16,4) NOT NULL,
  recipe_id    uuid,
  recipe_name  text,
  gaps         jsonb         NOT NULL DEFAULT '[]'::jsonb,
  made_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, line_id)
);
CREATE INDEX stock_void_waste_venue ON stock_void_waste (tenant_id, venue_id, at);

ALTER TABLE stock_void_waste ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_void_waste FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_void_waste_tenant ON stock_void_waste
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- The items a void took off: qty_base in the item's base unit (above zero:
-- taken off), cost_per_base pounds per base unit at the venue at the void's
-- moment (the average paid then, else the last paid; null with nothing paid).
CREATE TABLE stock_void_waste_items (
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  line_id        text          NOT NULL,
  item_id        uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base <> 0),
  cost_per_base  numeric(18,8),
  PRIMARY KEY (tenant_id, line_id, item_id),
  FOREIGN KEY (tenant_id, line_id) REFERENCES stock_void_waste (tenant_id, line_id) ON DELETE CASCADE
);
CREATE INDEX stock_void_waste_items_item ON stock_void_waste_items (tenant_id, item_id);

ALTER TABLE stock_void_waste_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_void_waste_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_void_waste_items_tenant ON stock_void_waste_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
