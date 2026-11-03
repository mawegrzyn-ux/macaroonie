-- Order flows (Store tech > Order flows, shared/pos/orderFlows.js): rules
-- that act on an order by themselves, company wide.
--
--   ask  a prompt offering a dish or a choice of dishes ("Add a drink?"),
--        when a dish is added or at checkout
--   add  dishes and charges put on by themselves while the order matches
--        (revenue stream = channel, order type, its dishes), each one staff
--        may take off or not
--
-- Each runs at every location or the ones it names, on every till there or
-- the ones it names. name, is_active and sort_order are columns (the list,
-- its order, the on / off switch); the rest of the flow is jsonb
-- (normaliseOrderFlow() is its one shape). Tills, the sequencer and the
-- venue hub get the flows of their venue in settings.flows.

CREATE TABLE IF NOT EXISTS pos_order_flows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  flow        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_order_flows_tenant ON pos_order_flows (tenant_id, sort_order);

ALTER TABLE pos_order_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_flows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_order_flows;
CREATE POLICY tenant_isolation ON pos_order_flows
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- Main menu: Order flows in every group's Store tech menu, just after
-- Charges, seen by the same roles as Charges.
UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/pos/charges' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = r.tenant_id AND x.route = '/pos/flows');

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Order flows', 'Workflow', '/pos/flows', 'pos_setup', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/pos/charges'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/flows');
