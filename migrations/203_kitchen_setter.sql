-- 203_kitchen_setter.sql
--
-- A Setter in the kitchen flow: kds_stations.kind 'setter' sets the order's
-- status as a dish passes it (shared/pos/kitchen.js orderStatus()). Its name
-- is the status (one Setter per name at a venue, checked by the API), and
-- settings.status_look / status_colour / status_text / status_anim /
-- status_lamp say how order ready boards show it. It passes dishes straight
-- on: no screen and nothing to bump.

ALTER TABLE kds_stations DROP CONSTRAINT IF EXISTS kds_stations_kind_check;
ALTER TABLE kds_stations ADD CONSTRAINT kds_stations_kind_check
  CHECK (kind IN ('prep', 'expo', 'runner', 'board', 'balance', 'printer', 'sleeper', 'setter'));
