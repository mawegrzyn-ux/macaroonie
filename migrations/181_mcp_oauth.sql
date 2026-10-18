-- 181_mcp_oauth.sql
--
-- OAuth sign-in for the staff MCP connector, for AI apps that can't send an
-- Authorization header (Claude's custom connectors, ChatGPT). Macaroonie is
-- its own authorization server (routes/mcpOauth.js): the app registers
-- itself, sends the person to the admin's Connect page to sign in and
-- press Allow, then swaps the code for an ordinary connector access token.
--
--   ai_oauth_clients  apps registered through dynamic client registration
--                     (RFC 7591). Global: an app (claude.ai) is nobody's
--                     tenant's. Public clients only (PKCE, no secret).
--   ai_oauth_grants   one sign-in: made by /oauth/authorize (id in the
--                     Connect page's address), decided on that page (who,
--                     which tenant, read only, how long), swapped once at
--                     /oauth/token (code_hash, used_at). tenant_id is known
--                     from the connector address, else set on Allow.
--   ai_access_tokens.oauth_client_id / oauth_grant_id
--                     a token made by a sign-in, so the app shows on the
--                     Pepper page and a code used twice revokes it.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_oauth_clients (
  id            text        PRIMARY KEY,
  client_name   text        NOT NULL,
  redirect_uris text[]      NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE TABLE IF NOT EXISTS ai_oauth_grants (
  id              text        PRIMARY KEY,
  client_id       text        NOT NULL REFERENCES ai_oauth_clients(id) ON DELETE CASCADE,
  issuer          text        NOT NULL,
  redirect_uri    text        NOT NULL,
  state           text,
  code_challenge  text        NOT NULL,
  scope           text,
  resource        text,
  tenant_id       uuid        REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES users(id) ON DELETE CASCADE,
  read_only       boolean     NOT NULL DEFAULT false,
  expires_in_days int,
  code_hash       text        UNIQUE,
  access_token_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  decided_at      timestamptz,
  denied          boolean     NOT NULL DEFAULT false,
  used_at         timestamptz
);
CREATE INDEX IF NOT EXISTS ai_oauth_grants_expires ON ai_oauth_grants (expires_at);

ALTER TABLE ai_oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_oauth_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_oauth_grants;
CREATE POLICY tenant_isolation ON ai_oauth_grants
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE ai_access_tokens
  ADD COLUMN IF NOT EXISTS oauth_client_id text REFERENCES ai_oauth_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS oauth_grant_id  text;

COMMIT;
