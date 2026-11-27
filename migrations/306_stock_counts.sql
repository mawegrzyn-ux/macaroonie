-- 306_stock_counts.sql
--
-- Inventory phase 4a (docs/INVENTORY.md 6.1, 6.2, 6.4; decisions D4, D11; 27
-- Nov 2026): storage areas, key-item lists, stocktakes that are drafted,
-- submitted and approved, and adjustments. Stock stays per venue (D4): an
-- area orders the count sheet and holds no stock of its own, so an item in
-- two areas is counted in both and the count adds them.
--
-- On hand is read from the documents (shared/stock.js stockOnHand(), fed by
-- loadStockMoves() in api/src/services/stockSvc.js): each item's last
-- APPROVED count at the venue plus every delivery and adjustment after it.
-- Nothing writes a stock level.

-- Storage areas per venue (Walk-in, Dry store, Bar), dragged into order.
CREATE TABLE stock_areas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_areas_name ON stock_areas (tenant_id, venue_id, lower(btrim(name)));
CREATE INDEX stock_areas_venue ON stock_areas (tenant_id, venue_id, sort_order);

ALTER TABLE stock_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_areas_tenant ON stock_areas
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- The items in an area, in shelf order.
CREATE TABLE stock_area_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  area_id     uuid        NOT NULL REFERENCES stock_areas(id) ON DELETE CASCADE,
  item_id     uuid        NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  sort_order  int         NOT NULL DEFAULT 0,
  UNIQUE (area_id, item_id)
);
CREATE INDEX stock_area_items_item ON stock_area_items (tenant_id, item_id);

ALTER TABLE stock_area_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_area_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_area_items_tenant ON stock_area_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Key-item lists for a short count (proteins, cheese, what goes missing), the group's.
CREATE TABLE stock_key_lists (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_key_lists_name ON stock_key_lists (tenant_id, lower(btrim(name)));

ALTER TABLE stock_key_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_key_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_key_lists_tenant ON stock_key_lists
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

CREATE TABLE stock_key_list_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_id     uuid        NOT NULL REFERENCES stock_key_lists(id) ON DELETE CASCADE,
  item_id     uuid        NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  sort_order  int         NOT NULL DEFAULT 0,
  UNIQUE (list_id, item_id)
);
CREATE INDEX stock_key_list_items_item ON stock_key_list_items (tenant_id, item_id);

ALTER TABLE stock_key_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_key_list_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_key_list_items_tenant ON stock_key_list_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- The group's stock settings: approval by a second person (D11) and blind
-- counting (the expected quantity hidden while counting). No row = both off.
CREATE TABLE stock_settings (
  tenant_id               uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  second_person_approves  boolean     NOT NULL DEFAULT false,
  blind_count             boolean     NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text
);

ALTER TABLE stock_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_settings_tenant ON stock_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- A venue's count day (0 Sunday to 6 Saturday, null = none), for Today's
-- "count due", and the kind of count it is (a key count from a list).
CREATE TABLE stock_venue_settings (
  venue_id       uuid        PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_weekday  smallint    CHECK (count_weekday BETWEEN 0 AND 6),
  count_kind     text        NOT NULL DEFAULT 'full' CHECK (count_kind IN ('full', 'key')),
  key_list_id    uuid        REFERENCES stock_key_lists(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_venue_settings_tenant ON stock_venue_settings (tenant_id);

ALTER TABLE stock_venue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_venue_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_venue_settings_tenant ON stock_venue_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Counts become documents: a full count (what is not counted is confirmed
-- as zero before it is submitted) or a key-item count (what is not counted
-- is left alone); draft, submitted, approved or cancelled. Only approved
-- counts move stock. areas_done: { area_id: { by, at } }, the areas someone
-- has finished (merged one key at a time, so two people counting two areas
-- never write over each other).
-- Existing counts (migration 287) were taken in one step and replaced on
-- hand at once: they become approved full counts. Their lines are the items
-- counted, so reading lines alone (as on hand does) gives the same figures.
ALTER TABLE stock_counts
  ADD COLUMN kind          text        NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'key')),
  ADD COLUMN status        text        NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'submitted', 'approved', 'cancelled')),
  ADD COLUMN key_list_id   uuid        REFERENCES stock_key_lists(id) ON DELETE SET NULL,
  ADD COLUMN key_list_name text,
  ADD COLUMN areas_done    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN started_by    text,
  ADD COLUMN submitted_by  text,
  ADD COLUMN submitted_at  timestamptz,
  ADD COLUMN approved_by   text,
  ADD COLUMN approved_at   timestamptz,
  ADD COLUMN cancelled_by  text,
  ADD COLUMN cancelled_at  timestamptz,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now();
