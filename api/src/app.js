// src/app.js
import Fastify   from 'fastify'
import cors      from '@fastify/cors'
import helmet    from '@fastify/helmet'
import jwt       from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifyView  from '@fastify/view'
import { Eta }   from 'eta'
import path      from 'node:path'
import fs        from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { env }          from './config/env.js'
import { errorHandler } from './middleware/error.js'
import { refuseOtherTenantsVenues } from './middleware/venue.js'
import { recordSharedChange } from './middleware/sharedDevice.js'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from './middleware/auth.js'

// The plugins whose place matters stay here: the host sites (their global
// onRequest hooks come before every route), the payment webhooks and the
// tenant site renderer. Every other route plugin is in an area file (AREAS).
import platformSite       from './routes/platformSite.js'
import posSite            from './routes/posSite.js'
import screenSite         from './routes/screenSite.js'
import installerSite      from './routes/installerSite.js'
import loyaltySite        from './routes/loyaltySite.js'
import { paymentWebhookRoutes }    from './routes/orderApi.js'
import { gloriafoodWebhookRoutes } from './routes/gloriafood.js'
import siteRendererRoutes from './routes/siteRenderer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The feature routes, one file per area (docs/PARALLEL_WORK.md 3.5):
// api/src/areas/<area>.js exports routes: [[plugin, options], ...]. Every
// file in the folder, by name; loaded once, when this file is first imported.
const AREAS_DIR = path.join(__dirname, 'areas')
const AREAS = []
for (const file of fs.readdirSync(AREAS_DIR).filter(f => f.endsWith('.js')).sort()) {
  const { routes } = await import(pathToFileURL(path.join(AREAS_DIR, file)).href)
  if (!Array.isArray(routes)) throw new Error('areas/' + file + ' must export routes: [[plugin, options], ...]')
  AREAS.push({ area: file.slice(0, -3), routes })
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level:     env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug'),
      transport: env.NODE_ENV !== 'production' && env.LOG_LEVEL !== 'silent'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    trustProxy: true,   // respect X-Forwarded-* from Nginx
  })

  // Every route as it is added: the cross-tenant sweep in api/test calls
  // each one that takes an id. Each route also gets the check that refuses
  // another tenant's venue id in its query or body (middleware/venue.js),
  // last, so it runs after the plugin's requireAuth has set req.tenantId.
  const routeList = []
  app.decorate('routeList', routeList)
  // Each change made on a shared device, with the person it was made as
  // (middleware/sharedDevice.js, migration 280).
  app.addHook('onResponse', recordSharedChange)
  app.addHook('onRoute', r => {
    for (const method of [].concat(r.method)) routeList.push({ method, url: r.url })
    const pre = [].concat(r.preHandler || [])
    if (!pre.includes(refuseOtherTenantsVenues)) r.preHandler = [...pre, refuseOtherTenantsVenues]
  })

  // ── Security ────────────────────────────────────────────
  // Helmet's CSP is incompatible with the inline styles/scripts we emit in SSR
  // templates for per-tenant themes, GA, FB pixel. Disable CSP only.
  await app.register(helmet, { global: true, contentSecurityPolicy: false })

  await app.register(cors, {
    origin:      env.NODE_ENV === 'production'
      ? [new RegExp(`\\.${env.PUBLIC_ROOT_DOMAIN.replace(/\./g, '\\.')}$`)]
      : true,
    credentials: true,
  })
  await app.register(rateLimit, {
    max:      200,
    timeWindow: '1 minute',
    // The AI tools call the API in-process (app.inject, src/ai/context.js):
    // those requests all come from 127.0.0.1 and would share one bucket.
    // The outer request (/mcp, the chat) is already counted.
    allowList: req => req.headers[INTERNAL_CALL_HEADER] === INTERNAL_CALL_SECRET,
  })

  // Guest /manage forms POST as application/x-www-form-urlencoded.
  // Fastify 4 only parses JSON by default — without this, Save changes
  // returns 415 Unsupported Media Type.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body)))
      } catch (err) {
        done(err)
      }
    },
  )

  // ── Multipart uploads (website builder) ─────────────────
  await app.register(multipart, {
    limits: {
      fileSize: 30 * 1024 * 1024,   // 30 MB hard ceiling; route enforces tighter limits
      files:    1,
      fields:   5,
    },
  })

  // ── JWT (used by auth middleware to verify Auth0 tokens) ─
  await app.register(jwt, {
    secret: 'placeholder-not-used-auth0-middleware-handles-verification',
  })

  // ── View engine for tenant SSR sites ────────────────────
  // Ensure upload directory exists at boot so @fastify/static is happy.
  try { fs.mkdirSync(env.UPLOAD_DIR, { recursive: true }) } catch { /* ignore */ }

  const eta = new Eta({
    views:      path.join(__dirname, 'views'),
    cache:      env.NODE_ENV === 'production',
    autoEscape: true,
  })
  await app.register(fastifyView, {
    engine:   { eta },
    root:     path.join(__dirname, 'views'),
    viewExt:  'eta',
    propertyName: 'view',
  })

  // ── Uploaded files (served on all hosts) ────────────────
  await app.register(fastifyStatic, {
    root:   env.UPLOAD_DIR,
    prefix: '/uploads/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '30d',
  })

  // ── Template-shipped assets (icons, dividers, etc.) ─────
  // Lives in api/public/template-assets/{template_key}/... and is served at
  // /template-assets/{template_key}/... — same on apex, subdomain, custom-domain.
  await app.register(fastifyStatic, {
    root:   path.join(__dirname, '..', 'public', 'template-assets'),
    prefix: '/template-assets/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '30d',
  })

  // ── Error handler ─────────────────────────────────────────
  // Before any route plugin: each plugin keeps the error handler that is
  // set when it is registered, so a handler set after the routes never
  // runs (every error then went out as Fastify's default body, with the
  // status text in `error` instead of the message).
  app.setErrorHandler(errorHandler)

  // ── Routes ───────────────────────────────────────────────

  // The platform page on the apex domain (register interest) and the
  // redirect of old admin paths there to office.{root}. Its hook is global,
  // so it is registered before every route plugin.
  await app.register(platformSite)
  // The till app on pos.{root} (routes/posSite.js); global hook like platformSite.
  await app.register(posSite)
  // Menu screens' player on screens.{root} (routes/screenSite.js).
  await app.register(screenSite)
  // The installer app (the admin build) on installer.{root} (routes/installerSite.js).
  await app.register(installerSite)
  // Every tenant's loyalty web app on loyalty.{root}/<slug> (routes/loyaltySite.js).
  await app.register(loyaltySite)

  // Payment gateway webhooks (raw body, per gateway): web orders, and on
  // the Stripe Connect endpoint booking deposits too.
  await app.register(paymentWebhookRoutes)
  // GloriaFood "Push Accepted Order" (migration 159): POST /webhooks/gloriafood/:token
  await app.register(gloriafoodWebhookRoutes)

  // Tenant SSR site renderer.
  // Only fires when the Host header matches `{slug}.{PUBLIC_ROOT_DOMAIN}` and
  // the slug is not reserved (api, www, …). All handlers short-circuit with
  // reply.callNotFound() when no subdomain is present, so requests from the
  // bare root domain (e.g. macaroonie.com/api/health) fall through cleanly to
  // the /api/* routes registered below. No path conflicts because the site
  // routes only use '/', '/menu', '/menu/:id', '/p/:pageSlug', '/sitemap.xml',
  // '/robots.txt' — none of which shadow '/api/*' or '/uploads/*'.
  await app.register(siteRendererRoutes)

  // Feature routes: every area file's (AREAS, above), after everything
  // above, area by area in name order. A route plugin's place among the
  // others doesn't matter: Fastify matches routes by path, not order.
  for (const { routes } of AREAS) {
    for (const [plugin, opts] of routes) await app.register(plugin, opts)
  }

  // ── Health check ─────────────────────────────────────────
  app.get('/api/health', async () => ({ ok: true, env: env.NODE_ENV }))


  return app
}
