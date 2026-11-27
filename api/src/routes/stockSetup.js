// src/routes/stockSetup.js
//
// Stock set-up and adjustments (inventory phase 4a, migration 306;
// docs/INVENTORY.md 6.2, 6.4), mounted at /api/stock by src/areas/stock.js.
// Reading is Stock View; every change here is Stock Manage.
//
//   GET    /venues/:venueId/areas         the venue's storage areas with their items in shelf order
//   POST   /venues/:venueId/areas         { name }
//   PATCH  /areas/:id                     { name }
//   PUT    /venues/:venueId/areas/order   { ids }: every area of the venue, in order (drag)
//   PUT    /areas/:id/items               { item_ids }: the area's items, in shelf order (the whole list)
//   DELETE /areas/:id                     refused (409 area_in_count) while a count being
//                                         taken has lines in it; lines of finished counts
//                                         stay, as counted outside an area
//   GET    /key-lists                     the group's key-item lists with their items
//   POST   /key-lists                     { name, item_ids }
//   PUT    /key-lists/:id                 { name, item_ids } (whole)
//   DELETE /key-lists/:id                 its counts keep the list's name
//   GET    /settings                      the group's settings and each venue's count day
//   PUT    /settings                      { second_person_approves, blind_count, refunds_return_stock } (whole;
//                                         refunds changed: every venue's open days of usage worked out again)
//   PUT    /venues/:venueId/settings      { count_weekday, count_kind, key_list_id, par_mode } (whole)
//   GET    /venues/:venueId/adjustments   the venue's adjustments (last 200); values with Costing view
//   POST   /venues/:venueId/adjustments   { item_id, qty, unit, reason, note?, adjusted_at? }:
//                                         qty signed (minus takes stock off), in a unit the
//                                         item is counted in
//   POST   /adjustments/:id/reverse       { reason? }: the same quantity the other way, once,
//                                         dated at the adjustment it reverses (adjusted_at; when
//                                         it was done is created_at), so a count since then keeps
//                                         its figure: that count already found what was there

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { entriesToBase, entriesText, COUNT_KINDS, COUNT_BACK_DAYS } from '../../../shared/stock.js'
import { loadCountItems, loadStockSettings, itemCostsAt } from '../services/stockSvc.js'
import { stockAccess, who } from './stock.js'
import { markUsageDirty } from '../services/stockUsageSvc.js'

const canView = requirePermission('stock', 'view')
const canManage = requirePermission('stock', 'manage')
const Id = z.string().uuid()
const Name = z.string().trim().min(1).max(60)
const MAX_ITEMS = 1000

export const AreaBody = z.object({ name: Name }).strict()
export const ItemsBody = z.object({ item_ids: z.array(Id).max(MAX_ITEMS) }).strict()
export const KeyListBody = z.object({ name: Name, item_ids: z.array(Id).max(MAX_ITEMS) }).strict()
export const SettingsBody = z.object({ second_person_approves: z.boolean(), blind_count: z.boolean(), refunds_return_stock: z.boolean() }).strict()
export const VenueSettingsBody = z.object({
  count_weekday: z.number().int().min(0).max(6).nullable(),
  count_kind: z.enum(Object.keys(COUNT_KINDS)),
  key_list_id: Id.nullable(),
  // How the venue's order lists read pars (phase 5): up to par, the par as it is, or null (up to par once counted).
  par_mode: z.enum(['up_to', 'order']).nullable(),
}).strict()
export const AdjustmentBody = z.object({
  item_id: Id,
  qty: z.number().min(-100000000).max(100000000).refine(n => n !== 0, 'An adjustment isn\'t zero'),
  unit: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(300),
  note: z.string().trim().max(500).nullable().optional(),
  adjusted_at: z.string().datetime({ offset: true }).optional(),
}).strict()

const dupe = err => err?.code === '23505'

/** These items are the group's (rule 4), in the order given and each once. */
async function checkItems(tx, tenantId, ids) {
  if (new Set(ids).size !== ids.length) throw httpError(422, 'An item is in the list twice', { code: 'twice' })
  if (!ids.length) return
  const got = await tx`SELECT id FROM inv_items WHERE tenant_id = ${tenantId} AND id = ANY(${ids}::uuid[])`
  if (got.length !== ids.length) throw httpError(404, 'Inventory item not found')
}

