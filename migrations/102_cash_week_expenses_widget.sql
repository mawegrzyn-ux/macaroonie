-- 102_cash_week_expenses_widget.sql
--
-- New Cash Dashboard widget type:
--   cash_week_expenses  every petty cash expense logged in the week, by day
--
-- Reads from the existing week-detail endpoint, so this is only the
-- widget_type CHECK constraint.

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles',
    'cash_week_expenses'
  ));
