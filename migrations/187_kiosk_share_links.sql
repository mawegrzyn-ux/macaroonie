-- 187_kiosk_share_links.sql
--
-- A lasting preview link per kiosk design, for people outside the group
-- (a brand team, a franchise partner, a designer) to try the kiosk without
-- signing in. Till setup's own preview links run out after 12 hours; this
-- one works until someone stops sharing it, makes a new link (the old one
-- stops), or its end date passes. Like every preview it never places an
-- order or takes a payment.
--
--   share_token        the link's key (random, unique); NULL = not shared
--   share_venue_id     whose menu and prices the preview shows
--   share_stream_id    the revenue stream it orders as (its menus and
--                      order types), NULL = the venue's first
--   share_expires_at   end of the link, NULL = no end
--   share_views        how many times the preview was opened

BEGIN;

ALTER TABLE kiosk_designs
  ADD COLUMN IF NOT EXISTS share_token          text,
  ADD COLUMN IF NOT EXISTS share_venue_id       uuid REFERENCES venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS share_stream_id      uuid REFERENCES pos_revenue_streams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS share_expires_at     timestamptz,
  ADD COLUMN IF NOT EXISTS share_created_at     timestamptz,
  ADD COLUMN IF NOT EXISTS share_created_by     text,
  ADD COLUMN IF NOT EXISTS share_views          int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_last_viewed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS kiosk_designs_share_token ON kiosk_designs (share_token) WHERE share_token IS NOT NULL;

COMMIT;
