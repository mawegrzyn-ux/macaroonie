-- 220_booking_deposits.sql
--
-- Booking deposits paid in the reservations widget, through the group's
-- own Stripe account (Stripe Connect, migration 215; services/depositSvc.js).
-- The guest picks a time and gives their details, the widget holds the
-- table, then shows Stripe's payment form for the deposit; the booking is
-- made only once Stripe says the payment succeeded (read back from Stripe
-- by the widget's confirm, or the Connect webhook).
--
-- booking_holds:
--   guest_notes      the guest's notes, kept until the booking is made
--                    (a paid hold becomes a booking from the webhook too)
--   deposit_pence    the deposit the PaymentIntent was made for
--   stripe_account   the group's Stripe account the PaymentIntent is on
--
-- payments (a booking's deposit):
--   stripe_account       the account the money went to (refunds go there,
--                        even after the group unlinks or changes account)
--   refund_hours_before  the venue's rule when it was paid: NULL = keep the
--                        deposit when the guest cancels; N = give it back
--                        when the guest cancels more than N hours before
--                        the booking (deposit_rules.refund_hours_before)
--   refund_ids           Stripe refund ids, newest last

ALTER TABLE booking_holds
  ADD COLUMN IF NOT EXISTS guest_notes    text,
  ADD COLUMN IF NOT EXISTS deposit_pence  int CHECK (deposit_pence IS NULL OR deposit_pence > 0),
  ADD COLUMN IF NOT EXISTS stripe_account text;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_account      text,
  ADD COLUMN IF NOT EXISTS refund_hours_before int CHECK (refund_hours_before IS NULL OR refund_hours_before >= 0),
  ADD COLUMN IF NOT EXISTS refund_ids          text[] NOT NULL DEFAULT '{}';

UPDATE deposit_rules SET refund_hours_before = NULL WHERE refund_hours_before < 0;
ALTER TABLE deposit_rules
  DROP CONSTRAINT IF EXISTS deposit_rules_refund_hours_check;
ALTER TABLE deposit_rules
  ADD CONSTRAINT deposit_rules_refund_hours_check CHECK (refund_hours_before IS NULL OR refund_hours_before >= 0);

-- confirm_hold() gains p_allow_expired: a hold whose deposit Stripe has
-- taken is booked even if it ran out while the guest was paying, as long
-- as its table is still free (the guest has paid; services/depositSvc.js).
-- Body otherwise as migration 070.
DROP FUNCTION IF EXISTS confirm_hold(uuid, uuid);
CREATE OR REPLACE FUNCTION confirm_hold(
  p_hold_id       uuid,
  p_tenant_id     uuid,
  p_allow_expired boolean DEFAULT false
)
RETURNS TABLE (
  hold        booking_holds,
  is_valid    boolean,
  reason      text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_hold booking_holds;
BEGIN
  SELECT * INTO v_hold
    FROM booking_holds
   WHERE id = p_hold_id
     AND tenant_id = p_tenant_id
     FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_hold, false, 'hold_not_found';
    RETURN;
  END IF;

  IF v_hold.expires_at < now() AND NOT p_allow_expired THEN
    RETURN QUERY SELECT v_hold, false, 'hold_expired';
    RETURN;
  END IF;

  -- Combination holds: every member must be free (excl. this hold).
  -- Single-table holds: also see combo bookings occupying this table.
  IF v_hold.combination_id IS NOT NULL THEN
    IF NOT combination_is_free(
         v_hold.combination_id, v_hold.starts_at, v_hold.ends_at,
         NULL, v_hold.id, true
       )
    THEN
      RETURN QUERY SELECT v_hold, false, 'slot_conflict';
      RETURN;
    END IF;
  ELSIF v_hold.table_id IS NOT NULL THEN
    IF NOT table_is_free(
         v_hold.table_id, v_hold.starts_at, v_hold.ends_at,
         NULL, v_hold.id, true
       )
    THEN
      RETURN QUERY SELECT v_hold, false, 'slot_conflict';
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT v_hold, true, 'ok';
END;
$$;
