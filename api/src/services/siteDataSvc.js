// src/services/siteDataSvc.js
//
// Loads the complete public-site data bundle for a given subdomain slug.
// Used by both the JSON API (/api/site/:slug) and the SSR renderer.
//
// Lookup flow:
//   1. Resolve subdomain_slug → website_config + tenant_id (no RLS — global lookup)
//   2. Return null if not found or is_published = false
//   3. Fetch tenant-scoped data (gallery, pages, menus, hours, allergens, venue)
//      inside withTenant(tenant_id, ...) so RLS fires correctly.

import { sql, withTenant } from '../config/db.js'

/**
 * Load the full public site bundle.
 * @param {string} slug - subdomain slug
 * @param {object} opts
 * @param {boolean} opts.includeUnpublished - admin preview (defaults to false)
 * @returns {Promise<object|null>}
 */
export async function loadSiteBundle(slug, { includeUnpublished = false } = {}) {
  if (!slug || typeof slug !== 'string') return null

  // 1. Global lookup — no RLS
  const [cfg] = await sql`
    SELECT wc.*, t.name AS tenant_name, t.id AS t_tenant_id
      FROM website_config wc
      JOIN tenants t ON t.id = wc.tenant_id AND t.is_active = true
     WHERE wc.subdomain_slug = ${slug}
     LIMIT 1
  `
  if (!cfg) return null
  if (!includeUnpublished && !cfg.is_published) return null

  // 2. Tenant-scoped data
  const bundle = await withTenant(cfg.tenant_id, async tx => {
    const [gallery, pages, menus, openingHours, allergensRow, venue] = await Promise.all([
      cfg.show_gallery ? tx`
        SELECT id, image_url, caption, sort_order
          FROM website_gallery_images
         WHERE website_config_id = ${cfg.id}
         ORDER BY sort_order, created_at
      ` : Promise.resolve([]),

      tx`
        SELECT id, slug, title, content, is_published, sort_order
          FROM website_pages
         WHERE website_config_id = ${cfg.id}
           AND (${includeUnpublished} OR is_published = true)
         ORDER BY sort_order, title
      `,

      cfg.show_menu ? tx`
        SELECT id, label, file_url, sort_order
          FROM website_menu_documents
         WHERE website_config_id = ${cfg.id}
         ORDER BY sort_order, created_at
      ` : Promise.resolve([]),

      cfg.show_find_us ? tx`
        SELECT day_of_week, opens_at, closes_at, is_closed, label, sort_order
          FROM website_opening_hours
         WHERE website_config_id = ${cfg.id}
         ORDER BY day_of_week, sort_order
      ` : Promise.resolve([]),

      cfg.show_allergens ? tx`
        SELECT info_type, document_url, structured_data
          FROM website_allergen_info
         WHERE website_config_id = ${cfg.id}
         LIMIT 1
      ` : Promise.resolve([]),

      cfg.widget_venue_id ? tx`
        SELECT id, name, slug, timezone, currency
          FROM venues
         WHERE id = ${cfg.widget_venue_id}
           AND tenant_id = ${cfg.tenant_id}
           AND is_active = true
         LIMIT 1
      ` : Promise.resolve([]),
    ])

    return {
      gallery,
      pages,
      menus,
      opening_hours: openingHours,
      allergens: allergensRow[0] ?? null,
      venue: venue[0] ?? null,
    }
  })

  return {
    config:        cfg,
    gallery:       bundle.gallery,
    pages:         bundle.pages,
    menus:         bundle.menus,
    opening_hours: bundle.opening_hours,
    allergens:     bundle.allergens,
    venue:         bundle.venue,
  }
}
