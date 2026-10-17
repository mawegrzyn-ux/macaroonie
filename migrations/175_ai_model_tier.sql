-- 175_ai_model_tier.sql
--
-- Pepper, from the review's "Next" list (model routing):
--
--   ai_conversations.model_tier   which model the chat runs on: 'fast' (the
--                                 everyday model, AI_MODEL_FAST) or 'main'
--                                 (AI_MODEL). New chats start on 'fast' and
--                                 move to 'main' for good when they need it
--                                 (a file, a big job, a long chat, a refusal):
--                                 chat.js upgradeChat(). NULL = 'main' (the
--                                 chats from before routing, which ran there).
--
-- A chat only ever moves up: the main model reads the everyday model's
-- earlier reasoning, the other way round it would be dropped.

BEGIN;

ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS model_tier text
  CHECK (model_tier IN ('fast', 'main'));

COMMIT;
