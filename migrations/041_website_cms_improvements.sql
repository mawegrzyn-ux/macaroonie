-- ============================================================
-- 041_website_cms_improvements.sql
--
-- Round of CMS upgrades:
--   1. about_html — rich HTML for the About section (TipTap output).
--      The legacy `about_text` plain-text column stays so existing data
--      keeps rendering; the renderer prefers about_html when set.
--
--   2. gallery_style — grid | pinterest | horizontal. Templates render
--      the gallery layout based on this value.
--
--   3. gallery_size — small | medium | large. Thumbnail size for the
--      grid/pinterest layouts.
--
--   4. opening_hours_source — manual | venue. When 'venue', the SSR
--      renderer derives weekly opening hours from the venue's sittings
--      template instead of website_opening_hours rows.
-- ============================================================

BEGIN;

ALTER TABLE website_config
  ADD COLUMN IF NOT EXISTS about_html             text,
  ADD COLUMN IF NOT EXISTS gallery_style          text NOT NULL DEFAULT 'grid'
                            CHECK (gallery_style IN ('grid', 'pinterest', 'horizontal')),
  ADD COLUMN IF NOT EXISTS gallery_size           text NOT NULL DEFAULT 'medium'
                            CHECK (gallery_size IN ('small', 'medium', 'large')),
  ADD COLUMN IF NOT EXISTS opening_hours_source   text NOT NULL DEFAULT 'manual'
                            CHECK (opening_hours_source IN ('manual', 'venue'));

COMMIT;
