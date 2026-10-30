// src/routes/deliveroo.js
//
// Deliveroo menu file (migration 157). Mounted at /api/deliveroo.
//
//   POST /read                      { file_name, data (base64) } a Deliveroo bulk-management
//                                   file (CSV, or the same saved from Excel as .xlsx)
//                                   -> { columns, rows, problems, eol, trailing, format }
//   GET  /venues/:venueId           settings (with defaults), saved item links, the
//                                   dishes to match against, tags, the venue's menus
//   PUT  /venues/:venueId/settings  menus, price rule, filled columns, code maps
//   PUT  /venues/:venueId/links     { links: [...] } upsert the given items' links;
//                                   a link with nothing to remember is deleted.
//                                   Items not sent are left alone.
//   POST /xlsx                      { columns, rows, file_name } the reviewed file as .xlsx
//                                   (every cell text, so Excel doesn't turn ids into numbers)
//
// The CSV for Deliveroo is written in the browser (shared/deliveroo.js
// toCsv(), same line endings as the file read). Nothing about the file is
// stored: only settings and links. Reads need Menus view, saves Menus manage.

import { z }          from 'zod'
import * as XLSX      from 'xlsx'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { loadMenuVersions } from '../services/menuReleases.js'
import { ensureTaxDefaults, loadTaxRates, loadOrderTypes, saleContext } from '../services/taxSvc.js'
import { taxFor } from '../../../shared/tax.js'
import {
  parseCsv, readSheet, defaultMaps, defaultFill, FIELD_KEYS,
} from '../../../shared/deliveroo.js'

const UUID = z.string().uuid()
const MAX_FILE = 8 * 1024 * 1024 // Deliveroo's own upload limit
const MAX_ROWS = 5000

const by = req => req.user?.email ?? null
const canView   = [requirePermission('menus', 'view')]
const canManage = [requirePermission('menus', 'manage')]

const CodeList = z.array(z.string().trim().min(1).max(60)).max(20)
const SettingsBody = z.object({
  menu_ids:            z.array(UUID).max(50).default([]),
  price_uplift_pct:    z.coerce.number().min(-50).max(200).default(0),
  price_round_pence:   z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]).default(1),
  price_round_mode:    z.enum(['up', 'nearest']).default('up'),
  fill:                z.record(z.string(), z.boolean()).default({}),
  allergen_map:        z.record(z.string().max(60), CodeList).default({}),
  dietary_map:         z.record(z.string().max(60), CodeList).default({}),
  include_may_contain: z.boolean().default(true),
  include_removable:   z.boolean().default(true),
  // The sale the file's tax is for (migration 170): Delivery by default.
  order_type_id:       UUID.nullable().optional(),
  revenue_stream_id:   UUID.nullable().optional(),
})

const Cell = z.string().max(20000)
const LinkBody = z.object({
  deliveroo_item_id: z.string().trim().min(1).max(200),
  deliveroo_name:    z.string().max(300).nullable().optional(),
  menu_item_id:      UUID.nullable().optional(),
  skip:              z.boolean().default(false),
  keep:              z.array(z.enum(FIELD_KEYS)).max(FIELD_KEYS.length).default([]),
  overrides:         z.record(z.enum(FIELD_KEYS), Cell).default({}),
})
const LinksBody = z.object({ links: z.array(LinkBody).max(MAX_ROWS) })

const ReadBody = z.object({
  file_name: z.string().max(300).default(''),
  data:      z.string().min(1),
})
const XlsxBody = z.object({
  columns:   z.array(z.string().max(200)).min(1).max(200),
  rows:      z.array(z.record(z.string(), z.string().max(20000))).max(MAX_ROWS),
  file_name: z.string().max(300).default('deliveroo-menu'),
})

