-- 288_cash_pos_connections.sql
--
-- Sales from other tills, phase 1 (docs/SALES_IMPORT.md, backlog 47): the
-- Loyverse tables of migration 154 become general connections to another
-- till system, renamed in place (pre-production, no compatibility path).
--
--   pos_connections        (was loyverse_connections) one account on another
--                          till system: `system` ('loyverse' now; 'square',
--                          'simphony' later), the sealed access token
--                          (vault.js SEALED), its status and the last sync:
--                          when it ran, when it last worked, its error, what
--                          it stored. sync_requested_at is set by Sync now
--                          and the webhook; sync_claimed_until is held by the
--                          process running the sync (one at a time across PM2
--                          processes). sales_synced_to is the catch-up's high
--                          water mark (receipts updated up to then are in),
--                          catalog_synced_to the same for master data.
--                          webhook_token_hash is the sha256 of the random
--                          token in the webhook address (the address itself is
--                          shown once); webhook_id is Loyverse's id for it when
--                          we registered it there.
--   pos_connection_venues  (was loyverse_venue_links) one per venue: which
--                          connection and which external location (a Loyverse
--                          store), when its trading day starts, the Cash Recon
--                          mapping, and its history import (13 months back on
--                          linking: history_from .. history_to, walked forward
--                          from history_next_from, page cursor history_cursor,
--                          finished at history_done_at).

ALTER TABLE loyverse_connections RENAME TO pos_connections;
ALTER INDEX loyverse_connections_pkey   RENAME TO pos_connections_pkey;
ALTER INDEX loyverse_connections_tenant RENAME TO pos_connections_tenant;
ALTER TABLE pos_connections RENAME CONSTRAINT loyverse_connections_tenant_id_fkey TO pos_connections_tenant_id_fkey;

ALTER TABLE pos_connections
  ADD COLUMN system              text        NOT NULL DEFAULT 'loyverse' CHECK (system IN ('loyverse', 'square', 'simphony')),
  ADD COLUMN status              text        NOT NULL DEFAULT 'active'   CHECK (status IN ('active', 'paused', 'error')),
  ADD COLUMN last_sync_at        timestamptz,
  ADD COLUMN last_sync_ok_at     timestamptz,
  ADD COLUMN last_sync_error     text,
  ADD COLUMN last_sync_counts    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN sync_requested_at   timestamptz,
  ADD COLUMN sync_claimed_until  timestamptz,
  ADD COLUMN sales_synced_to     timestamptz,
  ADD COLUMN catalog_synced_to   timestamptz,
  ADD COLUMN webhook_token_hash  text        UNIQUE,
  ADD COLUMN webhook_token_hint  text,
  ADD COLUMN webhook_id          text,
  ADD COLUMN webhook_last_at     timestamptz;

ALTER TABLE loyverse_venue_links RENAME TO pos_connection_venues;
ALTER INDEX loyverse_venue_links_pkey         RENAME TO pos_connection_venues_pkey;
ALTER INDEX loyverse_venue_links_tenant       RENAME TO pos_connection_venues_tenant;
ALTER INDEX loyverse_venue_links_venue_id_key RENAME TO pos_connection_venues_venue_id_key;
ALTER TABLE pos_connection_venues RENAME CONSTRAINT loyverse_venue_links_day_starts_at_check TO pos_connection_venues_day_starts_at_check;
ALTER TABLE pos_connection_venues RENAME CONSTRAINT loyverse_venue_links_connection_id_fkey  TO pos_connection_venues_connection_id_fkey;
ALTER TABLE pos_connection_venues RENAME CONSTRAINT loyverse_venue_links_tenant_id_fkey      TO pos_connection_venues_tenant_id_fkey;
ALTER TABLE pos_connection_venues RENAME CONSTRAINT loyverse_venue_links_venue_id_fkey       TO pos_connection_venues_venue_id_fkey;
ALTER TABLE pos_connection_venues RENAME COLUMN store_id   TO location_id;
ALTER TABLE pos_connection_venues RENAME COLUMN store_name TO location_name;

ALTER TABLE pos_connection_venues
  ADD COLUMN history_from       timestamptz,
  ADD COLUMN history_to         timestamptz,
  ADD COLUMN history_next_from  timestamptz,
  ADD COLUMN history_cursor     text,
  ADD COLUMN history_count      integer     NOT NULL DEFAULT 0,
  ADD COLUMN history_done_at    timestamptz;
CREATE UNIQUE INDEX pos_connection_venues_location ON pos_connection_venues (connection_id, location_id);

-- The standard policy, forced (rule 3), whatever the tables carried before.
DO $$
DECLARE t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_connections', 'pos_connection_venues']
  LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON %I', p, t);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY %I ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.bypass_rls', true) = 'on')$f$, t || '_tenant', t);
  END LOOP;
END $$;
