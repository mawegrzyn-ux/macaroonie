-- 105_dashboard_widget_settings.sql
--
-- Per-widget display options for the H&S and Cash dashboards, e.g. the
-- Cash Dashboard's Days of the week widget: { "hide_closed": true,
-- "compact": true }. Each widget type declares which options it has in
-- the admin (CASH_WIDGET_TYPES[].options); the API stores the object as is.

ALTER TABLE hs_dashboard_widgets
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
