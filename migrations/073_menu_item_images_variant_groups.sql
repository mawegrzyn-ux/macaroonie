-- ============================================================
-- 073_menu_item_images_variant_groups.sql
--
-- Menu items can carry a photo. Variant groups (Protein, Size, …)
-- are tenant-level libraries: attach a group to any dish and optionally
-- override an option's price on that dish. Ad-hoc menu_item_variants
-- stay for one-off options that aren't worth a shared group.
-- ============================================================

BEGIN;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE TABLE menu_variant_groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(name) > 0),
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX menu_variant_groups_tenant_idx
  ON menu_variant_groups (tenant_id, sort_order);

ALTER TABLE menu_variant_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_variant_groups_tenant ON menu_variant_groups
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_menu_variant_groups_updated_at
  BEFORE UPDATE ON menu_variant_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_variant_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES menu_variant_groups(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(label) > 0),
  price_pence  int  NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  sort_order   int  NOT NULL DEFAULT 0
);

CREATE INDEX menu_variant_options_group_idx
  ON menu_variant_options (group_id, sort_order);

ALTER TABLE menu_variant_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_variant_options_tenant ON menu_variant_options
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE menu_item_variant_groups (
  item_id     uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES menu_variant_groups(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sort_order  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);

CREATE INDEX menu_item_variant_groups_group_idx
  ON menu_item_variant_groups (group_id);

ALTER TABLE menu_item_variant_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_item_variant_groups_tenant ON menu_item_variant_groups
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE menu_item_variant_prices (
  item_id      uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  option_id    uuid NOT NULL REFERENCES menu_variant_options(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  price_pence  int  NOT NULL CHECK (price_pence >= 0),
  PRIMARY KEY (item_id, option_id)
);

ALTER TABLE menu_item_variant_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_item_variant_prices_tenant ON menu_item_variant_prices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
