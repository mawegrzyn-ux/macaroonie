-- 206_option_group_looks.sql
--
-- Option groups (Menus > Variant groups) get their own kiosk look, and a
-- type for stock.
--
--   menu_variant_groups.kiosk_tiles     NULL (the kiosk design's) | cards | round | oval | hexagon | plain
--                                       (shared/kiosk.js TILE_STYLES)
--   menu_variant_groups.kiosk_pictures  NULL (the kiosk design's) | true (with pictures) | false (words only)
--   menu_variant_groups.kiosk_entrance  NULL (the kiosk design's) | none | appear | slide | bubble | deal
--                                       (shared/kiosk.js CHOICE_ENTRANCES)
--   menu_variant_groups.variation_type  NULL (not set) | modification (changes the dish: things on and
--                                       off its recipe) | side (a separate item with its own recipe) |
--                                       addition (adds to the dish's own recipe)
--                                       (shared/procurement.js VARIATION_TYPES)
--
-- With kiosk_display (migration 172) these are the group's own look. A kiosk
-- design can give a group a look of its own for that design
-- (kiosk_designs.settings options.group_looks), which wins over the group's
-- (shared/kiosk.js groupLook()). Like the other kiosk settings on groups they
-- change straight away, not per publish (they aren't in menu releases).

ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS kiosk_tiles text
    CHECK (kiosk_tiles IN ('cards', 'round', 'oval', 'hexagon', 'plain')),
  ADD COLUMN IF NOT EXISTS kiosk_pictures boolean,
  ADD COLUMN IF NOT EXISTS kiosk_entrance text
    CHECK (kiosk_entrance IN ('none', 'appear', 'slide', 'bubble', 'deal')),
  ADD COLUMN IF NOT EXISTS variation_type text
    CHECK (variation_type IN ('modification', 'side', 'addition'));
