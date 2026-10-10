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
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { SEED_BY_SLUG, ONETHAI_DIETARY_TAGS, ensureStandardAllergens } from '../services/menuSeeds.js'
import { randomUUID } from 'node:crypto'
import {
  BLOCK_TYPES, MAX_PAGES, MAX_BLOCKS, MENU_LAYOUT_CSS,
  normalizeLayout, layoutGeometry, buildContext, renderPageHtml, layoutFontsUrl,
} from '../../../shared/menuLayout.js'
import { FONT_OPTIONS } from '../../../shared/fonts.js'
import { ALLERGEN_LEVELS, REMOVABLE_NOTE, usedTags, menuTags } from '../../../shared/menuTags.js'

// ── Schemas ──────────────────────────────────────────────────

const AllergenLevel = z.enum(ALLERGEN_LEVELS)

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
  // Web ordering (migration 122)
  is_orderable:      z.boolean().default(true),
  vat_rate_takeaway: z.number().min(0).max(100).nullable().optional(),
  vat_rate_eat_in:   z.number().min(0).max(100).nullable().optional(),
  min_order_qty:     z.number().int().min(1).max(99).nullable().optional(),   // migration 133
  variants:       z.array(VariantBody).default([]),
  variant_groups: z.array(ItemGroupAttach).default([]),
  // M:N to dietary tags — array of dietary tag CODES (e.g. ['gf', 'spicy'])
  // resolved to ids server-side. allergen_levels gives an allergen's level
  // when it isn't 'contains' (migration 145, shared/menuTags.js).
  dietary:        z.array(z.string().max(32)).default([]),
  allergen_levels: z.record(z.string().max(32), AllergenLevel).default({}),
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
  // Web ordering (migration 127): section VAT, used when a dish has none.
  vat_rate_takeaway: z.number().min(0).max(100).nullable().optional(),
  vat_rate_eat_in:   z.number().min(0).max(100).nullable().optional(),
  // Where the section shows (migration 136): everywhere, printed menus
  // only (website_hidden), or nowhere (hidden).
  visibility: z.enum(['show', 'website_hidden', 'hidden']).default('show'),
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
  variant_columns: z.number().int().min(1).max(3).optional(),
})

// A print design's layout (menu_print_designs.layout, migrations 121 and
// 135) — the menu designer's hand-placed layout. Rendered by
// shared/menuLayout.js; see the shape there.
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
    variant_columns:  z.number().int().min(1).max(3).optional(),
    suffix:           z.string().max(40).optional(),
    variant:          z.enum(['full', 'compact']).optional(),
    text:             z.string().max(2000).optional(),
    style:            z.enum(['heading', 'subheading', 'body', 'script', 'small', 'thin', 'thick', 'dotted', 'double']).optional(),
    url:              z.string().max(2000).optional(),
    fit:              z.enum(['contain', 'cover']).optional(),
    font:             z.enum(FONT_OPTIONS).optional(),
    callout_ids:      z.array(z.string().uuid()).max(50).optional(),
  }).default({}),
})

const LayoutBody = z.object({
  paper_size:  z.enum(['A4', 'A3']).default('A4'),
  orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  margin_mm:   z.number().min(0).max(25).default(10),
  cols:        z.union([z.literal(6), z.literal(12), z.literal(24)]).default(12),
  row_mm:      z.union([z.literal(2.5), z.literal(5), z.literal(10)]).default(5),
  font_scale:  z.number().int().min(70).max(150).default(100),
  variant_columns: z.number().int().min(1).max(3).default(1),
  fold:        z.enum(['none', 'vertical', 'horizontal']).default('none'),
  fold_gap_mm: z.number().min(0).max(40).default(10),
  fold_line:   z.boolean().default(false),
  font_body:    z.enum(FONT_OPTIONS).default('Inter'),
  font_heading: z.enum(FONT_OPTIONS).default('Fraunces'),
  font_script:  z.enum(FONT_OPTIONS).default('Caveat'),
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
  kind:       z.enum(['dietary', 'allergen']).default('dietary'),   // migration 145
  show_on_menu: z.boolean().default(true),                          // migration 146
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
  // Web ordering (migration 122): 'base' options are the dish price,
  // 'extra' options are added on top; how many a guest must / may pick.
  price_mode: z.enum(['base', 'extra']).default('base'),
  min_select: z.number().int().min(0).max(20).default(1),
  max_select: z.number().int().min(1).max(20).default(1),
  options:    z.array(VariantOptionBody).default([]),
})

