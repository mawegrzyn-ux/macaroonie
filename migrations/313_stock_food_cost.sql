-- Inventory phase 6b (docs/INVENTORY.md 8.1, 10.3, 10.4): food cost beyond
-- the stock period. Cash Recon's week line, the dashboard widgets and the
-- Overview tile read what is there already (dish_cost_days, stock_periods,
-- stock_waste, menu margins worked out on each read); this migration adds
-- the names they need and one table for the rule trigger "a dish goes over
-- its cost target".
--
-- Dish ids are plain (the menu save deletes and re-inserts dishes under the
-- same ids): nothing here points at menu_items with a foreign key.

-- Rule triggers: a dish over its cost target, a stock period closed with its
-- variance over the band, waste logged (over a value). Actions stay the two
-- a rule may run (shared/rules.js).
ALTER TABLE pepper_rules DROP CONSTRAINT IF EXISTS pepper_rules_trigger_check;
ALTER TABLE pepper_rules ADD CONSTRAINT pepper_rules_trigger_check
  CHECK (trigger IN ('fridge_reading', 'supplier_order', 'task_late', 'review_low',
                     'dish_over_target', 'variance_over_band', 'waste_logged'));

-- Dashboard widgets (components/stock/widgetTypes.js): food cost % actual
-- and theoretical, waste this week by reason, top variance items, margin by
-- menu. Keep in step with WIDGET_MODULE in api/src/routes/hsDashboards.js.
ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'allergen_lookup', 'local_info', 'report',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles',
    'cash_week_expenses', 'cash_week_summary_grid', 'cash_week_staff',
    'cash_tips_payout', 'cash_import',
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips',
    'stock_food_cost', 'stock_waste_week', 'stock_variance_items', 'stock_menu_margins'
  ));

-- The Overview's stock tile (each venue's counts, transfers, flagged items
-- and food cost). Keep in step with TILE_CATALOG in api/src/routes/dashboardTiles.js.
ALTER TABLE dashboard_tiles
  DROP CONSTRAINT IF EXISTS dashboard_tiles_tile_type_check;
ALTER TABLE dashboard_tiles
  ADD CONSTRAINT dashboard_tiles_tile_type_check
  CHECK (tile_type IN (
    'quick_access', 'stats_today', 'upcoming_bookings',
    'venues_status', 'hs_today_status', 'hs_week_status',
    'allergen_lookup', 'stock_status'
  ));

-- The dishes over their cost target at each venue, as the cost targets sweep
-- (jobs/cost-targets.js, services/stockFoodCostSvc.js) last found them: a
-- dish newly over (or moved from over the target to over the limit) is a
-- crossing, and the rule trigger dish_over_target fires once for it (the
-- event's key carries `since`); a dish back under is deleted, so going over
-- again is a new event. dish_id is plain (no foreign key, above).
CREATE TABLE cost_target_states (
  tenant_id      uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id       uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  dish_id        uuid          NOT NULL,
  name           text          NOT NULL,
  menu_id        uuid,
  menu           text,
  order_type_id  uuid,
  band           text          NOT NULL CHECK (band IN ('watch', 'over')),
  cost_pct       numeric(8,2)  NOT NULL,
  target_pct     numeric(6,2),
  limit_pct      numeric(6,2),
  since          timestamptz   NOT NULL DEFAULT now(),
  seen_at        timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, venue_id, dish_id)
);
CREATE INDEX cost_target_states_venue ON cost_target_states (tenant_id, venue_id);

ALTER TABLE cost_target_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_target_states FORCE ROW LEVEL SECURITY;
CREATE POLICY cost_target_states_tenant ON cost_target_states
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
