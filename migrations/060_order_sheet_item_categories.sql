-- Add optional category text to order sheet items for grouping
ALTER TABLE order_sheet_items ADD COLUMN IF NOT EXISTS category text;
