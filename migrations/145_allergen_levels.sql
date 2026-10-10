-- 145_allergen_levels.sql
--
-- Menu tags split into two kinds:
--   menu_dietary_tags.kind          'dietary' (vegan, gluten-free, spicy...)
--                                   or 'allergen'
--   menu_dietary_tags.standard_key  which of the 14 UK allergens a tag is
--                                   (one per tenant), NULL for any other tag
--   menu_item_dietary.level         for allergens: 'contains' |
--                                   'may_contain' | 'removable' (no row =
--                                   the dish doesn't have it). Dietary tags
--                                   are always 'contains'.
--
-- Existing tags that are clearly one of the 14 (by code or exact label,
-- e.g. 'n' / "Nuts") become that allergen, so dishes keep their badge and
-- no duplicate is added. Every tenant then gets the standard allergens it
-- is still missing (shared/menuTags.js STANDARD_ALLERGENS, same list).

BEGIN;

ALTER TABLE menu_dietary_tags
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'dietary',
  ADD COLUMN IF NOT EXISTS standard_key text;

ALTER TABLE menu_dietary_tags DROP CONSTRAINT IF EXISTS menu_dietary_tags_kind_check;
ALTER TABLE menu_dietary_tags ADD CONSTRAINT menu_dietary_tags_kind_check
  CHECK (kind IN ('dietary', 'allergen'));

ALTER TABLE menu_dietary_tags DROP CONSTRAINT IF EXISTS menu_dietary_tags_standard_key_check;
ALTER TABLE menu_dietary_tags ADD CONSTRAINT menu_dietary_tags_standard_key_check
  CHECK (standard_key IS NULL OR (kind = 'allergen' AND standard_key IN (
    'celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk',
    'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soya', 'sulphites')));

CREATE UNIQUE INDEX IF NOT EXISTS menu_dietary_tags_standard_uniq
  ON menu_dietary_tags (tenant_id, standard_key) WHERE standard_key IS NOT NULL;

ALTER TABLE menu_item_dietary
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'contains';
ALTER TABLE menu_item_dietary DROP CONSTRAINT IF EXISTS menu_item_dietary_level_check;
ALTER TABLE menu_item_dietary ADD CONSTRAINT menu_item_dietary_level_check
  CHECK (level IN ('contains', 'may_contain', 'removable'));

-- Existing tags that match a standard allergen by code or exact label.
-- One tag per tenant per allergen (the first in sort order).
WITH aliases(key, alias) AS (VALUES
  ('celery', 'celery'), ('celery', 'celeriac'),
  ('gluten', 'gluten'), ('gluten', 'wheat'), ('gluten', 'contains gluten'), ('gluten', 'cereals containing gluten'),
  ('crustaceans', 'crustaceans'), ('crustaceans', 'crustacean'), ('crustaceans', 'shellfish'),
  ('eggs', 'eggs'), ('eggs', 'egg'),
  ('fish', 'fish'),
  ('lupin', 'lupin'),
  ('milk', 'milk'), ('milk', 'dairy'),
  ('molluscs', 'molluscs'), ('molluscs', 'mollusc'),
  ('mustard', 'mustard'),
  ('nuts', 'nuts'), ('nuts', 'n'), ('nuts', 'nut'), ('nuts', 'tree nuts'), ('nuts', 'contains nuts'),
  ('peanuts', 'peanuts'), ('peanuts', 'peanut'),
  ('sesame', 'sesame'), ('sesame', 'sesame seeds'),
  ('soya', 'soya'), ('soya', 'soy'),
  ('sulphites', 'sulphites'), ('sulphites', 'sulphite'), ('sulphites', 'sulphur dioxide'), ('sulphites', 'so2')
),
matched AS (
  SELECT DISTINCT ON (t.tenant_id, a.key) t.id, a.key
    FROM menu_dietary_tags t
    JOIN aliases a ON a.alias = t.code OR a.alias = lower(trim(t.label))
   WHERE t.standard_key IS NULL
   ORDER BY t.tenant_id, a.key, t.sort_order, t.label
),
one_key AS (
  -- A tag matching two allergens keeps the first one.
  SELECT DISTINCT ON (id) id, key FROM matched ORDER BY id, key
)
UPDATE menu_dietary_tags t
   SET kind = 'allergen', standard_key = one_key.key
  FROM one_key
 WHERE t.id = one_key.id
   AND NOT EXISTS (SELECT 1 FROM menu_dietary_tags x
                    WHERE x.tenant_id = t.tenant_id AND x.standard_key = one_key.key);

-- The standard allergens each tenant is still missing.
WITH std(key, label, glyph, colour, ord) AS (VALUES
  ('celery',      'Celery',      'Ce', '#4d7c0f', 1),
  ('gluten',      'Gluten',      'Gl', '#a16207', 2),
  ('crustaceans', 'Crustaceans', 'Cr', '#b91c1c', 3),
  ('eggs',        'Eggs',        'E',  '#ca8a04', 4),
  ('fish',        'Fish',        'F',  '#1d4ed8', 5),
  ('lupin',       'Lupin',       'L',  '#7c3aed', 6),
  ('milk',        'Milk',        'Mi', '#0369a1', 7),
  ('molluscs',    'Molluscs',    'Mo', '#0f766e', 8),
  ('mustard',     'Mustard',     'Mu', '#b45309', 9),
  ('nuts',        'Nuts',        'N',  '#9a3412', 10),
  ('peanuts',     'Peanuts',     'P',  '#92400e', 11),
  ('sesame',      'Sesame',      'Se', '#57534e', 12),
  ('soya',        'Soya',        'So', '#15803d', 13),
  ('sulphites',   'Sulphites',   'Su', '#6d28d9', 14)
)
INSERT INTO menu_dietary_tags (tenant_id, code, label, glyph, colour, sort_order, kind, standard_key)
SELECT tn.id, std.key, std.label, std.glyph, std.colour, 100 + std.ord, 'allergen', std.key
  FROM tenants tn CROSS JOIN std
 WHERE NOT EXISTS (SELECT 1 FROM menu_dietary_tags x
                    WHERE x.tenant_id = tn.id AND x.standard_key = std.key)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Allergens in the standard order, any other allergen tags after them;
-- dietary tags keep their order.
WITH ordered AS (
  SELECT t.id,
         row_number() OVER (
           PARTITION BY t.tenant_id
           ORDER BY array_position(ARRAY['celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk',
                      'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soya', 'sulphites'], t.standard_key)
                    NULLS LAST,
                    t.sort_order, t.label
         ) - 1 AS n
    FROM menu_dietary_tags t
   WHERE t.kind = 'allergen'
)
UPDATE menu_dietary_tags t SET sort_order = ordered.n
  FROM ordered WHERE t.id = ordered.id;

-- The tags page now holds both lists; its nav link says so (only links
-- still carrying the default label).
UPDATE nav_items SET label = 'Allergens & dietary'
 WHERE route = '/menus/dietary-tags' AND label = 'Dietary tags';

COMMIT;
