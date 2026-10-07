-- 141_allergen_matrix.sql
--
-- Allergen matrix (Menus > Allergen matrix) and the Allergen lookup for
-- dashboards. No new data tables: the matrix edits menu_item_dietary.
--
-- 1. New dashboard widget type 'allergen_lookup' (H&S dashboards).
-- 2. New Overview tile type 'allergen_lookup'.
-- 3. Nav link "Allergen matrix" under Menus for existing tenants (new
--    tenants get it from defaultNav.js). Anchored on the /menus route,
--    not a label, so renamed sections still get it.

BEGIN;

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'allergen_lookup',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles',
    'cash_week_expenses', 'cash_week_summary_grid', 'cash_week_staff',
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips'
  ));

ALTER TABLE dashboard_tiles
  DROP CONSTRAINT IF EXISTS dashboard_tiles_tile_type_check;
ALTER TABLE dashboard_tiles
  ADD CONSTRAINT dashboard_tiles_tile_type_check
  CHECK (tile_type IN (
    'quick_access', 'stats_today', 'upcoming_bookings',
    'venues_status', 'hs_today_status', 'hs_week_status',
    'allergen_lookup'
  ));

-- Nav: add "Allergen matrix" as a child of each tenant's /menus link,
-- after its existing children.
INSERT INTO nav_items (tenant_id, parent_id, kind, label, icon, route, module, sort_order)
SELECT m.tenant_id, m.id, 'link', 'Allergen matrix', 'Grid3x3', '/menus/allergens', 'menus',
       COALESCE((SELECT MAX(c.sort_order) + 1 FROM nav_items c WHERE c.parent_id = m.id), 0)
  FROM nav_items m
 WHERE m.route = '/menus'
   AND m.id = (SELECT n.id FROM nav_items n
                WHERE n.tenant_id = m.tenant_id AND n.route = '/menus'
                ORDER BY n.sort_order LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM nav_items x
                    WHERE x.tenant_id = m.tenant_id AND x.route = '/menus/allergens');

COMMIT;
