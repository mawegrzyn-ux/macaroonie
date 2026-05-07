// src/routes/siteRenderer.js
//
// Server-side rendering of tenant public websites.
//
// One site per TENANT. The Host header resolves to either:
//   (a) `{tenant_site.subdomain_slug}.{PUBLIC_ROOT_DOMAIN}`, or
//   (b) a verified `tenant_site.custom_domain` (exact match).
//
// Routes (relative to the matched host):
//   GET /                          — tenant home page (home_blocks)
//   GET /locations                 — index of all venues
//   GET /locations/:venueSlug      — venue location page
//   GET /locations/:venueSlug/menu — venue menu list
//   GET /locations/:venueSlug/menu/:id — single menu PDF viewer
//   GET /menu                      — tenant-level menu hub (lists per-venue menus)
//   GET /p/:pageSlug               — tenant-level custom CMS page
//   GET /locations/:venueSlug/p/:pageSlug — venue-level custom CMS page
//   GET /sitemap.xml, /robots.txt
//
// Plus the embeddable booking widget (no host gate):
//   GET /widget/:venueId           — venue-direct widget (deep-link)
//   GET /widget/tenant/:tenantId   — tenant widget (location picker step 0)

import { loadTenantBundle, loadLocationBundle } from '../services/siteDataSvc.js'
import { sql }            from '../config/db.js'
import { env }            from '../config/env.js'

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'static', 'assets',
  'cdn', 'ws', 'stripe', 'webhook', 'webhooks',
])

const SUBDOMAIN_RE = new RegExp(
  `^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\\.${env.PUBLIC_ROOT_DOMAIN.replace(/\./g, '\\.')}$`,
  'i',
)

const KNOWN_TEMPLATES = new Set(['classic', 'modern', 'onethai'])
const DEFAULT_TEMPLATE = 'classic'

/**
 * Extracts a tenant site identifier from the request's Host header.
 * Returns `{ slug, customDomain }` or null if the host is bare-root /
 * reserved subdomain.
 */
export function resolveSiteHost(host) {
  if (!host) return null
  const hostname = host.split(':')[0].toLowerCase()
  if (hostname === env.PUBLIC_ROOT_DOMAIN.toLowerCase()) return null

  const m = hostname.match(SUBDOMAIN_RE)
  if (m) {
    const slug = m[1].toLowerCase()
    if (RESERVED_SUBDOMAINS.has(slug)) return null
    return { slug, customDomain: null }
  }
  return { slug: null, customDomain: hostname }
}

// Back-compat for any importer
export function extractSubdomain(host) {
  return resolveSiteHost(host)?.slug ?? null
}

function templateOf(cfg) {
  const key = cfg?.template_key
  return KNOWN_TEMPLATES.has(key) ? key : DEFAULT_TEMPLATE
}

