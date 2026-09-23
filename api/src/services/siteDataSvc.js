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
//     When the tenant has exactly one active venue, the home bundle is
//     also hydrated with that venue's hours / address / PDF menus /
//     allergens so data blocks on `/` render without a location page.
//   loadLocationBundle(tenantBundle, venueSlug) → per-venue location
//     page (gallery, menus, hours, allergens, address, contact, etc.)
//
// Field inheritance (transparent to templates):
//   1. Hard-coded DEFAULTS                        (in shared/head.eta)
//   2. tenant_site                                (franchise identity)
//   3. website_config (when rendering a location, or the sole venue on home)

import { sql, withTenant } from '../config/db.js'
import { attachVariantGroupsToItems } from '../routes/menus.js'
import { mergeThemes } from './brandTheme.js'

const BRAND_INHERITABLE = [
  'logo_url', 'favicon_url', 'primary_colour', 'secondary_colour',
  'font_family', 'template_key', 'og_image_url',
  'ga4_measurement_id', 'fb_pixel_id',
]

export function soleVenueOf(venues) {
  return Array.isArray(venues) && venues.length === 1 ? venues[0] : null
}

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

 merged.theme = mergeThemes(tenantSite.theme, venueConfig.theme)
  if (tenantSite.template_key) merged.template_key = tenantSite.template_key
  if (tenantSite.font_family)  merged.font_family  = tenantSite.font_family

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
    'show_header', 'show_footer',
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

function toHhmm(t) {
  if (t == null) return null
  return String(t).slice(0, 5)
}

/** Weekly hours from the venue sitting schedule — one row per sitting. */
async function loadHoursFromSchedule(tx, venueId) {
  if (!venueId) return []
  const sittingRows = await tx`
    SELECT t.day_of_week, t.is_open,
           s.opens_at, s.closes_at, s.name, s.sort_order
      FROM venue_schedule_templates t
      LEFT JOIN venue_sittings s ON s.template_id = t.id
     WHERE t.venue_id = ${venueId}
     ORDER BY t.day_of_week, s.sort_order, s.opens_at
  `
  return sittingRows.map(r => ({
    day_of_week: Number(r.day_of_week),
    opens_at:    toHhmm(r.opens_at),
    closes_at:   toHhmm(r.closes_at),
    is_closed:   !r.is_open || !r.opens_at || !r.closes_at,
    label:       r.name || null,
    sort_order:  r.sort_order ?? 0,
  }))
}

/** Manual hours rows, or derived from the venue sitting schedule. */
export async function loadOpeningHours(tx, venueId, venueConfig) {
  if (venueConfig?.opening_hours_source === 'manual' && venueConfig?.id) {
    const rows = await tx`
      SELECT day_of_week, opens_at, closes_at, is_closed, label, sort_order
        FROM website_opening_hours
       WHERE website_config_id = ${venueConfig.id}
       ORDER BY day_of_week, sort_order
    `
    return rows.map(r => ({
      day_of_week: Number(r.day_of_week),
      opens_at:    toHhmm(r.opens_at),
      closes_at:   toHhmm(r.closes_at),
      is_closed:   !!r.is_closed,
      label:       r.label || null,
      sort_order:  r.sort_order ?? 0,
    }))
  }
  return loadHoursFromSchedule(tx, venueId)
}


/**
 * Per-venue public extras (hours, PDF menus, allergens, address config).
 * Used by location pages and by the sole-venue home hydration.
 *
 * `venueConfigOverride` / `pagesOverride` let the production (published
 * snapshot) render path supply frozen config/pages instead of the live
 * rows, while gallery images, menu PDF documents, allergen info, and
 * schedule-derived hours keep resolving live either way — those have
 * their own separate publish/moderation state and are intentionally
 * NOT part of the site snapshot (see migration 082's header comment).
 * The frozen config still carries the real website_config row id so
 * those live joins (keyed by website_config_id) keep working.
 */
