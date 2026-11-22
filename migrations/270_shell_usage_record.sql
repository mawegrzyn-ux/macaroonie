-- The usage record (Pepper-first step 0a, reports/AI first back office
-- strategy.md "0. Prove and instrument"): which pages people open in the
-- admin, and what they type in the menu search (the ask bar), whether they
-- then handed it to Pepper and what they opened. Written by
-- POST /api/usage/events from small batches the admin sends
-- (admin/src/lib/usage.js); kept 90 days (cleanUpUsage(), the hourly
-- ai-cleanup job).
--
-- Decision 8 of the strategy: the record of what a person opens stays that
-- person's own. The report subject with the person's rows reads only the
-- person running it ({me}); the group-wide subjects have no person field.
--
--   kind     page    a page opened: path only (no query string, ids in the
--                    address turned into :id, services/usageRecord.js)
--            search  one search in the menu box: the words typed last, how
--                    many of the menu's own matches they had, whether they
--                    were handed to Pepper, and what was opened (a menu
--                    match, a saved report, one of Pepper's picks, or nothing)

CREATE TABLE IF NOT EXISTS usage_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub   text        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('page', 'search')),
  at         timestamptz NOT NULL DEFAULT now(),
  path       text,
  query      text,
  results    integer,
  pepper     boolean     NOT NULL DEFAULT false,
  picked     text        CHECK (picked IN ('menu', 'report', 'pepper')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'search' OR (query IS NULL AND results IS NULL AND NOT pepper AND picked IS NULL))
);
CREATE INDEX IF NOT EXISTS usage_events_day ON usage_events (tenant_id, at);
CREATE INDEX IF NOT EXISTS usage_events_person ON usage_events (tenant_id, user_sub, at);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage_events;
CREATE POLICY tenant_isolation ON usage_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
