-- ============================================================
-- 087_hs_dashboard_more_widgets.sql
--
-- Widens the H&S Dashboard widget picker beyond checklist / temp_checks
-- to cover the rest of the food-safety module: delivery checks, hot/cold
-- hold checks, and cooking/reheat checks — each backed by the existing
-- fs_delivery_checks / fs_hold_checks / fs_cooking_checks tables and
-- routes, with no template reference (same as temp_checks).
--
-- The original 086 migration's structural CHECK
--   (widget_type = 'checklist' AND checklist_template_id IS NOT NULL)
--   OR (widget_type = 'temp_checks' AND checklist_template_id IS NULL)
-- only had a disjunct for 'temp_checks' — it would have rejected every
-- row of any OTHER non-checklist widget type outright, since neither
-- branch matches. Rewritten as a boolean equivalence so any widget type
-- other than 'checklist' uniformly requires no template reference,
-- without needing a new disjunct added per type going forward.
-- ============================================================

BEGIN;

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT hs_dashboard_widgets_widget_type_check;

ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('checklist', 'temp_checks', 'delivery_checks', 'hold_checks', 'cooking_checks'));

ALTER TABLE hs_dashboard_widgets
  DROP CONSTRAINT hs_dashboard_widgets_check;

ALTER TABLE hs_dashboard_widgets
  ADD CONSTRAINT hs_dashboard_widgets_check
  CHECK ((widget_type = 'checklist') = (checklist_template_id IS NOT NULL));

COMMIT;
