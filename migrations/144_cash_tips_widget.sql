-- 144_cash_tips_widget.sql
--
-- Cash Dashboard widget 'cash_tips_payout': the week's tips to pay out to
-- staff, in cash and by bank transfer (figures from the rota pay payload,
-- computeRotaWeek() in rotaCalc.js). Display options live in the widget's
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
    'cash_tips_payout',
    'rota_grid', 'rota_today', 'rota_week_pay', 'rota_tips'
  ));

COMMIT;
