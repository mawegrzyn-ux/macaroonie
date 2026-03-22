-- 022_slot_inclusive_last_order.sql
-- Allow the last-order time itself to be a bookable slot.
-- Previously: slot_time < closes_at  (last-order slot excluded)
-- Now:        slot_time <= closes_at (last-order slot included)
-- e.g. if last orders is 22:00, a 22:00 booking is now offered.

CREATE OR REPLACE FUNCTION get_available_slots(
  p_venue_id      uuid,
  p_date          date,
  p_covers        int DEFAULT 1
)
RETURNS SETOF slot_result
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_venue           record;
  v_rules           record;
  v_interval        smallint;
  v_is_open         boolean;
  v_sitting         record;
  v_override        record;
  v_exception       record;
  v_exc_template    record;
  v_exc_template_id uuid    := NULL;
  v_use_override    boolean := false;
  v_use_exception   boolean := false;
  v_slot_ts         timestamptz;
  v_slot_time       time;
  v_cap_row         record;
  v_max_covers      int;
  v_booked          int;
  v_slot_end        timestamptz;
  v_result          slot_result;
  v_now             timestamptz;
  v_cutoff_ts       timestamptz;
BEGIN
  SELECT v.* INTO v_venue FROM venues v WHERE v.id = p_venue_id;
  SELECT r.* INTO v_rules FROM booking_rules r WHERE r.venue_id = p_venue_id;

  v_now := now() AT TIME ZONE v_venue.timezone;

  -- Booking window guard
  IF p_date < (v_now::date + v_rules.book_from_days)
  OR p_date > (v_now::date + v_rules.book_until_days) THEN
    RETURN;
  END IF;

  -- ── Priority 1: named schedule exceptions ─────────────────
  SELECT e.* INTO v_exception
    FROM schedule_exceptions e
   WHERE e.venue_id = p_venue_id
     AND p_date BETWEEN e.date_from AND e.date_to
   ORDER BY e.priority DESC, (e.date_to - e.date_from) ASC
   LIMIT 1;

  IF FOUND THEN
    IF v_exception.is_closed THEN
      RETURN;
    END IF;

    SELECT t.* INTO v_exc_template
      FROM exception_day_templates t
     WHERE t.exception_id = v_exception.id
       AND t.day_of_week  = EXTRACT(DOW FROM p_date)::smallint;

    IF FOUND THEN
      IF NOT v_exc_template.is_open THEN
        RETURN;
      END IF;
      v_use_exception   := true;
      v_interval        := v_exc_template.slot_interval_mins;
      v_exc_template_id := v_exc_template.id;
    END IF;
  END IF;

  -- ── Priority 2+3: single-date override / weekly template ──
  IF NOT v_use_exception THEN
    SELECT o.* INTO v_override
      FROM schedule_date_overrides o
     WHERE o.venue_id = p_venue_id AND o.override_date = p_date;

    IF FOUND THEN
      v_use_override := true;
      v_is_open      := v_override.is_open;
      v_interval     := COALESCE(v_override.slot_interval_mins,
                         (SELECT slot_interval_mins FROM venue_schedule_templates
                           WHERE venue_id    = p_venue_id
                             AND day_of_week = EXTRACT(DOW FROM p_date)::smallint));
    ELSE
      SELECT t.is_open, t.slot_interval_mins
        INTO v_is_open, v_interval
        FROM venue_schedule_templates t
       WHERE t.venue_id    = p_venue_id
         AND t.day_of_week = EXTRACT(DOW FROM p_date)::smallint;
    END IF;

    IF NOT FOUND OR NOT v_is_open THEN
      RETURN;
    END IF;
  END IF;

  -- ── Iterate sittings from the resolved source ─────────────
  FOR v_sitting IN (
    SELECT id, opens_at, closes_at, default_max_covers, sort_order,
           doors_close_time, 'exception' AS source
      FROM exception_sittings
     WHERE template_id    = v_exc_template_id
       AND v_use_exception = true
    UNION ALL
    SELECT id, opens_at, closes_at, default_max_covers, sort_order,
           doors_close_time, 'override' AS source
      FROM override_sittings
     WHERE override_id   = v_override.id
       AND v_use_override = true
    UNION ALL
    SELECT id, opens_at, closes_at, default_max_covers, sort_order,
           doors_close_time, 'template' AS source
      FROM venue_sittings
     WHERE template_id = (
             SELECT id FROM venue_schedule_templates
              WHERE venue_id    = p_venue_id
                AND day_of_week = EXTRACT(DOW FROM p_date)::smallint
           )
       AND NOT v_use_exception
       AND NOT v_use_override
    ORDER BY sort_order, opens_at
  ) LOOP

    v_slot_time := v_sitting.opens_at;

    WHILE v_slot_time <= v_sitting.closes_at LOOP

      v_slot_ts  := (p_date + v_slot_time) AT TIME ZONE v_venue.timezone;
      v_slot_end := v_slot_ts + (v_rules.slot_duration_mins || ' minutes')::interval;

      -- No longer skip slots that would run past closes_at.
      -- A booking may start up to (and including) closes_at.
      -- The WHILE condition (v_slot_time <= closes_at) ensures the
      -- last slot starts at exactly the last order time.

      -- Cutoff check
      v_cutoff_ts := v_slot_ts - (v_rules.cutoff_before_mins || ' minutes')::interval;
      IF v_now > v_cutoff_ts THEN
        v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
        CONTINUE;
      END IF;

      -- Resolve cover cap
      SELECT sc.max_covers INTO v_cap_row
        FROM (
          SELECT max_covers FROM exception_sitting_slot_caps
           WHERE sitting_id = v_sitting.id AND slot_time = v_slot_time
             AND v_sitting.source = 'exception'
          UNION ALL
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
        v_max_covers := v_sitting.default_max_covers;
      END IF;

      -- Zero cap: apply zero_cap_display rule
      IF v_max_covers IS NOT NULL AND v_max_covers = 0 THEN
        IF v_venue.zero_cap_display = 'hidden' THEN
          v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
          CONTINUE;
        ELSE
          v_result.slot_time           := v_slot_ts;
          v_result.available           := false;
          v_result.available_covers    := 0;
          v_result.reason              := 'unavailable';
          v_result.sitting_closes_at   := v_sitting.closes_at;
          v_result.sitting_doors_close := v_sitting.doors_close_time;
          RETURN NEXT v_result;
          v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
          CONTINUE;
        END IF;
      END IF;

      -- Count covers already committed for this slot window
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

      -- Build result
      v_result.slot_time           := v_slot_ts;
      v_result.sitting_closes_at   := v_sitting.closes_at;
      v_result.sitting_doors_close := v_sitting.doors_close_time;

      IF v_max_covers IS NULL THEN
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