async function loadVenuePublicExtras(tx, tenantId, venue, {
  includePages = false, includeUnpublished = false,
  venueConfigOverride = null, pagesOverride = null,
} = {}) {
  let venueConfig
  if (venueConfigOverride) {
    venueConfig = venueConfigOverride
  } else {
    const [cfgRow] = await tx`
      SELECT * FROM website_config
       WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id}
       LIMIT 1
    `
    venueConfig = cfgRow ?? {}
  }

  const [gallery, menus, openingHours, allergensRow, pages] = await Promise.all([
    venueConfig.show_gallery !== false && venueConfig.id ? tx`
      SELECT id, image_url, caption, sort_order
        FROM website_gallery_images
       WHERE website_config_id = ${venueConfig.id}
       ORDER BY sort_order, created_at
    ` : Promise.resolve([]),

    venueConfig.show_menu !== false && venueConfig.id ? tx`
      SELECT id, label, file_url, sort_order
        FROM website_menu_documents
       WHERE website_config_id = ${venueConfig.id}
       ORDER BY sort_order, created_at
    ` : Promise.resolve([]),

    loadOpeningHours(tx, venue.id, venueConfig),

    venueConfig.show_allergens !== false && venueConfig.id ? tx`
      SELECT info_type, document_url, structured_data
        FROM website_allergen_info
       WHERE website_config_id = ${venueConfig.id}
       LIMIT 1
    ` : Promise.resolve([]),

    !includePages ? Promise.resolve([])
      : pagesOverride !== null ? Promise.resolve(pagesOverride)
      : tx`
      SELECT id, slug, title, content, blocks, kind, is_published, sort_order, show_header, show_footer
        FROM website_pages
       WHERE tenant_id = ${tenantId}
         AND venue_id  = ${venue.id}
         AND (${includeUnpublished} OR is_published = true)
       ORDER BY sort_order, title
    `,
  ])

  return {
    venueConfig,
    gallery,
    menus,
    openingHours,
    allergens: allergensRow[0] ?? null,
    pages,
  }
}

/**
 * Load the tenant-level public bundle: brand identity, home page blocks,
 * the locations summary, custom pages, and any tenant-wide menus pulled
 * up from venues.
 *
 * Two render sources, chosen by `lookup.isStaging`:
 *   - staging (`staging-{slug}.{root}`) → always the live, current draft
 *     tables, regardless of is_published. Custom domains never resolve
 *     to staging — only the wildcard subdomain does.
 *   - production (plain subdomain or verified custom domain) → the
 *     frozen `published_snapshot` captured by the last Publish action.
 *     Returns null (404) if the site has never been published.
 *
 * Single-venue tenants: also merge that venue's website_config (address,
 * phone, hours source) and attach opening_hours / menus / allergens so
 * data blocks on the home page have something to render. Multi-venue
 * homes stay brand-only — location details live on /locations/:slug.
 */
export async function loadTenantBundle(lookup, { includeUnpublished = false } = {}) {
  if (typeof lookup === 'string') lookup = { slug: lookup }
  const isStaging = !!lookup.isStaging

  if (isStaging) {
    const ts = await resolveTenantSite({ slug: lookup.slug }, { includeUnpublished: true })
    if (!ts) return null
    return buildLiveTenantBundle(ts, { includeUnpublished: true, isStaging: true })
  }

  const ts = await resolveTenantSite(lookup, { includeUnpublished })
  if (!ts) return null
  if (includeUnpublished) return buildLiveTenantBundle(ts, { includeUnpublished, isStaging: false })
  if (!ts.published_snapshot) return null
  return buildPublishedTenantBundle(ts)
}

