-- ============================================================
-- 095_menu_section_image.sql
--
-- Small category icon/image per menu section (Starters, Curries, …),
-- shown next to the section title. Deliberately capped small on the
-- website (rendered no larger than the heading font) even though the
-- uploaded source image can be a normal-resolution icon/photo (e.g.
-- 64x64 or 96x96) — nothing needs a dedicated size variant.
-- ============================================================

BEGIN;

ALTER TABLE menu_sections
  ADD COLUMN IF NOT EXISTS image_url text;

COMMIT;
