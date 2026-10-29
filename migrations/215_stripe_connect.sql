-- 215_stripe_connect.sql
--
-- Card payments through the group's own Stripe account, linked to the
-- platform with Stripe Connect (Standard accounts, direct charges: the
-- group is the merchant of record and sees its payments in its own Stripe
-- dashboard; the platform takes its online ordering fee as an application
-- fee). Used by online ordering (the 'stripe' payment gateway) and by
-- Stripe Terminal card machines on tills and kiosks (a card account in
-- connect mode: no key of its own, the platform's key on the group's
-- account). See services/stripeConnect.js.
--
-- tenants.stripe_account_id already exists (001; also typed on the
-- Platform page). What Stripe last said about it:
--   stripe_charges_enabled    the account can take payments
--   stripe_details_submitted  the group finished Stripe's sign-up
--   stripe_account_name       the business name on the account
--   stripe_checked_at         when we last asked (or a webhook told us)
--   stripe_domains            [{ domain, id, ok, error }]: the site's
--                             addresses registered for Apple Pay / Google Pay
--
-- The platform's own keys (secret, publishable, Connect webhook signing
-- secret) can be saved on the Platform page: platform_secrets rows
-- 'stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret'
-- (sealed like the others), else STRIPE_SECRET_KEY /
-- STRIPE_PUBLISHABLE_KEY / STRIPE_CONNECT_WEBHOOK_SECRET in api/.env.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_account_name      text,
  ADD COLUMN IF NOT EXISTS stripe_checked_at        timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_domains           jsonb       NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS tenants_stripe_account ON tenants (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- A Stripe card account can be the group's connected account instead of a
-- key of its own (settings.connect = true, secret NULL).
COMMENT ON COLUMN pos_card_accounts.settings IS
  'merchant_code / merchant_name (SumUp), software_house_id / reseller_id (Dojo), locations (Stripe), connect (Stripe through the group''s connected account, migration 215)';
