-- 054_fix_confirm_hold.sql
--
-- Two bugs in confirm_hold():
--
-- 1. Status mismatch: the function checked status NOT IN ('cancelled') but
--    get_available_slots() and all slot queries treat 'no_show' and
--    'checked_out' as free. A booking with status 'no_show' at a given time
--    made the slot appear available but then caused a conflict at confirm time.
--    Fix: use NOT IN ('cancelled', 'no_show', 'checked_out') to match.
--
-- 2. Combination blind spot: for combination holds the function only checked
--    table_id (the first member). If another booking landed on a non-first
--    member table between slot display and confirm, it went undetected.
--    Fix: when combination_id IS NOT NULL, also verify every member table is
--    free for the hold window.

CREATE OR REPLACE FUNCTION confirm_hold(
  p_hold_id   uuid,
  p_tenant_id uuid
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
  -- Lock the hold row — raises exception immediately if another tx has it
  SELECT * INTO v_hold
    FROM booking_holds
   WHERE id = p_hold_id
     AND tenant_id = p_tenant_id
     FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_hold, false, 'hold_not_found';
    RETURN;
  END IF;

  IF v_hold.expires_at < now() THEN
    RETURN QUERY SELECT v_hold, false, 'hold_expired';
    RETURN;
  END IF;

  -- Check for conflicting bookings on the canonical table_id.
  -- Exclude 'no_show' and 'checked_out' — same set as slot availability queries.
  IF v_hold.table_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM bookings
     WHERE table_id = v_hold.table_id
       AND status NOT IN ('cancelled', 'no_show', 'checked_out')
       AND starts_at < v_hold.ends_at
       AND ends_at   > v_hold.starts_at
  ) THEN
    RETURN QUERY SELECT v_hold, false, 'slot_conflict';
    RETURN;
  END IF;

  -- For combination holds: also verify every member table is still free.
  IF v_hold.combination_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM table_combination_members m
      JOIN bookings b ON b.table_id = m.table_id
     WHERE m.combination_id = v_hold.combination_id
       AND b.status NOT IN ('cancelled', 'no_show', 'checked_out')
       AND b.starts_at < v_hold.ends_at
       AND b.ends_at   > v_hold.starts_at
  ) THEN
    RETURN QUERY SELECT v_hold, false, 'slot_conflict';
    RETURN;
  END IF;

  RETURN QUERY SELECT v_hold, true, 'ok';
END;
$$;
