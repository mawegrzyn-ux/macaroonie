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

  // Website CMS — file uploads + subdomain serving
  UPLOAD_DIR:            z.string().default('/home/ubuntu/app/uploads'),
  PUBLIC_ROOT_DOMAIN:    z.string().default('macaroonie.com'),
  PUBLIC_SITE_SCHEME:    z.enum(['http', 'https']).default('https'),

  // Storage driver — 'local' writes to UPLOAD_DIR, 's3' writes to an
  // S3-compatible bucket (AWS S3, DigitalOcean Spaces, Cloudflare R2, …).
  STORAGE_DRIVER:        z.enum(['local', 's3']).default('local'),
  S3_BUCKET:             z.string().optional(),
  S3_REGION:             z.string().optional(),
  S3_ENDPOINT:           z.string().optional(),        // e.g. https://fra1.digitaloceanspaces.com
  S3_PUBLIC_URL_BASE:    z.string().optional(),        // e.g. https://cdn.macaroonie.com
  S3_ACCESS_KEY_ID:      z.string().optional(),
  S3_SECRET_ACCESS_KEY:  z.string().optional(),
  S3_FORCE_PATH_STYLE:   z.coerce.boolean().default(false),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
