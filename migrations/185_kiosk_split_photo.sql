-- 185_kiosk_split_photo.sql
--
-- Kiosks: an option group can make the dish's split photo. When a guest
-- picks options in groups with this on (two or more with pictures), the
-- dish's photo becomes the pictures side by side, each showing its own part
-- (left, middle, right), with a torn edge between them, on the dish page and
-- the basket line. Combo steps carry the same switch in menu_items.combo
-- (steps[].split, stored only when true). Off for every group to start with.

BEGIN;

ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS kiosk_split boolean NOT NULL DEFAULT false;

COMMIT;
