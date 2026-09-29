// src/routes/orders.js
//
// Admin web-ordering API (migration 122). Mounted at /api/orders.
// Modules: web_orders (handle orders, sold out, pause) and
// web_ordering_setup (ordering settings).
//
//   GET    /gateways                         payment gateways the platform knows
//   GET    /settings/:venueId                ordering settings (+ menus to pick from)
//   PUT    /settings/:venueId                save ordering settings
//   POST   /pause/:venueId                   pause / resume taking orders
//   GET    /availability/:venueId            orderable dishes with sold-out state
//   PUT    /availability/:venueId/:itemId    { sold_out: 'today' | 'indefinite' | false }
//   GET    /report?venue_id=&from=&to=       totals, by day, by payment, top dishes
//   GET    /?venue_id=&date=&include_unpaid= orders for a day
//   GET    /:id                              one order with its events and payments
//   POST   /:id/status                       { to, reason?, prep_minutes? }
//   POST   /:id/promised                     { promised_at }
//   POST   /:id/mark-paid                    { method: 'cash' | 'card_terminal' }
//   POST   /:id/refund                       { amount_pence?, reason? }

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { listGateways, COUNTER_METHODS } from '../services/paymentGateways/index.js'
import {
  loadSettings, loadOrderingMenu, loadAdminOrder, adminOrder, localParts, addDays,
  changeStatus, changePromisedTime, markPaid, refundOrder,
} from '../services/orderSvc.js'
import { broadcast } from '../config/ws.js'
import { isScheduled, scheduleProblem } from '../../../shared/menuSchedule.js'

const uuid = z.string().uuid()
const hm = z.string().regex(/^\d{2}:\d{2}$/)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// shared/menuSchedule.js has the rules; migration 130.
const MenuSchedule = z.object({
  from:  ymd.nullable().optional(),
  until: ymd.nullable().optional(),
  times: z.array(z.object({
    days:  z.array(z.number().int().min(0).max(6)).max(7),
    start: hm,
    end:   hm,
  })).max(14).default([]),
})

const SettingsBody = z.object({
  is_enabled:              z.boolean(),
  is_paused:               z.boolean().default(false),
  pause_message:           z.string().max(300).nullable().optional(),
  hours: z.array(z.object({
    day:     z.number().int().min(0).max(6),
    windows: z.array(z.object({ open: hm, close: hm })).max(6).default([]),
  })).max(7),
  menu_ids:                z.array(uuid).max(20).default([]),
  menu_schedules:          z.record(uuid, MenuSchedule).default({}),
  allow_asap:              z.boolean().default(true),
  lead_time_mins:          z.number().int().min(0).max(240),
  slot_interval_mins:      z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  max_orders_per_slot:     z.number().int().min(1).max(500).nullable(),
  max_days_ahead:          z.number().int().min(0).max(14),
  min_order_pence:         z.number().int().min(0).max(1000000),
  auto_accept:             z.boolean().default(false),
  default_vat_rate_takeaway: z.number().min(0).max(100),
  default_vat_rate_eat_in:   z.number().min(0).max(100),
  tips_enabled:            z.boolean().default(false),
  tip_percents:            z.array(z.number().int().min(1).max(50)).max(5).default([10, 12, 15]),
  payment_methods:         z.array(z.string().max(40)).min(1).max(10),
  collection_instructions: z.string().max(1000).nullable().optional(),
  confirmation_note:       z.string().max(1000).nullable().optional(),
})

const StatusBody = z.object({
  to:           z.enum(['accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled']),
  reason:       z.string().max(300).nullable().optional(),
  prep_minutes: z.number().int().min(0).max(240).nullable().optional(),
})

const actorOf = req => req.user?.email || req.user?.sub || 'staff'

async function venueOf(tx, venueId) {
  const [v] = await tx`SELECT id, tenant_id, name, timezone, currency FROM venues WHERE id = ${venueId}`
  if (!v) throw httpError(404, 'Venue not found')
  return v
}

