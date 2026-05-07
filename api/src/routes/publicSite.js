// src/routes/publicSite.js
//
// Public, unauthenticated JSON endpoints for tenant website data.
// One site per TENANT, keyed by tenant_site.subdomain_slug.

import { loadTenantBundle, loadLocationBundle } from '../services/siteDataSvc.js'
import { httpError } from '../middleware/error.js'
import { env }       from '../config/env.js'

export default async function publicSiteRoutes(app) {

  // ── GET /api/site/:slug ─────────────────────────────────
  // Tenant home bundle: brand identity, home_blocks, venues summary,
  // tenant-level pages.
  app.get('/:slug', async (req, reply) => {
    const bundle = await loadTenantBundle(req.params.slug)
    if (!bundle) throw httpError(404, 'Site not found or not published')
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    return bundle
  })

  // ── GET /api/site/:slug/locations/:venueSlug ────────────
  // Per-venue location-page bundle (gallery, hours, address, …).
  app.get('/:slug/locations/:venueSlug', async (req, reply) => {
    const tenantBundle = await loadTenantBundle(req.params.slug)
    if (!tenantBundle) throw httpError(404, 'Site not found')
    const bundle = await loadLocationBundle(tenantBundle, req.params.venueSlug)
    if (!bundle) throw httpError(404, 'Location not found')
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    return bundle
  })

  // ── GET /api/site/:slug/sitemap.xml ─────────────────────
  app.get('/:slug/sitemap.xml', async (req, reply) => {
    const bundle = await loadTenantBundle(req.params.slug)
    if (!bundle) throw httpError(404, 'Site not found')

    const base = `${env.PUBLIC_SITE_SCHEME}://${req.params.slug}.${env.PUBLIC_ROOT_DOMAIN}`
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

  // ── GET /api/site/:slug/robots.txt ──────────────────────
  app.get('/:slug/robots.txt', async (req, reply) => {
    const bundle = await loadTenantBundle(req.params.slug)
    if (!bundle) throw httpError(404, 'Site not found')

    const base = `${env.PUBLIC_SITE_SCHEME}://${req.params.slug}.${env.PUBLIC_ROOT_DOMAIN}`
    const body = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`
    reply.type('text/plain').send(body)
  })
}
