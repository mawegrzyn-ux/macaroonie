-- ============================================================
-- 098_venue_brand_override.sql
--
-- Replaces the old sparse per-field brand/theme "inheritance" (a venue's
-- website_config.logo_url etc silently overriding tenant_site's value
-- whenever non-null, with a defensive hack forcing tenant colours/
-- typography to always win regardless — see brandTheme.js, now deleted)
-- with one explicit boolean: use_brand_override.
--
-- false (default) — this venue's brand/theme fields are ignored entirely;
--   the tenant's Brand & theme applies as-is. This is the common case and
--   the only state for single-venue tenants.
-- true — this venue has its own complete brand/theme, seeded from the
--   tenant default at the point the admin added the override (see
--   BrandSection.jsx "Add site override").
-- ============================================================

BEGIN;

ALTER TABLE website_config
  ADD COLUMN IF NOT EXISTS use_brand_override boolean NOT NULL DEFAULT false;

COMMIT;
