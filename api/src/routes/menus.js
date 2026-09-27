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
import { randomUUID } from 'node:crypto'
import {
  BLOCK_TYPES, MAX_PAGES, MAX_BLOCKS, MENU_LAYOUT_CSS, MENU_LAYOUT_FONTS_URL,
  normalizeLayout, layoutGeometry, buildContext, renderPageHtml,
} from '../../../shared/menuLayout.js'

// ── Schemas ──────────────────────────────────────────────────

const VariantBody = z.object({
  id:          z.string().uuid().optional(),
  label:       z.string().min(1).max(60),
  price_pence: z.number().int().min(0),
  sort_order:  z.number().int().default(0),
})

const ItemGroupAttach = z.object({
  group_id:   z.string().uuid(),
  sort_order: z.number().int().default(0),
  overrides:  z.array(z.object({
    option_id:    z.string().uuid(),
    price_pence:  z.number().int().min(0),
  })).default([]),
})

const ItemBody = z.object({
  id:             z.string().uuid().optional(),
  name:           z.string().min(1).max(200),
  native_name:    z.string().max(200).nullable().optional(),
  description:    z.string().nullable().optional(),
  price_pence:    z.number().int().min(0).nullable().optional(),
  calories:       z.number().int().min(0).nullable().optional(),
  notes:          z.string().max(200).nullable().optional(),
  is_featured:    z.boolean().default(false),
  image_url:      z.string().max(2000).nullable().optional(),
  sort_order:     z.number().int().default(0),
  variants:       z.array(VariantBody).default([]),
  variant_groups: z.array(ItemGroupAttach).default([]),
  // M:N to dietary tags — array of dietary tag CODES (e.g. ['gf', 'spicy'])
  // resolved to ids server-side.
  dietary:        z.array(z.string().max(32)).default([]),
})

const SectionBody = z.object({
  id:         z.string().uuid().optional(),
  title:      z.string().min(1).max(120),
  subtitle:   z.string().max(120).nullable().optional(),
  highlight:  z.boolean().default(false),
  image_url:  z.string().max(2000).nullable().optional(),
  sort_order: z.number().int().default(0),
  // Print layout (migration 120): start in a new column / on a new
  // printed page, and never split this section.
  print_break_before:  z.enum(['none', 'column', 'page']).default('none'),
  print_keep_together: z.boolean().default(false),
  items:      z.array(ItemBody).default([]),
})

// menus.print_settings (migration 120). Every key optional; a missing key
// means the original layout, so an untouched menu prints as it always did.
const PrintSettings = z.object({
  font_scale:    z.number().int().min(70).max(150).optional(),
  margin_mm:     z.number().min(3).max(25).nullable().optional(),
  repeat_header: z.enum(['first', 'full', 'compact']).optional(),
  repeat_footer: z.boolean().optional(),
  page_numbers:  z.boolean().optional(),
  keep_sections: z.boolean().optional(),
})

// menus.print_layout (migration 121) — the menu designer's hand-placed
// layout. Rendered by shared/menuLayout.js; see the shape there.
const LayoutBlock = z.object({
  id:   z.string().min(1).max(64),
  type: z.enum(BLOCK_TYPES),
  ref:  z.string().uuid().nullable().optional(),
  x:    z.number().int().min(0),
  y:    z.number().int().min(0),
  w:    z.number().int().min(1),
  h:    z.number().int().min(1),
  opts: z.object({
    font_scale:       z.number().int().min(50).max(300).optional(),
    align:            z.enum(['left', 'center', 'right']).optional(),
    box:              z.enum(['none', 'tint', 'outline']).optional(),
    mode:             z.enum(['title', 'full']).optional(),
    columns:          z.number().int().min(1).max(6).optional(),
    show_subtitle:    z.boolean().optional(),
    show_image:       z.boolean().optional(),
    show_rule:        z.boolean().optional(),
    show_description: z.boolean().optional(),
    show_logo:        z.boolean().optional(),
    suffix:           z.string().max(40).optional(),
    variant:          z.enum(['full', 'compact']).optional(),
    text:             z.string().max(2000).optional(),
    style:            z.enum(['heading', 'subheading', 'body', 'script', 'small', 'thin', 'thick', 'dotted', 'double']).optional(),
    url:              z.string().max(2000).optional(),
    fit:              z.enum(['contain', 'cover']).optional(),
  }).default({}),
})

