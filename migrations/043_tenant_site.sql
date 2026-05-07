-- ============================================================
-- 043_tenant_site.sql
--
-- Architectural shift: ONE site per TENANT (not per venue).
--
-- Before: each venue under a master franchisee got its own website
--   at {venue_subdomain}.macaroonie.com, with shared brand defaults
--   cascading from `tenant_brand_defaults`.
--
-- After: the tenant has one site at {tenant_slug}.macaroonie.com.
--   Each venue under the tenant becomes a /locations/{venue_slug}
--   page generated from that venue's website_config row, plus a
--   /locations index. The booking widget gains a tenant mode with
--   a location picker (or accepts a deep-link to a specific venue).
--
-- Why: franchises want one canonical brand URL for SEO + ad spend.
--   A single venue is a degenerate case (locations index can be
--   hidden via `hide_locations_index`).
--
-- Schema changes (pre-prod, no backwards compat — see CLAUDE.md):
--   1. Rename `tenant_brand_defaults` → `tenant_site` and add the
--      site-identity columns that used to live on website_config:
--      subdomain_slug, custom_domain[_verified], site_name, tagline,
--      meta_title, meta_description, home_blocks, is_published.
--   2. Backfill those tenant-level fields from the first published
--      website_config row per tenant (best-effort, pre-prod data).
--   3. Drop them from website_config — that table now only holds
--      per-venue location-page content.
--   4. Re-purpose website_config.home_blocks → page_blocks (the
--      block layout for the venue's location page).
-- ============================================================

BEGIN;

-- ── 1. Rename + extend tenant_brand_defaults → tenant_site ──────

ALTER TABLE tenant_brand_defaults RENAME TO tenant_site;
ALTER TABLE tenant_site RENAME CONSTRAINT tenant_brand_defaults_pkey TO tenant_site_pkey;
ALTER TABLE tenant_site RENAME CONSTRAINT tenant_brand_defaults_tenant_id_key TO tenant_site_tenant_id_key;
ALTER TABLE tenant_site RENAME CONSTRAINT tenant_brand_defaults_tenant_id_fkey TO tenant_site_tenant_id_fkey;
ALTER POLICY tenant_brand_defaults_tenant ON tenant_site RENAME TO tenant_site_tenant;
ALTER TRIGGER trg_tenant_brand_defaults_updated_at ON tenant_site RENAME TO trg_tenant_site_updated_at;

ALTER TABLE tenant_site
  ADD COLUMN subdomain_slug          text,
  ADD COLUMN custom_domain           text,
  ADD COLUMN custom_domain_verified  boolean NOT NULL DEFAULT false,
  ADD COLUMN site_name               text,
  ADD COLUMN tagline                 text,
  ADD COLUMN meta_title              text,
  ADD COLUMN meta_description        text,
  ADD COLUMN home_blocks             jsonb,
  ADD COLUMN is_published            boolean NOT NULL DEFAULT false,
  ADD COLUMN hide_locations_index    boolean NOT NULL DEFAULT false,
  ADD COLUMN locations_heading       text    NOT NULL DEFAULT 'Our locations',
  ADD COLUMN locations_intro         text,
  -- The widget defaults for the embedded "book a table" CTA on the
  -- tenant home page — when set, deep-link straight to that venue
  -- instead of showing the location picker.
  ADD COLUMN default_widget_venue_id uuid REFERENCES venues(id) ON DELETE SET NULL;

-- Subdomain shape constraint (matches the old website_config one).
ALTER TABLE tenant_site
  ADD CONSTRAINT tenant_site_subdomain_slug_check
  CHECK (
    subdomain_slug IS NULL OR
    subdomain_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  );

-- Custom-domain shape constraint.
ALTER TABLE tenant_site
  ADD CONSTRAINT tenant_site_custom_domain_shape
  CHECK (
    custom_domain IS NULL OR
    custom_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  );

-- ── 2. Backfill tenant_site rows + identity from website_config ─

-- Ensure every tenant has a tenant_site row (tenants whose brand
-- defaults were never created get a stub now).
INSERT INTO tenant_site (tenant_id, primary_colour, font_family, template_key)
SELECT t.id, '#630812', 'Inter', 'classic'
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM tenant_site ts WHERE ts.tenant_id = t.id);

-- Pick the first website_config per tenant (preferring published rows)
-- and copy its identity into tenant_site.
WITH chosen AS (
  SELECT DISTINCT ON (wc.tenant_id)
         wc.tenant_id,
         wc.subdomain_slug,
         wc.custom_domain,
         wc.custom_domain_verified,
         wc.site_name,
         wc.tagline,
         wc.meta_title,
         wc.meta_description,
         wc.home_blocks,
         wc.is_published,
         wc.venue_id   AS default_widget_venue_id
    FROM website_config wc
   ORDER BY wc.tenant_id, wc.is_published DESC, wc.created_at
)
UPDATE tenant_site ts
   SET subdomain_slug          = chosen.subdomain_slug,
       custom_domain           = chosen.custom_domain,
       custom_domain_verified  = chosen.custom_domain_verified,
       site_name               = chosen.site_name,
       tagline                 = chosen.tagline,
       meta_title              = chosen.meta_title,
       meta_description        = chosen.meta_description,
       home_blocks             = chosen.home_blocks,
       is_published            = chosen.is_published,
       default_widget_venue_id = chosen.default_widget_venue_id,
       updated_at              = now()
  FROM chosen
 WHERE ts.tenant_id = chosen.tenant_id;

