-- 251_report_schedules.sql
--
-- Report schedules (docs/REPORTS.md 14): a report sent by email by itself,
-- every day, on chosen weekdays or once a month, at a time in the venue's
-- own time zone; and Email it now, a report sent once by hand.
--
-- A schedule belongs to the person who saved it (owner_sub) and runs as
-- them: what their role can see is checked at every run, and a schedule
-- whose owner can no longer run the report pauses (paused_reason) and the
-- owner and the group's owners are told. Its parts are JSON in the shapes
-- shared/reports/schedule.js gives (timing, delivery, condition,
-- recipients); params are the report's own choices for the schedule (a
-- period that moves with the date, venues, other choices).
--
-- The minute sweep (src/reports/schedules.js) claims due schedules with a
-- lease (running_until), always moves next_run_at on before it runs one,
-- and retries a send that failed while it is still under 6 hours late
-- (retry_of keeps the time the retried run was due). A send is recorded in
-- report_runs as kind 'scheduled' (by a schedule) or 'emailed' (Email it
-- now), with what was sent in `delivery`; a schedule deleted later leaves
-- its runs (schedule_id cleared).

CREATE TABLE report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- A saved report, or a starter report in code (its key).
  report_id uuid REFERENCES reports(id) ON DELETE CASCADE,
  starter_key text,
  CONSTRAINT report_schedules_one_report CHECK ((report_id IS NULL) <> (starter_key IS NULL)),
  owner_sub text NOT NULL,
  owner_email text,
  -- The email's subject when set, else the report's name; and a few words
  -- of the owner's own at the top of the email.
  name text CHECK (name IS NULL OR length(name) <= 120),
  message text CHECK (message IS NULL OR length(message) <= 1000),
  timing jsonb NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  delivery jsonb NOT NULL DEFAULT '{}',
  condition jsonb NOT NULL DEFAULT '{"when": "always"}',
  recipients jsonb NOT NULL DEFAULT '[]',
  -- People's details (columns the catalogue marks as personal) in emails to
  -- addresses outside the team: off unless an owner turns it on.
  personal_outside boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  paused_reason text,
  next_run_at timestamptz,
  retry_of timestamptz,
  running_until timestamptz,
  failures integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_sent_at timestamptz,
  last_status text CHECK (last_status IS NULL OR last_status IN ('sent', 'partly', 'not_met', 'late', 'failed', 'paused')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_schedules_report ON report_schedules (tenant_id, report_id) WHERE report_id IS NOT NULL;
CREATE INDEX report_schedules_starter ON report_schedules (tenant_id, starter_key) WHERE starter_key IS NOT NULL;
CREATE INDEX report_schedules_owner ON report_schedules (tenant_id, owner_sub);
CREATE INDEX report_schedules_due ON report_schedules (next_run_at) WHERE enabled;

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_schedules;
CREATE POLICY tenant_isolation ON report_schedules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- Report runs gain the emails: 'scheduled' (sent by a schedule) and
-- 'emailed' (Email it now), the schedule that sent one, and what was sent.
ALTER TABLE report_runs DROP CONSTRAINT IF EXISTS report_runs_kind_check;
ALTER TABLE report_runs ADD CONSTRAINT report_runs_kind_check CHECK (kind IN ('run', 'export', 'scheduled', 'emailed'));
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES report_schedules(id) ON DELETE SET NULL;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS delivery jsonb;
CREATE INDEX IF NOT EXISTS report_runs_schedule ON report_runs (schedule_id, created_at DESC) WHERE schedule_id IS NOT NULL;
