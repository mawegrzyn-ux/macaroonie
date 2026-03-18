// src/config/env.js
import { z } from 'zod'

const schema = z.object({
  NODE_ENV:              z.enum(['development', 'production', 'test']).default('development'),
  PORT:                  z.coerce.number().default(3000),

  // PostgreSQL
  DATABASE_URL:          z.string().url(),

  // Redis (BullMQ + hold sweep)
  REDIS_URL:             z.string().default('redis://localhost:6379'),

  // Auth0
  AUTH0_DOMAIN:          z.string(),           // e.g. macaroonie.eu.auth0.com
  AUTH0_AUDIENCE:        z.string(),           // API identifier in Auth0

  // Stripe
  STRIPE_SECRET_KEY:     z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),

  // Email (SendGrid)
  SENDGRID_API_KEY:      z.string().optional(),
  EMAIL_FROM:            z.string().email().default('noreply@macaroonie.com'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
