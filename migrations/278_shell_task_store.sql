-- The task store (Pepper-first step 5a, reports/AI first back office
-- strategy.md "For review and the task store", docs/PEPPER_FIRST.md 13,
-- decisions 7 and 8). The Today feed (api/src/services/opsToday.js) still
-- works every task out from data and rules on each request; this keeps what
-- people decided about a task, by the feed's stable key, per venue:
--
--   ops_task_states  one row per venue and task key: who owns it (a team
--                    member, users.id), snoozed until when, skipped on which
--                    day (a reason is required, and who skipped it), marked
--                    done on which day (who and when, for the tasks the feed
--                    can't see finish). The feed applies it: a snoozed task
--                    hides until then, a skipped or done one leaves the list
--                    for that day, the owner shows on the task.
--   ops_task_log     every change, one row each (assigned, snoozed, skipped,
--                    done and their undoing, escalated by the notices sweep):
--                    the task's history, and the report on skips by site.
--   ops_task_days    the feed's own record, kept by the notices sweep
--                    (services/notices.js) every five minutes as the group's
--                    owner: each task seen per venue and day, when it went
--                    late, when it left the feed (finished) or was skipped.
--                    Completion by site and escalation (late by more than
--                    ESCALATE_MINUTES) are read from it.
--
-- Read and written only through /api/ops (routes/ops.js, services/opsTasks.js).
-- task_notices gains the kind 'escalated': a late task also told to the
-- venue's managers, once per venue, task and day.

CREATE TABLE IF NOT EXISTS ops_task_states (
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  task_key      text        NOT NULL CHECK (length(task_key) BETWEEN 1 AND 200),
  area          text,
  kind          text,
  title         text,
  owner_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  snoozed_until timestamptz,
  snoozed_by    text,
  skipped_on    date,
  skip_reason   text        CHECK (skip_reason IS NULL OR length(btrim(skip_reason)) BETWEEN 1 AND 300),
  skipped_by    text,
  skipped_at    timestamptz,
  done_on       date,
  done_by       text,
  done_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, task_key),
  CHECK ((skipped_on IS NULL) = (skip_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS ops_task_states_tenant ON ops_task_states (tenant_id, venue_id);
CREATE INDEX IF NOT EXISTS ops_task_states_owner ON ops_task_states (owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops_task_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  task_key    text        NOT NULL,
  day         date        NOT NULL,
  area        text,
  kind        text,
  title       text,
  action      text        NOT NULL CHECK (action IN ('assigned', 'unassigned', 'snoozed', 'unsnoozed', 'skipped', 'unskipped', 'done', 'undone', 'escalated')),
  reason      text,
  until_at    timestamptz,
  owner_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  owner_name  text,
  by_sub      text,
  by_name     text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_task_log_task ON ops_task_log (tenant_id, venue_id, task_key, at DESC);
CREATE INDEX IF NOT EXISTS ops_task_log_day ON ops_task_log (tenant_id, day, action);
CREATE INDEX IF NOT EXISTS ops_task_log_venue ON ops_task_log (venue_id);

CREATE TABLE IF NOT EXISTS ops_task_days (
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id      uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day           date        NOT NULL,
  task_key      text        NOT NULL,
  area          text        NOT NULL,
  kind          text        NOT NULL,
  title         text,
  compliance    boolean     NOT NULL DEFAULT false,
  due           time,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  late_at       timestamptz,
  finished_at   timestamptz,
  skipped       boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (venue_id, day, task_key)
);
CREATE INDEX IF NOT EXISTS ops_task_days_tenant ON ops_task_days (tenant_id, day);

ALTER TABLE task_notices DROP CONSTRAINT IF EXISTS task_notices_kind_check;
ALTER TABLE task_notices ADD CONSTRAINT task_notices_kind_check CHECK (kind IN ('due_soon', 'late', 'escalated'));

ALTER TABLE ops_task_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_task_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops_task_states;
CREATE POLICY tenant_isolation ON ops_task_states
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE ops_task_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_task_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops_task_log;
CREATE POLICY tenant_isolation ON ops_task_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE ops_task_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_task_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops_task_days;
CREATE POLICY tenant_isolation ON ops_task_days
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
