-- 069_order_sheet_items_is_active.sql
-- order_sheet_order_items.item_id is ON DELETE RESTRICT so historical order
-- line items never lose their item reference — but that meant deleting any
-- item (or template) that had ever been ordered threw a raw 500 (FK 23503)
-- instead of doing anything useful. Items get the same is_active soft-delete
-- flag order_sheet_templates already has: the delete routes now archive
-- (is_active = false) instead of hard-deleting when order history exists,
-- and fall back to a real DELETE when it doesn't.

ALTER TABLE order_sheet_items ADD COLUMN is_active boolean NOT NULL DEFAULT true;
