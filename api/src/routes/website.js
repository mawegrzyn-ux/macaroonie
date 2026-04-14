// src/routes/website.js
//
// Tenant Website Builder — authenticated admin CRUD.
//   website_config (singleton per tenant)
//   gallery images, custom pages, PDF menus, opening hours, allergen info
//   file uploads (images + PDFs) to UPLOAD_DIR/{tenant_id}/{kind}/{uuid}.{ext}
//
// Public site rendering lives in ./siteRenderer.js — this file is admin-only.

import { z }  from 'zod'
import fs     from 'node:fs/promises'
import path   from 'node:path'
import crypto from 'node:crypto'
import { withTenant, sql } from '../config/db.js'
import { env }        from '../config/env.js'
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
  show_find_us:       z.boolean().optional(),
  show_contact:       z.boolean().optional(),
  show_ordering:      z.boolean().optional(),
  show_delivery:      z.boolean().optional(),
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

async function ensureConfig(tx, tenantId) {
  const [cfg] = await tx`
    SELECT * FROM website_config WHERE tenant_id = ${tenantId}
  `
  return cfg ?? null
}

// ── Plugin ───────────────────────────────────────────────────

export default async function websiteRoutes(app) {

  app.addHook('preHandler', requireAuth)

  // ── GET /website/config ─────────────────────────────────
  app.get('/config', async (req) => {
    return withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId)
      return cfg ?? {}
    })
  })

  // ── POST /website/config (create or upsert) ─────────────
  app.post('/config', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = WebsiteConfigBody.parse(req.body)
    if (!body.subdomain_slug) throw httpError(422, 'subdomain_slug is required on create')

    const [cfg] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO website_config (tenant_id, subdomain_slug, site_name, primary_colour)
      VALUES (${req.tenantId}, ${body.subdomain_slug},
              ${body.site_name ?? null},
              ${body.primary_colour ?? '#630812'})
      ON CONFLICT (tenant_id) DO UPDATE
        SET subdomain_slug = EXCLUDED.subdomain_slug,
            updated_at     = now()
      RETURNING *
    `)
    return reply.code(201).send(cfg)
  })

  // ── PATCH /website/config ───────────────────────────────
  app.patch('/config', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = WebsiteConfigBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    // postgres.js tx() helper requires plain object; JSONB fields
    // need to be passed as-is and it serialises them.
    const [cfg] = await withTenant(req.tenantId, async tx => {
      const existing = await ensureConfig(tx, req.tenantId)
      if (!existing) throw httpError(404, 'Website config not found — POST to create it first')

      return tx`
        UPDATE website_config
           SET ${tx(body, ...fields)}, updated_at = now()
         WHERE tenant_id = ${req.tenantId}
        RETURNING *
      `
    })
    if (!cfg) throw httpError(404, 'Website config not found')
    return cfg
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
    const cfg = await ensureConfig(tx, req.tenantId)
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
      const cfg = await ensureConfig(tx, req.tenantId)
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
    const cfg = await ensureConfig(tx, req.tenantId)
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
      const cfg = await ensureConfig(tx, req.tenantId)
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
    const cfg = await ensureConfig(tx, req.tenantId)
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
      const cfg = await ensureConfig(tx, req.tenantId)
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
    const cfg = await ensureConfig(tx, req.tenantId)
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
      const cfg = await ensureConfig(tx, req.tenantId)
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
    const cfg = await ensureConfig(tx, req.tenantId)
    if (!cfg) return {}
    const [row] = await tx`
      SELECT * FROM website_allergen_info WHERE website_config_id = ${cfg.id}
    `
    return row ?? {}
  }))

  app.post('/allergens', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = AllergenBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const cfg = await ensureConfig(tx, req.tenantId)
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

  // ── File upload ─────────────────────────────────────────
  // Expects multipart/form-data with fields:
  //   file  — the binary
  //   kind  — 'images' | 'menus' | 'docs'
  app.post('/upload', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    if (!req.isMultipart()) throw httpError(400, 'Expected multipart/form-data')

    const parts = req.parts()
    let kind = 'images'
    let fileData = null

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'kind') {
        kind = String(part.value || 'images')
      } else if (part.type === 'file' && part.fieldname === 'file') {
        const cfg = KIND_CONFIG[kind] ?? KIND_CONFIG.images
        if (!cfg.mimes.has(part.mimetype)) {
          throw httpError(422, `Unsupported file type: ${part.mimetype}`)
        }
        // Buffer the file (simpler than streaming; size limit is enforced below)
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

    const ext = extFromMime(fileData.mimetype)
    const id  = crypto.randomUUID()
    const dir = path.join(env.UPLOAD_DIR, req.tenantId, kind)
    await fs.mkdir(dir, { recursive: true })
    const filename = `${id}.${ext}`
    await fs.writeFile(path.join(dir, filename), fileData.buffer)

    const url = `/uploads/${req.tenantId}/${kind}/${filename}`
    return reply.code(201).send({
      url,
      kind,
      bytes: fileData.buffer.length,
      mimetype: fileData.mimetype,
    })
  })
}
