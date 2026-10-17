-- 179_sealed_keys_and_tokens.sql
--
-- Stored integration keys are sealed (AES-256-GCM, services/vault.js) and
-- connector access tokens get an expiry and a read-only option.
--
--   venue_email_settings.provider_secret
--       the SES secret access key, which was kept in provider_domain (a
--       column that holds plain settings for the other providers: Mailgun's
--       domain, Postmark's stream). Moved here so it can be sealed.
--   ai_access_tokens.expires_at
--       a token stops working after this (made for 30, 90, 180 or 365
--       days; tokens made before this migration get 90 days from now)
--   ai_access_tokens.read_only
--       the connector offers and runs only the tools that read
--
-- The keys themselves are sealed by the API when it starts
-- (sealStoredSecrets()): the master key lives in the environment, not in
-- the database, so SQL can't do it.

BEGIN;

ALTER TABLE venue_email_settings ADD COLUMN IF NOT EXISTS provider_secret text;
UPDATE venue_email_settings
   SET provider_secret = provider_domain, provider_domain = NULL
 WHERE email_provider = 'ses' AND provider_domain IS NOT NULL AND provider_secret IS NULL;

ALTER TABLE ai_access_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_only  boolean NOT NULL DEFAULT false;
UPDATE ai_access_tokens SET expires_at = now() + interval '90 days' WHERE expires_at IS NULL;
ALTER TABLE ai_access_tokens ALTER COLUMN expires_at SET NOT NULL;

COMMIT;
