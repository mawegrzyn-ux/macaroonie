-- ============================================================
-- 097_payment_channel_cash_flag.sql
--
-- Adds an explicit "counts toward Net Cash" flag per payment
-- channel. Net Cash / Cash to bank previously summed ALL active
-- takings channels (including card/voucher/online), which never
-- become physical cash in the till. Backfill: 'cash' type
-- channels default true, everything else defaults false — the
-- operator can flip either way per channel.
-- ============================================================

BEGIN;

ALTER TABLE cash_payment_channels
  ADD COLUMN IF NOT EXISTS counts_as_cash boolean NOT NULL DEFAULT true;

UPDATE cash_payment_channels
   SET counts_as_cash = (type = 'cash');

COMMIT;
