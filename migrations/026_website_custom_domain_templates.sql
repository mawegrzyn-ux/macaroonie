-- ============================================================
-- 026_website_custom_domain_templates.sql
--
-- Three website CMS extensions on top of 025:
--
--   1. custom_domain — tenants can map their own domain
--      (e.g. book.wingstop.co.uk) in addition to the default
--      {subdomain_slug}.macaroonie.com.  SSL is terminated at
--      Nginx; this column is just the lookup key for the SSR
--      renderer.
--
--   2. template_key — tenants pick a public-site template
--      (initial set: classic, modern).  More templates are
--      added by dropping a new views/site/templates/{key}/
--      directory in the API and appending to the CHECK.
--
--   3. theme — structured JSON for per-tenant theming
--      independent of the selected template.  Covers colours,
--      typography, spacing, radii — exposed to every template
--      as CSS custom properties so they all restyle together.
--      Existing columns `primary_colour`, `secondary_colour`
--      and `font_family` stay as the source-of-truth fallback
--      for backward compatibility; the theme object layers on
--      top with more granular controls.
-- ============================================================

ALTER TABLE website_config
  ADD COLUMN IF NOT EXISTS custom_domain text,
  ADD COLUMN IF NOT EXISTS custom_domain_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_key text NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Lowercased, globally unique, only for non-null values so multiple
-- tenants without a custom domain don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS website_config_custom_domain_idx
  ON website_config (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

-- Rudimentary hostname shape check — no uppercase, no spaces, has a dot.
ALTER TABLE website_config
  ADD CONSTRAINT website_config_custom_domain_shape
  CHECK (
    custom_domain IS NULL OR
    custom_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  );

ALTER TABLE website_config
  ADD CONSTRAINT website_config_template_key_check
  CHECK (template_key IN ('classic', 'modern'));

-- ── Canonical shape of the `theme` JSONB (applied by renderer defaults):
--
-- {
--   "colors": {
--     "primary":    "#630812",     // brand / CTA
--     "accent":     "#f4a7b9",     // secondary highlight
--     "background": "#ffffff",     // page bg
--     "surface":    "#f9f6f1",     // alt band bg
--     "text":       "#1a1a1a",     // body text
--     "muted":      "#666666",     // subdued text
--     "border":     "#e5e7eb"      // dividers
--   },
--   "typography": {
--     "heading_font": "Inter",     // Google font or CSS stack name
--     "body_font":    "Inter",
--     "base_size_px": 16,
--     "heading_scale":1.25,        // h2 = base * scale^2, etc.
--     "heading_weight": 700,
--     "body_weight":    400,
--     "line_height":    1.5,
--     "letter_spacing": "normal"
--   },
--   "spacing": {
--     "container_max_px": 1100,
--     "section_y_px":     72,      // top/bottom padding per block
--     "section_y_mobile_px": 48,
--     "gap_px":           24
--   },
--   "radii": {
--     "sm_px":  4,
--     "md_px":  8,
--     "lg_px": 16
--   },
--   "logo": {
--     "height_px": 36,
--     "show_name_beside": true
--   },
--   "buttons": {
--     "radius_px":   4,
--     "padding_y_px":12,
--     "padding_x_px":28,
--     "weight":      600
--   },
--   "hero": {
--     "overlay_opacity": 0.4,
--     "min_height_px":   520
--   }
-- }
--
-- Any field not present falls back to defaults hard-coded in the renderer.
