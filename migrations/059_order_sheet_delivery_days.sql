-- Migration 059: add delivery_days to order_sheet_templates
-- Stores an array of day-of-week integers (0=Sun ... 6=Sat) so the
-- order form can default to the nearest upcoming delivery date.

ALTER TABLE order_sheet_templates
  ADD COLUMN IF NOT EXISTS delivery_days integer[] NOT NULL DEFAULT '{}';