async function ownVenue(tx, tenantId, venueId) {
  const [v] = await tx`SELECT id, name FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

/** Text of a CSV file: UTF-8, or Windows-1252 when it isn't (Excel's "CSV" on Windows). */
function csvText(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8
  try { return new TextDecoder('windows-1252').decode(buf) } catch { return utf8 }
}

/** A file -> header + rows as text. */
export function readFile(buf, fileName = '', { from = 'Deliveroo' } = {}) {
  const isZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b
  const isOldExcel = buf.length > 3 && buf[0] === 0xd0 && buf[1] === 0xcf
  if (isZip || isOldExcel || /\.xlsx?$/i.test(fileName)) {
    let wb
    try { wb = XLSX.read(buf, { type: 'buffer', raw: false }) }
    catch { throw httpError(422, `That file couldn't be read. Use the CSV from ${from}, or save it from Excel as .xlsx or CSV.`) }
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) throw httpError(422, 'That workbook has no sheets')
    const cells = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false })
    return { cells: cells.map(r => r.map(v => String(v ?? ''))), eol: '\r\n', trailing: false, format: 'xlsx' }
  }
  return { ...parseCsv(csvText(buf)), format: 'csv' }
}

/** Settings row (or defaults) with maps filled for every tag. */
function settingsView(row, tags, orderTypes) {
  const maps = defaultMaps(tags)
  const s = row || {}
  return {
    exists:              !!row,
    menu_ids:            s.menu_ids || [],
    price_uplift_pct:    s.price_uplift_pct != null ? Number(s.price_uplift_pct) : 0,
    price_round_pence:   s.price_round_pence ?? 1,
    price_round_mode:    s.price_round_mode || 'up',
    fill:                { ...defaultFill(), ...(s.fill || {}) },
    allergen_map:        { ...maps.allergen, ...(s.allergen_map || {}) },
    dietary_map:         { ...maps.dietary, ...(s.dietary_map || {}) },
    include_may_contain: s.include_may_contain ?? true,
    include_removable:   s.include_removable ?? true,
    // No type picked yet: the one named Delivery, else none (the default rate).
    order_type_id:       s.order_type_id || orderTypes.find(t => t.is_active && /^delivery$/i.test(t.name))?.id || null,
    revenue_stream_id:   s.revenue_stream_id || null,
    updated_at:          s.updated_at || null,
    updated_by:          s.updated_by || null,
  }
}

/**
 * Dishes from the live versions of the given menus (migration 165), with
 * codes, levels, options and their VAT for the settings' order type and
 * revenue stream (shared/tax.js). A menu never published gives no dishes:
 * Deliveroo gets what guests see, not the draft.
 */
