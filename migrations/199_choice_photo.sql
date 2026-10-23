-- 199_choice_photo.sql
--
-- A second picture for an option group's option: the one shown on the
-- dish's photo.
--
--   menu_variant_options.photo_url   on kiosks, the picture the option puts
--                                    on (or in place of) the dish's photo
--                                    when its group has Split photo on
--                                    (shared/kiosk.js splitImages()); NULL =
--                                    image_url. image_url stays the picture
--                                    on the choice's own tile.
--
-- Combo choices get the same as photo_url in the combo's JSON (shared/
-- combos.js, stored only when set, so combos saved before it don't read as
-- changed); a dish choice without one shows the dish's own photo.

ALTER TABLE menu_variant_options
  ADD COLUMN IF NOT EXISTS photo_url text CHECK (length(photo_url) <= 2000);
