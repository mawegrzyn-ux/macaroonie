// src/routes/stockWaste.js
//
// Waste (inventory phase 4b, migration 308; docs/INVENTORY.md 6.3), mounted
// at /api/stock by src/areas/stock.js. A waste entry is an inventory item, a
// prep batch (a prep recipe) or a menu dish, broken into its items when it is
// logged (itemsOf() in shared/stockItems.js: a batch by its recipe, a dish by
// the recipe the variation matrix picks at the venue, revenue stream and
// order type), each item valued at the average paid at the venue then. On
// hand takes the items off (MOVE_SOURCES in services/stockSvc.js). A till void
// marked wasted is waste by itself: listed here and in the report, read from
// the till (loadWastedVoids(), which keeps what it took off the first time it
// is read: migration 310), never entered again. Generated test
// till sales are left out (decision D10).
//
// Logging is Stock use; undoing on the entry's trading day is whoever logged
// it or Stock manage; after that day a reversing entry (Stock manage), dated
// at the entry it reverses so a count since keeps its figure. On a shared
// device the person switched in logs, undoes, reverses and adds photos only
// at the device's venue (venueProblem() in routes/stock.js), as transfers
// do. Reasons are the group's (WRAP's kinds: spoilage, preparation, plate),
// set up with Stock manage.
// Values need Costing view, as everywhere in stock.
//
//   GET    /waste-reasons                     the group's reasons in order (with how many entries use each)
//   POST   /waste-reasons                     { name, kind }                                   Manage
//   PUT    /waste-reasons/order               { ids }: every reason, in the new order (drag)   Manage
//   PUT    /waste-reasons/:reasonId           { name, kind, is_active } (whole)               Manage
//   DELETE /waste-reasons/:reasonId           refused (409 reason_in_use) once an entry uses it: switch it off
//   GET    /venues/:venueId/waste/pickers     what can be wasted there: items (with their units), prep
//                                             recipes (with theirs), dishes on a menu, the venue's
//                                             revenue streams, order types, the active reasons
//   POST   /venues/:venueId/waste/preview     WasteBody: what it would take off (items, value, gaps), nothing saved
//   POST   /venues/:venueId/waste             WasteBody: logged                                Use
//                                             (phase 6b: then offered to the group's rules, waste_logged)
//   GET    /venues/:venueId/waste?day=&from=&to=
//                                             the entries of those trading days (today when none) with the
//                                             till's voids marked wasted (read only), newest first, each
//                                             with its items, gaps and what the person may do
//   GET    /venues/:venueId/waste/summary?from=&to=&days=&by=
//                                             waste added up (wasteTotals()) by reason | kind | item |
//                                             dish | person | day | what, voids included; the last
//                                             `days` trading days (7) up to `to` (today there) by default
//   POST   /waste/:wasteId/undo               on its trading day: whoever logged it, or Manage
//   POST   /waste/:wasteId/reverse            after its trading day: a reversing entry      Manage
//   POST   /waste/:wasteId/photo              multipart: a photo of it (whoever logged it, or Manage)

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { getStorage } from '../services/storageSvc.js'
import {
  entriesToBase, entriesText, wasteUndo, wasteTotals, WASTE_KIND_KEYS, WASTE_KINDS, WASTE_WHAT, COUNT_BACK_DAYS,
} from '../../../shared/stock.js'
import { itemsOf } from '../../../shared/stockItems.js'
import { recipeUnit, recipeUnitChoices, inRecipeUnit } from '../../../shared/costing.js'
import { isCombo } from '../../../shared/combos.js'
import {
  loadCountItems, loadWasteReasons, ensureWasteReasons, venueDay, wasteCtx, loadWastedVoids, itemCostsAt,
} from '../services/stockSvc.js'
import { stockAccess, stockPerson, venueProblem } from './stock.js'
import { fireRulesLater } from '../ai/ruleRunner.js'

const canView = requirePermission('stock', 'view')
const canUse = requirePermission('stock', 'use')
const canManage = requirePermission('stock', 'manage')
const Id = z.string().uuid()
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_DAYS = 93
const MAX_ROWS = 500
// A waste photo's types and the file extension each is stored under. The extension comes from
// this map only, never from the filename the client sends: /uploads/ is served on the admin's own
// origin with a type picked by the extension, so `x.html` sent as image/jpeg would be stored as a
// page that runs on the admin (stored XSS).
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }
const PHOTO_MIME = new Set(Object.keys(PHOTO_EXT))
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

/** What a photo's first bytes say it is (a type of PHOTO_EXT), or null: the part's own Content-Type is the client's word only. */
function photoType(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12)
    if (HEIF_BRANDS.has(brand)) return brand.startsWith('he') ? 'image/heic' : 'image/heif'
  }
  return null
}

