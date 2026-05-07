// src/services/siteDataSvc.js
//
// Public-site data loaders.
//
// The site is keyed at TENANT level — one site per master franchisee at
// {tenant_site.subdomain_slug}.{PUBLIC_ROOT_DOMAIN} or a verified custom
// domain. Each venue under the tenant becomes a /locations/{venue.slug}
// page driven by website_config + the venue row.
//
// Two loader entry points:
//   loadTenantBundle({ slug, customDomain }) → tenant home, locations
//     index, custom pages, sitemap. Includes a `venues` summary array.
//   loadLocationBundle(tenantBundle, venueSlug) → per-venue location
//     page (gallery, menus, hours, allergens, address, contact, etc.)
//
// Field inheritance (transparent to templates):
//   1. Hard-coded DEFAULTS                        (in shared/head.eta)
//   2. tenant_site                                (franchise identity)
//   3. website_config (when rendering a location) (per-venue overrides)

import { sql, withTenant } from '../config/db.js'

const BRAND_INHERITABLE = [
  'logo_url', 'favicon_url', 'primary_colour', 'secondary_colour',
  'font_family', 'template_key', 'og_image_url',
  'ga4_measurement_id', 'fb_pixel_id',
]

function deepMerge(base, layer) {
  if (!layer || typeof layer !== 'object') return base
  const out = { ...base }
  for (const [k, v] of Object.entries(layer)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v)
    } else if (v !== undefined && v !== null) {
      out[k] = v
    }
  }
  return out
}

// Merge a per-venue website_config OVER a tenant_site so renderers can read
// a single flat config object regardless of which view they're producing.
function mergeLocationConfig(tenantSite, venueConfig) {
  if (!venueConfig) return tenantSite
  const merged = { ...tenantSite }

  for (const key of BRAND_INHERITABLE) {
    if (venueConfig[key]) merged[key] = venueConfig[key]
  }

  merged.social_links = {
    ...(tenantSite.social_links || {}),
    ...(venueConfig.social_links || {}),
  }

  merged.theme = deepMerge(tenantSite.theme || {}, venueConfig.theme || {})

  // Per-location fields — these have no tenant-level fallback because they
  // are fundamentally per-location (address, hero photo of THIS venue, etc.)
  const PER_LOCATION = [
    'hero_image_url', 'hero_heading', 'hero_subheading', 'hero_cta_text', 'hero_cta_link',
    'about_heading', 'about_text', 'about_html', 'about_image_url',
    'address_line1', 'address_line2', 'city', 'postcode', 'country',
    'latitude', 'longitude', 'google_maps_embed_url',
    'phone', 'email',
    'online_ordering_links', 'delivery_links',
    'widget_venue_id', 'widget_theme',
    'show_booking_widget', 'show_menu', 'show_allergens', 'show_gallery',
    'gallery_style', 'gallery_size',
    'show_find_us', 'show_contact', 'show_ordering', 'show_delivery',
    'opening_hours_source',
    'page_blocks',
  ]
  for (const key of PER_LOCATION) {
    if (venueConfig[key] !== undefined && venueConfig[key] !== null) {
      merged[key] = venueConfig[key]
    }
  }

  return merged
}

/**
 * Resolve a tenant_site row by subdomain slug or custom domain.
 *
 * @param {object} lookup
 * @param {string} [lookup.slug]
 * @param {string} [lookup.customDomain]
 * @param {object} [opts]
 * @param {boolean} [opts.includeUnpublished]
 */
async function resolveTenantSite(lookup, { includeUnpublished = false } = {}) {
  const slug         = lookup?.slug
  const customDomain = lookup?.customDomain?.toLowerCase?.()
  if (!slug && !customDomain) return null

  let row
  if (customDomain) {
    [row] = await sql`
      SELECT ts.*, t.name AS tenant_name, t.slug AS tenant_slug
        FROM tenant_site ts
        JOIN tenants t ON t.id = ts.tenant_id AND t.is_active = true
       WHERE lower(ts.custom_domain) = ${customDomain}
         AND (${includeUnpublished} OR ts.custom_domain_verified = true)
       LIMIT 1
    `
  }
  if (!row && slug) {
    [row] = await sql`
      SELECT ts.*, t.name AS tenant_name, t.slug AS tenant_slug
        FROM tenant_site ts
        JOIN tenants t ON t.id = ts.tenant_id AND t.is_active = true
       WHERE ts.subdomain_slug = ${slug}
       LIMIT 1
    `
  }
  if (!row) return null
  if (!includeUnpublished && !row.is_published) return null
  return row
}

/**
 * Load the tenant-level public bundle: brand identity, home page blocks,
 * the locations summary, custom pages, and any tenant-wide menus pulled
 * up from venues. Does NOT include per-venue location-page details
 * (gallery, opening hours etc.) — those are loaded on-demand by
 * loadLocationBundle when rendering /locations/:slug.
 */
