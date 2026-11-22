-- Pepper's model requests, one row each (Pepper-first step 0b, reports/AI
-- first back office strategy.md "0. Prove and instrument": cost per request
-- by model as a known number). addUsage() (api/src/ai/context.js) adds every
-- model call to the month's totals in ai_usage as before, and now also writes
-- a row here: when, where (channel), what for (use: the chat, the menu search,
-- a reader, the smart builder, local info ...), the model that answered, its
-- tokens of each kind, web searches, the units the allowance counts, the
-- estimated cost in dollars (worked out from the same PRICES as the units)
-- and how long the call took when the caller timed it. No person: who used
-- how much is ai_usage_people, for Manage on Pepper. Kept 90 days
-- (cleanUpAi(), the hourly ai-cleanup job).

CREATE TABLE IF NOT EXISTS ai_requests (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  channel            text          NOT NULL,
  use                text          NOT NULL DEFAULT 'other',
  model              text          NOT NULL,
  input_tokens       integer       NOT NULL DEFAULT 0,
  output_tokens      integer       NOT NULL DEFAULT 0,
  cache_read_tokens  integer       NOT NULL DEFAULT 0,
  cache_write_tokens integer       NOT NULL DEFAULT 0,
  web_searches       integer       NOT NULL DEFAULT 0,
  units              bigint        NOT NULL DEFAULT 0,
  cost_usd           numeric(14,6) NOT NULL DEFAULT 0,
  ms                 integer
);
CREATE INDEX IF NOT EXISTS ai_requests_day ON ai_requests (tenant_id, created_at);

ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_requests;
CREATE POLICY tenant_isolation ON ai_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
