-- 195_hub_appliance.sql
--
-- The venue hub on a mini PC: USB printers plugged into it, what it says
-- about itself, and updates from Till setup.
--
--   pos_printers.local_id          a printer plugged into the venue hub's own
--                                  computer (connection 'device', device_id =
--                                  the hub): its id on that computer, e.g.
--                                  usb:04b8:0e28:<serial> on Linux or
--                                  win:<printer name> on Windows (hub/src/usb.js)
--   pos_devices.info               what a hub last said about itself: computer
--                                  (hostname, OS, addresses, status page port),
--                                  USB printers found, update state
--   pos_devices.info_at            when it said it
--   pos_devices.update_requested_at  Update now in Till setup: the hub updates
--                                  at its next quiet moment even with automatic
--                                  updates off (cleared once it runs the latest)
--
-- A hub's automatic updates are pos_devices.settings.auto_update (absent = on).

ALTER TABLE pos_printers ADD COLUMN IF NOT EXISTS local_id text;

ALTER TABLE pos_devices
  ADD COLUMN IF NOT EXISTS info jsonb,
  ADD COLUMN IF NOT EXISTS info_at timestamptz,
  ADD COLUMN IF NOT EXISTS update_requested_at timestamptz;
