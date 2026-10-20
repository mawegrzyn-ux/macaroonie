// src/config/env.js
import { z } from 'zod'

const schema = z.object({
  NODE_ENV:              z.enum(['development', 'production', 'test']).default('development'),
  // Unset: info in production, debug otherwise. The tests run with silent.
  LOG_LEVEL:             z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  PORT:                  z.coerce.number().default(3000),

  // PostgreSQL
  DATABASE_URL:          z.string().url(),

  // Redis (BullMQ + hold sweep)
  REDIS_URL:             z.string().default('redis://localhost:6379'),

  // Auth0
  AUTH0_DOMAIN:          z.string(),           // e.g. macaroonie.eu.auth0.com
  AUTH0_AUDIENCE:        z.string(),           // API identifier in Auth0

  // Auth0 Management API (for team invites). All optional —
  // if unset, /team/invite creates a local row only and the operator
  // must invite the user via the Auth0 dashboard.
  AUTH0_MGMT_CLIENT_ID:     z.string().optional(),
  AUTH0_MGMT_CLIENT_SECRET: z.string().optional(),
  AUTH0_INVITE_CLIENT_ID:   z.string().optional(), // SPA client_id users land in after accepting

  // Stripe
  STRIPE_SECRET_KEY:     z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),

  // Email (SendGrid)
  SENDGRID_API_KEY:      z.string().optional(),
  EMAIL_FROM:            z.string().email().default('noreply@macaroonie.com'),
  // Who gets an email for each register-interest form on the platform page
  // (routes/platformSite.js). Unset = stored only (Platform page lists them).
  INTEREST_NOTIFY_EMAIL: z.string().email().optional(),

  // Website CMS — file uploads + subdomain serving
  UPLOAD_DIR:            z.string().default('/home/ubuntu/app/uploads'),
  PUBLIC_ROOT_DOMAIN:    z.string().default('macaroonie.com'),
  PUBLIC_SITE_SCHEME:    z.enum(['http', 'https']).default('https'),

  // Apify (review scraper)
  APIFY_API_KEY:         z.string().optional(),
  // AI chat (migration 148). Unset = the assistant and the website chat are
  // off; the MCP connectors work without it (the client's AI does the talking).
  ANTHROPIC_API_KEY:     z.string().optional(),
  // Seals stored integration keys (services/vault.js, migration 179): 32
  // bytes, base64 or hex. Required in production; the deploy adds one to
  // api/.env when missing (scripts/ensure-secrets-key.sh). Back it up with
  // the .env: without it the stored keys can't be read.
  SECRETS_KEY:           z.string().optional(),
  // The main model, and the everyday one chats start on (src/ai/chat.js
  // moves a chat to the main model for files, big jobs and long chats).
  // AI_MODEL_FAST empty (or the same as AI_MODEL) = every chat on AI_MODEL.
  AI_MODEL:              z.string().default('claude-opus-5-5'),
  AI_MODEL_FAST:         z.string().default('claude-haiku-5-5'),
  AI_EFFORT:             z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  // Loyverse POS API (migration 154). Only changed for testing against a
  // stand-in server; tokens are per tenant, saved in Cash Recon settings.
  LOYVERSE_API_URL:      z.string().url().default('https://api.loyverse.com/v1.0'),

  // GloriaFood Accepted Orders API (poll). Only changed to test against a
  // stand-in server; keys are per venue, saved in Cash Recon settings.
  GLORIAFOOD_API_URL:    z.string().url().default('https://pos.globalfoodsoft.com'),

  // Card machines on the till and kiosks (migration 193,
  // services/cardMachines/). The URLs are only changed to test against
  // stand-in servers; keys are per tenant, saved in Till setup. Dojo gives
  // a software house id (and a reseller id) to the till software, so those
  // two are the platform's, sent with every Dojo call when set.
  DOJO_API_URL:          z.string().url().default('https://api.dojo.tech'),
  DOJO_SOFTWARE_HOUSE_ID: z.string().optional(),
  DOJO_RESELLER_ID:      z.string().optional(),
  STRIPE_API_URL:        z.string().url().default('https://api.stripe.com'),
  SUMUP_API_URL:         z.string().url().default('https://api.sumup.com'),

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
