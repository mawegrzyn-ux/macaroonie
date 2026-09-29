-- ============================================================
-- 134_promo_box.sql
--
-- The promo box on the online ordering page (a card above the basket
-- on desktop, under the title on phones), replacing the plain offers
-- line under the title. Each promotion chooses whether it appears there
-- and how the card looks:
--   show_in_box    shown in the box (never for code promotions, whose
--                  code must not reach the page)
--   box_bg         theme role name (primary, accent, ...) or #hex;
--                  NULL = primary
--   box_text       theme role name or #hex; NULL = white / automatic
--   box_image_url  background image (cover), with a shade for reading
-- The Online ordering block can hide the box (show_promo_box).
-- ============================================================

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS show_in_box   boolean NOT NULL DEFAULT false;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS box_bg        text;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS box_text      text;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS box_image_url text;

-- Promotions that showed in the old offers line keep showing.
UPDATE promotions SET show_in_box = true WHERE apply_mode <> 'code';
