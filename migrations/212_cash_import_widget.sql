-- 212_cash_import_widget.sql
--
-- Dashboard widget 'cash_import': fill Cash Recon from Loyverse and
-- GloriaFood without leaving the dashboard (components/cashRecon/widgets.jsx).
-- It runs the same fill windows as Cash Recon (reconShared.jsx, the
-- /loyverse and /gloriafood preview + apply routes) and shows which days of
-- the week each source has filled (cash_daily_reports.<source>_filled_at,
-- now returned by week-detail). Display options live in the widget's
-- existing settings jsonb, so only the widget_type CHECK changes.

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
    'cash_tips_payout', 'cash_import',
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips'
  ));

COMMIT;
