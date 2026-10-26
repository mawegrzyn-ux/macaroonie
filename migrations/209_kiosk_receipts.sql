-- 209_kiosk_receipts.sql
--
-- Receipts on the guest's phone: after paying on a self-order kiosk the
-- order done screen can show a QR code of the order's receipt page, or email
-- the receipt (kiosk_designs.settings done.receipt_qr / done.receipt_email,
-- shared/kiosk.js normaliseDesign(); no column for those).
--
--   pos_receipts   one row per order (check) that had its receipt asked for:
--                  the page's token (24 random bytes; the link is the key,
--                  found in system mode: GET /receipt/<token> on the device
--                  hosts, services/receiptSvc.js) and the kiosk that asked.
--                  The page is drawn from the check as it is now, in the
--                  kiosk receipt design. An email is sent while the kiosk
--                  waits and the address is never stored: only its first
--                  letter and its domain (email_hint), how many were sent
--                  (emails, at most a few per order) and when. Views are
--                  counted. Rows go after 400 days (hourly clean-up).

CREATE TABLE IF NOT EXISTS pos_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id        uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id        text NOT NULL,
  device_id       uuid REFERENCES pos_devices(id) ON DELETE SET NULL,
  token           text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{32}$'),
  emails          integer NOT NULL DEFAULT 0,
  email_hint      text,
  emailed_at      timestamptz,
  views           integer NOT NULL DEFAULT 0,
  last_viewed_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, check_id)
);

CREATE INDEX IF NOT EXISTS pos_receipts_created ON pos_receipts (created_at);

ALTER TABLE pos_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_receipts;
CREATE POLICY tenant_isolation ON pos_receipts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on');
