// src/routes/website.js
//
// Tenant Website Builder — authenticated admin CRUD.
//
// Architecture (post-migration 043): one site per TENANT.
//   tenant_site (singleton per tenant) — site identity (subdomain,
//     custom domain, home_blocks, SEO, brand defaults, emergency banner)
//   website_config (one per venue)     — per-location page content
//     (hero, gallery, hours, address, menus, allergens, contact)
//
// Public site rendering lives in ./siteRenderer.js — this file is admin-only.

import { z }     from 'zod'
import crypto    from 'node:crypto'
import dns        from 'node:dns/promises'
import fs         from 'node:fs/promises'
import { withTenant, sql, systemSql } from '../config/db.js'
import { env }    from '../config/env.js'
import { getStorage } from '../services/storageSvc.js'
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { normalizeBimiSvg } from '../services/bimiSvg.js'
import { loadOpeningHours } from '../services/siteDataSvc.js'
import { RESERVED_SUBDOMAINS, STAGING_PREFIX } from './siteRenderer.js'
import { publishTenantSite, overrideStagingWithProduction, publishStatus } from '../services/publishSvc.js'
import { ensureSystemPages } from '../services/systemPages.js'
import { SYSTEM_PAGES } from '../../../shared/sitePages.js'
import { publishQueue } from '../jobs/queues.js'
import { hashPassword, loadStagingAccess, previewKey, stagingOrigin, MIN_PASSWORD } from '../services/stagingAccess.js'
import { ICON_MIME, mayBeIcon, isIcon } from '../utils/icon.js'

// Website permission: view reads, manage changes. GET /tenant-site stays open
// (Ordering setup, Emails and Promotions read the site's settings), and image
// uploads also serve Promotions and Menus.
const PERM = {
  view:   requirePermission('website', 'view'),
  manage: requirePermission('website', 'manage'),
  upload: requireAnyPermission(['website', 'promotions', 'menus'], 'manage'),
}

// ── Schemas ──────────────────────────────────────────────────

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}){1,2}$/

// A `staging-` prefix is reserved globally — that's where every tenant's
// own staging site lives (see migrations/082_website_staging_production.sql
// and siteRenderer.js's resolveSiteHost). Without this, an operator could
// claim e.g. subdomain_slug = 'staging-foo', which would collide with
// tenant "foo"'s staging host. RESERVED_SUBDOMAINS is the same infra-name
// list resolveSiteHost() itself refuses to treat as a tenant site.
const SlugSchema = z.string()
  .min(1).max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens')
  .refine(s => !s.startsWith(STAGING_PREFIX), '"staging-" is a reserved prefix')
  .refine(s => !RESERVED_SUBDOMAINS.has(s), 'That subdomain is reserved')

const SchedulePublishBody = z.object({
  at: z.coerce.date(),
})

