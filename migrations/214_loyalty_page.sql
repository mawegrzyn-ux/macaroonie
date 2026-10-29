-- ============================================================
-- 214_loyalty_page.sql
--
-- A built-in Loyalty page, like Order online (migration 126): a tenant-level
-- website page the operator designs in Website -> Pages & modals, at
-- /loyalty, holding the new "Loyalty card" block (the guest's card: join or
-- sign in, QR code, points, stamps, rewards, history). /loyalty used to be
-- the loyalty web app itself; that app stays at loyalty.<domain>/<slug>.
--
--   website_pages.system_key   now 'order' | 'loyalty'. One of each per
--                              tenant, tenant-level only; can't be deleted,
--                              unpublished, moved or made a modal.
--
-- Seeds the page for every tenant that has a website. New sites get it from
-- ensureTenantSite() (services/systemPages.js).
-- ============================================================

ALTER TABLE website_pages DROP CONSTRAINT IF EXISTS website_pages_system_key_check;
ALTER TABLE website_pages
  ADD CONSTRAINT website_pages_system_key_check CHECK (system_key IN ('order', 'loyalty'));

INSERT INTO website_pages
  (tenant_id, venue_id, slug, title, content, blocks, kind, is_published, sort_order, system_key)
SELECT ts.tenant_id, NULL,
       CASE WHEN EXISTS (SELECT 1 FROM website_pages p
                          WHERE p.tenant_id = ts.tenant_id AND p.venue_id IS NULL AND p.slug = 'loyalty')
            THEN 'loyalty-card' ELSE 'loyalty' END,
       'Loyalty', NULL,
       jsonb_build_array(jsonb_build_object(
         'id', 'loyalty-' || substr(md5(ts.tenant_id::text), 1, 8),
         'type', 'loyalty_card',
         'data', '{}'::jsonb)),
       'page', true, 1001, 'loyalty'
  FROM tenant_site ts
 WHERE NOT EXISTS (SELECT 1 FROM website_pages p
                    WHERE p.tenant_id = ts.tenant_id AND p.system_key = 'loyalty');
