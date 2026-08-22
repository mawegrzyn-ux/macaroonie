-- ============================================================
-- 074_bimi_svg.sql
--
-- Tenant BIMI logo (SVG Tiny 1.2) served at GET /bimi.svg on the
-- public site. Inbox avatars in Yahoo / Fastmail / (Gmail+Apple with a
-- VMC) read this URL from a DNS TXT record on the From domain.
-- ============================================================

BEGIN;

ALTER TABLE tenant_site
  ADD COLUMN IF NOT EXISTS bimi_svg text;

COMMIT;
