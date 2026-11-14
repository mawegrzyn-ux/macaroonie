-- 248_local_info_feedback.sql
--
-- Relevant or not relevant (14 Nov 2026): staff flag what a capture found on
-- the Local info calendar, and Pepper learns from the flags to tune that
-- capture's search.
--
-- local_info_feedback: one flag per person per captured item (relevant true
-- or false; taking a flag off deletes the row). user_sub is the person's
-- login id. Only captured items take flags (the routes refuse typed-in
-- events): they are what a search can learn from.
--
-- local_info_sources gains what Pepper learned from its items' flags:
--   learned      { look_for: [...], leave_out: [...], summary, relevant,
--                  not_relevant, items }: short phrases the capture's web
--                  search uses beside the operator's own "Also look for"
--                  words (query), never in place of them
--   learned_at   when it was last worked out
--   flags_at     when a flag on one of its findings (of its own kind) was
--                last added, changed or taken off; later than learned_at
--                makes the next run learn again first
--   learn_auto   on (the usual): Pepper keeps it up to date before each run
--                and the search uses it; off: neither
--   learn_error  why the last learning before a run failed (the run carries on)
-- Weather captures keep these empty: a forecast has no search to tune.

CREATE TABLE local_info_feedback (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES local_info_items(id) ON DELETE CASCADE,
  user_sub   text NOT NULL,
  relevant   boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_sub)
);

CREATE INDEX local_info_feedback_tenant ON local_info_feedback (tenant_id, item_id);

ALTER TABLE local_info_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_info_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON local_info_feedback;
CREATE POLICY tenant_isolation ON local_info_feedback
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE local_info_sources
  ADD COLUMN IF NOT EXISTS learn_auto  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS learned     jsonb,
  ADD COLUMN IF NOT EXISTS learned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS flags_at    timestamptz,
  ADD COLUMN IF NOT EXISTS learn_error text;
