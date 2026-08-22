-- 070_booking_occupancy.sql
--
-- Booking-engine correctness:
--   1. booking_is_occupying()  — one status set for "this row takes a table"
--   2. table_is_free() /
--      combination_is_free()   — one occupancy check (direct + combo members + holds)
--   3. table_occupancy         — expanded per-member rows; GiST exclude on live holds
--                                so overlapping holds (including combo members) cannot
--                                race past UNIQUE (table_id, starts_at)
--   4. confirm_hold()          — uses table_is_free / combination_is_free (closes the
--                                single-table vs combo blind spot)
--   5. get_available_slots()   — restore occupying-status filter (regressed in 022)
--                                and compare cutoff against timestamptz now()
--
-- When replacing get_available_slots() in a later migration, copy THIS body and
-- keep: booking_is_occupying(), v_now := now(), v_local_today from venue TZ.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Occupying statuses ──────────────────────────────────────
-- cancelled / no_show / checked_out free the table. Everything else occupies.
CREATE OR REPLACE FUNCTION booking_is_occupying(p_status booking_status)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IS NOT NULL
     AND p_status NOT IN (
           'cancelled'::booking_status,
           'no_show'::booking_status,
           'checked_out'::booking_status
         );
$$;

-- Tables a booking/hold physically occupies (combo members, else canonical).
-- Unallocated parking-lot rows are excluded — many bookings may share that row.
CREATE OR REPLACE FUNCTION occupancy_table_ids(
  p_table_id        uuid,
  p_combination_id  uuid
)
RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT t.id
    FROM tables t
   WHERE t.is_unallocated = false
     AND t.id IN (
           SELECT m.table_id
             FROM table_combination_members m
            WHERE p_combination_id IS NOT NULL
              AND m.combination_id = p_combination_id
           UNION
           SELECT p_table_id
            WHERE p_combination_id IS NULL
              AND p_table_id IS NOT NULL
         );
$$;

-- ── Occupancy primitive ─────────────────────────────────────
-- p_lock = true takes a transaction-scoped advisory lock on the table id
-- (sorted by callers of combination_is_free) so concurrent confirms serialise.
CREATE OR REPLACE FUNCTION table_is_free(
  p_table_id            uuid,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_exclude_booking_id  uuid    DEFAULT NULL,
  p_exclude_hold_id     uuid    DEFAULT NULL,
  p_lock                boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_unallocated boolean;
BEGIN
  IF p_table_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_lock THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_table_id::text, 0));
  END IF;

  SELECT is_unallocated INTO v_unallocated FROM tables WHERE id = p_table_id;
  IF v_unallocated IS NULL THEN
    RETURN false;
  END IF;
  -- Unallocated is a parking lot — overlap is allowed.
  IF v_unallocated THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM bookings b
     WHERE booking_is_occupying(b.status)
       AND (p_exclude_booking_id IS NULL OR b.id IS DISTINCT FROM p_exclude_booking_id)
       AND b.starts_at < p_ends_at
       AND b.ends_at   > p_starts_at
       AND (
             b.table_id = p_table_id
             OR (b.combination_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM table_combination_members m
                    WHERE m.combination_id = b.combination_id
                      AND m.table_id = p_table_id
                 ))
           )
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM booking_holds h
     WHERE h.expires_at > now()
       AND (p_exclude_hold_id IS NULL OR h.id IS DISTINCT FROM p_exclude_hold_id)
       AND h.starts_at < p_ends_at
       AND h.ends_at   > p_starts_at
       AND (
             h.table_id = p_table_id
             OR (h.combination_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM table_combination_members m
                    WHERE m.combination_id = h.combination_id
                      AND m.table_id = p_table_id
                 ))
           )
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION combination_is_free(
  p_combination_id      uuid,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_exclude_booking_id  uuid    DEFAULT NULL,
  p_exclude_hold_id     uuid    DEFAULT NULL,
  p_lock                boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  r record;
BEGIN
  IF p_combination_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM table_combination_members WHERE combination_id = p_combination_id
  ) THEN
    RETURN false;
  END IF;

  IF p_lock THEN
    FOR r IN
      SELECT m.table_id
        FROM table_combination_members m
       WHERE m.combination_id = p_combination_id
       ORDER BY m.table_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(r.table_id::text, 0));
    END LOOP;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM table_combination_members m
     WHERE m.combination_id = p_combination_id
       AND NOT table_is_free(
             m.table_id, p_starts_at, p_ends_at,
             p_exclude_booking_id, p_exclude_hold_id, false
           )
  );
END;
$$;