export default async function ordersRoutes(app) {
  app.addHook('preHandler', requireAuth)

  const view = requirePermission('web_orders', 'view')
  const manage = requirePermission('web_orders', 'manage')
  const setupView = requirePermission('web_ordering_setup', 'view')
  const setupManage = requirePermission('web_ordering_setup', 'manage')

  app.get('/gateways', { preHandler: setupView }, async () => ({
    gateways: listGateways(),
    counter_methods: Object.entries(COUNTER_METHODS).map(([key, label]) => ({ key, label })),
  }))

  // ── Settings ─────────────────────────────────────────────

  app.get('/settings/:venueId', { preHandler: setupView }, async (req) => {
    if (!uuid.safeParse(req.params.venueId).success) throw httpError(404, 'Venue not found')
    return withTenant(req.tenantId, async tx => {
      await venueOf(tx, req.params.venueId)
      const settings = await loadSettings(tx, req.params.venueId, { withDefaultHours: true })
      const menus = await tx`
        SELECT id, name, venue_id, is_published FROM menus
         WHERE tenant_id = ${req.tenantId} AND (venue_id IS NULL OR venue_id = ${req.params.venueId})
         ORDER BY sort_order, name
      `
      return { settings, menus, gateways: listGateways() }
    })
  })

  app.put('/settings/:venueId', { preHandler: setupManage }, async (req) => {
    if (!uuid.safeParse(req.params.venueId).success) throw httpError(404, 'Venue not found')
    const b = SettingsBody.parse(req.body)
    const known = new Set(listGateways().map(g => g.key))
    const methods = [...new Set(b.payment_methods)].filter(k => known.has(k))
    if (!methods.length) throw httpError(400, 'Choose at least one payment method')
    for (const d of b.hours) {
      for (const w of d.windows) {
        if (w.close < w.open) throw httpError(400, 'An ordering window closes before it opens')
      }
    }
    // Keep only schedules of chosen menus, and only ones that say something.
    const schedules = {}
    for (const id of b.menu_ids) {
      const sc = b.menu_schedules[id]
      if (!isScheduled(sc)) continue
      schedules[id] = { from: sc.from || null, until: sc.until || null,
        times: sc.times.map(t => ({ days: [...new Set(t.days)].sort(), start: t.start, end: t.end })) }
    }
    const row = await withTenant(req.tenantId, async tx => {
      const venue = await venueOf(tx, req.params.venueId)
      if (Object.keys(schedules).length) {
        const menus = await tx`SELECT id, name FROM menus WHERE id = ANY(${Object.keys(schedules)}::uuid[])`
        const today = localParts(new Date(), venue.timezone || 'Europe/London').date
        const problem = scheduleProblem(b.menu_ids, schedules, Object.fromEntries(menus.map(m => [m.id, m.name])), today)
        if (problem) throw httpError(422, problem)
      }
      const [s] = await tx`
        INSERT INTO ordering_settings (venue_id, tenant_id, is_enabled, is_paused, pause_message, hours, menu_ids, menu_schedules,
                                       allow_asap, lead_time_mins, slot_interval_mins, max_orders_per_slot, max_days_ahead,
                                       min_order_pence, auto_accept, default_vat_rate_takeaway, default_vat_rate_eat_in,
                                       tips_enabled, tip_percents,
                                       payment_methods, collection_instructions, confirmation_note)
        VALUES (${req.params.venueId}, ${req.tenantId}, ${b.is_enabled}, ${b.is_paused}, ${b.pause_message ?? null},
                ${tx.json(b.hours)}, ${b.menu_ids}::uuid[], ${tx.json(schedules)},
                ${b.allow_asap}, ${b.lead_time_mins}, ${b.slot_interval_mins}, ${b.max_orders_per_slot}, ${b.max_days_ahead},
                ${b.min_order_pence}, ${b.auto_accept}, ${b.default_vat_rate_takeaway}, ${b.default_vat_rate_eat_in},
                ${b.tips_enabled}, ${b.tip_percents}::int[],
                ${methods}::text[], ${b.collection_instructions ?? null}, ${b.confirmation_note ?? null})
        ON CONFLICT (venue_id) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled, is_paused = EXCLUDED.is_paused, pause_message = EXCLUDED.pause_message,
          hours = EXCLUDED.hours, menu_ids = EXCLUDED.menu_ids, menu_schedules = EXCLUDED.menu_schedules, allow_asap = EXCLUDED.allow_asap,
          lead_time_mins = EXCLUDED.lead_time_mins, slot_interval_mins = EXCLUDED.slot_interval_mins,
          max_orders_per_slot = EXCLUDED.max_orders_per_slot, max_days_ahead = EXCLUDED.max_days_ahead,
          min_order_pence = EXCLUDED.min_order_pence, auto_accept = EXCLUDED.auto_accept,
          default_vat_rate_takeaway = EXCLUDED.default_vat_rate_takeaway,
          default_vat_rate_eat_in = EXCLUDED.default_vat_rate_eat_in, tips_enabled = EXCLUDED.tips_enabled,
          tip_percents = EXCLUDED.tip_percents, payment_methods = EXCLUDED.payment_methods,
          collection_instructions = EXCLUDED.collection_instructions, confirmation_note = EXCLUDED.confirmation_note,
          updated_at = now()
        RETURNING *
      `
      return s
    })
    broadcast(req.params.venueId, { type: 'ordering.settings', data: { is_paused: row.is_paused, is_enabled: row.is_enabled } })
    return row
  })

  // Staff can pause from the orders board without setup rights.
  app.post('/pause/:venueId', { preHandler: manage }, async (req) => {
    const b = z.object({ paused: z.boolean(), message: z.string().max(300).nullable().optional() }).parse(req.body)
    const row = await withTenant(req.tenantId, async tx => {
      await venueOf(tx, req.params.venueId)
      const [s] = await tx`
        INSERT INTO ordering_settings (venue_id, tenant_id, is_paused, pause_message)
        VALUES (${req.params.venueId}, ${req.tenantId}, ${b.paused}, ${b.message ?? null})
        ON CONFLICT (venue_id) DO UPDATE SET
          is_paused = EXCLUDED.is_paused,
          pause_message = COALESCE(EXCLUDED.pause_message, ordering_settings.pause_message),
          updated_at = now()
        RETURNING is_paused, pause_message, is_enabled
      `
      return s
    })
    broadcast(req.params.venueId, { type: 'ordering.settings', data: row })
    return row
  })

  // ── Sold out ─────────────────────────────────────────────

  app.get('/availability/:venueId', { preHandler: view }, async (req) => {
    return withTenant(req.tenantId, async tx => {
      const venue = await venueOf(tx, req.params.venueId)
      const settings = await loadSettings(tx, venue.id)
      const menu = await loadOrderingMenu(tx, venue, settings)
      const rows = await tx`
        SELECT item_id, sold_out_until FROM ordering_item_availability
         WHERE venue_id = ${venue.id} AND (sold_out_until IS NULL OR sold_out_until > now())
      `
      const until = Object.fromEntries(rows.map(r => [r.item_id, r.sold_out_until]))
      return {
        menus: menu.menus.map(m => ({
          id: m.id, name: m.name,
          sections: m.sections.map(s => ({
            id: s.id, title: s.title,
            items: s.items.map(i => ({ id: i.id, name: i.name, sold_out: i.sold_out, sold_out_until: until[i.id] ?? null })),
          })),
        })),
      }
    })
  })

  app.put('/availability/:venueId/:itemId', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.itemId).success) throw httpError(404, 'Dish not found')
    const b = z.object({ sold_out: z.union([z.literal('today'), z.literal('indefinite'), z.literal(false)]) }).parse(req.body)
    const res = await withTenant(req.tenantId, async tx => {
      const venue = await venueOf(tx, req.params.venueId)
      if (b.sold_out === false) {
        await tx`DELETE FROM ordering_item_availability WHERE venue_id = ${venue.id} AND item_id = ${req.params.itemId}`
        return { sold_out: false, sold_out_until: null }
      }
      // "Today" = until the next local midnight.
      let until = null
      if (b.sold_out === 'today') {
        const today = localParts(new Date(), venue.timezone).date
        const [{ ts }] = await tx`SELECT ((${addDays(today, 1)}::date)::timestamp AT TIME ZONE ${venue.timezone}) AS ts`
        until = ts
      }
      await tx`
        INSERT INTO ordering_item_availability (venue_id, item_id, tenant_id, sold_out_until)
        VALUES (${venue.id}, ${req.params.itemId}, ${req.tenantId}, ${until})
        ON CONFLICT (venue_id, item_id) DO UPDATE SET sold_out_until = EXCLUDED.sold_out_until, updated_at = now()
      `
      return { sold_out: true, sold_out_until: until }
    })
    broadcast(req.params.venueId, { type: 'ordering.availability', data: { item_id: req.params.itemId, ...res } })
    return res
  })

  // ── Report ───────────────────────────────────────────────

  app.get('/report', { preHandler: view }, async (req) => {
    const q = z.object({
      venue_id: uuid,
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const counted = ['placed', 'accepted', 'preparing', 'ready', 'completed']
      const [days, byMethod, top, statuses] = await Promise.all([
        tx`
          SELECT service_date::text AS date, count(*)::int AS orders,
                 COALESCE(sum(total_pence), 0)::int AS total_pence,
                 COALESCE(sum(tip_pence), 0)::int AS tip_pence,
                 COALESCE(sum(vat_pence), 0)::int AS vat_pence,
                 COALESCE(sum(refunded_pence), 0)::int AS refunded_pence,
                 COALESCE(sum(platform_fee_pence), 0)::int AS platform_fee_pence
            FROM orders
           WHERE venue_id = ${q.venue_id} AND service_date BETWEEN ${q.from} AND ${q.to}
             AND status = ANY(${counted})
           GROUP BY service_date ORDER BY service_date
        `,
        tx`
          SELECT p.gateway AS method, count(DISTINCT p.order_id)::int AS orders,
                 COALESCE(sum(p.amount_pence), 0)::int AS paid_pence,
                 COALESCE(sum(p.refunded_pence), 0)::int AS refunded_pence
            FROM order_payments p JOIN orders o ON o.id = p.order_id
           WHERE o.venue_id = ${q.venue_id} AND o.service_date BETWEEN ${q.from} AND ${q.to}
             AND p.status IN ('succeeded', 'partially_refunded', 'refunded')
           GROUP BY p.gateway ORDER BY paid_pence DESC
        `,
        tx`
          SELECT i.name, sum(i.qty)::int AS qty, sum(i.line_total_pence)::int AS total_pence
            FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE o.venue_id = ${q.venue_id} AND o.service_date BETWEEN ${q.from} AND ${q.to}
             AND o.status = ANY(${counted})
           GROUP BY i.name ORDER BY qty DESC, total_pence DESC LIMIT 15
        `,
        tx`
          SELECT status, count(*)::int AS n FROM orders
           WHERE venue_id = ${q.venue_id} AND service_date BETWEEN ${q.from} AND ${q.to}
           GROUP BY status
        `,
      ])
      const totals = days.reduce((t, d) => ({
        orders: t.orders + d.orders, total_pence: t.total_pence + d.total_pence,
        tip_pence: t.tip_pence + d.tip_pence, vat_pence: t.vat_pence + d.vat_pence,
        refunded_pence: t.refunded_pence + d.refunded_pence,
        platform_fee_pence: t.platform_fee_pence + d.platform_fee_pence,
      }), { orders: 0, total_pence: 0, tip_pence: 0, vat_pence: 0, refunded_pence: 0, platform_fee_pence: 0 })
      totals.average_pence = totals.orders ? Math.round(totals.total_pence / totals.orders) : 0
      return { totals, days, by_method: byMethod, top_items: top, statuses: Object.fromEntries(statuses.map(s => [s.status, s.n])) }
    })
  })

  // ── Orders ───────────────────────────────────────────────

  app.get('/', { preHandler: view }, async (req) => {
    const q = z.object({
      venue_id: uuid,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      include_unpaid: z.enum(['0', '1']).optional(),
    }).parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const venue = await venueOf(tx, q.venue_id)
      const date = q.date || localParts(new Date(), venue.timezone).date
      const hideUnpaid = q.include_unpaid !== '1'
      const orders = await tx`
        SELECT *, service_date::text AS service_date FROM orders
         WHERE venue_id = ${venue.id} AND service_date = ${date}
           AND (${!hideUnpaid} OR status NOT IN ('pending_payment', 'expired'))
         ORDER BY promised_at, order_number
      `
      const ids = orders.map(o => o.id)
      const items = ids.length
        ? await tx`SELECT * FROM order_items WHERE order_id = ANY(${ids}::uuid[]) ORDER BY sort_order`
        : []
      const byOrder = {}
      for (const i of items) (byOrder[i.order_id] ||= []).push(i)
      const settings = await loadSettings(tx, venue.id)
      return {
        date,
        venue: { id: venue.id, name: venue.name, timezone: venue.timezone },
        ordering: { is_enabled: settings.is_enabled, is_paused: settings.is_paused, pause_message: settings.pause_message },
        orders: orders.map(o => adminOrder(o, byOrder[o.id] || [])),
      }
    })
  })

  app.get('/:id', { preHandler: view }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Order not found')
    const o = await withTenant(req.tenantId, tx => loadAdminOrder(tx, req.params.id))
    if (!o) throw httpError(404, 'Order not found')
    return o
  })

  const reload = async (req, id) => withTenant(req.tenantId, tx => loadAdminOrder(tx, id))

  app.post('/:id/status', { preHandler: manage }, async (req) => {
    if (!uuid.safeParse(req.params.id).success) throw httpError(404, 'Order not found')
    const b = StatusBody.parse(req.body)
    const res = await changeStatus(req.tenantId, req.params.id, b.to, {
      actor: actorOf(req), reason: b.reason ?? null, prepMinutes: b.prep_minutes ?? null,
    })
    return { order: await reload(req, req.params.id), refund: res.refund }
  })

  app.post('/:id/promised', { preHandler: manage }, async (req) => {
    const b = z.object({ promised_at: z.string().datetime() }).parse(req.body)
    await changePromisedTime(req.tenantId, req.params.id, { promisedAt: b.promised_at, actor: actorOf(req) })
    return reload(req, req.params.id)
  })

  app.post('/:id/mark-paid', { preHandler: manage }, async (req) => {
    const b = z.object({ method: z.enum(Object.keys(COUNTER_METHODS)) }).parse(req.body)
    await markPaid(req.tenantId, req.params.id, { method: b.method, actor: actorOf(req) })
    return reload(req, req.params.id)
  })

  app.post('/:id/refund', { preHandler: manage }, async (req) => {
    const b = z.object({
      amount_pence: z.number().int().min(1).nullable().optional(),
      reason: z.string().max(300).nullable().optional(),
    }).parse(req.body)
    await refundOrder(req.tenantId, req.params.id, { amountPence: b.amount_pence ?? null, reason: b.reason ?? null, actor: actorOf(req) })
    return reload(req, req.params.id)
  })
}
