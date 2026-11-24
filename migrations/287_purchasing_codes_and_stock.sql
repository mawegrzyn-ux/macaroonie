-- Pepper-first step 8B3 (docs/PEPPER_FIRST.md 13 decision 11; "a product code
-- (GTIN) on inventory items and supplier products" and "stock on hand" in
-- reports/AI first back office strategy.md): product codes and stock on hand.
--
-- Codes: an inventory item and a supplier's product each take a barcode, a
-- GTIN-8, 12, 13 or 14 with its check digit checked by the API
-- (barcodeProblem() in shared/catalogue.js, the rule menus' dishes use). The
-- group's own code stays inv_items.code and the supplier's inv_quotes.supplier_code,
-- free text as before.
--
-- Stock on hand per item per venue: the last stock count plus what was
-- received since (purchase_order_lines.received_qty in the line's packs),
-- less what sales used where a dish is linked to the items it uses (no such
-- link exists yet, so nothing is taken off). The rule is stockOnHand() in
-- shared/procurement.js; a count is a venue's quantities of some items at a
-- moment, in each item's base unit (g, ml or each).

ALTER TABLE inv_items  ADD COLUMN barcode text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$');
ALTER TABLE inv_quotes ADD COLUMN barcode text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$');
CREATE INDEX inv_items_barcode  ON inv_items  (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX inv_quotes_barcode ON inv_quotes (tenant_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE stock_counts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  counted_at  timestamptz NOT NULL DEFAULT now(),
  counted_by  text,
  note        text        CHECK (note IS NULL OR length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_counts_venue ON stock_counts (tenant_id, venue_id, counted_at DESC);

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_counts_tenant ON stock_counts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE stock_count_lines (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_id   uuid          NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id    uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty_base   numeric(16,4) NOT NULL CHECK (qty_base >= 0),
  UNIQUE (count_id, item_id)
);
CREATE INDEX stock_count_lines_item ON stock_count_lines (tenant_id, item_id);

ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_count_lines_tenant ON stock_count_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
