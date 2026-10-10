-- 150_ai_attachments.sql
--
-- Files a staff member attaches in the AI assistant chat: photos and
-- screenshots (JPEG, PNG, GIF, WebP), PDFs and plain-text files (txt, csv,
-- md). Uploaded first (POST /api/ai/attachments), then sent with a message,
-- which links the file to its conversation.
--
-- The bytes live here, not in ai_messages: a stored message only holds a
-- reference ({ _attachment: { id, ... } } on an image / document block), and
-- the chat fills in the file's data each time it sends the conversation to
-- the model, so every request carries the same bytes and the history stays
-- small. Files go with their conversation (ON DELETE CASCADE); uploads never
-- sent are removed after a day by the next upload.
--
--   conversation_id  NULL until the message is sent
--   user_sub         who uploaded it; only they can see or send it
--   kind             image | pdf | text
--   media_type       image/jpeg|png|gif|webp, application/pdf, text/plain

BEGIN;

CREATE TABLE IF NOT EXISTS ai_attachments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid        REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_sub         text        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('image', 'pdf', 'text')),
  media_type       text        NOT NULL,
  filename         text        NOT NULL,
  bytes            int         NOT NULL,
  data             bytea       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_attachments_conversation ON ai_attachments (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_attachments_unsent
  ON ai_attachments (tenant_id, user_sub, created_at) WHERE conversation_id IS NULL;

ALTER TABLE ai_attachments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_attachments' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON ai_attachments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

COMMIT;
