-- 193_card_machines.sql
--
-- Card machines on the till and the kiosks (docs/POS.md 2.5,
-- api/src/services/cardMachines/). The server starts every card payment
-- through the provider's cloud API; a payment reaches a check only as a
-- `payment.added` event naming its attempt (card_payment_id), which the
-- sequencer accepts once, for an approved attempt of the same venue and
-- amount.
--
--   pos_card_accounts   a tenant's account with a provider: Dojo, Stripe
--                       Terminal or SumUp. `secret` is sealed
--                       (services/vault.js), `hint` its last 4 characters.
--                       settings: { merchant_code, merchant_name } (SumUp),
--                       { software_house_id, reseller_id } (Dojo, else the
--                       platform's from env), { locations } (Stripe)
--   pos_card_readers    a card machine at a venue: its provider's id for it
--                       (provider_reader_id), or provider 'test' (no account,
--                       no money). A till or kiosk uses one:
--                       pos_devices.settings.card_reader = its id
--   pos_card_payments   every attempt: kind 'sale' (from a till or kiosk) or
--                       'refund' (back to the card, of a sale: sale_id);
--                       status pending | signature | approved | declined |
--                       cancelled | failed; provider_ref / provider_ref2 the
--                       provider's ids (payment intent, session, checkout,
--                       transaction); used_event_id the event that put it on
--                       a check (or took it off: a refund's)
--
-- Tender 'card_integrated' ("Card machine") joins the till's tenders; Cash
-- Recon's takings mapping gets it wherever 'card_external' was mapped, so a
-- venue's card channel keeps adding up.

CREATE TABLE IF NOT EXISTS pos_card_accounts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    text        NOT NULL CHECK (provider IN ('dojo', 'stripe', 'sumup')),
  name        text        NOT NULL,
  secret      text,
  hint        text,
  mode        text        CHECK (mode IN ('test', 'live')),
  settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  checked_at  timestamptz,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz   -- removed: key gone, machines removed; past payments keep pointing at it
);
CREATE INDEX IF NOT EXISTS pos_card_accounts_tenant ON pos_card_accounts (tenant_id);

CREATE TABLE IF NOT EXISTS pos_card_readers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id            uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  account_id          uuid        REFERENCES pos_card_accounts(id) ON DELETE CASCADE,
  provider            text        NOT NULL CHECK (provider IN ('dojo', 'stripe', 'sumup', 'test')),
  provider_reader_id  text,
  name                text        NOT NULL,
  model               text,
  serial              text,
  online              boolean,
  status_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  removed_at          timestamptz,
  CHECK ((provider = 'test') = (account_id IS NULL)),
  CHECK (provider = 'test' OR provider_reader_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_card_readers_ref
  ON pos_card_readers (account_id, provider_reader_id) WHERE removed_at IS NULL AND account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_card_readers_venue ON pos_card_readers (venue_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS pos_card_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  reader_id       uuid        NOT NULL REFERENCES pos_card_readers(id) ON DELETE RESTRICT,
  account_id      uuid        REFERENCES pos_card_accounts(id) ON DELETE SET NULL,
  provider        text        NOT NULL,
  kind            text        NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale', 'refund')),
  sale_id         uuid        REFERENCES pos_card_payments(id) ON DELETE RESTRICT,
  device_id       uuid        REFERENCES pos_devices(id) ON DELETE SET NULL,
  staff_id        uuid,
  check_id        text,
  payment_id      text,       -- the ULID of the payment (or refund) the event will carry
  reference       text,
  amount          integer     NOT NULL CHECK (amount > 0),
  tip             integer     NOT NULL DEFAULT 0 CHECK (tip >= 0),
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'signature', 'approved', 'declined', 'cancelled', 'failed')),
  message         text,
  provider_ref    text,
  provider_ref2   text,
  card_brand      text,
  card_last4      text,
  refunded        integer     NOT NULL DEFAULT 0,
  used_event_id   text,
  used_at         timestamptz,
  checked_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'sale' OR sale_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS pos_card_payments_venue ON pos_card_payments (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_card_payments_check ON pos_card_payments (check_id) WHERE check_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_card_payments_open ON pos_card_payments (reader_id) WHERE status IN ('pending', 'signature');
CREATE UNIQUE INDEX IF NOT EXISTS pos_card_payments_payment ON pos_card_payments (venue_id, payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE pos_card_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_card_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_card_accounts;
CREATE POLICY tenant_isolation ON pos_card_accounts USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE pos_card_readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_card_readers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_card_readers;
CREATE POLICY tenant_isolation ON pos_card_readers USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE pos_card_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_card_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_card_payments;
CREATE POLICY tenant_isolation ON pos_card_payments USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');

-- Cash Recon: the card channel that took card_external takes card_integrated too.
UPDATE pos_settings s
   SET recon_map = jsonb_set(s.recon_map, '{takings}', (
         SELECT COALESCE(jsonb_object_agg(k, CASE WHEN v ? 'card_external' AND NOT v ? 'card_integrated' THEN v || '["card_integrated"]'::jsonb ELSE v END), '{}'::jsonb)
           FROM jsonb_each(s.recon_map->'takings') AS e(k, v)))
 WHERE jsonb_typeof(s.recon_map->'takings') = 'object';

-- Kiosks that used the on-screen test reader get a test card machine at
-- their venue instead (the on-screen reader is now for previews only).
INSERT INTO pos_card_readers (tenant_id, venue_id, provider, name)
SELECT DISTINCT d.tenant_id, d.venue_id, 'test', 'Test card machine'
  FROM pos_devices d
 WHERE d.kind = 'kiosk' AND d.settings->>'card_reader' = 'test'
   AND NOT EXISTS (SELECT 1 FROM pos_card_readers r WHERE r.venue_id = d.venue_id AND r.provider = 'test' AND r.removed_at IS NULL);
UPDATE pos_devices d
   SET settings = jsonb_set(d.settings, '{card_reader}', to_jsonb((
         SELECT r.id::text FROM pos_card_readers r
          WHERE r.venue_id = d.venue_id AND r.provider = 'test' AND r.removed_at IS NULL
          ORDER BY r.created_at LIMIT 1)))
 WHERE d.kind = 'kiosk' AND d.settings->>'card_reader' = 'test';