async function loadDishes(tx, tenantId, menuIds, ctx) {
  if (!menuIds.length) return []
  const rates = await loadTaxRates(tx, tenantId)
  const menus = await loadMenuVersions(tx, tenantId, { menuIds })
  menus.sort((a, b) => menuIds.indexOf(a.id) - menuIds.indexOf(b.id))
  const out = []
  for (const m of menus) {
    for (const s of m.sections || []) {
      const items = [...(s.items || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
      for (const i of items) {
        const tax = taxFor([i.tax, s.tax, m.tax], ctx, rates)
        out.push({
          id: i.id, name: i.name, native_name: i.native_name ?? null, kitchen_name: i.kitchen_name ?? null,
          description: i.description ?? null, price_pence: i.price_pence ?? null, calories: i.calories ?? null,
          kind: i.kind || 'dish', vat: tax.vat_rate, vat_name: tax.name,
          section_title: s.title, section_visibility: s.visibility || 'show',
          menu_id: m.id, menu_name: m.name,
          variants: (i.variants || []).map(v => ({ label: v.label, price_pence: v.price_pence })),
          dietary: i.dietary || [],
          allergen_levels: i.allergen_levels || {},
          variant_groups: i.variant_groups || [],
        })
      }
    }
  }
  return out
}

async function loadSetup(tx, tenantId, venueId) {
  const venue = await ownVenue(tx, tenantId, venueId)
  await ensureTaxDefaults(tx, tenantId)
  const [[row], tags, menus, links, orderTypes, streams] = await Promise.all([
    tx`SELECT * FROM deliveroo_settings WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`,
    tx`SELECT id, code, label, kind, standard_key, sort_order FROM menu_dietary_tags
        WHERE tenant_id = ${tenantId} ORDER BY kind = 'allergen' DESC, sort_order, label`,
    tx`SELECT id, name, venue_id, is_published FROM menus
        WHERE tenant_id = ${tenantId} AND (venue_id = ${venueId} OR venue_id IS NULL)
        ORDER BY sort_order, name`,
    tx`SELECT deliveroo_item_id, deliveroo_name, menu_item_id, skip, keep, overrides, updated_at, updated_by
         FROM deliveroo_item_links WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`,
    loadOrderTypes(tx, tenantId),
    tx`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active ORDER BY sort_order, name`,
  ])
  const settings = settingsView(row, tags, orderTypes)
  // Which menus have a live version, and is it shown to guests (the
  // default when none are picked follows the live setting, not the draft).
  const live = await loadMenuVersions(tx, tenantId, { menuIds: menus.map(m => m.id) })
  const liveById = new Map(live.map(m => [m.id, m]))
  for (const m of menus) {
    m.is_live = liveById.has(m.id)
    m.live_published = !!liveById.get(m.id)?.is_published
  }
  const known = new Set(menus.map(m => m.id))
  const chosen = settings.menu_ids.filter(id => known.has(id))
  // The page sends its menu list back on save: never one it can't show.
  settings.menu_ids = chosen
  const menuIds = chosen.length ? chosen : menus.filter(m => m.live_published).map(m => m.id)
  const dishes = await loadDishes(tx, tenantId, menuIds, saleContext(venueId, settings.order_type_id, settings.revenue_stream_id))
  return { venue, settings, tags, menus, menu_ids_used: menuIds, dishes, links, order_types: orderTypes, revenue_streams: streams }
}

export default async function deliverooRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/read', { preHandler: canView, bodyLimit: 12 * 1024 * 1024 }, async req => {
    const body = ReadBody.parse(req.body)
    const buf = Buffer.from(body.data, 'base64')
    if (!buf.length) throw httpError(422, 'That file is empty')
    if (buf.length > MAX_FILE) throw httpError(422, 'That file is over 8 MB, which Deliveroo won\'t take either')
    const file = readFile(buf, body.file_name)
    const { columns, rows, problems } = readSheet(file.cells)
    if (rows.length > MAX_ROWS) throw httpError(422, `That file has ${rows.length} rows; up to ${MAX_ROWS} can be read`)
    return {
      file_name: body.file_name, format: file.format, size: buf.length,
      eol: file.eol, trailing: file.trailing,
      columns, rows, problems,
    }
  })

  app.get('/venues/:venueId', { preHandler: canView }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    return withTenant(req.tenantId, tx => loadSetup(tx, req.tenantId, venueId))
  })

  app.put('/venues/:venueId/settings', { preHandler: canManage }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const b = SettingsBody.parse(req.body)
    const fill = Object.fromEntries(Object.entries(b.fill).filter(([k]) => FIELD_KEYS.includes(k)))
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      if (b.menu_ids.length) {
        const own = await tx`SELECT id FROM menus WHERE tenant_id = ${req.tenantId} AND id = ANY(${b.menu_ids}::uuid[])`
        if (own.length !== new Set(b.menu_ids).size) throw httpError(422, 'A chosen menu wasn\'t found')
      }
      if (b.order_type_id) {
        const [t] = await tx`SELECT id FROM order_types WHERE id = ${b.order_type_id} AND tenant_id = ${req.tenantId}`
        if (!t) throw httpError(422, 'Order type not found')
      }
      if (b.revenue_stream_id) {
        const [rs] = await tx`SELECT id FROM pos_revenue_streams WHERE id = ${b.revenue_stream_id} AND tenant_id = ${req.tenantId} AND venue_id = ${venueId}`
        if (!rs) throw httpError(422, 'Revenue stream not found')
      }
      await tx`
        INSERT INTO deliveroo_settings
          (venue_id, tenant_id, menu_ids, price_uplift_pct, price_round_pence, price_round_mode,
           fill, allergen_map, dietary_map, include_may_contain, include_removable, order_type_id, revenue_stream_id,
           updated_by, updated_at)
        VALUES
          (${venueId}, ${req.tenantId}, ${b.menu_ids}::uuid[], ${b.price_uplift_pct}, ${b.price_round_pence}, ${b.price_round_mode},
           ${tx.json(fill)}, ${tx.json(b.allergen_map)}, ${tx.json(b.dietary_map)}, ${b.include_may_contain}, ${b.include_removable},
           ${b.order_type_id ?? null}, ${b.revenue_stream_id ?? null},
           ${by(req)}, now())
        ON CONFLICT (venue_id) DO UPDATE SET
          menu_ids = EXCLUDED.menu_ids, price_uplift_pct = EXCLUDED.price_uplift_pct,
          price_round_pence = EXCLUDED.price_round_pence, price_round_mode = EXCLUDED.price_round_mode,
          fill = EXCLUDED.fill, allergen_map = EXCLUDED.allergen_map, dietary_map = EXCLUDED.dietary_map,
          include_may_contain = EXCLUDED.include_may_contain, include_removable = EXCLUDED.include_removable,
          order_type_id = EXCLUDED.order_type_id, revenue_stream_id = EXCLUDED.revenue_stream_id,
          updated_by = EXCLUDED.updated_by, updated_at = now()
         WHERE deliveroo_settings.tenant_id = ${req.tenantId}
      `
      return loadSetup(tx, req.tenantId, venueId)
    })
  })

  app.put('/venues/:venueId/links', { preHandler: canManage, bodyLimit: 4 * 1024 * 1024 }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const { links } = LinksBody.parse(req.body)
    const ids = links.map(l => l.deliveroo_item_id)
    if (new Set(ids).size !== ids.length) throw httpError(422, 'An item_id is in the list twice')
    return withTenant(req.tenantId, async tx => {
      await ownVenue(tx, req.tenantId, venueId)
      const dishIds = [...new Set(links.map(l => l.menu_item_id).filter(Boolean))]
      if (dishIds.length) {
        const own = await tx`
          SELECT i.id FROM menu_items i JOIN menu_sections s ON s.id = i.section_id JOIN menus m ON m.id = s.menu_id
           WHERE m.tenant_id = ${req.tenantId} AND i.id = ANY(${dishIds}::uuid[])
        `
        // A live dish already removed from the draft is still a valid match.
        const found = new Set(own.map(r => r.id))
        if (found.size !== dishIds.length) {
          for (const m of await loadMenuVersions(tx, req.tenantId)) {
            for (const s of m.sections || []) for (const i of s.items || []) found.add(i.id)
          }
        }
        if (dishIds.some(id => !found.has(id))) throw httpError(422, 'A matched dish wasn\'t found. Reload the page and try again.')
      }
      let saved = 0, cleared = 0
      for (const l of links) {
        const empty = !l.menu_item_id && !l.skip && !l.keep.length && !Object.keys(l.overrides).length
        if (empty) {
          const gone = await tx`
            DELETE FROM deliveroo_item_links
             WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId} AND deliveroo_item_id = ${l.deliveroo_item_id}
            RETURNING id
          `
          cleared += gone.length
          continue
        }
        await tx`
          INSERT INTO deliveroo_item_links
            (tenant_id, venue_id, deliveroo_item_id, deliveroo_name, menu_item_id, skip, keep, overrides, updated_by, updated_at)
          VALUES
            (${req.tenantId}, ${venueId}, ${l.deliveroo_item_id}, ${l.deliveroo_name ?? null},
             ${l.skip ? null : (l.menu_item_id ?? null)}, ${l.skip}, ${l.keep}::text[], ${tx.json(l.overrides)},
             ${by(req)}, now())
          ON CONFLICT (venue_id, deliveroo_item_id) DO UPDATE SET
            deliveroo_name = EXCLUDED.deliveroo_name, menu_item_id = EXCLUDED.menu_item_id, skip = EXCLUDED.skip,
            keep = EXCLUDED.keep, overrides = EXCLUDED.overrides, updated_by = EXCLUDED.updated_by, updated_at = now()
           WHERE deliveroo_item_links.tenant_id = ${req.tenantId}
        `
        saved++
      }
      const rows = await tx`
        SELECT deliveroo_item_id, deliveroo_name, menu_item_id, skip, keep, overrides, updated_at, updated_by
          FROM deliveroo_item_links WHERE venue_id = ${venueId} AND tenant_id = ${req.tenantId}
      `
      return { saved, cleared, links: rows }
    })
  })

  app.post('/xlsx', { preHandler: canView, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const b = XlsxBody.parse(req.body)
    const aoa = [b.columns, ...b.rows.map(r => b.columns.map(c => r[c] ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = b.columns.map(c => ({ wch: c === 'item_description' ? 60 : c === 'item_name' ? 30 : Math.max(10, Math.min(24, c.length + 2)) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Menu')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const name = (b.file_name.replace(/\.(csv|xlsx?)$/i, '').replace(/[^\w.\- ]+/g, '').trim() || 'deliveroo-menu') + '.xlsx'
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="${name}"`)
    return reply.send(buf)
  })
}
