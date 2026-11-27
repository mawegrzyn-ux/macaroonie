// src/routes/stockTransfers.js
//
// Transfers between venues of the group (inventory phase 4b, migration 309;
// docs/INVENTORY.md 6.4), mounted at /api/stock by src/areas/stock.js. Two
// steps: sent (Stock use at the sender; it leaves the sender), received
// (Stock use at the receiver; the quantities can differ, and what didn't
// arrive stays on the transfer as lost in transit). A sent transfer can be
// cancelled (Stock use at the sender, or Manage): the stock comes back to the
// sender. Valued at the sender's average cost when it was sent (each line's
// cost_per_base), shown with Costing view. On hand at both venues reads each
// line's moves (transferLineMoves() in shared/stock.js, MOVE_SOURCES in
// services/stockSvc.js).
//
// Both venues are the group's (the URL's by requireOwnVenue(), the body's by
// refuseOtherTenantsVenues and the route's own check), and on a shared device
// a person acts only at the device's venue (venueProblem() in routes/stock.js):
// sending there, or receiving there.
//
//   GET  /venues/:venueId/transfers        the venue's transfers, out and in: in transit
//                                          first, then the latest 50
//   GET  /transfers/:transferId            one transfer with its lines (each item's units)
//   POST /venues/:venueId/transfers        TransferBody: sent from this venue
//   POST /transfers/:transferId/receive    ReceiveBody: every line's quantity that arrived
//   POST /transfers/:transferId/cancel     a sent one, back to the sender

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { entriesToBase, entriesText, lostInTransit, TRANSFER_STATUSES, COUNT_BACK_DAYS } from '../../../shared/stock.js'
import { loadCountItems, itemCostsAt } from '../services/stockSvc.js'
import { stockAccess, stockPerson, venueProblem } from './stock.js'

const canView = requirePermission('stock', 'view')
const canUse = requirePermission('stock', 'use')
const Id = z.string().uuid()
const Qty = z.number().positive().max(100000000)
const Unit = z.string().trim().min(1).max(80)
const Note = z.string().trim().max(500).nullable().optional()
const MAX_LINES = 200
const LIST = 50

const TransferLine = z.object({ item_id: Id, qty: Qty, unit: Unit.optional() }).strict()
// A transfer from the URL's venue to another of the group's: its lines, or one item (item_id,
// qty, unit: the plain form "Send stock", api/src/forms/stock.js), a note, and the moment it
// was sent (now, or up to COUNT_BACK_DAYS back).
export const TransferBody = z.object({
  to_venue_id: Id,
  lines: z.array(TransferLine).min(1).max(MAX_LINES).optional(),
  item_id: Id.optional(),
  qty: Qty.optional(),
  unit: Unit.optional(),
  note: Note,
  sent_at: z.string().datetime({ offset: true }).optional(),
}).strict()
// What arrived: every line of the transfer once, its quantity in one of the item's units (0: none came).
export const ReceiveBody = z.object({
  lines: z.array(z.object({ line_id: Id, qty: z.number().min(0).max(100000000), unit: Unit.optional() }).strict()).min(1).max(MAX_LINES),
  note: Note,
}).strict()

const r2 = n => (n == null ? null : Math.round(n * 100) / 100)
const r4 = n => Math.round(Number(n) * 10000) / 10000
const T_COLS = 'id, number, from_venue_id, to_venue_id, status, note, sent_at, sent_by, received_at, received_by, receive_note, cancelled_at, cancelled_by, created_at'

/** One unit's quantity in the item's base unit, its size from the item's own choices (422 when it doesn't fit). */
function inBase(item, qty, unit) {
  const r = entriesToBase([{ qty, unit: unit || item.default_unit }], item.count_units, item)
  if (r.problem) throw httpError(422, r.problem, { code: 'unit' })
  return { qty_base: r.qty_base ?? 0, label: r.entries[0]?.label || unit || item.base_unit, typed: entriesText(r.entries) }
}

async function loadTransfer(tx, tenantId, id, lock = false) {
  const rows = lock
    ? await tx`SELECT ${tx.unsafe(T_COLS)} FROM stock_transfers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT ${tx.unsafe(T_COLS)} FROM stock_transfers WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!rows[0]) throw httpError(404, 'Transfer not found')
  return rows[0]
}

/** Transfers with their venues' names and their lines (item names, units). */
async function withLines(tx, tenantId, transfers) {
  if (!transfers.length) return []
  const tids = transfers.map(t => t.id)
  const [lines, venues] = await Promise.all([
    tx`SELECT l.id, l.transfer_id, l.item_id, i.name, i.base_unit, l.sort_order, l.qty::float8 AS qty, l.unit, l.qty_base::float8 AS qty_base,
              l.received_qty::float8 AS received_qty, l.received_unit, l.received_base::float8 AS received_base, l.cost_per_base::float8 AS cost_per_base
         FROM stock_transfer_lines l JOIN inv_items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId} AND l.transfer_id = ANY(${tids}::uuid[])
        ORDER BY l.sort_order, lower(i.name)`,
    tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId}`,
  ])
  const name = new Map(venues.map(v => [v.id, v.name]))
  return transfers.map(t => ({ ...t, from_name: name.get(t.from_venue_id), to_name: name.get(t.to_venue_id), lines: lines.filter(l => l.transfer_id === t.id) }))
}

