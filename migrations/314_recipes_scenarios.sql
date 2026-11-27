-- 314_recipes_scenarios.sql
--
-- Inventory phase 7a (docs/INVENTORY.md 8.2, 10.4; 27 Nov 2026): cost
-- scenarios. A scenario is a menu at a venue (and revenue stream) and order
-- type with changes to try: a price or a cost changed by a figure or a
-- percentage, or set, for one dish, a section or every dish. The Menu
-- margins page's Scenarios tab works out the weighted cost % and GP at the
-- real mix (units from dish_cost_days over the last mix_days) before and
-- after, dish by dish (shared/scenarios.js); nothing is kept but the
-- scenario itself. Push prices writes a scenario's new prices into the
-- menu's DRAFT through the menus area's whole-tree save; publishing stays a
-- separate step. pushed_at / pushed_by say when that was last done.
--
-- changes: [{ what: 'price' | 'cost', applies: 'all' | 'section' | 'dish',
-- section_id, dish_id, how: 'percent' | 'amount' | 'set', value, round_to,
-- round }] in order (each applies on top of the ones before it). An amount
-- or a set figure is in pounds. section_id and dish_id are the menu draft's
-- plain ids: the menu save deletes and re-inserts dishes under the same ids,
-- so nothing here points at menu_items or menu_sections with a foreign key
-- (a change whose dish or section has gone applies to nothing and says so).

CREATE TABLE cost_scenarios (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               text          NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  menu_id            uuid          NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  -- The scope, as Menu margins takes it: empty venue is the group's prices
  -- and every venue's sales; a stream is one venue's.
  venue_id           uuid          REFERENCES venues(id) ON DELETE CASCADE,
  revenue_stream_id  uuid          REFERENCES pos_revenue_streams(id) ON DELETE CASCADE,
  order_type_id      uuid          REFERENCES order_types(id) ON DELETE CASCADE,
  -- The mix: units sold over the last mix_days up to yesterday.
  mix_days           int           NOT NULL DEFAULT 28 CHECK (mix_days BETWEEN 1 AND 93),
  changes            jsonb         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  notes              text          CHECK (notes IS NULL OR length(notes) <= 1000),
  created_by         text,
  updated_by         text,
  pushed_at          timestamptz,
  pushed_by          text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CHECK (revenue_stream_id IS NULL OR venue_id IS NOT NULL)
);
CREATE INDEX cost_scenarios_tenant ON cost_scenarios (tenant_id, updated_at DESC);
CREATE INDEX cost_scenarios_menu ON cost_scenarios (tenant_id, menu_id);

ALTER TABLE cost_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_scenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY cost_scenarios_tenant ON cost_scenarios
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
