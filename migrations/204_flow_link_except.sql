-- 204_flow_link_except.sql
--
-- A kitchen flow link can be set to Except: kds_flow_edges.exclude = true
-- means the link takes every dish its filter (targets) doesn't name, instead
-- of only the ones it names (shared/pos/kitchen.js linkRank()). An Except
-- link comes after any link whose filter names the dish and before a link
-- with no filter. With no filter it means nothing, so the API keeps it false
-- then. Shared flows keep the same flag on each of kds_flows.box_links.

ALTER TABLE kds_flow_edges ADD COLUMN IF NOT EXISTS exclude boolean NOT NULL DEFAULT false;