/** A transfer as the page and Pepper read it: values only with Costing view, what this person may do. */
function transferView(t, req, access, units = null) {
  const values = access.sees_values
  const v = (q, per) => (per == null || q == null ? null : r2(q * per))
  const lines = t.lines.map(l => {
    const lost = lostInTransit(l.qty_base, l.received_base)
    return {
      id: l.id, item_id: l.item_id, name: l.name, base_unit: l.base_unit, qty: l.qty, unit: l.unit, qty_base: l.qty_base,
      received_qty: l.received_qty, received_unit: l.received_unit, received_base: l.received_base,
      lost_base: t.status === 'received' ? lost : null,
      ...(units ? { units: units.get(l.item_id)?.count_units || [], default_unit: units.get(l.item_id)?.default_unit || l.base_unit } : {}),
      ...(values ? { cost_per_base: l.cost_per_base, value: v(l.qty_base, l.cost_per_base), lost_value: t.status === 'received' ? v(lost, l.cost_per_base) : null } : {}),
    }
  })
  const sum = k => (lines.some(l => l[k] != null) ? r2(lines.reduce((s, l) => s + (l[k] || 0), 0)) : null)
  const open = t.status === 'sent'
  const atSender = !venueProblem(req, t.from_venue_id)
  const atReceiver = !venueProblem(req, t.to_venue_id)
  return {
    id: t.id, number: t.number, label: 'Transfer ' + t.number, status: t.status, status_label: TRANSFER_STATUSES[t.status],
    from_venue_id: t.from_venue_id, from_name: t.from_name, to_venue_id: t.to_venue_id, to_name: t.to_name,
    note: t.note, sent_at: t.sent_at, sent_by: t.sent_by, received_at: t.received_at, received_by: t.received_by,
    receive_note: t.receive_note, cancelled_at: t.cancelled_at, cancelled_by: t.cancelled_by,
    lines, lost: t.status === 'received' && lines.some(l => l.lost_base > 0),
    ...(values ? { value: sum('value'), lost_value: t.status === 'received' ? sum('lost_value') : null } : {}),
    can_receive: open && access.can_count && atReceiver,
    can_cancel: open && access.can_count && atSender,
  }
}

