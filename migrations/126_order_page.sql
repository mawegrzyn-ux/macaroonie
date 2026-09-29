-- ============================================================
-- 126_order_page.sql
--
-- The online ordering page becomes a normal website page the operator
-- can design in Website -> Pages & modals, holding the new
-- "Online ordering" block (menu, basket, checkout) with any other blocks
-- around it. /order and /locations/:slug/order render this page.
--
--   website_pages.system_key   'order' marks the built-in ordering page.
--                              One per tenant, tenant-level only. It can't
--                              be deleted, unpublished, renamed to another
--                              slug or turned into a modal (API guards).
--
-- Seeds the page for every tenant that already has a website. New tenants
-- get it from ensureTenantSite() (services/orderPage.js).
-- ============================================================

ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS system_key text CHECK (system_key IN ('order'));

CREATE UNIQUE INDEX IF NOT EXISTS website_pages_system_key_uq
  ON website_pages (tenant_id, system_key)
  WHERE system_key IS NOT NULL;

INSERT INTO website_pages
  (tenant_id, venue_id, slug, title, content, blocks, kind, is_published, sort_order, system_key)
SELECT ts.tenant_id, NULL,
       CASE WHEN EXISTS (SELECT 1 FROM website_pages p
                          WHERE p.tenant_id = ts.tenant_id AND p.venue_id IS NULL AND p.slug = 'order')
            THEN 'order-online' ELSE 'order' END,
       'Order online', NULL,
       jsonb_build_array(jsonb_build_object(
         'id', 'order-' || substr(md5(ts.tenant_id::text), 1, 8),
         'type', 'online_ordering',
         'data', jsonb_build_object('heading', '', 'hide_title', false, 'venue_id', NULL))),
       'page', true, 1000, 'order'
  FROM tenant_site ts
 WHERE NOT EXISTS (SELECT 1 FROM website_pages p
                    WHERE p.tenant_id = ts.tenant_id AND p.system_key = 'order');
