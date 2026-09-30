-- ============================================================
-- 136_menu_section_visibility.sql
--
-- Where a menu section (category) shows:
--   show            everywhere (default)
--   website_hidden  printed menus only: left out of the website
--                   (Menu (inline) block, public menu JSON) and online
--                   ordering
--   hidden          nowhere: not printed, not on the website, not
--                   orderable. Kept on the Menus page to show again later.
-- ============================================================

ALTER TABLE menu_sections
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'show';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_sections_visibility_check') THEN
    ALTER TABLE menu_sections
      ADD CONSTRAINT menu_sections_visibility_check CHECK (visibility IN ('show', 'website_hidden', 'hidden'));
  END IF;
END $$;
