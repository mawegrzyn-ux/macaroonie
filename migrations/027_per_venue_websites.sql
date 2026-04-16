-- ============================================================
-- 027_per_venue_websites.sql
--
-- Shifts the website CMS from one-site-per-tenant to
-- one-site-per-venue, with a tenant-level brand defaults table
-- that every venue site inherits from.
--
-- Why:
--   Master franchisees manage many venues under one tenant
--   (Auth0 org). Each location needs its own website at a
--   distinct subdomain (and optional custom domain), but the
--   franchise brand (logo, colours, fonts, template, analytics,
--   emergency banner) must stay consistent across all venues.
--
-- Changes:
--   1. website_config gets a venue_id FK, UNIQUE (one site
--      per venue).  The previous UNIQUE on tenant_id is
--      dropped — one tenant can now have many website_config
--      rows, one per venue.  tenant_id is kept for RLS.
--   2. New tenant_brand_defaults table — singleton per tenant
--      holding brand-owned fields (logo, colours, fonts,
--      template, analytics, social defaults, emergency banner).
--      Venue website_config fields fall back to these when
--      NULL, so operators can override per venue if needed.
--
-- Field inheritance is resolved at render time by merging
-- tenant_brand_defaults over hard-coded defaults, then
-- overlaying the venue's website_config. See
-- api/src/services/siteDataSvc.js for the merge logic.
-- ============================================================

-- ── 1. website_config → per-venue ────────────────────────────

ALTER TABLE website_config
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES venues(id) ON DELETE CASCADE;

-- Existing single-site-per-tenant rows (if any) need a venue pinned.
-- Pick the first active venue for each tenant; operators can move
-- the site to a different venue later if this guess is wrong.
UPDATE website_config wc
   SET venue_id = v.id
  FROM (
    SELECT DISTINCT ON (tenant_id) id, tenant_id
      FROM venues
     WHERE is_active = true
     ORDER BY tenant_id, created_at
  ) v
 WHERE wc.venue_id IS NULL
   AND wc.tenant_id = v.tenant_id;

ALTER TABLE website_config
  ALTER COLUMN venue_id SET NOT NULL;

-- Drop the old one-row-per-tenant constraint (added in 025 as UNIQUE
-- on the tenant_id column) and enforce one row per venue instead.
ALTER TABLE website_config
  DROP CONSTRAINT IF EXISTS website_config_tenant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS website_config_venue_id_uq
  ON website_config (venue_id);

-- RLS policy already keys on tenant_id — unchanged.

-- ── 2. tenant_brand_defaults ────────────────────────────────

CREATE TABLE tenant_brand_defaults (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity (brand-owned)
  brand_name        text,                         -- e.g. "Wingstop"
  logo_url          text,
  favicon_url       text,

  -- Base visual theme (brand-wide; venue can layer overrides in website_config.theme)
  primary_colour    text        NOT NULL DEFAULT '#630812',
  secondary_colour  text,
  font_family       text        NOT NULL DEFAULT 'Inter',
  template_key      text        NOT NULL DEFAULT 'classic'
                                CHECK (template_key IN ('classic', 'modern')),
  theme             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Brand-level social + analytics (venue can still override its own)
  social_links      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  og_image_url      text,
  ga4_measurement_id text,
  fb_pixel_id        text,

  -- Emergency banner — flipped at tenant level, applies to every
  -- venue site instantly. Operators can't toggle this; only the
  -- master franchisee.
  banner_enabled    boolean     NOT NULL DEFAULT false,
  banner_text       text,
  banner_link_url   text,
  banner_link_text  text,
  banner_severity   text        NOT NULL DEFAULT 'info'
                                CHECK (banner_severity IN ('info', 'warn', 'alert')),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_brand_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_brand_defaults_tenant ON tenant_brand_defaults
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER trg_tenant_brand_defaults_updated_at
  BEFORE UPDATE ON tenant_brand_defaults
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
