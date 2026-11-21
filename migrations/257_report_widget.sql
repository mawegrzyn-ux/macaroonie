-- A report on a dashboard (docs/REPORTS.md 15): widget type 'report', the
-- report picked in Edit layout and kept in the widget's settings.report.

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
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips'
  ));