// ── Loaders ──────────────────────────────────────────────────

/** Attach resolved variant groups (with effective prices) onto item objects. */
export async function attachVariantGroupsToItems(tx, items) {
  const ids = (items || []).map(i => i.id).filter(Boolean)
  if (!ids.length) return items
  const rows = await tx`
    SELECT ig.item_id, ig.group_id, ig.sort_order AS group_sort,
           g.name AS group_name, g.price_mode, g.min_select, g.max_select,
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
      g = {
        group_id: r.group_id, name: r.group_name, sort_order: r.group_sort,
        price_mode: r.price_mode, min_select: r.min_select, max_select: r.max_select, options: [],
      }
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

const AllergenMatrixBody = z.object({
  items: z.array(z.object({
    item_id: z.string().uuid(),
    // tag id -> level; a tag left out = the dish doesn't have it.
    levels:  z.record(z.string().uuid(), AllergenLevel),
  })).max(2000),
})

// Allergen matrix: a menu's sections and dishes (names only) with each
// dish's tags as { tag id: level } (dietary tags are always 'contains'),
// plus every tag of the tenant, allergens first.
// Hidden sections are included (marked by visibility) so staff can still
// answer allergen questions about them.
export async function loadAllergenMatrix(tx, menuId, tenantId) {
  const [menu] = await tx`
    SELECT m.id, m.name, m.updated_at, v.name AS venue_name
      FROM menus m LEFT JOIN venues v ON v.id = m.venue_id
     WHERE m.id = ${menuId} AND m.tenant_id = ${tenantId}
  `
  if (!menu) return null
  const [tags, sections, items, links] = await Promise.all([
    tx`SELECT id, code, label, glyph, colour, sort_order, kind, standard_key, show_on_menu FROM menu_dietary_tags
        WHERE tenant_id = ${tenantId} ORDER BY kind, sort_order, label`,
    tx`SELECT id, title, visibility, sort_order FROM menu_sections
        WHERE menu_id = ${menuId} AND tenant_id = ${tenantId} ORDER BY sort_order, title`,
    tx`SELECT i.id, i.section_id, i.name, i.native_name, i.description, i.sort_order
         FROM menu_items i JOIN menu_sections s ON s.id = i.section_id
        WHERE s.menu_id = ${menuId} AND i.tenant_id = ${tenantId}
        ORDER BY i.sort_order, i.name`,
    tx`SELECT mid.item_id, mid.tag_id, mid.level FROM menu_item_dietary mid
         JOIN menu_items i ON i.id = mid.item_id
         JOIN menu_sections s ON s.id = i.section_id
        WHERE s.menu_id = ${menuId} AND mid.tenant_id = ${tenantId}`,
  ])
  const tagsByItem = {}
  for (const l of links) (tagsByItem[l.item_id] ||= {})[l.tag_id] = l.level
  const bySection = {}
  for (const i of items) {
    (bySection[i.section_id] ||= []).push({
      id: i.id, name: i.name, native_name: i.native_name, description: i.description,
      levels: tagsByItem[i.id] || {},
    })
  }
  return {
    menu,
    tags,
    sections: sections.map(s => ({
      id: s.id, title: s.title, visibility: s.visibility || 'show', items: bySection[s.id] || [],
    })),
  }
}

export async function loadMenuFull(tx, menuId, tenantId) {
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
               'sort_order', i.sort_order, 'is_orderable', i.is_orderable,
               'vat_rate_takeaway', i.vat_rate_takeaway, 'vat_rate_eat_in', i.vat_rate_eat_in,
               'min_order_qty', i.min_order_qty,
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
    tx`SELECT * FROM menu_dietary_tags WHERE tenant_id = ${tenantId} ORDER BY kind = 'allergen', sort_order, label`,
    tx`
      SELECT mid.item_id, t.code, mid.level
        FROM menu_item_dietary mid
        JOIN menu_dietary_tags t ON t.id = mid.tag_id
       WHERE mid.tenant_id = ${tenantId}
       ORDER BY t.kind = 'allergen', t.sort_order, t.label
    `,
  ])

  // Sort items + attach dietary codes (in tag order) and allergen levels
  const dietaryByItem = {}
  const levelsByItem = {}
  for (const row of itemDietary) {
    (dietaryByItem[row.item_id] ||= []).push(row.code)
    if (row.level !== 'contains') (levelsByItem[row.item_id] ||= {})[row.code] = row.level
  }
  for (const s of sections) {
    s.items = (s.items || [])
      .filter(i => i && i.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    for (const i of s.items) {
      i.dietary = dietaryByItem[i.id] || []
      i.allergen_levels = levelsByItem[i.id] || {}
    }
  }

  await attachVariantGroupsToItems(tx, sections.flatMap(s => s.items || []))

  const [{ count: design_count }] = await tx`
    SELECT count(*)::int AS count FROM menu_print_designs
     WHERE menu_id = ${menuId} AND tenant_id = ${tenantId}
  `

  return {
    ...menu,
    sections,
    callouts,
    dietary_tags: tags,
    design_count,
  }
}

// A menu's print designs, oldest first (menu_print_designs, migration 135).
async function loadDesigns(tx, menuId, tenantId) {
  return tx`
    SELECT id, name, layout, created_at, updated_at
      FROM menu_print_designs
     WHERE menu_id = ${menuId} AND tenant_id = ${tenantId}
     ORDER BY created_at, id
  `
}

// Points a copied layout at the copy's sections, dishes and footer notes
// (newId: old id -> new id). Blocks whose section or dish is gone are dropped.
function remapLayout(layout, newId) {
  const remap = b => ({
    ...b, ref: b.ref ? (newId[b.ref] ?? null) : null,
    ...(Array.isArray(b.opts?.callout_ids)
      ? { opts: { ...b.opts, callout_ids: b.opts.callout_ids.map(cid => newId[cid]).filter(Boolean) } }
      : {}),
  })
  const keep = b => !(b.type === 'section' || b.type === 'item') || b.ref
  return {
    ...layout,
    master: (layout.master || []).map(remap).filter(keep),
    pages: (layout.pages || []).map(p => ({ ...p, blocks: (p.blocks || []).map(remap).filter(keep) })),
  }
}

// The menu plus what the printed header shows: tenant name, logo and brand
// colour, and for a venue-scoped menu the venue's address and phone.
// Used by the print page and by the menu designer, so both show the same.
async function loadPrintMenu(tx, menuId, tenantId) {
  const menu = await loadMenuFull(tx, menuId, tenantId)
  if (!menu) return null
  const [meta] = await tx`
    SELECT t.name AS tenant_name, ts.logo_url, ts.primary_colour,
           ts.theme->'typography'->>'heading_font' AS site_heading_font,
           ts.theme->'typography'->>'body_font'    AS site_body_font
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
  const designs = await loadDesigns(tx, menuId, tenantId)
  return {
    ...menu,
    // Printed menus (and the designer, which draws what prints) only know
    // the tags shown on menus (migration 146).
    dietary_tags: menuTags(menu.dietary_tags),
    designs,
    tenant_name:    meta?.tenant_name ?? null,
    logo_url:       meta?.logo_url ?? null,
    primary_colour: meta?.primary_colour ?? null,
    // The website's Brand & theme fonts, offered by the designer's Page setup.
    site_fonts: { heading: meta?.site_heading_font || null, body: meta?.site_body_font || null },
    address_line1, postcode, phone,
  }
}

