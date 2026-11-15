-- 250_report_files.sql
--
-- Report files kept for the person who made them (docs/REPORTS.md 14):
-- Keep a file on a report's page, Pepper's export_report, and later the
-- files schedules make. The file itself is in the private store
-- (services/privateStore.js: PRIVATE_DIR, which nginx never serves) at
-- storage_key; this row says whose it is, until when, and which run made it.
--
-- A file points at the run that made it (report_runs): Past runs lists the
-- two together, and a file goes with its run's record. A file holding
-- people's details (a column the catalogue marks as personal) is kept 7
-- days, any other 30 (src/reports/files.js). When a file goes, its row stays
-- as a record (removed_at), with the definition and the access it was made
-- with cleared: a definition can hold words typed into a filter.

CREATE TABLE report_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  content_type text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  bytes bigint NOT NULL DEFAULT 0,
  row_count integer,
  truncated boolean NOT NULL DEFAULT false,
  personal boolean NOT NULL DEFAULT false,
  user_sub text NOT NULL,
  user_email text,
  -- The definition the file was made from (with the rows opened up) and
  -- what the maker's role could see then: a download checks their role
  -- still sees the same report. Both cleared when the file goes.
  spec jsonb,
  levels jsonb,
  downloads integer NOT NULL DEFAULT 0,
  last_downloaded_at timestamptz,
  expires_at timestamptz NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_files_run ON report_files (run_id);
CREATE INDEX report_files_tenant ON report_files (tenant_id, created_at DESC);
CREATE INDEX report_files_due ON report_files (expires_at) WHERE removed_at IS NULL;

ALTER TABLE report_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_files;
CREATE POLICY tenant_isolation ON report_files
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- Past runs lists a person's own runs, and a starter report's runs.
CREATE INDEX IF NOT EXISTS report_runs_person ON report_runs (tenant_id, user_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS report_runs_starter ON report_runs (tenant_id, starter_key, created_at DESC) WHERE starter_key IS NOT NULL;
