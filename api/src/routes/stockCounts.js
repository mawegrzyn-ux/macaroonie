// src/routes/stockCounts.js
//
// Stocktakes (inventory phase 4a, migration 306; docs/INVENTORY.md 6.2,
// decision D11), mounted at /api/stock by src/areas/stock.js. A count is a
// document: drafted (counting, Use), submitted (Use), approved (Manage) or
// cancelled; only approved counts move stock. A full count covers the
// venue's items (countScope() in services/stockSvc.js) and what isn't
// counted is confirmed as zero before it is submitted; a key-item count
// covers a key list's items and leaves the rest alone.
//
// Counting is the one place where Save is not a button (Standard Design Rule
// 5): each line is written on its own as it is typed (PUT /counts/:id/lines,
// one item in one area), so two people can count two areas of one count at
// once and nobody's lines are written over by a whole-count save. A line
// takes several units (2 cases + 3 each + 400 g, entriesToBase() in
// shared/stock.js), kept as typed with their total in the item's base unit.
//
//   GET  /venues/:venueId/counts        the venue's open counts and its last 30
//   POST /venues/:venueId/counts        { kind, key_list_id?, counted_at?, note? }: a draft
//                                       (409 open_count while the venue has a draft);
//                                       or { lines, note?, counted_at? }: a quick count of
//                                       those items (a key count with no list, Pepper's
//                                       count_stock), submitted, and approved at once when
//                                       the person may approve it
//   GET  /counts/:id                    the count: its sheet by area, its lines, what
//                                       isn't counted (a full count), and once it may be
//                                       seen (not while a blind count is being counted)
//                                       expected against counted (countReview()), values
//                                       with Costing view; later_count: an approved count
//                                       at the venue dated after it (what that one counted
//                                       keeps its figures)
//   PATCH /counts/:id                   { note?, counted_at? } while counting
//   PUT  /counts/:id/lines              { item_id, area_id, entries }: one line, as typed
//                                       (no entries: the line goes)
//   POST /counts/:id/areas/:areaId      { done }: an area finished (or not)
//   POST /counts/:id/submit             { zero_item_ids?, all_zero? }: a full count names
//                                       what it confirms as zero (422 not_counted lists the rest)
//   POST /counts/:id/approve            Manage; approvalProblem() (the second person setting);
//                                       a full count makes the stock period since the
//                                       previous approved full count (phase 6a: periods_made,
//                                       period_note when it is inside a closed period)
//   POST /counts/:id/reopen             Manage: a submitted count back to counting
//   POST /counts/:id/cancel             a draft (Use), a submitted count (Manage); never an approved one
//   GET  /venues/:venueId/today?date=   Today's stock tasks: the count due on the venue's
//                                       count day (until a count of the kind it counts is
//                                       submitted: a full count, or its key-item list's;
//                                       never a quick count), counts waiting for approval,
//                                       and (phase 4b) transfers sent to the venue waiting
//                                       to be received, and (phase 6a, Stock manage) closed
//                                       periods with flagged items not reviewed yet; (phase 6b)
//                                       Home's set-up gaps (no storage areas, best sellers with
//                                       no recipe, items in recipes with no price)

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import {
  entriesToBase, countReview, notCounted, approvalProblem, countDueOn, COUNT_BACK_DAYS, MAX_ENTRIES, COUNT_KINDS,
} from '../../../shared/stock.js'
import {
  loadStockOnHand, loadCountItems, loadStockSettings, loadVenueSettings, countScope, itemCostsAt,
} from '../services/stockSvc.js'
import { stockAccess, stockPerson, who } from './stock.js'
import { periodsForCount, toReview } from '../services/stockVarianceSvc.js'
import { setupGaps } from '../services/stockFoodCostSvc.js'

const canView = requirePermission('stock', 'view')
const canCount = requirePermission('stock', 'use')
const canManage = requirePermission('stock', 'manage')
const Id = z.string().uuid()
const MAX_LINES = 1000
const Note = z.string().trim().max(500).nullable().optional()
const At = z.string().datetime({ offset: true }).optional()
const Entry = z.object({ qty: z.number().min(0).max(100000000), unit: z.string().trim().min(1).max(80) })

