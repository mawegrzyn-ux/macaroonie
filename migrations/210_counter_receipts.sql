-- 210_counter_receipts.sql
--
-- Email receipts for kiosk orders paid at the counter. Until now a receipt
-- could be emailed only after a card payment on the kiosk (migration 209).
-- A guest paying at the counter can now ask for one too: the address waits,
-- sealed (services/vault.js), until the till takes payment, and the receipt
-- goes out then (services/receiptSvc.js sendWaitingReceipts(), after the
-- till's events and from the minute sweep). The address is cleared as soon
-- as the receipt is sent, when the order is cancelled, after a few failed
-- tries, or when nobody pays within a day.
--
--   email_to          the address waiting for payment, sealed; NULL otherwise
--   email_wanted_at   when the guest asked
--   email_claimed_at  when a process last took it to send (two minutes per
--                     try between tries, so two processes never send twice)
--   email_tries       failed tries so far
--   email_error       why the last try failed, or why it was given up

ALTER TABLE pos_receipts
  ADD COLUMN IF NOT EXISTS email_to          text,
  ADD COLUMN IF NOT EXISTS email_wanted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS email_claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS email_tries       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_error       text;

CREATE INDEX IF NOT EXISTS pos_receipts_waiting ON pos_receipts (venue_id, email_wanted_at) WHERE email_to IS NOT NULL;
