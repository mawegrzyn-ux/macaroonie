-- 174_ai_lock_usage_retention.sql
--
-- Pepper, from the review's "Now" list:
--
--   ai_conversations.running_until   one writer per chat across every API
--                                     process (chat.js holdConversation()):
--                                     a turn, a Confirm or a Cancel holds it
--   ai_conversations.closed_at /     a chat a guest's details were erased
--     closed_reason                  from (ai/erase.js): kept to read, no
--                                     new messages (its history was edited)
--   ai_usage.units                   usage in tokens weighted by price
--                                     (context.js usageUnits()); the monthly
--                                     allowance counts units, not raw tokens
--   ai_usage_people                  each person's units per day: the
--                                     Settings tab's per-person view and
--                                     the daily share
--   ai_settings.person_daily_pct     a person's daily share of the monthly
--                                     allowance, % (null = no cap)
--   ai_settings.chat_retention_days  chats idle this long are deleted by the
--                                     hourly AI clean-up (jobs/queues.js)
--   ai_actions.redacted_at           the audit's input and result cleared
--                                     (after a year, or on erasure)

BEGIN;

ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS running_until timestamptz;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS closed_at     timestamptz;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS closed_reason text;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_idle ON ai_conversations (tenant_id, updated_at);

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS units bigint NOT NULL DEFAULT 0;
-- This month so far, with the default weights (no record of which model answered).
UPDATE ai_usage
   SET units = input_tokens + output_tokens * 5 + round(cache_write_tokens * 1.25) + round(cache_read_tokens * 0.1)
 WHERE units = 0;

CREATE TABLE IF NOT EXISTS ai_usage_people (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day         date        NOT NULL,
  user_sub    text        NOT NULL,
  user_email  text,
  requests    int         NOT NULL DEFAULT 0,
  units       bigint      NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, user_sub)
);
ALTER TABLE ai_usage_people ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_usage_people' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON ai_usage_people USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS person_daily_pct int DEFAULT 25
  CHECK (person_daily_pct IS NULL OR person_daily_pct BETWEEN 1 AND 100);
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS chat_retention_days int NOT NULL DEFAULT 90
  CHECK (chat_retention_days IN (30, 90, 180, 365));

ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS redacted_at timestamptz;

COMMIT;
