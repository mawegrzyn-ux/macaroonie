-- Till layouts (Store tech > Till layouts, shared/pos/tillLayout.js): how a
-- till's order screen is arranged, company wide. A layout is a grid of zones
-- (the order, categories, dishes, buttons, dish choices, the seat and course
-- bar), each with its own grid of buttons, text size and overflow.
--
-- A location picks the layout its tills use (pos_settings.till_layout_id,
-- NULL = the standard screen); a till can pick its own
-- (pos_devices.settings.till_layout: 'venue' or absent = the location's,
-- 'standard', or a layout id).

CREATE TABLE IF NOT EXISTS pos_till_layouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  layout      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_till_layouts_tenant ON pos_till_layouts (tenant_id, sort_order);

ALTER TABLE pos_till_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_till_layouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_till_layouts;
CREATE POLICY tenant_isolation ON pos_till_layouts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS till_layout_id uuid REFERENCES pos_till_layouts(id) ON DELETE SET NULL;

-- Main menu: Till layouts in every group's Store tech menu, just after Tills,
-- seen by the same roles as Tills.
UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/pos/tills' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = r.tenant_id AND x.route = '/pos/layouts');

INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Till layouts', 'PanelsTopLeft', '/pos/layouts', 'pos_setup', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/pos/tills'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/layouts');