UPDATE stock_counts
   SET started_by = counted_by, submitted_by = counted_by, submitted_at = counted_at,
       approved_by = counted_by, approved_at = counted_at
 WHERE status = 'approved' AND approved_at IS NULL;
ALTER TABLE stock_counts ALTER COLUMN status SET DEFAULT 'draft';
CREATE INDEX stock_counts_status ON stock_counts (tenant_id, venue_id, status, counted_at DESC);

-- A line is one item in one area of a count (area null: counted outside an
-- area, or confirmed as zero). entries: what was typed, kept as typed
-- ([{ qty, unit, label, base_qty }]: 2 cases + 3 each + 400 g), qty_base
-- their total in the item's base unit. Each line is written on its own as
-- it is typed (no whole-count save), by whoever counted it.
ALTER TABLE stock_count_lines DROP CONSTRAINT stock_count_lines_count_id_item_id_key;
ALTER TABLE stock_count_lines
  ADD COLUMN area_id         uuid        REFERENCES stock_areas(id) ON DELETE SET NULL,
  ADD COLUMN entries         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN confirmed_zero  boolean     NOT NULL DEFAULT false,
  ADD COLUMN counted_by      text,
  ADD COLUMN updated_at      timestamptz NOT NULL DEFAULT now();
ALTER TABLE stock_count_lines ADD CONSTRAINT stock_count_lines_one UNIQUE NULLS NOT DISTINCT (count_id, item_id, area_id);
CREATE INDEX stock_count_lines_count ON stock_count_lines (tenant_id, count_id);
-- The existing lines as typed: their quantity in the item's base unit.
UPDATE stock_count_lines l
   SET entries = jsonb_build_array(jsonb_build_object('qty', l.qty_base, 'unit', i.base_unit, 'label', i.base_unit, 'base_qty', 1)),
       counted_by = c.counted_by
  FROM inv_items i, stock_counts c
 WHERE i.id = l.item_id AND i.tenant_id = l.tenant_id AND c.id = l.count_id AND c.tenant_id = l.tenant_id
   AND l.entries = '[]'::jsonb;

-- Adjustments (6.4): what fits no other document, always with a reason. qty
-- and unit as typed (signed: minus takes stock off), qty_base in the item's
-- base unit. Corrected by a second adjustment the other way (reverses_id).
CREATE TABLE stock_adjustments (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  item_id      uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  qty          numeric(16,4) NOT NULL CHECK (qty <> 0),
  unit         text          NOT NULL CHECK (length(unit) BETWEEN 1 AND 80),
  qty_base     numeric(16,4) NOT NULL CHECK (qty_base <> 0),
  reason       text          NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 300),
  note         text          CHECK (note IS NULL OR length(note) <= 500),
  adjusted_at  timestamptz   NOT NULL DEFAULT now(),
  adjusted_by  text,
  reverses_id  uuid          REFERENCES stock_adjustments(id) ON DELETE SET NULL,
  created_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustments_venue ON stock_adjustments (tenant_id, venue_id, adjusted_at DESC);
CREATE INDEX stock_adjustments_item ON stock_adjustments (tenant_id, item_id);
CREATE UNIQUE INDEX stock_adjustments_reversed ON stock_adjustments (reverses_id) WHERE reverses_id IS NOT NULL;

ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_adjustments_tenant ON stock_adjustments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
