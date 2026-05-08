-- ============================================================
-- 047_blocks_first_drop_legacy.sql
--
-- Header & footer are now first-class block types in the page builder.
-- The form-based editor on tenant_site is gone, so the columns it wrote
-- to can go too.
--
-- Pre-prod, no fallback path needed: per CLAUDE.md we drop columns
-- outright. Operators rebuild via the new block editor on first visit.
-- ============================================================

BEGIN;

ALTER TABLE tenant_site
  DROP COLUMN IF EXISTS header_cta,
  DROP COLUMN IF EXISTS nav_extra_links,
  DROP COLUMN IF EXISTS footer_columns,
  DROP COLUMN IF EXISTS footer_copyright;

COMMIT;
