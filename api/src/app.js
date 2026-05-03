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
import { fileURLToPath } from 'node:url'

import { env }          from './config/env.js'
import { errorHandler } from './middleware/error.js'

import venuesRoutes     from './routes/venues.js'
import schedulesRoutes  from './routes/schedules.js'
import slotsRoutes      from './routes/slots.js'
import bookingsRoutes   from './routes/bookings.js'
import customersRoutes  from './routes/customers.js'
import paymentsRoutes, { webhookRoutes } from './routes/payments.js'
import websiteRoutes    from './routes/website.js'
import publicSiteRoutes from './routes/publicSite.js'
import siteRendererRoutes from './routes/siteRenderer.js'
import cashReconRoutes  from './routes/cashRecon.js'
import manageBookingRoutes  from './routes/manageBooking.js'
import emailTemplateRoutes from './routes/emailTemplates.js'
import platformRoutes      from './routes/platform.js'
import teamRoutes          from './routes/team.js'
import accessRoutes        from './routes/access.js'
import emailMonitoringRoutes from './routes/emailMonitoring.js'
import mediaRoutes          from './routes/media.js'
import widgetApiRoutes      from './routes/widgetApi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const app = Fastify({
    logger: {
      level:     env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    trustProxy: true,   // respect X-Forwarded-* from Nginx
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
  })

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

  // ── Routes ───────────────────────────────────────────────

  // Stripe webhook first — must bypass JSON body parser
  await app.register(webhookRoutes)

  // Tenant SSR site renderer.
  // Only fires when the Host header matches `{slug}.{PUBLIC_ROOT_DOMAIN}` and
  // the slug is not reserved (api, www, …). All handlers short-circuit with
  // reply.callNotFound() when no subdomain is present, so requests from the
  // bare root domain (e.g. macaroonie.com/api/health) fall through cleanly to
  // the /api/* routes registered below. No path conflicts because the site
  // routes only use '/', '/menu', '/menu/:id', '/p/:pageSlug', '/sitemap.xml',
  // '/robots.txt' — none of which shadow '/api/*' or '/uploads/*'.
  await app.register(siteRendererRoutes)

  // API routes
  await app.register(venuesRoutes,     { prefix: '/api/venues' })
  await app.register(schedulesRoutes,  { prefix: '/api/venues' })
  await app.register(slotsRoutes,      { prefix: '/api/venues' })
  await app.register(bookingsRoutes,   { prefix: '/api/bookings' })
  await app.register(customersRoutes,  { prefix: '/api/customers' })
  await app.register(paymentsRoutes,   { prefix: '/api/payments' })
  await app.register(websiteRoutes,    { prefix: '/api/website' })
  await app.register(cashReconRoutes,  { prefix: '/api/venues' })
  await app.register(publicSiteRoutes,     { prefix: '/api/site' })
  await app.register(emailTemplateRoutes, { prefix: '/api/email-templates' })
  await app.register(platformRoutes,      { prefix: '/api' })
  await app.register(teamRoutes,          { prefix: '/api/team' })
  await app.register(accessRoutes,        { prefix: '/api/access' })
  await app.register(emailMonitoringRoutes, { prefix: '/api/email-monitoring' })
  await app.register(mediaRoutes,            { prefix: '/api/media' })
  await app.register(widgetApiRoutes,        { prefix: '/widget-api' })
  await app.register(manageBookingRoutes, { prefix: '/manage' })

  // ── Health check ─────────────────────────────────────────
  app.get('/api/health', async () => ({ ok: true, env: env.NODE_ENV }))

  // ── Error handler ─────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  return app
}
