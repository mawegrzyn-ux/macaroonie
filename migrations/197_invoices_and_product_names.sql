-- 197_invoices_and_product_names.sql
--
-- Supplier product names, invoices read on receiving.
--
--   inv_quotes.product_name   the supplier's own name for what it sells on
--                             this quote (a brand or a variation: inventory
--                             item "Ketchup", quote "Heinz Tomato Ketchup
--                             2 x 4.5 kg"). Optional; the item's name stays
--                             the one staff order by. Copied onto purchase
--                             order lines (purchase_order_lines.product_name)
--                             and printed on the supplier's copy.
--
--   purchase_invoices         a supplier invoice (or delivery note) read by
--                             Pepper while booking a delivery in
--                             (POST /api/ai/invoices/read): the files, what
--                             was read (header and lines, jsonb) and which
--                             order line or catalogue product each invoice
--                             line matched. applied_at is set when a
--                             delivery is saved with it.
--
--   purchase_order_lines      invoice_* : what the invoice said for the line
--                             (product, code, pack as printed, price per
--                             pack ex VAT, VAT %), kept beside the ordered
--                             price. added_on_receipt: a line that wasn't
--                             ordered but arrived (qty 0, received_qty set);
--                             pack_spec { name, count, qty, unit } for such a
--                             line with no supplier quote yet, so it can be
--                             added to the price list later.
--
--   inv_price_history         source 'invoice' and po_id: a price changed
--                             from a delivery's invoice.

ALTER TABLE inv_quotes ADD COLUMN IF NOT EXISTS product_name text;

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_id              uuid          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  files              jsonb         NOT NULL DEFAULT '[]'::jsonb,
  supplier_name      text,
  invoice_number     text,
  invoice_date       date,
  prices_include_vat boolean       NOT NULL DEFAULT false,
  subtotal           numeric(12,2),
  vat                numeric(12,2),
  delivery_charge    numeric(12,2),
  total              numeric(12,2),
  lines              jsonb         NOT NULL DEFAULT '[]'::jsonb,
  notes              text,
  read_by            text,
  read_at            timestamptz   NOT NULL DEFAULT now(),
  applied_by         text,
  applied_at         timestamptz
);
CREATE INDEX IF NOT EXISTS purchase_invoices_po ON purchase_invoices (tenant_id, po_id, read_at DESC);

ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_invoices;
CREATE POLICY tenant_isolation ON purchase_invoices USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS product_name     text,
  ADD COLUMN IF NOT EXISTS added_on_receipt boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pack_spec        jsonb,
  ADD COLUMN IF NOT EXISTS invoice_id       uuid          REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_name     text,
  ADD COLUMN IF NOT EXISTS invoice_code     text,
  ADD COLUMN IF NOT EXISTS invoice_pack     text,
  ADD COLUMN IF NOT EXISTS invoice_price    numeric(12,4) CHECK (invoice_price IS NULL OR invoice_price >= 0),
  ADD COLUMN IF NOT EXISTS invoice_vat_rate numeric(5,2)  CHECK (invoice_vat_rate IS NULL OR (invoice_vat_rate >= 0 AND invoice_vat_rate <= 100));

-- A line added on receipt was never ordered: ordered quantity 0.
ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_qty_check;
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_qty_check
  CHECK (qty > 0 OR (added_on_receipt AND qty = 0));

ALTER TABLE inv_price_history ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE inv_price_history DROP CONSTRAINT IF EXISTS inv_price_history_source_check;
ALTER TABLE inv_price_history ADD CONSTRAINT inv_price_history_source_check
  CHECK (source IN ('manual', 'import', 'invoice'));
