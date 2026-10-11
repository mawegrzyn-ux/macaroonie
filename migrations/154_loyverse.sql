-- 154_loyverse.sql
--
-- Loyverse POS link for Cash Reconciliation: fill a day's income, takings
-- and service charge rows from the venue's Loyverse sales.
--
--   loyverse_connections  a tenant's Loyverse account: an access token
--                         (Loyverse back office, Integrations > Access
--                         tokens). Stored as typed, never returned by the
--                         API; token_hint is its last 4 characters. A
--                         tenant may have several (one Loyverse account per
--                         restaurant, or one account for all of them).
--   loyverse_venue_links  one per venue: which connection and which Loyverse
--                         store it reads, when its trading day starts (a
--                         venue open past midnight counts sales up to e.g.
--                         04:00 on the day before), and the field mapping.
--
-- Mapping (loyverse_venue_links.mappings):
--   { "income":  { "<cash_income_sources.id>":   [term, ...] },
--     "takings": { "<cash_payment_channels.id>": [term, ...] },
--     "sc":      { "<cash_sc_sources.id>":       [term, ...] } }
--   term = { "sign": 1 | -1, "kind": "<figure>", "ref": "<Loyverse id>", "label": "<name>" }
--   kinds: gross_sales, net_sales, refunds, discounts, taxes, tips,
--          surcharges, total_collected (no ref); item, category,
--          payment_type (ref = Loyverse id). A field's value is the sum of
--   its terms; a field with no terms is never written.
--
-- Filled days record who filled them and when:
--   cash_daily_reports.loyverse_filled_at / loyverse_filled_by.

BEGIN;

CREATE TABLE loyverse_connections (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  access_token     text        NOT NULL,
  token_hint       text        NOT NULL,
  merchant_id      text,
  business_name    text,
  currency         text,
  last_checked_at  timestamptz,
  last_error       text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyverse_connections_tenant ON loyverse_connections (tenant_id);

CREATE TABLE loyverse_venue_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL UNIQUE REFERENCES venues(id) ON DELETE CASCADE,
  connection_id   uuid        NOT NULL REFERENCES loyverse_connections(id) ON DELETE CASCADE,
  store_id        text        NOT NULL,
  store_name      text,
  day_starts_at   text        NOT NULL DEFAULT '00:00' CHECK (day_starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  mappings        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyverse_venue_links_tenant ON loyverse_venue_links (tenant_id);

ALTER TABLE cash_daily_reports
  ADD COLUMN loyverse_filled_at timestamptz,
  ADD COLUMN loyverse_filled_by text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loyverse_connections', 'loyverse_venue_links']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

COMMIT;
