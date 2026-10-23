-- 200_kitchen_sleeper.sql
--
-- A Sleeper in the kitchen flow: kds_stations.kind 'sleeper' holds the dishes
-- that reach it for settings.delay_mins (1-240), then passes them on by
-- itself (shared/pos/kitchen.js flowTimes()). Which dishes it holds is
-- decided by the links into it, like any station: a filter by order type,
-- revenue stream, till, dish or section, or none for every dish. It has no
-- screen and nothing to bump.
--
-- The Balance box is called a Splitter from now on; its kind stays 'balance'.

ALTER TABLE kds_stations DROP CONSTRAINT IF EXISTS kds_stations_kind_check;
ALTER TABLE kds_stations ADD CONSTRAINT kds_stations_kind_check
  CHECK (kind IN ('prep', 'expo', 'runner', 'board', 'balance', 'printer', 'sleeper'));
