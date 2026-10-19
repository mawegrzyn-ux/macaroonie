-- 191_kitchen_printers.sql
--
-- Kitchen printers in the kitchen flow, printers plugged into a device, and
-- the venue hub.
--
--   kds_stations.kind 'printer'   a kitchen printer as a box in the flow
--                                 (settings.printer_id = a pos_printers row);
--                                 every dish whose way goes through it prints
--                                 there (shared/pos/kitchenPrint.js)
--   pos_printers.connection       'hub': a network printer the venue hub
--                                 prints to (host, port); 'device': a printer
--                                 plugged into a till or kitchen screen
--                                 (device_id), printed by its browser
--   pos_printers.status           what the hub last saw ({ online, paper_low,
--                                 paper_out, cover_open, error }, status_at)
--   pos_print_jobs.station_id     the printer box a kitchen ticket came from
--   pos_print_jobs.kitchen_order_id
--   pos_print_jobs.claimed_at     a job collected but never reported is
--                                 collected again after two minutes
--   pos_pairings.app 'hub'        a venue hub shows a code like a device
--
-- pos_print_routes is dropped: kitchen tickets go where the kitchen flow
-- sends dishes (a printer box), bills and receipts to each device's receipt
-- printer. Pre-production: existing routes aren't carried over (set up a
-- printer box in Till setup -> Kitchen screens -> Kitchen flow).

ALTER TABLE kds_stations DROP CONSTRAINT IF EXISTS kds_stations_kind_check;
ALTER TABLE kds_stations ADD CONSTRAINT kds_stations_kind_check
  CHECK (kind IN ('prep', 'expo', 'runner', 'board', 'balance', 'printer'));

ALTER TABLE pos_printers
  ADD COLUMN IF NOT EXISTS connection text NOT NULL DEFAULT 'hub',
  ADD COLUMN IF NOT EXISTS device_id  uuid REFERENCES pos_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status     jsonb,
  ADD COLUMN IF NOT EXISTS status_at  timestamptz;
ALTER TABLE pos_printers DROP CONSTRAINT IF EXISTS pos_printers_connection_check;
ALTER TABLE pos_printers ADD CONSTRAINT pos_printers_connection_check CHECK (connection IN ('hub', 'device'));
CREATE INDEX IF NOT EXISTS pos_printers_device ON pos_printers (device_id) WHERE device_id IS NOT NULL;

ALTER TABLE pos_print_jobs
  ADD COLUMN IF NOT EXISTS station_id       uuid REFERENCES kds_stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kitchen_order_id text,
  ADD COLUMN IF NOT EXISTS claimed_at       timestamptz;
CREATE INDEX IF NOT EXISTS pos_print_jobs_printer ON pos_print_jobs (printer_id, status, created_at);

ALTER TABLE pos_pairings DROP CONSTRAINT IF EXISTS pos_pairings_app_check;
ALTER TABLE pos_pairings ADD CONSTRAINT pos_pairings_app_check CHECK (app IN ('terminal', 'kds', 'kiosk', 'hub'));

DROP TABLE IF EXISTS pos_print_routes;
