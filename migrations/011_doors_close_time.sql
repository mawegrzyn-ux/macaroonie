-- ============================================================
-- 011_doors_close_time.sql
-- Adds doors_close_time to day templates and a widget booking
-- rule for allowing bookings past doors-close.
-- ============================================================

-- Per-day "doors close" time — physical close, separate from last-order (closes_at on sittings)
ALTER TABLE venue_schedule_templates
  ADD COLUMN doors_close_time time;

-- When false (default): the widget cannot show slots at or after doors_close_time.
-- Admin bookings bypass this rule.
ALTER TABLE booking_rules
  ADD COLUMN allow_widget_bookings_after_doors_close boolean NOT NULL DEFAULT false;
