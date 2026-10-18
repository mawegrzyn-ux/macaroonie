-- 180_purchasing_approval.sql
--
-- Orders can need approval, and requests and purchase orders can be split
-- into a second order for another day.
--
--   supply_orders.status 'requested'
--       sent for approval by someone without Purchasing approval: waits for
--       a second person, who can change it, place it, split it or send it
--       back (status draft again, with return_note).
--   supply_orders.requested_by / requested_at / requested_lines
--       who asked and what they asked for ({ item_id: { qty, quote_id } }),
--       so the approver's changes show against the request.
--   supply_orders.supplier_options
--       { supplier_id: { delivery_date, notes } } wanted by the requester;
--       placing starts from them.
--   supply_orders.returned_by / returned_at / return_note
--       the last time a request was sent back, and why.
--   supply_orders.split_from, purchase_orders.split_from
--       the order this one was split off.
--   purchase_orders.requested_by
--       who asked for the order when it went through approval.
--   purchase_orders.amended_at / amended_by
--       changed after it went to the supplier (a split): it goes back to
--       To send, and its email says it replaces the earlier copy.
--
-- Module purchasing_approve: change and place orders. Roles that set their
-- own Purchasing level get the same level here, so nobody's ordering
-- changes until a role is lowered.

BEGIN;

ALTER TABLE supply_orders DROP CONSTRAINT IF EXISTS supply_orders_status_check;
ALTER TABLE supply_orders ADD CONSTRAINT supply_orders_status_check
  CHECK (status IN ('draft', 'requested', 'submitted'));

ALTER TABLE supply_orders
  ADD COLUMN IF NOT EXISTS requested_by     text,
  ADD COLUMN IF NOT EXISTS requested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS requested_lines  jsonb,
  ADD COLUMN IF NOT EXISTS supplier_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS returned_by      text,
  ADD COLUMN IF NOT EXISTS returned_at      timestamptz,
  ADD COLUMN IF NOT EXISTS return_note      text,
  ADD COLUMN IF NOT EXISTS split_from       uuid REFERENCES supply_orders(id) ON DELETE SET NULL;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS requested_by text,
  ADD COLUMN IF NOT EXISTS amended_at   timestamptz,
  ADD COLUMN IF NOT EXISTS amended_by   text,
  ADD COLUMN IF NOT EXISTS split_from   uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;

-- ── Module ───────────────────────────────────────────────────
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT t.id, 'purchasing_approve', COALESCE(m.is_enabled, true)
  FROM tenants t
  LEFT JOIN tenant_modules m ON m.tenant_id = t.id AND m.module_key = 'purchasing'
ON CONFLICT DO NOTHING;

UPDATE tenant_roles
   SET permissions = permissions || jsonb_build_object('purchasing_approve', permissions -> 'purchasing')
 WHERE permissions ? 'purchasing' AND NOT (permissions ? 'purchasing_approve');

COMMIT;
