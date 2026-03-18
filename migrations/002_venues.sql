-- ============================================================
-- 002_venues.sql
-- Venues, sections, tables
-- ============================================================

CREATE TYPE zero_cap_display AS ENUM ('hidden', 'unavailable');

-- ── Venues ───────────────────────────────────────────────────
CREATE TABLE venues (
  id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid              NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text              NOT NULL,
  slug                text              NOT NULL,
  timezone            text              NOT NULL DEFAULT 'UTC',
  currency            char(3)           NOT NULL DEFAULT 'GBP',
  zero_cap_display    zero_cap_display  NOT NULL DEFAULT 'hidden',
  is_active           boolean           NOT NULL DEFAULT true,
  created_at          timestamptz       NOT NULL DEFAULT now(),
  updated_at          timestamptz       NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY venues_tenant_isolation ON venues
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_venues_tenant ON venues(tenant_id);

CREATE TRIGGER trg_venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Venue sections (optional grouping: Main, Terrace, Bar) ───
CREATE TABLE venue_sections (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE venue_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY venue_sections_tenant_isolation ON venue_sections
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_venue_sections_venue ON venue_sections(venue_id);

-- ── Tables ───────────────────────────────────────────────────
CREATE TABLE tables (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  section_id  uuid        REFERENCES venue_sections(id) ON DELETE SET NULL,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label       text        NOT NULL,          -- T1, Bar-3, Window-2 …
  min_covers  int         NOT NULL DEFAULT 1,
  max_covers  int         NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tables_covers_check CHECK (min_covers >= 1 AND max_covers >= min_covers)
);

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tables_tenant_isolation ON tables
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX idx_tables_venue   ON tables(venue_id);
CREATE INDEX idx_tables_section ON tables(section_id);

CREATE TRIGGER trg_tables_updated_at
  BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
