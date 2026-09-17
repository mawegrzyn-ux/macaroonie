-- 079_shared_header_footer.sql
--
-- Header and footer move from "a block you add to every page's own
-- blocks array" to "one shared tenant-wide definition, with optional
-- per-page override or per-page off switch":
--
--   1. tenant_site.header_config / footer_config — the shared default,
--      configured once (new dedicated admin sections, same data shape
--      as the header/footer block's own `data`).
--   2. A page can still override the shared header/footer just for
--      itself by adding its own header/footer block to its blocks
--      array (home_blocks / page_blocks / website_pages.blocks) — that
--      already works today and needs no schema change.
--   3. A page can turn header/footer off entirely via the new
--      show_header / show_footer flags below, regardless of whether
--      the shared default exists or the page has its own override
--      block.
--
-- Defaults are all "on" so no existing page's rendered chrome changes
-- until an operator explicitly turns one off.

BEGIN;

ALTER TABLE tenant_site
  ADD COLUMN IF NOT EXISTS header_config     jsonb,
  ADD COLUMN IF NOT EXISTS footer_config     jsonb,
  ADD COLUMN IF NOT EXISTS home_show_header  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS home_show_footer  boolean NOT NULL DEFAULT true;

ALTER TABLE website_config
  ADD COLUMN IF NOT EXISTS show_header boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_footer boolean NOT NULL DEFAULT true;

ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS show_header boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_footer boolean NOT NULL DEFAULT true;

COMMIT;
