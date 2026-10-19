-- 190_print_designs.sql
--
-- Designs for printed kitchen tickets and receipts (shared/pos/ticketLayout.js).
--
--   print_designs            company wide: kind kitchen | receipt, a name and
--                            a layout (ordered blocks with their options)
--   print_design_uses        which design prints where: use kitchen | receipt
--                            (till receipts and bills) | kiosk_receipt, for
--                            the whole company (venue_id NULL) or one location
--   print_design_variations  what one location changes in a design: its
--                            words (texts: { blockId: { key: text } }) and the
--                            blocks it leaves out (hidden)
--
-- With no design the built-in layouts print what tickets looked like before.
-- The receipt and bill footers move out of Till setup's settings into a
-- receipt design: a tenant that had set any gets a design named "Receipt"
-- (the built-in layout) used company wide, with each location's footers as
-- that location's words.

BEGIN;

CREATE TABLE IF NOT EXISTS print_designs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('kitchen', 'receipt')),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  layout      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
CREATE INDEX IF NOT EXISTS print_designs_tenant ON print_designs (tenant_id, kind, name);

CREATE TABLE IF NOT EXISTS print_design_uses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid REFERENCES venues(id) ON DELETE CASCADE,
  use         text NOT NULL CHECK (use IN ('kitchen', 'receipt', 'kiosk_receipt')),
  design_id   uuid NOT NULL REFERENCES print_designs(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
CREATE UNIQUE INDEX IF NOT EXISTS print_design_uses_company ON print_design_uses (tenant_id, use) WHERE venue_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS print_design_uses_venue ON print_design_uses (venue_id, use) WHERE venue_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS print_design_variations (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  design_id   uuid NOT NULL REFERENCES print_designs(id) ON DELETE CASCADE,
  texts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden      text[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (venue_id, design_id)
);
CREATE INDEX IF NOT EXISTS print_design_variations_design ON print_design_variations (design_id);

ALTER TABLE print_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_designs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON print_designs;
CREATE POLICY tenant_isolation ON print_designs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE print_design_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_design_uses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON print_design_uses;
CREATE POLICY tenant_isolation ON print_design_uses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE print_design_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_design_variations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON print_design_variations;
CREATE POLICY tenant_isolation ON print_design_variations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- Footers set in Till setup carry over into a receipt design.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pos_settings' AND column_name = 'receipt_footer') THEN
    INSERT INTO print_designs (tenant_id, kind, name, layout, created_by)
    SELECT DISTINCT s.tenant_id, 'receipt', 'Receipt', '{"blocks": [
        {"id": "r1", "type": "venue", "opts": {"name": true, "address": true, "vat": true, "size": "big"}},
        {"id": "r2", "type": "space", "opts": {"lines": 1}},
        {"id": "r3", "type": "heading", "opts": {"receipt_text": "", "bill_text": "BILL - NOT A RECEIPT", "size": "normal"}},
        {"id": "r4", "type": "details", "opts": {"fields": ["where", "check", "server", "covers", "type", "tent", "date"]}},
        {"id": "r5", "type": "rule", "opts": {"char": "-"}},
        {"id": "r6", "type": "items", "opts": {"extras": true}},
        {"id": "r7", "type": "rule", "opts": {"char": "-"}},
        {"id": "r8", "type": "totals", "opts": {"subtotal": true, "size": "tall"}},
        {"id": "r9", "type": "vat", "opts": {}},
        {"id": "r10", "type": "payments", "opts": {}},
        {"id": "r11", "type": "space", "opts": {"lines": 1}},
        {"id": "r12", "type": "footer", "opts": {"receipt_text": "Thank you", "bill_text": ""}}
      ]}'::jsonb, 'migration 190'
      FROM pos_settings s
     WHERE coalesce(s.receipt_footer, '') <> '' OR coalesce(s.bill_footer, '') <> '';

    INSERT INTO print_design_uses (tenant_id, venue_id, use, design_id, updated_by)
    SELECT d.tenant_id, NULL, 'receipt', d.id, 'migration 190'
      FROM print_designs d WHERE d.created_by = 'migration 190';

    INSERT INTO print_design_variations (tenant_id, venue_id, design_id, texts, updated_by)
    SELECT s.tenant_id, s.venue_id, d.id,
           jsonb_build_object('r12', jsonb_strip_nulls(jsonb_build_object(
             'receipt_text', nullif(s.receipt_footer, ''), 'bill_text', nullif(s.bill_footer, '')))),
           'migration 190'
      FROM pos_settings s
      JOIN print_designs d ON d.tenant_id = s.tenant_id AND d.created_by = 'migration 190'
     WHERE coalesce(s.receipt_footer, '') <> '' OR coalesce(s.bill_footer, '') <> '';

    ALTER TABLE pos_settings DROP COLUMN receipt_footer, DROP COLUMN bill_footer;
  END IF;
END $$;

COMMIT;
