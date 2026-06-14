-- 067_order_sheet_item_archive.sql
-- Soft-delete (archive) for order sheet items. Archived items are hidden from
-- the template editor and excluded from new orders, but remain referenced by
-- existing order_sheet_order_items rows so order history stays intact.
-- This replaces hard-deleting items (which hit the ON DELETE RESTRICT FK on
-- order_sheet_order_items.item_id whenever an item had ever been ordered).

BEGIN;

ALTER TABLE order_sheet_items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS order_sheet_items_active
  ON order_sheet_items (template_id, is_active);

COMMIT;
