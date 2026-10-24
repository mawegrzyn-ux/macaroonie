-- 205_corner_pick_size.sql
--
-- How big the picks' pictures are when an option group puts them small in
-- the corner of the dish's photo on kiosks (kiosk_pick_photo 'corner',
-- migration 201): kiosk_pick_scale is each picture's width as a share of the
-- photo's width, in % (10 to 70); NULL = automatic (about a quarter, smaller
-- when several share the corner). Combo steps keep the same as pick_scale in
-- menu_items.combo, stored only when set (shared/combos.js pickScale()).

ALTER TABLE menu_variant_groups ADD COLUMN IF NOT EXISTS kiosk_pick_scale smallint
  CHECK (kiosk_pick_scale BETWEEN 10 AND 70);
