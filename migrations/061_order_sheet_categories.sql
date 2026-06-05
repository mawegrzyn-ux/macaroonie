-- 061_order_sheet_categories.sql
-- Replaces the free-text category column (migration 060) with a proper
-- per-template categories table. Items reference a category by FK.

CREATE TABLE order_sheet_template_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id uuid        NOT NULL REFERENCES order_sheet_templates(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_sheet_template_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON order_sheet_template_categories
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- FK column on items (nullable — items can be uncategorised)
ALTER TABLE order_sheet_items
  ADD COLUMN category_id uuid REFERENCES order_sheet_template_categories(id) ON DELETE SET NULL;

-- Drop the free-text column from migration 060
ALTER TABLE order_sheet_items DROP COLUMN IF EXISTS category;
