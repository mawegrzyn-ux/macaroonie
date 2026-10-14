-- 162_gloriafood_import.sql
--
-- Importing past GloriaFood orders from the order list GloriaFood's admin
-- exports (its API has no history: migration 159). Imported orders go into
-- gloriafood_orders like pushed or polled ones, so Cash Recon fills from
-- them the same way:
--   received_via  'import'   (as well as 'push' / 'poll'). Imported rows hold
--                            no guest details and no dishes, only the money,
--                            dates, outcome, payment and order type. They are
--                            never shown on the Online orders board, and a
--                            pushed or polled copy of the same order replaces
--                            them; an import never changes an order GloriaFood
--                            sent directly.
--   gloriafood_venue_links.last_import_at / _by / _file   the last import.

BEGIN;

ALTER TABLE gloriafood_orders DROP CONSTRAINT gloriafood_orders_received_via_check;
ALTER TABLE gloriafood_orders ADD CONSTRAINT gloriafood_orders_received_via_check
  CHECK (received_via IN ('push', 'poll', 'import'));

ALTER TABLE gloriafood_venue_links
  ADD COLUMN last_import_at   timestamptz,
  ADD COLUMN last_import_by   text,
  ADD COLUMN last_import_file text;

COMMIT;
