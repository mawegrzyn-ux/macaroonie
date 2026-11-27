// src/routes/stockVariance.js
//
// Stock periods and variance (inventory phase 6a, migration 312;
// docs/INVENTORY.md 8.1, decision D9), mounted at /api/stock by
// src/areas/stock.js. A period runs between two approved full counts at a
// venue (made when the later one is approved); the one running since the
// venue's latest approved full count is "current" (to now). Every figure is
// shared/variance.js's, worked out by services/stockVarianceSvc.js; a closed
// period's are the ones frozen when it was closed.
//
//   GET  /venues/:venueId/periods                  the venue's periods and the current one
//   GET  /venues/:venueId/variance?period=<id|current>   a period's variance: every item with
//        opening, received, transfers, closing, actual, theoretical (late sales
//        landed in it marked), waste, adjusted, variance and unexplained, ranked
//        by pounds of unexplained loss, flagged by the group's band, reviewed;
//        the totals, food cost actual and theoretical, the venue band
//   GET  /venues/:venueId/variance/items/:itemId?period=   one item: its row,
//        the evidence for its variance (explainVariance()) and its figures
//        between each pair of its counts in the period
//   GET  /venues/:venueId/variance/key?from=&to=   key items between their counts (days, at most 62)
//   GET  /variance/by-venue?item=&which=latest|current   one item at every venue of the
//        group: the latest period at each (closed or open), or the current one
//   POST /periods/:id/close                        Stock manage: its figures frozen, its days closed
//   POST /periods/:id/reopen    { note }           Stock manage: open again (not while a later
//        period at the venue is closed), its days worked out again from the sales
//   POST /periods/:id/items/:itemId/review   { reviewed, note? }   Stock manage
//   PUT  /variance-settings     { band_pct, item_pct, item_pounds }   Stock manage (whole)
//
// Stock view reads quantities and which items are flagged; pounds need
// Costing view (stockAccess().sees_values); net food sales, food cost % and
// an item's share of food sales need till reports view as well (sees_sales).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { explainVariance, keyIntervals, settingsProblem, itemFlag, varianceSettings, periodWords } from '../../../shared/variance.js'
import { costShare } from '../../../shared/costing.js'
import { loadStockMoves } from '../services/stockSvc.js'
import {
  loadPeriod, venuePeriods, currentPeriod, periodFigures, periodDays, itemFacts, keyFigures, loadReviews, loadBand,
} from '../services/stockVarianceSvc.js'
import { computeDays, claimVenue, releaseVenue, venueToday, daysBetween } from '../services/stockUsageSvc.js'
import { stockAccess, who, venueProblem } from './stock.js'

const canView = requirePermission('stock', 'view')
const canManage = requirePermission('stock', 'manage')
const Id = z.string().uuid()
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const KEY_MAX_DAYS = 62
export const ReopenBody = z.object({ note: z.string().trim().min(3).max(500) }).strict()
export const ReviewBody = z.object({ reviewed: z.boolean(), note: z.string().trim().max(500).nullable().optional() }).strict()
export const BandBody = z.object({
  band_pct: z.number().min(0).max(100),
  item_pct: z.number().min(0).max(1000),
  item_pounds: z.number().min(0).max(1000000),
}).strict()

const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)

// The keys of a row (and of the totals and food cost) that carry pounds.
const MONEY = ['price', 'actual_value', 'theoretical_value', 'waste_value', 'adjusted_value', 'explained_value', 'variance_value', 'unexplained_value', 'loss_value', 'gain_value']
const strip = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)))

