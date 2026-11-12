-- 242_pepper_web_search.sql
--
-- Web search in Pepper's chat (12 Nov 2026).
--
--   ai_settings.web_search    the group's switch, off until someone with
--                             Manage on Pepper switches it on (Pepper >
--                             Settings). With it on, staff chats carry
--                             Anthropic's web search tool: Pepper can look
--                             things up on the web, with its sources under
--                             the answer.
--
--   ai_usage.web_searches     searches made in the month, per channel. Each
--                             also counts 2,500 units of the allowance ($10
--                             per 1,000 searches, at $4 per million units).
--
-- A reply's reasoning is only valid with the tool list it was written under,
-- so a tool list that changes mid-chat (the switch above, or a deploy that
-- changes one of Pepper's tools) can get every later message of that chat
-- refused where the API checks it. Two columns record what a chat last ran
-- with, so chat.js can leave the earlier reasoning out from that point
-- instead:
--
--   ai_conversations.tools_key          a digest of the tool list the chat's
--                                       last turn was sent with (NULL = a
--                                       chat from before this migration)
--   ai_conversations.thinking_from_seq  messages before this one are sent
--                                       without their thinking blocks (the
--                                       message at which the tool list last
--                                       changed)

ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS web_search boolean NOT NULL DEFAULT false;

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS web_searches bigint NOT NULL DEFAULT 0;

ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS tools_key text;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS thinking_from_seq int NOT NULL DEFAULT 0;
