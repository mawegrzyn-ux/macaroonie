-- Pepper-first step 8B2: rules made from a sentence ("when a fridge reads
-- above 8, add an H&S action for the manager"). A rule is a trigger the app
-- already has, conditions on its event, and one of Pepper's reversible change
-- tools with its input as a template (shared/rules.js). Pepper reads the
-- sentence (askForJson), the person confirms the card, and only then is it
-- saved. It runs as a system action, as the person who confirmed it, at most
-- per_day times a day, each run recorded in the audit with the rule named.

CREATE TABLE pepper_rules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  sentence      text        CHECK (sentence IS NULL OR length(sentence) <= 500),
  trigger       text        NOT NULL CHECK (trigger IN ('fridge_reading', 'supplier_order', 'task_late', 'review_low')),
  conditions    jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  venue_id      uuid        REFERENCES venues(id) ON DELETE CASCADE,
  action_tool   text        NOT NULL,
  action_input  jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(action_input) = 'object'),
  per_day       integer     NOT NULL DEFAULT 5 CHECK (per_day BETWEEN 1 AND 20),
  enabled       boolean     NOT NULL DEFAULT true,
  -- Whose permissions it runs with: the person who confirmed it.
  created_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_by_sub text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pepper_rules_trigger ON pepper_rules (tenant_id, trigger) WHERE enabled;

ALTER TABLE pepper_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pepper_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY pepper_rules_tenant ON pepper_rules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- Each time a rule met an event: claimed once per rule and event (two
-- processes never both run it), and counted per day for the cap.
CREATE TABLE pepper_rule_firings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id    uuid        NOT NULL REFERENCES pepper_rules(id) ON DELETE CASCADE,
  event_key  text        NOT NULL CHECK (length(event_key) <= 200),
  day        date        NOT NULL,
  status     text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'capped')),
  result     jsonb,
  fired_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, event_key)
);
CREATE INDEX pepper_rule_firings_day ON pepper_rule_firings (tenant_id, rule_id, day);

ALTER TABLE pepper_rule_firings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pepper_rule_firings FORCE ROW LEVEL SECURITY;
CREATE POLICY pepper_rule_firings_tenant ON pepper_rule_firings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- The audit names the rule a change came from (Done by Pepper).
ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES pepper_rules(id) ON DELETE SET NULL;
