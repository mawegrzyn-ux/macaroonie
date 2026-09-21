-- Printable menu page: paper size + orientation, alongside the existing
-- print_columns. Defaults match the previous hardcoded behaviour (A4
-- landscape) so existing menus print unchanged until an operator picks
-- something else.

ALTER TABLE menus
  ADD COLUMN print_orientation text NOT NULL DEFAULT 'landscape'
    CHECK (print_orientation IN ('landscape', 'portrait')),
  ADD COLUMN print_paper_size text NOT NULL DEFAULT 'A4'
    CHECK (print_paper_size IN ('A4', 'A3'));
