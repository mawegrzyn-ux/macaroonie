// src/services/systemPages.js
//
// The website's built-in pages (website_pages.system_key, shared/sitePages.js):
// tenant-level pages the operator designs in Website -> Pages & modals like
// any other, at a fixed address.
//   order    (migration 126)  /order and /locations/:slug/order, holding the
//                             "Online ordering" block (blocks/online_ordering.eta)
//   loyalty  (migration 214)  /loyalty, holding the "Loyalty card" block
//                             (blocks/loyalty_card.eta)
// routes/siteRenderer.js renders them; a published site whose snapshot has
// no such page yet uses the DEFAULT_* copy until it is published again.

import { randomUUID } from 'node:crypto'

export const ORDER_PAGE_KEY = 'order'
export const LOYALTY_PAGE_KEY = 'loyalty'

export function defaultOrderBlocks() {
  return [{
    id: 'order-' + randomUUID().slice(0, 8),
    type: 'online_ordering',
    data: { heading: '', hide_title: false, venue_id: null },
  }]
}

export function defaultLoyaltyBlocks() {
  return [{
    id: 'loyalty-' + randomUUID().slice(0, 8),
    type: 'loyalty_card',
    data: {},
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

// The same for the loyalty page (published before migration 214).
export const DEFAULT_LOYALTY_PAGE = Object.freeze({
  slug: 'loyalty',
  title: 'Loyalty',
  kind: 'page',
  system_key: LOYALTY_PAGE_KEY,
  blocks: [{ id: 'loyalty-default', type: 'loyalty_card', data: {} }],
})

async function ensurePage(tx, tenantId, { key, slug, altSlug, title, blocks, sortOrder }) {
  const [existing] = await tx`
    SELECT id FROM website_pages WHERE tenant_id = ${tenantId} AND system_key = ${key}
  `
  if (existing) return
  const [taken] = await tx`
    SELECT 1 FROM website_pages WHERE tenant_id = ${tenantId} AND venue_id IS NULL AND slug = ${slug}
  `
  await tx`
    INSERT INTO website_pages
      (tenant_id, venue_id, slug, title, blocks, kind, is_published, sort_order, system_key)
    VALUES
      (${tenantId}, NULL, ${taken ? altSlug : slug}, ${title},
       ${tx.json(blocks)}, 'page', true, ${sortOrder}, ${key})
    ON CONFLICT DO NOTHING
  `
}

/** Creates the tenant's ordering page if it doesn't exist. Call inside withTenant(). */
export function ensureOrderPage(tx, tenantId) {
  return ensurePage(tx, tenantId, { key: ORDER_PAGE_KEY, slug: 'order', altSlug: 'order-online', title: 'Order online', blocks: defaultOrderBlocks(), sortOrder: 1000 })
}

/** Creates the tenant's loyalty page if it doesn't exist. Call inside withTenant(). */
export function ensureLoyaltyPage(tx, tenantId) {
  return ensurePage(tx, tenantId, { key: LOYALTY_PAGE_KEY, slug: 'loyalty', altSlug: 'loyalty-card', title: 'Loyalty', blocks: defaultLoyaltyBlocks(), sortOrder: 1001 })
}

/** Every built-in page. Call inside withTenant(). */
export async function ensureSystemPages(tx, tenantId) {
  await ensureOrderPage(tx, tenantId)
  await ensureLoyaltyPage(tx, tenantId)
}
