-- ============================================================
-- 044_onethai_template.sql
--
-- Adds 'onethai' to the allowed template_key values on tenant_site
-- and website_config. The shipping templates are now: classic, modern, onethai.
--
-- 'onethai' is a Thai-restaurant-themed template inspired by the One Thai
-- Cafe (Ware) site brief. Burgundy + cream palette, Fraunces serif headlines
-- + Caveat script accents, decorative herb/spice icons, dotted dividers,
-- vine motifs, scrolling-dish ticker.
-- ============================================================

BEGIN;

-- tenant_site (added in 027 → renamed in 043)
ALTER TABLE tenant_site
  DROP CONSTRAINT IF EXISTS tenant_brand_defaults_template_key_check,
  DROP CONSTRAINT IF EXISTS tenant_site_template_key_check;

ALTER TABLE tenant_site
  ADD CONSTRAINT tenant_site_template_key_check
  CHECK (template_key IN ('classic', 'modern', 'onethai'));

-- website_config (added in 026)
ALTER TABLE website_config
  DROP CONSTRAINT IF EXISTS website_config_template_key_check;

ALTER TABLE website_config
  ADD CONSTRAINT website_config_template_key_check
  CHECK (template_key IN ('classic', 'modern', 'onethai'));

COMMIT;
