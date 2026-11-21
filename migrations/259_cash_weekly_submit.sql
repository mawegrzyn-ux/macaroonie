-- Cash Recon: submit once a week instead of each day (OUTSTANDING 44, item 10).
--
-- A venue setting over the per-day status that stays the store: 'daily' (as
-- before: each day is submitted on its own) or 'weekly' (days are filled in
-- and saved, and the whole week is submitted in one go from the week, the
-- phone's Cash Up list or Pepper; a day can't be submitted by itself).

ALTER TABLE cash_venue_settings
  ADD COLUMN IF NOT EXISTS submit_mode text NOT NULL DEFAULT 'daily';

ALTER TABLE cash_venue_settings
  DROP CONSTRAINT IF EXISTS cash_venue_settings_submit_mode_check;
ALTER TABLE cash_venue_settings
  ADD CONSTRAINT cash_venue_settings_submit_mode_check CHECK (submit_mode IN ('daily', 'weekly'));