const LayoutBody = z.object({
  paper_size:  z.enum(['A4', 'A3']).default('A4'),
  orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  margin_mm:   z.number().min(0).max(25).default(10),
  cols:        z.union([z.literal(6), z.literal(12), z.literal(24)]).default(12),
  row_mm:      z.union([z.literal(2.5), z.literal(5), z.literal(10)]).default(5),
  font_scale:  z.number().int().min(70).max(150).default(100),
  master:      z.array(LayoutBlock).max(100).default([]),
  pages:       z.array(z.object({
    id:          z.string().min(1).max(64),
    hide_master: z.boolean().default(false),
    blocks:      z.array(LayoutBlock).max(MAX_BLOCKS).default([]),
  })).min(1).max(MAX_PAGES),
}).superRefine((l, ctx) => {
  const g = layoutGeometry(l)
  const all = [...l.master, ...l.pages.flatMap(p => p.blocks)]
  for (const b of all) {
    if (b.x + b.w > g.cols || b.y + b.h > g.rows) {
      ctx.addIssue({ code: 'custom', message: `Block ${b.id} is outside the page` })
    }
    if ((b.type === 'section' || b.type === 'item') && !b.ref) {
      ctx.addIssue({ code: 'custom', message: `Block ${b.id} needs a section or dish` })
    }
  }
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
  intro_line:    z.string().max(5000).nullable().optional(),
  is_published:  z.boolean().default(true),
  sort_order:    z.number().int().default(0),
  print_columns:     z.number().int().min(1).max(6).default(4),
  print_orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  print_paper_size:  z.enum(['A4', 'A3']).default('A4'),
  print_hide_variant_group_headers: z.boolean().default(false),
  print_settings:                   PrintSettings.default({}),
  hide_zero_priced_variants:        z.boolean().default(false),
  hide_unpriced_variants:           z.boolean().default(false),
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

const VariantOptionBody = z.object({
  id:          z.string().uuid().optional(),
  label:       z.string().min(1).max(60),
  price_pence: z.number().int().min(0).default(0),
  sort_order:  z.number().int().default(0),
})

const VariantGroupBody = z.object({
  name:       z.string().min(1).max(80),
  sort_order: z.number().int().default(0),
  options:    z.array(VariantOptionBody).default([]),
})

// ── Loaders ──────────────────────────────────────────────────

/** Attach resolved variant groups (with effective prices) onto item objects. */
export async function attachVariantGroupsToItems(tx, items) {
  const ids = (items || []).map(i => i.id).filter(Boolean)
  if (!ids.length) return items
  const rows = await tx`
    SELECT ig.item_id, ig.group_id, ig.sort_order AS group_sort,
           g.name AS group_name,
           o.id AS option_id, o.label, o.price_pence AS default_pence,
           o.sort_order AS option_sort,
           p.price_pence AS override_pence
      FROM menu_item_variant_groups ig
      JOIN menu_variant_groups g ON g.id = ig.group_id
      JOIN menu_variant_options o ON o.group_id = g.id
      LEFT JOIN menu_item_variant_prices p
             ON p.item_id = ig.item_id AND p.option_id = o.id
     WHERE ig.item_id = ANY(${ids}::uuid[])
     ORDER BY ig.sort_order, o.sort_order, o.label
  `
  const byItem = {}
  for (const r of rows) {
    const list = (byItem[r.item_id] ||= [])
    let g = list.find(x => x.group_id === r.group_id)
    if (!g) {
      g = { group_id: r.group_id, name: r.group_name, sort_order: r.group_sort, options: [] }
      list.push(g)
    }
    const overridden = r.override_pence != null
    g.options.push({
      option_id:     r.option_id,
      label:         r.label,
      default_pence: r.default_pence,
      price_pence:   overridden ? r.override_pence : r.default_pence,
      overridden,
    })
  }
  for (const item of items) {
    item.variant_groups = byItem[item.id] || []
  }
  return items
}

async function loadVariantGroups(tx, tenantId) {
  const groups = await tx`
    SELECT g.*,
           COALESCE(json_agg(jsonb_build_object(
             'id', o.id, 'label', o.label,
             'price_pence', o.price_pence, 'sort_order', o.sort_order
           ) ORDER BY o.sort_order, o.label) FILTER (WHERE o.id IS NOT NULL), '[]'::json) AS options
      FROM menu_variant_groups g
      LEFT JOIN menu_variant_options o ON o.group_id = g.id
     WHERE g.tenant_id = ${tenantId}
     GROUP BY g.id
     ORDER BY g.sort_order, g.name
  `
  return groups
}

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
               'description', i.description, 'price_pence', i.price_pence, 'calories', i.calories,
               'notes', i.notes, 'is_featured', i.is_featured, 'image_url', i.image_url,
               'sort_order', i.sort_order,
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

  await attachVariantGroupsToItems(tx, sections.flatMap(s => s.items || []))

  return {
    ...menu,
    sections,
    callouts,
    dietary_tags: tags,
  }
}

// The menu plus what the printed header shows: tenant name, logo and brand
// colour, and for a venue-scoped menu the venue's address and phone.
// Used by the print page and by the menu designer, so both show the same.
async function loadPrintMenu(tx, menuId, tenantId) {
  const menu = await loadMenuFull(tx, menuId, tenantId)
  if (!menu) return null
  const [meta] = await tx`
    SELECT t.name AS tenant_name, ts.logo_url, ts.primary_colour
      FROM tenants t
      LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
     WHERE t.id = ${tenantId}
     LIMIT 1
  `
  let address_line1 = null, postcode = null, phone = null
  if (menu.venue_id) {
    const [v] = await tx`
      SELECT wc.address_line1, wc.postcode, wc.phone
        FROM venues v
        LEFT JOIN website_config wc ON wc.venue_id = v.id
       WHERE v.id = ${menu.venue_id} LIMIT 1
    `
    if (v) { address_line1 = v.address_line1; postcode = v.postcode; phone = v.phone }
  }
  return {
    ...menu,
    tenant_name:    meta?.tenant_name ?? null,
    logo_url:       meta?.logo_url ?? null,
    primary_colour: meta?.primary_colour ?? null,
    address_line1, postcode, phone,
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
  // Sections and dishes are re-inserted under the ids the client sent
  // (new ones get a fresh id), so the designed print layout
  // (menus.print_layout), which points at them by id, survives a save.
  await tx`DELETE FROM menu_sections WHERE menu_id = ${menuId}`
  await tx`DELETE FROM menu_callouts WHERE menu_id = ${menuId}`

  for (const [si, section] of (body.sections || []).entries()) {
    const [s] = await tx`
      INSERT INTO menu_sections (id, menu_id, tenant_id, title, subtitle, highlight, image_url, sort_order,
                                 print_break_before, print_keep_together)
      VALUES (${section.id ?? randomUUID()}, ${menuId}, ${tenantId}, ${section.title},
              ${section.subtitle ?? null}, ${section.highlight ?? false}, ${section.image_url ?? null},
              ${section.sort_order ?? si},
              ${section.print_break_before ?? 'none'}, ${section.print_keep_together ?? false})
      RETURNING id
    `
    for (const [ii, item] of (section.items || []).entries()) {
      const [it] = await tx`
        INSERT INTO menu_items (id, section_id, tenant_id, name, native_name, description, price_pence, calories, notes, is_featured, image_url, sort_order)
        VALUES (${item.id ?? randomUUID()}, ${s.id}, ${tenantId}, ${item.name},
                ${item.native_name ?? null}, ${item.description ?? null},
                ${item.price_pence ?? null}, ${item.calories ?? null}, ${item.notes ?? null},
                ${item.is_featured ?? false}, ${item.image_url ?? null},
                ${item.sort_order ?? ii})
        RETURNING id
      `
      // Variants (ad-hoc, per-item)
      for (const [vi, variant] of (item.variants || []).entries()) {
        await tx`
          INSERT INTO menu_item_variants (item_id, tenant_id, label, price_pence, sort_order)
          VALUES (${it.id}, ${tenantId}, ${variant.label}, ${variant.price_pence}, ${variant.sort_order ?? vi})
        `
      }
      // Attached variant groups + optional price overrides
      for (const [gi, g] of (item.variant_groups || []).entries()) {
        if (!g?.group_id) continue
        await tx`
          INSERT INTO menu_item_variant_groups (item_id, group_id, tenant_id, sort_order)
          VALUES (${it.id}, ${g.group_id}, ${tenantId}, ${g.sort_order ?? gi})
          ON CONFLICT DO NOTHING
        `
        for (const ov of (g.overrides || [])) {
          if (!ov?.option_id || ov.price_pence == null) continue
          await tx`
            INSERT INTO menu_item_variant_prices (item_id, option_id, tenant_id, price_pence)
            VALUES (${it.id}, ${ov.option_id}, ${tenantId}, ${ov.price_pence})
            ON CONFLICT (item_id, option_id) DO UPDATE SET price_pence = EXCLUDED.price_pence
          `
        }
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
    const notFound = () => {
      reply.code(404)
      return reply.view('site/not-found.eta', { message: 'Menu not found', rootDomain: 'macaroonie.com' })
    }
    if (!z.string().uuid().safeParse(req.params.id).success) return notFound()
    const [meta] = await sql`SELECT tenant_id FROM menus WHERE id = ${req.params.id} LIMIT 1`
    if (!meta) return notFound()
    const menu = await withTenant(meta.tenant_id, tx => loadPrintMenu(tx, req.params.id, meta.tenant_id))
    if (!menu) return notFound()

    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

    // A designed layout (menu designer) replaces the automatic one.
    // ?auto=1 still shows the automatic layout, for comparison.
    if (menu.print_layout && !req.query?.auto) {
      const layout = normalizeLayout(menu.print_layout)
      const ctx = buildContext(menu, layout)
      const g = layoutGeometry(layout)
      return reply.view('menu_print_designed.eta', {
        menu,
        css: MENU_LAYOUT_CSS,
        fontsUrl: MENU_LAYOUT_FONTS_URL,
        pagesHtml: layout.pages.map((_, i) => renderPageHtml(layout, ctx, i)),
        pageH: g.pageH,
        paperSize: layout.paper_size,
        orientation: layout.orientation,
      })
    }
    return reply.view('menu_print.eta', { menu })
  })

  // ── Authenticated admin routes — scoped so addHook doesn't ──
  // reach the public routes above. Fastify's addHook applies to
  // every route in the same encapsulation scope regardless of
  // registration order, so the public routes must live outside.
  await app.register(async function adminMenuRoutes(app) {
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
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const data = await withTenant(req.tenantId, tx => loadMenuFull(tx, req.params.id, req.tenantId))
    if (!data) throw httpError(404, 'Menu not found')
    return data
  })

  // Menu designer: the menu with its print header details, and saving the
  // designed layout on its own (never through the whole-tree PATCH).
  app.get('/:id/design', async (req) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const data = await withTenant(req.tenantId, tx => loadPrintMenu(tx, req.params.id, req.tenantId))
    if (!data) throw httpError(404, 'Menu not found')
    return data
  })

  // { layout: {...} } saves a designed layout; { layout: null } goes back
  // to the automatic one.
  app.put('/:id/print-layout', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const { layout } = z.object({ layout: LayoutBody.nullable() }).parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE menus
         SET print_layout = ${layout ? tx.json(layout) : null}, updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING id, print_layout
    `)
    if (!row) throw httpError(404, 'Menu not found')
    return row
  })

  app.post('/', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = MenuMetaBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO menus (tenant_id, venue_id, name, slug, tagline, service_times, intro_line, is_published, sort_order, print_columns, print_orientation, print_paper_size, print_hide_variant_group_headers, print_settings, hide_zero_priced_variants, hide_unpriced_variants)
      VALUES (${req.tenantId}, ${body.venue_id ?? null}, ${body.name}, ${body.slug},
              ${body.tagline ?? null}, ${body.service_times ?? null}, ${body.intro_line ?? null},
              ${body.is_published}, ${body.sort_order}, ${body.print_columns}, ${body.print_orientation}, ${body.print_paper_size},
              ${body.print_hide_variant_group_headers}, ${tx.json(body.print_settings)}, ${body.hide_zero_priced_variants}, ${body.hide_unpriced_variants})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  // ── Duplicate — full copy (meta + sections/items/variants/dietary/
  // callouts) under a new menu row in the same scope. Unpublished by
  // default so a copy doesn't go live before the operator reviews it.
  app.post('/:id/duplicate', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const created = await withTenant(req.tenantId, async tx => {
      const full = await loadMenuFull(tx, req.params.id, req.tenantId)
      if (!full) return null

      // Free slug in the same (tenant, venue) scope: slug-copy, slug-copy-2, …
      const existing = await tx`
        SELECT slug FROM menus
         WHERE tenant_id = ${req.tenantId}
           AND venue_id IS NOT DISTINCT FROM ${full.venue_id}
      `
      const taken = new Set(existing.map(r => r.slug))
      let slug = `${full.slug}-copy`
      for (let n = 2; taken.has(slug); n++) slug = `${full.slug}-copy-${n}`

      const [row] = await tx`
        INSERT INTO menus (tenant_id, venue_id, name, slug, tagline, service_times, intro_line, is_published, sort_order, print_columns, print_orientation, print_paper_size, print_hide_variant_group_headers, print_settings, hide_zero_priced_variants, hide_unpriced_variants)
        VALUES (${req.tenantId}, ${full.venue_id ?? null}, ${full.name + ' (copy)'}, ${slug},
                ${full.tagline ?? null}, ${full.service_times ?? null}, ${full.intro_line ?? null},
                false, ${full.sort_order ?? 0}, ${full.print_columns ?? 4},
                ${full.print_orientation ?? 'landscape'}, ${full.print_paper_size ?? 'A4'},
                ${!!full.print_hide_variant_group_headers}, ${tx.json(full.print_settings ?? {})},
                ${!!full.hide_zero_priced_variants}, ${!!full.hide_unpriced_variants})
        RETURNING *
      `

      // Fresh ids for the copy, remembered so the designed print layout
      // can be pointed at the copy's sections and dishes.
      const newId = {}
      const sections = (full.sections || []).map(s => ({
        id: (newId[s.id] = randomUUID()),
        title: s.title, subtitle: s.subtitle ?? null, highlight: !!s.highlight, image_url: s.image_url ?? null, sort_order: s.sort_order,
        print_break_before: s.print_break_before ?? 'none', print_keep_together: !!s.print_keep_together,
        items: (s.items || []).map(it => ({
          id: (newId[it.id] = randomUUID()),
          name: it.name, native_name: it.native_name ?? null, description: it.description ?? null,
          price_pence: it.price_pence ?? null, calories: it.calories ?? null, notes: it.notes ?? null, is_featured: !!it.is_featured,
          image_url: it.image_url ?? null, sort_order: it.sort_order,
          variants: (it.variants || []).map(v => ({ label: v.label, price_pence: v.price_pence, sort_order: v.sort_order })),
          // loadMenuFull() shapes attached groups as { options: [{overridden, price_pence, option_id}] }
          // (built for the UI) — upsertMenuTree() wants { overrides: [{option_id, price_pence}] }
          // (only the overridden ones). Same conversion the frontend does on save.
          variant_groups: (it.variant_groups || []).map(g => ({
            group_id: g.group_id,
            sort_order: g.sort_order,
            overrides: (g.options || [])
              .filter(o => o.overridden)
              .map(o => ({ option_id: o.option_id, price_pence: o.price_pence })),
          })),
          dietary: it.dietary || [],
        })),
      }))
      const callouts = (full.callouts || []).map(c => ({ kind: c.kind, title: c.title, body: c.body ?? null, sort_order: c.sort_order }))

      await upsertMenuTree(tx, req.tenantId, row.id, { sections, callouts })
      if (full.print_layout) {
        const remap = b => ({ ...b, ref: b.ref ? (newId[b.ref] ?? null) : null })
        const keep = b => !(b.type === 'section' || b.type === 'item') || b.ref
        const layout = {
          ...full.print_layout,
          master: (full.print_layout.master || []).map(remap).filter(keep),
          pages: (full.print_layout.pages || []).map(p => ({ ...p, blocks: (p.blocks || []).map(remap).filter(keep) })),
        }
        await tx`UPDATE menus SET print_layout = ${tx.json(layout)} WHERE id = ${row.id}`
        row.print_layout = layout
      }
      return row
    })
    if (!created) throw httpError(404, 'Menu not found')
    return reply.code(201).send(created)
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
               print_orientation = ${body.print_orientation},
               print_paper_size = ${body.print_paper_size},
               print_hide_variant_group_headers = ${body.print_hide_variant_group_headers},
               print_settings = ${tx.json(body.print_settings)},
               hide_zero_priced_variants = ${body.hide_zero_priced_variants},
               hide_unpriced_variants = ${body.hide_unpriced_variants},
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
  //   VARIANT GROUPS — tenant-wide reusable option sets
  // ════════════════════════════════════════════════════════════

  app.get('/variant-groups', async (req) => {
    return withTenant(req.tenantId, tx => loadVariantGroups(tx, req.tenantId))
  })

  app.post('/variant-groups', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = VariantGroupBody.parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const [g] = await tx`
        INSERT INTO menu_variant_groups (tenant_id, name, sort_order)
        VALUES (${req.tenantId}, ${body.name}, ${body.sort_order})
        RETURNING *
      `
      const options = []
      for (const [i, o] of (body.options || []).entries()) {
        const [opt] = await tx`
          INSERT INTO menu_variant_options (group_id, tenant_id, label, price_pence, sort_order)
          VALUES (${g.id}, ${req.tenantId}, ${o.label}, ${o.price_pence}, ${o.sort_order ?? i})
          RETURNING *
        `
        options.push(opt)
      }
      return { ...g, options }
    })
    return reply.code(201).send(row)
  })

  app.patch('/variant-groups/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = VariantGroupBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const [g] = await tx`
        UPDATE menu_variant_groups
           SET name = ${body.name}, sort_order = ${body.sort_order}, updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
         RETURNING *
      `
      if (!g) throw httpError(404, 'Variant group not found')

      const keepIds = []
      const options = []
      for (const [i, o] of (body.options || []).entries()) {
        if (o.id) {
          const [opt] = await tx`
            UPDATE menu_variant_options
               SET label = ${o.label}, price_pence = ${o.price_pence}, sort_order = ${i}
             WHERE id = ${o.id} AND group_id = ${g.id} AND tenant_id = ${req.tenantId}
             RETURNING *
          `
          if (opt) { keepIds.push(opt.id); options.push(opt) }
        } else {
          const [opt] = await tx`
            INSERT INTO menu_variant_options (group_id, tenant_id, label, price_pence, sort_order)
            VALUES (${g.id}, ${req.tenantId}, ${o.label}, ${o.price_pence}, ${i})
            RETURNING *
          `
          keepIds.push(opt.id)
          options.push(opt)
        }
      }
      if (keepIds.length) {
        await tx`
          DELETE FROM menu_variant_options
           WHERE group_id = ${g.id} AND tenant_id = ${req.tenantId}
             AND NOT (id = ANY(${keepIds}::uuid[]))
        `
      } else {
        await tx`DELETE FROM menu_variant_options WHERE group_id = ${g.id} AND tenant_id = ${req.tenantId}`
      }
      return { ...g, options }
    })
  })

  app.delete('/variant-groups/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM menu_variant_groups WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Variant group not found')
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

  }) // end adminMenuRoutes
}
