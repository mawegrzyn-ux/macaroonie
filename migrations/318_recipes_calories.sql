-- Inventory phase 8b (docs/INVENTORY.md 8.3): suggested calories.
--
-- 1. An inventory item's energy (inv_items, the purchasing area's table):
--    kcal_per_100g for an item kept in grams or millilitres (per 100 g, or
--    per 100 ml), kcal_each for an item kept in each (per one). Of the part
--    that goes into a recipe (after trimming): a recipe line's quantity is
--    what is used. Null is unknown, a gap, never nothing. kcal_source says
--    where it came from ("McCance and Widdowson", "the supplier's label").
-- 2. calorie_checks: one row per menu dish, like allergen_checks: the
--    dish's declared calories (menu_items.calories, in the menu's draft)
--    against the energy of one serving of its recipe at each scope it is
--    sold at (shared/calorieCheck.js, on the cost engine's own walk), worked
--    out when the Allergens tab, the recipe editor or Pepper asks and when
--    something that could change it changes, and stored so a decision holds:
--    open, accepted (the figure was written into the menu's draft through the
--    menus area's own save) or dismissed (with a note; it holds while the
--    declared figure is the same and the suggestion stays within the
--    tolerance of what was dismissed). Nothing here changes a dish by itself.
--
-- Dish and menu ids are plain (the menu save re-inserts dishes under the
-- same ids); the nightly recipe links sweep deletes checks of dishes on no
-- menu.

ALTER TABLE inv_items
  ADD COLUMN IF NOT EXISTS kcal_per_100g numeric(8,2) CHECK (kcal_per_100g IS NULL OR (kcal_per_100g >= 0 AND kcal_per_100g <= 900)),
  ADD COLUMN IF NOT EXISTS kcal_each     numeric(9,2) CHECK (kcal_each IS NULL OR (kcal_each >= 0 AND kcal_each <= 100000)),
  ADD COLUMN IF NOT EXISTS kcal_source   text         CHECK (kcal_source IS NULL OR length(kcal_source) <= 300);

CREATE TABLE calorie_checks (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dish_id        uuid         NOT NULL,
  menu_id        uuid,
  dish           text         NOT NULL,
  menu           text,
  section        text,
  venue_ids      uuid[]       NOT NULL DEFAULT '{}',
  status         text         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  -- What differs: missing (none declared), differs (beyond the tolerance),
  -- under (what is known already comes to more than the dish declares).
  kind           text         CHECK (kind IS NULL OR kind IN ('missing', 'differs', 'under')),
  suggested_kcal integer,
  min_kcal       integer,
  max_kcal       integer,
  declared_kcal  integer,
  fingerprint    text         NOT NULL DEFAULT '',
  complete       boolean      NOT NULL DEFAULT false,
  gaps           integer      NOT NULL DEFAULT 0,
  -- Each scope group: where, the recipe, its kcal, whether known, its lines and gaps.
  scopes         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- The figure decided on: written into the draft (accepted), or the suggestion dismissed.
  decided_kcal   integer,
  decided_by     text,
  decided_at     timestamptz,
  note           text         CHECK (note IS NULL OR length(note) <= 1000),
  history        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  changed_at     timestamptz,
  change         text         CHECK (change IS NULL OR length(change) <= 500),
  worked_at      timestamptz  NOT NULL DEFAULT now(),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dish_id)
);
CREATE INDEX calorie_checks_status ON calorie_checks (tenant_id, status);

ALTER TABLE calorie_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE calorie_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY calorie_checks_tenant ON calorie_checks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
