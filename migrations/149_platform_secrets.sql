-- 149_platform_secrets.sql
--
-- Keys the platform itself holds, set by a platform admin in the admin
-- portal instead of in the server's .env file. First user: the Anthropic API
-- key for the AI chats (name 'anthropic_api_key', Platform page > AI usage).
-- A saved key wins over the environment variable; removing it falls back to
-- the environment variable.
--
--   value       the secret itself. Never sent to the browser.
--   hint        its last four characters, shown so people can tell keys apart.
--   updated_by  email of the platform admin who saved it.
--
-- Global like platform_admins: read before or outside any tenant context,
-- so no RLS. Only platform-admin routes and the AI chat code read it.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_secrets (
  name        text        PRIMARY KEY,
  value       text        NOT NULL,
  hint        text        NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
