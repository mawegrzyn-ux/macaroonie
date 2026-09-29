// src/services/orderPage.js
//
// The built-in online ordering page (migration 126): a tenant-level
// website_pages row with system_key 'order'. The operator designs it in
// Website -> Pages & modals like any other page; it holds the
// "Online ordering" block (views/site/blocks/online_ordering.eta).
// /order and /locations/:slug/order render it (routes/siteRenderer.js).

import { randomUUID } from 'node:crypto'

export const ORDER_PAGE_KEY = 'order'

export function defaultOrderBlocks() {
  return [{
    id: 'order-' + randomUUID().slice(0, 8),
    type: 'online_ordering',
    data: { heading: '', hide_title: false, venue_id: null },
  }]
}

// Used when a published site has no ordering page in its snapshot yet
// (published before migration 126): same content as a fresh page.
export const DEFAULT_ORDER_PAGE = Object.freeze({
  slug: 'order',
  title: 'Order online',
  kind: 'page',
  system_key: ORDER_PAGE_KEY,
  blocks: [{ id: 'order-default', type: 'online_ordering', data: {} }],
})

/** Creates the tenant's ordering page if it doesn't exist. Call inside withTenant(). */
export async function ensureOrderPage(tx, tenantId) {
  const [existing] = await tx`
    SELECT id FROM website_pages WHERE tenant_id = ${tenantId} AND system_key = ${ORDER_PAGE_KEY}
  `
  if (existing) return
  const [taken] = await tx`
    SELECT 1 FROM website_pages WHERE tenant_id = ${tenantId} AND venue_id IS NULL AND slug = 'order'
  `
  await tx`
    INSERT INTO website_pages
      (tenant_id, venue_id, slug, title, blocks, kind, is_published, sort_order, system_key)
    VALUES
      (${tenantId}, NULL, ${taken ? 'order-online' : 'order'}, 'Order online',
       ${tx.json(defaultOrderBlocks())}, 'page', true, 1000, ${ORDER_PAGE_KEY})
    ON CONFLICT DO NOTHING
  `
}
