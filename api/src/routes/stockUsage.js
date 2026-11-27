// src/routes/stockUsage.js
//
// Usage from sales (inventory phase 5, migration 311; docs/INVENTORY.md 7),
// mounted at /api/stock by src/areas/stock.js. What sales took off stock at
// a venue, by day and item with each channel's part, and the sold dishes
// that couldn't be costed with why and how to fix it; a manual Recompute.
// The work itself is services/stockUsageSvc.js (the job does it every few
// minutes).
//
//   GET  /venues/:venueId/usage?from=&to=     (Stock view; values with Costing view)
//        days (YYYY-MM-DD, at most RECOMPUTE_MAX_DAYS; the last 7 up to today
//        when left out): { from, to, today, last_run_at, last_error,
//        dirty_from, up_to (sales taken off up to then), note, days: [{ day,
//        lines, uncosted_lines, computed_at, last_sale_at }], items: [{ item_id,
//        name, base_unit, qty_base, channels, value? }], by_day: [{ day,
//        item_id, qty_base, channels, value? }], uncosted: [{ dish_id, name,
//        channels, qty, uncosted_qty, gaps: [{ reason, text, fix }], days }],
//        left_out: [{ name, reason, qty }], dishes: [{ dish_id, name, qty,
//        uncosted_qty, channels, cost? }] (every dish sold), can_recompute }
//   POST /venues/:venueId/usage/recompute     { from, to } (Stock manage): those
//        days worked out again now (at most RECOMPUTE_MAX_DAYS, none after
//        today; closed days left alone); 409 while the job is working the
//        venue out

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { salesTakenOff, salesNote } from '../services/stockSvc.js'
import {
  venueToday, daysBetween, runVenueUsage, claimVenue, releaseVenue, RECOMPUTE_MAX_DAYS,
} from '../services/stockUsageSvc.js'
import { stockAccess } from './stock.js'

const canView = requirePermission('stock', 'view')
const canManage = requirePermission('stock', 'manage')
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const RecomputeBody = z.object({ from: Day, to: Day }).strict()

const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
const span = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1
const money = n => (n == null ? null : Math.round(n * 100) / 100)

