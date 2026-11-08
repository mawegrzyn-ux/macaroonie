-- 239_review_recording.sql
-- Reviews recorded off the review sites' own pages (Google, TripAdvisor,
-- Deliveroo, Just Eat) by a browser client — Claude in Chrome through the
-- staff connector — land in a "To check" inbox on the Reviews page.
--
-- checked_at says a person has looked at a review and decided: approved it
-- for the website, or chose to keep it off. A review kept off stays as a row
-- (checked, unapproved) because its external_id fingerprint is what stops the
-- same review being recorded again next time the page is read.

BEGIN;

ALTER TABLE reviews
  ADD COLUMN checked_at timestamptz,
  ADD COLUMN checked_by text;

-- Reviews from before the inbox existed have been dealt with however the
-- operator dealt with them: start the inbox empty.
UPDATE reviews SET checked_at = created_at;

CREATE INDEX reviews_to_check_idx ON reviews (tenant_id) WHERE checked_at IS NULL;

COMMIT;
