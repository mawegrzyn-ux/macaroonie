// src/routes/publicSite.js
//
// Public, unauthenticated JSON endpoints that expose tenant website data.
// Consumed by:
//   - The SSR renderer in ./siteRenderer.js (direct service call, not HTTP)
//   - Any external client that wants structured site data (future JAMstack use)
//
// No auth, no tenant context on the request. Data is scoped by subdomain_slug
// in the service layer via withTenant() after resolving the slug.

import { loadSiteBundle } from '../services/siteDataSvc.js'
import { httpError }      from '../middleware/error.js'
import { env }            from '../config/env.js'

export default async function publicSiteRoutes(app) {

  // ── GET /api/site/:slug ─────────────────────────────────
  app.get('/:slug', async (req, reply) => {
    const bundle = await loadSiteBundle(req.params.slug)
    if (!bundle) throw httpError(404, 'Site not found or not published')

    // Short cache — public data but changes on admin save
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    return bundle
  })

  // ── GET /api/site/:slug/sitemap.xml ─────────────────────
  app.get('/:slug/sitemap.xml', async (req, reply) => {
    const bundle = await loadSiteBundle(req.params.slug)
    if (!bundle) throw httpError(404, 'Site not found')

    const base = `${env.PUBLIC_SITE_SCHEME}://${req.params.slug}.${env.PUBLIC_ROOT_DOMAIN}`
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

  // ── GET /api/site/:slug/robots.txt ──────────────────────
  app.get('/:slug/robots.txt', async (req, reply) => {
    const bundle = await loadSiteBundle(req.params.slug)
    if (!bundle) throw httpError(404, 'Site not found')

    const base = `${env.PUBLIC_SITE_SCHEME}://${req.params.slug}.${env.PUBLIC_ROOT_DOMAIN}`
    const body = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`
    reply.type('text/plain').send(body)
  })
}
