// src/routes/menus.js
//
// Structured menu manager — admin CRUD + a single bulk-upsert PATCH that
// rewrites the entire menu tree (sections, items, variants, dietary tag
// links, callouts) in one call. The admin form holds the whole menu in
// React state and posts it on Save; the API delete-and-reinserts under
// the menu_id so we never have to diff thousands of rows.
//
// Public read endpoint at GET /api/menus/public/:menuId returns the same
// shape but unauthenticated and only when the menu's tenant_site is
// published — used by the website menu_inline block + the /menus/:id/print
// printable page.

import { z } from 'zod'
import { withTenant, sql } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { SEED_BY_SLUG, ONETHAI_DIETARY_TAGS } from '../services/menuSeeds.js'

// ── Schemas ──────────────────────────────────────────────────

const VariantBody = z.object({
  id:          z.string().uuid().optional(),
  label:       z.string().min(1).max(60),
  price_pence: z.number().int().min(0),
  sort_order:  z.number().int().default(0),
})

const ItemBody = z.object({
  id:          z.string().uuid().optional(),
  name:        z.string().min(1).max(200),
  native_name: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
  price_pence: z.number().int().min(0).nullable().optional(),
  notes:       z.string().max(200).nullable().optional(),
  is_featured: z.boolean().default(false),
  sort_order:  z.number().int().default(0),
  variants:    z.array(VariantBody).default([]),
  // M:N to dietary tags — array of dietary tag CODES (e.g. ['gf', 'spicy'])
  // resolved to ids server-side.
  dietary:     z.array(z.string().max(32)).default([]),
})

const SectionBody = z.object({
  id:         z.string().uuid().optional(),
  title:      z.string().min(1).max(120),
  subtitle:   z.string().max(120).nullable().optional(),
  highlight:  z.boolean().default(false),
  sort_order: z.number().int().default(0),
  items:      z.array(ItemBody).default([]),
})

const CalloutBody = z.object({
  id:         z.string().uuid().optional(),
  kind:       z.enum(['allergens', 'go_large', 'thai_hot', 'order_book', 'custom']).default('custom'),
  title:      z.string().min(1).max(120),
  body:       z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
})

const MenuMetaBody = z.object({
  name:          z.string().min(1).max(120),
  slug:          z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  venue_id:      z.string().uuid().nullable().optional(),
  tagline:       z.string().max(200).nullable().optional(),
  service_times: z.string().max(200).nullable().optional(),
  intro_line:    z.string().max(500).nullable().optional(),
  is_published:  z.boolean().default(true),
  sort_order:    z.number().int().default(0),
  print_columns: z.number().int().min(1).max(6).default(4),
})

const MenuFullBody = MenuMetaBody.extend({
  sections: z.array(SectionBody).default([]),
  callouts: z.array(CalloutBody).default([]),
})

const DietaryBody = z.object({
  code:       z.string().regex(/^[a-z0-9_-]{1,16}$/),
  label:      z.string().min(1).max(60),
  glyph:      z.string().min(1).max(8),
  colour:     z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/).default('#7a1a26'),
  sort_order: z.number().int().default(0),
})

// ── Loaders ──────────────────────────────────────────────────