async function buildLiveTenantBundle(ts, { includeUnpublished, isStaging }) {
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
        SELECT id, slug, title, content, blocks, kind, is_published, is_legal, sort_order, show_header, show_footer
          FROM website_pages
         WHERE tenant_id = ${ts.tenant_id}
           AND venue_id IS NULL
           AND (${includeUnpublished} OR is_published = true)
         ORDER BY sort_order, title
      `,
    ])

    return { venues, pages }
  })

  // If any menu_inline block on the home page references a menu, hydrate
  // the menus map so the SSR partial can render without an extra query.
  const menusById = await loadInlineMenus(ts.tenant_id, ts.home_blocks)

  // Same pattern for `gallery` blocks — pre-resolve each block's image
  // set (by category or hand-picked item ids) so the partial can render
  // without per-block DB queries.
  const galleryByBlock = await loadGalleryItemsForBlocks(ts.tenant_id, ts.home_blocks)

  // Pre-resolve DB-backed reviews_band blocks
  const reviewsByBlock = await loadReviewsForBlocks(ts.tenant_id, ts.home_blocks)

  const sole = soleVenueOf(bundle.venues)
  let config = ts
  let venue = null
  let opening_hours = undefined
  let menus = undefined
  let allergens = undefined

  if (sole) {
    const extras = await withTenant(ts.tenant_id, tx =>
      loadVenuePublicExtras(tx, ts.tenant_id, sole, { includePages: false, includeUnpublished }),
    )
    config = mergeLocationConfig(ts, extras.venueConfig)
    venue = { id: sole.id, slug: sole.slug, name: sole.name, timezone: sole.timezone, currency: sole.currency }
    opening_hours = extras.openingHours
    menus = extras.menus
    allergens = extras.allergens
  }

  return {
    tenant_site: ts,
    config,
    brand:       ts,            // alias: emergency banner reads `it.brand`
    tenant_name: ts.tenant_name,
    tenant_slug: ts.tenant_slug,
    venues:      bundle.venues,
    pages:       bundle.pages,
    venue,
    opening_hours,
    menus,
    allergens,
    menus_by_id: menusById,
    gallery_items_by_block: galleryByBlock,
    reviews_by_block:       reviewsByBlock,
    is_staging:  isStaging,
  }
}

/**
 * Production render path: reconstructs the same bundle shape as
 * buildLiveTenantBundle, but sourced from `ts.published_snapshot`
 * instead of the live tenant_site/website_config/website_pages rows.
 * Gallery images, menu PDF docs, allergen info, and schedule-derived
 * hours still resolve live (see loadVenuePublicExtras) — only page
 * layout/copy is frozen.
 */
async function buildPublishedTenantBundle(ts) {
  const snap = ts.published_snapshot
  const tenantSiteFrozen = { ...ts, ...snap.tenant_site }

  const venues = await sql`
    SELECT v.id, v.slug, v.name, v.timezone, v.currency
      FROM venues v
     WHERE v.tenant_id = ${ts.tenant_id} AND v.is_active = true
     ORDER BY v.name
  `
  // The venues-summary list (locations index, sitemap) shows a bit of
  // frozen per-venue config alongside the live venue row.
  const venueConfigs = snap.venue_configs || {}
  const venuesWithFrozenConfig = venues.map(v => {
    const vc = venueConfigs[v.id] || {}
    return {
      ...v,
      address_line1: vc.address_line1 ?? null,
      address_line2: vc.address_line2 ?? null,
      city:          vc.city ?? null,
      postcode:      vc.postcode ?? null,
      phone:         vc.phone ?? null,
      email:         vc.email ?? null,
      hero_image_url: vc.hero_image_url ?? null,
      venue_tagline:  vc.tagline ?? null,
    }
  })

  const pages = snap.tenant_pages || []

  const menusById      = await loadInlineMenus(ts.tenant_id, tenantSiteFrozen.home_blocks)
  const galleryByBlock = await loadGalleryItemsForBlocks(ts.tenant_id, tenantSiteFrozen.home_blocks)
  const reviewsByBlock = await loadReviewsForBlocks(ts.tenant_id, tenantSiteFrozen.home_blocks)

  const sole = soleVenueOf(venuesWithFrozenConfig)
  let config = tenantSiteFrozen
  let venue = null
  let opening_hours, menus, allergens

  if (sole) {
    const frozenVenueConfig = venueConfigs[sole.id] || null
    const extras = await withTenant(ts.tenant_id, tx =>
      loadVenuePublicExtras(tx, ts.tenant_id, sole, {
        includePages: false,
        venueConfigOverride: frozenVenueConfig,
      }),
    )
    config = mergeLocationConfig(tenantSiteFrozen, frozenVenueConfig)
    venue = { id: sole.id, slug: sole.slug, name: sole.name, timezone: sole.timezone, currency: sole.currency }
    opening_hours = extras.openingHours
    menus = extras.menus
    allergens = extras.allergens
  }

  return {
    tenant_site: tenantSiteFrozen,
    config,
    brand:       tenantSiteFrozen,
    tenant_name: ts.tenant_name,
    tenant_slug: ts.tenant_slug,
    venues:      venuesWithFrozenConfig,
    pages,
    venue,
    opening_hours,
    menus,
    allergens,
    menus_by_id: menusById,
    gallery_items_by_block: galleryByBlock,
    reviews_by_block:       reviewsByBlock,
    is_staging:  false,
  }
}

/* ── Menu intro_line font self-loading ─────────────────────────
 * `intro_line` is authored via the admin's RichTextEditor and can carry
 * inline `font-family: X` styles from its font picker. head.eta's global
 * font collector only scans structured `block.data.font_family` fields,
 * not arbitrary rich-text HTML, so a font picked here would never get
 * requested from Google Fonts and would silently fall back to the
 * browser default. Instead of teaching the shared collector to parse
 * HTML, this mirrors the scrolling_text block's approach: menu_inline.eta
 * loads exactly the font(s) intro_line actually uses via a small
 * self-contained <link>, built here (real JS, not inside an Eta <% %>
 * block — see the CLAUDE.md gotcha about quote-bearing regexes breaking
 * Eta's parser).
 *
 * Same 22-font list + weight sets as head.eta / scrolling_text.eta —
 * kept as its own copy per that established convention (each render
 * site that needs font loading keeps its own table rather than sharing
 * a module), and used here as an allowlist so nothing from the HTML
 * ever reaches the Google Fonts URL unfiltered. */
const FONT_WEIGHTS = {
  'Inter':              '300;400;500;600;700;800',
  'Fraunces':           '300;400;500;600;700;800',
  'Caveat':             '400;500;600;700',
  'Playfair Display':   '400;500;600;700;800',
  'Poppins':            '300;400;500;600;700;800',
  'Lora':               '400;500;600;700',
  'Montserrat':         '300;400;500;600;700;800',
  'Roboto':             '300;400;500;700',
  'Open Sans':          '300;400;500;600;700;800',
  'Source Sans Pro':    '300;400;600;700',
  'Raleway':            '300;400;500;600;700;800',
  'Merriweather':       '300;400;700;900',
  'Work Sans':          '300;400;500;600;700;800',
  'Karla':              '300;400;500;600;700;800',
  'DM Sans':            '400;500;700',
  'DM Serif Display':   '400',
  'Space Grotesk':      '300;400;500;600;700',
  'Manrope':            '300;400;500;600;700;800',
  'Cormorant Garamond': '300;400;500;600;700',
  'Libre Baskerville':  '400;700',
  'Nunito':             '300;400;500;600;700;800',
  'Rubik':              '300;400;500;600;700;800',
}

function extractRichTextFonts(html) {
  if (!html) return []
  const found = new Set()
  const re = /font-family:\s*["']?([^;"'>]+)["']?/gi
  let match
  while ((match = re.exec(html))) {
    const name = match[1].trim()
    if (FONT_WEIGHTS[name]) found.add(name)
  }
  return Array.from(found)
}

function buildGoogleFontsUrl(fontNames) {
  if (!fontNames.length) return null
  const parts = fontNames.map(f => `family=${encodeURIComponent(f)}:wght@${FONT_WEIGHTS[f]}`)
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`
}

