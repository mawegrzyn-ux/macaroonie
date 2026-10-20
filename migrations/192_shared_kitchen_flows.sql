-- ============================================================
-- 192_shared_kitchen_flows.sql
-- Kitchen flows shared by every location (Till setup > Kitchen screens >
-- Kitchen flows). docs/POS.md section 9.
--
--   kds_flows.venue_id    NULL = a shared flow: every location lists it next
--                         to its own flows and can put it in use
--                         (pos_settings.kds_active_flow_id, per location)
--   kds_flows.boxes       a shared flow's boxes: [{ id, name, kind }]. At a
--                         location each box is its station with the same
--                         name (case and spaces ignored); a box a location
--                         has no station for is left out there
--   kds_flows.box_links   a shared flow's links: [{ id, from: box id | null,
--                         to: box id, targets }]. Dishes, sections and order
--                         types by id; revenue streams and tills / kiosks
--                         ({ kind: 'device' }) by name, each location's own
--                         (shared/pos/kitchen.js resolveSharedFlow())
--
-- A location's own flows keep their links in kds_flow_edges. Shared flow
-- names are unique in the company.
-- ============================================================

BEGIN;

ALTER TABLE kds_flows ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE kds_flows ADD COLUMN IF NOT EXISTS boxes     jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE kds_flows ADD COLUMN IF NOT EXISTS box_links jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS kds_flows_shared_name ON kds_flows (tenant_id, lower(btrim(name))) WHERE venue_id IS NULL;
CREATE INDEX IF NOT EXISTS kds_flows_shared ON kds_flows (tenant_id, sort_order) WHERE venue_id IS NULL;

COMMIT;
