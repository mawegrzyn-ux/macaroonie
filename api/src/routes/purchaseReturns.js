// src/routes/purchaseReturns.js
//
// Returns to the supplier and their credit notes (inventory phase 9b,
// migration 321; docs/INVENTORY.md 6.4), mounted at /api/purchasing by
// src/areas/purchasing.js beside the purchase orders:
//
//   GET  /pos/:id/returns         a delivery's returns, and what of it can still go back
//                                 (each line with what arrived, what is already going back,
//                                 and a damaged or substituted line's return filled in)
//   POST /pos/:id/returns         StartBody: a return of some of its lines (Purchasing Use)
//   GET  /returns                 the returns of a venue (or the group), newest first:
//                                 ?venue_id= &status= &owed=1 &overdue=1 &at= &supplier_id=
//   GET  /returns/:id             one return with its lines
//   GET  /returns/:id/file        the supplier's copy: ?format=pdf | html
//   POST /returns/:id/send        email it to the supplier, with the PDF (Purchasing approval)
//   POST /returns/:id/mark-sent   MarkSentBody: told the supplier another way (Purchasing approval)
//   POST /returns/:id/credit      CreditBody: their credit note came (Purchasing approval)
//   POST /returns/:id/refuse      RefuseBody: the supplier won't credit it (Purchasing approval)
//   POST /returns/:id/cancel      CancelBody: not returned after all (an open one: whoever may
//                                 start a return; a sent one: Purchasing approval)
//
// Starting a return takes the stock out of the venue at once (a 'return' move
// on the ledger, read by the stock area's loadStockMoves(); variance's returns
// term reads the same moves). What may be done is returnActions() in
// shared/returns.js, the same flags the page shows. The person is kept as the
// stock documents keep them (stockPerson(): the PIN person on a shared device).
// Money (prices, the credit expected, the amount credited) needs purchasing
// prices (seesPurchasingPrices()); a credit amount is taken only from someone
// who sees them. Every query filters tenant_id itself; every id in a URL or
// body is checked to be the group's.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { permissionAtLeast } from '../config/modules.js'
import { requireAuth, requireAnyPermission, requirePermission, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { PRICES_MODULE, seesPurchasingPrices } from '../../../shared/procurement.js'
import {
  returnLinesProblem, returnedAtProblem, returnActions, returnTotals, paidPrice, paidVatRate, returnableLines,
  RETURN_REASON_KEYS, RETURN_STATUSES, RETURN_SENT_VIA, RETURN_NOTE_MAX, MAX_RETURN_LINES, CREDIT_OVERDUE_DAYS, RETURN_BACK_DAYS,
} from '../../../shared/returns.js'
import { loadPoLines } from '../services/purchasingSvc.js'
import {
  loadReturns, loadReturn, returnViews, returnedOnPo, returnableFor, nextReturnNumber, returnFile, emailReturn,
  historyEntry,
} from '../services/purchaseReturnsSvc.js'
import { stockPerson } from '../services/stockSvc.js'

const Id = z.string().uuid()
const Note = z.string().trim().max(RETURN_NOTE_MAX).nullable().optional()
const Moment = z.string().datetime({ offset: true })
const DAY = 86400000

export const StartBody = z.object({
  lines: z.array(z.object({
    po_line_id: Id,
    qty: z.number().positive().max(100000),
    reason: z.enum(RETURN_REASON_KEYS),
    note: Note,
  }).strict()).min(1).max(MAX_RETURN_LINES),
  note: Note,
  // When the goods went back: now when left out, else up to RETURN_BACK_DAYS back and not before the delivery was booked in.
  returned_at: Moment.optional(),
}).strict()
export const MarkSentBody = z.object({
  via: z.enum(Object.keys(RETURN_SENT_VIA)),
  sent_at: Moment.optional(),
}).strict()
export const CreditBody = z.object({
  credit_note_number: z.string().trim().min(1).max(100),
  credit_note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Before VAT, as on the credit note. Only from someone who sees purchasing prices.
  credit_amount: z.number().min(0).max(10000000).nullable().optional(),
}).strict()
export const RefuseBody = z.object({ note: z.string().trim().min(1).max(RETURN_NOTE_MAX) }).strict()
export const CancelBody = z.object({ note: Note }).strict()

const canRead = requireAnyPermission(['purchasing', 'purchasing_setup', 'purchasing_approve'], 'view')
const canApprove = requirePermission('purchasing_approve', 'manage')

/** What the caller may do with returns: start them (Purchasing Use, or approval), approve them, see prices. */
async function returnAccess(req) {
  const lv = await permissionLevels(req, ['purchasing', 'purchasing_approve', PRICES_MODULE])
  const canApprove = lv.purchasing_approve === 'manage'
  return {
    canStart: permissionAtLeast(lv.purchasing, 'use') || canApprove,
    canApprove,
    prices: seesPurchasingPrices(lv[PRICES_MODULE]),
  }
}

/** Starting a return (and cancelling an open one): Purchasing Use, or Purchasing approval Manage. */
async function canStart(req, reply) {
  if (req.isPlatformAdmin && !req.acting) return
  if (!req.tenantId) return reply.code(400).send({ error: 'No tenant context' })
  const a = await returnAccess(req)
  if (!a.canStart) return reply.code(403).send({ error: 'Your role can\'t return goods to a supplier: it needs Purchasing (Use) or Purchasing approval.' })
}

async function ownPo(tx, tenantId, id, { lock = false } = {}) {
  const [po] = lock
    ? await tx`SELECT id, venue_id, supplier_id, status, received_at, number FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : await tx`SELECT id, venue_id, supplier_id, status, received_at, number FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!po) throw httpError(404, 'Purchase order not found')
  return po
}

