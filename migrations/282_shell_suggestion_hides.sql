-- Suggestions on Home (Pepper-first step 7a, reports/AI first back office
-- strategy.md "Home: the day comes to the person", docs/PEPPER_FIRST.md 4.4):
-- after the pins, up to four pages worked out by rules from data the person
-- may see (api/src/services/suggestions.js), each with a reason. Nothing
-- about them is stored but what a person dismissed: this table.
--
-- One row per person and suggestion key (a page, a report, a set-up gap or a
-- manager's team suggestion). hidden_until: the suggestion stays off that
-- person's Home until then (HIDE_DAYS, 14); null = for good (a manager's
-- suggestion, once dismissed, never comes back). Rows past their time are
-- cleared by the hourly clean-up.
--
-- Decision 8 of the strategy: a person's own. Nothing reads it for anyone
-- else, and no report subject covers it.

CREATE TABLE IF NOT EXISTS home_suggestion_hides (
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_sub     text        NOT NULL,
  key          text        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
  hidden_until timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_sub, key)
);
CREATE INDEX IF NOT EXISTS home_suggestion_hides_until ON home_suggestion_hides (hidden_until) WHERE hidden_until IS NOT NULL;

ALTER TABLE home_suggestion_hides ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_suggestion_hides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON home_suggestion_hides;
CREATE POLICY tenant_isolation ON home_suggestion_hides
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
