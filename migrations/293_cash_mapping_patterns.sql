-- 293_cash_mapping_patterns.sql
--
-- Sales from other tills, phase 3 (docs/SALES_IMPORT.md 4.2 steps 4 and 5):
-- pattern rules and the category fallback for the item mapping.
--
--   ext_map_rules.kind gains
--     pattern   an item line whose code (the variant's SKU or barcode)
--               equals or starts with pattern_value, whose name contains it
--               (case-insensitive), or whose item is in the other till's
--               category pattern_value (a category ref) -> a target as an
--               exact rule has one (dish or combo, options, more dishes)
--     bucket    an item line in the other till's category pattern_value ->
--               one of our menu sections (target_section_id), for reports
--               only: the line is counted under that section, not as a dish
--   pattern_field  code | name | category
--   pattern_op     equals | starts_with | contains (code: equals or
--                  starts_with; name: contains; category: equals)
--   shared/itemMapping.js applies them after the rules that match by ref
--   (exact, combination; axis rules still add options to a pattern's dish),
--   most specific first: code equals, code starts with (the longer first),
--   name contains (the longer first), category, then the bucket.
--
--   ext_check_lines gains section_id (the bucket's section; a plain id, as
--   the other mapped columns: a menu save re-inserts sections) and the
--   map_state 'bucket'.

ALTER TABLE ext_map_rules DROP CONSTRAINT ext_map_rules_kind_check;
ALTER TABLE ext_map_rules
  ADD CONSTRAINT ext_map_rules_kind_check CHECK (kind IN ('exact', 'combination', 'axis', 'ignore', 'keep', 'pattern', 'bucket')),
  ADD COLUMN pattern_field     text CHECK (pattern_field IN ('code', 'name', 'category')),
  ADD COLUMN pattern_op        text CHECK (pattern_op IN ('equals', 'starts_with', 'contains')),
  ADD COLUMN pattern_value     text CHECK (pattern_value IS NULL OR length(pattern_value) BETWEEN 1 AND 200),
  ADD COLUMN target_section_id uuid;

ALTER TABLE ext_check_lines DROP CONSTRAINT ext_check_lines_map_state_check;
ALTER TABLE ext_check_lines
  ADD CONSTRAINT ext_check_lines_map_state_check CHECK (map_state IN ('mapped', 'ignored', 'kept', 'note', 'in_combo', 'bucket', 'unmapped')),
  ADD COLUMN section_id uuid;
