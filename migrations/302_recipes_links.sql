-- 302_recipes_links.sql
--
-- Inventory phase 2 (docs/INVENTORY.md 5.4, 8.2, decisions D2 and D3; 27 Nov
-- 2026): what is sold, linked to recipes, and the cost % targets.
--
--   recipe_links          which recipe a menu dish uses, and how many
--                         portions of it: by default (every venue, any
--                         order type), and where a venue, a revenue stream,
--                         an order type or a mix of them uses another
--                         recipe or a variation (a takeaway version, one
--                         venue's own). shared/costing.js recipeFor() picks
--                         the closest link, scored as taxFor() scores a tax
--                         rule (stream 4, order type 2, venue 1).
--   recipe_option_rules   what an option does to the dish's recipe: adds,
--                         takes out, swaps, scales, is a recipe of its own,
--                         or nothing. For an option of the library
--                         (option_id), for one dish only (an exception), or
--                         for a dish's own one-off option, by its label as
--                         sales name it (dish_id + option_label).
--   costing_settings      the group's target and limit cost % (30 and 35
--                         when there is no row), with a menu section's own.
--
-- Menu dishes and library options are pointed at by plain uuids, never
-- foreign keys: the menu save deletes and re-inserts the dishes under the
-- same ids, which would clear or block a foreign key. A link whose dish is on
-- no menu (draft or live) is marked missing_since by the nightly sweep
-- (jobs/recipe-links.js) and deleted after 30 days; a dish that comes back
-- clears it; a dish's own rules go the same way. Duplicating a menu copies its dishes' links and dish rules to
-- the copy's new dish ids (copyRecipeLinks() in services/dishCostSvc.js).

CREATE TABLE recipe_links (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- menu_items.id, plain (see above).
  dish_id            uuid          NOT NULL,
  recipe_id          uuid          NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  portions           numeric(10,3) NOT NULL DEFAULT 1 CHECK (portions > 0),
  -- The scope: each empty means any. A stream is one venue's, so a link with
  -- a stream stores that stream's venue too (the API refuses another venue).
  venue_id           uuid          REFERENCES venues(id) ON DELETE CASCADE,
  revenue_stream_id  uuid          REFERENCES pos_revenue_streams(id) ON DELETE CASCADE,
  order_type_id      uuid          REFERENCES order_types(id) ON DELETE CASCADE,
  -- When the sweep last found the dish on no menu (null: it is on one).
  missing_since      timestamptz,
  created_by         text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CHECK (revenue_stream_id IS NULL OR venue_id IS NOT NULL)
);
-- One link per dish and scope.
CREATE UNIQUE INDEX recipe_links_scope ON recipe_links (
  tenant_id, dish_id,
  COALESCE(venue_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(revenue_stream_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(order_type_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX recipe_links_recipe ON recipe_links (tenant_id, recipe_id);
CREATE INDEX recipe_links_missing ON recipe_links (missing_since) WHERE missing_since IS NOT NULL;

ALTER TABLE recipe_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_links FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_links_tenant ON recipe_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE recipe_option_rules (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- menu_variant_options.id, plain: an option of the library.
  option_id      uuid,
  -- menu_items.id, plain: with option_id an exception for this dish; with
  -- option_label the dish's own one-off option.
  dish_id        uuid,
  option_label   text          CHECK (option_label IS NULL OR length(btrim(option_label)) BETWEEN 1 AND 200),
  action         text          NOT NULL CHECK (action IN ('add', 'remove', 'swap', 'scale', 'recipe', 'nothing')),
  -- An item a rule names that is deleted (only possible when no order or
  -- recipe line uses it) takes its rules with it: the option then follows
  -- its group's default again, which shows as a gap.
  item_id        uuid          REFERENCES inv_items(id) ON DELETE CASCADE,
  sub_recipe_id  uuid          REFERENCES recipes(id) ON DELETE CASCADE,
  swap_item_id   uuid          REFERENCES inv_items(id) ON DELETE CASCADE,
  qty            numeric(14,4) CHECK (qty IS NULL OR qty > 0),
  unit           text          CHECK (unit IS NULL OR length(btrim(unit)) BETWEEN 1 AND 30),
  factor         numeric(8,4)  CHECK (factor IS NULL OR (factor > 0 AND factor <= 20)),
  recipe_id      uuid          REFERENCES recipes(id) ON DELETE CASCADE,
  note           text          CHECK (note IS NULL OR length(note) <= 500),
  -- A dish's rule (an exception or its own option): when the sweep last
  -- found the dish on no menu, as recipe_links.missing_since.
  missing_since  timestamptz,
  created_by     text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CHECK ((option_id IS NULL) <> (option_label IS NULL)),
  CHECK (option_label IS NULL OR dish_id IS NOT NULL),
  CHECK (action <> 'add' OR ((item_id IS NULL) <> (sub_recipe_id IS NULL) AND qty IS NOT NULL AND unit IS NOT NULL)),
  CHECK (action NOT IN ('remove', 'swap') OR item_id IS NOT NULL),
  CHECK (action <> 'swap' OR (swap_item_id IS NOT NULL AND swap_item_id <> item_id AND (qty IS NULL) = (unit IS NULL))),
  CHECK (action <> 'scale' OR factor IS NOT NULL),
  CHECK (action <> 'recipe' OR recipe_id IS NOT NULL)
);
-- One rule per option and dish (the option's own rule has no dish), and one
-- per dish's own option by label.
CREATE UNIQUE INDEX recipe_option_rules_option ON recipe_option_rules (
  tenant_id, option_id, COALESCE(dish_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE option_id IS NOT NULL;
CREATE UNIQUE INDEX recipe_option_rules_own ON recipe_option_rules (tenant_id, dish_id, lower(option_label))
  WHERE option_label IS NOT NULL;
CREATE INDEX recipe_option_rules_dish ON recipe_option_rules (tenant_id, dish_id) WHERE dish_id IS NOT NULL;

ALTER TABLE recipe_option_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_option_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_option_rules_tenant ON recipe_option_rules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE costing_settings (
  tenant_id   uuid          PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  target_pct  numeric(5,2)  NOT NULL DEFAULT 30 CHECK (target_pct > 0 AND target_pct < 100),
  limit_pct   numeric(5,2)  NOT NULL DEFAULT 35 CHECK (limit_pct > 0 AND limit_pct < 100),
  -- A menu section's own: [{ section_id, target_pct, limit_pct }] (sections
  -- keep their ids across menu saves; plain ids, like the links').
  sections    jsonb         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sections) = 'array'),
  updated_by  text,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CHECK (target_pct <= limit_pct)
);

ALTER TABLE costing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE costing_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY costing_settings_tenant ON costing_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