/* ── Inline-menu hydration ────────────────────────────────────
 * Walks blocks looking for `type: 'menu_inline'` with a `menu_id`,
 * batch-loads each unique menu (with sections + items + variants +
 * dietary tags), and returns an id → menu map for the renderer.
 * Also scans nested blocks inside the `columns` container. */
async function loadInlineMenus(tenantId, ...blockArrays) {
  const menuIds = new Set()
  function walk(blocks) {
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (b?.type === 'menu_inline' && b?.data?.menu_id) menuIds.add(b.data.menu_id)
      if (Array.isArray(b?.data?.columns)) {
        for (const col of b.data.columns) walk(col?.blocks)
      }
    }
  }
  for (const arr of blockArrays) walk(arr)
  if (menuIds.size === 0) return {}

  return withTenant(tenantId, async tx => {
    const ids = Array.from(menuIds)
    const menus = await tx`
      SELECT m.*,
             COALESCE((
               SELECT json_agg(jsonb_build_object('id', t.id, 'code', t.code, 'label', t.label, 'glyph', t.glyph, 'colour', t.colour) ORDER BY t.sort_order)
                 FROM menu_dietary_tags t WHERE t.tenant_id = m.tenant_id
             ), '[]'::json) AS dietary_tags
        FROM menus m
       WHERE m.id = ANY(${ids}::uuid[])
         AND m.is_published = true
    `
    if (!menus.length) return {}

    const menuIdsArr = menus.map(m => m.id)
    const sections = await tx`
      SELECT s.*,
             COALESCE((
               SELECT json_agg(jsonb_build_object(
                 'id', i.id, 'name', i.name, 'native_name', i.native_name,
                 'description', i.description, 'price_pence', i.price_pence,
                 'notes', i.notes, 'is_featured', i.is_featured, 'image_url', i.image_url,
                 'sort_order', i.sort_order,
                 'variants', COALESCE((
                   SELECT json_agg(jsonb_build_object('label', v.label, 'price_pence', v.price_pence) ORDER BY v.sort_order)
                     FROM menu_item_variants v WHERE v.item_id = i.id
                 ), '[]'::json),
                 'dietary', COALESCE((
                   SELECT json_agg(t.code)
                     FROM menu_item_dietary mid
                     JOIN menu_dietary_tags t ON t.id = mid.tag_id
                    WHERE mid.item_id = i.id
                 ), '[]'::json)
               ) ORDER BY i.sort_order)
                 FROM menu_items i WHERE i.section_id = s.id
             ), '[]'::json) AS items
        FROM menu_sections s
       WHERE s.menu_id = ANY(${menuIdsArr}::uuid[])
       ORDER BY s.sort_order
    `

    const byMenu = {}
    for (const m of menus) {
      byMenu[m.id] = { ...m, sections: [], intro_fonts_url: buildGoogleFontsUrl(extractRichTextFonts(m.intro_line)) }
    }
    for (const s of sections) byMenu[s.menu_id]?.sections.push(s)
    const allItems = sections.flatMap(s => s.items || [])
    await attachVariantGroupsToItems(tx, allItems)
    return byMenu
  })
}