export default async function siteRendererRoutes(app) {

  app.addHook('onRequest', async (req) => {
    req.siteHost = resolveSiteHost(req.hostname || req.headers.host)
  })

  const renderSite = async (reply, view, data) => {
    const tpl = templateOf(data.config)
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    return reply.view(`site/templates/${tpl}/${view}.eta`, data)
  }

  const renderNotFound = async (reply, message = 'Site not found') => {
    reply.code(404)
    return reply.view('site/not-found.eta', {
      message,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
    })
  }

  const loadOrRender404 = async (req, reply) => {
    if (!req.siteHost) return null
    const bundle = await loadTenantBundle(req.siteHost)
    if (!bundle) {
      await renderNotFound(reply)
      return null
    }
    return bundle
  }

  const baseCtx = (req, bundle) => {
    const host = (req.hostname || req.headers.host || '').split(':')[0]
    const siteUrl = `${env.PUBLIC_SITE_SCHEME}://${host || bundle.tenant_site.subdomain_slug + '.' + env.PUBLIC_ROOT_DOMAIN}`
    return {
      ...bundle,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      siteUrl,
    }
  }

  // ── Home (tenant) ──────────────────────────────────────
  app.get('/', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    return renderSite(reply, 'index', {
      ...baseCtx(req, bundle),
      page: { kind: 'home' },
    })
  })

  // ── Locations index ────────────────────────────────────
  app.get('/locations', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    if (bundle.tenant_site.hide_locations_index) {
      return renderNotFound(reply, 'Locations index disabled')
    }
    return renderSite(reply, 'locations', {
      ...baseCtx(req, bundle),
      page: { kind: 'locations' },
    })
  })

  // ── Single location ────────────────────────────────────
  app.get('/locations/:venueSlug', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const tenantBundle = await loadOrRender404(req, reply)
    if (!tenantBundle) return
    const bundle = await loadLocationBundle(tenantBundle, req.params.venueSlug)
    if (!bundle) return renderNotFound(reply, 'Location not found')
    return renderSite(reply, 'location', {
      ...baseCtx(req, bundle),
      page: { kind: 'location' },
    })
  })

  // ── Single location: menu list ─────────────────────────
  app.get('/locations/:venueSlug/menu', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const tenantBundle = await loadOrRender404(req, reply)
    if (!tenantBundle) return
    const bundle = await loadLocationBundle(tenantBundle, req.params.venueSlug)
    if (!bundle) return renderNotFound(reply, 'Location not found')
    if (bundle.config.show_menu === false) return renderNotFound(reply, 'Menu not available')
    return renderSite(reply, 'menu', {
      ...baseCtx(req, bundle),
      page: { kind: 'menu' },
      activeMenu: null,
    })
  })

  // ── Single location: menu PDF ──────────────────────────
  app.get('/locations/:venueSlug/menu/:id', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const tenantBundle = await loadOrRender404(req, reply)
    if (!tenantBundle) return
    const bundle = await loadLocationBundle(tenantBundle, req.params.venueSlug)
    if (!bundle) return renderNotFound(reply, 'Location not found')
    if (bundle.config.show_menu === false) return renderNotFound(reply, 'Menu not available')
    const activeMenu = bundle.menus.find(m => m.id === req.params.id)
    if (!activeMenu) return renderNotFound(reply, 'Menu document not found')
    return renderSite(reply, 'menu', {
      ...baseCtx(req, bundle),
      page: { kind: 'menu' },
      activeMenu,
    })
  })

  // ── Tenant menu hub ────────────────────────────────────
  // Lists every venue with menus so visitors can pick a location first.
  app.get('/menu', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    return renderSite(reply, 'menu_hub', {
      ...baseCtx(req, bundle),
      page: { kind: 'menu_hub' },
    })
  })

  // ── Tenant custom page ─────────────────────────────────
  app.get('/p/:pageSlug', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    const page = bundle.pages.find(p => p.slug === req.params.pageSlug)
    if (!page) return renderNotFound(reply, 'Page not found')
    return renderSite(reply, 'page', {
      ...baseCtx(req, bundle),
      page: { kind: 'custom', ...page },
    })
  })

  // ── Venue custom page ──────────────────────────────────
  app.get('/locations/:venueSlug/p/:pageSlug', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const tenantBundle = await loadOrRender404(req, reply)
    if (!tenantBundle) return
    const bundle = await loadLocationBundle(tenantBundle, req.params.venueSlug)
    if (!bundle) return renderNotFound(reply, 'Location not found')
    const page = (bundle.location_pages || []).find(p => p.slug === req.params.pageSlug)
    if (!page) return renderNotFound(reply, 'Page not found')
    return renderSite(reply, 'page', {
      ...baseCtx(req, bundle),
      page: { kind: 'custom', ...page },
    })
  })

  // ── Sitemap / robots ───────────────────────────────────
  app.get('/sitemap.xml', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadTenantBundle(req.siteHost)
    if (!bundle) { reply.code(404); return 'Not found' }
    const host = (req.hostname || req.headers.host || '').split(':')[0]
    const base = `${env.PUBLIC_SITE_SCHEME}://${host}`
    const urls = [
      `${base}/`,
      ...(bundle.tenant_site.hide_locations_index ? [] : [`${base}/locations`]),
      ...bundle.venues.map(v => `${base}/locations/${v.slug}`),
      ...bundle.pages.map(p => `${base}/p/${p.slug}`),
    ]
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n') +
      `\n</urlset>`
    reply.type('application/xml').send(body)
  })

  app.get('/robots.txt', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const host = (req.hostname || req.headers.host || '').split(':')[0]
    const base = `${env.PUBLIC_SITE_SCHEME}://${host}`
    reply.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`)
  })

  // ── Booking widget — venue direct (deep link) ──────────
  // Works on apex AND any tenant subdomain — no siteHost gate.
  app.get('/widget/:venueId', async (req, reply) => {
    const venueId = req.params.venueId
    const theme   = req.query.theme === 'dark' ? 'dark' : 'light'
    const accentRaw = String(req.query.accent || '')
    const accent  = /^#?[0-9a-fA-F]{6}$/.test(accentRaw)
      ? (accentRaw.startsWith('#') ? accentRaw : '#' + accentRaw)
      : null

    const [venue] = await sql`
      SELECT v.id, v.tenant_id, v.name, v.timezone,
             br.slot_duration_mins, br.min_covers, br.max_covers,
             br.booking_window_days, br.hold_ttl_secs,
             ts.primary_colour, ts.font_family, ts.site_name AS tenant_site_name,
             wc.hero_heading
        FROM venues v
        LEFT JOIN booking_rules  br ON br.venue_id  = v.id
        LEFT JOIN tenant_site    ts ON ts.tenant_id = v.tenant_id
        LEFT JOIN website_config wc ON wc.venue_id  = v.id
       WHERE v.id = ${venueId} AND v.is_active = true
       LIMIT 1
    `
    if (!venue) {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'Venue not found', rootDomain: env.PUBLIC_ROOT_DOMAIN })
    }

    reply.header('X-Frame-Options', 'ALLOWALL')
    reply.header('Content-Security-Policy', "frame-ancestors *")
    reply.header('Cache-Control', 'public, max-age=300')

    return reply.view('site/widget.eta', {
      mode: 'venue',
      venues: [{
        id:                  venue.id,
        name:                venue.name,
        site_name:           venue.tenant_site_name || venue.name,
        slot_duration_mins:  venue.slot_duration_mins ?? 90,
        min_covers:          venue.min_covers ?? 1,
        max_covers:          venue.max_covers ?? 8,
        booking_window_days: venue.booking_window_days ?? 30,
        hold_ttl_secs:       venue.hold_ttl_secs ?? 300,
      }],
      initialVenueId: venue.id,
      tenantName:     venue.tenant_site_name || venue.name,
      apiBase:        `${env.PUBLIC_SITE_SCHEME}://${env.PUBLIC_ROOT_DOMAIN}/widget-api`,
      accent:         accent || venue.primary_colour || '#2563eb',
      theme,
      font_family:    venue.font_family || 'system-ui',
    })
  })

  // ── Booking widget — tenant mode (location picker) ─────
  // Loads ALL active venues for the tenant. Step 0 in the UI is
  // location selection; can be skipped via ?venue=<id> deep link.
  app.get('/widget/tenant/:tenantId', async (req, reply) => {
    const tenantId = req.params.tenantId
    const theme    = req.query.theme === 'dark' ? 'dark' : 'light'
    const accentRaw = String(req.query.accent || '')
    const accent   = /^#?[0-9a-fA-F]{6}$/.test(accentRaw)
      ? (accentRaw.startsWith('#') ? accentRaw : '#' + accentRaw)
      : null
    const initialVenueId = req.query.venue || null

    const [tenantSite] = await sql`
      SELECT ts.primary_colour, ts.font_family, ts.site_name, t.name AS tenant_name
        FROM tenants t
        LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
       WHERE t.id = ${tenantId} AND t.is_active = true
       LIMIT 1
    `
    if (!tenantSite) {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'Tenant not found', rootDomain: env.PUBLIC_ROOT_DOMAIN })
    }

    const venues = await sql`
      SELECT v.id, v.name, v.timezone,
             br.slot_duration_mins, br.min_covers, br.max_covers,
             br.booking_window_days, br.hold_ttl_secs,
             wc.address_line1, wc.city, wc.postcode
        FROM venues v
        LEFT JOIN booking_rules  br ON br.venue_id  = v.id
        LEFT JOIN website_config wc ON wc.venue_id  = v.id
       WHERE v.tenant_id = ${tenantId} AND v.is_active = true
       ORDER BY v.name
    `
    if (!venues.length) {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'No bookable locations', rootDomain: env.PUBLIC_ROOT_DOMAIN })
    }

    reply.header('X-Frame-Options', 'ALLOWALL')
    reply.header('Content-Security-Policy', "frame-ancestors *")
    reply.header('Cache-Control', 'public, max-age=300')

    return reply.view('site/widget.eta', {
      mode: 'tenant',
      venues: venues.map(v => ({
        id:                  v.id,
        name:                v.name,
        site_name:           tenantSite.site_name || tenantSite.tenant_name,
        address_line1:       v.address_line1 || null,
        city:                v.city || null,
        postcode:            v.postcode || null,
        slot_duration_mins:  v.slot_duration_mins ?? 90,
        min_covers:          v.min_covers ?? 1,
        max_covers:          v.max_covers ?? 8,
        booking_window_days: v.booking_window_days ?? 30,
        hold_ttl_secs:       v.hold_ttl_secs ?? 300,
      })),
      initialVenueId,
      tenantName:     tenantSite.site_name || tenantSite.tenant_name,
      apiBase:        `${env.PUBLIC_SITE_SCHEME}://${env.PUBLIC_ROOT_DOMAIN}/widget-api`,
      accent:         accent || tenantSite.primary_colour || '#2563eb',
      theme,
      font_family:    tenantSite.font_family || 'system-ui',
    })
  })
}