export const ReasonBody = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(WASTE_KIND_KEYS),
}).strict()
export const ReasonSaveBody = ReasonBody.extend({ is_active: z.boolean() }).strict()

// A waste entry (also the plain form "Log waste", api/src/forms/stock.js): what it is (an item,
// a prep batch or a dish, by its id), how much (an item in one of its units, a batch in a
// unit of what the recipe makes, a dish in dishes), the scope a dish's recipe is picked at
// (the venue's own, a revenue stream there, an order type), the reason, a note, and the
// moment (now, or up to COUNT_BACK_DAYS back).
export const WasteBody = z.object({
  what: z.enum(['item', 'recipe', 'dish']),
  item_id: Id.nullable().optional(),
  recipe_id: Id.nullable().optional(),
  dish_id: Id.nullable().optional(),
  qty: z.number().positive().max(1000000),
  unit: z.string().trim().min(1).max(80).nullable().optional(),
  revenue_stream_id: Id.nullable().optional(),
  order_type_id: Id.nullable().optional(),
  reason_id: Id,
  note: z.string().trim().max(500).nullable().optional(),
  wasted_at: z.string().datetime({ offset: true }).optional(),
}).strict()

const r2 = n => (n == null ? null : Math.round(n * 100) / 100)
const r4 = n => Math.round(Number(n) * 10000) / 10000
const dayText = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
const addDays = (day, n) => new Date(new Date(day + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10)

function checkAt(iso) {
  const at = iso ? new Date(iso) : new Date()
  if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - COUNT_BACK_DAYS * 86400_000) {
    throw httpError(422, 'Waste is logged for now or up to ' + COUNT_BACK_DAYS + ' days back', { code: 'wasted_at' })
  }
  return at
}

/** The days asked for: ?day=, or ?from= &to= (at most MAX_DAYS), else the venue's trading day today. */
async function daysOf(tx, tenantId, venueId, q) {
  const today = await venueDay(tx, tenantId, venueId)
  if (q.day) return { from: q.day, to: q.day, today }
  const to = q.to || today
  const from = q.from || to
  if (from > to) throw httpError(422, 'The first day is after the last', { code: 'days' })
  if (new Date(to) - new Date(from) > MAX_DAYS * 86400000) throw httpError(422, 'At most ' + MAX_DAYS + ' days at a time', { code: 'days' })
  return { from, to, today }
}

/** The reason, the group's and switched on. */
async function activeReason(tx, tenantId, id) {
  await ensureWasteReasons(tx, tenantId)
  const [r] = await tx`SELECT id, name, kind, is_active FROM waste_reasons WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Waste reason not found')
  if (!r.is_active) throw httpError(422, r.name + ' is switched off: pick another reason', { code: 'reason_off' })
  return r
}

/**
 * What an entry is and what it takes off: { what, name, qty, unit, qty_base,
 * item_id, recipe_id, dish_id, revenue_stream_id, order_type_id, items, gaps,
 * recipe }. Every id is checked to be the group's (rule 4): an item through
 * loadCountItems(), a prep recipe and a dish through the cost engine's ctx
 * (the group's recipes and menus), a stream at this venue, an order type.
 */
async function planWaste(tx, tenantId, venueId, b, ctxOf) {
  const base = { what: b.what, item_id: null, recipe_id: null, dish_id: null, revenue_stream_id: null, order_type_id: null }
  if (b.what === 'item') {
    if (!b.item_id) throw httpError(422, 'Say which item was wasted', { code: 'item' })
    const item = (await loadCountItems(tx, tenantId, [b.item_id])).get(b.item_id)
    if (!item) throw httpError(404, 'Inventory item not found')
    const r = entriesToBase([{ qty: b.qty, unit: b.unit || item.default_unit }], item.count_units, item)
    if (r.problem) throw httpError(422, r.problem, { code: 'unit' })
    return {
      ...base, item_id: item.id, name: item.name, qty: r4(b.qty), unit: r.entries[0].label, qty_base: r.qty_base,
      typed: entriesText(r.entries), items: [{ item_id: item.id, qty_base: r.qty_base }], gaps: [], recipe: null,
    }
  }
  const ctx = await ctxOf()
  if (b.what === 'recipe') {
    if (!b.recipe_id) throw httpError(422, 'Say which prep batch was wasted', { code: 'recipe' })
    const rec = ctx.recipes.get(b.recipe_id)
    if (!rec) throw httpError(404, 'Recipe not found')
    if (rec.kind !== 'prep') throw httpError(422, rec.name + ' is a dish recipe: log the dish instead', { code: 'not_prep' })
    const unit = b.unit || recipeUnit(rec)
    if (!unit) throw httpError(422, rec.name + ' doesn\'t say what it makes, so a batch of it can\'t be measured', { code: 'no_yield' })
    const conv = inRecipeUnit(b.qty, unit, rec)
    if (conv.problem) throw httpError(422, conv.problem, { code: 'unit' })
    const parts = itemsOf({ recipe_id: rec.id, qty: b.qty, unit }, ctx)
    return { ...base, recipe_id: rec.id, name: rec.name, qty: r4(b.qty), unit, qty_base: r4(conv.qty), typed: r4(b.qty) + ' ' + unit, ...parts }
  }
  if (!b.dish_id) throw httpError(422, 'Say which dish was wasted', { code: 'dish' })
  const dish = ctx.dishes.get(b.dish_id)
  if (!dish) throw httpError(404, 'Dish not found on a menu')
  if ((dish.item_type || 'food') === 'service') throw httpError(422, dish.name + ' is a service: it has no stock', { code: 'service' })
  if (b.revenue_stream_id) {
    const [s] = await tx`SELECT id FROM pos_revenue_streams WHERE id = ${b.revenue_stream_id} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
    if (!s) throw httpError(404, 'Revenue stream not found at this venue')
  }
  if (b.order_type_id) {
    const [t] = await tx`SELECT id FROM order_types WHERE id = ${b.order_type_id} AND tenant_id = ${tenantId}`
    if (!t) throw httpError(404, 'Order type not found')
  }
  const scope = { venue_id: venueId, revenue_stream_id: b.revenue_stream_id || null, order_type_id: b.order_type_id || null }
  const parts = itemsOf({ dish_id: dish.id, qty: b.qty, scope }, ctx)
  return {
    ...base, dish_id: dish.id, revenue_stream_id: scope.revenue_stream_id, order_type_id: scope.order_type_id,
    name: dish.name, qty: r4(b.qty), unit: 'each', qty_base: r4(b.qty), typed: r4(b.qty) + ' x ' + dish.name, ...parts,
  }
}