/* ── Gallery block hydration ──────────────────────────────────
 * Walks the supplied block arrays looking for `type: 'gallery'` blocks
 * and resolves each block's image set against the Media library:
 *
 *   data.source === 'category'  → SELECT media_items WHERE category_id = data.category_id
 *                                  (NULL category_id = all images for the tenant)
 *   data.source === 'items'     → SELECT media_items WHERE id IN (data.item_ids)
 *                                  (preserves the operator's chosen order)
 *
 * Optional cap: data.max_items truncates the resolved list. Always
 * filters to MIME starting `image/` so non-image assets don't leak in.
 *
 * Returns: { [blockId]: items[] } where items have id/url/filename/
 * width/height/category_id — enough for the SSR partial to render.
 */
async function loadGalleryItemsForBlocks(tenantId, ...blockArrays) {
  /* Collect every gallery block (with its id + data) so we can batch
     queries by source type. We also recurse into `columns` containers
     since galleries can live inside them. */
  const galleryBlocks = []
  function walk(blocks) {
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (b?.type === 'gallery') galleryBlocks.push(b)
      if (Array.isArray(b?.data?.columns)) {
        for (const col of b.data.columns) walk(col?.blocks)
      }
    }
  }
  for (const arr of blockArrays) walk(arr)
  if (galleryBlocks.length === 0) return {}

  /* Aggregate every category id and every item id we need across all
     blocks. One DB round-trip per ID set. */
  const categoryIds = new Set()
  const itemIds     = new Set()
  let needAllImages = false
  for (const b of galleryBlocks) {
    const d = b.data || {}
    if (d.source === 'items') {
      (Array.isArray(d.item_ids) ? d.item_ids : []).forEach(id => id && itemIds.add(id))
    } else {
      // 'category' (default) — null category_id means "all images"
      if (d.category_id) categoryIds.add(d.category_id)
      else               needAllImages = true
    }
  }

  return withTenant(tenantId, async tx => {
    /* Pull every potentially-needed image in one query. The block-level
       filtering happens in JS below — cheaper than per-block round-trips
       when categories + handpicked overlap. */
    let allRows = []
    if (needAllImages) {
      allRows = await tx`
        SELECT id, url, filename, width, height, category_id, mimetype
          FROM media_items
         WHERE tenant_id = ${tenantId}
           AND mimetype LIKE 'image/%'
         ORDER BY created_at DESC
      `
    } else if (categoryIds.size || itemIds.size) {
      allRows = await tx`
        SELECT id, url, filename, width, height, category_id, mimetype
          FROM media_items
         WHERE tenant_id = ${tenantId}
           AND mimetype LIKE 'image/%'
           AND (
             ${categoryIds.size
               ? tx`category_id = ANY(${Array.from(categoryIds)}::uuid[])`
               : tx`false`}
             OR
             ${itemIds.size
               ? tx`id = ANY(${Array.from(itemIds)}::uuid[])`
               : tx`false`}
           )
         ORDER BY created_at DESC
      `
    }

    const byId = Object.fromEntries(allRows.map(r => [r.id, r]))
    const out  = {}
    for (const b of galleryBlocks) {
      const d   = b.data || {}
      const cap = (typeof d.max_items === 'number' && d.max_items >= 0) ? d.max_items : null
      let list  = []

      if (d.source === 'items') {
        const ids = Array.isArray(d.item_ids) ? d.item_ids : []
        list = ids.map(id => byId[id]).filter(Boolean) // preserve picked order
      } else if (d.category_id) {
        list = allRows.filter(r => r.category_id === d.category_id)
      } else {
        list = allRows
      }
      if (cap !== null) list = list.slice(0, cap)
      out[b.id] = list
    }
    return out
  })
}

