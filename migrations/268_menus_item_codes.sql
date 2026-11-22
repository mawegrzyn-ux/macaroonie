-- Menus as catalogues, step 4 (docs/CATALOGUE.md 4.3, 4.6): product codes
-- and barcodes. A dish has an optional product code (sku, the business's own,
-- up to 40 characters) and barcode (GTIN-8, 12, 13 or 14 digits; the check
-- digit is checked by the API, barcodeProblem() in shared/catalogue.js). Each
-- option of a group attached to a dish can have its own (a T-shirt's sizes),
-- in a table of its own so a row of menu_item_variant_prices keeps meaning
-- "this dish's own price". Codes are unique within a menu (checked by the API).
ALTER TABLE menu_items
  ADD COLUMN sku text CHECK (sku IS NULL OR length(sku) BETWEEN 1 AND 40),
  ADD COLUMN barcode text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$');

CREATE TABLE menu_item_option_codes (
  item_id    uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  option_id  uuid NOT NULL REFERENCES menu_variant_options(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku        text CHECK (sku IS NULL OR length(sku) BETWEEN 1 AND 40),
  barcode    text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$'),
  PRIMARY KEY (item_id, option_id),
  CHECK (sku IS NOT NULL OR barcode IS NOT NULL)
);
CREATE INDEX menu_item_option_codes_tenant ON menu_item_option_codes (tenant_id);
CREATE INDEX menu_item_option_codes_option ON menu_item_option_codes (option_id);

ALTER TABLE menu_item_option_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_option_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY menu_item_option_codes_tenant ON menu_item_option_codes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
