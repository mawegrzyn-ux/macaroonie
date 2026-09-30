// src/routes/platformSite.js
//
// The platform's own public page on the apex domain (macaroonie.com), once
// the admin portal has moved to office.macaroonie.com (services/platformHost.js).
//
// A global onRequest hook (fastify-plugin, so it isn't scoped to this
// plugin), apex host only:
//   GET /             the platform page with the register-interest form
//                     (views/platform/landing.eta)
//   GET /sw.js        a service worker that removes itself: the admin used to
//                     be installed on the apex, and its cached copy would keep
//                     showing instead of this page
//   GET /robots.txt   allow all
//   API paths         (/api, /manage, /reservations, /widget-api, /ws,
//                     /webhooks, /uploads, ...) pass through unchanged, so
//                     old guest links and the Stripe webhook keep working
//   any other GET     301 to the same path on office.macaroonie.com (old
//                     admin bookmarks)
//
// Route (any host, no auth, rate limited):
//   POST /api/platform-interest   { name, email, company?, phone?, sites?,
//                                    message?, consent: true, website: '' }
//                                  `website` is a honeypot: filled in = a bot,
//                                  answered with 204 and not stored.

import fp from 'fastify-plugin'
import { z } from 'zod'
import { sql } from '../config/db.js'
import { env } from '../config/env.js'
import { sendEmail } from '../services/emailSvc.js'
import { platformHostKind, officeOrigin, opsOrigin } from '../services/platformHost.js'

const PASS_PREFIXES = [
  '/api/', '/manage', '/reservations', '/widget-api', '/widget/', '/ws',
  '/webhooks/', '/uploads/', '/template-assets/', '/order-api',
]

const KILL_SW = `// The admin portal moved to __OFFICE__. This removes the old
// installed copy from this address so the platform page shows instead.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key)
    await self.registration.unregister()
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
  })())
})
`

const InterestBody = z.object({
  name:    z.string().trim().min(1).max(200),
  email:   z.string().trim().email().max(320),
  company: z.string().trim().max(200).optional().default(''),
  phone:   z.string().trim().max(50).optional().default(''),
  sites:   z.string().trim().max(50).optional().default(''),
  message: z.string().trim().max(4000).optional().default(''),
  consent: z.literal(true),
  website: z.string().max(200).optional().default(''),
})

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function notify(row, log) {
  const to = env.INTEREST_NOTIFY_EMAIL
  if (!to || !env.SENDGRID_API_KEY) return
  const lines = [
    ['Name', row.name], ['Email', row.email], ['Company', row.company], ['Phone', row.phone],
    ['Sites', row.sites], ['Message', row.message],
  ].filter(([, v]) => v)
  const html = `<p>New interest registered on ${esc(env.PUBLIC_ROOT_DOMAIN)}.</p><table>`
    + lines.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${k}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')
    + `</table><p><a href="${officeOrigin()}/platform">Open in Macaroonie</a></p>`
  await sendEmail({
    provider: 'sendgrid', credentials: { apiKey: env.SENDGRID_API_KEY },
    from: env.EMAIL_FROM, to, replyTo: row.email,
    subject: `Interest: ${row.name}${row.company ? ' (' + row.company + ')' : ''}`, html,
  }).catch(err => log.warn({ err }, 'interest notification email failed'))
}

async function platformSite(app) {
  app.addHook('onRequest', async (req, reply) => {
    if (platformHostKind(req.hostname || req.headers.host) !== 'apex') return
    if (req.method !== 'GET' && req.method !== 'HEAD') return
    const path = req.url.split('?')[0]
    if (PASS_PREFIXES.some(p => path === p.replace(/\/$/, '') || path.startsWith(p))) return

    if (path === '/') {
      reply.header('Cache-Control', 'public, max-age=0, must-revalidate')
      await reply.view('platform/landing.eta', {
        officeUrl: officeOrigin(), opsUrl: opsOrigin(),
        rootDomain: env.PUBLIC_ROOT_DOMAIN, year: new Date().getFullYear(),
      })
      return reply
    }
    if (path === '/sw.js') {
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
      reply.type('application/javascript').send(KILL_SW.replace('__OFFICE__', officeOrigin()))
      return reply
    }
    if (path === '/robots.txt') {
      reply.type('text/plain').send('User-agent: *\nAllow: /\n')
      return reply
    }
    reply.redirect(301, officeOrigin() + req.url)
    return reply
  })

  app.post('/api/platform-interest', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const body = InterestBody.parse(req.body)
    if (body.website) return reply.code(204).send()
    const [row] = await sql`
      INSERT INTO platform_interest (name, email, company, phone, sites, message, consent_at, ip, user_agent)
      VALUES (${body.name}, ${body.email}, ${body.company || null}, ${body.phone || null},
              ${body.sites || null}, ${body.message || null}, now(),
              ${req.ip ?? null}, ${String(req.headers['user-agent'] ?? '').slice(0, 500) || null})
      RETURNING *
    `
    notify(row, req.log)
    return reply.code(201).send({ ok: true })
  })
}

export default fp(platformSite, { name: 'platform-site' })