// null removes the staging password.
const StagingAccessBody = z.object({
  password: z.string()
    .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters`)
    .max(200)
    .refine(s => s.trim().length > 0, 'Use at least one letter or number')
    .nullable(),
})

const SocialLinksSchema = z.record(z.string(), z.string().url().or(z.literal('')))

const OrderingLink = z.object({
  name:     z.string().min(1).max(100),
  url:      z.string().url(),
  logo_key: z.string().optional(),
})

const DeliveryLink = z.object({
  provider: z.enum(['deliveroo', 'justeat', 'ubereats', 'gogetters', 'foodhub', 'other']),
  url:      z.string().url(),
  label:    z.string().optional(),
})

const ThemeSchema = z.object({
  colors: z.object({
    primary:    z.string().regex(HEX_COLOUR).optional(),
    accent:     z.string().regex(HEX_COLOUR).optional(),
    background: z.string().regex(HEX_COLOUR).optional(),
    surface:    z.string().regex(HEX_COLOUR).optional(),
    text:       z.string().regex(HEX_COLOUR).optional(),
    muted:      z.string().regex(HEX_COLOUR).optional(),
    border:     z.string().regex(HEX_COLOUR).optional(),
    // Behind the page colour (head.eta); was missing here, so Zod dropped it on save.
    background_image: z.string().max(2000).nullable().optional(),
  }).partial().optional(),
  typography: z.object({
    heading_font:    z.string().max(100).optional(),
    body_font:       z.string().max(100).optional(),
    base_size_px:    z.number().int().min(12).max(22).optional(),
    heading_scale:   z.number().min(1).max(2).optional(),
    heading_weight:  z.number().int().min(300).max(900).optional(),
    body_weight:     z.number().int().min(300).max(900).optional(),
    line_height:     z.number().min(1).max(2.4).optional(),
    letter_spacing:  z.string().max(20).optional(),
  }).partial().optional(),
  spacing: z.object({
    container_max_px:     z.number().int().min(600).max(1600).optional(),
    boxed_step:           z.number().int().min(1).max(5).optional(),
    boxed_step_mobile:    z.number().int().min(1).max(5).optional().nullable(),
    // Per-tenant override of what each of the 5 boxed-inset steps actually
    // means. Falls back to DEFAULT_BOXED_STEPS (16/24/40/64/96px) in
    // head.eta / boxedLayout.js when absent or the wrong length. Always
    // exactly 5 entries — step numbers (1-5) referenced by boxed_step,
    // boxed_step_mobile, and every block's own boxed_step override all
    // index into this same array. mobile_value/mobile_unit are optional and
    // apply on phone portrait only (head.eta); they must be listed here or
    // Zod strips them on save.
    boxed_steps: z.array(z.object({
      value:        z.number().min(0).max(200),
      unit:         z.enum(['px', '%']),
      mobile_value: z.number().min(0).max(200).optional(),
      mobile_unit:  z.enum(['px', '%']).optional(),
    })).length(5).optional(),
    section_y_px:         z.number().int().min(16).max(200).optional(),
    section_y_mobile_px:  z.number().int().min(12).max(160).optional(),
    gap_px:               z.number().int().min(4).max(60).optional(),
  }).partial().optional(),
  radii: z.object({
    sm_px: z.number().int().min(0).max(32).optional(),
    md_px: z.number().int().min(0).max(48).optional(),
    lg_px: z.number().int().min(0).max(80).optional(),
  }).partial().optional(),
  logo: z.object({
    height_px:          z.number().int().min(16).max(120).optional(),
    show_name_beside:   z.boolean().optional(),
  }).partial().optional(),
  buttons: z.object({
    radius_px:     z.number().int().min(0).max(40).optional(),
    padding_y_px:  z.number().int().min(4).max(32).optional(),
    padding_x_px:  z.number().int().min(4).max(60).optional(),
    weight:        z.number().int().min(300).max(900).optional(),
  }).partial().optional(),
  hero: z.object({
    overlay_opacity:  z.number().min(0).max(1).optional(),
    min_height_px:    z.number().int().min(200).max(900).optional(),
  }).partial().optional(),
}).strict()

const BlockSchema = z.object({
  id:   z.string(),
  type: z.string(),
  data: z.record(z.string(), z.any()).default({}),
})

// Tenant-level site config (the "one site" table).
const TenantSiteBody = z.object({
  // Identity
  site_name:        z.string().max(200).nullable().optional(),
  brand_name:       z.string().max(200).nullable().optional(),
  tagline:          z.string().max(300).nullable().optional(),
  logo_url:         z.string().nullable().optional(),
  favicon_url:      z.string().nullable().optional(),
  bimi_svg:         z.string().max(65536).nullable().optional(),
  primary_colour:   z.string().regex(HEX_COLOUR).optional(),
  secondary_colour: z.string().regex(HEX_COLOUR).nullable().optional(),
  font_family:      z.string().max(100).optional(),

  // Domain
  subdomain_slug:   SlugSchema.optional(),
  custom_domain:    z.string().toLowerCase().max(253).nullable().optional(),

  // Template + theme
  template_key:     z.enum(['classic', 'modern', 'onethai']).optional(),
  theme:            ThemeSchema.optional(),

  // Home page
  home_blocks:      z.array(BlockSchema).nullable().optional(),

  // Locations index
  hide_locations_index: z.boolean().optional(),
  locations_heading:    z.string().max(200).nullable().optional(),
  locations_intro:      z.string().nullable().optional(),

  // Default widget venue (skips location picker on home embed)
  default_widget_venue_id: z.string().uuid().nullable().optional(),

  // Tenant-level booking widget defaults — every booking_widget block
  // inherits these unless overridden on the block itself. All fields
  // optional; render path applies defaults for anything missing.
  // Colour fields accept theme role names ('primary'|'accent'|'background'|
  // 'surface'|'text'|'muted'|'border'), an empty string, or null. Legacy
  // hex values are also accepted so existing tenant rows keep validating
  // until the pre-prod data is rewritten.
  widget_settings: z.object({
    header_show:       z.boolean().nullable().optional(),
    header_text:       z.string().max(120).nullable().optional(),
    subheader_text:    z.string().max(160).nullable().optional(),
    button_bg:         z.string().max(60).nullable().optional(),
    button_fg:         z.string().max(60).nullable().optional(),
    button_radius_px:  z.number().int().min(0).max(40).nullable().optional(),
    card_radius_px:    z.number().int().min(0).max(40).nullable().optional(),
    border_colour:     z.string().max(60).nullable().optional(),
    font_family:       z.string().max(100).nullable().optional(),
    font_size_px:      z.number().int().min(11).max(22).nullable().optional(),
    /* Per-element typography. Each can override the base widget font. */
    font_calendar_family: z.string().max(100).nullable().optional(),
    font_calendar_size_px:z.number().int().min(10).max(28).nullable().optional(),
    font_slots_family:    z.string().max(100).nullable().optional(),
    font_slots_size_px:   z.number().int().min(10).max(28).nullable().optional(),
    /* Calendar day colours (theme role names; legacy hex still accepted). */
    cal_open_bg:        z.string().max(60).nullable().optional(),
    cal_open_fg:        z.string().max(60).nullable().optional(),
    cal_open_border:    z.string().max(60).nullable().optional(),
    cal_closed_bg:      z.string().max(60).nullable().optional(),
    cal_closed_fg:      z.string().max(60).nullable().optional(),
    cal_closed_border:  z.string().max(60).nullable().optional(),
    large_party_text:  z.string().max(300).nullable().optional(),
    debug_enabled:     z.boolean().nullable().optional(),
  }).optional(),

  // SEO
  meta_title:       z.string().max(200).nullable().optional(),
  meta_description: z.string().max(500).nullable().optional(),
  og_image_url:     z.string().nullable().optional(),

  // Analytics
  ga4_measurement_id: z.string().max(50).nullable().optional(),
  fb_pixel_id:        z.string().max(50).nullable().optional(),

  // Brand-level socials cascade to every location
  social_links:     SocialLinksSchema.optional(),

  // Emergency banner (cascades to every location)
  banner_enabled:   z.boolean().optional(),
  banner_text:      z.string().max(500).nullable().optional(),
  banner_link_url:  z.string().max(500).nullable().optional(),
  banner_link_text: z.string().max(100).nullable().optional(),
  banner_severity:  z.enum(['info', 'warn', 'alert']).optional(),

  // Shared site-wide header / footer — the default every page uses
  // unless that specific page adds its own header/footer block (a
  // page-level override) or turns header/footer off entirely via
  // home_show_header / home_show_footer below. Same data shape as the
  // header/footer block's `data` (see
  // api/src/views/site/blocks/{header,footer}.eta) — kept as a loose
  // record like BlockSchema.data rather than a strict schema so the two
  // stay interchangeable without duplicating validation.
  header_config:    z.record(z.string(), z.any()).nullable().optional(),
  footer_config:    z.record(z.string(), z.any()).nullable().optional(),
  home_show_header: z.boolean().optional(),
  home_show_footer: z.boolean().optional(),

  // Cookie consent banner
  cookies_banner_enabled:     z.boolean().optional(),
  cookies_banner_text:        z.string().max(500).nullable().optional(),
  cookies_banner_accept_text: z.string().max(40).optional(),
  cookies_banner_decline_text: z.string().max(40).nullable().optional(),

  // Publishing
  is_published:     z.boolean().optional(),
})

// Per-venue location-page config (location-specific content only).
const VenueConfigBody = z.object({
  hero_image_url:   z.string().nullable().optional(),
  hero_heading:     z.string().max(200).nullable().optional(),
  hero_subheading:  z.string().max(500).nullable().optional(),
  hero_cta_text:    z.string().max(100).nullable().optional(),
  hero_cta_link:    z.string().max(500).nullable().optional(),

  about_heading:    z.string().max(200).nullable().optional(),
  about_text:       z.string().nullable().optional(),
  about_html:       z.string().nullable().optional(),
  about_image_url:  z.string().nullable().optional(),

  address_line1:    z.string().nullable().optional(),
  address_line2:    z.string().nullable().optional(),
  city:             z.string().nullable().optional(),
  postcode:         z.string().nullable().optional(),
  country:          z.string().length(2).nullable().optional(),
  latitude:         z.number().min(-90).max(90).nullable().optional(),
  longitude:        z.number().min(-180).max(180).nullable().optional(),
  google_maps_embed_url: z.string().nullable().optional(),

  phone:            z.string().max(50).nullable().optional(),
  email:            z.string().email().nullable().optional(),

  // Per-location social handles override the tenant ones for this venue
  social_links:          SocialLinksSchema.optional(),
  online_ordering_links: z.array(OrderingLink).optional(),
  delivery_links:        z.array(DeliveryLink).optional(),

  widget_venue_id:  z.string().uuid().nullable().optional(),
  widget_theme:     z.enum(['light', 'dark']).optional(),

  og_image_url:     z.string().nullable().optional(),
  tagline:          z.string().max(300).nullable().optional(),
  site_name:        z.string().max(200).nullable().optional(),

  // SEO / AI structured data
  cuisine:          z.string().max(200).nullable().optional(),
  price_range:      z.string().max(20).nullable().optional(),

  primary_colour:   z.string().regex(HEX_COLOUR).optional(),
  secondary_colour: z.string().regex(HEX_COLOUR).nullable().optional(),
  font_family:      z.string().max(100).optional(),
  template_key:     z.enum(['classic', 'modern', 'onethai']).optional(),
  theme:            ThemeSchema.optional(),
  // When true, this venue's own brand/theme fields (identity, colours,
  // typography, layout — everything above from primary_colour through
  // theme, plus site_name/tagline/logo_url/favicon_url) fully REPLACE the
  // tenant default for this location's pages. When false (default), all of
  // those fields are ignored and the tenant's Brand & theme applies as-is
  // — no per-field blending. See BRAND_OVERRIDE_FIELDS in siteDataSvc.js.
  use_brand_override: z.boolean().optional(),

  show_booking_widget: z.boolean().optional(),
  show_menu:          z.boolean().optional(),
  show_allergens:     z.boolean().optional(),
  show_gallery:       z.boolean().optional(),
  gallery_style:      z.enum(['grid', 'pinterest', 'horizontal']).optional(),
  gallery_size:       z.enum(['small', 'medium', 'large']).optional(),
  opening_hours_source: z.enum(['manual', 'venue']).optional(),

  show_find_us:       z.boolean().optional(),
  show_contact:       z.boolean().optional(),
  show_ordering:      z.boolean().optional(),
  show_delivery:      z.boolean().optional(),

  // Off entirely for this location page — leave true to use the shared
  // tenant header_config/footer_config, or the location's own
  // header/footer block in page_blocks if it has one.
  show_header:        z.boolean().optional(),
  show_footer:        z.boolean().optional(),

  page_blocks: z.array(BlockSchema).nullable().optional(),
})

const GalleryBody = z.object({
  image_url:  z.string().min(1),
  caption:    z.string().max(300).nullable().optional(),
  sort_order: z.number().int().default(0),
})

const PageBody = z.object({
  slug:         z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100),
  title:        z.string().min(1).max(200),
  content:      z.string().nullable().optional(),
  blocks:       z.array(BlockSchema).nullable().optional(),
  kind:         z.enum(['page', 'modal']).default('page'),
  is_published: z.boolean().default(true),
  is_legal:     z.boolean().optional(),
  sort_order:   z.number().int().default(0),
  // Ignored for kind:'modal' (modals render as an overlay inside the
  // current page, not a standalone page with its own chrome).
  show_header:  z.boolean().optional(),
  show_footer:  z.boolean().optional(),
  // venue_id provided as query param, not in body
})

// ── Default content for the seeded legal pages ──────────────
// These are sensible templates the operator can edit afterwards. Restaurant-
// industry standard wording with placeholders for the operator's brand
// + contact details (replaced at seed time).
function defaultLegalContent(kind, { brandName, email }) {
  const today = new Date().toISOString().slice(0, 10)
  const contactLine = email
    ? `If you have any questions, contact us at <a href="mailto:${email}">${email}</a>.`
    : 'If you have any questions, please contact us.'

  if (kind === 'terms') {
    return `<h2>Terms &amp; Conditions</h2>
<p><em>Last updated ${today}</em></p>
<p>Welcome to ${brandName}. These terms govern your use of our website and the bookings made through it.</p>
<h3>Bookings</h3>
<p>Reservations made on this site are an offer to dine which we may accept or decline at our discretion. A booking is only confirmed once you receive an email confirmation from us. Where a deposit is required, the booking is held for the duration of the agreed window.</p>
<h3>Cancellations and amendments</h3>
<p>You may cancel or amend a booking using the link in your confirmation email, subject to the cancellation window for that venue. Late cancellations or no-shows may result in the deposit being retained.</p>
<h3>Allergens and dietary requirements</h3>
<p>If you or anyone in your party has a food allergy or intolerance, please tell us at the time of booking and again on arrival. Our kitchens handle allergens; we cannot guarantee any dish is free from cross-contamination.</p>
<h3>Liability</h3>
<p>Nothing in these terms excludes our liability for death or personal injury caused by negligence, fraud, or any other liability that cannot be excluded by law.</p>
<h3>Changes</h3>
<p>We may update these terms from time to time. The current version is always shown on this page.</p>
<p>${contactLine}</p>`
  }
  if (kind === 'privacy') {
    return `<h2>Privacy Policy</h2>
<p><em>Last updated ${today}</em></p>
<p>${brandName} is the controller of any personal data you provide via this site. This page explains what we collect and how we use it.</p>
<h3>What we collect</h3>
<ul>
<li><strong>Booking details</strong> — name, email, phone, party size, date/time, any notes you supply (e.g. allergens).</li>
<li><strong>Online orders</strong> — name, email, phone, what you ordered, any notes and allergy information you give. Used only to prepare your order and contact you about it.</li>
<li><strong>Marketing preferences</strong> — only when you explicitly opt in, for example by ticking the newsletter box at checkout.</li>
<li><strong>Site analytics</strong> — anonymous usage stats via Google Analytics / Meta Pixel where enabled. See our cookies policy.</li>
</ul>
<h3>How we use it</h3>
<p>To confirm and manage your reservation or order, to contact you about your visit or order, and where you have opted in, to send our newsletter. You can unsubscribe at any time by asking us.</p>
<h3>Sharing</h3>
<p>We use third parties (e.g. Stripe for payments, our email provider for transactional emails) under data-processor agreements. We do not sell your data.</p>
<h3>Your rights</h3>
<p>You have the right to access, correct, export, or delete your personal data at any time. Email us using the address below.</p>
<h3>Retention</h3>
<p>We keep booking records for the period needed to comply with tax and accounting law, then delete or anonymise.</p>
<p>${contactLine}</p>`
  }
  if (kind === 'cookies') {
    return `<h2>Cookies Policy</h2>
<p><em>Last updated ${today}</em></p>
<p>This page explains the cookies set by ${brandName} and how to manage them.</p>
<h3>Strictly necessary</h3>
<p>These cookies make the site work — for example to remember your booking step or that you have accepted this banner. They cannot be turned off.</p>
<h3>Analytics</h3>
<p>If you accept analytics cookies, we use Google Analytics (or similar) to understand traffic. These cookies do not personally identify you.</p>
<h3>Marketing</h3>
<p>If marketing pixels (e.g. Meta) are enabled, they set cookies that help us measure ad performance. You can opt out at any time.</p>
<h3>Managing cookies</h3>
<p>You can change your choice in your browser settings, or by clearing this site's cookies and reloading the page — the consent banner will appear again.</p>
<p>${contactLine}</p>`
  }
  return ''
}

const MenuBody = z.object({
  label:      z.string().min(1).max(100),
  file_url:   z.string().min(1),
  sort_order: z.number().int().default(0),
})

const OpeningHourRow = z.object({
  day_of_week: z.number().int().min(0).max(6),
  opens_at:    z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  closes_at:   z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  is_closed:   z.boolean().default(false),
  label:       z.string().max(50).nullable().optional(),
  sort_order:  z.number().int().default(0),
})

const AllergenBody = z.object({
  info_type:       z.enum(['document', 'structured']),
  document_url:    z.string().nullable().optional(),
  structured_data: z.array(z.object({
    dish:       z.string().min(1),
    allergens:  z.array(z.string()),
    notes:      z.string().optional(),
  })).optional(),
})

// ── Upload helpers ───────────────────────────────────────────

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif'])
const ALLOWED_DOC_MIME   = new Set(['application/pdf'])

const KIND_CONFIG = {
  images: { mimes: ALLOWED_IMAGE_MIME, maxBytes: 8  * 1024 * 1024 },
  menus:  { mimes: ALLOWED_DOC_MIME,   maxBytes: 25 * 1024 * 1024 },
  docs:   { mimes: ALLOWED_DOC_MIME,   maxBytes: 25 * 1024 * 1024 },
}

function extFromMime(mime) {
  switch (mime) {
    case 'image/jpeg':    return 'jpg'
    case 'image/png':     return 'png'
    case 'image/webp':    return 'webp'
    case 'image/svg+xml': return 'svg'
    case 'image/gif':     return 'gif'
    case ICON_MIME:       return 'ico'
    case 'application/pdf': return 'pdf'
    default:              return 'bin'
  }
}

async function ensureVenueConfig(tx, tenantId, venueId) {
  if (!venueId) return null
  const [cfg] = await tx`
    SELECT * FROM website_config
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
  `
  return cfg ?? null
}

async function ensureTenantSite(tx, tenantId) {
  const [row] = await tx`
    SELECT * FROM tenant_site WHERE tenant_id = ${tenantId} LIMIT 1
  `
  if (row) return row
  const [created] = await tx`
    INSERT INTO tenant_site (tenant_id) VALUES (${tenantId})
    ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
    RETURNING *
  `
  // Every site gets the built-in pages: Order online (migration 126) and
  // Loyalty (migration 214).
  await ensureSystemPages(tx, tenantId)
  return created
}

// ── Custom domains ───────────────────────────────────────────
//
// A custom domain only reaches the site once this server has an nginx block
// for it (scripts/nginx-custom-domain.sh). Without one, nginx answers the
// domain from its default server: a bare 404. The domain sync
// (scripts/custom-domains-sync.sh, a systemd timer installed by the deploy)
// writes those blocks for verified domains and reports progress in
// DOMAIN_SYNC_DIR; the API only reads that and writes `kick` to start a run.

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const NGINX_SITES_ENABLED = process.env.NGINX_SITES_ENABLED || '/etc/nginx/sites-enabled'
const DOMAIN_SYNC_DIR     = process.env.DOMAIN_SYNC_DIR     || '/var/lib/macaroonie-domains'
// The sync runs every minute; older than this means it isn't running here.
const SYNC_FRESH_MS = 5 * 60_000

/** The domain as guests type it: lower case, no scheme, path, port or
 *  trailing dot. Empty → null. Our own addresses are refused. */
export function cleanCustomDomain(value) {
  if (value == null) return null
  const host = String(value).trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
  if (!host) return null
  if (!HOSTNAME_RE.test(host)) {
    throw httpError(422, `"${String(value).trim()}" isn't a domain name. Type it like www.yourrestaurant.com.`)
  }
  const root = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
  if (host === root || host.endsWith('.' + root)) {
    throw httpError(422, `${host} is a Macaroonie address, and your site already has one. Enter a domain you own, like www.yourrestaurant.com.`)
  }
  return host
}

