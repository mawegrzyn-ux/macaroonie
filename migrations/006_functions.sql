-- ============================================================
-- 006_functions.sql
-- Hold sweep job + slot resolver function
-- ============================================================

-- ── Hold sweep: runs every minute via pg_cron ─────────────────
-- Deletes expired holds, freeing slots automatically as fallback
-- (primary release is still the explicit DELETE /holds/{id} call).
CREATE OR REPLACE FUNCTION sweep_expired_holds()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM booking_holds WHERE expires_at < now();
END;
$$;

-- Schedule via pg_cron (run once after extension is confirmed active)
SELECT cron.schedule('sweep-holds', '* * * * *', 'SELECT sweep_expired_holds()');

-- ── Slot resolver ─────────────────────────────────────────────
-- Returns available slots for a venue + date + covers.
-- Handles:
--   1. Date override vs weekly template priority
--   2. Multiple sittings per day
--   3. Per-slot cover cap lookup (sparse, falls back to sitting default)
--   4. zero_cap_display: hidden | unavailable
--   5. Availability: subtracts active bookings + non-expired holds
--   6. Booking window cutoff (cutoff_before_mins)
--   7. Book-ahead window (book_from_days / book_until_days)
--
-- Returns table of slots the widget can render directly.

CREATE TYPE slot_result AS (
  slot_time       timestamptz,   -- full timestamp in venue timezone
  available       boolean,
  available_covers int,          -- 0 if fully booked / capped; null if uncapped
  reason          text           -- 'available' | 'full' | 'unavailable' | 'cutoff'
);

CREATE OR REPLACE FUNCTION get_available_slots(
  p_venue_id      uuid,
  p_date          date,           -- date in venue local time
  p_covers        int DEFAULT 1
)
RETURNS SETOF slot_result
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_venue         record;
  v_rules         record;
  v_interval      smallint;
  v_is_open       boolean;
  v_sitting       record;
  v_override      record;
  v_use_override  boolean := false;
  v_slot_ts       timestamptz;
  v_slot_time     time;
  v_cap_row       record;
  v_max_covers    int;
  v_booked        int;
  v_slot_end      timestamptz;
  v_result        slot_result;
  v_now           timestamptz;
  v_cutoff_ts     timestamptz;