/** A period as the page lists it (no figures), with how many items were flagged and reviewed when closed. */
function periodMeta(p, reviews = null) {
  if (!p) return null
  const flaggedIds = (p.figures?.rows || []).filter(r => r.flagged).map(r => r.item_id)
  const seen = reviews?.get(p.id) || new Map()
  return {
    id: p.id, current: !!p.current, venue_id: p.venue_id, opening_count_id: p.opening_count_id, closing_count_id: p.closing_count_id,
    from_at: p.from_at, to_at: p.to_at, status: p.status, words: periodWords(p),
    closed_by: p.closed_by ?? null, closed_at: p.closed_at ?? null,
    reopened_by: p.reopened_by ?? null, reopened_at: p.reopened_at ?? null, reopen_note: p.reopen_note ?? null,
    history: p.history || [], days_from: p.days_from ?? null, days_to: p.days_to ?? null,
    ...(p.status === 'closed' ? { flagged: flaggedIds.length, unreviewed: flaggedIds.filter(id => !seen.has(id)).length } : {}),
  }
}

/** A variance view (live or frozen) as this person may see it. */
function shaped(view, access, reviewsOf = new Map()) {
  const rows = (view.rows || []).map(r => {
    const reviewed = reviewsOf.get(r.item_id) || null
    let out = { ...r, reviewed }
    if (!access.sees_values) out = strip(out, MONEY)
    if (!access.sees_sales) out = strip(out, ['share_pct'])
    return out
  })
  return {
    rows,
    totals: access.sees_values ? view.totals : strip(view.totals, MONEY),
    food_cost: access.sees_sales ? view.food_cost : null,
    band: access.sees_sales ? view.band : { band_pct: view.band?.band_pct ?? null },
    flagged: view.flagged ?? rows.filter(r => r.flagged).length,
    unreviewed: rows.filter(r => r.flagged && !r.reviewed).length,
    settings: view.settings,
    late_food_pence: access.sees_sales ? view.sales?.late_food_pence ?? 0 : null,
    worked_at: view.worked_at ?? null,
  }
}

/** The period asked for at a venue: a stored one (the venue's), the current one, or by default the current else the newest. */
async function pickPeriod(tx, tenantId, venueId, asked) {
  if (asked && asked !== 'current') {
    if (!Id.safeParse(asked).success) throw httpError(400, 'A period is an id, or current')
    const p = await loadPeriod(tx, tenantId, asked)
    if (!p || p.venue_id !== venueId) throw httpError(404, 'Stock period not found')
    return p
  }
  const cur = await currentPeriod(tx, tenantId, venueId)
  if (asked === 'current' || cur) {
    if (!cur) throw httpError(404, 'This venue has no approved full count yet, so there is no period to show', { code: 'no_count' })
    return cur
  }
  const [newest] = await venuePeriods(tx, tenantId, venueId, { limit: 1 })
  if (!newest) throw httpError(404, 'This venue has no approved full count yet, so there is no period to show', { code: 'no_count' })
  return newest
}

/** A period's figures: frozen when closed, else worked out now. */
async function figuresOf(tx, tenantId, p) {
  if (p.status === 'closed' && p.figures) return { ...p.figures, frozen: true }
  return { ...(await periodFigures(tx, tenantId, p)), frozen: false }
}

