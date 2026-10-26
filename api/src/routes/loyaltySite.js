// src/routes/loyaltySite.js
//
// loyalty.{root}: every tenant's loyalty web app at /<website slug>, beside
// /loyalty on the tenant's own site (migration 211; the page is
// services/loyaltyPage.js). A global onRequest hook (fastify-plugin), this
// host only:
//   /loyalty-api, /uploads, /api      pass through to their routes
//   http:// (X-Forwarded-Proto)        redirected to https://
//   /                                  a short page about Macaroonie loyalty
//   /<slug>, /<slug>/manifest.webmanifest, /<slug>/sw.js  the tenant's app
//   anything else                      404

import fp from 'fastify-plugin'
import { systemSql } from '../config/db.js'
import { platformHostKind } from '../services/platformHost.js'
import { serveLoyaltyApp } from '../services/loyaltyPage.js'

const PASS_PREFIXES = ['/loyalty-api/', '/uploads/', '/api/']

const HOME = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loyalty</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f5f4;color:#1f2937;padding:16px}
.c{max-width:420px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px}</style></head>
<body><div class="c"><h1 style="margin-top:0">Loyalty cards</h1><p>Open the loyalty link from your restaurant's website, receipt or kiosk to see your card.</p></div></body></html>`

async function plugin(app) {
  app.addHook('onRequest', async (req, reply) => {
    if (platformHostKind(req.headers.host) !== 'loyalty') return
    const url = String(req.url || '/').split('?')[0]
    if (PASS_PREFIXES.some(p => url.startsWith(p))) return
    if (req.headers['x-forwarded-proto'] === 'http') {
      reply.redirect('https://' + String(req.headers.host).split(':')[0] + req.url, 301)
      return reply
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { reply.code(404).send({ error: 'Not found' }); return reply }
    if (url === '/' || url === '') {
      reply.type('text/html; charset=utf-8').header('Cache-Control', 'public, max-age=300').send(HOME)
      return reply
    }
    const m = /^\/([a-z0-9-]{1,63})(\/manifest\.webmanifest|\/sw\.js|\/)?$/.exec(url)
    if (!m) { reply.code(404).type('text/plain').send('Not found'); return reply }
    const [row] = await systemSql`
      SELECT ts.tenant_id FROM tenant_site ts JOIN tenants t ON t.id = ts.tenant_id AND t.is_active
       WHERE ts.subdomain_slug = ${m[1]} LIMIT 1`
    const what = m[2] === '/manifest.webmanifest' ? 'manifest' : m[2] === '/sw.js' ? 'sw' : 'page'
    const out = row ? await serveLoyaltyApp(reply, { tenantId: row.tenant_id, slug: m[1], base: '/' + m[1], what }) : null
    if (!out) { reply.code(404).type('text/html; charset=utf-8').send(HOME); return reply }
    return reply
  })
}

export default fp(plugin, { name: 'loyalty-site' })
