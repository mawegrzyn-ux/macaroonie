-- 247_po_sent_late.sql
--
-- Whether a supplier order went in after its order deadline (report builder
-- phase 3b, docs/REPORTS.md 20: Appendix B's "Orders sent late"). Judged
-- once, when the order first goes to the supplier (emailed, or marked sent
-- by hand), with the supplier's ordering settings for the venue at that
-- moment, by deadlinePassed() in shared/procurement.js: judgeFirstSend() in
-- api/src/services/purchasingSvc.js. A resend (an order changed after
-- sending) keeps the first judgement; a delivery booked in without an order
-- is never sent and never judged.
--
--   first_sent_at  when it first went (sent_at moves on every resend)
--   deadline_at    the moment its order deadline passed: the cutoff on the
--                  deadline day, else the start of the day after it
--   sent_late      it went at or after deadline_at (NULL = not judged)
--
-- Orders sent once before this migration know their first send: sent_at.
-- The API judges them when it starts (backfillSentLate(), with each
-- supplier's settings as they are then). Orders changed after sending
-- before it don't know when they first went, and stay unjudged.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS first_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sent_late     boolean;

UPDATE purchase_orders
   SET first_sent_at = sent_at
 WHERE sent_at IS NOT NULL AND first_sent_at IS NULL AND amended_at IS NULL AND NOT no_order;
