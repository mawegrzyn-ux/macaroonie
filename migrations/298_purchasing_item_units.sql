-- 298_purchasing_item_units.sql
--
-- Inventory phase 1 (docs/INVENTORY.md 5.1, 27 Nov 2026): an inventory item
-- gains what recipes need to cost it.
--
-- yield_pct    the usable share after trimming (an onion 88, a whole fish
--              45): what a recipe uses is divided by it to say what has to
--              be bought (edible portion cost = as bought / yield), never
--              multiplied by (1 + waste). 100 = nothing is lost.
-- recipe_unit  the unit a recipe line usually gives it in (a slice, kg),
-- count_unit   and the unit it is usually counted in; both optional, a
--              standard unit of its kind or one of its own units below.
--
-- inv_item_units: the item's own units beyond the standard ones (g, kg, ml,
-- cl, l, each), each as so many of its base unit: "1 slice = 20 g",
-- "1 each = 150 g" for an item kept in grams, "1 tbsp = 15 ml". One function
-- converts (toBase() in shared/costing.js); a unit the item has no size for
-- is refused by name ("Cheddar has no size for a slice").

ALTER TABLE inv_items
  ADD COLUMN yield_pct   numeric(5,2) NOT NULL DEFAULT 100 CHECK (yield_pct >= 1 AND yield_pct <= 100),
  ADD COLUMN recipe_unit text CHECK (recipe_unit IS NULL OR length(btrim(recipe_unit)) BETWEEN 1 AND 30),
  ADD COLUMN count_unit  text CHECK (count_unit IS NULL OR length(btrim(count_unit)) BETWEEN 1 AND 30);

CREATE TABLE inv_item_units (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  name        text          NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 30),
  base_qty    numeric(14,4) NOT NULL CHECK (base_qty > 0),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inv_item_units_name ON inv_item_units (item_id, lower(btrim(name)));
CREATE INDEX inv_item_units_tenant ON inv_item_units (tenant_id, item_id);

ALTER TABLE inv_item_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_item_units FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_item_units_tenant ON inv_item_units
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
