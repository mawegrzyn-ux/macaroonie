BEGIN;

CREATE TABLE order_sheet_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  show_prices boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_sheet_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_sheet_templates_tenant ON order_sheet_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Which venues a template is available at
CREATE TABLE order_sheet_template_venues (
  template_id uuid NOT NULL REFERENCES order_sheet_templates(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, venue_id)
);

-- Items in the template
CREATE TABLE order_sheet_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES order_sheet_templates(id) ON DELETE CASCADE,
  name        text NOT NULL,
  unit        text NOT NULL,
  price       numeric(10,2),
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Suggested qty per item per venue
CREATE TABLE order_sheet_suggested_qty (
  item_id  uuid NOT NULL REFERENCES order_sheet_items(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  qty      numeric(10,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, venue_id)
);

-- Orders
CREATE TABLE order_sheets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id   uuid NOT NULL REFERENCES order_sheet_templates(id) ON DELETE RESTRICT,
  venue_id      uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  delivery_date date NOT NULL,
  status        text NOT NULL DEFAULT 'ordering'
                  CHECK (status IN ('ordering','ready','placed')),
  notes         text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  ready_at      timestamptz,
  placed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_sheets_tenant ON order_sheets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Order line items
CREATE TABLE order_sheet_order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES order_sheets(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES order_sheet_items(id) ON DELETE RESTRICT,
  qty        numeric(10,3),
  unit_price numeric(10,2),
  UNIQUE (order_id, item_id)
);

CREATE INDEX order_sheets_tmpl_venue ON order_sheets (template_id, venue_id, delivery_date DESC);

-- Seed module
INSERT INTO tenant_modules (tenant_id, module_key, is_enabled)
SELECT id, 'order_sheets', false FROM tenants ON CONFLICT DO NOTHING;

UPDATE tenant_roles
SET permissions = permissions || '{"order_sheets":"manage"}'::jsonb
WHERE key IN ('owner','admin','operator');

UPDATE tenant_roles
SET permissions = permissions || '{"order_sheets":"view"}'::jsonb
WHERE key = 'viewer';

COMMIT;