/** Item names and units for what an entry takes off, with each item's cost then and the value. */
async function pricedItems(tx, tenantId, venueId, items, at) {
  const ids = [...new Set(items.map(i => i.item_id))]
  const [info, costs] = await Promise.all([
    ids.length ? tx`SELECT id, name, base_unit FROM inv_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])` : [],
    itemCostsAt(tx, tenantId, venueId, ids, at),
  ])
  const of = new Map(info.map(i => [i.id, i]))
  const list = items.filter(i => of.has(i.item_id)).map(i => {
    const per = costs.get(i.item_id) ?? null
    return { item_id: i.item_id, name: of.get(i.item_id).name, base_unit: of.get(i.item_id).base_unit, qty_base: i.qty_base, cost_per_base: per, value: per == null ? null : r2(i.qty_base * per) }
  })
  const valued = list.filter(i => i.value != null)
  return { items: list, value: valued.length ? r2(valued.reduce((s, i) => s + i.qty_base * i.cost_per_base, 0)) : null, unvalued: list.length - valued.length }
}

// An entry's columns; its trading day as text (a date column arrives as a Date: rule 9).
const COLS = ['id', 'venue_id', 'wasted_at', 'day', 'what', 'item_id', 'recipe_id', 'dish_id', 'revenue_stream_id', 'order_type_id', 'name', 'qty', 'unit', 'qty_base', 'reason_id', 'reason', 'reason_kind', 'value', 'gaps', 'note', 'photo_url', 'wasted_by', 'undone_at', 'undone_by', 'reverses_id', 'created_at']
const colsOf = (t = '') => COLS.map(c => (c === 'day' ? t + 'day::text AS day' : t + c)).join(', ')
const ENTRY_COLS = colsOf()

