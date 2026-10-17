// src/services/publishSvc.js
//
// Builds and applies the "published" snapshot of a tenant's website —
// see migrations/082_website_staging_production.sql for the full
// rationale. The snapshot freezes page layout/copy (tenant_site content
// fields + each venue's website_config + published pages) at the moment
// of publish. Gallery images, menu PDF docs, allergen info, and
// schedule-derived opening hours are intentionally NOT part of it — they
// keep their own separate publish/moderation state and stay live-shared
// between staging and production.

import { sql, withTenant, tenantSql } from '../config/db.js'
import { httpError } from '../middleware/error.js'

// Keep these three field lists in sync with the equivalent SQL column
// lists in migration 082's backfill — same content/control split.
const TENANT_SITE_CONTENT_FIELDS = [
  'brand_name', 'logo_url', 'favicon_url', 'primary_colour', 'secondary_colour',
  'font_family', 'template_key', 'theme', 'social_links', 'og_image_url',
  'ga4_measurement_id', 'fb_pixel_id', 'banner_enabled', 'banner_text',
  'banner_link_url', 'banner_link_text', 'banner_severity', 'site_name', 'tagline',
  'meta_title', 'meta_description', 'home_blocks', 'hide_locations_index',
  'locations_heading', 'locations_intro', 'default_widget_venue_id',
  'cookies_banner_enabled', 'cookies_banner_text', 'cookies_banner_accept_text',
  'cookies_banner_decline_text', 'widget_settings', 'bimi_svg',
  'header_config', 'footer_config', 'home_show_header', 'home_show_footer',
]

// 'id' is not content — it's the stable website_config row id that
// gallery/menu-doc/allergen/manual-hours queries join against, and those
// stay live-shared, so the frozen config still needs it (see
// loadVenuePublicExtras in siteDataSvc.js).
const WEBSITE_CONFIG_CONTENT_FIELDS = [
  'id', 'site_name', 'tagline', 'logo_url', 'favicon_url', 'primary_colour', 'secondary_colour', 'font_family',
  'hero_image_url', 'hero_heading', 'hero_subheading', 'hero_cta_text', 'hero_cta_link',
  'about_heading', 'about_text', 'about_html', 'about_image_url',
  'address_line1', 'address_line2', 'city', 'postcode', 'country', 'latitude', 'longitude', 'google_maps_embed_url',
  'phone', 'email', 'social_links', 'online_ordering_links', 'delivery_links',
  'widget_venue_id', 'widget_theme', 'og_image_url', 'ga4_measurement_id', 'fb_pixel_id',
  'show_booking_widget', 'show_menu', 'show_allergens', 'show_gallery', 'show_find_us', 'show_contact',
  'show_ordering', 'show_delivery', 'template_key', 'theme', 'gallery_style', 'gallery_size',
  'opening_hours_source', 'page_blocks', 'show_header', 'show_footer', 'cuisine', 'price_range',
  // Without it the live site never applied a location's own Brand & theme
  // (mergeLocationConfig() reads it from the snapshot on production).
  'use_brand_override',
]

const PAGE_CONTENT_FIELDS = [
  'id', 'slug', 'title', 'content', 'blocks', 'kind', 'is_legal', 'sort_order', 'show_header', 'show_footer',
  'system_key',
]

function pick(row, fields) {
  const out = {}
  for (const f of fields) out[f] = row[f] ?? null
  return out
}

/** Gathers the current live content into the snapshot shape, without saving it. */
export async function buildPublishSnapshot(tenantId) {
  const [tsRow] = await tenantSql(tenantId)`SELECT * FROM tenant_site WHERE tenant_id = ${tenantId} LIMIT 1`
  if (!tsRow) throw httpError(404, 'No website set up for this tenant yet')

  return withTenant(tenantId, async tx => {
    const [venueConfigs, pages] = await Promise.all([
      tx`
        SELECT wc.* FROM website_config wc
          JOIN venues v ON v.id = wc.venue_id
         WHERE v.tenant_id = ${tenantId}
      `,
      tx`SELECT * FROM website_pages WHERE tenant_id = ${tenantId} AND is_published = true`,
    ])

    const venue_configs = {}
    for (const wc of venueConfigs) venue_configs[wc.venue_id] = pick(wc, WEBSITE_CONFIG_CONTENT_FIELDS)

    const sortPages = (arr) => arr.slice().sort((a, b) =>
      (a.sort_order - b.sort_order) || String(a.title).localeCompare(String(b.title)))

    const tenant_pages = sortPages(pages.filter(p => p.venue_id === null))
      .map(p => pick(p, PAGE_CONTENT_FIELDS))

    const venue_pages = {}
    for (const p of pages.filter(p => p.venue_id !== null)) {
      if (!venue_pages[p.venue_id]) venue_pages[p.venue_id] = []
      venue_pages[p.venue_id].push(p)
    }
    for (const vid of Object.keys(venue_pages)) {
      venue_pages[vid] = sortPages(venue_pages[vid]).map(p => pick(p, PAGE_CONTENT_FIELDS))
    }

    return {
      tenant_site: pick(tsRow, TENANT_SITE_CONTENT_FIELDS),
      tenant_pages,
      venue_configs,
      venue_pages,
    }
  })
}

