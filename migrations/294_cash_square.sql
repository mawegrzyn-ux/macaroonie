-- 294_cash_square.sql
--
-- Sales from other tills, phase 5 (docs/SALES_IMPORT.md 5, backlog 47):
-- Square through the same pipeline as Loyverse. pos_connections gains what a
-- Square account needs:
--
--   environment            'production' or 'sandbox' (Square's two API hosts);
--                          null for systems that have one
--   auth_kind              'token' (an access token pasted on the page) or
--                          'oauth' (Sign in with Square)
--   refresh_token          the OAuth refresh token, sealed (vault.js SEALED)
--   token_expires_at       when the OAuth access token runs out; the sync
--                          refreshes it a week before
--   webhook_signature_key  Square's key for signing webhook calls, sealed:
--                          given when we register the subscription, or pasted
--                          from Square's dashboard; with it the webhook
--                          checks x-square-hmacsha256-signature
--   webhook_signature_hint its last 4 characters, for display

ALTER TABLE pos_connections
  ADD COLUMN environment             text CHECK (environment IN ('production', 'sandbox')),
  ADD COLUMN auth_kind               text NOT NULL DEFAULT 'token' CHECK (auth_kind IN ('token', 'oauth')),
  ADD COLUMN refresh_token           text,
  ADD COLUMN token_expires_at        timestamptz,
  ADD COLUMN webhook_signature_key   text,
  ADD COLUMN webhook_signature_hint  text;

-- One Square merchant per tenant connection (signing in again updates it).
CREATE UNIQUE INDEX pos_connections_merchant ON pos_connections (tenant_id, system, merchant_id)
  WHERE system = 'square' AND merchant_id IS NOT NULL;
