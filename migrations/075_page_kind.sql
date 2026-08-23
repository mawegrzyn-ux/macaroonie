-- ============================================================
-- 075_page_kind.sql
--
-- Custom pages can be a full standalone URL (/p/{slug}) or a
-- modal overlay opened via #modal/{slug}. Default is 'page' so
-- existing legal / custom pages stay as they are.
-- ============================================================

BEGIN;

ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'page';

ALTER TABLE website_pages
  DROP CONSTRAINT IF EXISTS website_pages_kind_check;

ALTER TABLE website_pages
  ADD CONSTRAINT website_pages_kind_check
  CHECK (kind IN ('page', 'modal'));

COMMIT;
