-- How often a location's devices ask for changes (shared/pos/pullTimes.js,
-- Store tech -> Device updates). Seconds; the defaults are what the devices
-- used before (3 minutes for the whole config, 30 s for prices and sold out,
-- a minute for menu screens, 15 s for order ready board numbers).

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS pull_content_secs integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS pull_live_secs    integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pull_screen_secs  integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS pull_board_secs   integer NOT NULL DEFAULT 15;

ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_pull_content_check;
ALTER TABLE pos_settings ADD CONSTRAINT pos_settings_pull_content_check CHECK (pull_content_secs BETWEEN 60 AND 3600);
ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_pull_live_check;
ALTER TABLE pos_settings ADD CONSTRAINT pos_settings_pull_live_check CHECK (pull_live_secs = 0 OR pull_live_secs BETWEEN 10 AND 600);
ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_pull_screen_check;
ALTER TABLE pos_settings ADD CONSTRAINT pos_settings_pull_screen_check CHECK (pull_screen_secs BETWEEN 30 AND 3600);
ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_pull_board_check;
ALTER TABLE pos_settings ADD CONSTRAINT pos_settings_pull_board_check CHECK (pull_board_secs BETWEEN 5 AND 300);

-- The Device updates page in every group's Store tech menu, after Card machines.
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order, hidden_role_ids, show_in_launcher)
SELECT n.tenant_id, n.parent_id, 'link', 'Device updates', 'RefreshCw', '/pos/updates', 'pos_setup', n.sort_order + 1, n.hidden_role_ids, false
  FROM nav_items n
 WHERE n.route = '/pos/cards'
   AND NOT EXISTS (SELECT 1 FROM nav_items x WHERE x.tenant_id = n.tenant_id AND x.route = '/pos/updates');

UPDATE nav_items n SET sort_order = n.sort_order + 1
  FROM nav_items r
 WHERE r.route = '/pos/cards' AND n.tenant_id = r.tenant_id
   AND n.parent_id IS NOT DISTINCT FROM r.parent_id
   AND n.sort_order > r.sort_order AND n.route IS DISTINCT FROM '/pos/updates';