export default async function stockUsageRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireOwnVenue('venueId'))

  app.get('/venues/:venueId/usage', { preHandler: canView }, async req => {
    const q = z.object({ from: Day.optional(), to: Day.optional() }).parse(req.query || {})
    const access = await stockAccess(req)
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const { today, timezone } = await venueToday(tx, req.tenantId, venueId)
      const to = q.to || today
      const from = q.from || addDays(to, -6)
      if (from > to) throw httpError(422, 'The first day is after the last', { code: 'range' })
      if (span(from, to) > RECOMPUTE_MAX_DAYS) throw httpError(422, 'Show up to ' + RECOMPUTE_MAX_DAYS + ' days at a time', { code: 'range' })
      const [state, marks, rows, dishes, taken] = await Promise.all([
        tx`SELECT last_run_at, last_error, dirty_from::text AS dirty_from FROM stock_usage_venues WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId}`,
        tx`SELECT day::text AS day, lines, uncosted_lines, computed_at, last_sale_at FROM stock_usage_marks
            WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND day BETWEEN ${from}::date AND ${to}::date ORDER BY day`,
        tx`SELECT u.day::text AS day, u.item_id, i.name, i.base_unit, u.qty_base::float8 AS qty_base, u.cost_per_base::float8 AS cost_per_base, u.channels
             FROM stock_usage_days u JOIN inv_items i ON i.id = u.item_id AND i.tenant_id = u.tenant_id
            WHERE u.tenant_id = ${req.tenantId} AND u.venue_id = ${venueId} AND u.day BETWEEN ${from}::date AND ${to}::date
            ORDER BY u.day, lower(i.name)`,
        tx`SELECT d.day::text AS day, d.channel, d.dish_id, d.name, d.qty::float8 AS qty, d.uncosted_qty::float8 AS uncosted_qty,
                  d.left_out, d.gaps, d.recipe_name, d.cost::float8 AS cost
             FROM dish_cost_days d
            WHERE d.tenant_id = ${req.tenantId} AND d.venue_id = ${venueId} AND d.day BETWEEN ${from}::date AND ${to}::date`,
        salesTakenOff(tx, req.tenantId, [venueId]),
      ])
      const items = new Map()
      const byDay = rows.map(r => {
        const it = items.get(r.item_id) || items.set(r.item_id, { item_id: r.item_id, name: r.name, base_unit: r.base_unit, qty_base: 0, channels: {}, value: 0, unvalued: false }).get(r.item_id)
        it.qty_base += r.qty_base
        for (const [k, v] of Object.entries(r.channels || {})) it.channels[k] = Math.round(((it.channels[k] || 0) + Number(v)) * 10000) / 10000
        const value = r.cost_per_base == null ? null : r.qty_base * r.cost_per_base
        if (value == null) it.unvalued = true
        else it.value += value
        return {
          day: r.day, item_id: r.item_id, name: r.name, base_unit: r.base_unit, qty_base: r.qty_base, channels: r.channels || {},
          ...(access.sees_values ? { value: money(value) } : {}),
        }
      })
      const itemList = [...items.values()].map(i => ({
        item_id: i.item_id, name: i.name, base_unit: i.base_unit, qty_base: Math.round(i.qty_base * 10000) / 10000, channels: i.channels,
        ...(access.sees_values ? { value: i.unvalued && !i.value ? null : money(i.value), unvalued: i.unvalued } : {}),
      })).sort((a, b) => (access.sees_values ? (b.value || 0) - (a.value || 0) : 0) || a.name.localeCompare(b.name))
      // Sold dishes that took nothing (or not all) off: by dish, with what was missing and how to fix it.
      const unc = new Map()
      const left = new Map()
      const sold = new Map()
      for (const d of dishes) {
        // Every dish sold, with each channel's units (and, with Costing view, its theoretical cost).
        const sk = d.dish_id || 'name:' + d.name.toLowerCase()
        const s = sold.get(sk) || sold.set(sk, { dish_id: d.dish_id, name: d.name, recipe_name: d.recipe_name, qty: 0, uncosted_qty: 0, channels: {}, cost: 0, costed: false }).get(sk)
        s.qty += d.qty
        s.uncosted_qty += d.uncosted_qty
        s.channels[d.channel] = (s.channels[d.channel] || 0) + d.qty
        if (d.cost != null) { s.cost += d.cost; s.costed = true }
        if (!d.left_out && !(d.uncosted_qty > 0)) continue
        if (d.left_out) {
          const k = d.left_out + '|' + d.name.toLowerCase()
          const l = left.get(k) || left.set(k, { name: d.name, reason: d.left_out, qty: 0 }).get(k)
          l.qty += d.qty
          continue
        }
        const k = d.dish_id || 'name:' + d.name.toLowerCase()
        const u = unc.get(k) || unc.set(k, { dish_id: d.dish_id, name: d.name, recipe_name: d.recipe_name, channels: [], qty: 0, uncosted_qty: 0, gaps: [], days: [] }).get(k)
        u.qty += d.qty
        u.uncosted_qty += d.uncosted_qty
        if (!u.channels.includes(d.channel)) u.channels.push(d.channel)
        if (!u.days.includes(d.day)) u.days.push(d.day)
        for (const g of d.gaps || []) if (u.gaps.length < 5 && !u.gaps.some(x => x.text === g.text)) u.gaps.push(g)
      }
      const s = state[0] || {}
      return {
        from, to, today, timezone, last_run_at: s.last_run_at ?? null, last_error: s.last_error ?? null, dirty_from: s.dirty_from ?? null,
        up_to: taken[venueId]?.up_to ?? null, note: salesNote(taken[venueId], timezone), sees_values: access.sees_values,
        days: marks, items: itemList, by_day: byDay,
        dishes: [...sold.values()].map(d => ({
          dish_id: d.dish_id, name: d.name, recipe_name: d.recipe_name, qty: d.qty, uncosted_qty: d.uncosted_qty, channels: d.channels,
          ...(access.sees_values ? { cost: d.costed ? money(d.cost) : null } : {}),
        })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)),
        uncosted: [...unc.values()].sort((a, b) => b.uncosted_qty - a.uncosted_qty || a.name.localeCompare(b.name)),
        left_out: [...left.values()].sort((a, b) => b.qty - a.qty),
        can_recompute: access.can_manage, max_days: RECOMPUTE_MAX_DAYS,
      }
    })
  })

  app.post('/venues/:venueId/usage/recompute', { preHandler: canManage }, async req => {
    const b = RecomputeBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const venueId = req.params.venueId
      const { today } = await venueToday(tx, req.tenantId, venueId)
      if (b.from > b.to) throw httpError(422, 'The first day is after the last', { code: 'range' })
      if (b.to > today) throw httpError(422, 'A day after today has no sales yet', { code: 'range' })
      if (span(b.from, b.to) > RECOMPUTE_MAX_DAYS) throw httpError(422, 'Recompute up to ' + RECOMPUTE_MAX_DAYS + ' days at a time', { code: 'range' })
      const lease = await claimVenue(tx, req.tenantId, venueId)
      if (!lease) throw httpError(409, 'Usage is being worked out for this venue right now: try again in a minute', { code: 'running' })
      const r = await runVenueUsage(tx, req.tenantId, venueId, { days: daysBetween(b.from, b.to), force: true })
      await releaseVenue(tx, req.tenantId, venueId)
      return { from: b.from, to: b.to, days: r.days, lines: r.lines, items: r.items, dishes: r.dishes, worked: r.worked }
    })
  })
}
