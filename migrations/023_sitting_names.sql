-- 023_sitting_names.sql
-- Add optional name to sittings for session identification in analytics.
-- Applies to weekly template sittings, date override sittings, and exception sittings.

ALTER TABLE venue_sittings    ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE override_sittings ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE exception_sittings ADD COLUMN IF NOT EXISTS name text;
