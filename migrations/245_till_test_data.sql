-- 245_till_test_data.sql
--
-- Test till sales (the Test data page, docs/REPORTS.md phase 1c). The
-- generator (api/src/services/tillTestDataSvc.js) makes past trading days
-- with their checks, built from till events run through the till's own
-- check rules (shared/pos/checks.js) and stored the way the sequencer
-- stores a check. It writes no events, print jobs, kitchen orders or Cash
-- Recon days, and never touches a date that has a real trading day.
--
-- is_generated marks what it made, so Clear generated till sales removes
-- only those rows: the days, and their checks with the lines, payments and
-- breakdowns that go with a check (each of those cascades from pos_checks).

ALTER TABLE pos_days   ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;
ALTER TABLE pos_checks ADD COLUMN IF NOT EXISTS is_generated boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS pos_days_generated ON pos_days (venue_id, business_date) WHERE is_generated;
CREATE INDEX IF NOT EXISTS pos_checks_generated ON pos_checks (venue_id, day_id) WHERE is_generated;