async function loadMenuFull(tx, menuId, tenantId) {
  const [menu] = await tx`
    SELECT * FROM menus WHERE id = ${menuId} AND tenant_id = ${tenantId} LIMIT 1
  `
  if (!menu) return null

  const [sections, callouts, tags, itemDietary] = await Promise.all([
    tx`
      SELECT s.*,
             COALESCE(json_agg(DISTINCT jsonb_build_object(
               'id', i.id, 'name', i.name, 'native_name', i.native_name,
               'description', i.description, 'price_pence', i.price_pence,
               'notes', i.notes, 'is_featured', i.is_featured, 'sort_order', i.sort_order,
               'variants', COALESCE((
                 SELECT json_agg(jsonb_build_object('id', v.id, 'label', v.label, 'price_pence', v.price_pence, 'sort_order', v.sort_order) ORDER BY v.sort_order)
                   FROM menu_item_variants v WHERE v.item_id = i.id
               ), '[]'::json)
             )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
        FROM menu_sections s
        LEFT JOIN menu_items i ON i.section_id = s.id
       WHERE s.menu_id = ${menuId}
       GROUP BY s.id
       ORDER BY s.sort_order, s.title
    `,
    tx`SELECT * FROM menu_callouts WHERE menu_id = ${menuId} ORDER BY sort_order`,
    tx`SELECT * FROM menu_dietary_tags WHERE tenant_id = ${tenantId} ORDER BY sort_order, label`,
    tx`
      SELECT mid.item_id, t.code
        FROM menu_item_dietary mid
        JOIN menu_dietary_tags t ON t.id = mid.tag_id
       WHERE mid.tenant_id = ${tenantId}
    `,
  ])

  // Sort items + attach dietary codes
  const dietaryByItem = {}
  for (const row of itemDietary) {
    (dietaryByItem[row.item_id] ||= []).push(row.code)
  }
  for (const s of sections) {
    s.items = (s.items || [])
      .filter(i => i && i.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    for (const i of s.items) {
      i.dietary = dietaryByItem[i.id] || []
    }
  }

  return {
    ...menu,
    sections,
    callouts,
    dietary_tags: tags,
  }
}

// ── Bulk upsert: rewrite the menu tree under one menu_id ─────

async function upsertMenuTree(tx, tenantId, menuId, body) {
  // Resolve dietary codes → ids ONCE. Codes referenced but missing are
  // silently dropped (operator can add them via the dietary tag editor).
  const tags = await tx`SELECT id, code FROM menu_dietary_tags WHERE tenant_id = ${tenantId}`
  const tagIdByCode = Object.fromEntries(tags.map(t => [t.code, t.id]))

  // Wipe + re-insert. Sections cascade to items → variants → dietary,
  // and callouts cascade from menu_id, so a single delete clears the
  // whole tree. Acceptable because only one admin edits at a time.
  await tx`DELETE FROM menu_sections WHERE menu_id = ${menuId}`
  await tx`DELETE FROM menu_callouts WHERE menu_id = ${menuId}`

  for (const [si, section] of (body.sections || []).entries()) {
    const [s] = await tx`
      INSERT INTO menu_sections (menu_id, tenant_id, title, subtitle, highlight, sort_order)
      VALUES (${menuId}, ${tenantId}, ${section.title},
              ${section.subtitle ?? null}, ${section.highlight ?? false},
              ${section.sort_order ?? si})
      RETURNING id
    `
    for (const [ii, item] of (section.items || []).entries()) {
      const [it] = await tx`
        INSERT INTO menu_items (section_id, tenant_id, name, native_name, description, price_pence, notes, is_featured, sort_order)
        VALUES (${s.id}, ${tenantId}, ${item.name},
                ${item.native_name ?? null}, ${item.description ?? null},
                ${item.price_pence ?? null}, ${item.notes ?? null},
                ${item.is_featured ?? false}, ${item.sort_order ?? ii})
        RETURNING id
      `
      // Variants
      for (const [vi, variant] of (item.variants || []).entries()) {
        await tx`
          INSERT INTO menu_item_variants (item_id, tenant_id, label, price_pence, sort_order)
          VALUES (${it.id}, ${tenantId}, ${variant.label}, ${variant.price_pence}, ${variant.sort_order ?? vi})
        `
      }
      // Dietary tag links
      for (const code of (item.dietary || [])) {
        const tagId = tagIdByCode[code]
        if (!tagId) continue
        await tx`
          INSERT INTO menu_item_dietary (item_id, tag_id, tenant_id)
          VALUES (${it.id}, ${tagId}, ${tenantId})
          ON CONFLICT DO NOTHING
        `
      }
    }
  }

  for (const [ci, c] of (body.callouts || []).entries()) {
    await tx`
      INSERT INTO menu_callouts (menu_id, tenant_id, kind, title, body, sort_order)
      VALUES (${menuId}, ${tenantId}, ${c.kind || 'custom'},
              ${c.title}, ${c.body ?? null}, ${c.sort_order ?? ci})
    `
  }
}

async function ensureDietaryTags(tx, tenantId, tags) {
  for (const t of tags) {
    await tx`
      INSERT INTO menu_dietary_tags (tenant_id, code, label, glyph, colour, sort_order)
      VALUES (${tenantId}, ${t.code}, ${t.label}, ${t.glyph}, ${t.colour}, ${t.sort_order ?? 0})
      ON CONFLICT (tenant_id, code) DO NOTHING
    `
  }
}

// ── Plugin ───────────────────────────────────────────────────

export default async function menusRoutes(app) {

  // ════════════════════════════════════════════════════════════
  //   PUBLIC (unauthenticated) read — for website + print routes
  // ════════════════════════════════════════════════════════════

  app.get('/public/:menuId', async (req, reply) => {
    // Resolve the tenant via the menu's own row, then re-load with
    // RLS context. Only return when the tenant_site is published OR
    // the menu's own venue page is live (gate matches the public site).
    const [meta] = await sql`
      SELECT m.tenant_id, m.is_published, ts.is_published AS site_published
        FROM menus m
        LEFT JOIN tenant_site ts ON ts.tenant_id = m.tenant_id
       WHERE m.id = ${req.params.menuId}
       LIMIT 1
    `
    if (!meta || !meta.is_published || !meta.site_published) {
      throw httpError(404, 'Menu not found or not published')
    }
    const data = await withTenant(meta.tenant_id, tx => loadMenuFull(tx, req.params.menuId, meta.tenant_id))
    if (!data) throw httpError(404, 'Menu not found')
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    return data
  })

  // ── Public print view — A4-landscape printable HTML ────────
  // Returns a self-contained printable page; the browser handles "Save
  // as PDF" via its own print dialog. No external PDF dependency.
  app.get('/:id/print', async (req, reply) => {
    const [meta] = await sql`
      SELECT m.tenant_id, m.is_published,
             t.name AS tenant_name,
             ts.logo_url, ts.primary_colour
        FROM menus m
        LEFT JOIN tenants t      ON t.id = m.tenant_id
        LEFT JOIN tenant_site ts ON ts.tenant_id = m.tenant_id
       WHERE m.id = ${req.params.id}
       LIMIT 1
    `
    if (!meta) {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'Menu not found', rootDomain: 'macaroonie.com' })
    }
    const menu = await withTenant(meta.tenant_id, tx => loadMenuFull(tx, req.params.id, meta.tenant_id))
    if (!menu) {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'Menu not found', rootDomain: 'macaroonie.com' })
    }

    // If the menu's scope is a venue, fold in venue address + phone for
    // the printed header. Tenant-scoped menus skip this — the operator
    // can put address text on the menu's intro_line instead.
    let address_line1 = null, postcode = null, phone = null
    if (menu.venue_id) {
      const [v] = await sql`
        SELECT wc.address_line1, wc.postcode, wc.phone
          FROM venues v
          LEFT JOIN website_config wc ON wc.venue_id = v.id
         WHERE v.id = ${menu.venue_id} LIMIT 1
      `
      if (v) { address_line1 = v.address_line1; postcode = v.postcode; phone = v.phone }
    }

    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    return reply.view('menu_print.eta', {
      menu: {
        ...menu,
        tenant_name:    meta.tenant_name,
        logo_url:       meta.logo_url,
        primary_colour: meta.primary_colour,
        address_line1, postcode, phone,
      },
    })
  })

  // Authenticated admin endpoints from here on.
  app.addHook('preHandler', requireAuth)

  // ════════════════════════════════════════════════════════════
  //   MENUS — list / get / create / patch / delete
  // ════════════════════════════════════════════════════════════

  app.get('/', async (req) => {
    const venue_id = req.query?.venue_id || null
    return withTenant(req.tenantId, async tx => {
      const rows = await (venue_id
        ? tx`SELECT m.*, v.name AS venue_name FROM menus m LEFT JOIN venues v ON v.id = m.venue_id
              WHERE m.tenant_id = ${req.tenantId} AND m.venue_id = ${venue_id} ORDER BY m.sort_order, m.name`
        : tx`SELECT m.*, v.name AS venue_name FROM menus m LEFT JOIN venues v ON v.id = m.venue_id
              WHERE m.tenant_id = ${req.tenantId} ORDER BY m.sort_order, m.name`)
      return rows
    })
  })

  app.get('/:id', async (req) => {
    const data = await withTenant(req.tenantId, tx => loadMenuFull(tx, req.params.id, req.tenantId))
    if (!data) throw httpError(404, 'Menu not found')
    return data
  })

  app.post('/', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = MenuMetaBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO menus (tenant_id, venue_id, name, slug, tagline, service_times, intro_line, is_published, sort_order, print_columns)
      VALUES (${req.tenantId}, ${body.venue_id ?? null}, ${body.name}, ${body.slug},
              ${body.tagline ?? null}, ${body.service_times ?? null}, ${body.intro_line ?? null},
              ${body.is_published}, ${body.sort_order}, ${body.print_columns})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  app.patch('/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = MenuFullBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const [updated] = await tx`
        UPDATE menus
           SET name = ${body.name},
               slug = ${body.slug},
               venue_id = ${body.venue_id ?? null},
               tagline = ${body.tagline ?? null},
               service_times = ${body.service_times ?? null},
               intro_line = ${body.intro_line ?? null},
               is_published = ${body.is_published},
               sort_order = ${body.sort_order},
               print_columns = ${body.print_columns},
               updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
         RETURNING *
      `
      if (!updated) throw httpError(404, 'Menu not found')
      await upsertMenuTree(tx, req.tenantId, req.params.id, body)
      return loadMenuFull(tx, req.params.id, req.tenantId)
    })
  })

  app.delete('/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM menus WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Menu not found')
    return { ok: true }
  })

  // ════════════════════════════════════════════════════════════
  //   DIETARY TAGS — list / create / patch / delete
  // ════════════════════════════════════════════════════════════

  app.get('/dietary/all', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM menu_dietary_tags WHERE tenant_id = ${req.tenantId}
      ORDER BY sort_order, label
    `)
  })

  app.post('/dietary', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = DietaryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO menu_dietary_tags (tenant_id, code, label, glyph, colour, sort_order)
      VALUES (${req.tenantId}, ${body.code}, ${body.label}, ${body.glyph}, ${body.colour}, ${body.sort_order})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  app.patch('/dietary/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = DietaryBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE menu_dietary_tags SET ${tx(body, ...fields)}
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Dietary tag not found')
    return row
  })

  app.delete('/dietary/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM menu_dietary_tags WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Dietary tag not found')
    return { ok: true }
  })

  // ════════════════════════════════════════════════════════════
  //   SEED — POST /menus/seed/:slug → create a sample One Thai menu
  // ════════════════════════════════════════════════════════════

  app.post('/seed/:slug', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const seed = SEED_BY_SLUG[req.params.slug]
    if (!seed) throw httpError(404, `Unknown seed: ${req.params.slug}`)
    const venue_id = req.body?.venue_id || null

    const created = await withTenant(req.tenantId, async tx => {
      // Ensure the four dietary tags exist before items can reference them.
      await ensureDietaryTags(tx, req.tenantId, ONETHAI_DIETARY_TAGS)

      // Make the slug unique within the chosen scope (tenant or venue).
      let slug = seed.slug
      let n = 2
      while (true) {
        const [hit] = venue_id
          ? await tx`SELECT 1 FROM menus WHERE tenant_id = ${req.tenantId} AND venue_id = ${venue_id} AND slug = ${slug} LIMIT 1`
          : await tx`SELECT 1 FROM menus WHERE tenant_id = ${req.tenantId} AND venue_id IS NULL AND slug = ${slug} LIMIT 1`
        if (!hit) break
        slug = `${seed.slug}-${n++}`
      }

      const [m] = await tx`
        INSERT INTO menus (tenant_id, venue_id, name, slug, tagline, service_times, intro_line, is_published, sort_order, print_columns)
        VALUES (${req.tenantId}, ${venue_id}, ${seed.name}, ${slug},
                ${seed.tagline ?? null}, ${seed.service_times ?? null}, ${seed.intro_line ?? null},
                true, 0, ${seed.print_columns ?? 4})
        RETURNING *
      `
      await upsertMenuTree(tx, req.tenantId, m.id, seed)
      return loadMenuFull(tx, m.id, req.tenantId)
    })

    return reply.code(201).send(created)
  })
}
