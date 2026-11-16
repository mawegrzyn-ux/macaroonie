-- 254: each printer's language (16 Nov 2026).
--
-- The venue hub only spoke Epson's ESC/POS. Star printers as they come (TSP650,
-- SP700, mC-Print) run in Star Line Mode, which has no GS commands: they
-- printed every ESC/POS formatting code as a stray character (a ! and a B on
-- each line) and showed £ in the wrong character set. 'star' makes the hub
-- send Star Line Mode instead (hub/src/escpos.js).

ALTER TABLE pos_printers
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'escpos'
    CHECK (language IN ('escpos', 'star'));
