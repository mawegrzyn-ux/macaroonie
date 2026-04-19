-- 031_expense_categories.sql
--
-- Adds expense category tags for the cash reconciliation module.
-- Replaces the free-text `category` field on cash_expenses with a proper
-- FK-linked config table, allowing operators to define tag chips in settings.
-- The old `category text` column is kept for backward-compatibility only.

BEGIN;

CREATE TABLE cash_expense_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  name        text        NOT NULL,
  colour      text,                               -- optional hex colour for the chip
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_expense_categories_tenant ON cash_expense_categories
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Add category_id FK on expenses; old category text stays for legacy rows
ALTER TABLE cash_expenses
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES cash_expense_categories(id) ON DELETE SET NULL;

COMMIT;