export const StartBody = z.object({
  kind: z.enum(Object.keys(COUNT_KINDS)),
  key_list_id: Id.nullable().optional(),
  counted_at: At,
  note: Note,
}).strict()
// A key-item count from a list (the plain form "New key-item count", api/src/forms/stock.js).
export const KeyCountBody = z.object({
  key_list_id: Id,
  note: Note,
}).strict()
export const QuickBody = z.object({
  lines: z.array(z.object({
    item_id: Id,
    area_id: Id.nullable().optional(),
    qty: z.number().min(0).max(100000000).optional(),
    unit: z.string().trim().min(1).max(80).optional(),
    entries: z.array(Entry).max(MAX_ENTRIES).optional(),
  })).min(1).max(MAX_LINES),
  note: Note,
  counted_at: At,
})
export const LineBody = z.object({
  item_id: Id,
  area_id: Id.nullable(),
  entries: z.array(Entry).max(MAX_ENTRIES),
}).strict()

const COUNT_COLS = 'id, venue_id, kind, status, key_list_id, key_list_name, counted_at, counted_by, note, areas_done, started_by, submitted_by, submitted_at, approved_by, approved_at, cancelled_by, cancelled_at, created_at, updated_at'

function checkAt(iso) {
  const at = iso ? new Date(iso) : new Date()
  if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.now() - COUNT_BACK_DAYS * 86400_000) {
    throw httpError(422, 'A count is for now or up to ' + COUNT_BACK_DAYS + ' days back', { code: 'counted_at' })
  }
  return at
}

