-- ============================================================
-- 003_schedules.sql
-- Weekly schedule templates + date overrides
-- Sittings + per-slot cover caps
-- ============================================================

-- ── Weekly schedule templates ────────────────────────────────
-- One row per day-of-week per venue.
-- day_of_week: 0=Sunday … 6=Saturday (ISO: use 1=Mon…7=Sun if preferred)
CREATE TABLE venue_schedule_templates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week         smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open             boolean     NOT NULL DEFAULT true,
  slot_interval_mins  smallint    NOT NULL DEFAULT 15
                                  CHECK (slot_interval_mins IN (15, 30, 60)),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, day_of_week)
);

ALTER TABLE venue_schedule_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY vst_tenant_isolation ON venue_schedule_templates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_vst_venue ON venue_schedule_templates(venue_id);

CREATE TRIGGER trg_vst_updated_at
  BEFORE UPDATE ON venue_schedule_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Sittings (time windows within a template day) ────────────
-- Multiple sittings per day: lunch 12:00-15:00, dinner 18:00-23:00
CREATE TABLE venue_sittings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id           uuid        NOT NULL REFERENCES venue_schedule_templates(id) ON DELETE CASCADE,
  venue_id              uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opens_at              time        NOT NULL,
  closes_at             time        NOT NULL,
  -- Fallback cover cap for slots with no specific cap row.
  -- NULL = no sitting-level cap, table capacities are the only limit.
  default_max_covers    int,
  sort_order            int         NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sittings_hours_check CHECK (closes_at > opens_at)
);

ALTER TABLE venue_sittings ENABLE ROW LEVEL SECURITY;
CREATE POLICY vs_tenant_isolation ON venue_sittings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_vsittings_template ON venue_sittings(template_id);
CREATE INDEX idx_vsittings_venue    ON venue_sittings(venue_id);

CREATE TRIGGER trg_vsittings_updated_at
  BEFORE UPDATE ON venue_sittings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Per-slot cover caps (weekly) ─────────────────────────────
-- Sparse: only store slots that differ from sitting.default_max_covers.
-- max_covers = 0 → slot is blocked entirely.
--   Visibility controlled by venues.zero_cap_display:
--     'hidden'      → slot omitted from API response
--     'unavailable' → slot included with available: false (same as fully booked)
CREATE TABLE sitting_slot_caps (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id      uuid        NOT NULL REFERENCES venue_sittings(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_time       time        NOT NULL,
  max_covers      int         NOT NULL CHECK (max_covers >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sitting_id, slot_time)
);

ALTER TABLE sitting_slot_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY ssc_tenant_isolation ON sitting_slot_caps
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_ssc_sitting ON sitting_slot_caps(sitting_id);

CREATE TRIGGER trg_ssc_updated_at
  BEFORE UPDATE ON sitting_slot_caps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Date overrides ───────────────────────────────────────────
-- Specific calendar dates that override the weekly template.
-- is_open = false with no sittings = fully closed day (bank holiday etc.)
-- slot_interval_mins NULL = inherit from weekly template for that day.
CREATE TABLE schedule_date_overrides (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  override_date       date        NOT NULL,
  is_open             boolean     NOT NULL DEFAULT true,
  slot_interval_mins  smallint    CHECK (slot_interval_mins IN (15, 30, 60)),
  label               text,                   -- "Christmas Eve", "Private event" …
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, override_date)
);

ALTER TABLE schedule_date_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdo_tenant_isolation ON schedule_date_overrides
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_sdo_venue_date ON schedule_date_overrides(venue_id, override_date);

CREATE TRIGGER trg_sdo_updated_at
  BEFORE UPDATE ON schedule_date_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Override sittings ────────────────────────────────────────
CREATE TABLE override_sittings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  override_id           uuid        NOT NULL REFERENCES schedule_date_overrides(id) ON DELETE CASCADE,
  venue_id              uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opens_at              time        NOT NULL,
  closes_at             time        NOT NULL,
  default_max_covers    int,
  sort_order            int         NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT override_sittings_hours_check CHECK (closes_at > opens_at)
);

ALTER TABLE override_sittings ENABLE ROW LEVEL SECURITY;
CREATE POLICY os_tenant_isolation ON override_sittings
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_os_override ON override_sittings(override_id);

CREATE TRIGGER trg_os_updated_at
  BEFORE UPDATE ON override_sittings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Per-slot cover caps (overrides) ──────────────────────────
CREATE TABLE override_slot_caps (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sitting_id      uuid        NOT NULL REFERENCES override_sittings(id) ON DELETE CASCADE,
  venue_id        uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_time       time        NOT NULL,
  max_covers      int         NOT NULL CHECK (max_covers >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sitting_id, slot_time)
);

ALTER TABLE override_slot_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY osc_tenant_isolation ON override_slot_caps
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_osc_sitting ON override_slot_caps(sitting_id);

CREATE TRIGGER trg_osc_updated_at
  BEFORE UPDATE ON override_slot_caps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
