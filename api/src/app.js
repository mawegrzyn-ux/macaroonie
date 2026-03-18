// src/app.js
import Fastify from 'fastify'
import cors    from '@fastify/cors'
import helmet  from '@fastify/helmet'
import jwt     from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'

import { env }          from './config/env.js'
import { errorHandler } from './middleware/error.js'

import venuesRoutes   from './routes/venues.js'
import schedulesRoutes from './routes/schedules.js'
import slotsRoutes    from './routes/slots.js'
import bookingsRoutes from './routes/bookings.js'
import paymentsRoutes, { webhookRoutes } from './routes/payments.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level:     env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  // ── Security ────────────────────────────────────────────
  await app.register(helmet, { global: true })
  await app.register(cors, {
    origin:      env.NODE_ENV === 'production'
      ? [/\.macaroonie\.com$/]   // restrict in production
      : true,
    credentials: true,
  })
  await app.register(rateLimit, {
    max:      200,
    timeWindow: '1 minute',
  })

  // ── JWT (used by auth middleware to verify Auth0 tokens) ─
  // Auth0 JWT verification is handled in auth.js via jwks-rsa JWKS.
  // @fastify/jwt is registered here only to attach req.jwtVerify() to the
  // Fastify instance; the actual secret is never used for validation.
  await app.register(jwt, {
    secret: 'placeholder-not-used-auth0-middleware-handles-verification',
  })

  // ── Routes ───────────────────────────────────────────────

  // Stripe webhook MUST be registered before any JSON body parser
  // so it receives the raw Buffer for signature verification.
  await app.register(webhookRoutes)

  await app.register(venuesRoutes,    { prefix: '/api/venues' })
  await app.register(schedulesRoutes, { prefix: '/api/venues' })
  await app.register(slotsRoutes,     { prefix: '/api/venues' })
  await app.register(bookingsRoutes,  { prefix: '/api/bookings' })
  await app.register(paymentsRoutes,  { prefix: '/api/payments' })

  // ── Health check ─────────────────────────────────────────
  app.get('/health', async () => ({ ok: true, env: env.NODE_ENV }))

  // ── Error handler ─────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  return app
}