/**
 * Load the per-venue location-page bundle: gallery, menus, opening
 * hours, allergens, plus the merged config object. Caller supplies the
 * already-resolved tenant bundle so we do not re-query tenant_site.
 *
 * Mode follows `tenantBundle.is_staging` (set by loadTenantBundle):
 * staging always uses the live website_config/website_pages rows
 * (including unpublished pages); production uses this venue's frozen
 * config/pages from the tenant's published_snapshot, falling back to
 * empty/default content for a venue that didn't exist yet at the last
 * publish. Gallery/menu-doc/allergen/hours data stays live either way.
 *
 * @returns {Promise<object|null>} null when the venue does not exist
 *   or is inactive.
 */
export async function loadLocationBundle(tenantBundle, venueSlug) {
  if (!tenantBundle || !venueSlug) return null
  const ts        = tenantBundle.tenant_site
  const tenantId  = ts.tenant_id
  const isStaging = !!tenantBundle.is_staging

  const [venue] = await sql`
    SELECT id, slug, name, timezone, currency
      FROM venues
     WHERE tenant_id = ${tenantId}
       AND slug      = ${venueSlug}
       AND is_active = true
     LIMIT 1
  `
  if (!venue) return null

  const frozenVenueConfig = isStaging ? null : ((ts.published_snapshot?.venue_configs || {})[venue.id] || null)
  const frozenPages       = isStaging ? null : ((ts.published_snapshot?.venue_pages   || {})[venue.id] || [])

  const result = await withTenant(tenantId, async tx => {
    const extras = await loadVenuePublicExtras(tx, tenantId, venue, isStaging ? {
      includePages: true,
      includeUnpublished: true,
    } : {
      includePages: true,
      venueConfigOverride: frozenVenueConfig,
      pagesOverride: frozenPages,
    })
    return {
      mergedConfig: mergeLocationConfig(ts, isStaging ? extras.venueConfig : frozenVenueConfig),
      gallery:      extras.gallery,
      menus:        extras.menus,
      openingHours: extras.openingHours,
      allergens:    extras.allergens,
      pages:        extras.pages,
    }
  })

  // Merge tenant + venue inline-menu hydration. The location page may
  // reference menus via menu_inline blocks in either page_blocks (this
  // page's blocks) or home_blocks (header/footer if shared).
  const menusById = {
    ...(tenantBundle.menus_by_id || {}),
    ...(await loadInlineMenus(tenantId, result.mergedConfig.page_blocks)),
  }

  // Same merge for gallery hydration — page-level gallery blocks can
  // appear on the location page itself, plus any in the inherited home
  // blocks (typically none, but handle it).
  const galleryByBlock = {
    ...(tenantBundle.gallery_items_by_block || {}),
    ...(await loadGalleryItemsForBlocks(tenantId, result.mergedConfig.page_blocks)),
  }

  // Reviews hydration for DB-backed reviews_band blocks on location pages
  const reviewsByBlock = {
    ...(tenantBundle.reviews_by_block || {}),
    ...(await loadReviewsForBlocks(tenantId, result.mergedConfig.page_blocks)),
  }

  return {
    ...tenantBundle,
    config:        result.mergedConfig,
    venue:         { id: venue.id, slug: venue.slug, name: venue.name, timezone: venue.timezone, currency: venue.currency },
    gallery:       result.gallery,
    menus:         result.menus,
    opening_hours: result.openingHours,
    allergens:     result.allergens,
    location_pages: result.pages,
    menus_by_id:   menusById,
    gallery_items_by_block: galleryByBlock,
    reviews_by_block:       reviewsByBlock,
  }
}