/** The count, the tenant's (rule 4); `lock`: 'share' for a line, 'update' for a change of state. */
async function loadCount(tx, tenantId, id, lock = null) {
  const rows = lock === 'update'
    ? await tx`SELECT ${tx.unsafe(COUNT_COLS)} FROM stock_counts WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`
    : lock === 'share'
      ? await tx`SELECT ${tx.unsafe(COUNT_COLS)} FROM stock_counts WHERE id = ${id} AND tenant_id = ${tenantId} FOR SHARE`
      : await tx`SELECT ${tx.unsafe(COUNT_COLS)} FROM stock_counts WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!rows[0]) throw httpError(404, 'Count not found')
  return rows[0]
}

const mustBe = (c, status, what) => {
  if (c.status !== status) {
    throw httpError(409, 'This count is ' + ({ draft: 'still being counted', submitted: 'waiting for approval', approved: 'approved', cancelled: 'cancelled' }[c.status]) + ': ' + what, { code: 'count_status', status: c.status })
  }
}

async function countLines(tx, tenantId, countId) {
  return tx`
    SELECT l.id, l.item_id, l.area_id, l.entries, l.qty_base::float8 AS qty_base, l.confirmed_zero, l.counted_by, l.updated_at
      FROM stock_count_lines l WHERE l.tenant_id = ${tenantId} AND l.count_id = ${countId}
     ORDER BY l.updated_at`
}

/** A line's entries in the item's own units, as its base quantity (422 when a unit doesn't fit). */
function lineQty(item, entries) {
  const r = entriesToBase(entries, item.count_units, item)
  if (r.problem) throw httpError(422, r.problem, { code: 'unit' })
  return r
}

/** A quick count's line: entries, or one qty in a unit (the item's base unit when none). */
function quickEntries(l, item) {
  if (l.entries?.length) return l.entries
  if (l.qty == null) throw httpError(422, 'Give ' + item.name + ' a quantity', { code: 'qty' })
  return [{ qty: l.qty, unit: l.unit || item.base_unit }]
}

/** The count with its sheet, lines and (when it may be seen) expected against counted. */
async function countView(tx, req, c, access, mine) {
  const tenantId = req.tenantId
  const [scope, lines, settings] = await Promise.all([countScope(tx, tenantId, c), countLines(tx, tenantId, c.id), loadStockSettings(tx, tenantId)])
  const ids = [...new Set([...scope.item_ids, ...lines.map(l => l.item_id)])]
  const items = await loadCountItems(tx, tenantId, ids)
  // Blind counting (a group setting): nobody sees what is expected until the count is submitted.
  const blind = settings.blind_count && c.status === 'draft'
  let review = null
  let expected = null
  if (!blind && c.status !== 'cancelled') {
    const counted = [...new Set(lines.map(l => l.item_id))]
    // Expected for every item on the sheet (shown beside each line while counting), the review for those counted.
    const exp = ids.length ? await loadStockOnHand(tx, tenantId, { venueIds: [c.venue_id], itemIds: ids, at: c.counted_at, exceptCountId: c.id }) : []
    const onHandOf = new Map(exp.map(r => [r.item_id, r.on_hand]))
    expected = Object.fromEntries(ids.map(id => [id, onHandOf.get(id) ?? null]))
    const cost = access.sees_values && counted.length ? Object.fromEntries(await itemCostsAt(tx, tenantId, c.venue_id, counted, c.counted_at)) : {}
    const r = countReview(lines, { expected, cost })
    review = {
      rows: r.rows.map(x => ({ ...x, name: items.get(x.item_id)?.name ?? null, base_unit: items.get(x.item_id)?.base_unit ?? null, ...(access.sees_values ? {} : { value: undefined }) }))
        .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0) || (a.name || '').localeCompare(b.name || '')),
      ...(access.sees_values ? { totals: r.totals } : { totals: { valued: 0, unvalued: r.totals.unvalued + r.totals.valued } }),
    }
  }
  const missing = c.kind === 'full' ? notCounted(scope.item_ids, lines) : []
  // A count dated before an approved one at the venue changes nothing the later one counted
  // (on hand starts from each item's last count): said on the sheet and the review.
  const [later] = c.status === 'draft' || c.status === 'submitted' ? await tx`
    SELECT id, kind, key_list_name, counted_at FROM stock_counts
     WHERE tenant_id = ${tenantId} AND venue_id = ${c.venue_id} AND status = 'approved' AND id <> ${c.id} AND counted_at > ${c.counted_at}
     ORDER BY counted_at DESC LIMIT 1` : []
  return {
    ...c,
    kind_label: COUNT_KINDS[c.kind]?.label,
    blind, sees_values: access.sees_values,
    settings,
    can_count: access.can_count && c.status === 'draft',
    can_manage: access.can_manage,
    can_approve: access.can_manage && c.status === 'submitted' && !approvalProblem(c, lines, mine, settings),
    approve_problem: c.status === 'submitted' ? approvalProblem(c, lines, mine, settings)?.message ?? null : null,
    areas: scope.areas.map(a => ({ ...a, done: c.areas_done?.[a.id] || null })),
    other: scope.other,
    items: Object.fromEntries([...items.values()].map(i => [i.id, {
      id: i.id, name: i.name, code: i.code, barcode: i.barcode, quote_barcodes: i.quote_barcodes, base_unit: i.base_unit,
      category_name: i.category_name, units: i.count_units, default_unit: i.default_unit,
    }])),
    lines,
    not_counted: missing,
    later_count: later || null,
    expected,
    review,
  }
}

export default async function stockCountRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId/counts', { preHandler: canView }, async req => withTenant(req.tenantId, tx => tx`
    SELECT c.id, c.kind, c.status, c.key_list_name, c.counted_at, c.counted_by, c.note, c.started_by, c.submitted_by, c.submitted_at,
           c.approved_by, c.approved_at, c.cancelled_at, c.areas_done, c.created_at,
           (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id = c.id AND l.tenant_id = ${req.tenantId}) AS lines,
           (SELECT count(DISTINCT l.item_id)::int FROM stock_count_lines l WHERE l.count_id = c.id AND l.tenant_id = ${req.tenantId}) AS items
      FROM stock_counts c
     WHERE c.tenant_id = ${req.tenantId} AND c.venue_id = ${req.params.venueId}
       AND (c.status IN ('draft', 'submitted') OR c.id IN (
             SELECT x.id FROM stock_counts x WHERE x.tenant_id = ${req.tenantId} AND x.venue_id = ${req.params.venueId}
              AND x.status IN ('approved', 'cancelled') ORDER BY x.counted_at DESC, x.created_at DESC LIMIT 30))
     ORDER BY (c.status IN ('draft', 'submitted')) DESC, c.counted_at DESC, c.created_at DESC`))

  app.post('/venues/:venueId/counts', { preHandler: canCount }, async (req, reply) => {
    const body = req.body || {}
    const access = await stockAccess(req)
    const person = await stockPerson(req)
    const me = person.by
    if (Array.isArray(body.lines)) {
      // A quick count: these items only, submitted at once, approved when the person may.
      const b = QuickBody.parse(body)
      const at = checkAt(b.counted_at)
      const row = await withTenant(req.tenantId, async tx => {
        const ids = [...new Set(b.lines.map(l => l.item_id))]
        const items = await loadCountItems(tx, req.tenantId, ids)
        if (items.size !== ids.length) throw httpError(404, 'Inventory item not found')
        const areaIds = [...new Set(b.lines.map(l => l.area_id).filter(Boolean))]
        if (areaIds.length) {
          const got = await tx`SELECT id FROM stock_areas WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId} AND id = ANY(${areaIds}::uuid[])`
          if (got.length !== areaIds.length) throw httpError(404, 'Storage area not found')
        }
        const seen = new Set()
        const lines = b.lines.map(l => {
          const item = items.get(l.item_id)
          const k = l.item_id + '|' + (l.area_id || '')
          if (seen.has(k)) throw httpError(422, item.name + ' is in the count twice', { code: 'twice' })
          seen.add(k)
          const r = lineQty(item, quickEntries(l, item))
          if (r.qty_base == null) throw httpError(422, 'Give ' + item.name + ' a quantity', { code: 'qty' })
          return { item_id: item.id, area_id: l.area_id || null, entries: r.entries, qty_base: r.qty_base }
        })
        const settings = await loadStockSettings(tx, req.tenantId)
        const [c] = await tx`
          INSERT INTO stock_counts (tenant_id, venue_id, kind, status, counted_at, counted_by, note, started_by, submitted_by, submitted_at)
          VALUES (${req.tenantId}, ${req.params.venueId}, 'key', 'submitted', ${at}, ${me}, ${b.note || null}, ${me}, ${me}, now())
          RETURNING ${tx.unsafe(COUNT_COLS)}`
        await tx`INSERT INTO stock_count_lines ${tx(lines.map(l => ({ ...l, entries: tx.json(l.entries), tenant_id: req.tenantId, count_id: c.id, counted_by: me })), 'tenant_id', 'count_id', 'item_id', 'area_id', 'entries', 'qty_base', 'counted_by')}`
        let status = 'submitted'
        if (access.can_manage && !approvalProblem(c, lines.map(l => ({ counted_by: me })), person.ids, settings)) {
          await tx`UPDATE stock_counts SET status = 'approved', approved_by = ${me}, approved_at = now(), updated_at = now() WHERE id = ${c.id} AND tenant_id = ${req.tenantId}`
          status = 'approved'
        }
        return { id: c.id, counted_at: c.counted_at, lines: lines.length, status }
      })
      return reply.code(201).send(row)
    }
    const b = StartBody.parse(body)
    return reply.code(201).send(await startCount(req, b))
  })

  // A key-item count from a list: the plain form's save (open_form).
  app.post('/venues/:venueId/key-counts', { preHandler: canCount }, async (req, reply) => {
    const b = KeyCountBody.parse(req.body || {})
    return reply.code(201).send(await startCount(req, { kind: 'key', key_list_id: b.key_list_id, note: b.note }))
  })

  async function startCount(req, b) {
    const at = checkAt(b.counted_at)
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      let list = null
      if (b.kind === 'key') {
        if (!b.key_list_id) throw httpError(422, 'A key-item count needs its list', { code: 'key_list' })
        ;[list] = await tx`SELECT id, name FROM stock_key_lists WHERE id = ${b.key_list_id} AND tenant_id = ${req.tenantId}`
        if (!list) throw httpError(404, 'Key-item list not found')
      }
      // One sheet per venue at a time, so everyone counting adds to the same one.
      await tx`SELECT pg_advisory_xact_lock(hashtext('stock_count:' || ${req.params.venueId}))`
      const [open] = await tx`SELECT id FROM stock_counts WHERE tenant_id = ${req.tenantId} AND venue_id = ${req.params.venueId} AND status = 'draft' LIMIT 1`
      if (open) throw httpError(409, 'A count is already being taken at this venue: carry on with it, or cancel it first', { code: 'open_count', count_id: open.id })
      const [c] = await tx`
        INSERT INTO stock_counts (tenant_id, venue_id, kind, status, key_list_id, key_list_name, counted_at, counted_by, note, started_by)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${b.kind}, 'draft', ${list?.id ?? null}, ${list?.name ?? null}, ${at}, ${me}, ${b.note || null}, ${me})
        RETURNING ${tx.unsafe(COUNT_COLS)}`
      return c
    })
  }

  app.get('/counts/:id', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    const { ids } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => countView(tx, req, await loadCount(tx, req.tenantId, req.params.id), access, ids))
  })

  app.patch('/counts/:id', { preHandler: canCount }, async req => {
    const b = z.object({ note: Note, counted_at: At }).strict().parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const c = await loadCount(tx, req.tenantId, req.params.id, 'update')
      mustBe(c, 'draft', 'its details can\'t change')
      const at = b.counted_at ? checkAt(b.counted_at) : c.counted_at
      const [row] = await tx`
        UPDATE stock_counts SET note = ${b.note !== undefined ? (b.note || null) : c.note}, counted_at = ${at}, updated_at = now()
         WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(COUNT_COLS)}`
      return row
    })
  })

  app.put('/counts/:id/lines', { preHandler: canCount }, async req => {
    const b = LineBody.parse(req.body || {})
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      // FOR SHARE: lines of one count are written side by side; a submit (FOR UPDATE) waits for them.
      const c = await loadCount(tx, req.tenantId, req.params.id, 'share')
      mustBe(c, 'draft', 'lines can\'t change')
      const items = await loadCountItems(tx, req.tenantId, [b.item_id])
      const item = items.get(b.item_id)
      if (!item) throw httpError(404, 'Inventory item not found')
      if (b.area_id) {
        const [a] = await tx`SELECT id FROM stock_areas WHERE id = ${b.area_id} AND tenant_id = ${req.tenantId} AND venue_id = ${c.venue_id}`
        if (!a) throw httpError(404, 'Storage area not found')
      }
      const r = lineQty(item, b.entries)
      let line = null
      if (r.qty_base == null) {
        await tx`DELETE FROM stock_count_lines WHERE tenant_id = ${req.tenantId} AND count_id = ${c.id} AND item_id = ${item.id} AND area_id IS NOT DISTINCT FROM ${b.area_id}`
      } else {
        ;[line] = await tx`
          INSERT INTO stock_count_lines (tenant_id, count_id, item_id, area_id, entries, qty_base, counted_by, confirmed_zero, updated_at)
          VALUES (${req.tenantId}, ${c.id}, ${item.id}, ${b.area_id}, ${tx.json(r.entries)}, ${r.qty_base}, ${me}, false, now())
          ON CONFLICT (count_id, item_id, area_id) DO UPDATE
            SET entries = EXCLUDED.entries, qty_base = EXCLUDED.qty_base, counted_by = EXCLUDED.counted_by, confirmed_zero = false, updated_at = now()
          RETURNING id, item_id, area_id, entries, qty_base::float8 AS qty_base, confirmed_zero, counted_by, updated_at`
      }
      const [{ total }] = await tx`SELECT COALESCE(sum(qty_base), 0)::float8 AS total, count(*)::int AS n FROM stock_count_lines WHERE tenant_id = ${req.tenantId} AND count_id = ${c.id} AND item_id = ${item.id}`
      return { line, item_id: item.id, area_id: b.area_id, item_total: total }
    })
  })

  app.post('/counts/:id/areas/:areaId', { preHandler: canCount }, async req => {
    const b = z.object({ done: z.boolean() }).strict().parse(req.body || {})
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      // FOR UPDATE: this writes the count's own row (two people finishing two areas wait for each other, briefly).
      const c = await loadCount(tx, req.tenantId, req.params.id, 'update')
      mustBe(c, 'draft', 'its areas can\'t change')
      const [a] = await tx`SELECT id FROM stock_areas WHERE id = ${req.params.areaId} AND tenant_id = ${req.tenantId} AND venue_id = ${c.venue_id}`
      if (!a) throw httpError(404, 'Storage area not found')
      // One key merged or taken out: two people finishing two areas never write over each other.
      const [row] = b.done
        ? await tx`UPDATE stock_counts SET areas_done = areas_done || jsonb_build_object(${a.id}::text, jsonb_build_object('by', ${me}::text, 'at', now())), updated_at = now()
                    WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING areas_done`
        : await tx`UPDATE stock_counts SET areas_done = areas_done - ${a.id}::text, updated_at = now()
                    WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING areas_done`
      return row
    })
  })

  app.post('/counts/:id/submit', { preHandler: canCount }, async req => {
    const b = z.object({ zero_item_ids: z.array(Id).max(5000).optional(), all_zero: z.boolean().optional() }).strict().parse(req.body || {})
    const { by: me, ids } = await stockPerson(req)
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const c = await loadCount(tx, req.tenantId, req.params.id, 'update')
      mustBe(c, 'draft', 'it can\'t be submitted again')
      const lines = await countLines(tx, req.tenantId, c.id)
      let zeros = []
      if (c.kind === 'full') {
        const scope = await countScope(tx, req.tenantId, c)
        const missing = notCounted(scope.item_ids, lines)
        const confirmed = new Set(b.all_zero ? missing : (b.zero_item_ids || []))
        const left = missing.filter(id => !confirmed.has(id))
        if (left.length) {
          const names = await tx`SELECT id, name FROM inv_items WHERE tenant_id = ${req.tenantId} AND id = ANY(${left}::uuid[]) ORDER BY lower(name)`
          throw httpError(422, names.length + ' item' + (names.length === 1 ? ' isn\'t' : 's aren\'t') + ' counted: confirm ' + (names.length === 1 ? 'it' : 'them') + ' as zero, or count ' + (names.length === 1 ? 'it' : 'them'), { code: 'not_counted', items: names })
        }
        zeros = missing
      }
      if (!lines.length && !zeros.length) throw httpError(422, 'Nothing is counted yet', { code: 'empty' })
      if (zeros.length) {
        await tx`INSERT INTO stock_count_lines ${tx(zeros.map(id => ({ tenant_id: req.tenantId, count_id: c.id, item_id: id, area_id: null, entries: tx.json([]), qty_base: 0, confirmed_zero: true, counted_by: me })), 'tenant_id', 'count_id', 'item_id', 'area_id', 'entries', 'qty_base', 'confirmed_zero', 'counted_by')}
                 ON CONFLICT (count_id, item_id, area_id) DO NOTHING`
      }
      const [row] = await tx`UPDATE stock_counts SET status = 'submitted', submitted_by = ${me}, submitted_at = now(), updated_at = now()
                              WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(COUNT_COLS)}`
      return countView(tx, req, row, access, ids)
    })
  })

  app.post('/counts/:id/approve', { preHandler: canManage }, async req => {
    const { by: me, ids } = await stockPerson(req)
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const c = await loadCount(tx, req.tenantId, req.params.id, 'update')
      mustBe(c, 'submitted', 'only a submitted count can be approved')
      const [lines, settings] = await Promise.all([countLines(tx, req.tenantId, c.id), loadStockSettings(tx, req.tenantId)])
      const problem = approvalProblem(c, lines, ids, settings)
      if (problem) throw httpError(403, problem.message, { code: problem.code })
      const [row] = await tx`UPDATE stock_counts SET status = 'approved', approved_by = ${me}, approved_at = now(), updated_at = now()
                              WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(COUNT_COLS)}`
      // Phase 6a: an approved full count closes the period since the previous one (a stock period, open until closed).
      const made = await periodsForCount(tx, req.tenantId, row)
      return { ...(await countView(tx, req, row, access, ids)), periods_made: made.periods.map(p => p.id), period_note: made.note }
    })
  })

  app.post('/counts/:id/reopen', { preHandler: canManage }, async req => {
    const access = await stockAccess(req)
    const { ids } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const c = await loadCount(tx, req.tenantId, req.params.id, 'update')
      mustBe(c, 'submitted', 'only a submitted count can go back to counting')
      // Lines confirmed as zero on submit go too: they are asked again when it is submitted again.
      await tx`DELETE FROM stock_count_lines WHERE tenant_id = ${req.tenantId} AND count_id = ${c.id} AND confirmed_zero`
      const [row] = await tx`UPDATE stock_counts SET status = 'draft', submitted_by = NULL, submitted_at = NULL, updated_at = now()
                              WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(COUNT_COLS)}`
      return countView(tx, req, row, access, ids)
    })
  })

  app.post('/counts/:id/cancel', { preHandler: canCount }, async req => {
    const access = await stockAccess(req)
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      const c = await loadCount(tx, req.tenantId, req.params.id, 'update')
      if (c.status === 'approved') throw httpError(409, 'An approved count can\'t be cancelled: count again, and the newer count replaces it', { code: 'count_status', status: c.status })
      if (c.status === 'cancelled') return c
      if (c.status === 'submitted' && !access.can_manage) throw httpError(403, 'Cancelling a submitted count needs Stock manage')
      const [row] = await tx`UPDATE stock_counts SET status = 'cancelled', cancelled_by = ${me}, cancelled_at = now(), updated_at = now()
                              WHERE id = ${c.id} AND tenant_id = ${req.tenantId} RETURNING ${tx.unsafe(COUNT_COLS)}`
      return row
    })
  })

  // Today's stock tasks at a venue on a day (services/opsToday.js reads this as the person).
  app.get('/venues/:venueId/today', { preHandler: canView }, async req => {
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query || {})
    const access = await stockAccess(req)
    const { ids } = await stockPerson(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const settings = await loadVenueSettings(tx, req.tenantId, venueId)
      const weekday = new Date(q.date + 'T12:00:00Z').getUTCDay()
      const open = await tx`
        SELECT c.id, c.kind, c.status, c.key_list_name, c.counted_at, c.submitted_by, c.submitted_at
          FROM stock_counts c WHERE c.tenant_id = ${req.tenantId} AND c.venue_id = ${venueId} AND c.status IN ('draft', 'submitted')
         ORDER BY c.counted_at`
      // The day's count is done by a count of the kind the venue counts, submitted or approved, dated
      // that day at the venue: a full count (which also covers a key-item day), or a count of the
      // venue's key-item list. A quick count (a few items, Pepper's count_stock: a key count with no
      // list) is neither.
      const [done] = await tx`
        SELECT count(*)::int AS n FROM stock_counts c JOIN venues v ON v.id = c.venue_id AND v.tenant_id = c.tenant_id
         WHERE c.tenant_id = ${req.tenantId} AND c.venue_id = ${venueId} AND c.status IN ('submitted', 'approved')
           AND (c.counted_at AT TIME ZONE COALESCE(v.timezone, 'Europe/London'))::date = ${q.date}::date
           AND (c.kind = 'full' OR (${settings.count_kind} = 'key' AND c.kind = 'key' AND c.key_list_id IS NOT NULL
                AND c.key_list_id = ${settings.key_list_id}::uuid))`
      const lines = await Promise.all(open.filter(c => c.status === 'submitted').map(c => countLines(tx, req.tenantId, c.id)))
      const stock = await loadStockSettings(tx, req.tenantId)
      const waiting = open.filter(c => c.status === 'submitted').map((c, i) => ({
        ...c, can_approve: access.can_manage && !approvalProblem(c, lines[i], ids, stock),
      }))
      // Transfers on their way here (phase 4b): sent, not received or cancelled yet.
      const incoming = await tx`
        SELECT t.id, t.number, t.sent_at, t.sent_by, v.name AS from_name,
               (SELECT count(*)::int FROM stock_transfer_lines l WHERE l.transfer_id = t.id AND l.tenant_id = t.tenant_id) AS lines
          FROM stock_transfers t JOIN venues v ON v.id = t.from_venue_id AND v.tenant_id = t.tenant_id
         WHERE t.tenant_id = ${req.tenantId} AND t.to_venue_id = ${venueId} AND t.status = 'sent'
         ORDER BY t.sent_at`
      // Phase 6a: closed periods with flagged items nobody has reviewed yet (reviewing is Stock manage).
      const variance = access.can_manage ? await toReview(tx, req.tenantId, venueId) : []
      // Phase 6b: gaps in the set-up for Home (each offered only to whoever manages its module).
      const gaps = await setupGaps(tx, req.tenantId, venueId)
      return {
        settings, weekday,
        count_due: countDueOn(settings, weekday) && done.n === 0,
        draft: open.find(c => c.status === 'draft') || null,
        waiting, incoming, variance, gaps,
        can_count: access.can_count, can_manage: access.can_manage,
      }
    })
  })
}
