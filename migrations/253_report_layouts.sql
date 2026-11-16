-- 253_report_layouts.sql
--
-- Report builder phase 4c and 4d (docs/REPORTS.md 11, 13, 20): layout
-- templates, Page reports and PDFs.
--
--   report_layouts        how reports look on paper: a group's own templates
--                         (settings, not a canvas: shared/reports/layout.js),
--                         at most one of them the group's default
--   reports.layout_id     the layout a report prints with (null: the group's
--                         default, else the built-in one)
--   report_print_links    + layout   the layout the page is drawn with, as it
--                                    was when the link was made (null: built-in)
--                         + preview  the layout editor's preview (shown in a
--                                    frame of the app, never recorded)
--                         + blocks   a Page report's blocks as resolved for the
--                                    person who pressed Print (null: one report)
--   report_files.format   + pdf
--
-- A Page report is a row of `reports` with subject 'page' and its blocks in
-- `spec` (shared/reports/page.js): no table of its own.

CREATE TABLE report_layouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX report_layouts_name ON report_layouts (tenant_id, lower(name));
CREATE UNIQUE INDEX report_layouts_default ON report_layouts (tenant_id) WHERE is_default;

ALTER TABLE report_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_layouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_layouts;
CREATE POLICY tenant_isolation ON report_layouts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE reports ADD COLUMN layout_id uuid REFERENCES report_layouts(id) ON DELETE SET NULL;

ALTER TABLE report_print_links
  ADD COLUMN layout  jsonb,
  ADD COLUMN preview boolean NOT NULL DEFAULT false,
  ADD COLUMN blocks  jsonb;

ALTER TABLE report_files DROP CONSTRAINT report_files_format_check;
ALTER TABLE report_files ADD CONSTRAINT report_files_format_check CHECK (format IN ('csv', 'xlsx', 'pdf'));