export default async function stockTransferRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId/transfers', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const rows = await tx`
        (SELECT ${tx.unsafe(T_COLS)} FROM stock_transfers
          WHERE tenant_id = ${req.tenantId} AND status = 'sent' AND (from_venue_id = ${venueId} OR to_venue_id = ${venueId}))
        UNION
        (SELECT ${tx.unsafe(T_COLS)} FROM stock_transfers
          WHERE tenant_id = ${req.tenantId} AND (from_venue_id = ${venueId} OR to_venue_id = ${venueId})
          ORDER BY sent_at DESC LIMIT ${LIST})`
      const list = (await withLines(tx, req.tenantId, rows)).map(t => ({ ...transferView(t, req, access), direction: t.from_venue_id === venueId ? 'out' : 'in' }))
      list.sort((a, b) => (a.status === 'sent' ? 0 : 1) - (b.status === 'sent' ? 0 : 1) || new Date(b.sent_at) - new Date(a.sent_at))
      return {
        sees_values: access.sees_values, can_send: access.can_count && !venueProblem(req, venueId),
        incoming: list.filter(t => t.direction === 'in' && t.status === 'sent'),
        outgoing: list.filter(t => t.direction === 'out' && t.status === 'sent'),
        history: list.filter(t => t.status !== 'sent'),
      }
    })
  })

  app.get('/transfers/:transferId', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const t = (await withLines(tx, req.tenantId, [await loadTransfer(tx, req.tenantId, req.params.transferId)]))[0]
      const units = await loadCountItems(tx, req.tenantId, t.lines.map(l => l.item_id))
      return transferView(t, req, access, units)
    })
  })

  app.post('/venues/:venueId/transfers', { preHandler: canUse }, async (req, reply) => {
    const b = TransferBody.parse(req.body || {})
    const access = await stockAccess(req)
    const { by } = await stockPerson(req)
    const from = req.params.venueId
    const lines = b.lines || (b.item_id ? [{ item_id: b.item_id, qty: b.qty, unit: b.unit }] : [])
    if (!lines.length) throw httpError(422, 'Say what is sent', { code: 'lines' })
    if (b.lines && b.item_id) throw httpError(422, 'Send lines, or one item, not both', { code: 'lines' })
    if (lines.some(l => !(l.qty > 0))) throw httpError(422, 'Give each item a quantity', { code: 'qty' })
    if (new Set(lines.map(l => l.item_id)).size !== lines.length) throw httpError(422, 'An item is on the transfer twice', { code: 'twice' })
    if (b.to_venue_id === from) throw httpError(422, 'A transfer goes to another venue', { code: 'same_venue' })
    const why = venueProblem(req, from)
    if (why) throw httpError(403, why, { code: 'venue' })
    const at = b.sent_at ? new Date(b.sent_at) : new Date()
    if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - COUNT_BACK_DAYS * 86400_000) {
      throw httpError(422, 'A transfer is sent now or up to ' + COUNT_BACK_DAYS + ' days back', { code: 'sent_at' })
    }
    const row = await withTenant(req.tenantId, async tx => {
      const [to] = await tx`SELECT id FROM venues WHERE id = ${b.to_venue_id} AND tenant_id = ${req.tenantId}`
      if (!to) throw httpError(404, 'Venue not found')
      const items = await loadCountItems(tx, req.tenantId, lines.map(l => l.item_id))
      if (items.size !== lines.length) throw httpError(404, 'Inventory item not found')
      const sized = lines.map(l => ({ ...l, item: items.get(l.item_id), ...inBase(items.get(l.item_id), l.qty, l.unit) }))
      // Valued at the sender's average when it is sent.
      const costs = await itemCostsAt(tx, req.tenantId, from, sized.map(l => l.item_id), at)
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'stock_transfer:' + req.tenantId}))`
      const [{ next }] = await tx`SELECT COALESCE(max(number), 0)::int + 1 AS next FROM stock_transfers WHERE tenant_id = ${req.tenantId}`
      const [t] = await tx`
        INSERT INTO stock_transfers (tenant_id, number, from_venue_id, to_venue_id, status, note, sent_at, sent_by)
        VALUES (${req.tenantId}, ${next}, ${from}, ${to.id}, 'sent', ${b.note || null}, ${at}, ${by})
        RETURNING ${tx.unsafe(T_COLS)}`
      await tx`INSERT INTO stock_transfer_lines ${tx(sized.map((l, i) => ({
        tenant_id: req.tenantId, transfer_id: t.id, item_id: l.item_id, sort_order: i, qty: r4(l.qty), unit: l.label.slice(0, 80),
        qty_base: l.qty_base, cost_per_base: costs.get(l.item_id) ?? null,
      })), 'tenant_id', 'transfer_id', 'item_id', 'sort_order', 'qty', 'unit', 'qty_base', 'cost_per_base')}`
      return transferView((await withLines(tx, req.tenantId, [t]))[0], req, access)
    })
    return reply.code(201).send(row)
  })

  app.post('/transfers/:transferId/receive', { preHandler: canUse }, async req => {
    const b = ReceiveBody.parse(req.body || {})
    const access = await stockAccess(req)
    const { by } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const t = await loadTransfer(tx, req.tenantId, req.params.transferId, true)
      if (t.status !== 'sent') throw httpError(409, 'This transfer is ' + TRANSFER_STATUSES[t.status].toLowerCase() + ' already', { code: 'transfer_status', status: t.status })
      const why = venueProblem(req, t.to_venue_id)
      if (why) throw httpError(403, why, { code: 'venue' })
      const [full] = await withLines(tx, req.tenantId, [t])
      const given = new Map(b.lines.map(l => [l.line_id, l]))
      if (given.size !== b.lines.length || given.size !== full.lines.length || full.lines.some(l => !given.has(l.id))) {
        throw httpError(422, 'Say what arrived of every line, once (0 when none of it came)', { code: 'lines' })
      }
      const items = await loadCountItems(tx, req.tenantId, full.lines.map(l => l.item_id))
      for (const l of full.lines) {
        const g = given.get(l.id)
        const r = inBase(items.get(l.item_id), g.qty, g.unit)
        await tx`UPDATE stock_transfer_lines SET received_qty = ${r4(g.qty)}, received_unit = ${r.label.slice(0, 80)}, received_base = ${r.qty_base}
                  WHERE id = ${l.id} AND tenant_id = ${req.tenantId}`
      }
      const [done] = await tx`
        UPDATE stock_transfers SET status = 'received', received_at = now(), received_by = ${by}, receive_note = ${b.note || null}, updated_at = now()
         WHERE id = ${t.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(T_COLS)}`
      return transferView((await withLines(tx, req.tenantId, [done]))[0], req, access)
    })
  })

  app.post('/transfers/:transferId/cancel', { preHandler: canUse }, async req => {
    const access = await stockAccess(req)
    const { by } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const t = await loadTransfer(tx, req.tenantId, req.params.transferId, true)
      if (t.status !== 'sent') throw httpError(409, 'Only a transfer in transit can be cancelled: this one is ' + TRANSFER_STATUSES[t.status].toLowerCase(), { code: 'transfer_status', status: t.status })
      const why = venueProblem(req, t.from_venue_id)
      if (why) throw httpError(403, why, { code: 'venue' })
      const [done] = await tx`
        UPDATE stock_transfers SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${by}, updated_at = now()
         WHERE id = ${t.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(T_COLS)}`
      return transferView((await withLines(tx, req.tenantId, [done]))[0], req, access)
    })
  })
}