async function loadEntry(tx, tenantId, id, lock = false) {
  const rows = lock
    ? await tx`SELECT ${tx.unsafe(ENTRY_COLS)} FROM stock_waste WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT ${tx.unsafe(ENTRY_COLS)} FROM stock_waste WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!rows[0]) throw httpError(404, 'Waste entry not found')
  const [rev] = await tx`SELECT id FROM stock_waste WHERE reverses_id = ${id} AND tenant_id = ${tenantId}`
  return { ...rows[0], reversed: !!rev }
}

/** Logged entries of a venue's days with their items (the newest MAX_ROWS for a list; all of them for a summary). */
async function loggedEntries(tx, tenantId, venueId, { from, to }, limit = MAX_ROWS) {
  const rows = await tx`
    SELECT ${tx.unsafe(colsOf('w.'))},
           EXISTS (SELECT 1 FROM stock_waste r WHERE r.reverses_id = w.id AND r.tenant_id = w.tenant_id) AS reversed
      FROM stock_waste w
     WHERE w.tenant_id = ${tenantId} AND w.venue_id = ${venueId} AND w.day BETWEEN ${from}::date AND ${to}::date
     ORDER BY w.wasted_at DESC, w.created_at DESC ${limit ? tx`LIMIT ${limit}` : tx``}`
  const items = rows.length ? await tx`
    SELECT wi.waste_id, wi.item_id, i.name, i.base_unit, wi.qty_base::float8 AS qty_base, wi.cost_per_base::float8 AS cost_per_base
      FROM stock_waste_items wi JOIN inv_items i ON i.id = wi.item_id AND i.tenant_id = wi.tenant_id
     WHERE wi.tenant_id = ${tenantId} AND wi.waste_id = ANY(${rows.map(r => r.id)}::uuid[])
     ORDER BY lower(i.name)` : []
  return rows.map(r => ({
    ...r,
    items: items.filter(i => i.waste_id === r.id).map(({ waste_id, ...i }) => ({ ...i, value: i.cost_per_base == null ? null : r2(i.qty_base * i.cost_per_base) })),
  }))
}

/** This person's levels at a venue: Use and Manage only where they may act (a shared device's own venue). */
function accessAt(access, req, venueId) {
  const why = venueProblem(req, venueId)
  return why ? { ...access, can_count: false, can_manage: false, venue_problem: why } : { ...access, venue_problem: null }
}

/** 403 when a shared device's person acts at another venue than the device's. */
function mustBeAt(req, venueId) {
  const why = venueProblem(req, venueId)
  if (why) throw httpError(403, why, { code: 'venue' })
}

/** A logged entry as the page and Pepper read it: values only with Costing view, what this person may do. */
function entryView(e, { access, ids, today }) {
  const may = wasteUndo(e, { today, me: ids, canUse: access.can_count, canManage: access.can_manage })
  const values = access.sees_values
  return {
    id: e.id, kind: 'logged', venue_id: e.venue_id, at: e.wasted_at, day: dayText(e.day), what: e.what, what_label: WASTE_WHAT[e.what],
    item_id: e.item_id, recipe_id: e.recipe_id, dish_id: e.dish_id, revenue_stream_id: e.revenue_stream_id, order_type_id: e.order_type_id,
    name: e.name, qty: Number(e.qty), unit: e.unit, qty_base: Number(e.qty_base),
    reason_id: e.reason_id, reason: e.reason, reason_kind: e.reason_kind, kind_label: WASTE_KINDS[e.reason_kind]?.label,
    gaps: e.gaps || [], note: e.note, photo_url: e.photo_url, by: e.wasted_by,
    undone_at: e.undone_at, undone_by: e.undone_by, reverses_id: e.reverses_id, reversed: !!e.reversed,
    items: (e.items || []).map(i => ({ item_id: i.item_id, name: i.name, base_unit: i.base_unit, qty_base: Number(i.qty_base), ...(values ? { value: i.value ?? null } : {}) })),
    // The value covers the items with a price paid; `unvalued` says how many had none yet (it is partial then).
    ...(values ? { value: e.value == null ? null : r2(Number(e.value)), unvalued: (e.items || []).filter(i => i.cost_per_base == null).length } : {}),
    can_undo: may.undo, can_reverse: may.reverse, why_not: may.undo || may.reverse ? null : may.why,
  }
}

/** A till void marked wasted, read only, valued at the average paid then (kept with its items: loadWastedVoids()). */
function voidView(v, { access, names }) {
  const values = access.sees_values
  const items = v.items.map(i => {
    const per = values ? i.cost_per_base ?? null : null
    const n = names.get(i.item_id)
    return { item_id: i.item_id, name: n?.name || 'An item', base_unit: n?.base_unit || null, qty_base: i.qty_base, ...(values ? { value: per == null ? null : r2(i.qty_base * per) } : {}) }
  }).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))  // by name, as a logged entry's are
  const valued = items.filter(i => i.value != null)
  return {
    id: v.id, kind: 'till_void', venue_id: v.venue_id, at: v.at, day: v.day, what: 'dish', what_label: 'Till void',
    dish_id: v.dish_id, name: v.name, qty: v.qty, unit: 'each', check_id: v.check_id, check_number: v.check_number,
    reason_id: v.reason_id, reason: v.reason, reason_kind: v.reason_kind, kind_label: WASTE_KINDS[v.reason_kind]?.label,
    gaps: v.gaps, by: v.by, read_only: true, items,
    ...(values ? { value: valued.length ? r2(valued.reduce((s, i) => s + i.value, 0)) : null, unvalued: items.length - valued.length } : {}),
    can_undo: false, can_reverse: false, why_not: 'Voided on the till: it is waste by itself, and the till keeps its record',
  }
}

/** The logged entries (not undone) and the till's voids of some days, as rows wasteTotals() and the page read. */
async function wasteRows(tx, tenantId, venueId, days, limit = MAX_ROWS) {
  const [logged, voids] = await Promise.all([
    loggedEntries(tx, tenantId, venueId, days, limit),
    loadWastedVoids(tx, tenantId, { venueIds: [venueId], days }),
  ])
  const ids = [...new Set(voids.flatMap(v => v.items.map(i => i.item_id)))]
  const names = ids.length ? await tx`SELECT id, name, base_unit FROM inv_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])` : []
  return { logged, voids, names: new Map(names.map(n => [n.id, n])) }
}

export default async function stockWasteRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  // ── Reasons ──
  app.get('/waste-reasons', { preHandler: canView }, async req => withTenant(req.tenantId, tx => loadWasteReasons(tx, req.tenantId)))

  app.post('/waste-reasons', { preHandler: canManage }, async (req, reply) => {
    const b = ReasonBody.parse(req.body || {})
    try {
      const row = await withTenant(req.tenantId, async tx => {
        await ensureWasteReasons(tx, req.tenantId)
        const [{ next }] = await tx`SELECT COALESCE(max(sort_order) + 1, 0)::int AS next FROM waste_reasons WHERE tenant_id = ${req.tenantId}`
        const [r] = await tx`INSERT INTO waste_reasons (tenant_id, name, kind, sort_order) VALUES (${req.tenantId}, ${b.name}, ${b.kind}, ${next})
                             RETURNING id, name, kind, sort_order, is_active`
        return { ...r, used: 0 }
      })
      return reply.code(201).send(row)
    } catch (err) {
      if (err?.code === '23505') throw httpError(409, 'There is already a reason called ' + b.name, { code: 'duplicate_name' })
      throw err
    }
  })

  app.put('/waste-reasons/order', { preHandler: canManage }, async req => {
    const b = z.object({ ids: z.array(Id).max(200) }).strict().parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const have = await tx`SELECT id FROM waste_reasons WHERE tenant_id = ${req.tenantId}`
      const known = new Set(have.map(r => r.id))
      if (b.ids.length !== have.length || new Set(b.ids).size !== b.ids.length || b.ids.some(id => !known.has(id))) {
        throw httpError(422, 'Send every reason once, in the new order', { code: 'order' })
      }
      for (const [i, id] of b.ids.entries()) await tx`UPDATE waste_reasons SET sort_order = ${i}, updated_at = now() WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return loadWasteReasons(tx, req.tenantId)
    })
  })

  app.put('/waste-reasons/:reasonId', { preHandler: canManage }, async req => {
    const b = ReasonSaveBody.parse(req.body || {})
    try {
      return await withTenant(req.tenantId, async tx => {
        const [r] = await tx`UPDATE waste_reasons SET name = ${b.name}, kind = ${b.kind}, is_active = ${b.is_active}, updated_at = now()
                              WHERE id = ${req.params.reasonId} AND tenant_id = ${req.tenantId}
                              RETURNING id, name, kind, sort_order, is_active`
        if (!r) throw httpError(404, 'Waste reason not found')
        return r
      })
    } catch (err) {
      if (err?.code === '23505') throw httpError(409, 'There is already a reason called ' + b.name, { code: 'duplicate_name' })
      throw err
    }
  })

  app.delete('/waste-reasons/:reasonId', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const [r] = await tx`SELECT id, name FROM waste_reasons WHERE id = ${req.params.reasonId} AND tenant_id = ${req.tenantId}`
    if (!r) throw httpError(404, 'Waste reason not found')
    const [used] = await tx`SELECT 1 FROM stock_waste WHERE reason_id = ${r.id} AND tenant_id = ${req.tenantId} LIMIT 1`
    if (used) throw httpError(409, r.name + ' is on waste already logged: switch it off instead', { code: 'reason_in_use' })
    await tx`DELETE FROM waste_reasons WHERE id = ${r.id} AND tenant_id = ${req.tenantId}`
    return { deleted: true }
  }))

  // ── What can be wasted at a venue ──
  app.get('/venues/:venueId/waste/pickers', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const venueId = req.params.venueId
    const [ctx, active, streams, types, reasons] = await Promise.all([
      wasteCtx(tx, req.tenantId),
      tx`SELECT id FROM inv_items WHERE tenant_id = ${req.tenantId} AND is_active ORDER BY lower(name)`,
      tx`SELECT id, name FROM pos_revenue_streams WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND is_active ORDER BY sort_order, name`,
      tx`SELECT id, name FROM order_types WHERE tenant_id = ${req.tenantId} AND is_active ORDER BY sort_order, name`,
      loadWasteReasons(tx, req.tenantId),
    ])
    const items = await loadCountItems(tx, req.tenantId, active.map(i => i.id))
    const seen = new Set()
    const dishes = []
    for (const d of ctx.dishes.values()) {
      if (seen.has(d.id) || (d.item_type || 'food') === 'service') continue
      seen.add(d.id)
      dishes.push({ id: d.id, name: d.name, menu: d.menu, section: d.section, deal: isCombo(d) })
    }
    dishes.sort((a, b) => a.name.localeCompare(b.name) || String(a.menu).localeCompare(String(b.menu)))
    const recipes = [...ctx.recipes.values()].filter(r => r.kind === 'prep' && r.is_active !== false)
      .map(r => ({ id: r.id, name: r.name, unit: recipeUnit(r), units: recipeUnitChoices(r), status: r.status }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return {
      items: [...items.values()].map(i => ({ id: i.id, name: i.name, code: i.code, base_unit: i.base_unit, units: i.count_units, default_unit: i.default_unit, barcode: i.barcode, quote_barcodes: i.quote_barcodes })),
      recipes, dishes, streams, order_types: types,
      reasons: reasons.filter(r => r.is_active).map(({ used, ...r }) => r),
      today: await venueDay(tx, req.tenantId, venueId),
    }
  }))

  // ── Logging ──
  app.post('/venues/:venueId/waste/preview', { preHandler: canUse }, async req => {
    const b = WasteBody.parse(req.body || {})
    const access = await stockAccess(req)
    const at = checkAt(b.wasted_at)
    return withTenant(req.tenantId, async tx => {
      const reason = await activeReason(tx, req.tenantId, b.reason_id)
      let ctx = null
      const p = await planWaste(tx, req.tenantId, req.params.venueId, b, async () => (ctx ||= await wasteCtx(tx, req.tenantId)))
      const priced = await pricedItems(tx, req.tenantId, req.params.venueId, p.items, at)
      return {
        what: p.what, name: p.name, typed: p.typed, qty: p.qty, unit: p.unit, reason: reason.name, reason_kind: reason.kind,
        recipe: p.recipe, gaps: p.gaps, day: await venueDay(tx, req.tenantId, req.params.venueId, at),
        items: priced.items.map(({ cost_per_base, value, ...i }) => (access.sees_values ? { ...i, value } : i)),
        ...(access.sees_values ? { value: priced.value, unvalued: priced.unvalued } : {}),
      }
    })
  })

  app.post('/venues/:venueId/waste', { preHandler: canUse }, async (req, reply) => {
    const b = WasteBody.parse(req.body || {})
    const access = await stockAccess(req)
    const { by, ids } = await stockPerson(req)
    const at = checkAt(b.wasted_at)
    mustBeAt(req, req.params.venueId)
    let event = null
    const row = await withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const reason = await activeReason(tx, req.tenantId, b.reason_id)
      let ctx = null
      const p = await planWaste(tx, req.tenantId, venueId, b, async () => (ctx ||= await wasteCtx(tx, req.tenantId)))
      const day = await venueDay(tx, req.tenantId, venueId, at)
      const priced = await pricedItems(tx, req.tenantId, venueId, p.items, at)
      const [w] = await tx`
        INSERT INTO stock_waste (tenant_id, venue_id, wasted_at, day, what, item_id, recipe_id, dish_id, revenue_stream_id, order_type_id,
                                 name, qty, unit, qty_base, reason_id, reason, reason_kind, value, gaps, note, wasted_by)
        VALUES (${req.tenantId}, ${venueId}, ${at}, ${day}, ${p.what}, ${p.item_id}, ${p.recipe_id}, ${p.dish_id}, ${p.revenue_stream_id}, ${p.order_type_id},
                ${p.name.slice(0, 200)}, ${p.qty}, ${String(p.unit).slice(0, 80)}, ${p.qty_base}, ${reason.id}, ${reason.name}, ${reason.kind},
                ${priced.value}, ${tx.json(p.gaps)}, ${b.note || null}, ${by})
        RETURNING ${tx.unsafe(ENTRY_COLS)}`
      if (priced.items.length) {
        await tx`INSERT INTO stock_waste_items ${tx(priced.items.map(i => ({
          tenant_id: req.tenantId, waste_id: w.id, item_id: i.item_id, qty_base: i.qty_base, cost_per_base: i.cost_per_base,
        })), 'tenant_id', 'waste_id', 'item_id', 'qty_base', 'cost_per_base')}`
      }
      const today = await venueDay(tx, req.tenantId, venueId)
      const [v] = await tx`SELECT name FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}`
      // Phase 6b: the group's rules on waste logged (waste_logged), once the entry is saved; never waited for.
      event = {
        trigger: 'waste_logged', key: w.id, day: dayText(w.day), venue_id: venueId, venue: v?.name || '',
        what: w.name, quantity: entriesText([{ qty: Number(w.qty), unit: w.unit }]) || (w.qty + ' ' + w.unit), reason: w.reason,
        value: w.value == null ? '' : Number(w.value).toFixed(2), value_num: w.value == null ? null : Number(w.value), by,
      }
      return entryView({ ...w, items: priced.items, reversed: false }, { access, ids, today })
    })
    if (event) fireRulesLater(app, req.tenantId, event, req.log)
    return reply.code(201).send(row)
  })

  app.get('/venues/:venueId/waste', { preHandler: canView }, async req => {
    const q = z.object({ day: Day.optional(), from: Day.optional(), to: Day.optional() }).parse(req.query || {})
    const access = accessAt(await stockAccess(req), req, req.params.venueId)
    const { ids } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const days = await daysOf(tx, req.tenantId, venueId, q)
      const { logged, voids, names } = await wasteRows(tx, req.tenantId, venueId, days)
      const entries = [
        ...logged.map(e => entryView(e, { access, ids, today: days.today })),
        ...voids.map(v => voidView(v, { access, names })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at))
      const counted = entries.filter(e => !e.undone_at)
      return {
        from: days.from, to: days.to, today: days.today, sees_values: access.sees_values,
        can_log: access.can_count, can_manage: access.can_manage, venue_problem: access.venue_problem,
        entries,
        by_kind: wasteTotals(counted, 'kind').map(({ value, ...t }) => (access.sees_values ? { ...t, value } : t)),
        ...(access.sees_values ? { value: r2(counted.reduce((s, e) => s + (e.value || 0), 0)) } : {}),
      }
    })
  })

  app.get('/venues/:venueId/waste/summary', { preHandler: canView }, async req => {
    const q = z.object({
      from: Day.optional(), to: Day.optional(),
      // Or the last `days` trading days up to `to` (today at the venue when left out).
      days: z.coerce.number().int().min(1).max(MAX_DAYS).optional(),
      by: z.enum(['reason', 'kind', 'item', 'dish', 'person', 'day', 'what']).default('reason'),
    }).parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const today = await venueDay(tx, req.tenantId, venueId)
      const to = q.to || today
      const days = await daysOf(tx, req.tenantId, venueId, { from: q.from || addDays(to, -((q.days || 7) - 1)), to })
      const { logged, voids, names } = await wasteRows(tx, req.tenantId, venueId, days, null)
      const rows = [
        ...logged.filter(e => !e.undone_at).map(e => ({ ...e, by: e.wasted_by, day: dayText(e.day), value: e.value == null ? null : Number(e.value), qty: Number(e.qty) })),
        ...voids.map(v => ({ ...voidView(v, { access, names }), by: v.by })),
      ]
      const flat = q.by === 'item'
        ? rows.flatMap(r => (r.items || []).map(i => ({ item_id: i.item_id, item_name: i.name, base_unit: i.base_unit, qty_base: Number(i.qty_base), value: i.value ?? null, reverses: !!r.reverses_id })))
        : rows
      const totals = wasteTotals(flat, q.by).map(({ value, ...t }) => (access.sees_values ? { ...t, value } : t))
      return {
        from: days.from, to: days.to, by: q.by, sees_values: access.sees_values, rows: totals,
        // A reversing entry takes back the entry it reverses (wasteTotals()'s rule).
        entries: Math.max(0, rows.reduce((n, r) => n + (r.reverses_id ? -1 : 1), 0)), till_voids: voids.length,
        ...(access.sees_values ? { value: r2(rows.reduce((s, r) => s + (r.value || 0), 0)) } : {}),
      }
    })
  })

  // ── Putting it right ──
  app.post('/waste/:wasteId/undo', { preHandler: canUse }, async req => {
    const access = await stockAccess(req)
    const { by, ids } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const e = await loadEntry(tx, req.tenantId, req.params.wasteId, true)
      mustBeAt(req, e.venue_id)
      const today = await venueDay(tx, req.tenantId, e.venue_id)
      const may = wasteUndo(e, { today, me: ids, canUse: access.can_count, canManage: access.can_manage })
      if (!may.undo) throw httpError(may.reverse ? 409 : 403, may.reverse ? 'Its trading day is over: reverse it instead' : may.why, { code: may.reverse ? 'day_over' : 'undo' })
      const [row] = await tx`UPDATE stock_waste SET undone_at = now(), undone_by = ${by} WHERE id = ${e.id} AND tenant_id = ${req.tenantId}
                              RETURNING ${tx.unsafe(ENTRY_COLS)}`
      return entryView({ ...row, items: [], reversed: false }, { access, ids, today })
    })
  })

  app.post('/waste/:wasteId/reverse', { preHandler: canManage }, async (req, reply) => {
    const access = await stockAccess(req)
    const { by, ids } = await stockPerson(req)
    const row = await withTenant(req.tenantId, async tx => {
      const e = await loadEntry(tx, req.tenantId, req.params.wasteId, true)
      mustBeAt(req, e.venue_id)
      const today = await venueDay(tx, req.tenantId, e.venue_id)
      const may = wasteUndo(e, { today, me: ids, canUse: access.can_count, canManage: access.can_manage })
      if (!may.reverse) throw httpError(409, may.undo ? 'It is still its trading day: undo it instead' : may.why, { code: may.undo ? 'undo_instead' : 'reverse' })
      // Dated with the entry it reverses (its moment and its trading day), as an adjustment's
      // reversal is: on hand starts from the last approved count, so a reversal dated now would be
      // added on top of a count since, which already found the stock without the waste in it.
      const [r] = await tx`
        INSERT INTO stock_waste (tenant_id, venue_id, wasted_at, day, what, item_id, recipe_id, dish_id, revenue_stream_id, order_type_id,
                                 name, qty, unit, qty_base, reason_id, reason, reason_kind, value, gaps, note, wasted_by, reverses_id)
        VALUES (${req.tenantId}, ${e.venue_id}, ${e.wasted_at}, ${e.day}, ${e.what}, ${e.item_id}, ${e.recipe_id}, ${e.dish_id}, ${e.revenue_stream_id}, ${e.order_type_id},
                ${e.name}, ${-Number(e.qty)}, ${e.unit}, ${-Number(e.qty_base)}, ${e.reason_id}, ${e.reason}, ${e.reason_kind},
                ${e.value == null ? null : -Number(e.value)}, ${tx.json(e.gaps || [])}, ${'Reverses the entry logged ' + new Date(e.created_at).toISOString().slice(0, 16).replace('T', ' ')}, ${by}, ${e.id})
        RETURNING ${tx.unsafe(ENTRY_COLS)}`
      await tx`
        INSERT INTO stock_waste_items (tenant_id, waste_id, item_id, qty_base, cost_per_base)
        SELECT tenant_id, ${r.id}, item_id, -qty_base, cost_per_base FROM stock_waste_items WHERE waste_id = ${e.id} AND tenant_id = ${req.tenantId}`
      const [mine] = await loggedEntries(tx, req.tenantId, e.venue_id, { from: dayText(r.day), to: dayText(r.day) }).then(list => list.filter(x => x.id === r.id))
      return entryView(mine || { ...r, items: [], reversed: false }, { access, ids, today })
    })
    return reply.code(201).send(row)
  })

  app.post('/waste/:wasteId/photo', { preHandler: canUse }, async req => {
    const access = await stockAccess(req)
    const { ids } = await stockPerson(req)
    const e = await withTenant(req.tenantId, tx => loadEntry(tx, req.tenantId, req.params.wasteId))
    mustBeAt(req, e.venue_id)
    const own = !!e.wasted_by && ids.some(i => String(i).toLowerCase() === String(e.wasted_by).toLowerCase())
    if (!own && !access.can_manage) throw httpError(403, 'Only whoever logged it, or someone with Stock manage, can add its photo')
    if (e.undone_at) throw httpError(409, 'This entry was undone', { code: 'undone' })
    const data = await req.file()
    if (!data) throw httpError(400, 'No file uploaded')
    if (!PHOTO_MIME.has(data.mimetype)) throw httpError(415, 'Unsupported file type: a JPEG, PNG, WebP or HEIC photo')
    const buffer = await data.toBuffer()
    // Stored as what its bytes are, under that type's own extension (PHOTO_EXT), never the filename's.
    const type = photoType(buffer)
    if (!type) throw httpError(415, 'That file isn\'t a JPEG, PNG, WebP or HEIC photo', { code: 'not_a_photo' })
    if (e.photo_url) await getStorage().delete(e.photo_url).catch(() => null)
    const { url } = await getStorage().put(req.tenantId, 'waste', PHOTO_EXT[type], type, buffer)
    await withTenant(req.tenantId, tx => tx`UPDATE stock_waste SET photo_url = ${url} WHERE id = ${e.id} AND tenant_id = ${req.tenantId}`)
    return { photo_url: url }
  })
}
