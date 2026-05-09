-- 050_tenant_widget_settings.sql
--
-- Tenant-level booking widget defaults. Single JSONB column so we can
-- iterate on the field set without future migrations. Per-block overrides
-- on `booking_widget` blocks live inside the block's existing `data` JSONB
-- (same shape, different scope) — no schema change there.
--
-- Field reference (all optional; defaults applied at render time):
--   header_show          boolean   show the "Brand · Book a table" header
--   header_text          string    override site_name in the widget header
--   subheader_text       string    override "Book a table" sub-line
--   button_bg            hex       override the accent / primary colour
--   button_fg            hex       button text colour (default #fff)
--   button_radius_px     int       button corner radius
--   card_radius_px       int       outer card + chip corner radius
--   border_colour        hex       override border colour
--   font_family          string    override tenant font for the widget
--   large_party_text     string    the "Larger party? Call us…" message

ALTER TABLE tenant_site
  ADD COLUMN IF NOT EXISTS widget_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