export async function loadTenantBundle(lookup, { includeUnpublished = false } = {}) {
  if (typeof lookup === 'string') lookup = { slug: lookup }
  const ts = await resolveTenantSite(lookup, { includeUnpublished })
  if (!ts) return null

  const bundle = await withTenant(ts.tenant_id, async tx => {
    const [venues, pages] = await Promise.all([
      tx`
        SELECT v.id, v.slug, v.name, v.timezone, v.currency,
               wc.address_line1, wc.address_line2, wc.city, wc.postcode,
               wc.phone, wc.email,
               wc.hero_image_url, wc.tagline AS venue_tagline
          FROM venues v
          LEFT JOIN website_config wc ON wc.venue_id = v.id
         WHERE v.tenant_id = ${ts.tenant_id} AND v.is_active = true
         ORDER BY v.name
      `,
      tx`
        SELECT id, slug, title, content, blocks, is_published, sort_order
          FROM website_pages
         WHERE tenant_id = ${ts.tenant_id}
           AND venue_id IS NULL
           AND (${includeUnpublished} OR is_published = true)
         ORDER BY sort_order, title
      `,
    ])

    return { venues, pages }
  })

  return {
    tenant_site: ts,
    config:      ts,            // alias: templates read `it.config`
    brand:       ts,            // alias: emergency banner reads `it.brand`
    tenant_name: ts.tenant_name,
    tenant_slug: ts.tenant_slug,
    venues:      bundle.venues,
    pages:       bundle.pages,
  }
}

/**
 * Load the per-venue location-page bundle: gallery, menus, opening
 * hours, allergens, plus the merged config object. Caller supplies the
 * already-resolved tenant bundle so we do not re-query tenant_site.
 *
 * @returns {Promise<object|null>} null when the venue does not exist,
 *   is inactive, or has no website_config row yet.
 */
export async function loadLocationBundle(tenantBundle, venueSlug, { includeUnpublished = false } = {}) {
  if (!tenantBundle || !venueSlug) return null
  const ts        = tenantBundle.tenant_site
  const tenantId  = ts.tenant_id

  const [venue] = await sql`
    SELECT id, slug, name, timezone, currency
      FROM venues
     WHERE tenant_id = ${tenantId}
       AND slug      = ${venueSlug}
       AND is_active = true
     LIMIT 1
  `
  if (!venue) return null

  const result = await withTenant(tenantId, async tx => {
    const [cfgRow] = await tx`
      SELECT * FROM website_config
       WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id}
       LIMIT 1
    `
    const venueConfig = cfgRow ?? {}

    const [gallery, menus, openingHours, allergensRow, pages] = await Promise.all([
      venueConfig.show_gallery !== false ? tx`
        SELECT id, image_url, caption, sort_order
          FROM website_gallery_images
         WHERE website_config_id = ${venueConfig.id ?? null}
         ORDER BY sort_order, created_at
      ` : Promise.resolve([]),

      venueConfig.show_menu !== false ? tx`
        SELECT id, label, file_url, sort_order
          FROM website_menu_documents
         WHERE website_config_id = ${venueConfig.id ?? null}
         ORDER BY sort_order, created_at
      ` : Promise.resolve([]),

      (venueConfig.show_find_us !== false && venueConfig.opening_hours_source !== 'venue') ? tx`
        SELECT day_of_week, opens_at, closes_at, is_closed, label, sort_order
          FROM website_opening_hours
         WHERE website_config_id = ${venueConfig.id ?? null}
         ORDER BY day_of_week, sort_order
      ` : Promise.resolve([]),

      venueConfig.show_allergens !== false ? tx`
        SELECT info_type, document_url, structured_data
          FROM website_allergen_info
         WHERE website_config_id = ${venueConfig.id ?? null}
         LIMIT 1
      ` : Promise.resolve([]),

      tx`
        SELECT id, slug, title, content, blocks, is_published, sort_order
          FROM website_pages
         WHERE tenant_id = ${tenantId}
           AND venue_id  = ${venue.id}
           AND (${includeUnpublished} OR is_published = true)
         ORDER BY sort_order, title
      `,
    ])

    let derivedHours = openingHours
    if (venueConfig.show_find_us !== false && venueConfig.opening_hours_source === 'venue') {
      const sittingRows = await tx`
        SELECT t.day_of_week, t.is_open,
               MIN(s.opens_at)  AS opens_at,
               MAX(s.closes_at) AS closes_at
          FROM venue_schedule_templates t
          LEFT JOIN venue_sittings s ON s.template_id = t.id
         WHERE t.venue_id = ${venue.id}
         GROUP BY t.day_of_week, t.is_open
         ORDER BY t.day_of_week
      `
      derivedHours = sittingRows.map(r => ({
        day_of_week: r.day_of_week,
        opens_at:    r.opens_at  ? r.opens_at.slice(0, 5)  : null,
        closes_at:   r.closes_at ? r.closes_at.slice(0, 5) : null,
        is_closed:   !r.is_open || !r.opens_at || !r.closes_at,
        label:       null,
        sort_order:  0,
      }))
    }

    return {
      mergedConfig:  mergeLocationConfig(ts, venueConfig),
      gallery,
      menus,
      openingHours:  derivedHours,
      allergens:     allergensRow[0] ?? null,
      pages,
    }
  })

  return {
    ...tenantBundle,
    config:        result.mergedConfig,
    venue:         { id: venue.id, slug: venue.slug, name: venue.name, timezone: venue.timezone, currency: venue.currency },
    gallery:       result.gallery,
    menus:         result.menus,
    opening_hours: result.openingHours,
    allergens:     result.allergens,
    location_pages: result.pages,
  }
}

// Back-compat alias: a few callers still import `loadSiteBundle`.
// The new architecture has no equivalent of "the site for this slug" since
// /locations/:slug is what actually corresponds to a venue. We keep the
// export as the tenant bundle so old imports don't 500.
export const loadSiteBundle = loadTenantBundle
