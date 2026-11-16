-- 255_flow_link_always.sql
--
-- A kitchen flow link can be set to Always: kds_flow_edges.always = true means
-- every dish the link's filter takes follows it, whatever the other links out
-- of the same box decide (shared/pos/kitchen.js nextStations()). Links that
-- aren't Always keep the old rule: a dish takes only the most specific of
-- them. Shared flows keep the same flag on each of kds_flows.box_links.

ALTER TABLE kds_flow_edges ADD COLUMN IF NOT EXISTS always boolean NOT NULL DEFAULT false;
