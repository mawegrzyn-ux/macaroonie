// src/routes/siteRenderer.js
//
// Server-side rendering of tenant public websites.
//
// A request matches a tenant site when its `Host` header is either:
//   (a) `{slug}.{PUBLIC_ROOT_DOMAIN}` with a non-reserved slug, OR
//   (b) an exact match for a verified `website_config.custom_domain`.
//
// Everything else falls through — the handlers early-return 404 via
// reply.callNotFound() so other route plugins (e.g. /api/*) match first.
//
// Routes (relative to the matched host):
//   GET /                 — home page
//   GET /menu             — menu viewer (lists all PDF menus)
//   GET /menu/:id         — single menu PDF viewer
//   GET /p/:pageSlug      — custom CMS page
//   GET /sitemap.xml      — dynamic sitemap
//   GET /robots.txt       — dynamic robots.txt

import { loadSiteBundle } from '../services/siteDataSvc.js'
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

const KNOWN_TEMPLATES = new Set(['classic', 'modern'])
const DEFAULT_TEMPLATE = 'classic'

/**
 * Extracts a tenant site identifier from the request's Host header.
 * Returns `{ slug, customDomain }` — at most one of them is set.
 * Returns null when the host is the bare root domain or a reserved
 * subdomain (api, www, …).
 */
export function resolveSiteHost(host) {
  if (!host) return null
  const hostname = host.split(':')[0].toLowerCase()

  // Bare root domain → not a tenant site
  if (hostname === env.PUBLIC_ROOT_DOMAIN.toLowerCase()) return null

  // Subdomain form
  const m = hostname.match(SUBDOMAIN_RE)
  if (m) {
    const slug = m[1].toLowerCase()
    if (RESERVED_SUBDOMAINS.has(slug)) return null
    return { slug, customDomain: null }
  }

  // Anything else → treat as potential custom domain. The lookup in
  // siteDataSvc.loadSiteBundle will 404 if no tenant claims it.
  return { slug: null, customDomain: hostname }
}

// Back-compat for app.js usage elsewhere
export function extractSubdomain(host) {
  return resolveSiteHost(host)?.slug ?? null
}

function templateOf(cfg) {
  const key = cfg?.template_key
  return KNOWN_TEMPLATES.has(key) ? key : DEFAULT_TEMPLATE
}

export default async function siteRendererRoutes(app) {

  // Attach req.siteHost to every request so handlers can decide whether
  // to serve a tenant view or bail out to the 404 handler.
  app.addHook('onRequest', async (req) => {
    req.siteHost = resolveSiteHost(req.hostname || req.headers.host)
  })

  // Unified render helper — picks the right template directory.
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
    const bundle = await loadSiteBundle(req.siteHost)
    if (!bundle) {
      await renderNotFound(reply)
      return null
    }
    return bundle
  }

  const baseCtx = (req, bundle) => {
    // Prefer the actual host the request came in on so internal links
    // stay on custom domains when configured.
    const host = (req.hostname || req.headers.host || '').split(':')[0]
    const siteUrl = `${env.PUBLIC_SITE_SCHEME}://${host || bundle.config.subdomain_slug + '.' + env.PUBLIC_ROOT_DOMAIN}`
    return {
      ...bundle,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      siteUrl,
    }
  }

  // ── Home ───────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    return renderSite(reply, 'index', {
      ...baseCtx(req, bundle),
      page: { kind: 'home' },
    })
  })

  // ── Menu index ─────────────────────────────────────────
  app.get('/menu', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    if (!bundle.config.show_menu) return renderNotFound(reply, 'Menu not available')
    return renderSite(reply, 'menu', {
      ...baseCtx(req, bundle),
      page: { kind: 'menu' },
      activeMenu: null,
    })
  })

  // ── Single menu ────────────────────────────────────────
  app.get('/menu/:id', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    if (!bundle.config.show_menu) return renderNotFound(reply, 'Menu not available')
    const activeMenu = bundle.menus.find(m => m.id === req.params.id)
    if (!activeMenu) return renderNotFound(reply, 'Menu document not found')
    return renderSite(reply, 'menu', {
      ...baseCtx(req, bundle),
      page: { kind: 'menu' },
      activeMenu,
    })
  })

  // ── Custom page ────────────────────────────────────────
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

  // ── Sitemap / robots ───────────────────────────────────
  app.get('/sitemap.xml', async (req, reply) => {
    if (!req.siteHost) return reply.callNotFound()
    const bundle = await loadSiteBundle(req.siteHost)
    if (!bundle) { reply.code(404); return 'Not found' }
    const host    = (req.hostname || req.headers.host || '').split(':')[0]
    const base    = `${env.PUBLIC_SITE_SCHEME}://${host}`
    const urls = [
      `${base}/`,
      ...(bundle.config.show_menu && bundle.menus.length ? [`${base}/menu`] : []),
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

  // ── Booking widget (standalone iframe-embeddable page) ──
  // Works on apex AND any tenant subdomain — no siteHost gate.
  // GET /widget/:venueId?theme=light|dark&accent=#hex
  app.get('/widget/:venueId', async (req, reply) => {
    const venueId = req.params.venueId
    const theme   = req.query.theme === 'dark' ? 'dark' : 'light'
    const accentRaw = String(req.query.accent || '')
    const accent  = /^#?[0-9a-fA-F]{6}$/.test(accentRaw)
      ? (accentRaw.startsWith('#') ? accentRaw : '#' + accentRaw)
      : null

    // Look up venue via the public widget-api shape
    const [venue] = await sql`
      SELECT v.id, v.name, v.timezone,
             br.slot_duration_mins, br.min_covers, br.max_covers,
             br.booking_window_days, br.hold_ttl_secs,
             wc.primary_colour, wc.font_family, wc.site_name
        FROM venues v
        LEFT JOIN booking_rules  br ON br.venue_id = v.id
        LEFT JOIN website_config wc ON wc.venue_id = v.id
       WHERE v.id = ${venueId} AND v.is_active = true
       LIMIT 1
    `
    if (!venue) {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'Venue not found', rootDomain: env.PUBLIC_ROOT_DOMAIN })
    }

    // iframe-friendly headers
    reply.header('X-Frame-Options', 'ALLOWALL')           // legacy; ignored by modern browsers
    reply.header('Content-Security-Policy', "frame-ancestors *")
    reply.header('Cache-Control', 'public, max-age=300')

    const venueData = {
      id:                  venue.id,
      name:                venue.name,
      site_name:           venue.site_name || venue.name,
      slot_duration_mins:  venue.slot_duration_mins ?? 90,
      min_covers:          venue.min_covers ?? 1,
      max_covers:          venue.max_covers ?? 8,
      booking_window_days: venue.booking_window_days ?? 30,
      hold_ttl_secs:       venue.hold_ttl_secs ?? 300,
    }

    return reply.view('site/widget.eta', {
      venue:       venueData,
      apiBase:     `${env.PUBLIC_SITE_SCHEME}://${env.PUBLIC_ROOT_DOMAIN}/widget-api`,
      accent:      accent || venue.primary_colour || '#2563eb',
      theme,
      font_family: venue.font_family || 'system-ui',
    })
  })
}
