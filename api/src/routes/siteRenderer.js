// src/routes/siteRenderer.js
//
// Server-side rendering of tenant public websites.
//
// Activation: only when the request `Host` header matches
// `{slug}.{PUBLIC_ROOT_DOMAIN}` and the slug is NOT reserved
// (api, admin, www, etc). All other hosts fall through to normal routes.
//
// Routes (relative to the subdomain host):
//   GET /                 — home page
//   GET /menu             — menu viewer (lists all PDF menus)
//   GET /menu/:id         — single menu PDF viewer
//   GET /p/:pageSlug      — custom CMS page
//   GET /sitemap.xml      — dynamic sitemap
//   GET /robots.txt       — dynamic robots.txt

import { loadSiteBundle } from '../services/siteDataSvc.js'
import { env }            from '../config/env.js'

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'static', 'assets',
  'cdn', 'ws', 'stripe', 'webhook', 'webhooks',
])

const SUBDOMAIN_RE = new RegExp(
  `^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\\.${env.PUBLIC_ROOT_DOMAIN.replace(/\./g, '\\.')}$`,
  'i',
)

/**
 * Extracts a tenant subdomain slug from the request's Host header.
 * Returns null when the host is not a tenant subdomain (e.g. the bare
 * root domain, or a reserved subdomain like `api.`).
 */
export function extractSubdomain(host) {
  if (!host) return null
  const hostname = host.split(':')[0].toLowerCase()
  const m = hostname.match(SUBDOMAIN_RE)
  if (!m) return null
  const slug = m[1].toLowerCase()
  if (RESERVED_SUBDOMAINS.has(slug)) return null
  return slug
}

export default async function siteRendererRoutes(app) {

  // ── Subdomain gate ─────────────────────────────────────
  // preHandler that attaches req.subdomainSlug; non-subdomain requests
  // fall through untouched so the normal API routes still match.
  app.addHook('onRequest', async (req) => {
    const slug = extractSubdomain(req.hostname || req.headers.host)
    req.subdomainSlug = slug
  })

  // Helper — render or 404/502 with a uniform error page
  const renderSite = async (reply, view, data) => {
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    return reply.view(view, data)
  }

  const renderNotFound = async (reply, message = 'Site not found') => {
    reply.code(404)
    return reply.view('site/not-found.eta', {
      message,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
    })
  }

  // Every site route reloads the bundle — cheap (~1 round trip)
  // and guarantees fresh content after admin saves.
  const loadOrRender404 = async (req, reply) => {
    if (!req.subdomainSlug) return null
    const bundle = await loadSiteBundle(req.subdomainSlug)
    if (!bundle) {
      await renderNotFound(reply)
      return null
    }
    return bundle
  }

  // ── Home ───────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    if (!req.subdomainSlug) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    return renderSite(reply, 'site/index.eta', {
      ...bundle,
      page:       { kind: 'home' },
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      siteUrl:    `${env.PUBLIC_SITE_SCHEME}://${req.subdomainSlug}.${env.PUBLIC_ROOT_DOMAIN}`,
    })
  })

  // ── Menu index ─────────────────────────────────────────
  app.get('/menu', async (req, reply) => {
    if (!req.subdomainSlug) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    if (!bundle.config.show_menu) return renderNotFound(reply, 'Menu not available')
    return renderSite(reply, 'site/menu.eta', {
      ...bundle,
      page:       { kind: 'menu' },
      activeMenu: null,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      siteUrl:    `${env.PUBLIC_SITE_SCHEME}://${req.subdomainSlug}.${env.PUBLIC_ROOT_DOMAIN}`,
    })
  })

  // ── Single menu ────────────────────────────────────────
  app.get('/menu/:id', async (req, reply) => {
    if (!req.subdomainSlug) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    if (!bundle.config.show_menu) return renderNotFound(reply, 'Menu not available')
    const activeMenu = bundle.menus.find(m => m.id === req.params.id)
    if (!activeMenu) return renderNotFound(reply, 'Menu document not found')
    return renderSite(reply, 'site/menu.eta', {
      ...bundle,
      page:       { kind: 'menu' },
      activeMenu,
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      siteUrl:    `${env.PUBLIC_SITE_SCHEME}://${req.subdomainSlug}.${env.PUBLIC_ROOT_DOMAIN}`,
    })
  })

  // ── Custom page ────────────────────────────────────────
  app.get('/p/:pageSlug', async (req, reply) => {
    if (!req.subdomainSlug) return reply.callNotFound()
    const bundle = await loadOrRender404(req, reply)
    if (!bundle) return
    const page = bundle.pages.find(p => p.slug === req.params.pageSlug)
    if (!page) return renderNotFound(reply, 'Page not found')
    return renderSite(reply, 'site/page.eta', {
      ...bundle,
      page:       { kind: 'custom', ...page },
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
      siteUrl:    `${env.PUBLIC_SITE_SCHEME}://${req.subdomainSlug}.${env.PUBLIC_ROOT_DOMAIN}`,
    })
  })

  // ── Sitemap / robots — delegate to public JSON routes by reading bundle
  app.get('/sitemap.xml', async (req, reply) => {
    if (!req.subdomainSlug) return reply.callNotFound()
    const bundle = await loadSiteBundle(req.subdomainSlug)
    if (!bundle) { reply.code(404); return 'Not found' }
    const base = `${env.PUBLIC_SITE_SCHEME}://${req.subdomainSlug}.${env.PUBLIC_ROOT_DOMAIN}`
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
    if (!req.subdomainSlug) return reply.callNotFound()
    const base = `${env.PUBLIC_SITE_SCHEME}://${req.subdomainSlug}.${env.PUBLIC_ROOT_DOMAIN}`
    reply.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`)
  })
}