export default async function stockVarianceRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId/periods', { preHandler: canView }, async req => {
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const [cur, list] = await Promise.all([currentPeriod(tx, req.tenantId, venueId), venuePeriods(tx, req.tenantId, venueId)])
      const reviews = await loadReviews(tx, req.tenantId, list.map(p => p.id))
      return { current: periodMeta(cur), periods: list.map(p => periodMeta(p, reviews)), can_manage: access.can_manage }
    })
  })

  app.get('/venues/:venueId/variance', { preHandler: canView }, async req => {
    const q = z.object({ period: z.string().max(40).optional() }).parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const p = await pickPeriod(tx, req.tenantId, req.params.venueId, q.period)
      const view = await figuresOf(tx, req.tenantId, p)
      const reviews = p.id ? (await loadReviews(tx, req.tenantId, [p.id])).get(p.id) || new Map() : new Map()
      return {
        period: periodMeta(p, p.id ? new Map([[p.id, reviews]]) : null), frozen: view.frozen,
        ...shaped(view, access, reviews),
        sees_values: access.sees_values, sees_sales: access.sees_sales, can_manage: access.can_manage,
        can_close: access.can_manage && !!p.id && p.status === 'open',
        can_reopen: access.can_manage && !!p.id && p.status === 'closed',
        can_review: access.can_manage && !!p.id,
      }
    })
  })

  app.get('/venues/:venueId/variance/items/:itemId', { preHandler: canView }, async req => {
    const q = z.object({ period: z.string().max(40).optional() }).parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const [item] = await tx`SELECT id, name, base_unit FROM inv_items WHERE id = ${req.params.itemId} AND tenant_id = ${req.tenantId}`
      if (!item) throw httpError(404, 'Inventory item not found')
      const p = await pickPeriod(tx, req.tenantId, venueId, q.period)
      // A closed period's row is its frozen one; the evidence is read now.
      let row = p.status === 'closed' && p.figures ? (p.figures.rows || []).find(r => r.item_id === item.id) : null
      if (!row) row = (await periodFigures(tx, req.tenantId, p, { itemIds: [item.id], sales: false })).rows[0] || null
      const facts = await itemFacts(tx, req.tenantId, p, item, row || {})
      const evidence = explainVariance({ ...facts, sees_values: access.sees_values })
      const moves = await loadStockMoves(tx, req.tenantId, { venueIds: [venueId], itemIds: [item.id], to: p.to_at || new Date() })
      const intervals = keyIntervals({ moves, from: p.from_at, to: p.to_at || null, price: row?.price ?? null })
      const reviews = p.id ? (await loadReviews(tx, req.tenantId, [p.id])).get(p.id) || new Map() : new Map()
      const clean = r => {
        let out = r
        if (!access.sees_values) out = strip(out, MONEY)
        if (!access.sees_sales) out = strip(out, ['share_pct'])
        return out
      }
      return {
        item, period: periodMeta(p), row: row ? clean({ ...row, reviewed: reviews.get(item.id) || null }) : null,
        evidence, intervals: intervals.length > 1 ? intervals.map(clean) : [],
        sees_values: access.sees_values, can_review: access.can_manage && !!p.id,
      }
    })
  })

  app.get('/venues/:venueId/variance/key', { preHandler: canView }, async req => {
    const q = z.object({ from: Day.optional(), to: Day.optional() }).parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const { today, timezone } = await venueToday(tx, req.tenantId, venueId)
      const to = q.to || today
      const from = q.from || addDays(to, -13)
      if (from > to) throw httpError(422, 'The first day is after the last', { code: 'range' })
      if ((Date.parse(to) - Date.parse(from)) / DAY + 1 > KEY_MAX_DAYS) throw httpError(422, 'Show up to ' + KEY_MAX_DAYS + ' days at a time', { code: 'range' })
      const [r] = await tx`
        SELECT (${from}::date::timestamp AT TIME ZONE ${timezone}) AS from_at, ((${to}::date + 1)::timestamp AT TIME ZONE ${timezone}) AS to_at`
      const items = await keyFigures(tx, req.tenantId, venueId, { from: r.from_at, to: new Date(Math.min(Date.now(), new Date(r.to_at).getTime())) })
      const settings = await loadBand(tx, req.tenantId)
      return {
        from, to,
        items: items.map(i => ({
          ...i,
          intervals: i.intervals.map(x => {
            const out = { ...x, flagged: itemFlag(x, settings).flagged }
            return access.sees_values ? out : strip(out, MONEY)
          }),
        })),
        sees_values: access.sees_values,
      }
    })
  })

  app.get('/variance/by-venue', { preHandler: canView }, async req => {
    const q = z.object({ item: Id, which: z.enum(['latest', 'current']).optional() }).parse(req.query || {})
    const access = await stockAccess(req)
    const which = q.which || 'latest'
    return withTenant(req.tenantId, async tx => {
      const [item] = await tx`SELECT id, name, base_unit FROM inv_items WHERE id = ${q.item} AND tenant_id = ${req.tenantId}`
      if (!item) throw httpError(404, 'Inventory item not found')
      const venues = await tx`SELECT id, name FROM venues WHERE tenant_id = ${req.tenantId} AND is_active ORDER BY lower(name)`
      const settings = await loadBand(tx, req.tenantId)
      const out = []
      for (const v of venues) {
        const p = which === 'current'
          ? await currentPeriod(tx, req.tenantId, v.id)
          : (await venuePeriods(tx, req.tenantId, v.id, { limit: 1 }))[0] || null
        if (!p) { out.push({ venue_id: v.id, venue: v.name, period: null, row: null }); continue }
        let row = null
        let net = null
        if (p.status === 'closed' && p.figures) {
          row = (p.figures.rows || []).find(r => r.item_id === item.id) || null
          net = p.figures.food_cost?.net_food_pence ?? null
        } else {
          const f = await periodFigures(tx, req.tenantId, p, { itemIds: [item.id], settings, sales: access.sees_sales })
          row = f.rows[0] || null
          net = f.food_cost?.net_food_pence ?? null
        }
        if (row) row = { ...row, flagged: itemFlag(row, settings).flagged, share_pct: net == null ? null : costShare(row.unexplained_value, net) }
        let shown = row
        if (shown && !access.sees_values) shown = strip(shown, MONEY)
        if (shown && !access.sees_sales) shown = strip(shown, ['share_pct'])
        out.push({ venue_id: v.id, venue: v.name, period: periodMeta(p), row: shown })
      }
      // Which site loses most: the biggest unexplained loss in pounds first (by quantity without Costing view).
      const by = r => (r.row ? (access.sees_values ? r.row.unexplained_value : r.row.unexplained) ?? -Infinity : -Infinity)
      out.sort((a, b) => by(b) - by(a) || a.venue.localeCompare(b.venue))
      return { item, which, venues: out, sees_values: access.sees_values, sees_sales: access.sees_sales }
    })
  })

  app.post('/periods/:id/close', { preHandler: canManage }, async req => {
    const access = await stockAccess(req)
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      const p = await loadPeriod(tx, req.tenantId, req.params.id, { lock: true })
      if (!p) throw httpError(404, 'Stock period not found')
      const problem = venueProblem(req, p.venue_id)
      if (problem) throw httpError(403, problem)
      if (p.status === 'closed') throw httpError(409, 'This period is closed already', { code: 'period_status', status: p.status })
      const view = await periodFigures(tx, req.tenantId, p)
      const days = await periodDays(tx, req.tenantId, p)
      const frozen = { rows: view.rows, totals: view.totals, food_cost: view.food_cost, band: view.band, flagged: view.flagged, settings: view.settings, sales: view.sales, worked_at: view.worked_at }
      const entry = { action: 'closed', by: me, at: new Date().toISOString(), note: null }
      const [row] = await tx`
        UPDATE stock_periods SET status = 'closed', figures = ${tx.json(frozen)}, days_from = ${days.from}, days_to = ${days.to},
               closed_by = ${me}, closed_at = now(), history = history || ${tx.json([entry])}, updated_at = now()
         WHERE id = ${p.id} AND tenant_id = ${req.tenantId}
        RETURNING id`
      const closed = await loadPeriod(tx, req.tenantId, row.id)
      return { period: periodMeta(closed, new Map()), frozen: true, ...shaped(frozen, access) }
    })
  })

  app.post('/periods/:id/reopen', { preHandler: canManage }, async req => {
    const b = ReopenBody.parse(req.body || {})
    const access = await stockAccess(req)
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      const p = await loadPeriod(tx, req.tenantId, req.params.id, { lock: true })
      if (!p) throw httpError(404, 'Stock period not found')
      const problem = venueProblem(req, p.venue_id)
      if (problem) throw httpError(403, problem)
      if (p.status !== 'closed') throw httpError(409, 'This period is open already', { code: 'period_status', status: p.status })
      const [later] = await tx`
        SELECT id FROM stock_periods WHERE tenant_id = ${req.tenantId} AND venue_id = ${p.venue_id} AND status = 'closed' AND id <> ${p.id} AND from_at >= ${p.to_at} LIMIT 1`
      if (later) throw httpError(409, 'A later period at this venue is closed: reopen that one first', { code: 'later_closed' })
      // Its days are worked out again from the sales, late ones in them, so what landed late elsewhere comes back here.
      const lease = await claimVenue(tx, req.tenantId, p.venue_id)
      if (!lease) throw httpError(409, 'Usage is being worked out for this venue right now: try again in a minute', { code: 'running' })
      if (p.days_from) {
        await tx`DELETE FROM stock_usage_late WHERE tenant_id = ${req.tenantId} AND venue_id = ${p.venue_id} AND day BETWEEN ${p.days_from}::date AND ${p.days_to}::date`
      }
      const entry = { action: 'reopened', by: me, at: new Date().toISOString(), note: b.note }
      await tx`
        UPDATE stock_periods SET status = 'open', figures = NULL, days_from = NULL, days_to = NULL,
               reopened_by = ${me}, reopened_at = now(), reopen_note = ${b.note}, history = history || ${tx.json([entry])}, updated_at = now()
         WHERE id = ${p.id} AND tenant_id = ${req.tenantId}`
      let worked = 0
      if (p.days_from) {
        const { today } = await venueToday(tx, req.tenantId, p.venue_id)
        const days = daysBetween(p.days_from, p.days_to < today ? p.days_to : today)
        worked = (await computeDays(tx, req.tenantId, p.venue_id, days)).days
      }
      await releaseVenue(tx, req.tenantId, p.venue_id, { ran: false })
      const open = await loadPeriod(tx, req.tenantId, p.id)
      const view = await periodFigures(tx, req.tenantId, open)
      return { period: periodMeta(open), frozen: false, days_worked: worked, ...shaped(view, access) }
    })
  })

  app.post('/periods/:id/items/:itemId/review', { preHandler: canManage }, async req => {
    const b = ReviewBody.parse(req.body || {})
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      const p = await loadPeriod(tx, req.tenantId, req.params.id)
      if (!p) throw httpError(404, 'Stock period not found')
      const problem = venueProblem(req, p.venue_id)
      if (problem) throw httpError(403, problem)
      const [item] = await tx`SELECT id FROM inv_items WHERE id = ${req.params.itemId} AND tenant_id = ${req.tenantId}`
      if (!item) throw httpError(404, 'Inventory item not found')
      if (b.reviewed) {
        const [r] = await tx`
          INSERT INTO stock_variance_reviews (tenant_id, period_id, item_id, reviewed_by, reviewed_at, note)
          VALUES (${req.tenantId}, ${p.id}, ${item.id}, ${me}, now(), ${b.note || null})
          ON CONFLICT (period_id, item_id) DO UPDATE SET reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), note = EXCLUDED.note
          RETURNING reviewed_by AS by, reviewed_at AS at, note`
        return { item_id: item.id, reviewed: r }
      }
      await tx`DELETE FROM stock_variance_reviews WHERE tenant_id = ${req.tenantId} AND period_id = ${p.id} AND item_id = ${item.id}`
      return { item_id: item.id, reviewed: null }
    })
  })

  app.put('/variance-settings', { preHandler: canManage }, async req => {
    const b = BandBody.parse(req.body || {})
    const problem = settingsProblem(b)
    if (problem) throw httpError(422, problem, { code: 'band' })
    const me = await who(req)
    return withTenant(req.tenantId, async tx => {
      await tx`
        INSERT INTO stock_settings (tenant_id, variance_band_pct, variance_item_pct, variance_item_pounds, updated_at, updated_by)
        VALUES (${req.tenantId}, ${b.band_pct}, ${b.item_pct}, ${b.item_pounds}, now(), ${me})
        ON CONFLICT (tenant_id) DO UPDATE SET variance_band_pct = EXCLUDED.variance_band_pct, variance_item_pct = EXCLUDED.variance_item_pct,
          variance_item_pounds = EXCLUDED.variance_item_pounds, updated_at = now(), updated_by = EXCLUDED.updated_by`
      return varianceSettings(await loadBand(tx, req.tenantId))
    })
  })
}
