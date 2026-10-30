-- Hub-first locations (docs/POS.md section 11): at a location whose venue hub
-- is linked, tills, kiosks and kitchen screens on the venue network send their
-- events to the hub first. The hub decides them over its own copy of the venue
-- (shared/pos/mirror.js), at LAN speed and with the internet down, then sends
-- them to the cloud, which decides them again and stays the one record.
--
--   pos_settings.hub_first          on by default: devices get the hub's address
--                                   in their config while a hub is linked
--   pos_events.hub_id               the hub that decided the event first (sent
--                                   up through POST /pos-api/hub/events)
--   pos_event_rejections.hub_id     a change the hub refused, or the cloud
--                                   refused when the hub sent it up
--
-- Devices prove themselves to the hub with a key worked out from their
-- pairing (vault.js deriveKey()): nothing new is stored, and a device paired
-- again gets a new key.

ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS hub_first boolean NOT NULL DEFAULT true;

ALTER TABLE pos_events ADD COLUMN IF NOT EXISTS hub_id uuid;
ALTER TABLE pos_event_rejections ADD COLUMN IF NOT EXISTS hub_id uuid;
