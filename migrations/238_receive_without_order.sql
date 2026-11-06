-- 238_receive_without_order.sql
--
-- Booking in a delivery that has no purchase order (6 Nov 2026): goods
-- the supplier brought without being asked, a standing delivery nobody
-- orders in the app, a cash and carry run. Off unless the group switches
-- it on in Purchasing settings.
--
--   purchasing_settings          one row per group (no row = the defaults)
--     receive_without_order      off | anyone (everyone who books deliveries
--                                in) | approvers (only people with
--                                Purchasing approval)
--   purchase_orders.no_order     the purchase order was made when the
--                                delivery was booked in: its lines are what
--                                arrived (ordered = received), it was never
--                                sent to the supplier, its delivery date is
--                                the day it arrived. Received from the start.
--   purchase_invoices            an invoice can be read before its delivery
--                                has an order: venue_id + supplier_id say
--                                whose it is, po_id is set when the delivery
--                                is saved.

CREATE TABLE IF NOT EXISTS purchasing_settings (
  tenant_id             uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  receive_without_order text        NOT NULL DEFAULT 'off'
                                    CHECK (receive_without_order IN ('off', 'anyone', 'approvers')),
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchasing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchasing_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchasing_settings;
CREATE POLICY tenant_isolation ON purchasing_settings USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS no_order boolean NOT NULL DEFAULT false;

ALTER TABLE purchase_invoices
  ALTER COLUMN po_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS venue_id    uuid REFERENCES venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE;
ALTER TABLE purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_whose_check;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_whose_check
  CHECK (po_id IS NOT NULL OR (venue_id IS NOT NULL AND supplier_id IS NOT NULL));
