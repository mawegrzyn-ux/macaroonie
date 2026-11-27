-- 300_recipes_tables.sql
--
-- Inventory phase 1 (docs/INVENTORY.md 5.3, 10.1; 27 Nov 2026): recipes and
-- prep recipes (the modules are 299, the menu link 301).
--
-- A recipe is a dish (what a guest is served, costed per portion) or a prep
-- recipe (a batch made in the kitchen: a sauce, a marinade; costed per unit
-- it makes, after what cooking loses, and used inside other recipes). Its
-- lines are each an inventory item or a prep recipe, a quantity and a unit
-- (a standard unit, or one of the item's own units), and optionally a yield
-- of their own when this recipe trims harder than usual. What a recipe costs
-- is never stored: shared/costing.js works it out at each venue's prices.
--
-- Recipes are the group's; a variation (a takeaway version, a venue's own)
-- is a recipe of its own whose variant_of names the recipe it varies, so the
-- list shows them together. Which variation a dish uses where comes with the
-- links to dishes (phase 2).
--
-- A recipe inside itself, directly or through other recipes, and nesting
-- deeper than five levels are refused when a recipe is saved
-- (nestingProblem() in shared/costing.js); the database only refuses a line
-- naming its own recipe.

CREATE TABLE recipes (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              text          NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  kind              text          NOT NULL DEFAULT 'dish' CHECK (kind IN ('dish', 'prep')),
  category          text          CHECK (category IS NULL OR length(category) <= 100),
  -- What a prep recipe makes (before its loss): 2 l, 40 portion ...
  yield_qty         numeric(14,4) CHECK (yield_qty IS NULL OR yield_qty > 0),
  yield_unit        text          CHECK (yield_unit IS NULL OR length(btrim(yield_unit)) BETWEEN 1 AND 30),
  -- How many portions a dish recipe serves (1 when empty).
  portions          numeric(10,2) CHECK (portions IS NULL OR portions > 0),
  -- What cooking loses from a prep batch (a stock reducing), in percent.
  loss_pct          numeric(5,2)  NOT NULL DEFAULT 0 CHECK (loss_pct >= 0 AND loss_pct < 100),
  method            text          CHECK (method IS NULL OR length(method) <= 20000),
  photo_url         text          CHECK (photo_url IS NULL OR length(photo_url) <= 1000),
  shelf_life_hours  int           CHECK (shelf_life_hours IS NULL OR shelf_life_hours BETWEEN 1 AND 8760),
  code              text          CHECK (code IS NULL OR length(code) <= 60),
  status            text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live')),
  variant_of        uuid          REFERENCES recipes(id) ON DELETE SET NULL,
  notes             text          CHECK (notes IS NULL OR length(notes) <= 2000),
  is_active         boolean       NOT NULL DEFAULT true,
  created_by        text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CHECK (variant_of IS NULL OR variant_of <> id)
);
CREATE INDEX recipes_tenant_name ON recipes (tenant_id, lower(name));
CREATE INDEX recipes_variant_of ON recipes (tenant_id, variant_of) WHERE variant_of IS NOT NULL;

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY recipes_tenant ON recipes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE recipe_lines (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id      uuid          NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  sort_order     int           NOT NULL DEFAULT 0,
  -- Exactly one of an inventory item or a prep recipe. Neither may be
  -- deleted while a line uses it: an item is switched off instead, a recipe
  -- used inside another is refused (routes/inventory.js, routes/recipes.js).
  item_id        uuid          REFERENCES inv_items(id),
  sub_recipe_id  uuid          REFERENCES recipes(id),
  qty            numeric(14,4) NOT NULL CHECK (qty > 0),
  unit           text          NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 30),
  yield_pct      numeric(5,2)  CHECK (yield_pct IS NULL OR (yield_pct >= 1 AND yield_pct <= 100)),
  note           text          CHECK (note IS NULL OR length(note) <= 500),
  CHECK ((item_id IS NULL) <> (sub_recipe_id IS NULL)),
  CHECK (sub_recipe_id IS NULL OR sub_recipe_id <> recipe_id)
);
CREATE INDEX recipe_lines_recipe ON recipe_lines (tenant_id, recipe_id, sort_order);
CREATE INDEX recipe_lines_item ON recipe_lines (tenant_id, item_id) WHERE item_id IS NOT NULL;
CREATE INDEX recipe_lines_sub ON recipe_lines (tenant_id, sub_recipe_id) WHERE sub_recipe_id IS NOT NULL;

ALTER TABLE recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_lines_tenant ON recipe_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