-- Tenants with no website_config: synthesise a slug from the tenant slug
-- so the admin lands somewhere sensible. They can change it before publish.
UPDATE tenant_site ts
   SET subdomain_slug = lower(regexp_replace(t.slug, '[^a-z0-9-]', '-', 'g'))
  FROM tenants t
 WHERE ts.tenant_id = t.id
   AND ts.subdomain_slug IS NULL;

-- Force uniqueness AFTER the backfill — collisions in pre-prod data are
-- resolved by appending a numeric suffix.
DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN
    SELECT tenant_id, subdomain_slug
      FROM tenant_site
     WHERE subdomain_slug IS NOT NULL
  LOOP
    -- Skip if no collision
    IF (SELECT count(*) FROM tenant_site WHERE subdomain_slug = r.subdomain_slug) <= 1 THEN
      CONTINUE;
    END IF;
    -- Append a counter to all but the first occurrence
    base := r.subdomain_slug;
    n := 2;
    LOOP
      candidate := base || '-' || n;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM tenant_site WHERE subdomain_slug = candidate);
      n := n + 1;
    END LOOP;
    UPDATE tenant_site SET subdomain_slug = candidate WHERE tenant_id = r.tenant_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX tenant_site_subdomain_slug_uq
  ON tenant_site (subdomain_slug);

CREATE UNIQUE INDEX tenant_site_custom_domain_uq
  ON tenant_site (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

CREATE INDEX tenant_site_published_idx
  ON tenant_site (is_published)
  WHERE is_published;

-- ── 3. Strip site-identity columns from website_config ──────────

DROP INDEX IF EXISTS website_config_slug_idx;
DROP INDEX IF EXISTS website_config_published_idx;
DROP INDEX IF EXISTS website_config_custom_domain_idx;

ALTER TABLE website_config
  DROP CONSTRAINT IF EXISTS website_config_custom_domain_shape;

ALTER TABLE website_config
  DROP COLUMN IF EXISTS subdomain_slug,
  DROP COLUMN IF EXISTS custom_domain,
  DROP COLUMN IF EXISTS custom_domain_verified,
  DROP COLUMN IF EXISTS is_published,
  DROP COLUMN IF EXISTS meta_title,
  DROP COLUMN IF EXISTS meta_description;

-- og_image_url stays per-venue (so a location can override the brand OG
-- image with its own photo) but it falls back through tenant_site.

-- Rename home_blocks → page_blocks: this column now drives the per-venue
-- location page layout, NOT the tenant home page.
ALTER TABLE website_config RENAME COLUMN home_blocks TO page_blocks;

-- The venue location page is always "published" if its tenant site is —
-- there is no separate per-venue publish toggle. We keep an `is_active`
-- equivalent via venues.is_active.

-- ── 4. website_pages: tenant- vs venue-level ────────────────────
--
-- Custom CMS pages can now belong to either the tenant (visible in the
-- tenant home nav) or a specific venue (visible on /locations/{slug}).
-- We add `venue_id` (NULL = tenant-level) and drop the FK to
-- website_config, since website_config is now per-venue and we want
-- to allow tenant-level pages without forcing them into a venue's row.

ALTER TABLE website_pages
  ADD COLUMN venue_id uuid REFERENCES venues(id) ON DELETE CASCADE;

-- Backfill: every existing page belongs to exactly one website_config,
-- and website_config now has a venue_id, so map through.
UPDATE website_pages wp
   SET venue_id = wc.venue_id
  FROM website_config wc
 WHERE wc.id = wp.website_config_id;

-- Drop the website_config_id FK + column. Tenant-level pages cannot
-- have a config_id since there's only one tenant_site per tenant
-- and we've already captured everything we need on tenant_id alone.
ALTER TABLE website_pages
  DROP CONSTRAINT IF EXISTS website_pages_website_config_id_fkey,
  DROP CONSTRAINT IF EXISTS website_pages_website_config_id_slug_key;

DROP INDEX IF EXISTS website_pages_cfg_idx;

ALTER TABLE website_pages DROP COLUMN website_config_id;

-- Slug must be unique within (tenant_id, venue_id) where venue_id is
-- NULL for tenant-level pages — Postgres treats NULLs as distinct in
-- unique constraints by default, so we need a partial index pair.
CREATE UNIQUE INDEX website_pages_tenant_slug_uq
  ON website_pages (tenant_id, slug)
  WHERE venue_id IS NULL;

CREATE UNIQUE INDEX website_pages_venue_slug_uq
  ON website_pages (venue_id, slug)
  WHERE venue_id IS NOT NULL;

CREATE INDEX website_pages_tenant_venue_idx
  ON website_pages (tenant_id, venue_id, sort_order);

COMMIT;