// ── Publish status: what staging has that the live site doesn't ─────────

// tenant_site content fields grouped as the Website menu names them; a field
// in no group is reported as "Site settings".
const TENANT_AREAS = [
  ['Home page',           ['home_blocks']],
  ['Header',              ['header_config', 'home_show_header']],
  ['Footer',              ['footer_config', 'home_show_footer', 'social_links']],
  ['Brand & theme',       ['brand_name', 'logo_url', 'favicon_url', 'primary_colour', 'secondary_colour', 'font_family',
                           'template_key', 'theme', 'site_name', 'tagline', 'bimi_svg']],
  ['SEO',                 ['meta_title', 'meta_description', 'og_image_url']],
  ['Analytics',           ['ga4_measurement_id', 'fb_pixel_id']],
  ['Emergency banner',    ['banner_enabled', 'banner_text', 'banner_link_url', 'banner_link_text', 'banner_severity']],
  ['Legal & cookies',     ['cookies_banner_enabled', 'cookies_banner_text', 'cookies_banner_accept_text', 'cookies_banner_decline_text']],
  ['Locations index',     ['hide_locations_index', 'locations_heading', 'locations_intro']],
  ['Reservations widget', ['widget_settings', 'default_widget_venue_id']],
]
const VENUE_PAGE_FIELDS = ['page_blocks', 'show_header', 'show_footer']
// A location's own Brand & theme (BRAND_OVERRIDE_FIELDS in siteDataSvc.js):
// only shown on the site while use_brand_override is on, so changes to them
// count only then (a tenant theme save strips colours from every location).
const VENUE_BRAND_FIELDS = [
  'site_name', 'tagline', 'logo_url', 'favicon_url', 'primary_colour', 'secondary_colour',
  'font_family', 'template_key', 'theme', 'og_image_url',
]

/** JSON with object keys sorted and null / missing keys dropped, so a value
 *  read back from jsonb (keys reordered, fields added to the lists since)
 *  compares equal to the same value built fresh. */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] != null).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}
const same = (a, b) => canonical(a) === canonical(b)

function diffPages(live = [], pub = [], prefix = '') {
  const out = []
  const byId = new Map(pub.map(p => [p.id, p]))
  const liveIds = new Set(live.map(p => p.id))
  const name = p => prefix + (p.kind === 'modal' ? 'pop-up' : 'page') + ' "' + (p.title || p.slug) + '"'
  for (const p of live) {
    const before = byId.get(p.id)
    if (!before) out.push({ label: 'New ' + name(p), kind: 'added' })
    else if (!same(p, before)) out.push({ label: name(p).replace(/^./, c => c.toUpperCase()), kind: 'changed' })
  }
  for (const p of pub) {
    if (!liveIds.has(p.id)) out.push({ label: name(p).replace(/^./, c => c.toUpperCase()) + ' removed or hidden', kind: 'removed' })
  }
  return out
}

/**
 * Whether the live site matches staging, and if not, what differs: each
 * Website menu area, page and location that publishing would change.
 */
