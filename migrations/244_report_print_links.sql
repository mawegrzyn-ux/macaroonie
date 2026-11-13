-- 244_report_print_links.sql
--
-- The report builder's print page (docs/REPORTS.md 13). A new browser tab
-- can't send the admin's login, so Print asks for a link that lasts a few
-- minutes and opens that: the same way a draft menu's print preview works
-- (menu_preview_links, migration 165).
--
-- A link holds what is being printed, as it stood when Print was pressed:
-- the report's definition, the choices made for the visit (period, venues,
-- anything asked each time), the rows opened up (drill steps), who asked
-- and what their role could see then. The page runs the report as that
-- person, so it shows what their screen showed and nothing more.
--
-- The id is the key in the address (a random uuid). Links are deleted a day
-- after they run out: as new ones are made, and by the hourly clean-up.

CREATE TABLE report_print_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- A saved report's id, or 'starter:<key>'.
  report_ref text NOT NULL,
  name text NOT NULL,
  description text,
  spec jsonb NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  drill jsonb NOT NULL DEFAULT '[]',
  -- The words for the trail of rows opened up, for the page's heading.
  trail jsonb NOT NULL DEFAULT '[]',
  -- Whether the table prints under a chart: as the screen had it when Print
  -- was pressed (null: as the report says).
  show_table boolean,
  -- The series switched off in the chart's legend when Print was pressed.
  hidden jsonb NOT NULL DEFAULT '[]',
  user_sub text NOT NULL,
  user_email text,
  levels jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_print_links_tenant ON report_print_links (tenant_id, expires_at);

ALTER TABLE report_print_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_print_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_print_links;
CREATE POLICY tenant_isolation ON report_print_links
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