/* ── Reviews hydration ────────────────────────────────────────
 * Walks blocks looking for `type: 'reviews_band'` with `data.source === 'db'`.
 * Loads approved reviews for each block's venue_id (or all tenant reviews),
 * respecting max_count and min_rating filters set in the block data.
 * Returns { [blockId]: reviewItem[] } */
async function loadReviewsForBlocks(tenantId, ...blockArrays) {
  const reviewBlocks = []
  function walk(blocks) {
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (b?.type === 'reviews_band' && b?.data?.source === 'db') reviewBlocks.push(b)
      if (Array.isArray(b?.data?.columns)) {
        for (const col of b.data.columns) walk(col?.blocks)
      }
    }
  }
  for (const arr of blockArrays) walk(arr)
  if (reviewBlocks.length === 0) return {}

  const out = {}
  await withTenant(tenantId, async tx => {
    for (const b of reviewBlocks) {
      const d = b.data || {}
      const venueId   = d.venue_id   ?? null
      const minRating = d.min_rating  ?? 1
      const maxCount  = d.max_count   ?? 6
      const platform  = d.platform    ?? null

      const rows = await tx`
        SELECT rating, review_text, reviewer_name
          FROM reviews
         WHERE tenant_id  = ${tenantId}
           AND is_approved = true
           AND rating >= ${minRating}
           ${venueId  ? tx`AND venue_id = ${venueId}`  : tx``}
           ${platform ? tx`AND platform = ${platform}` : tx``}
         ORDER BY is_featured DESC, review_date DESC NULLS LAST
         LIMIT ${maxCount}
      `
      out[b.id] = rows
    }
  })
  return out
}

// Back-compat alias: a few callers still import `loadSiteBundle`.
export const loadSiteBundle = loadTenantBundle
