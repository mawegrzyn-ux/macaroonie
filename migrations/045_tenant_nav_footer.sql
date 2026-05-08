-- ============================================================
-- 045_tenant_nav_footer.sql
--
-- Editable header CTA + nav links + footer columns at tenant level.
-- Header & footer Eta partials read these and render them alongside
-- the auto-derived entries (Locations link, custom pages, social
-- icons). Empty / null = render only auto-derived defaults.
--
-- Shapes:
--   header_cta:     { text, url }                        (override the default "Book a Table" CTA)
--   nav_extra_links: [{ label, url }]                    (extra nav entries shown after the auto ones)
--   footer_columns: [{ title, items: [{ label, url }] }] (each = one footer column)
--   footer_copyright: text (overrides the default © {year} {brand})
-- ============================================================

BEGIN;

ALTER TABLE tenant_site
  ADD COLUMN IF NOT EXISTS header_cta        jsonb,
  ADD COLUMN IF NOT EXISTS nav_extra_links   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS footer_columns    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS footer_copyright  text;

COMMIT;
