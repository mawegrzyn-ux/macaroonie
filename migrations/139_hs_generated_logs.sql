-- 139_hs_generated_logs.sql
--
-- Test data tool: fill past H&S logs (fridge/freezer temps, hold checks,
-- cooking checks, deliveries matched to order sheets) and mark past
-- checklists / audits complete for a chosen date range.
--
-- is_generated marks rows the tool created, so "Clear generated" removes
-- only those and never a real reading. A checklist the operator had already
-- started and the tool then completed keeps is_generated = false (it is
-- the operator's row), so clearing doesn't touch it.
--
-- fs_delivery_checks.order_sheet_id links a delivery check to the order
-- it received (the generator sets it; a check per order, never two).

BEGIN;

ALTER TABLE fs_temp_logs        ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;
ALTER TABLE fs_hold_checks      ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;
ALTER TABLE fs_cooking_checks   ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;
ALTER TABLE fs_delivery_checks  ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;
ALTER TABLE checklist_instances ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;
ALTER TABLE order_sheets        ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;

ALTER TABLE fs_delivery_checks
  ADD COLUMN IF NOT EXISTS order_sheet_id uuid REFERENCES order_sheets(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fs_delivery_checks_order_sheet
  ON fs_delivery_checks (order_sheet_id) WHERE order_sheet_id IS NOT NULL;

COMMIT;
