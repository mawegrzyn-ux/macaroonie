-- ============================================================
-- 014_schedule_exceptions.sql
-- Named schedule exception periods (alternative hours or closed)
-- covering a date range that overrides the weekly template.
--
-- Two scenarios:
--   is_closed = true  → venue is closed for the entire range
--                        (e.g. Christmas, annual shutdown)
--   is_closed = false → alternative weekly schedule for the range
--                        (e.g. summer hours, reduced winter hours)
--                        Per-DOW templates define the hours;
--                        days with no DOW template fall back to the
--                        base weekly schedule.
--
-- Resolution order inside get_available_slots():
--   1. schedule_exceptions  (highest priority; narrower range wins ties)
--   2. schedule_date_overrides  (existing single-date overrides)
--   3. venue_schedule_templates  (base weekly schedule)
-- ============================================================

-- ── Exception period header ───────────────────────────────────
CREATE TABLE schedule_exceptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES venues(id)   ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  name        text        NOT NULL,
  date_from   date        NOT NULL,
  date_to     date        NOT NULL,
  is_closed   boolean     NOT NULL DEFAULT false,
  -- Higher priority wins when exceptions overlap.
  -- On equal priority the narrower range (more specific) wins.
  priority    int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT  exc_date_range_valid CHECK (date_to >= date_from)
);

ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY exc_tenant_isolation ON schedule_exceptions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX idx_exc_venue_dates ON schedule_exceptions (venue_id, date_from, date_to);
CREATE TRIGGER trg_exc_updated_at
  BEFORE UPDATE ON schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Per-DOW templates inside an alternative-schedule exception ─
-- Only used when parent exception.is_closed = false.
-- If a DOW has no template the base weekly schedule is used for that day.
CREATE TABLE exception_day_templates (
  id                  uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id        uuid      NOT NULL REFERENCES schedule_exceptions(id) ON DELETE CASCADE,
  venue_id            uuid      NOT NULL REFERENCES venues(id)   ON DELETE CASCADE,
  tenant_id           uuid      NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  day_of_week         smallint  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open             boolean   NOT NULL DEFAULT true,
  slot_interval_mins  smallint  NOT NULL DEFAULT 15
                                CHECK (slot_interval_mins IN (15, 30, 60)),
  UNIQUE (exception_id, day_of_week)
);

ALTER TABLE exception_day_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY exc_tmpl_tenant_isolation ON exception_day_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX idx_exc_tmpl_exception ON exception_day_templates (exception_id);

-- ── Sittings for exception DOW templates ─────────────────────
CREATE TABLE exception_sittings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         uuid        NOT NULL REFERENCES exception_day_templates(id) ON DELETE CASCADE,
  venue_id            uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opens_at            time        NOT NULL,
  closes_at           time        NOT NULL,
  default_max_covers  int,
  doors_close_time    time,
  sort_order          int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exc_sittings_hours_check CHECK (closes_at > opens_at)
);

ALTER TABLE exception_sittings ENABLE ROW LEVEL SECURITY;
CREATE POLICY exc_sit_tenant_isolation ON exception_sittings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX idx_exc_sit_template ON exception_sittings (template_id);
CREATE TRIGGER trg_exc_sit_updated_at
  BEFORE UPDATE ON exception_sittings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Per-slot caps for exception sittings ─────────────────────
CREATE TABLE exception_sitting_slot_caps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id  uuid        NOT NULL REFERENCES exception_sittings(id) ON DELETE CASCADE,
  venue_id    uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_time   time        NOT NULL,
  max_covers  int         NOT NULL CHECK (max_covers >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sitting_id, slot_time)
);

ALTER TABLE exception_sitting_slot_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY exc_caps_tenant_isolation ON exception_sitting_slot_caps
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX idx_exc_caps_sitting ON exception_sitting_slot_caps (sitting_id);

-- ============================================================
-- Updated get_available_slots() — adds exception resolution
-- as Priority 1 before the existing override / weekly-template
-- logic. The sittings loop and all booking/hold math are
-- unchanged; only the source-selection preamble is extended.
-- ============================================================

CREATE OR REPLACE FUNCTION get_available_slots(
  p_venue_id      uuid,
  p_date          date,
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
  v_exception     record;
  v_exc_template  record;
  v_use_override  boolean := false;
  v_use_exception boolean := false;
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
  SELECT v.* INTO v_venue FROM venues v WHERE v.id = p_venue_id;
  SELECT r.* INTO v_rules FROM booking_rules r WHERE r.venue_id = p_venue_id;

  v_now := now() AT TIME ZONE v_venue.timezone;

  -- Booking window guard
  IF p_date < (v_now::date + v_rules.book_from_days)
  OR p_date > (v_now::date + v_rules.book_until_days) THEN
    RETURN;
  END IF;

  -- ── Priority 1: named schedule exceptions ─────────────────
  -- Higher priority wins; on ties the narrower range is more specific.
  SELECT e.* INTO v_exception
    FROM schedule_exceptions e
   WHERE e.venue_id = p_venue_id
     AND p_date BETWEEN e.date_from AND e.date_to
   ORDER BY e.priority DESC, (e.date_to - e.date_from) ASC
   LIMIT 1;

  IF FOUND THEN
    IF v_exception.is_closed THEN
      RETURN;  -- whole period is closed
    END IF;

    -- Look for a DOW template inside this exception
    SELECT t.* INTO v_exc_template
      FROM exception_day_templates t
     WHERE t.exception_id = v_exception.id
       AND t.day_of_week  = EXTRACT(DOW FROM p_date)::smallint;

    IF FOUND THEN
      IF NOT v_exc_template.is_open THEN
        RETURN;  -- this DOW explicitly closed within the exception
      END IF;
      v_use_exception := true;
      v_interval      := v_exc_template.slot_interval_mins;
    END IF;
    -- If no DOW template: fall through to override / weekly template below
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
                           WHERE venue_id = p_venue_id
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
           'exception' AS source
      FROM exception_sittings
     WHERE template_id    = v_exc_template.id
       AND v_use_exception = true
    UNION ALL
    SELECT id, opens_at, closes_at, default_max_covers, sort_order,
           'override' AS source
      FROM override_sittings
     WHERE override_id   = v_override.id
       AND v_use_override = true
    UNION ALL
    SELECT id, opens_at, closes_at, default_max_covers, sort_order,
           'template' AS source
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

    WHILE v_slot_time < v_sitting.closes_at LOOP

      v_slot_ts  := (p_date + v_slot_time) AT TIME ZONE v_venue.timezone;
      v_slot_end := v_slot_ts + (v_rules.slot_duration_mins || ' minutes')::interval;

      -- Skip if booking would run past sitting close
      IF (v_slot_end AT TIME ZONE v_venue.timezone)::time > v_sitting.closes_at THEN
        v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
        CONTINUE;
      END IF;

      -- Cutoff check
      v_cutoff_ts := v_slot_ts - (v_rules.cutoff_before_mins || ' minutes')::interval;
      IF v_now > v_cutoff_ts THEN
        v_slot_time := v_slot_time + (v_interval || ' minutes')::interval;
        CONTINUE;
      END IF;

      -- Resolve cover cap: exception caps → sitting_slot_caps → override_slot_caps
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
          v_result.slot_time        := v_slot_ts;
          v_result.available        := false;
          v_result.available_covers := 0;
          v_result.reason           := 'unavailable';
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
      v_result.slot_time := v_slot_ts;

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
