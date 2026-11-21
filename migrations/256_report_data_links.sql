-- 256_report_data_links.sql
--
-- Report builder phase 5 (docs/REPORTS.md 15): data links and push.
--
--   report_data_links   an address that returns a saved or starter report's
--                       current figures as JSON or CSV, for Google Sheets,
--                       Power BI, Looker Studio or an accountant's tools.
--                       Made by an owner or admin; runs as them, checked at
--                       every call (it stops when they leave or lose
--                       access). Its secret key is shown once: only its
--                       sha256 is kept. Fixed choices (params), the ones the
--                       caller may set (open_params), an end date, calls an
--                       hour (a window counted on the row), and people's
--                       details left out unless an owner turns them on.
--   report_runs         + kind 'link', + link_id: every call is a run
--   report_schedules    + push_url, push_secret (sealed): a schedule can
--                       also post its result to a web address, signed with
--                       the secret, so the receiver can check it came from us

CREATE TABLE report_data_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id uuid REFERENCES reports(id) ON DELETE CASCADE,
  starter_key text,
  CONSTRAINT report_data_links_one_report CHECK ((report_id IS NULL) <> (starter_key IS NULL)),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  key_hash text NOT NULL,
  key_hint text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_params text[] NOT NULL DEFAULT '{}',
  personal boolean NOT NULL DEFAULT false,
  rate_per_hour int NOT NULL DEFAULT 60 CHECK (rate_per_hour BETWEEN 1 AND 3600),
  expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  owner_sub text NOT NULL,
  owner_email text,
  uses int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  window_start timestamptz,
  window_uses int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_data_links_report ON report_data_links (tenant_id, report_id);
ALTER TABLE report_data_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_data_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_data_links;
CREATE POLICY tenant_isolation ON report_data_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE report_runs DROP CONSTRAINT IF EXISTS report_runs_kind_check;
ALTER TABLE report_runs ADD CONSTRAINT report_runs_kind_check CHECK (kind IN ('run', 'export', 'scheduled', 'emailed', 'link'));
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS link_id uuid REFERENCES report_data_links(id) ON DELETE SET NULL;

ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS push_url text;
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS push_secret text;
