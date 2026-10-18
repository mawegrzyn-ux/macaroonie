-- 182_kitchen_flow_stations.sql
--
-- A kitchen flow can leave stations out (the grill down tonight, one cook
-- on): kds_flows.off_station_ids are the venue's stations this flow doesn't
-- use. The designer doesn't draw them and the flow can't link to them, so
-- no dish goes there while this flow is in use; the station itself stays,
-- with its screens and settings, for the other flows. Ids of stations
-- deleted later are ignored when read.

BEGIN;

ALTER TABLE kds_flows ADD COLUMN IF NOT EXISTS off_station_ids uuid[] NOT NULL DEFAULT '{}';

COMMIT;
