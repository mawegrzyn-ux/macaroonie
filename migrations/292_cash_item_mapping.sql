-- 292_cash_item_mapping.sql
--
-- Sales from other tills, phase 2 (docs/SALES_IMPORT.md 4.1, 4.2, 4.4): the
-- item mapping. Rules say what the other till's items, variants and modifier
-- options are on our menus; shared/itemMapping.js applies them to each
-- check's lines (on every sync's normalise, and again in the background when
-- rules change, from the rule's effective_from). A rule never changes money:
-- the lines keep the other till's amounts, only the mapped columns change.
--
--   ext_map_rules       one rule: its connection, its scope (venue_id null =
--                       every venue on the connection), its kind and match,
--                       its target, and effective_from (lines on trading days
--                       from then on follow it).
--     kind              exact        an item (item_ref), a variant
--                                    (variant_ref) or a modifier option
--                                    (option_ref) -> a dish (target_item_id)
--                                    with options (target_option_ids) and
--                                    more dishes (target_item_ids, a bundle),
--                                    or a combo (target_combo_id); a modifier
--                                    option -> an option or a dish
--                       combination  an item (+ variant) sold with these
--                                    modifier options (option_refs) -> a combo
--                                    or a dish; those modifiers become part of it
--                       axis         a variant option name (axis_kind
--                                    'variant', axis_name, e.g. Size) or a
--                                    modifier group (axis_kind 'modifier',
--                                    axis_group_ref) -> our option group
--                                    (target_group_id), value to value
--                                    (axis_values [{ from, option_id }]: a
--                                    variant's value, or a modifier option's
--                                    ref); item_ref limits it to one item
--                       ignore       not a sale (a gift card, a deposit)
--                       keep         kept as sold, under its own name
--     ext_sku, ext_name the other till's SKU and name when the rule was made:
--                       a rule whose refs no longer match (the item made
--                       again on the other till) still matches by them
--     match_key         the match as one string (shared/itemMapping.js
--                       ruleKey()): one rule per match and scope
--   ext_line_parts      what an item line became: its main part (a dish or a
--                       combo) and the options, extra dishes and modifiers
--                       mapped with it, each with its share of the line's
--                       net (allocated by our list prices, the remainder on
--                       the main part, so the parts add up to the line
--                       exactly). Replaced whenever the line is mapped.
--
-- ext_check_lines gains map_state (mapped | ignored | kept | note | in_combo
-- | unmapped) and rule_id its reference. Dish, option and combo ids stay
-- plain ids, here and on the rules: a menu save deletes and re-inserts its
-- dishes under the same ids (routes/menus.js), so a reference to menu_items
-- would cascade or clear on every save. The rule routes check the ids
-- (rule 4); a target that has gone leaves its lines unmapped at the next
-- re-map.
-- pos_connections gains remap_from / remap_requested_at: a re-map asked for
-- by a rule change, run by the sales-sync job (the queue add is fired and
-- forgotten; the minute sweep picks up one that was lost).

CREATE TABLE ext_map_rules (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id      uuid        NOT NULL REFERENCES pos_connections(id) ON DELETE CASCADE,
  venue_id           uuid        REFERENCES venues(id) ON DELETE CASCADE,
  kind               text        NOT NULL CHECK (kind IN ('exact', 'combination', 'axis', 'ignore', 'keep')),
  item_ref           text,
  variant_ref        text,
  option_ref         text,
  option_refs        text[]      NOT NULL DEFAULT '{}',
  axis_kind          text        CHECK (axis_kind IN ('variant', 'modifier')),
  axis_name          text,
  axis_group_ref     text,
  axis_values        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  target_item_id     uuid,
  target_item_ids    uuid[]      NOT NULL DEFAULT '{}',
  target_option_ids  uuid[]      NOT NULL DEFAULT '{}',
  target_combo_id    uuid,
  target_group_id    uuid,
  ext_sku            text,
  ext_name           text,
  match_key          text        NOT NULL,
  effective_from     date        NOT NULL,
  note               text,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ext_map_rules_match ON ext_map_rules (connection_id, venue_id, match_key) NULLS NOT DISTINCT;
CREATE INDEX ext_map_rules_tenant ON ext_map_rules (tenant_id, connection_id);

CREATE TABLE ext_line_parts (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  check_id           uuid          NOT NULL REFERENCES ext_checks(id) ON DELETE CASCADE,
  line_id            uuid          NOT NULL REFERENCES ext_check_lines(id) ON DELETE CASCADE,
  source_line_id     uuid          REFERENCES ext_check_lines(id) ON DELETE CASCADE,
  part_no            integer       NOT NULL,
  role               text          NOT NULL CHECK (role IN ('main', 'option', 'dish')),
  item_id            uuid,
  option_id          uuid,
  combo_id           uuid,
  rule_id            uuid          REFERENCES ext_map_rules(id) ON DELETE SET NULL,
  qty                numeric(12,3) NOT NULL DEFAULT 1,
  net_pence          integer       NOT NULL DEFAULT 0,
  UNIQUE (line_id, part_no)
);
CREATE INDEX ext_line_parts_check ON ext_line_parts (tenant_id, check_id);
CREATE INDEX ext_line_parts_item  ON ext_line_parts (tenant_id, item_id);

ALTER TABLE ext_check_lines
  ADD COLUMN map_state text CHECK (map_state IN ('mapped', 'ignored', 'kept', 'note', 'in_combo', 'unmapped')),
  ADD CONSTRAINT ext_check_lines_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES ext_map_rules(id) ON DELETE SET NULL;
CREATE INDEX ext_check_lines_option ON ext_check_lines (tenant_id, option_ref) WHERE option_ref IS NOT NULL;

ALTER TABLE pos_connections
  ADD COLUMN remap_from          date,
  ADD COLUMN remap_requested_at  timestamptz;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ext_map_rules', 'ext_line_parts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY %I ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.bypass_rls', true) = 'on')$f$, t || '_tenant', t);
  END LOOP;
END $$;