export async function publishStatus(tenantId) {
  const [ts] = await tenantSql(tenantId)`
    SELECT published_snapshot, published_at, scheduled_publish_at
      FROM tenant_site WHERE tenant_id = ${tenantId} LIMIT 1`
  if (!ts) return { exists: false }
  const base = { exists: true, published_at: ts.published_at, scheduled_publish_at: ts.scheduled_publish_at }
  if (!ts.published_snapshot) return { ...base, never_published: true, in_sync: false, changes: [] }

  const live = JSON.parse(JSON.stringify(await buildPublishSnapshot(tenantId)))
  const pub = ts.published_snapshot
  const changes = []

  const liveTs = live.tenant_site || {}, pubTs = pub.tenant_site || {}
  const changed = Object.keys({ ...liveTs, ...pubTs }).filter(f => !same(liveTs[f], pubTs[f]))
  for (const [label, fields] of TENANT_AREAS) {
    if (changed.some(f => fields.includes(f))) changes.push({ label, kind: 'changed' })
  }
  if (changed.some(f => !TENANT_AREAS.some(([, fields]) => fields.includes(f)))) {
    changes.push({ label: 'Site settings', kind: 'changed' })
  }

  changes.push(...diffPages(live.tenant_pages, pub.tenant_pages))

  const venueIds = [...new Set([
    ...Object.keys(live.venue_configs || {}), ...Object.keys(pub.venue_configs || {}),
    ...Object.keys(live.venue_pages || {}), ...Object.keys(pub.venue_pages || {}),
  ])]
  const venues = venueIds.length
    ? await tenantSql(tenantId)`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} AND id = ANY(${venueIds}::uuid[])`
    : []
  const venueName = Object.fromEntries(venues.map(v => [v.id, v.name]))
  for (const vid of venueIds) {
    if (!venueName[vid]) continue                       // venue deleted since
    const name = venueName[vid]
    const a = live.venue_configs?.[vid] || {}, b = pub.venue_configs?.[vid] || {}
    const ovA = !!a.use_brand_override, ovB = !!b.use_brand_override
    const fields = Object.keys({ ...a, ...b }).filter(f => f !== 'use_brand_override' && !same(a[f], b[f]))
    if (ovA !== ovB || ((ovA || ovB) && fields.some(f => VENUE_BRAND_FIELDS.includes(f)))) {
      changes.push({ label: name + ': own brand & theme', kind: 'changed' })
    }
    if (fields.some(f => VENUE_PAGE_FIELDS.includes(f))) changes.push({ label: name + ': location page', kind: 'changed' })
    if (fields.some(f => !VENUE_PAGE_FIELDS.includes(f) && !VENUE_BRAND_FIELDS.includes(f))) {
      changes.push({ label: name + ': location details', kind: 'changed' })
    }
    changes.push(...diffPages(live.venue_pages?.[vid], pub.venue_pages?.[vid], name + ': '))
  }

  return { ...base, never_published: false, in_sync: changes.length === 0, changes }
}

/** Publish now — builds a fresh snapshot and makes it live on production. */
export async function publishTenantSite(tenantId) {
  const snapshot = await buildPublishSnapshot(tenantId)
  const [row] = await tenantSql(tenantId)`
    UPDATE tenant_site
       SET published_snapshot   = ${sql.json(snapshot)},
           published_at         = now(),
           scheduled_publish_at = NULL,
           updated_at           = now()
     WHERE tenant_id = ${tenantId}
     RETURNING *
  `
  return row
}

/**
 * "Override staging with prod" — resets the live draft tables (tenant_site
 * content fields, each venue's website_config, and website_pages) back to
 * whatever's in the last published snapshot, discarding any in-progress
 * staging edits. Pages are delete-and-reinserted per tenant scope so the
 * result exactly mirrors what's published (a page removed/unpublished
 * since the last publish comes back; one added since and never published
 * goes away) — matching the same delete-and-reinsert pattern already used
 * elsewhere in the website builder (see upsertMenuTree in menus.js).
 */
export async function overrideStagingWithProduction(tenantId) {
  const [ts] = await tenantSql(tenantId)`SELECT published_snapshot FROM tenant_site WHERE tenant_id = ${tenantId} LIMIT 1`
  if (!ts?.published_snapshot) {
    throw httpError(409, "Nothing has been published yet — there's nothing to restore staging from.")
  }
  const snap = ts.published_snapshot

  await withTenant(tenantId, async tx => {
    const tsFields = snap.tenant_site || {}
    await tx`UPDATE tenant_site SET ${tx(tsFields, ...Object.keys(tsFields))}, updated_at = now() WHERE tenant_id = ${tenantId}`

    for (const [venueId, cfg] of Object.entries(snap.venue_configs || {})) {
      const { id, ...contentFields } = cfg
      if (!Object.keys(contentFields).length) continue
      await tx`UPDATE website_config SET ${tx(contentFields, ...Object.keys(contentFields))}, updated_at = now() WHERE venue_id = ${venueId}`
    }

    await tx`DELETE FROM website_pages WHERE tenant_id = ${tenantId}`

    // Pages come back under their published ids (links and the publish
    // status compare by id) and keep system_key (the Order online page).
    const insertPage = (venueId, p) => tx`
      INSERT INTO website_pages
        (id, tenant_id, venue_id, slug, title, content, blocks, kind, is_legal, sort_order, show_header, show_footer, system_key, is_published)
      VALUES
        (${p.id || tx`gen_random_uuid()`}, ${tenantId}, ${venueId}, ${p.slug}, ${p.title}, ${p.content}, ${tx.json(p.blocks || [])}, ${p.kind}, ${p.is_legal}, ${p.sort_order}, ${p.show_header}, ${p.show_footer}, ${p.system_key ?? null}, true)
    `
    for (const p of snap.tenant_pages || []) await insertPage(null, p)
    for (const [venueId, pages] of Object.entries(snap.venue_pages || {})) {
      for (const p of pages) await insertPage(venueId, p)
    }
  })
}
