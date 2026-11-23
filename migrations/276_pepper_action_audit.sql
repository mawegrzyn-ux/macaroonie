-- Pepper's changes, recorded per card (Pepper-first step 4, reports/AI first
-- back office strategy.md "For review"; docs/PEPPER_FIRST.md 13).
--
-- ai_actions (the audit, migration 148) gains:
--   action_id   the Confirm card (ai_pending_actions.id) the change ran from:
--               the card is the idempotency key, so a card confirmed twice (a
--               double tap, a retried request, a second tab) runs once and
--               its rows carry one action_id. Null for a connector call (MCP)
--   user_sub    who made the change (the person's Auth0 sub), beside `actor`
--               (their email): the Done by Pepper log lists a person's own
--   venue_id    the venue the change was at, when the tool worked on one
--   undo_of     on an Undo's own row: the card whose change it undid
-- No foreign keys: the audit outlives chats (deleted with their cards after
-- the retention period) and venues.
--
-- ai_pending_actions gains:
--   undone_at   when the card's change was undone (Undo, step 4d); while an
--               Undo is running it is set, and cleared again if the Undo fails
--   undo_error  why the last Undo didn't go through
--
-- Nothing is backfilled: older rows have no card, person or venue, and show
-- by their actor and time.

ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS action_id uuid;
ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS user_sub  text;
ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS venue_id  uuid;
ALTER TABLE ai_actions ADD COLUMN IF NOT EXISTS undo_of   uuid;

CREATE INDEX IF NOT EXISTS idx_ai_actions_person ON ai_actions (tenant_id, user_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_actions_card   ON ai_actions (tenant_id, action_id);

ALTER TABLE ai_pending_actions ADD COLUMN IF NOT EXISTS undone_at  timestamptz;
ALTER TABLE ai_pending_actions ADD COLUMN IF NOT EXISTS undo_error text;
