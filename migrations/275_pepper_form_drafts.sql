-- Form drafts (Pepper-first step 3d, docs/CHAT_FIRST.md F6): a form's unsaved
-- values, kept on the server so they survive a reload or a switch of device.
-- One per person (user_sub), form, venue and day (the form's day, or its
-- week's Monday; null for a form with no day). The form sheet
-- (admin/src/components/forms/FormSheet.jsx) restores it when the form
-- opens, keeps it as the person types and deletes it when the form is
-- saved. A draft is not the record: the record is only ever saved by the
-- page's own Save, through the page's own route.
--
-- `form` is a key of shared/forms.js that keeps drafts (drafts: true);
-- `form_values` holds the form's fields in the shapes that file declares.
-- Read and written only through /api/form-drafts (routes/formDrafts.js),
-- each person their own. Drafts older than 7 days are deleted when the
-- person's drafts are next read or written (DRAFT_DAYS).

CREATE TABLE IF NOT EXISTS form_drafts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub    text        NOT NULL,
  form        text        NOT NULL CHECK (form ~ '^[a-z_]{1,40}$'),
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  day         date,
  form_values jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(form_values) = 'object'),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, user_sub, form, venue_id, day)
);
CREATE INDEX IF NOT EXISTS form_drafts_age ON form_drafts (tenant_id, user_sub, updated_at);
CREATE INDEX IF NOT EXISTS form_drafts_venue ON form_drafts (venue_id);

ALTER TABLE form_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON form_drafts;
CREATE POLICY tenant_isolation ON form_drafts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