// ── Bulk upsert: rewrite the menu tree under one menu_id ─────

async function upsertMenuTree(tx, tenantId, menuId, body) {
  // Resolve dietary codes → tags ONCE. Codes referenced but missing are
  // silently dropped (operator can add them via the dietary tag editor).
  // A standard allergen's key also resolves (the seeds say 'nuts' for a
  // tenant whose nuts tag has code 'n').
  const tags = await tx`SELECT id, code, kind, standard_key FROM menu_dietary_tags WHERE tenant_id = ${tenantId}`
  const tagByCode = Object.fromEntries(tags.filter(t => t.standard_key).map(t => [t.standard_key, t]))
  for (const t of tags) tagByCode[t.code] = t

  // Wipe + re-insert. Sections cascade to items → variants → dietary,
  // and callouts cascade from menu_id, so a single delete clears the
  // whole tree. Acceptable because only one admin edits at a time.
  // Sections and dishes are re-inserted under the ids the client sent
  // (new ones get a fresh id), so the designed print layout
  // (menu_print_designs.layout), which points at them by id, survives a save.
  await tx`DELETE FROM menu_sections WHERE menu_id = ${menuId}`
  await tx`DELETE FROM menu_callouts WHERE menu_id = ${menuId}`

  for (const [si, section] of (body.sections || []).entries()) {
    const [s] = await tx`
      INSERT INTO menu_sections (id, menu_id, tenant_id, title, subtitle, highlight, image_url, sort_order,
                                 print_break_before, print_keep_together,
                                 vat_rate_takeaway, vat_rate_eat_in, visibility)
      VALUES (${section.id ?? randomUUID()}, ${menuId}, ${tenantId}, ${section.title},
              ${section.subtitle ?? null}, ${section.highlight ?? false}, ${section.image_url ?? null},
              ${section.sort_order ?? si},
              ${section.print_break_before ?? 'none'}, ${section.print_keep_together ?? false},
              ${section.vat_rate_takeaway ?? null}, ${section.vat_rate_eat_in ?? null},
              ${section.visibility ?? 'show'})
      RETURNING id
    `
    for (const [ii, item] of (section.items || []).entries()) {
      const [it] = await tx`
        INSERT INTO menu_items (id, section_id, tenant_id, name, native_name, description, price_pence, calories, notes, is_featured, image_url, sort_order,
                                is_orderable, vat_rate_takeaway, vat_rate_eat_in, min_order_qty)
        VALUES (${item.id ?? randomUUID()}, ${s.id}, ${tenantId}, ${item.name},
                ${item.native_name ?? null}, ${item.description ?? null},
                ${item.price_pence ?? null}, ${item.calories ?? null}, ${item.notes ?? null},
                ${item.is_featured ?? false}, ${item.image_url ?? null},
                ${item.sort_order ?? ii},
                ${item.is_orderable ?? true}, ${item.vat_rate_takeaway ?? null}, ${item.vat_rate_eat_in ?? null},
                ${item.min_order_qty > 1 ? item.min_order_qty : null})
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
      // Dietary tag links; an allergen's level from allergen_levels
      for (const code of (item.dietary || [])) {
        const tag = tagByCode[code]
        if (!tag) continue
        const level = tagLevel(tag, (item.allergen_levels || {})[code])
        await tx`
          INSERT INTO menu_item_dietary (item_id, tag_id, tenant_id, level)
          VALUES (${it.id}, ${tag.id}, ${tenantId}, ${level})
          ON CONFLICT DO NOTHING
        `
      }
    }
  }

  for (const [ci, c] of (body.callouts || []).entries()) {
    await tx`
      INSERT INTO menu_callouts (id, menu_id, tenant_id, kind, title, body, sort_order)
      VALUES (${c.id ?? randomUUID()}, ${menuId}, ${tenantId}, ${c.kind || 'custom'},
              ${c.title}, ${c.body ?? null}, ${c.sort_order ?? ci})
    `
  }
}

// Only allergens have levels; a dietary tag is on a dish or not.
function tagLevel(tag, level) {
  return tag.kind === 'allergen' && ALLERGEN_LEVELS.includes(level) ? level : 'contains'
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
    // Website only shows sections set to show everywhere (migration 136)
    // and tags shown on menus (migration 146).
    data.sections = (data.sections || []).filter(s => (s.visibility || 'show') === 'show')
    data.dietary_tags = menuTags(data.dietary_tags)
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

    // ?view=dietary: dish names and their dietary tags (icons only) as a
    // two-column list, whatever print design the menu uses.
    // Sections hidden everywhere don't print (migration 136). The designed
    // print drops them in buildContext() instead, so the designer can
    // tell a hidden section from a deleted one. The key lists only the
    // tags the printed dishes use (shared/menuTags.js).
    const printed = { ...menu, sections: (menu.sections || []).filter(s => s.visibility !== 'hidden') }
    const key = usedTags(menu.dietary_tags, printed.sections)
    if (req.query?.view === 'dietary') {
      return reply.view('menu_print_dietary.eta', { menu: printed, key, removableNote: REMOVABLE_NOTE })
    }

    // A print design (menu designer) replaces the automatic layout: the one
    // picked with ?design=<id>, else the menu's chosen one
    // (menus.print_design_id). ?auto=1 shows the automatic layout.
    const wanted = req.query?.design || menu.print_design_id
    const design = !req.query?.auto && wanted ? (menu.designs || []).find(d => d.id === wanted) : null
    if (design) {
      const layout = normalizeLayout(design.layout)
      const ctx = buildContext(menu, layout)
      const g = layoutGeometry(layout)
      return reply.view('menu_print_designed.eta', {
        menu,
        css: MENU_LAYOUT_CSS,
        fontsUrl: layoutFontsUrl(layout),
        pagesHtml: layout.pages.map((_, i) => renderPageHtml(layout, ctx, i)),
        pageW: g.pageW,
        pageH: g.pageH,
        paperSize: layout.paper_size,
        orientation: layout.orientation,
      })
    }
    return reply.view('menu_print.eta', { menu: printed, key, removableNote: REMOVABLE_NOTE })
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
        ? tx`SELECT m.*, v.name AS venue_name,
                    (SELECT count(*)::int FROM menu_print_designs d WHERE d.menu_id = m.id) AS design_count
               FROM menus m LEFT JOIN venues v ON v.id = m.venue_id
              WHERE m.tenant_id = ${req.tenantId} AND m.venue_id = ${venue_id} ORDER BY m.sort_order, m.name`
        : tx`SELECT m.*, v.name AS venue_name,
                    (SELECT count(*)::int FROM menu_print_designs d WHERE d.menu_id = m.id) AS design_count
               FROM menus m LEFT JOIN venues v ON v.id = m.venue_id
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

  // ── Print designs (menu_print_designs, migration 135) ─────
  // A menu can have any number of named designs. menus.print_design_id is
  // the one the print page uses (null = automatic layout). Designs save
  // on their own, never through the whole-tree PATCH.
  const DesignName = z.string().trim().min(1).max(80)
  const menuOf = async (tx, req) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const [m] = await tx`
      SELECT id, print_design_id FROM menus
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} LIMIT 1
    `
    if (!m) throw httpError(404, 'Menu not found')
    return m
  }
  const designOf = async (tx, req) => {
    if (!z.string().uuid().safeParse(req.params.designId).success) throw httpError(404, 'Design not found')
    const [d] = await tx`
      SELECT id FROM menu_print_designs
       WHERE id = ${req.params.designId} AND menu_id = ${req.params.id} AND tenant_id = ${req.tenantId}
    `
    if (!d) throw httpError(404, 'Design not found')
    return d
  }

  // { name, layout } — a new design. A menu's first design is also made
  // the one used for printing.
  app.post('/:id/designs', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = z.object({ name: DesignName, layout: LayoutBody }).parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      const menu = await menuOf(tx, req)
      const [{ count }] = await tx`
        SELECT count(*)::int AS count FROM menu_print_designs
         WHERE menu_id = ${menu.id} AND tenant_id = ${req.tenantId}
      `
      const [d] = await tx`
        INSERT INTO menu_print_designs (tenant_id, menu_id, name, layout)
        VALUES (${req.tenantId}, ${menu.id}, ${body.name}, ${tx.json(body.layout)})
        RETURNING id, name, layout, created_at, updated_at
      `
      if (count === 0 && !menu.print_design_id) {
        await tx`UPDATE menus SET print_design_id = ${d.id}, updated_at = now()
                  WHERE id = ${menu.id} AND tenant_id = ${req.tenantId}`
      }
      return d
    })
    return reply.code(201).send(row)
  })

  // { name?, layout? }
  app.put('/:id/designs/:designId', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = z.object({ name: DesignName.optional(), layout: LayoutBody.optional() }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await menuOf(tx, req)
      const d = await designOf(tx, req)
      const [row] = await tx`
        UPDATE menu_print_designs
           SET name   = COALESCE(${body.name ?? null}, name),
               layout = COALESCE(${body.layout ? tx.json(body.layout) : null}::jsonb, layout),
               updated_at = now()
         WHERE id = ${d.id} AND tenant_id = ${req.tenantId}
         RETURNING id, name, layout, created_at, updated_at
      `
      return row
    })
  })

  // Deleting the design used for printing sends printing back to the
  // automatic layout (ON DELETE SET NULL).
  app.delete('/:id/designs/:designId', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    return withTenant(req.tenantId, async tx => {
      await menuOf(tx, req)
      const d = await designOf(tx, req)
      await tx`DELETE FROM menu_print_designs WHERE id = ${d.id} AND tenant_id = ${req.tenantId}`
      return { ok: true }
    })
  })

  // { design_id } — the design the print page uses; null = automatic layout.
  app.put('/:id/print-design', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { design_id } = z.object({ design_id: z.string().uuid().nullable() }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const menu = await menuOf(tx, req)
      if (design_id) {
        const [d] = await tx`
          SELECT id FROM menu_print_designs
           WHERE id = ${design_id} AND menu_id = ${menu.id} AND tenant_id = ${req.tenantId}
        `
        if (!d) throw httpError(404, 'Design not found')
      }
      const [row] = await tx`
        UPDATE menus SET print_design_id = ${design_id}, updated_at = now()
         WHERE id = ${menu.id} AND tenant_id = ${req.tenantId}
         RETURNING id, print_design_id
      `
      return row
    })
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
        vat_rate_takeaway: s.vat_rate_takeaway != null ? Number(s.vat_rate_takeaway) : null,
        vat_rate_eat_in: s.vat_rate_eat_in != null ? Number(s.vat_rate_eat_in) : null,
        visibility: s.visibility || 'show',
        items: (s.items || []).map(it => ({
          id: (newId[it.id] = randomUUID()),
          name: it.name, native_name: it.native_name ?? null, description: it.description ?? null,
          price_pence: it.price_pence ?? null, calories: it.calories ?? null, notes: it.notes ?? null, is_featured: !!it.is_featured,
          image_url: it.image_url ?? null, sort_order: it.sort_order,
          is_orderable: it.is_orderable !== false,
          vat_rate_takeaway: it.vat_rate_takeaway != null ? Number(it.vat_rate_takeaway) : null,
          vat_rate_eat_in: it.vat_rate_eat_in != null ? Number(it.vat_rate_eat_in) : null,
          min_order_qty: it.min_order_qty ?? null,
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
          allergen_levels: it.allergen_levels || {},
        })),
      }))
      const callouts = (full.callouts || []).map(c => {
        const id = randomUUID(); newId[c.id] = id
        return { id, kind: c.kind, title: c.title, body: c.body ?? null, sort_order: c.sort_order }
      })

      await upsertMenuTree(tx, req.tenantId, row.id, { sections, callouts })

      // Every print design comes along, pointed at the copy's rows, and the
      // copy prints with the same design as the original.
      for (const d of await loadDesigns(tx, full.id, req.tenantId)) {
        const [copy] = await tx`
          INSERT INTO menu_print_designs (tenant_id, menu_id, name, layout, created_at)
          VALUES (${req.tenantId}, ${row.id}, ${d.name}, ${tx.json(remapLayout(d.layout, newId))}, ${d.created_at})
          RETURNING id
        `
        if (d.id === full.print_design_id) {
          await tx`UPDATE menus SET print_design_id = ${copy.id} WHERE id = ${row.id} AND tenant_id = ${req.tenantId}`
          row.print_design_id = copy.id
        }
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
  //   ALLERGEN MATRIX — every dish of a menu against every tag
  // ════════════════════════════════════════════════════════════
  //
  // Read by the Allergen matrix page and the dashboard Allergen lookup.
  // Saving writes only menu_item_dietary for the dishes sent, so it never
  // touches the rest of the menu tree (no whole-tree PATCH).

  app.get('/:id/allergens', async (req) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const data = await withTenant(req.tenantId, tx => loadAllergenMatrix(tx, req.params.id, req.tenantId))
    if (!data) throw httpError(404, 'Menu not found')
    return data
  })

  app.put('/:id/allergens', { preHandler: requirePermission('menus', 'manage') }, async (req) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw httpError(404, 'Menu not found')
    const body = AllergenMatrixBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const [menu] = await tx`
        SELECT id FROM menus WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      `
      if (!menu) throw httpError(404, 'Menu not found')
      const itemIds = [...new Set(body.items.map(i => i.item_id))]
      const owned = itemIds.length ? await tx`
        SELECT i.id FROM menu_items i
          JOIN menu_sections s ON s.id = i.section_id
         WHERE s.menu_id = ${menu.id} AND i.tenant_id = ${req.tenantId}
           AND i.id = ANY(${itemIds}::uuid[])
      ` : []
      if (owned.length !== itemIds.length) throw httpError(422, 'Some dishes are not on this menu any more. Reload and try again.')
      const tagRows = await tx`SELECT id, kind FROM menu_dietary_tags WHERE tenant_id = ${req.tenantId}`
      const tagById = Object.fromEntries(tagRows.map(t => [t.id, t]))
      if (itemIds.length) {
        await tx`
          DELETE FROM menu_item_dietary
           WHERE tenant_id = ${req.tenantId} AND item_id = ANY(${itemIds}::uuid[])
        `
        const rows = []
        for (const it of body.items) {
          for (const [tagId, level] of Object.entries(it.levels)) {
            const tag = tagById[tagId]
            if (tag) rows.push({ item_id: it.item_id, tag_id: tagId, tenant_id: req.tenantId, level: tagLevel(tag, level) })
          }
        }
        if (rows.length) {
          await tx`INSERT INTO menu_item_dietary ${tx(rows, 'item_id', 'tag_id', 'tenant_id', 'level')} ON CONFLICT DO NOTHING`
        }
        await tx`UPDATE menus SET updated_at = now() WHERE id = ${menu.id}`
      }
      return loadAllergenMatrix(tx, menu.id, req.tenantId)
    })
  })

  // ════════════════════════════════════════════════════════════
  //   DIETARY TAGS — list / create / patch / delete
  // ════════════════════════════════════════════════════════════

  app.get('/dietary/all', async (req) => {
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM menu_dietary_tags WHERE tenant_id = ${req.tenantId}
      ORDER BY kind = 'allergen', sort_order, label
    `)
  })

  app.post('/dietary', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = DietaryBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO menu_dietary_tags (tenant_id, code, label, glyph, colour, sort_order, kind, show_on_menu)
      VALUES (${req.tenantId}, ${body.code}, ${body.label}, ${body.glyph}, ${body.colour}, ${body.sort_order}, ${body.kind}, ${body.show_on_menu})
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  // Adds whichever of the 14 standard allergens the tenant doesn't have.
  app.post('/dietary/standard-allergens', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const added = await withTenant(req.tenantId, tx => ensureStandardAllergens(tx, req.tenantId))
    return { added: added.length }
  })

  // Drag order of one list (allergens or dietary tags): ids in their new order.
  app.patch('/dietary/reorder', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body)
    return withTenant(req.tenantId, async tx => {
      for (const [i, id] of ids.entries()) {
        await tx`UPDATE menu_dietary_tags SET sort_order = ${i} WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
      return { ok: true }
    })
  })

  app.patch('/dietary/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body = DietaryBody.partial().parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    return withTenant(req.tenantId, async tx => {
      const [tag] = await tx`
        SELECT * FROM menu_dietary_tags WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      `
      if (!tag) throw httpError(404, 'Dietary tag not found')
      if (body.kind === 'dietary' && tag.standard_key) {
        throw httpError(422, `${tag.label} is one of the 14 standard allergens, so it stays an allergen.`)
      }
      const [row] = await tx`
        UPDATE menu_dietary_tags SET ${tx(body, ...fields)}
         WHERE id = ${tag.id} AND tenant_id = ${req.tenantId}
         RETURNING *
      `
      // A dietary tag has no levels: an allergen turned into one keeps
      // every dish it was on, as plain "has it".
      if (body.kind === 'dietary' && tag.kind === 'allergen') {
        await tx`
          UPDATE menu_item_dietary SET level = 'contains'
           WHERE tag_id = ${tag.id} AND tenant_id = ${req.tenantId} AND level <> 'contains'
        `
      }
      return row
    })
  })

  // Moves every dish link of a tag onto another tag, then deletes it.
  // A dish that already has the other tag keeps its own level there.
  app.post('/dietary/:id/merge', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { into_id } = z.object({ into_id: z.string().uuid() }).parse(req.body)
    if (into_id === req.params.id) throw httpError(422, 'Pick a different tag to merge into')
    return withTenant(req.tenantId, async tx => {
      const pair = await tx`
        SELECT id, kind FROM menu_dietary_tags
         WHERE tenant_id = ${req.tenantId} AND id = ANY(${[req.params.id, into_id]}::uuid[])
      `
      const from = pair.find(t => t.id === req.params.id)
      const into = pair.find(t => t.id === into_id)
      if (!from || !into) throw httpError(404, 'Dietary tag not found')
      const moved = await tx`
        INSERT INTO menu_item_dietary (item_id, tag_id, tenant_id, level)
        SELECT item_id, ${into.id}, tenant_id, CASE WHEN ${into.kind === 'allergen'}::boolean THEN level ELSE 'contains' END
          FROM menu_item_dietary
         WHERE tag_id = ${from.id} AND tenant_id = ${req.tenantId}
        ON CONFLICT (item_id, tag_id) DO NOTHING
        RETURNING item_id
      `
      await tx`DELETE FROM menu_dietary_tags WHERE id = ${from.id} AND tenant_id = ${req.tenantId}`
      await tx`
        UPDATE menus SET updated_at = now()
         WHERE tenant_id = ${req.tenantId} AND id IN (
           SELECT s.menu_id FROM menu_items i JOIN menu_sections s ON s.id = i.section_id
            WHERE i.id = ANY(${moved.map(r => r.item_id)}::uuid[]))
      `
      return { ok: true, moved: moved.length }
    })
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
        INSERT INTO menu_variant_groups (tenant_id, name, sort_order, price_mode, min_select, max_select)
        VALUES (${req.tenantId}, ${body.name}, ${body.sort_order}, ${body.price_mode},
                ${Math.min(body.min_select, body.max_select)}, ${body.max_select})
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
           SET name = ${body.name}, sort_order = ${body.sort_order},
               price_mode = ${body.price_mode},
               min_select = ${Math.min(body.min_select, body.max_select)}, max_select = ${body.max_select},
               updated_at = now()
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
      // Ensure the seed's dietary tags and the standard allergens exist
      // before items can reference them.
      await ensureDietaryTags(tx, req.tenantId, ONETHAI_DIETARY_TAGS)
      await ensureStandardAllergens(tx, req.tenantId)

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