async function loadArea(tx, tenantId, id) {
  const [a] = await tx`SELECT id, venue_id, name, sort_order FROM stock_areas WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!a) throw httpError(404, 'Storage area not found')
  return a
}

async function areasOf(tx, tenantId, venueId) {
  const areas = await tx`SELECT id, name, sort_order FROM stock_areas WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} ORDER BY sort_order, lower(name)`
  const items = areas.length ? await tx`
    SELECT ai.area_id, ai.item_id, ai.sort_order, i.name, i.base_unit, i.is_active
      FROM stock_area_items ai JOIN inv_items i ON i.id = ai.item_id AND i.tenant_id = ai.tenant_id
     WHERE ai.tenant_id = ${tenantId} AND ai.area_id = ANY(${areas.map(a => a.id)}::uuid[])
     ORDER BY ai.sort_order, ai.id` : []
  return areas.map(a => ({ ...a, items: items.filter(i => i.area_id === a.id).map(({ area_id, ...i }) => i) }))
}

async function keyLists(tx, tenantId, id = null) {
  const lists = await tx`SELECT id, name, updated_at FROM stock_key_lists WHERE tenant_id = ${tenantId} ${id ? tx`AND id = ${id}` : tx``} ORDER BY lower(name)`
  const items = lists.length ? await tx`
    SELECT li.list_id, li.item_id, li.sort_order, i.name, i.base_unit, i.is_active
      FROM stock_key_list_items li JOIN inv_items i ON i.id = li.item_id AND i.tenant_id = li.tenant_id
     WHERE li.tenant_id = ${tenantId} AND li.list_id = ANY(${lists.map(l => l.id)}::uuid[])
     ORDER BY li.sort_order, li.id` : []
  return lists.map(l => ({ ...l, items: items.filter(i => i.list_id === l.id).map(({ list_id, ...i }) => i) }))
}

async function writeListItems(tx, tenantId, table, col, ownerId, ids) {
  await tx`DELETE FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND ${tx(col)} = ${ownerId}`
  if (ids.length) {
    await tx`INSERT INTO ${tx(table)} ${tx(ids.map((item_id, i) => ({ tenant_id: tenantId, [col]: ownerId, item_id, sort_order: i })), 'tenant_id', col, 'item_id', 'sort_order')}`
  }
}

export default async function stockSetupRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  // ── Storage areas ──
  app.get('/venues/:venueId/areas', { preHandler: canView }, async req =>
    withTenant(req.tenantId, tx => areasOf(tx, req.tenantId, req.params.venueId)))

  app.post('/venues/:venueId/areas', { preHandler: canManage }, async (req, reply) => {
    const b = AreaBody.parse(req.body || {})
    try {
      const row = await withTenant(req.tenantId, async tx => {
        const [{ next }] = await tx`SELECT COALESCE(max(sort_order) + 1, 0)::int AS next FROM stock_areas WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}`
        const [a] = await tx`INSERT INTO stock_areas (tenant_id, venue_id, name, sort_order) VALUES (${req.tenantId}, ${req.params.venueId}, ${b.name}, ${next})
                             RETURNING id, venue_id, name, sort_order`
        return { ...a, items: [] }
      })
      return reply.code(201).send(row)
    } catch (err) {
      if (dupe(err)) throw httpError(409, 'This venue already has an area called ' + b.name, { code: 'duplicate_name' })
      throw err
    }
  })

  app.patch('/areas/:id', { preHandler: canManage }, async req => {
    const b = AreaBody.parse(req.body || {})
    try {
      return await withTenant(req.tenantId, async tx => {
        const a = await loadArea(tx, req.tenantId, req.params.id)
        const [row] = await tx`UPDATE stock_areas SET name = ${b.name}, updated_at = now() WHERE id = ${a.id} AND tenant_id = ${req.tenantId}
                               RETURNING id, venue_id, name, sort_order`
        return row
      })
    } catch (err) {
      if (dupe(err)) throw httpError(409, 'This venue already has an area called ' + b.name, { code: 'duplicate_name' })
      throw err
    }
  })

  app.put('/venues/:venueId/areas/order', { preHandler: canManage }, async req => {
    const b = z.object({ ids: z.array(Id).max(200) }).strict().parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const have = await tx`SELECT id FROM stock_areas WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId}`
      const known = new Set(have.map(a => a.id))
      if (b.ids.length !== have.length || new Set(b.ids).size !== b.ids.length || b.ids.some(id => !known.has(id))) {
        throw httpError(422, 'Send every area of the venue once, in the new order', { code: 'order' })
      }
      for (const [i, id] of b.ids.entries()) await tx`UPDATE stock_areas SET sort_order = ${i}, updated_at = now() WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return areasOf(tx, req.tenantId, req.params.venueId)
    })
  })

  app.put('/areas/:id/items', { preHandler: canManage }, async req => {
    const b = ItemsBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const a = await loadArea(tx, req.tenantId, req.params.id)
      await checkItems(tx, req.tenantId, b.item_ids)
      await writeListItems(tx, req.tenantId, 'stock_area_items', 'area_id', a.id, b.item_ids)
      await tx`UPDATE stock_areas SET updated_at = now() WHERE id = ${a.id} AND tenant_id = ${req.tenantId}`
      return (await areasOf(tx, req.tenantId, a.venue_id)).find(x => x.id === a.id)
    })
  })

  app.delete('/areas/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const a = await loadArea(tx, req.tenantId, req.params.id)
    const [open] = await tx`
      SELECT c.id FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id AND c.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${req.tenantId} AND l.area_id = ${a.id} AND c.status IN ('draft', 'submitted') LIMIT 1`
    if (open) throw httpError(409, 'A count being taken has lines in ' + a.name + ': finish or cancel it first', { code: 'area_in_count', count_id: open.id })
    // Finished counts keep their lines, as counted outside an area: added to that line where the
    // item has one already (an item counted in two places still adds up to the same).
    await tx`
      UPDATE stock_count_lines o SET qty_base = o.qty_base + x.qty_base, entries = o.entries || x.entries, updated_at = now()
        FROM stock_count_lines x
       WHERE x.tenant_id = ${req.tenantId} AND x.area_id = ${a.id} AND o.tenant_id = x.tenant_id
         AND o.count_id = x.count_id AND o.item_id = x.item_id AND o.area_id IS NULL`
    await tx`
      DELETE FROM stock_count_lines x
       WHERE x.tenant_id = ${req.tenantId} AND x.area_id = ${a.id}
         AND EXISTS (SELECT 1 FROM stock_count_lines o WHERE o.tenant_id = x.tenant_id AND o.count_id = x.count_id AND o.item_id = x.item_id AND o.area_id IS NULL)`
    await tx`DELETE FROM stock_areas WHERE id = ${a.id} AND tenant_id = ${req.tenantId}`
    return { deleted: true }
  }))

  // ── Key-item lists ──
  app.get('/key-lists', { preHandler: canView }, async req => withTenant(req.tenantId, tx => keyLists(tx, req.tenantId)))

  app.post('/key-lists', { preHandler: canManage }, async (req, reply) => {
    const b = KeyListBody.parse(req.body || {})
    try {
      const row = await withTenant(req.tenantId, async tx => {
        await checkItems(tx, req.tenantId, b.item_ids)
        const [l] = await tx`INSERT INTO stock_key_lists (tenant_id, name) VALUES (${req.tenantId}, ${b.name}) RETURNING id`
        await writeListItems(tx, req.tenantId, 'stock_key_list_items', 'list_id', l.id, b.item_ids)
        return (await keyLists(tx, req.tenantId, l.id))[0]
      })
      return reply.code(201).send(row)
    } catch (err) {
      if (dupe(err)) throw httpError(409, 'There is already a key-item list called ' + b.name, { code: 'duplicate_name' })
      throw err
    }
  })

  app.put('/key-lists/:id', { preHandler: canManage }, async req => {
    const b = KeyListBody.parse(req.body || {})
    try {
      return await withTenant(req.tenantId, async tx => {
        const [l] = await tx`SELECT id FROM stock_key_lists WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}`
        if (!l) throw httpError(404, 'Key-item list not found')
        await checkItems(tx, req.tenantId, b.item_ids)
        await tx`UPDATE stock_key_lists SET name = ${b.name}, updated_at = now() WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
        await writeListItems(tx, req.tenantId, 'stock_key_list_items', 'list_id', l.id, b.item_ids)
        return (await keyLists(tx, req.tenantId, l.id))[0]
      })
    } catch (err) {
      if (dupe(err)) throw httpError(409, 'There is already a key-item list called ' + b.name, { code: 'duplicate_name' })
      throw err
    }
  })

  app.delete('/key-lists/:id', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const [l] = await tx`DELETE FROM stock_key_lists WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id`
    if (!l) throw httpError(404, 'Key-item list not found')
    return { deleted: true }
  }))

  // ── Settings ──
  app.get('/settings', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const settings = await loadStockSettings(tx, req.tenantId)
    const venues = await tx`
      SELECT v.id AS venue_id, v.name, s.count_weekday, COALESCE(s.count_kind, 'full') AS count_kind, s.key_list_id, s.par_mode,
             EXISTS (SELECT 1 FROM stock_counts c WHERE c.tenant_id = v.tenant_id AND c.venue_id = v.id AND c.status = 'approved') AS counted
        FROM venues v LEFT JOIN stock_venue_settings s ON s.venue_id = v.id AND s.tenant_id = v.tenant_id
       WHERE v.tenant_id = ${req.tenantId} ORDER BY lower(v.name)`
    return { ...settings, venues }
  }))

  app.put('/settings', { preHandler: canManage }, async req => {
    const b = SettingsBody.parse(req.body || {})
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      const before = await loadStockSettings(tx, req.tenantId)
      await tx`
        INSERT INTO stock_settings (tenant_id, second_person_approves, blind_count, refunds_return_stock, updated_at, updated_by)
        VALUES (${req.tenantId}, ${b.second_person_approves}, ${b.blind_count}, ${b.refunds_return_stock}, now(), ${me})
        ON CONFLICT (tenant_id) DO UPDATE SET second_person_approves = EXCLUDED.second_person_approves,
          blind_count = EXCLUDED.blind_count, refunds_return_stock = EXCLUDED.refunds_return_stock,
          updated_at = now(), updated_by = EXCLUDED.updated_by`
      // Refunds giving stock back or not changes every venue's open days of usage.
      if (before.refunds_return_stock !== b.refunds_return_stock) await markUsageDirty(tx, req.tenantId)
      return loadStockSettings(tx, req.tenantId)
    })
  })

  app.put('/venues/:venueId/settings', { preHandler: canManage }, async req => {
    const b = VenueSettingsBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      if (b.key_list_id) {
        const [l] = await tx`SELECT id FROM stock_key_lists WHERE id = ${b.key_list_id} AND tenant_id = ${req.tenantId}`
        if (!l) throw httpError(404, 'Key-item list not found')
      }
      if (b.count_kind === 'key' && !b.key_list_id) throw httpError(422, 'A key-item count day needs its list', { code: 'key_list' })
      const [row] = await tx`
        INSERT INTO stock_venue_settings (tenant_id, venue_id, count_weekday, count_kind, key_list_id, par_mode, updated_at)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${b.count_weekday}, ${b.count_kind}, ${b.key_list_id}, ${b.par_mode}, now())
        ON CONFLICT (venue_id) DO UPDATE SET count_weekday = EXCLUDED.count_weekday, count_kind = EXCLUDED.count_kind,
          key_list_id = EXCLUDED.key_list_id, par_mode = EXCLUDED.par_mode, updated_at = now()
        RETURNING venue_id, count_weekday, count_kind, key_list_id, par_mode`
      return row
    })
  })

  // ── Adjustments ──
  app.get('/venues/:venueId/adjustments', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const rows = await tx`
        SELECT a.id, a.item_id, i.name AS item_name, i.base_unit, a.qty::float8 AS qty, a.unit, a.qty_base::float8 AS qty_base,
               a.reason, a.note, a.adjusted_at, a.adjusted_by, a.reverses_id, a.created_at,
               EXISTS (SELECT 1 FROM stock_adjustments r WHERE r.reverses_id = a.id AND r.tenant_id = a.tenant_id) AS reversed
          FROM stock_adjustments a JOIN inv_items i ON i.id = a.item_id AND i.tenant_id = a.tenant_id
         WHERE a.tenant_id = ${req.tenantId} AND a.venue_id = ${req.params.venueId}
         ORDER BY a.adjusted_at DESC, a.created_at DESC LIMIT 200`
      if (!access.sees_values || !rows.length) return rows
      // Valued at what the item cost at the venue when it was adjusted (the ledger's rule).
      const out = []
      for (const r of rows) {
        const per = (await itemCostsAt(tx, req.tenantId, req.params.venueId, [r.item_id], r.adjusted_at)).get(r.item_id)
        out.push({ ...r, cost_per_base: per, value: per == null ? null : Math.round(r.qty_base * per * 100) / 100 })
      }
      return out
    })
  })

  app.post('/venues/:venueId/adjustments', { preHandler: canManage }, async (req, reply) => {
    const b = AdjustmentBody.parse(req.body || {})
    const me = await who(req)
    const at = b.adjusted_at ? new Date(b.adjusted_at) : new Date()
    if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - COUNT_BACK_DAYS * 86400_000) {
      throw httpError(422, 'An adjustment is for now or up to ' + COUNT_BACK_DAYS + ' days back', { code: 'adjusted_at' })
    }
    const row = await withTenant(req.tenantId, async tx => {
      const item = (await loadCountItems(tx, req.tenantId, [b.item_id])).get(b.item_id)
      if (!item) throw httpError(404, 'Inventory item not found')
      const r = entriesToBase([{ qty: Math.abs(b.qty), unit: b.unit }], item.count_units, item)
      if (r.problem) throw httpError(422, r.problem, { code: 'unit' })
      const sign = b.qty < 0 ? -1 : 1
      const qtyBase = sign * r.qty_base
      if (!qtyBase) throw httpError(422, 'An adjustment isn\'t zero', { code: 'qty' })
      const [a] = await tx`
        INSERT INTO stock_adjustments (tenant_id, venue_id, item_id, qty, unit, qty_base, reason, note, adjusted_at, adjusted_by)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${item.id}, ${b.qty}, ${r.entries[0].label}, ${qtyBase}, ${b.reason}, ${b.note || null}, ${at}, ${me})
        RETURNING id, item_id, qty::float8 AS qty, unit, qty_base::float8 AS qty_base, reason, note, adjusted_at, adjusted_by, reverses_id, created_at`
      return { ...a, item_name: item.name, base_unit: item.base_unit, typed: (sign < 0 ? '-' : '') + entriesText(r.entries) }
    })
    return reply.code(201).send(row)
  })

  app.post('/adjustments/:id/reverse', { preHandler: canManage }, async (req, reply) => {
    const b = z.object({ reason: z.string().trim().min(1).max(300).optional() }).strict().parse(req.body || {})
    const me = await who(req)
    const row = await withTenant(req.tenantId, async tx => {
      const [a] = await tx`SELECT id, venue_id, item_id, qty, unit, qty_base, reason, reverses_id, adjusted_at FROM stock_adjustments WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} FOR UPDATE`
      if (!a) throw httpError(404, 'Adjustment not found')
      if (a.reverses_id) throw httpError(409, 'This adjustment reverses another: adjust again instead', { code: 'is_reversal' })
      const [done] = await tx`SELECT id FROM stock_adjustments WHERE reverses_id = ${a.id} AND tenant_id = ${req.tenantId}`
      if (done) throw httpError(409, 'This adjustment is reversed already', { code: 'reversed' })
      // At the original's moment, not now: on hand starts from the last approved count, so a
      // reversal dated after a count would be added on top of what that count found (which
      // already had the mistake in it). Dated with the original, the two cancel out wherever a
      // count falls, as if neither had been made.
      const [r] = await tx`
        INSERT INTO stock_adjustments (tenant_id, venue_id, item_id, qty, unit, qty_base, reason, adjusted_at, adjusted_by, reverses_id)
        VALUES (${req.tenantId}, ${a.venue_id}, ${a.item_id}, ${-Number(a.qty)}, ${a.unit}, ${-Number(a.qty_base)},
                ${b.reason || ('Reversed: ' + a.reason).slice(0, 300)}, ${a.adjusted_at}, ${me}, ${a.id})
        RETURNING id, item_id, qty::float8 AS qty, unit, qty_base::float8 AS qty_base, reason, adjusted_at, adjusted_by, reverses_id, created_at`
      return r
    })
    return reply.code(201).send(row)
  })
}