/** One return as the routes send it. */
async function oneView(tx, req, id, access) {
  const r = await loadReturn(tx, req.tenantId, id)
  return (await returnViews(tx, req.tenantId, [r], access))[0]
}

/** Refuses an action returnActions() doesn't allow for this return now (409, with the status). */
function mustAllow(ret, access, flag, words) {
  if (!returnActions(ret, access)[flag]) {
    throw httpError(409, 'This return is ' + RETURN_STATUSES[ret.status].toLowerCase() + ', so it can\'t be ' + words, { code: 'return_status', status: ret.status })
  }
}

export default async function purchaseReturnRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/pos/:id/returns', { preHandler: canRead }, async req => {
    const access = await returnAccess(req)
    return withTenant(req.tenantId, async tx => {
      const po = await ownPo(tx, req.tenantId, req.params.id)
      const rows = await loadReturns(tx, req.tenantId, { poId: po.id })
      return {
        po_id: po.id, status: po.status, received_at: po.received_at,
        can_start: access.canStart && po.status === 'received', can_approve: access.canApprove, show_prices: access.prices,
        lines: po.status === 'received' ? await returnableFor(tx, req.tenantId, po.id, { prices: access.prices }) : [],
        returns: await returnViews(tx, req.tenantId, rows, access),
      }
    })
  })

  app.post('/pos/:id/returns', { preHandler: canStart }, async (req, reply) => {
    const b = StartBody.parse(req.body || {})
    const access = await returnAccess(req)
    const { by } = await stockPerson(req)
    const view = await withTenant(req.tenantId, async tx => {
      // The delivery locked: two returns of it at once can't both take the last packs back.
      const po = await ownPo(tx, req.tenantId, req.params.id, { lock: true })
      if (po.status !== 'received') {
        throw httpError(409, 'Only a delivery that was booked in can have goods returned', { code: 'not_received', status: po.status })
      }
      const at = b.returned_at ? new Date(b.returned_at) : new Date()
      const why = returnedAtProblem(at, { receivedAt: po.received_at })
      if (why) throw httpError(422, why, { code: 'returned_at' })
      const poLines = await loadPoLines(tx, req.tenantId, po.id)
      const returnable = returnableLines(poLines, await returnedOnPo(tx, req.tenantId, po.id))
      const problem = returnLinesProblem(b.lines, returnable)
      if (problem) throw httpError(422, problem, { code: 'lines' })
      const byId = new Map(returnable.map(l => [l.id, l]))
      const lines = b.lines.map((g, i) => {
        const l = byId.get(g.po_line_id)
        const price = paidPrice(l)
        const vat_rate = paidVatRate(l)
        return {
          tenant_id: req.tenantId, po_line_id: l.id, item_id: l.item_id, item_name: l.item_name,
          product_name: l.product_name ?? null, supplier_code: l.supplier_code ?? null, pack_label: l.pack_label, base_unit: l.base_unit,
          pack_base_qty: l.pack_base_qty, qty: g.qty, qty_base: Math.round(g.qty * l.pack_base_qty * 10000) / 10000,
          price, vat_rate, credit_expected: returnTotals([{ qty: g.qty, price, vat_rate }]).net,
          reason: g.reason, note: g.note || null, sort_order: i,
        }
      })
      const totals = returnTotals(lines)
      const number = await nextReturnNumber(tx, req.tenantId)
      const [ret] = await tx`
        INSERT INTO purchase_returns ${tx({
          tenant_id: req.tenantId, number, venue_id: po.venue_id, po_id: po.id, supplier_id: po.supplier_id, status: 'open',
          note: b.note || null, returned_at: at, created_by: by, credit_expected: totals.net, credit_vat: totals.vat,
        })}
        RETURNING id`
      await tx`INSERT INTO purchase_return_lines ${tx(lines.map(l => ({ ...l, return_id: ret.id })))}`
      return oneView(tx, req, ret.id, access)
    })
    // Sent once the return (and its stock move) has committed.
    return reply.code(201).send(view)
  })

  app.get('/returns', { preHandler: canRead }, async req => {
    const q = z.object({
      venue_id: Id.optional(), supplier_id: Id.optional(), po_id: Id.optional(),
      status: z.string().max(100).optional(), owed: z.enum(['0', '1']).optional(), overdue: z.enum(['0', '1']).optional(),
      at: Moment.optional(), limit: z.coerce.number().int().min(1).max(500).optional(),
    }).parse(req.query || {})
    const access = await returnAccess(req)
    const now = q.at ? new Date(q.at) : new Date()
    const statuses = String(q.status || '').split(',').filter(s => RETURN_STATUSES[s])
    return withTenant(req.tenantId, async tx => {
      const rows = await loadReturns(tx, req.tenantId, {
        venueId: q.venue_id || null, supplierId: q.supplier_id || null, poId: q.po_id || null, statuses,
        owed: q.owed === '1', overdueBefore: q.overdue === '1' ? new Date(now.getTime() - CREDIT_OVERDUE_DAYS * DAY) : null,
        limit: q.limit || 200,
      })
      return {
        returns: await returnViews(tx, req.tenantId, rows, { ...access, now }),
        can_start: access.canStart, can_approve: access.canApprove, show_prices: access.prices, overdue_days: CREDIT_OVERDUE_DAYS,
      }
    })
  })

  app.get('/returns/:id', { preHandler: canRead }, async req => {
    const access = await returnAccess(req)
    return withTenant(req.tenantId, tx => oneView(tx, req, req.params.id, access))
  })

  // The document the supplier gets, so it always carries the prices (as a purchase order's file does).
  app.get('/returns/:id/file', { preHandler: canRead }, async (req, reply) => {
    const format = req.query?.format === 'html' ? 'html' : 'pdf'
    await withTenant(req.tenantId, tx => loadReturn(tx, req.tenantId, req.params.id))
    const f = await returnFile(req.tenantId, req.params.id, format)
    reply.header('Content-Type', f.contentType)
    reply.header('Content-Disposition', `${format === 'html' ? 'inline' : 'attachment'}; filename="${f.filename}"`)
    return reply.send(f.content)
  })

  app.post('/returns/:id/send', { preHandler: canApprove }, async req => {
    const access = await returnAccess(req)
    const { by } = await stockPerson(req)
    await withTenant(req.tenantId, async tx => mustAllow(await loadReturn(tx, req.tenantId, req.params.id), access, 'can_email', 'emailed'))
    // Emailed after the check has committed, never inside a transaction (as purchase orders are).
    await emailReturn(req.tenantId, req.params.id, by)
    return withTenant(req.tenantId, tx => oneView(tx, req, req.params.id, access))
  })

  app.post('/returns/:id/mark-sent', { preHandler: canApprove }, async req => {
    const b = MarkSentBody.parse(req.body || {})
    const access = await returnAccess(req)
    const { by } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const ret = await loadReturn(tx, req.tenantId, req.params.id, { lock: true })
      mustAllow(ret, access, 'can_mark_sent', 'marked sent')
      let sentAt = new Date()
      if (b.sent_at) {
        sentAt = new Date(b.sent_at)
        if (sentAt.getTime() > Date.now() + 5 * 60000) throw httpError(422, 'The time it went can\'t be in the future', { code: 'sent_at' })
        if (sentAt.getTime() < Date.now() - RETURN_BACK_DAYS * DAY) throw httpError(422, `The time it went must be in the last ${RETURN_BACK_DAYS} days`, { code: 'sent_at' })
        if (sentAt.getTime() < new Date(ret.returned_at).getTime() - 60000) throw httpError(422, 'The supplier can\'t have been told before the goods went back', { code: 'sent_at' })
      }
      await tx`
        UPDATE purchase_returns
           SET status = 'sent', sent_at = ${sentAt}, sent_by = ${by}, sent_via = ${b.via}, send_error = NULL,
               history = history || ${tx.json([historyEntry('marked_sent', by, RETURN_SENT_VIA[b.via])])}::jsonb, updated_at = now()
         WHERE id = ${ret.id} AND tenant_id = ${req.tenantId}`
      return oneView(tx, req, ret.id, access)
    })
  })

  app.post('/returns/:id/credit', { preHandler: canApprove }, async req => {
    const b = CreditBody.parse(req.body || {})
    const access = await returnAccess(req)
    // A price from the browser only from someone who sees purchasing prices (purchasing's rule for invoice prices).
    if (b.credit_amount != null && !access.prices) {
      throw httpError(403, 'Your role doesn\'t see purchasing prices, so it can\'t record the amount: record the credit note\'s number, and someone who sees prices adds the amount', { code: 'prices' })
    }
    const { by } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const ret = await loadReturn(tx, req.tenantId, req.params.id, { lock: true })
      mustAllow(ret, access, 'can_credit', 'credited')
      const [{ today }] = await tx`SELECT (now() AT TIME ZONE COALESCE((SELECT timezone FROM venues WHERE id = ${ret.venue_id} AND tenant_id = ${req.tenantId}), 'Europe/London'))::date::text AS today`
      if (b.credit_note_date && b.credit_note_date > today) throw httpError(422, 'The credit note can\'t be dated after today', { code: 'credit_note_date' })
      const again = ret.status === 'credited'
      await tx`
        UPDATE purchase_returns
           SET status = 'credited', credit_note_number = ${b.credit_note_number},
               credit_note_date = ${b.credit_note_date ?? null}::date,
               credit_amount = ${b.credit_amount !== undefined ? tx`${b.credit_amount}` : tx`credit_amount`},
               credited_at = now(), credited_by = ${by},
               history = history || ${tx.json([historyEntry(again ? 'credit_changed' : 'credited', by, 'credit note ' + b.credit_note_number)])}::jsonb,
               updated_at = now()
         WHERE id = ${ret.id} AND tenant_id = ${req.tenantId}`
      return oneView(tx, req, ret.id, access)
    })
  })

  app.post('/returns/:id/refuse', { preHandler: canApprove }, async req => {
    const b = RefuseBody.parse(req.body || {})
    const access = await returnAccess(req)
    const { by } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const ret = await loadReturn(tx, req.tenantId, req.params.id, { lock: true })
      mustAllow(ret, access, 'can_refuse', 'refused')
      await tx`
        UPDATE purchase_returns
           SET status = 'refused', refused_at = now(), refused_by = ${by}, refuse_note = ${b.note},
               history = history || ${tx.json([historyEntry('refused', by, b.note)])}::jsonb, updated_at = now()
         WHERE id = ${ret.id} AND tenant_id = ${req.tenantId}`
      return oneView(tx, req, ret.id, access)
    })
  })

  // Not returned after all: its stock moves are gone (the goods never left), so on hand is as it was.
  app.post('/returns/:id/cancel', { preHandler: canStart }, async req => {
    const b = CancelBody.parse(req.body || {})
    const access = await returnAccess(req)
    const { by } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const ret = await loadReturn(tx, req.tenantId, req.params.id, { lock: true })
      if (ret.status === 'sent' && !access.canApprove) {
        throw httpError(403, 'This return has gone to the supplier: only someone with Purchasing approval can cancel it', { code: 'approval' })
      }
      mustAllow(ret, access, 'can_cancel', 'cancelled')
      await tx`
        UPDATE purchase_returns
           SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${by}, cancel_note = ${b.note || null},
               history = history || ${tx.json([historyEntry('cancelled', by, b.note || null)])}::jsonb, updated_at = now()
         WHERE id = ${ret.id} AND tenant_id = ${req.tenantId}`
      return oneView(tx, req, ret.id, access)
    })
  })
}
