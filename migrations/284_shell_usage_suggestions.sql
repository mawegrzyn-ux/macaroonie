-- Measuring Home's suggestions (Pepper-first step 7d): the usage record
-- (migration 270) gains the kind 'suggestion', one row each time a person's
-- Home showed one, they opened it, pinned it or dismissed it, with the rule
-- that found it (services/suggestions.js RULES) and the page it was for.
-- Written from the admin's batches like the rest (admin/src/lib/usage.js,
-- services/usageRecord.js usageRow()).
--
-- Decision 8: still the person's own record (usage.mine); the group sees
-- tap-through by rule with no person (the report subject usage.suggestions).

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS rule text CHECK (rule IS NULL OR rule ~ '^[a-z_]{1,30}$');
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS act text CHECK (act IS NULL OR act IN ('shown', 'opened', 'pinned', 'dismissed'));

ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_kind_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_kind_check CHECK (kind IN ('page', 'search', 'suggestion'));
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_suggestion_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_suggestion_check
  CHECK ((kind = 'suggestion') = (act IS NOT NULL AND rule IS NOT NULL));

CREATE INDEX IF NOT EXISTS usage_events_suggestions ON usage_events (tenant_id, at) WHERE kind = 'suggestion';
