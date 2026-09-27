-- 120_menu_print_layout.sql
--
-- Menu print layout controls.
--
-- menus.print_settings (jsonb, all keys optional; missing = today's layout):
--   font_scale     int 70-150   % applied to every printed font size (100)
--   margin_mm      number 3-25  page margin on all sides (unset = 8mm top/bottom, 12mm sides)
--   repeat_header  'first' | 'full' | 'compact'   header on the first page only,
--                  the full header on every page, or a one-line header on later pages
--   repeat_footer  bool  callouts (allergen key etc.) + footer line on every page
--                        instead of the last page only
--   page_numbers   bool  "Page 1 of 3" at the bottom of each page
--   keep_sections  bool  never split any section across columns / pages
--
-- menu_sections:
--   print_break_before   'none' | 'column' | 'page'   start the section in a
--                        new column, or on a new printed page
--   print_keep_together  bool  keep this section in one piece

BEGIN;

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS print_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE menu_sections
  ADD COLUMN IF NOT EXISTS print_break_before text NOT NULL DEFAULT 'none'
    CHECK (print_break_before IN ('none', 'column', 'page')),
  ADD COLUMN IF NOT EXISTS print_keep_together boolean NOT NULL DEFAULT false;

COMMIT;
