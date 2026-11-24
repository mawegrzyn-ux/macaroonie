-- The Team signal (Pepper-first step 7b, docs/PEPPER_FIRST.md 4.4,
-- docs/claude/outstanding/shell.md 52): someone with Manage on Navigation
-- suggests a page (with its venue and tab, where the page's address takes
-- them) to a role, with an optional note. It shows on Home among the
-- suggestions of everyone in that role, "Suggested by <name or role>:
-- <note>", until they pin the page or dismiss it (a dismissal is for good:
-- home_suggestion_hides with key 'team:<id>', migration 282).
--
-- The launcher's tiles (nav_items.show_in_launcher) were dropped with
-- migration 274, not renamed: this is the table the plan's suggest_to_team
-- became. Read and written only through /api/suggestions/team
-- (routes/suggestions.js); shown through GET /api/ops/today
-- (services/suggestions.js teamRule()).

CREATE TABLE IF NOT EXISTS team_suggestions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id    uuid        NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  path       text        NOT NULL CHECK (path ~ '^/[a-z0-9/-]*$' AND char_length(path) <= 100),
  venue_id   uuid        REFERENCES venues(id) ON DELETE SET NULL,
  tab        text        CHECK (tab IS NULL OR tab ~ '^[a-z0-9_-]{1,40}$'),
  note       text        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 140),
  by_sub     text,
  by_label   text        NOT NULL CHECK (char_length(by_label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_suggestions_once
  ON team_suggestions (role_id, path, COALESCE(venue_id::text, ''), COALESCE(tab, ''));
CREATE INDEX IF NOT EXISTS team_suggestions_tenant ON team_suggestions (tenant_id, role_id);
CREATE INDEX IF NOT EXISTS team_suggestions_venue ON team_suggestions (venue_id) WHERE venue_id IS NOT NULL;

ALTER TABLE team_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_suggestions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON team_suggestions;
CREATE POLICY tenant_isolation ON team_suggestions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
