// src/routes/website.js
//
// Tenant Website Builder — authenticated admin CRUD.
//   website_config (singleton per tenant)
//   gallery images, custom pages, PDF menus, opening hours, allergen info
//   file uploads (images + PDFs) to UPLOAD_DIR/{tenant_id}/{kind}/{uuid}.{ext}
//
// Public site rendering lives in ./siteRenderer.js — this file is admin-only.

import { z }     from 'zod'
import crypto    from 'node:crypto'
import dns        from 'node:dns/promises'
import { withTenant, sql } from '../config/db.js'
import { env }    from '../config/env.js'
import { getStorage } from '../services/storageSvc.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

// ── Schemas ──────────────────────────────────────────────────

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}){1,2}$/

const SlugSchema = z.string()
  .min(1).max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens')

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

// Theme is intentionally permissive — the renderer knows which keys it looks
// for and defaults missing ones.  Adding a new theme knob is just: (a) accept
// it here, (b) read it in the renderer.
const ThemeSchema = z.object({
  colors: z.object({
    primary:    z.string().regex(HEX_COLOUR).optional(),
    accent:     z.string().regex(HEX_COLOUR).optional(),
    background: z.string().regex(HEX_COLOUR).optional(),
    surface:    z.string().regex(HEX_COLOUR).optional(),
    text:       z.string().regex(HEX_COLOUR).optional(),
    muted:      z.string().regex(HEX_COLOUR).optional(),
    border:     z.string().regex(HEX_COLOUR).optional(),
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

const WebsiteConfigBody = z.object({
  subdomain_slug:   SlugSchema.optional(),
  site_name:        z.string().max(200).nullable().optional(),
  tagline:          z.string().max(300).nullable().optional(),
  logo_url:         z.string().nullable().optional(),
  favicon_url:      z.string().nullable().optional(),
  primary_colour:   z.string().regex(HEX_COLOUR).optional(),
  secondary_colour: z.string().regex(HEX_COLOUR).nullable().optional(),
  font_family:      z.string().max(100).optional(),

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

  social_links:          SocialLinksSchema.optional(),
  online_ordering_links: z.array(OrderingLink).optional(),
  delivery_links:        z.array(DeliveryLink).optional(),

  widget_venue_id:  z.string().uuid().nullable().optional(),
  widget_theme:     z.enum(['light', 'dark']).optional(),

  meta_title:       z.string().max(200).nullable().optional(),
  meta_description: z.string().max(500).nullable().optional(),
  og_image_url:     z.string().nullable().optional(),

  ga4_measurement_id: z.string().max(50).nullable().optional(),
  fb_pixel_id:        z.string().max(50).nullable().optional(),

  is_published:       z.boolean().optional(),
  show_booking_widget: z.boolean().optional(),
  show_menu:          z.boolean().optional(),
  show_allergens:     z.boolean().optional(),
  show_gallery:       z.boolean().optional(),
  gallery_style:      z.enum(['grid', 'pinterest', 'horizontal']).optional(),
  gallery_size:       z.enum(['small', 'medium', 'large']).optional(),
  opening_hours_source: z.enum(['manual', 'venue']).optional(),

  // Block-based page composition. Each block: { id, type, data }.
  // Server keeps `data` opaque — validation done client-side via the
  // block registry. Setting to [] (or null) falls back to flat layout.
  home_blocks: z.array(z.object({
    id:   z.string(),
    type: z.string(),
    data: z.record(z.string(), z.any()).default({}),
  })).nullable().optional(),
  show_find_us:       z.boolean().optional(),
  show_contact:       z.boolean().optional(),
  show_ordering:      z.boolean().optional(),
  show_delivery:      z.boolean().optional(),

  // Custom domain (e.g. book.wingstop.co.uk) — lowercased + shape-checked
  // at the DB layer.  Setting `custom_domain` always clears the
  // `custom_domain_verified` flag so the tenant re-proves DNS ownership.
  custom_domain:      z.string().toLowerCase().max(253).nullable().optional(),

  // Template + theme
  template_key:       z.enum(['classic', 'modern']).optional(),
  theme:              ThemeSchema.optional(),
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
  is_published: z.boolean().default(true),
  sort_order:   z.number().int().default(0),
})

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
    case 'application/pdf': return 'pdf'
    default:              return 'bin'
  }
}

async function ensureConfig(tx, tenantId, venueId) {
  if (venueId) {
    const [cfg] = await tx`
      SELECT * FROM website_config
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
    `
    return cfg ?? null
  }
  const [cfg] = await tx`
    SELECT * FROM website_config WHERE tenant_id = ${tenantId} LIMIT 1
  `
  return cfg ?? null
}

// Brand defaults schema
const BrandDefaultsBody = z.object({
  brand_name:        z.string().max(200).nullable().optional(),
  logo_url:          z.string().nullable().optional(),
  favicon_url:       z.string().nullable().optional(),
  primary_colour:    z.string().regex(HEX_COLOUR).optional(),
  secondary_colour:  z.string().regex(HEX_COLOUR).nullable().optional(),
  font_family:       z.string().max(100).optional(),
  template_key:      z.enum(['classic', 'modern']).optional(),
  theme:             ThemeSchema.optional(),
  social_links:      SocialLinksSchema.optional(),
  og_image_url:      z.string().nullable().optional(),
  ga4_measurement_id: z.string().max(50).nullable().optional(),
  fb_pixel_id:        z.string().max(50).nullable().optional(),
  banner_enabled:    z.boolean().optional(),
  banner_text:       z.string().max(500).nullable().optional(),
  banner_link_url:   z.string().max(500).nullable().optional(),
  banner_link_text:  z.string().max(100).nullable().optional(),
  banner_severity:   z.enum(['info', 'warn', 'alert']).optional(),
})

// ── Plugin ───────────────────────────────────────────────────

export default async function websiteRoutes(app) {

  app.addHook('preHandler', requireAuth)

  // ── GET /website/config?venue_id=X ───────────────────────
  // Returns the venue's website_config, or {} if none exists yet.
  // Without venue_id returns the first config found (back-compat).
  app.get('/config', async (req) => {
    const venueId = req.query.venue_id || null
    return withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId, venueId)
      return cfg ?? {}
    })
  })

  // ── GET /website/configs ────────────────────────────────
  // Returns ALL venue websites for this tenant (franchise overview).
  app.get('/configs', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT wc.*, v.name AS venue_name
        FROM website_config wc
        JOIN venues v ON v.id = wc.venue_id
       WHERE wc.tenant_id = ${req.tenantId}
       ORDER BY v.name
    `)
  })

  // ── POST /website/config (create for a venue) ──────────
  app.post('/config', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = WebsiteConfigBody.parse(req.body)
    if (!body.subdomain_slug) throw httpError(422, 'subdomain_slug is required on create')
    const venue_id = req.body.venue_id
    if (!venue_id) throw httpError(422, 'venue_id is required — which venue is this site for?')

    const [cfg] = await withTenant(req.tenantId, async tx => {
      const [venue] = await tx`
        SELECT id FROM venues
         WHERE id = ${venue_id} AND tenant_id = ${req.tenantId} AND is_active = true
      `
      if (!venue) throw httpError(404, 'Venue not found')

      return tx`
        INSERT INTO website_config (tenant_id, venue_id, subdomain_slug, site_name, primary_colour)
        VALUES (${req.tenantId}, ${venue_id}, ${body.subdomain_slug},
                ${body.site_name ?? null},
                ${body.primary_colour ?? '#630812'})
        ON CONFLICT (venue_id) DO UPDATE
          SET subdomain_slug = EXCLUDED.subdomain_slug,
              updated_at     = now()
        RETURNING *
      `
    })
    return reply.code(201).send(cfg)
  })

  // ── PATCH /website/config?venue_id=X ─────────────────────
  app.patch('/config', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const venueId = req.query.venue_id || req.body?.venue_id
    const body = WebsiteConfigBody.parse(req.body)

    if ('custom_domain' in body) {
      body.custom_domain_verified = false
    }

    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [cfg] = await withTenant(req.tenantId, async tx => {
      const existing = await ensureConfig(tx, req.tenantId, venueId)
      if (!existing) throw httpError(404, 'Website config not found — POST to create it first')

      // Match the row by id directly. Filtering by tenant_id alone (the
      // previous bug) updated every venue's website_config for the tenant,
      // bleeding hero/logo/about edits across venue sites.
      return tx`
        UPDATE website_config
           SET ${tx(body, ...fields)}, updated_at = now()
         WHERE id = ${existing.id}
           AND tenant_id = ${req.tenantId}
        RETURNING *
      `
    })
    if (!cfg) throw httpError(404, 'Website config not found')
    return cfg
  })

  // ── POST /website/verify-domain ─────────────────────────
  // Resolves the tenant's custom_domain via DNS. Marks verified=true when
  // the domain's A records point to any of APP_PUBLIC_IPS (a CSV env var)
  // OR its CNAME points at {PUBLIC_ROOT_DOMAIN}. Otherwise returns the
  // records it saw so the tenant can see what went wrong.
  app.post('/verify-domain', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const venueId = req.query.venue_id || req.body?.venue_id
    if (!venueId) throw httpError(400, 'venue_id is required')

    const [cfg] = await withTenant(req.tenantId, tx => tx`
      SELECT id, custom_domain FROM website_config
       WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}
    `)
    if (!cfg?.custom_domain) throw httpError(422, 'No custom domain configured')

    const domain = cfg.custom_domain
    const expectedCnameSuffix = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
    const expectedIps = (process.env.APP_PUBLIC_IPS || '')
      .split(',').map(s => s.trim()).filter(Boolean)

    let aRecords = []
    let cnameRecords = []
    try { aRecords = await dns.resolve4(domain) }     catch { /* no A records */ }
    try { cnameRecords = await dns.resolveCname(domain) } catch { /* no CNAME */ }

    const cnameMatch = cnameRecords.some(c => c.toLowerCase().endsWith(expectedCnameSuffix))
    const aMatch     = expectedIps.length && aRecords.some(a => expectedIps.includes(a))
    const verified   = cnameMatch || aMatch

    await withTenant(req.tenantId, tx => tx`
      UPDATE website_config
         SET custom_domain_verified = ${verified}, updated_at = now()
       WHERE id = ${cfg.id}
         AND tenant_id = ${req.tenantId}
    `)

    return {
      verified,
      domain,
      a_records:     aRecords,
      cname_records: cnameRecords,
      expected: {
        cname_suffix: expectedCnameSuffix,
        ips:          expectedIps,
      },
      hint: verified
        ? 'Domain verified. SSL provisioning still happens outside the app (Nginx + certbot).'
        : `Point ${domain} via CNAME to ${expectedCnameSuffix}, or an A record to one of the app's public IPs.`,
    }
  })

  // ── GET /website/slug-available?slug=foo ────────────────
  // Global uniqueness check — does NOT use withTenant (slug namespace is global).
  app.get('/slug-available', async (req) => {
    const slug = SlugSchema.parse(req.query.slug)
    const [hit] = await sql`
      SELECT 1 FROM website_config
       WHERE subdomain_slug = ${slug}
         AND tenant_id     <> ${req.tenantId}
      LIMIT 1
    `
    return { available: !hit }
  })

  // ── Gallery ─────────────────────────────────────────────

  app.get('/gallery', async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return []
    return tx`
      SELECT * FROM website_gallery_images
       WHERE website_config_id = ${cfg.id}
       ORDER BY sort_order, created_at
    `
  }))

  app.post('/gallery', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = GalleryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Website config not found')
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

  app.patch('/gallery/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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

  app.delete('/gallery/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM website_gallery_images
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Gallery image not found')
    return { ok: true }
  })

  app.patch('/gallery/reorder', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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

  app.get('/pages', async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return []
    return tx`
      SELECT * FROM website_pages
       WHERE website_config_id = ${cfg.id}
       ORDER BY sort_order, title
    `
  }))

  app.post('/pages', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = PageBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Website config not found')
      return tx`
        INSERT INTO website_pages
          (tenant_id, website_config_id, slug, title, content, is_published, sort_order)
        VALUES
          (${req.tenantId}, ${cfg.id}, ${body.slug}, ${body.title},
           ${body.content ?? null}, ${body.is_published}, ${body.sort_order})
        RETURNING *
      `
    })
    return reply.code(201).send(row)
  })

  app.patch('/pages/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = PageBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE website_pages
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Page not found')
    return row
  })

  app.delete('/pages/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM website_pages
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Page not found')
    return { ok: true }
  })

  // ── Menus (PDF documents) ───────────────────────────────

  app.get('/menus', async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return []
    return tx`
      SELECT * FROM website_menu_documents
       WHERE website_config_id = ${cfg.id}
       ORDER BY sort_order, created_at
    `
  }))

  app.post('/menus', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = MenuBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Website config not found')
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

  app.delete('/menus/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM website_menu_documents
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Menu document not found')
    return { ok: true }
  })

  // ── Opening hours (bulk upsert) ─────────────────────────

  app.get('/opening-hours', async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return []
    return tx`
      SELECT * FROM website_opening_hours
       WHERE website_config_id = ${cfg.id}
       ORDER BY day_of_week, sort_order
    `
  }))

  app.post('/opening-hours', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const rows = z.array(OpeningHourRow).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Website config not found')
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

  app.get('/allergens', async (req) => withTenant(req.tenantId, async tx => {
    const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
    if (!cfg) return {}
    const [row] = await tx`
      SELECT * FROM website_allergen_info WHERE website_config_id = ${cfg.id}
    `
    return row ?? {}
  }))

  app.post('/allergens', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = AllergenBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId, req.query.venue_id)
      if (!cfg) throw httpError(404, 'Website config not found')
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

  // ── Brand defaults (franchise-level) ─────────────────────

  app.get('/brand-defaults', async (req) => {
    return withTenant(req.tenantId, async tx => {
      const [row] = await tx`
        SELECT * FROM tenant_brand_defaults
         WHERE tenant_id = ${req.tenantId}
      `
      return row ?? {}
    })
  })

  app.post('/brand-defaults', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = BrandDefaultsBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO tenant_brand_defaults (tenant_id, brand_name, primary_colour)
      VALUES (${req.tenantId}, ${body.brand_name ?? null}, ${body.primary_colour ?? '#630812'})
      ON CONFLICT (tenant_id) DO UPDATE
        SET brand_name = COALESCE(EXCLUDED.brand_name, tenant_brand_defaults.brand_name),
            updated_at = now()
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  app.patch('/brand-defaults', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = BrandDefaultsBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE tenant_brand_defaults
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Brand defaults not found — POST to create them first')
    return row
  })

  // ── File upload ─────────────────────────────────────────
  // Expects multipart/form-data with fields:
  //   file   — the binary
  //   kind   — 'images' | 'menus' | 'docs'
  //   scope  — optional, e.g. 'website:hero', 'brand:logo'. Default 'shared'.
  //
  // Writes via the configured storage driver AND (for image kinds) creates a
  // media_items row so every CMS upload is browseable in the media library.
  // PDF kinds (`menus`, `docs`) skip the media library — they're tracked
  // elsewhere via website_menu_documents.
  app.post('/upload', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
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
        if (!cfg.mimes.has(part.mimetype)) {
          throw httpError(422, `Unsupported file type: ${part.mimetype}`)
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
        fileData = {
          buffer:   Buffer.concat(chunks),
          mimetype: part.mimetype,
          filename: part.filename,
        }
      }
    }

    if (!fileData) throw httpError(400, 'No file provided')
    if (!KIND_CONFIG[kind]) throw httpError(422, 'Invalid kind')

    const ext     = extFromMime(fileData.mimetype)
    const storage = getStorage()
    const result  = await storage.put(req.tenantId, kind, ext, fileData.mimetype, fileData.buffer)

    // Mirror image uploads into media_items so the media library has visibility.
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
        // Don't fail the upload if the media row insert errors — file is on disk
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
