-- ============================================================
-- 046_legal_pages_cookies.sql
--
-- Cookie consent banner config + a flag on website_pages so legal pages
-- (Terms, Privacy, Cookies) can be identified separately from regular
-- custom pages — the cookie banner links to whichever page has the
-- `cookies_policy` slug, and the footer auto-shows links to all legal
-- pages.
-- ============================================================

BEGIN;

ALTER TABLE tenant_site
  ADD COLUMN IF NOT EXISTS cookies_banner_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cookies_banner_text       text,
  ADD COLUMN IF NOT EXISTS cookies_banner_accept_text text NOT NULL DEFAULT 'Accept',
  ADD COLUMN IF NOT EXISTS cookies_banner_decline_text text;

-- Mark legal pages so the renderer + footer can group them. Reserved
-- slugs ('terms', 'privacy', 'cookies') get this flag automatically when
-- generated via /website/legal-pages, but operators can also flip the
-- flag on any custom page if they prefer their own slug.
ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS is_legal boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS website_pages_is_legal_idx
  ON website_pages (tenant_id, is_legal)
  WHERE is_legal = true;

COMMIT;