BEGIN
  -- Load venue + rules in a single query each
  SELECT v.*, v.timezone INTO v_venue
    FROM venues v WHERE v.id = p_venue_id;

  SELECT r.* INTO v_rules
    FROM booking_rules r WHERE r.venue_id = p_venue_id;

  v_now := now() AT TIME ZONE v_venue.timezone;

  -- Booking window guard
  IF p_date < (v_now::date + v_rules.book_from_days)
  OR p_date > (v_now::date + v_rules.book_until_days) THEN
    RETURN; -- no slots outside allowed window
  END IF;

  -- Check for date override
  SELECT o.* INTO v_override
    FROM schedule_date_overrides o
   WHERE o.venue_id = p_venue_id AND o.override_date = p_date;

  IF FOUND THEN
    v_use_override := true;
    v_is_open      := v_override.is_open;
    v_interval     := COALESCE(v_override.slot_interval_mins,
                       (SELECT slot_interval_mins FROM venue_schedule_templates
                         WHERE venue_id = p_venue_id
                           AND day_of_week = EXTRACT(DOW FROM p_date)::smallint));
  ELSE
    SELECT t.is_open, t.slot_interval_mins
      INTO v_is_open, v_interval
      FROM venue_schedule_templates t
     WHERE t.venue_id = p_venue_id
       AND t.day_of_week = EXTRACT(DOW FROM p_date)::smallint;
  END IF;

  -- Closed day → return nothing
  IF NOT FOUND OR NOT v_is_open THEN
    RETURN;
  END IF;

  -- Iterate sittings
  FOR v_sitting IN (
    SELECT s.* FROM (
      SELECT id, opens_at, closes_at, default_max_covers, sort_order,
             'template' AS source
        FROM venue_sittings
       WHERE template_id = (
               SELECT id FROM venue_schedule_templates
                WHERE venue_id = p_venue_id
                  AND day_of_week = EXTRACT(DOW FROM p_date)::smallint
             )
         AND v_use_override = false
      UNION ALL
      SELECT id, opens_at, closes_at, default_max_covers, sort_order,
             'override' AS source
        FROM override_sittings
       WHERE override_id = v_override.id
         AND v_use_override = true
    ) s ORDER BY s.sort_order, s.opens_at
  ) LOOP

    -- Generate candidate slot times within this sitting
    v_slot_time := v_sitting.opens_at;

    WHILE v_slot_time < v_sitting.closes_at LOOP

      -- Build full timestamp in UTC (store everything in UTC)
      v_slot_ts  := (p_date + v_slot_time) AT TIME ZONE v_venue.timezone;
      v_slot_end := v_slot_ts + (v_rules.slot_duration_mins || ' minutes')::interval;

      -- Skip if slot end exceeds sitting close
      IF (v_slot_end AT TIME ZONE v_venue.timezone)::time > v_sitting.closes_at THEN
        v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
        CONTINUE;
      END IF;

      -- Cutoff check
      v_cutoff_ts := v_slot_ts - (v_rules.cutoff_before_mins || ' minutes')::interval;
      IF v_now > v_cutoff_ts THEN
        v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
        CONTINUE; -- past cutoff, skip silently
      END IF;

      -- Resolve cover cap for this slot
      SELECT sc.max_covers INTO v_cap_row
        FROM (
          SELECT max_covers FROM sitting_slot_caps
           WHERE sitting_id = v_sitting.id AND slot_time = v_slot_time
             AND v_sitting.source = 'template'
          UNION ALL
          SELECT max_covers FROM override_slot_caps
           WHERE sitting_id = v_sitting.id AND slot_time = v_slot_time
             AND v_sitting.source = 'override'
        ) sc LIMIT 1;

      IF FOUND THEN
        v_max_covers := v_cap_row.max_covers;
      ELSE
        v_max_covers := v_sitting.default_max_covers; -- may be null
      END IF;

      -- Zero cap: apply zero_cap_display rule
      IF v_max_covers IS NOT NULL AND v_max_covers = 0 THEN
        IF v_venue.zero_cap_display = 'hidden' THEN
          v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
          CONTINUE;
        ELSE
          -- Show as unavailable (same appearance as fully booked)
          v_result.slot_time       := v_slot_ts;
          v_result.available       := false;
          v_result.available_covers := 0;
          v_result.reason          := 'unavailable';
          RETURN NEXT v_result;
          v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
          CONTINUE;
        END IF;
      END IF;

      -- Count covers already booked + held in this slot window
      SELECT COALESCE(SUM(b.covers), 0) INTO v_booked
        FROM bookings b
       WHERE b.table_id IN (SELECT id FROM tables WHERE venue_id = p_venue_id)
         AND b.status NOT IN ('cancelled')
         AND b.starts_at < v_slot_end
         AND b.ends_at   > v_slot_ts;

      SELECT v_booked + COALESCE(SUM(h.covers), 0) INTO v_booked
        FROM booking_holds h
       WHERE h.venue_id = p_venue_id
         AND h.expires_at > now()
         AND h.starts_at  < v_slot_end
         AND h.ends_at    > v_slot_ts;

      -- Build result row
      v_result.slot_time := v_slot_ts;

      IF v_max_covers IS NULL THEN
        -- No sitting-level cap: only table-level caps apply (handled by booking svc)
        v_result.available        := true;
        v_result.available_covers := NULL;
        v_result.reason           := 'available';
      ELSIF v_booked >= v_max_covers THEN
        v_result.available        := false;
        v_result.available_covers := 0;
        v_result.reason           := 'full';
      ELSIF (v_max_covers - v_booked) < p_covers THEN
        v_result.available        := false;
        v_result.available_covers := v_max_covers - v_booked;
        v_result.reason           := 'full';
      ELSE
        v_result.available        := true;
        v_result.available_covers := v_max_covers - v_booked;
        v_result.reason           := 'available';
      END IF;

      RETURN NEXT v_result;

      v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
    END LOOP;

  END LOOP;

  RETURN;
END;
$$;

-- ── Final lock check (called inside booking confirm transaction) ──
-- Returns true if the slot is still available to book right now.
-- Uses FOR UPDATE NOWAIT on the hold row to prevent concurrent confirms.
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

  -- Verify no confirmed booking now overlaps (e.g. admin manually added one)
  IF EXISTS (
    SELECT 1 FROM bookings
     WHERE table_id = v_hold.table_id
       AND status NOT IN ('cancelled')
       AND starts_at < v_hold.ends_at
       AND ends_at   > v_hold.starts_at
  ) THEN
    RETURN QUERY SELECT v_hold, false, 'slot_conflict';
    RETURN;
  END IF;

  RETURN QUERY SELECT v_hold, true, 'ok';
END;
$$;
