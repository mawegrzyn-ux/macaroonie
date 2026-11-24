-- Capture to For review (Pepper-first step 6b; reports/AI first back office
-- strategy.md "The phone": a photographed invoice or delivery note goes to
-- For review). A photo, a voice note's words or a typed line, kept as it was
-- given with who, when and the venue. No model call when it is made: it
-- waits on For review's Waiting tab until someone opens it in Pepper (a new
-- chat with it attached) or dismisses it.
--
--   ai_captures   one row per capture. A photo is an ai_attachments row (the
--                 chat's own upload path and limits, ai/attachments.js),
--                 kept while the capture is, not cleared after a day like an
--                 unsent chat file. user_sub is the signed-in account,
--                 person_name who made it (on a shared device, the person
--                 switched in). Opened or dismissed: who and when.
--
-- Read and written only through /api/ai/captures and GET /api/ai/review.

CREATE TABLE IF NOT EXISTS ai_captures (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id          uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('photo', 'voice', 'text')),
  note              text        CHECK (note IS NULL OR length(note) <= 2000),
  attachment_id     uuid        REFERENCES ai_attachments(id) ON DELETE CASCADE,
  user_sub          text        NOT NULL,
  person_name       text,
  shared_device_id  uuid        REFERENCES shared_devices(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'opened', 'dismissed')),
  handled_at        timestamptz,
  handled_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'photo') = (attachment_id IS NOT NULL)),
  CHECK (kind = 'photo' OR length(btrim(coalesce(note, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS ai_captures_waiting ON ai_captures (tenant_id, created_at DESC) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS ai_captures_venue ON ai_captures (tenant_id, venue_id);

ALTER TABLE ai_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_captures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_captures;
CREATE POLICY tenant_isolation ON ai_captures
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