-- ── Occupancy rows + GiST on live holds ─────────────────────
CREATE TABLE table_occupancy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  table_id    uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES bookings(id) ON DELETE CASCADE,
  hold_id     uuid REFERENCES booking_holds(id) ON DELETE CASCADE,
  during      tstzrange NOT NULL,
  CONSTRAINT table_occupancy_source CHECK (
    (booking_id IS NOT NULL AND hold_id IS NULL)
    OR (booking_id IS NULL AND hold_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_occupancy_booking_table
  ON table_occupancy (booking_id, table_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX idx_occupancy_hold_table
  ON table_occupancy (hold_id, table_id) WHERE hold_id IS NOT NULL;

-- Overlapping live holds on the same physical table (incl. combo members) fail.
-- Booking-vs-booking overlap is NOT excluded here: operator manual-mode and the
-- unallocated parking lot are allowed to stack. Those paths go through
-- table_is_free() in application code (or skip it deliberately).
ALTER TABLE table_occupancy
  ADD CONSTRAINT table_occupancy_hold_no_overlap
  EXCLUDE USING gist (table_id WITH =, during WITH &&)
  WHERE (hold_id IS NOT NULL);

ALTER TABLE table_occupancy ENABLE ROW LEVEL SECURITY;
CREATE POLICY occupancy_tenant ON table_occupancy
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION rebuild_booking_occupancy()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM table_occupancy WHERE booking_id = OLD.id;
    RETURN OLD;
  END IF;

  DELETE FROM table_occupancy WHERE booking_id = NEW.id;

  IF NOT booking_is_occupying(NEW.status) THEN
    RETURN NEW;
  END IF;

  INSERT INTO table_occupancy (tenant_id, venue_id, table_id, booking_id, during)
  SELECT NEW.tenant_id, NEW.venue_id, tid, NEW.id,
         tstzrange(NEW.starts_at, NEW.ends_at, '[)')
    FROM occupancy_table_ids(NEW.table_id, NEW.combination_id) AS tid
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rebuild_hold_occupancy()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM table_occupancy WHERE hold_id = OLD.id;
    RETURN OLD;
  END IF;

  DELETE FROM table_occupancy WHERE hold_id = NEW.id;

  INSERT INTO table_occupancy (tenant_id, venue_id, table_id, hold_id, during)
  SELECT NEW.tenant_id, NEW.venue_id, tid, NEW.id,
         tstzrange(NEW.starts_at, NEW.ends_at, '[)')
    FROM occupancy_table_ids(NEW.table_id, NEW.combination_id) AS tid
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bookings_occupancy
  AFTER INSERT OR UPDATE OF table_id, combination_id, starts_at, ends_at, status
  ON bookings
  FOR EACH ROW EXECUTE FUNCTION rebuild_booking_occupancy();

CREATE TRIGGER trg_bookings_occupancy_del
  AFTER DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION rebuild_booking_occupancy();

CREATE TRIGGER trg_holds_occupancy
  AFTER INSERT OR UPDATE OF table_id, combination_id, starts_at, ends_at
  ON booking_holds
  FOR EACH ROW EXECUTE FUNCTION rebuild_hold_occupancy();

CREATE TRIGGER trg_holds_occupancy_del
  AFTER DELETE ON booking_holds
  FOR EACH ROW EXECUTE FUNCTION rebuild_hold_occupancy();

-- Backfill occupying bookings (skip unallocated). Historical overlaps are
-- skipped via ON CONFLICT DO NOTHING so the migration cannot fail on existing
-- double-books; new writes go through the trigger.
INSERT INTO table_occupancy (tenant_id, venue_id, table_id, booking_id, during)
SELECT b.tenant_id, b.venue_id, tid, b.id,
       tstzrange(b.starts_at, b.ends_at, '[)')
  FROM bookings b
  CROSS JOIN LATERAL occupancy_table_ids(b.table_id, b.combination_id) AS tid
 WHERE booking_is_occupying(b.status)
ON CONFLICT DO NOTHING;

-- Overlapping live holds hit the GiST exclude (not unique), so ON CONFLICT
-- cannot skip them. Insert per-row and swallow exclusion_violation.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT h.tenant_id, h.venue_id, tid AS table_id, h.id AS hold_id,
           tstzrange(h.starts_at, h.ends_at, '[)') AS during
      FROM booking_holds h
      CROSS JOIN LATERAL occupancy_table_ids(h.table_id, h.combination_id) AS tid
     WHERE h.expires_at > now()
  LOOP
    BEGIN
      INSERT INTO table_occupancy (tenant_id, venue_id, table_id, hold_id, during)
      VALUES (r.tenant_id, r.venue_id, r.table_id, r.hold_id, r.during);
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      NULL;
    END;
  END LOOP;
END $$;

-- ── confirm_hold: shared occupancy primitive ────────────────
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

-- ── get_available_slots: occupying statuses + TZ-safe cutoff ─
-- Body is 022 plus:
--   * v_now is timestamptz now() (cutoff compare)
--   * book-ahead window uses venue-local today
--   * cover count uses booking_is_occupying()
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
  v_local_today     date;
  v_cutoff_ts       timestamptz;
BEGIN
  SELECT v.* INTO v_venue FROM venues v WHERE v.id = p_venue_id;
  SELECT r.* INTO v_rules FROM booking_rules r WHERE r.venue_id = p_venue_id;

  v_now         := now();
  v_local_today := (now() AT TIME ZONE v_venue.timezone)::date;

  IF p_date < (v_local_today + v_rules.book_from_days)
  OR p_date > (v_local_today + v_rules.book_until_days) THEN
    RETURN;
  END IF;

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

      v_cutoff_ts := v_slot_ts - (v_rules.cutoff_before_mins || ' minutes')::interval;
      IF v_now > v_cutoff_ts THEN
        v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
        CONTINUE;
      END IF;

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

      -- Active covers only. Combo bookings are counted once via canonical table_id.
      SELECT COALESCE(SUM(b.covers), 0) INTO v_booked
        FROM bookings b
       WHERE b.venue_id = p_venue_id
         AND booking_is_occupying(b.status)
         AND b.starts_at < v_slot_end
         AND b.ends_at   > v_slot_ts;

      SELECT v_booked + COALESCE(SUM(h.covers), 0) INTO v_booked
        FROM booking_holds h
       WHERE h.venue_id = p_venue_id
         AND h.expires_at > now()
         AND h.starts_at  < v_slot_end
         AND h.ends_at    > v_slot_ts;

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
