// src/services/siteDataSvc.js
//
// Loads the complete public-site data bundle for a venue's website.
// Used by both the JSON API (/api/site/:slug) and the SSR renderer.
//
// Two possible lookup keys:
//   - subdomain slug   → {slug}.{PUBLIC_ROOT_DOMAIN}
//   - custom domain    → any verified custom hostname
//
// Field inheritance (resolved here, transparent to templates):
//   1. Hard-coded DEFAULTS (see shared/head.eta)
//   2. tenant_brand_defaults  (franchise brand identity)
//   3. website_config          (per-venue overrides)
//
// The merge happens for: logo, favicon, primary_colour,
// secondary_colour, font_family, template_key, theme, social_links,
// og_image_url, ga4_measurement_id, fb_pixel_id.  The SSR templates
// only see the merged config — they have no concept of "brand vs venue".

import { sql, withTenant } from '../config/db.js'

// Fields that inherit from tenant_brand_defaults → venue override.
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

function mergeConfig(venueConfig, brandDefaults) {
  if (!brandDefaults) return venueConfig

  const merged = { ...venueConfig }

  // Scalar fields: venue wins if set, otherwise brand default
  for (const key of BRAND_INHERITABLE) {
    if (!merged[key] && brandDefaults[key]) {
      merged[key] = brandDefaults[key]
    }
  }

  // social_links: deep-merge (venue-specific socials overlay brand socials)
  merged.social_links = {
    ...(brandDefaults.social_links || {}),
    ...(venueConfig.social_links || {}),
  }

  // theme JSONB: deep-merge brand → venue overrides
  const brandTheme = brandDefaults.theme || {}
  const venueTheme = venueConfig.theme   || {}
  merged.theme = deepMerge(brandTheme, venueTheme)

  // site_name: auto-combine brand_name + venue name if not explicitly set
  if (!merged.site_name && brandDefaults.brand_name) {
    merged.site_name = brandDefaults.brand_name
  }

  return merged
}

/**
 * Load the full public site bundle.
 *
 * @param {object} lookup
 * @param {string} [lookup.slug]          - subdomain slug
 * @param {string} [lookup.customDomain]  - full custom hostname
 * @param {object} [opts]
 * @param {boolean} [opts.includeUnpublished] - admin preview (default false)
 * @returns {Promise<object|null>}
 */
export async function loadSiteBundle(lookup, { includeUnpublished = false } = {}) {
  if (typeof lookup === 'string') lookup = { slug: lookup }
  const slug         = lookup?.slug
  const customDomain = lookup?.customDomain?.toLowerCase?.()

  if (!slug && !customDomain) return null

  // 1. Global lookup — no RLS
  let cfg
  if (customDomain) {
    [cfg] = await sql`
      SELECT wc.*, t.name AS tenant_name, v.name AS venue_name, v.slug AS venue_slug
        FROM website_config wc
        JOIN tenants t ON t.id = wc.tenant_id AND t.is_active = true
        JOIN venues  v ON v.id = wc.venue_id  AND v.is_active = true
       WHERE lower(wc.custom_domain) = ${customDomain}
         AND (${includeUnpublished} OR wc.custom_domain_verified = true)
       LIMIT 1
    `
  }
  if (!cfg && slug) {
    [cfg] = await sql`
      SELECT wc.*, t.name AS tenant_name, v.name AS venue_name, v.slug AS venue_slug
        FROM website_config wc
        JOIN tenants t ON t.id = wc.tenant_id AND t.is_active = true
        JOIN venues  v ON v.id = wc.venue_id  AND v.is_active = true
       WHERE wc.subdomain_slug = ${slug}
       LIMIT 1
    `
  }
  if (!cfg) return null
  if (!includeUnpublished && !cfg.is_published) return null

  // 2. Load brand defaults + tenant-scoped data
  const bundle = await withTenant(cfg.tenant_id, async tx => {
    const [brandRows, gallery, pages, menus, openingHours, allergensRow] = await Promise.all([
      tx`SELECT * FROM tenant_brand_defaults WHERE tenant_id = ${cfg.tenant_id} LIMIT 1`,

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

      // Manual opening hours come from website_opening_hours.
      // Venue-derived hours are computed below from venue_schedule_templates + venue_sittings.
      (cfg.show_find_us && cfg.opening_hours_source !== 'venue') ? tx`
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
    ])

    const brandDefaults = brandRows[0] ?? null
    const mergedConfig  = mergeConfig(cfg, brandDefaults)

    // When source = 'venue', derive weekly opening hours from venue's
    // schedule template: earliest opens_at + latest closes_at per day.
    let derivedHours = openingHours
    if (cfg.show_find_us && cfg.opening_hours_source === 'venue') {
      const sittingRows = await tx`
        SELECT t.day_of_week, t.is_open,
               MIN(s.opens_at)  AS opens_at,
               MAX(s.closes_at) AS closes_at
          FROM venue_schedule_templates t
          LEFT JOIN venue_sittings s ON s.template_id = t.id
         WHERE t.venue_id = ${cfg.venue_id}
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
      config:         mergedConfig,
      brand:          brandDefaults,
      gallery,
      pages,
      menus,
      opening_hours:  derivedHours,
      allergens:      allergensRow[0] ?? null,
      venue:          { id: cfg.venue_id, name: cfg.venue_name, slug: cfg.venue_slug },
    }
  })

  return bundle
}
