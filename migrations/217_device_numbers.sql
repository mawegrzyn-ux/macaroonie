-- Every till and kiosk numbers its own checks and counter orders
-- (shared/pos/numbers.js, docs/POS.md 8.4), so a device working alone, the
-- venue hub and the cloud can all give out numbers at the same time and never
-- give the same one twice.
--
--   pos_checks.number_code         the device's code on the check (T2): the check is T2-47
--   pos_venue_state.device_numbers each device's highest numbers for its trading day,
--                                  { device_id: { date, check, order } }, sent back to a
--                                  device that lost its storage
--   pos_devices.settings.order_numbers  { from, to }: a till's or kiosk's own range of
--                                  counter order numbers (a block of a hundred each by default)
--   pos_devices.pending_changes    changes the device says it hasn't sent yet (X-Pos-Pending),
--                                  shown when the day is closed
--
-- The venue-wide counters go: pos_venue_state.next_check_no / next_order_no and
-- pos_settings.order_no_start.

ALTER TABLE pos_checks ADD COLUMN IF NOT EXISTS number_code text;

ALTER TABLE pos_venue_state ADD COLUMN IF NOT EXISTS device_numbers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE pos_venue_state DROP COLUMN IF EXISTS next_check_no;
ALTER TABLE pos_venue_state DROP COLUMN IF EXISTS next_order_no;

ALTER TABLE pos_settings DROP COLUMN IF EXISTS order_no_start;

ALTER TABLE pos_devices
  ADD COLUMN IF NOT EXISTS pending_changes int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_at      timestamptz;

-- Tills and kiosks already linked: a block each per location, in the order
-- they were added (devices in use first): 1-99, 100-199, 200-299, ...
UPDATE pos_devices d
   SET settings = COALESCE(d.settings, '{}'::jsonb) || jsonb_build_object('order_numbers',
         jsonb_build_object('from', CASE WHEN x.i = 0 THEN 1 ELSE x.i * 100 END, 'to', x.i * 100 + 99))
  FROM (
    SELECT id, row_number() OVER (PARTITION BY venue_id ORDER BY (revoked_at IS NOT NULL), created_at, id) - 1 AS i
      FROM pos_devices
     WHERE kind IN ('terminal', 'kiosk')
  ) x
 WHERE d.id = x.id AND x.i < 98 AND NOT (COALESCE(d.settings, '{}'::jsonb) ? 'order_numbers');