/** The IPs a custom domain's A records should point at: whatever the site's
 *  own Macaroonie address and the root domain resolve to, plus APP_PUBLIC_IPS. */
async function platformIps(slug) {
  const root = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
  const names = [...new Set([slug ? `${slug}.${root}` : null, root].filter(Boolean))]
  const found = await Promise.all(names.map(n => dns.resolve4(n).catch(() => [])))
  const extra = (process.env.APP_PUBLIC_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
  return [...new Set([...extra, ...found.flat()])]
}

/** Whether this server serves the domain: 'https', 'http' (no certificate
 *  yet) or 'none'. null when this isn't the nginx server (local dev). */
async function domainServerStatus(domain) {
  if (!domain || !HOSTNAME_RE.test(domain)) return null
  try { await fs.access(NGINX_SITES_ENABLED) } catch { return null }
  try {
    const conf = await fs.readFile(`${NGINX_SITES_ENABLED}/macaroonie-domain-${domain}`, 'utf8')
    return /listen\s+443/.test(conf) ? 'https' : 'http'
  } catch {
    return 'none'
  }
}

/** What the domain sync says about the domain. `auto`: the sync has run in
 *  the last few minutes, so it will switch the domain on by itself. `state`:
 *  its last word on this domain ({ status: working | waiting_dns | http |
 *  error | https, message, attempts, next_try (ms) }), or null. */
async function domainSyncInfo(domain) {
  let auto = false
  try {
    const st = await fs.stat(`${DOMAIN_SYNC_DIR}/last-run`)
    auto = Date.now() - st.mtimeMs < SYNC_FRESH_MS
  } catch { /* not installed */ }
  let state = null
  if (domain && HOSTNAME_RE.test(domain)) {
    try {
      const s = JSON.parse(await fs.readFile(`${DOMAIN_SYNC_DIR}/${domain}.json`, 'utf8'))
      state = {
        status:   s.status || null,
        message:  s.message || null,
        attempts: Number(s.attempts) || 0,
        next_try: s.next_try ? Number(s.next_try) * 1000 : null,
      }
    } catch { /* no word yet */ }
  }
  return { auto, state }
}

/** Ask the domain sync to run now (it otherwise runs within a minute). */
async function kickDomainSync() {
  try { await fs.writeFile(`${DOMAIN_SYNC_DIR}/kick`, `${Date.now()}\n`) } catch { /* not installed */ }
}

async function domainServerFields(domain) {
  const [status, sync] = await Promise.all([domainServerStatus(domain), domainSyncInfo(domain)])
  return { server_status: status, server_auto: sync.auto, server_state: sync.state }
}

// ── Plugin ───────────────────────────────────────────────────

export default async function websiteRoutes(app) {

  app.addHook('preHandler', requireAuth)

  // ════════════════════════════════════════════════════════════
  //   TENANT-LEVEL SITE
  // ════════════════════════════════════════════════════════════

  // ── GET /website/tenant-site ────────────────────────────
  // Returns the tenant_site row, creating a stub if none exists.
  app.get('/tenant-site', async (req) => {
    return withTenant(req.tenantId, async tx => ensureTenantSite(tx, req.tenantId))
  })

  // ── PATCH /website/tenant-site ──────────────────────────
  app.patch('/tenant-site', { preHandler: PERM.manage}, async (req) => {
    const body = TenantSiteBody.parse(req.body)
    if ('custom_domain' in body) body.custom_domain = cleanCustomDomain(body.custom_domain)
    if ('bimi_svg' in body) {
      try {
        body.bimi_svg = normalizeBimiSvg(body.bimi_svg)
      } catch (e) {
        throw httpError(e.statusCode || 422, e.message)
      }
    }
    if (!Object.keys(body).length) throw httpError(400, 'No fields to update')

    let domainChanged = false
    const saved = await withTenant(req.tenantId, async tx => {
      const current = await ensureTenantSite(tx, req.tenantId)

      // The Domain section sends the domain with every save; only a new
      // domain clears verification (it used to on every save, so switching
      // "Site is live" took a verified domain offline).
      if ('custom_domain' in body) {
        if (body.custom_domain === (current.custom_domain || null)) {
          delete body.custom_domain
        } else {
          body.custom_domain_verified = false
          domainChanged = true
          if (body.custom_domain) {
            const [taken] = await tx`
              SELECT 1 FROM tenant_site
               WHERE lower(custom_domain) = ${body.custom_domain}
                 AND tenant_id <> ${req.tenantId}
               LIMIT 1
            `
            if (taken) throw httpError(409, `Another site already uses ${body.custom_domain}.`)
          }
        }
      }
      const fields = Object.keys(body)
      if (!fields.length) return current

      // Subdomain uniqueness check across tenants (table-level).
      if (body.subdomain_slug) {
        const [hit] = await tx`
          SELECT 1 FROM tenant_site
           WHERE subdomain_slug = ${body.subdomain_slug}
             AND tenant_id     <> ${req.tenantId}
           LIMIT 1
        `
        if (hit) throw httpError(409, 'Subdomain already taken')
      }

      // Locations' own brand and theme are left alone: they apply only while
      // a location has its own override (use_brand_override), as a whole.
      const [row] = await tx`
        UPDATE tenant_site
           SET ${tx(body, ...fields)}, updated_at = now()
         WHERE tenant_id = ${req.tenantId}
        RETURNING *
      `
      return row
    })
    // The old domain's server block comes off on the sync's next run.
    if (domainChanged) await kickDomainSync()
    return saved
  })

  // ── GET /website/tenant-site/dns-setup ──────────────────
  // Values the admin UI needs for the custom-domain how-to (CNAME target
  // and public A records). Auth required; not a secret — these are public DNS.
  app.get('/tenant-site/dns-setup', { preHandler: PERM.view }, async (req) => {
    const ts = await withTenant(req.tenantId, tx => ensureTenantSite(tx, req.tenantId))
    const root = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
    const slug = ts?.subdomain_slug || null
    return {
      root_domain:             root,
      subdomain_slug:          slug,
      custom_domain:           ts?.custom_domain || null,
      custom_domain_verified:  !!ts?.custom_domain_verified,
      cname_target:            slug ? `${slug}.${root}` : root,
      a_records:               await platformIps(slug),
      ...(await domainServerFields(ts?.custom_domain)),
    }
  })

  // ── GET /website/tenant-site/slug-available?slug=foo ────
  // Global uniqueness check.
  app.get('/tenant-site/slug-available', { preHandler: PERM.view }, async (req) => {
    const slug = SlugSchema.parse(req.query.slug)
    const [hit] = await systemSql`
      SELECT 1 FROM tenant_site
       WHERE subdomain_slug = ${slug}
         AND tenant_id     <> ${req.tenantId}
       LIMIT 1
    `
    return { available: !hit }
  })

  // ── POST /website/tenant-site/verify-domain ─────────────
  app.post('/tenant-site/verify-domain', { preHandler: PERM.manage}, async (req) => {
    const [ts] = await withTenant(req.tenantId, tx => tx`
      SELECT custom_domain, subdomain_slug FROM tenant_site
       WHERE tenant_id = ${req.tenantId}
    `)
    if (!ts?.custom_domain) throw httpError(422, 'No custom domain configured')

    const domain = ts.custom_domain
    const expectedCnameSuffix = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
    const expectedIps = await platformIps(ts.subdomain_slug)

    let aRecords = []
    let cnameRecords = []
    try { aRecords = await dns.resolve4(domain) }     catch { /* no A records */ }
    try { cnameRecords = await dns.resolveCname(domain) } catch { /* no CNAME */ }

    const cnameMatch = cnameRecords.some(c => c.toLowerCase().endsWith(expectedCnameSuffix))
    const aMatch     = expectedIps.length > 0 && aRecords.some(a => expectedIps.includes(a))
    const verified   = cnameMatch || aMatch

    await withTenant(req.tenantId, tx => tx`
      UPDATE tenant_site
         SET custom_domain_verified = ${verified}, updated_at = now()
       WHERE tenant_id = ${req.tenantId}
    `)

    // Verified: the sync switches it on (or retries a failed certificate) now.
    if (verified) await kickDomainSync()
    const server = await domainServerFields(domain)
    return {
      verified, domain,
      a_records:     aRecords,
      cname_records: cnameRecords,
      expected: { cname_suffix: expectedCnameSuffix, ips: expectedIps },
      ...server,
      hint: !verified
        ? `Point ${domain} with a CNAME to ${ts.subdomain_slug ? ts.subdomain_slug + '.' : ''}${expectedCnameSuffix}` +
          (expectedIps.length ? `, or an A record to ${expectedIps.join(' or ')}.` : '.')
        : server.server_status === 'https'
          ? 'Domain verified.'
          : server.server_auto
            ? `DNS is right. We're switching ${domain} on now; it usually takes a minute or two.`
            : server.server_status === 'none'
              ? `DNS is right. ${domain} still has to be switched on on our server; until then it shows a 404.`
              : 'Domain verified.',
    }
  })

  // ── Staging → production publishing ─────────────────────
  // See migrations/082_website_staging_production.sql. Editing always
  // happens on the live "staging" tables; production renders the frozen
  // published_snapshot until the next publish. cancelScheduledPublish
  // removes any pending delayed job so re-scheduling / publishing now /
  // cancelling never leaves a stale job to fire later.
  async function cancelScheduledPublish(tenantId) {
    const job = await publishQueue.getJob(`publish-${tenantId}`)
    if (job) await job.remove()
  }

  // ── POST /website/tenant-site/publish ───────────────────
  // Publish immediately — freezes current staging content as the new
  // published_snapshot and cancels any pending scheduled publish.
  // ── GET /website/tenant-site/publish-status ─────────────
  // Whether the live site matches staging; if not, what publishing would
  // change (Website menu areas, pages, locations). Shown by the Publish button.
  app.get('/tenant-site/publish-status', { preHandler: PERM.view }, async (req) => publishStatus(req.tenantId))

  app.post('/tenant-site/publish', { preHandler: PERM.manage}, async (req) => {
    await cancelScheduledPublish(req.tenantId)
    return publishTenantSite(req.tenantId)
  })

  // ── POST /website/tenant-site/schedule-publish ──────────
  // Body: { at: ISO timestamp in the future }. Replaces any existing
  // scheduled publish (one pending publish per tenant — jobId dedup).
  app.post('/tenant-site/schedule-publish', { preHandler: PERM.manage}, async (req) => {
    const { at } = SchedulePublishBody.parse(req.body)
    if (at.getTime() <= Date.now()) throw httpError(422, 'Scheduled time must be in the future')

    await cancelScheduledPublish(req.tenantId)
    await publishQueue.add('publish', { tenantId: req.tenantId }, {
      delay:            at.getTime() - Date.now(),
      jobId:            `publish-${req.tenantId}`,
      removeOnComplete: true,
      removeOnFail:     true,
    })

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tenant_site
         SET scheduled_publish_at = ${at.toISOString()}, updated_at = now()
       WHERE tenant_id = ${req.tenantId}
      RETURNING *
    `)
    return row
  })

  // ── DELETE /website/tenant-site/schedule-publish ────────
  // Cancels a pending scheduled publish. Does not touch published_snapshot.
  app.delete('/tenant-site/schedule-publish', { preHandler: PERM.manage}, async (req) => {
    await cancelScheduledPublish(req.tenantId)
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tenant_site
         SET scheduled_publish_at = NULL, updated_at = now()
       WHERE tenant_id = ${req.tenantId}
      RETURNING *
    `)
    return row
  })

  // ── Staging password (migration 158, services/stagingAccess.js) ──
  // GET: whether staging asks for a password (never the hash) and its
  // address. PUT { password | null }: set, change or remove it; any change
  // signs everyone out of staging. POST staging-link: the staging address
  // to open from here, with a 10-minute key when there is a password.
  async function stagingInfo(tenantId) {
    const [ts] = await withTenant(tenantId, tx => tx`
      SELECT subdomain_slug FROM tenant_site WHERE tenant_id = ${tenantId}
    `)
    const access = await loadStagingAccess(tenantId)
    return {
      slug: ts?.subdomain_slug || null,
      url: ts?.subdomain_slug ? stagingOrigin(ts.subdomain_slug) + '/' : null,
      access,
    }
  }
  const stagingView = ({ url, access }) => ({
    protected: !!access,
    updated_at: access?.updated_at || null,
    updated_by: access?.updated_by || null,
    url,
  })

  app.get('/tenant-site/staging-access', { preHandler: PERM.view }, async (req) => stagingView(await stagingInfo(req.tenantId)))

  app.put('/tenant-site/staging-access', { preHandler: PERM.manage}, async (req) => {
    const { password } = StagingAccessBody.parse(req.body)
    if (password === null) {
      await withTenant(req.tenantId, tx => tx`DELETE FROM staging_access WHERE tenant_id = ${req.tenantId}`)
    } else {
      const hash = await hashPassword(password)
      const by = req.user?.email || null
      await withTenant(req.tenantId, tx => tx`
        INSERT INTO staging_access (tenant_id, password_hash, updated_by, updated_at)
        VALUES (${req.tenantId}, ${hash}, ${by}, now())
        ON CONFLICT (tenant_id) DO UPDATE
          SET password_hash = EXCLUDED.password_hash, updated_by = EXCLUDED.updated_by, updated_at = now()
      `)
    }
    return stagingView(await stagingInfo(req.tenantId))
  })

  app.post('/tenant-site/staging-link', { preHandler: PERM.view }, async (req) => {
    const { url, access } = await stagingInfo(req.tenantId)
    if (!url) throw httpError(422, 'Set a subdomain in Domain to get a staging address.')
    if (!access) return { url, protected: false }
    return { url: url + '?staging_key=' + previewKey(req.tenantId, access.password_hash), protected: true }
  })

  // ── POST /website/tenant-site/override-staging ──────────
  // Discards in-progress staging edits, resetting the live draft tables
  // (tenant_site content, each venue's website_config, website_pages) to
  // whatever's in the last published snapshot. 409 if nothing's been
  // published yet.
  app.post('/tenant-site/override-staging', { preHandler: PERM.manage}, async (req) => {
    await overrideStagingWithProduction(req.tenantId)
    return withTenant(req.tenantId, tx => ensureTenantSite(tx, req.tenantId))
  })

  // ── Back-compat: brand-defaults endpoints alias tenant-site ─
  // (Old admin-portal builds use these. Both POST and PATCH do the same
  // upsert via ensureTenantSite — admin code may call POST when it thinks
  // the row doesn't exist yet, even though our GET always creates one.)
  app.get('/brand-defaults', { preHandler: PERM.view }, async (req) => {
    return withTenant(req.tenantId, async tx => ensureTenantSite(tx, req.tenantId))
  })

  async function brandDefaultsUpsert(req) {
    const body = TenantSiteBody.parse(req.body)
    // The domain changes only through PATCH /tenant-site (cleaning,
    // uniqueness, verification).
    delete body.custom_domain
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    return withTenant(req.tenantId, async tx => {
      await ensureTenantSite(tx, req.tenantId)
      const [row] = await tx`
        UPDATE tenant_site
           SET ${tx(body, ...fields)}, updated_at = now()
         WHERE tenant_id = ${req.tenantId}
        RETURNING *
      `
      return row
    })
  }

  app.patch('/brand-defaults', { preHandler: PERM.manage},
    async (req) => brandDefaultsUpsert(req))
  app.post('/brand-defaults',  { preHandler: PERM.manage},
    async (req) => brandDefaultsUpsert(req))

  // ════════════════════════════════════════════════════════════
  //   PER-VENUE LOCATION PAGE
  // ════════════════════════════════════════════════════════════

  // ── GET /website/configs ────────────────────────────────
  // Every venue's location-page config — used by the admin to show a
  // venue switcher with "configured / not configured" badges.
  app.get('/configs', { preHandler: PERM.view }, async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT v.id AS venue_id, v.name AS venue_name, v.slug AS venue_slug,
             wc.id AS config_id,
             wc.hero_image_url, wc.address_line1, wc.city,
             wc.show_booking_widget, wc.use_brand_override, wc.updated_at
        FROM venues v
        LEFT JOIN website_config wc ON wc.venue_id = v.id
       WHERE v.tenant_id = ${req.tenantId}
         AND v.is_active = true
       ORDER BY v.name
    `)
  })

  // ── GET /website/config?venue_id=X ──────────────────────
  app.get('/config', { preHandler: PERM.view }, async (req) => {
    const venueId = req.query.venue_id
    if (!venueId) throw httpError(400, 'venue_id is required')
    return withTenant(req.tenantId, async tx => {
      const cfg = await ensureVenueConfig(tx, req.tenantId, venueId)
      return cfg ?? {}
    })
  })

  // ── POST /website/config (create venue config row) ──────
  app.post('/config', { preHandler: PERM.manage}, async (req, reply) => {
    const venue_id = req.body?.venue_id || req.query.venue_id
    if (!venue_id) throw httpError(422, 'venue_id is required')

    const [cfg] = await withTenant(req.tenantId, async tx => {
      const [venue] = await tx`
        SELECT id FROM venues
         WHERE id = ${venue_id} AND tenant_id = ${req.tenantId} AND is_active = true
      `
      if (!venue) throw httpError(404, 'Venue not found')

      return tx`
        INSERT INTO website_config (tenant_id, venue_id)
        VALUES (${req.tenantId}, ${venue_id})
        ON CONFLICT (venue_id) DO UPDATE
          SET updated_at = now()
        RETURNING *
      `
    })
    return reply.code(201).send(cfg)
  })

  // ── PATCH /website/config?venue_id=X ────────────────────
  app.patch('/config', { preHandler: PERM.manage}, async (req) => {
    const venueId = req.query.venue_id || req.body?.venue_id
    if (!venueId) throw httpError(400, 'venue_id is required')

    // Strip venue_id from the body so it isn't passed to the dynamic UPDATE.
    const { venue_id: _vid, ...rest } = req.body ?? {}
    const body = VenueConfigBody.parse(rest)

    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [cfg] = await withTenant(req.tenantId, async tx => {
      const existing = await ensureVenueConfig(tx, req.tenantId, venueId)
      if (!existing) throw httpError(404, 'Venue config not found — POST to create it first')

      return tx`
        UPDATE website_config
           SET ${tx(body, ...fields)}, updated_at = now()
         WHERE id = ${existing.id}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
    })
    if (!cfg) throw httpError(404, 'Venue config not found')
    return cfg
  })

  // ── Gallery ─────────────────────────────────────────────

  app.get('/gallery', { preHandler: PERM.view }, async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return []
    return tx`
      SELECT * FROM website_gallery_images
       WHERE website_config_id = ${cfg.id}
       ORDER BY sort_order, created_at
    `
  }))

  app.post('/gallery', { preHandler: PERM.manage}, async (req, reply) => {
    const body = GalleryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Venue config not found')
      return tx`
        INSERT INTO website_gallery_images
          (tenant_id, website_config_id, image_url, caption, sort_order)
        VALUES
          (${req.tenantId}, ${cfg.id}, ${body.image_url},
           ${body.caption ?? null}, ${body.sort_order})
        RETURNING *
      `
    })
    return reply.code(201).send(row)
  })

  app.patch('/gallery/:id', { preHandler: PERM.manage}, async (req) => {
    const body = GalleryBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE website_gallery_images
         SET ${tx(body, ...fields)}
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Gallery image not found')
    return row
  })

  app.delete('/gallery/:id', { preHandler: PERM.manage}, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM website_gallery_images
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Gallery image not found')
    return { ok: true }
  })

  app.patch('/gallery/reorder', { preHandler: PERM.manage}, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE website_gallery_images SET sort_order = ${i}
           WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}
        `
      }
    })
    return { ok: true }
  })

  // ── Custom pages ────────────────────────────────────────
  // Pages can be tenant-level (venue_id IS NULL) or venue-level
  // (venue_id = X). Pass `venue_id=tenant` for tenant-level, otherwise
  // a UUID for a specific venue.

  function pageVenueFilter(req) {
    const v = req.query.venue_id
    if (!v || v === 'tenant') return null
    return v
  }

  app.get('/pages', { preHandler: PERM.view }, async (req) => withTenant(req.tenantId, async tx => {
    const venueId = pageVenueFilter(req)
    if (venueId) {
      return tx`
        SELECT * FROM website_pages
         WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}
         ORDER BY sort_order, title
      `
    }
    return tx`
      SELECT * FROM website_pages
       WHERE tenant_id = ${req.tenantId} AND venue_id IS NULL
       ORDER BY sort_order, title
    `
  }))

  app.post('/pages', { preHandler: PERM.manage}, async (req, reply) => {
    const body = PageBody.parse(req.body)
    const venueId = pageVenueFilter(req)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO website_pages
        (tenant_id, venue_id, slug, title, content, blocks, kind, is_published, sort_order)
      VALUES
        (${req.tenantId}, ${venueId}, ${body.slug}, ${body.title},
         ${body.content ?? null},
         ${body.blocks ? tx.json(body.blocks) : null},
         ${body.kind || 'page'},
         ${body.is_published}, ${body.sort_order})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  app.patch('/pages/:id', { preHandler: PERM.manage}, async (req) => {
    const parsed = PageBody.partial().parse(req.body)
    // Only persist keys the client sent — Zod defaults must not overwrite
    // kind / is_published when PageBuilder saves { blocks } alone.
    const fields = Object.keys(req.body || {}).filter(k => k in parsed)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const body = {}
    for (const k of fields) body[k] = parsed[k]
    return withTenant(req.tenantId, async tx => {
      // A built-in page (migrations 126, 214) always lives at its own
      // address as a published standalone page: only its title and blocks
      // change (shared/sitePages.js).
      const [cur] = await tx`SELECT system_key FROM website_pages WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (cur?.system_key) {
        const sys = SYSTEM_PAGES[cur.system_key]
        const What = sys.what.charAt(0).toUpperCase() + sys.what.slice(1)
        if ('kind' in body && body.kind !== 'page') throw httpError(422, What + ' can\'t be a modal')
        if ('is_published' in body && !body.is_published) {
          throw httpError(422, cur.system_key === 'order'
            ? 'The ordering page is always published. Pause or switch off online ordering in Ordering setup instead.'
            : 'The loyalty page is always published. It shows only while loyalty and its web app are switched on (Loyalty, Programme).')
        }
        for (const k of ['slug', 'kind', 'is_published']) {
          if (k in body) { delete body[k]; fields.splice(fields.indexOf(k), 1) }
        }
        if (!fields.length) {
          const [row] = await tx`SELECT * FROM website_pages WHERE id = ${req.params.id}`
          return row
        }
      }
      if ('blocks' in body) body.blocks = body.blocks == null ? null : tx.json(body.blocks)
      const [row] = await tx`
        UPDATE website_pages
           SET ${tx(body, ...fields)}, updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
        RETURNING *
      `
      if (!row) throw httpError(404, 'Page not found')
      return row
    })
  })

  app.delete('/pages/:id', { preHandler: PERM.manage}, async (req) => {
    const [row] = await withTenant(req.tenantId, async tx => {
      const [cur] = await tx`SELECT system_key FROM website_pages WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
      if (cur?.system_key) throw httpError(422, SYSTEM_PAGES[cur.system_key].what.replace(/^t/, 'T') + ' can\'t be deleted')
      return tx`
        DELETE FROM website_pages
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
        RETURNING id
      `
    })
    if (!row) throw httpError(404, 'Page not found')
    return { ok: true }
  })

  // ── POST /website/legal-pages ───────────────────────────
  // Seeds Terms / Privacy / Cookies as tenant-level pages with sensible
  // default content the operator can edit. Idempotent: if a page with
  // one of the reserved slugs already exists, we leave it alone.
  app.post('/legal-pages', { preHandler: PERM.manage}, async (req) => {
    const [tenantSite, tenant] = await withTenant(req.tenantId, async tx => {
      const [ts] = await tx`SELECT brand_name, site_name FROM tenant_site WHERE tenant_id = ${req.tenantId}`
      const [t]  = await tx`SELECT name FROM tenants       WHERE id = ${req.tenantId}`
      return [ts, t]
    })
    const brandName = tenantSite?.brand_name || tenantSite?.site_name || tenant?.name || 'Our Restaurant'
    const ctx = { brandName, email: null }

    const KINDS = [
      { slug: 'terms',    title: 'Terms & Conditions' },
      { slug: 'privacy',  title: 'Privacy Policy' },
      { slug: 'cookies',  title: 'Cookies Policy' },
    ]

    const created = await withTenant(req.tenantId, async tx => {
      const out = []
      for (const k of KINDS) {
        const [existing] = await tx`
          SELECT id, slug FROM website_pages
           WHERE tenant_id = ${req.tenantId}
             AND venue_id IS NULL
             AND slug = ${k.slug}
           LIMIT 1
        `
        if (existing) {
          out.push({ slug: existing.slug, status: 'exists' })
          continue
        }
        const [row] = await tx`
          INSERT INTO website_pages
            (tenant_id, venue_id, slug, title, content, is_published, is_legal, sort_order)
          VALUES
            (${req.tenantId}, NULL, ${k.slug}, ${k.title},
             ${defaultLegalContent(k.slug, ctx)},
             true, true, 100)
          RETURNING id, slug
        `
        out.push({ slug: row.slug, status: 'created' })
      }
      return out
    })

    return { pages: created }
  })

  // ── Menus (PDF documents) ───────────────────────────────

  app.get('/menus', { preHandler: PERM.view }, async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return []
    return tx`
      SELECT * FROM website_menu_documents
       WHERE website_config_id = ${cfg.id}
       ORDER BY sort_order, created_at
    `
  }))

  app.post('/menus', { preHandler: PERM.manage}, async (req, reply) => {
    const body = MenuBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Venue config not found')
      return tx`
        INSERT INTO website_menu_documents
          (tenant_id, website_config_id, label, file_url, sort_order)
        VALUES
          (${req.tenantId}, ${cfg.id}, ${body.label}, ${body.file_url}, ${body.sort_order})
        RETURNING *
      `
    })
    return reply.code(201).send(row)
  })

  app.delete('/menus/:id', { preHandler: PERM.manage}, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM website_menu_documents
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Menu document not found')
    return { ok: true }
  })

  // ── Opening hours (bulk upsert) ─────────────────────────

  app.get('/opening-hours', { preHandler: PERM.view }, async (req) => withTenant(req.tenantId, async tx => {
    const venueId = req.query.venue_id
    if (!venueId) return []
    const cfg = await ensureVenueConfig(tx, req.tenantId, venueId)
    return loadOpeningHours(tx, venueId, cfg)
  }))

  app.post('/opening-hours', { preHandler: PERM.manage}, async (req) => {
    const rows = z.array(OpeningHourRow).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Venue config not found')
      await tx`DELETE FROM website_opening_hours WHERE website_config_id = ${cfg.id}`
      if (rows.length) {
        await tx`
          INSERT INTO website_opening_hours ${tx(rows.map(r => ({
            tenant_id:          req.tenantId,
            website_config_id:  cfg.id,
            day_of_week:        r.day_of_week,
            opens_at:           r.is_closed ? null : (r.opens_at  ?? null),
            closes_at:          r.is_closed ? null : (r.closes_at ?? null),
            is_closed:          r.is_closed,
            label:              r.label      ?? null,
            sort_order:         r.sort_order,
          })))}
        `
      }
    })
    return { ok: true }
  })

  // ── Allergen info ───────────────────────────────────────

  app.get('/allergens', { preHandler: PERM.view }, async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return {}
    const [row] = await tx`
      SELECT * FROM website_allergen_info WHERE website_config_id = ${cfg.id}
    `
    return row ?? {}
  }))

  app.post('/allergens', { preHandler: PERM.manage}, async (req) => {
    const body = AllergenBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureVenueConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Venue config not found')
      return tx`
        INSERT INTO website_allergen_info
          (tenant_id, website_config_id, info_type, document_url, structured_data)
        VALUES
          (${req.tenantId}, ${cfg.id}, ${body.info_type},
           ${body.document_url ?? null},
           ${tx.json(body.structured_data ?? [])})
        ON CONFLICT (website_config_id) DO UPDATE
           SET info_type       = EXCLUDED.info_type,
               document_url    = EXCLUDED.document_url,
               structured_data = EXCLUDED.structured_data,
               updated_at      = now()
        RETURNING *
      `
    })
    return row
  })

  // ── File upload ─────────────────────────────────────────
  app.post('/upload', { preHandler: PERM.upload}, async (req, reply) => {
    if (!req.isMultipart()) throw httpError(400, 'Expected multipart/form-data')

    const parts = req.parts()
    let kind = 'images'
    let scope = 'shared'
    let fileData = null

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'kind')  kind  = String(part.value || 'images')
      else if (part.type === 'field' && part.fieldname === 'scope') scope = String(part.value || 'shared').slice(0, 100)
      else if (part.type === 'file'  && part.fieldname === 'file') {
        const cfg = KIND_CONFIG[kind] ?? KIND_CONFIG.images
        // Pictures may also be .ico files (favicons).
        const icon = cfg === KIND_CONFIG.images && mayBeIcon(part.mimetype, part.filename)
        if (!icon && !cfg.mimes.has(part.mimetype)) {
          throw httpError(422, cfg === KIND_CONFIG.images
            ? `Unsupported file type: ${part.mimetype || 'unknown'}. Use JPG, PNG, WebP, SVG, GIF or ICO.`
            : `Unsupported file type: ${part.mimetype || 'unknown'}. Use a PDF.`)
        }
        const chunks = []
        let total = 0
        for await (const chunk of part.file) {
          total += chunk.length
          if (total > cfg.maxBytes) {
            throw httpError(413, `File exceeds ${Math.round(cfg.maxBytes / 1024 / 1024)}MB limit`)
          }
          chunks.push(chunk)
        }
        const buffer = Buffer.concat(chunks)
        if (icon && !isIcon(buffer)) throw httpError(422, "That file isn't an .ico picture.")
        fileData = {
          buffer,
          mimetype: icon ? ICON_MIME : part.mimetype,
          filename: part.filename,
        }
      }
    }

    if (!fileData) throw httpError(400, 'No file provided')
    if (!KIND_CONFIG[kind]) throw httpError(422, 'Invalid kind')

    const ext     = extFromMime(fileData.mimetype)
    const storage = getStorage()
    const result  = await storage.put(req.tenantId, kind, ext, fileData.mimetype, fileData.buffer)

    let mediaItemId = null
    if (kind === 'images') {
      const hash = crypto.createHash('sha256').update(fileData.buffer).digest('hex')
      try {
        const [row] = await withTenant(req.tenantId, tx => tx`
          INSERT INTO media_items
            (tenant_id, scope, filename, url, storage_key, mimetype, bytes, hash)
          VALUES
            (${req.tenantId}, ${scope}, ${fileData.filename || `image.${ext}`},
             ${result.url}, ${result.key}, ${fileData.mimetype}, ${fileData.buffer.length}, ${hash})
          RETURNING id
        `)
        mediaItemId = row?.id ?? null
      } catch (e) {
        req.log.warn({ err: e?.message }, 'media_items mirror failed')
      }
    }

    return reply.code(201).send({
      url:           result.url,
      kind,
      bytes:         result.bytes,
      mimetype:      fileData.mimetype,
      driver:        env.STORAGE_DRIVER,
      media_item_id: mediaItemId,
    })
  })
}