-- 308_stock_waste.sql
--
-- Inventory phase 4b (docs/INVENTORY.md 6.3; decisions D5, D10; 27 Nov
-- 2026): waste. A waste entry is a document like a count or an adjustment:
-- what was thrown away at a venue, when, why and by whom, with what it cost
-- then. On hand reads it as a move (api/src/services/stockSvc.js
-- MOVE_SOURCES): each item it holds taken off at its moment.
--
-- What is wasted is an inventory item, a prep batch (a prep recipe, broken
-- into its items by the recipe: D5, batches aren't stock of their own) or a
-- menu dish (broken into items by the recipe the dish uses there, picked by
-- recipeFor() over the variation matrix: venue, revenue stream, order type).
-- The items are written when it is logged (stock_waste_items), each with its
-- cost per base unit then (the average paid at the venue), so a recipe
-- changed later leaves past waste as it was. What the breakdown couldn't do
-- (no recipe, a unit with no size, a draft Pepper read in and nobody
-- checked) is kept on the entry in words (gaps).
--
-- A till void marked wasted (pos_check_lines.void_waste) is waste by itself:
-- read from the till's own records each time, never copied here, so nobody
-- enters it twice. Generated test till sales are left out (D10).
--
-- Undo: on the trading day it was logged, by whoever logged it or Stock
-- manage (undone_at: it stops counting, kept for the record). After that day
-- a reversing entry (reverses_id; Stock manage) with the items the other way,
-- dated at the entry it reverses so a count since keeps its figure.

-- The group's waste reasons, each of WRAP's three kinds (spoilage: gone off
-- or out of date; preparation: trim, overproduction, mistakes in the kitchen;
-- plate: what guests leave or send back), in an order dragged on the Stock
-- page's Settings. A reason in use is switched off, never deleted.
CREATE TABLE waste_reasons (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind        text        NOT NULL CHECK (kind IN ('spoilage', 'preparation', 'plate')),
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waste_reasons_name ON waste_reasons (tenant_id, lower(btrim(name)));
CREATE INDEX waste_reasons_order ON waste_reasons (tenant_id, sort_order);

ALTER TABLE waste_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_reasons FORCE ROW LEVEL SECURITY;
CREATE POLICY waste_reasons_tenant ON waste_reasons
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- A group's reasons are seeded once (here for every group today; a new group
-- on its first read, stockSvc.js ensureWasteReasons()), so deleting them all
-- doesn't bring them back.
ALTER TABLE stock_settings ADD COLUMN waste_reasons_seeded boolean NOT NULL DEFAULT false;

-- The list every group starts with (the same as WASTE_REASON_SEEDS in shared/stock.js).
WITH seeds(name, kind, sort_order) AS (VALUES
  ('Out of date', 'spoilage', 0),
  ('Gone off', 'spoilage', 1),
  ('Damaged in storage', 'spoilage', 2),
  ('Trim and peelings', 'preparation', 3),
  ('Made too much', 'preparation', 4),
  ('Dropped or spilt', 'preparation', 5),
  ('Burnt or cooked wrong', 'preparation', 6),
  ('Sent back by a guest', 'plate', 7),
  ('Left on the plate', 'plate', 8)
)
INSERT INTO waste_reasons (tenant_id, name, kind, sort_order)
SELECT t.id, s.name, s.kind, s.sort_order FROM tenants t CROSS JOIN seeds s
ON CONFLICT DO NOTHING;

INSERT INTO stock_settings (tenant_id, waste_reasons_seeded)
SELECT t.id, true FROM tenants t
ON CONFLICT (tenant_id) DO UPDATE SET waste_reasons_seeded = true;

-- A waste entry. what: 'item' (item_id; qty and unit as typed, qty_base in
-- the item's base unit), 'recipe' (recipe_id, a prep batch; qty_base in the
-- recipe's own unit) or 'dish' (dish_id, a menu dish: a plain id, the menu
-- save re-inserts dishes under the same ids; qty_base the number of dishes),
-- with the matrix scope it was costed at (the venue's, a revenue stream and
-- an order type, each optional). name: what it was called then. reason and
-- reason_kind are the reason's words then (reason_id may be switched off
-- since). value: what its items cost then, pounds (null when nothing had a
-- price yet). gaps: [text], what couldn't be broken into items.
CREATE TABLE stock_waste (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id           uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  wasted_at          timestamptz   NOT NULL DEFAULT now(),
  day                date          NOT NULL,
  what               text          NOT NULL CHECK (what IN ('item', 'recipe', 'dish')),
  item_id            uuid          REFERENCES inv_items(id) ON DELETE CASCADE,
  recipe_id          uuid          REFERENCES recipes(id) ON DELETE SET NULL,
  dish_id            uuid,
  revenue_stream_id  uuid,
  order_type_id      uuid,
  name               text          NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  qty                numeric(16,4) NOT NULL,
  unit               text          NOT NULL CHECK (length(unit) BETWEEN 1 AND 80),
  qty_base           numeric(16,4) NOT NULL,
  reason_id          uuid          REFERENCES waste_reasons(id) ON DELETE SET NULL,
  reason             text          NOT NULL CHECK (length(reason) BETWEEN 1 AND 60),
  reason_kind        text          NOT NULL CHECK (reason_kind IN ('spoilage', 'preparation', 'plate')),
  value              numeric(14,4),
  gaps               jsonb         NOT NULL DEFAULT '[]'::jsonb,
  note               text          CHECK (note IS NULL OR length(note) <= 500),
  photo_url          text,
  wasted_by          text,
  undone_at          timestamptz,
  undone_by          text,
  reverses_id        uuid          REFERENCES stock_waste(id) ON DELETE SET NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CHECK ((what = 'item' AND item_id IS NOT NULL) OR (what = 'recipe') OR (what = 'dish' AND dish_id IS NOT NULL))
);
CREATE INDEX stock_waste_venue ON stock_waste (tenant_id, venue_id, wasted_at DESC);
CREATE INDEX stock_waste_day ON stock_waste (tenant_id, venue_id, day);
CREATE UNIQUE INDEX stock_waste_reversed ON stock_waste (reverses_id) WHERE reverses_id IS NOT NULL;

ALTER TABLE stock_waste ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_waste FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_waste_tenant ON stock_waste
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- The items a waste entry took off stock: qty_base in the item's base unit
-- (a reversing entry's are below zero: they put stock back), cost_per_base
-- pounds per base unit at the venue then (null with nothing paid there yet).
CREATE TABLE stock_waste_items (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  waste_id       uuid          NOT NULL REFERENCES stock_waste(id) ON DELETE CASCADE,
  item_id        uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base <> 0),
  cost_per_base  numeric(18,8),
  UNIQUE (waste_id, item_id)
);
CREATE INDEX stock_waste_items_item ON stock_waste_items (tenant_id, item_id);

ALTER TABLE stock_waste_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_waste_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_waste_items_tenant ON stock_waste_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
