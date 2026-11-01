-- 233_purchasing_delivery_and_sent.sql
--
-- Purchasing step 2 (1 Nov 2026).
--
-- Delivery details per venue and supplier (supplier_venues, beside the
-- account number, delivery days and cutoff it already holds):
--   lead_days            days' notice this venue needs (null = the supplier's)
--   delivery_phone       the number the driver rings at this venue
--   driver_instructions  how to deliver here; starts the note on each order
--   slot_from / slot_to  the delivery window wanted
--
-- Sent tracking: the supplier's own reference for an order (their order
-- number, e.g. S043172591), and suppliers that want it every time an order
-- is marked sent.

ALTER TABLE supplier_venues
  ADD COLUMN lead_days           int CHECK (lead_days IS NULL OR lead_days BETWEEN 0 AND 30),
  ADD COLUMN delivery_phone      text,
  ADD COLUMN driver_instructions text,
  ADD COLUMN slot_from           time,
  ADD COLUMN slot_to             time;

ALTER TABLE suppliers
  ADD COLUMN ref_required boolean NOT NULL DEFAULT false;

ALTER TABLE purchase_orders
  ADD COLUMN supplier_ref text;

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_ref_idx
  ON purchase_orders (tenant_id, lower(supplier_ref)) WHERE supplier_ref IS NOT NULL;

-- Placing an order for a supplier and day that already has a purchase order
-- waiting to be sent can add the lines to that one instead of making a
-- second: the restaurant order then lists that purchase order too.
ALTER TABLE supply_orders
  ADD COLUMN added_to_po_ids uuid[] NOT NULL DEFAULT '{}';

-- Orders put in on the supplier's own website or app (the checkout the
-- delivery details are copied into) are marked sent that way.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_sent_via_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_sent_via_check
  CHECK (sent_via IS NULL OR sent_via IN ('email', 'print', 'excel', 'pdf', 'phone', 'website', 'other'));
