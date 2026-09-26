-- 104_cash_staff_pay_type.sql
--
-- 1. cash_staff.pay_type ('hourly' | 'fixed'): how a staff member is paid.
--    It decides what default_rate means (£ per hour, or £ per week) and
--    seeds entry_type whenever the person is added to a week's wages.
--    Backfilled from the venue's saved default wage list where the person
--    is on it; everyone else starts as 'fixed' (what new wage entries have
--    always defaulted to).
--
-- 2. New Cash Dashboard widget type:
--    cash_week_staff  manage the week's staff list (pay type, hours, rate,
--                     amount, add/remove, set as default, copy from
--                     another week)

ALTER TABLE cash_staff
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'fixed';

ALTER TABLE cash_staff
  DROP CONSTRAINT IF EXISTS cash_staff_pay_type_check;
ALTER TABLE cash_staff
  ADD CONSTRAINT cash_staff_pay_type_check CHECK (pay_type IN ('hourly', 'fixed'));

UPDATE cash_staff s
   SET pay_type = d.entry_type
  FROM cash_wage_defaults d
 WHERE d.staff_id  = s.id
   AND d.tenant_id = s.tenant_id;

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT IF EXISTS hs_dashboard_widgets_widget_type_check;
ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN (
    'checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks', 'action_log',
    'cash_wages_paid', 'cash_petty_cash', 'cash_recon_grid',
    'cash_week_balance', 'cash_day_balance', 'cash_day_tiles',
    'cash_week_expenses', 'cash_week_summary_grid', 'cash_week_staff'
  ));
