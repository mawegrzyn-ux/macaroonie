-- 121_menu_print_layout_designer.sql
--
-- Menu designer: a hand-placed print layout per menu.
--
-- menus.print_layout jsonb, NULL = automatic layout (menu_print.eta).
-- When set, GET /api/menus/:id/print renders it instead (menu_print_designed.eta).
-- Shape (validated by LayoutBody in api/src/routes/menus.js, rendered by
-- shared/menuLayout.js):
--   { paper_size, orientation, margin_mm, cols, row_mm, font_scale,
--     master: [block], pages: [{ id, hide_master, blocks: [block] }] }
--   block = { id, type, ref, x, y, w, h, opts }
-- Blocks point at menu_sections.id / menu_items.id (ref), so the menu save
-- now keeps section and dish ids instead of issuing new ones each time.

BEGIN;

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS print_layout jsonb;

COMMIT;
