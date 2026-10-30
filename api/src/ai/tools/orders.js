// src/ai/tools/orders.js
//
// Online orders, sold out, the till and the kitchen, for Pepper (staff
// assistant and staff MCP). Permissions are the pages':
//
//   online_orders          a day's online orders (incl. GloriaFood on the board)   web_orders, view
//   update_online_order    accept / preparing / ready / collected / reject /
//                          cancel / retime / paid at the counter                   web_orders, manage
//   refund_online_order    give money back (all or part)                           web_orders, manage
//   pause_online_orders    stop / start taking online orders                        web_orders, manage
//   online_orders_report   orders, sales, payments, top dishes over dates           web_orders, view
//   sold_out               which dishes are sold out at a venue                     web_orders, view
//   set_sold_out           mark dishes sold out (today / until back) or back on     web_orders, manage
//   till_day               a trading day's till figures (X live, or the Z)          pos_reports, view
//   till_checks            a day's till checks                                       pos_reports, view
//   kitchen_report         speed of service per kitchen station, remakes            pos_reports, view
//
// Reads and writes go through /api/orders and /api/pos (callApi); sold out
// goes through the same route as the orders board, which tells tills, the
// ordering page and the menu screens. The dish list for sold out is the
// venue's live published menus (loadMenuVersions, like the till).

import { z } from 'zod'
import { withTenant } from '../../config/db.js'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { loadMenuVersions } from '../../services/menuReleases.js'
import { soldOutRows } from '../../services/soldOut.js'
import { numberText } from '../../../../shared/pos/numbers.js'
import {
  DateStr, TimeStr, VenueText, venueFor, venueToday, longDate, shortDate, localParts, zonedInstant,
  pence, plural, pickByName, audited,
} from './util.js'

const STATUS_WORD = {
  pending_payment: 'waiting for payment', placed: 'new', accepted: 'accepted', preparing: 'preparing',
  ready: 'ready', completed: 'collected', rejected: 'rejected', cancelled: 'cancelled', expired: 'expired',
}
const OPEN = ['placed', 'accepted', 'preparing', 'ready']

const isGf = o => o.source === 'gloriafood'
const numberOf = o => (isGf(o) ? 'GF ' : '#') + (o.order_number ?? '?')
const guestOf = o => o.guest_name || null
const PAID = { paid: 'paid', refunded: 'refunded', partially_refunded: 'part refunded', pending: 'paying', failed: 'payment failed' }

function orderLine(o, tz, cur) {
  const at = o.promised_at ? localParts(o.promised_at, tz).time : null
  const items = (o.items || []).map(i => (i.qty > 1 ? i.qty + ' x ' : '') + i.name).join(', ')
  return {
    order: numberOf(o),
    status: STATUS_WORD[o.status] || o.status,
    ...(guestOf(o) ? { name: guestOf(o) } : {}),
    ...(at ? { time: at } : {}),
    ...(items ? { items } : {}),
    total: pence(o.total_pence, cur),
    paid: isGf(o) ? (o.paid_online ? 'paid online' : o.payment_label || 'pay on collection') : PAID[o.payment_status] || 'not paid',
    ...(isGf(o) ? { from: 'GloriaFood' + (o.imported ? ' (imported)' : '') } : {}),
    ...(o.notes ? { notes: o.notes } : {}),
    ...(o.allergy_note ? { allergies: o.allergy_note } : {}),
  }
}

async function dayOrders(ctx, venue, date) {
  return callApi(ctx, 'GET', `/api/orders?venue_id=${venue.id}&date=${date}`)
}

/** An order on the day's board by its number ("12", "#12", "GF 3"), else by id. */
async function findOrder(ctx, venue, text, date) {
  const raw = String(text).trim()
  const board = await dayOrders(ctx, venue, date)
  const byId = board.orders.find(o => o.id === raw)
  if (byId) return { order: byId, board }
  const gf = /^gf\s*#?\s*(\d+)$/i.exec(raw)
  const n = /^#?\s*(\d+)$/.exec(raw)
  const hits = board.orders.filter(o => gf ? (isGf(o) && String(o.order_number) === gf[1])
    : n ? String(o.order_number) === n[1] && !isGf(o) : false)
  if (hits.length === 1) return { order: hits[0], board }
  if (!n && !gf) {
    const byName = board.orders.filter(o => (guestOf(o) || '').toLowerCase().includes(raw.toLowerCase()))
    if (byName.length === 1) return { order: byName[0], board }
    if (byName.length > 1) throw new ToolError('More than one order for "' + raw + '": ' + byName.map(numberOf).join(', ') + '.', 409)
  }
  throw new ToolError('No order ' + raw + ' on ' + longDate(date) + '. Orders that day: ' +
    (board.orders.map(numberOf).join(', ') || 'none') + '.', 404)
}

// ── update_online_order ─────────────────────────────────────

const ACTIONS = ['accept', 'preparing', 'ready', 'collected', 'reject', 'cancel', 'retime', 'paid_cash', 'paid_card']
const TO = { accept: 'accepted', preparing: 'preparing', ready: 'ready', collected: 'completed', reject: 'rejected', cancel: 'cancelled' }
const ACTION_WORD = {
  accept: 'Accept', preparing: 'Mark preparing', ready: 'Mark ready', collected: 'Mark collected',
  reject: 'Turn down', cancel: 'Cancel', retime: 'Change the time', paid_cash: 'Paid in cash', paid_card: 'Paid by card at the counter',
}

async function orderPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const date = input.date || venueToday(venue)
  const { order } = await findOrder(ctx, venue, input.order, date)
  const cur = venue.currency
  const lines = [venue.name + ', ' + numberOf(order) + (guestOf(order) ? ' (' + guestOf(order) + ')' : '') + ', ' + pence(order.total_pence, cur)]
  const warnings = []
  let call
  if (isGf(order)) {
    if (!['accept', 'preparing', 'ready', 'collected'].includes(input.action)) {
      throw new ToolError('A GloriaFood order can only be moved on the board here (accept, preparing, ready, collected); anything else is done in GloriaFood.', 422)
    }
    if (order.imported) throw new ToolError('This GloriaFood order was imported from their export: it can be looked at but not moved.', 422)
    call = { path: `/api/orders/gloriafood/${order.id}/status`, body: { to: TO[input.action] } }
    warnings.push('GloriaFood isn\'t told: this only moves it on our board.')
  } else if (TO[input.action]) {
    const to = TO[input.action]
    const allowed = { pending_payment: ['cancelled'], placed: ['accepted', 'rejected', 'cancelled'], accepted: ['preparing', 'ready', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['completed', 'cancelled'] }[order.status] || []
    if (!allowed.includes(to)) throw new ToolError(numberOf(order) + ' is ' + (STATUS_WORD[order.status] || order.status) + ': it can\'t be ' + ACTION_WORD[input.action].toLowerCase() + 'ed.', 409)
    if ((to === 'rejected' || to === 'cancelled') && !input.reason) throw new ToolError('Give a reason: the guest is told.', 422)
    const paid = Number(order.paid_pence || 0) - Number(order.refunded_pence || 0)
    if ((to === 'rejected' || to === 'cancelled') && paid > 0) warnings.push(pence(paid, cur) + ' paid is refunded to the guest.')
    if (to === 'accepted' && input.prep_minutes) lines.push('Ready in ' + input.prep_minutes + ' minutes')
    call = { path: `/api/orders/${order.id}/status`, body: { to, reason: input.reason ?? null, prep_minutes: input.prep_minutes ?? null } }
  } else if (input.action === 'retime') {
    if (!input.time) throw new ToolError('What time (HH:MM)?', 422)
    if (!OPEN.includes(order.status)) throw new ToolError('This order can no longer be retimed.', 409)
    const at = await zonedInstant(order.service_date || date, input.time, venue.timezone)
    lines.push('New time: ' + input.time)
    call = { path: `/api/orders/${order.id}/promised`, body: { promised_at: new Date(at).toISOString() } }
  } else {
    const due = Number(order.total_pence || 0) - Number(order.paid_pence || 0)
    if (due <= 0) throw new ToolError(numberOf(order) + ' is already paid.', 409)
    lines.push(pence(due, cur) + ' taken ' + (input.action === 'paid_cash' ? 'in cash' : 'by card at the counter'))
    call = { path: `/api/orders/${order.id}/mark-paid`, body: { method: input.action === 'paid_cash' ? 'cash' : 'card_terminal' } }
  }
  if (input.reason) lines.push('Reason: ' + input.reason)
  return { venue, date, order, lines, warnings, call }
}

// ── sold out ────────────────────────────────────────────────

/** The venue's live dishes, grouped by name: [{ name, ids, menus, sold_out_until }]. */
async function venueDishes(ctx, venue) {
  return withTenant(ctx.tenantId, async tx => {
    const menus = await loadMenuVersions(tx, ctx.tenantId, { venueId: venue.id, publishedOnly: true })
    const rows = await soldOutRows(tx, ctx.tenantId, venue.id)
    const out = new Map(rows.map(r => [r.item_id, r.sold_out_until]))
    const byName = new Map()
    for (const m of menus) {
      for (const s of m.sections || []) {
        for (const i of s.items || []) {
          const key = String(i.name).trim().toLowerCase()
          if (!byName.has(key)) byName.set(key, { name: i.name, ids: [], menus: new Set(), sold: [], until: [] })
          const d = byName.get(key)
          d.ids.push(i.id); d.menus.add(m.name)
          if (out.has(i.id)) { d.sold.push(i.id); d.until.push(out.get(i.id)) }
        }
      }
    }
    return [...byName.values()].map(d => ({ ...d, menus: [...d.menus] }))
  })
}

const untilText = (until, tz) => (until.some(u => u == null) ? 'until put back'
  : 'until ' + localParts(new Date(Math.max(...until.map(u => new Date(u).getTime()))), tz).time + ' (end of today)')

export const orderTools = [
  {
    name: 'online_orders',
    section: 'orders',
    title: 'Online orders',
    description:
      'A day\'s online orders at a venue (default today): number, status, name, collection time, dishes, total, paid or not, ' +
      'plus GloriaFood orders when they show on the board, and whether online ordering is paused. Open orders first.',
    input: z.object({
      venue: VenueText,
      date: DateStr.optional(),
      only_open: z.boolean().default(false).describe('Only orders still to be made or collected'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'view')
      const venue = await venueFor(ctx, input.venue)
      const date = input.date || venueToday(venue)
      const board = await dayOrders(ctx, venue, date)
      const list = board.orders.filter(o => !input.only_open || OPEN.includes(o.status))
      const open = list.filter(o => OPEN.includes(o.status))
      const rest = list.filter(o => !open.includes(o))
      return {
        venue: venue.name, date, day: longDate(date),
        ordering: board.ordering.is_enabled === false ? 'switched off' : board.ordering.is_paused ? 'paused' + (board.ordering.pause_message ? ' (' + board.ordering.pause_message + ')' : '') : 'taking orders',
        open: open.map(o => orderLine(o, venue.timezone, venue.currency)),
        ...(input.only_open ? {} : { done: rest.map(o => orderLine(o, venue.timezone, venue.currency)) }),
        count: plural(list.length, 'order'),
      }
    },
  },

  {
    name: 'update_online_order',
    section: 'orders',
    title: 'Move an online order',
    description:
      'Moves an online order on the board: accept (with prep_minutes), preparing, ready, collected, reject or cancel (a reason is ' +
      'needed and the guest is told; a paid order is refunded), retime (a new collection time), or record payment taken at the ' +
      'counter (paid_cash, paid_card). The order is its number on the day ("12"), "GF 3" for GloriaFood, or the guest\'s name.',
    input: z.object({
      venue: VenueText,
      order: z.string().trim().min(1).max(100),
      date: DateStr.optional().describe('The order\'s day, default today'),
      action: z.enum(ACTIONS),
      prep_minutes: z.number().int().min(0).max(240).optional(),
      time: TimeStr.optional().describe('retime: the new collection time'),
      reason: z.string().trim().max(300).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      const p = await orderPlan(ctx, input)
      return {
        title: ACTION_WORD[input.action] + ' ' + numberOf(p.order) + '?',
        lines: p.lines,
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: ACTION_WORD[input.action],
        destructive: input.action === 'reject' || input.action === 'cancel',
        pin: { date: p.date, order: p.order.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      return audited(ctx, 'update_online_order', input, async () => {
        const p = await orderPlan(ctx, input)
        const res = await callApi(ctx, 'POST', p.call.path, { body: p.call.body })
        const o = res?.order || res
        return {
          order: numberOf(p.order),
          status: STATUS_WORD[o?.status] || o?.status || null,
          ...(res?.refund?.refunded_pence ? { refunded: pence(res.refund.refunded_pence, p.venue.currency) } : {}),
          ...(res?.refund?.error ? { refund_problem: res.refund.error } : {}),
          message: 'Done.',
        }
      })
    },
  },

  {
    name: 'refund_online_order',
    section: 'orders',
    title: 'Refund an online order',
    description:
      'Gives money back on an online order: all that is left, or an amount. Online payments go back through the payment provider; ' +
      'counter payments are recorded as refunded at the counter.',
    input: z.object({
      venue: VenueText,
      order: z.string().trim().min(1).max(100),
      date: DateStr.optional(),
      amount: z.number().positive().max(100000).optional().describe('In pounds; leave out for everything left'),
      reason: z.string().trim().max(300).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      const p = await refundPlan(ctx, input)
      return {
        title: 'Refund ' + numberOf(p.order) + '?',
        lines: [p.venue.name + ', ' + numberOf(p.order) + (guestOf(p.order) ? ' (' + guestOf(p.order) + ')' : ''),
          'Refund ' + pence(p.amount, p.venue.currency) + ' of ' + pence(p.left, p.venue.currency) + ' paid',
          ...(input.reason ? ['Reason: ' + input.reason] : [])],
        warningTitle: 'Money goes back',
        warnings: ['This can\'t be undone.'],
        confirmLabel: 'Refund',
        destructive: true,
        // The amount on the card, not "what's left" at Confirm: if the order was
        // refunded in between, the run refuses instead of refunding a different sum.
        pin: { date: p.date, order: p.order.id, amount: p.amount / 100 },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      return audited(ctx, 'refund_online_order', input, async () => {
        const p = await refundPlan(ctx, input)
        const o = await callApi(ctx, 'POST', `/api/orders/${p.order.id}/refund`, { body: { amount_pence: p.amount, reason: input.reason ?? null } })
        return { order: numberOf(p.order), refunded_in_total: pence(o.refunded_pence, p.venue.currency), message: 'Refunded.' }
      })
    },
  },

  {
    name: 'pause_online_orders',
    section: 'orders',
    title: 'Pause online orders',
    description: 'Stops (paused true) or starts again (paused false) taking online orders at a venue, with an optional message for guests.',
    input: z.object({ venue: VenueText, paused: z.boolean(), message: z.string().trim().max(300).optional() }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      const venue = await venueFor(ctx, input.venue)
      return {
        title: input.paused ? 'Pause online orders?' : 'Take online orders again?',
        lines: [venue.name, ...(input.message ? ['Message for guests: ' + input.message] : [])],
        confirmLabel: input.paused ? 'Pause' : 'Start again',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      return audited(ctx, 'pause_online_orders', input, async () => {
        const venue = await venueFor(ctx, input.venue)
        const row = await callApi(ctx, 'POST', `/api/orders/pause/${venue.id}`, { body: { paused: input.paused, message: input.message ?? null } })
        return { venue: venue.name, paused: row.is_paused, message: row.is_paused ? 'Online orders paused.' : 'Taking online orders again.' }
      })
    },
  },

  {
    name: 'online_orders_report',
    section: 'orders',
    title: 'Online orders report',
    description: 'Online orders over dates: orders, sales, tips, discounts, VAT, refunds, average order, by day, by payment method, top dishes and promotions used.',
    input: z.object({ venue: VenueText, from: DateStr.optional().describe('Default today'), to: DateStr.optional() }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'view')
      const venue = await venueFor(ctx, input.venue)
      const from = input.from || venueToday(venue)
      const to = input.to || from
      if (to < from) throw new ToolError('The end date is before the start date.', 422)
      const r = await callApi(ctx, 'GET', `/api/orders/report?venue_id=${venue.id}&from=${from}&to=${to}`)
      const cur = venue.currency
      const t = r.totals
      return {
        venue: venue.name, from, to,
        totals: {
          orders: t.orders, sales: pence(t.total_pence, cur), average: pence(t.average_pence, cur),
          tips: pence(t.tip_pence, cur), discounts: pence(t.discount_pence, cur), vat: pence(t.vat_pence, cur),
          refunded: pence(t.refunded_pence, cur),
        },
        by_day: r.days.map(d => ({ day: shortDate(d.date), orders: d.orders, sales: pence(d.total_pence, cur) })),
        by_payment: r.by_method.map(m => ({ method: m.method, orders: m.orders, paid: pence(m.paid_pence, cur) })),
        top_dishes: r.top_items.map(i => i.qty + ' x ' + i.name),
        promotions: r.promotions.map(p => p.name + ': ' + plural(p.orders, 'order') + ', ' + pence(p.discount_pence, cur) + ' off'),
        statuses: Object.fromEntries(Object.entries(r.statuses).map(([k, v]) => [STATUS_WORD[k] || k, v])),
      }
    },
  },

  {
    name: 'sold_out',
    section: 'orders',
    title: 'Sold out dishes',
    description: 'Which dishes are sold out at a venue right now (on the till, online ordering and menu screens), and until when.',
    input: z.object({ venue: VenueText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'view')
      const venue = await venueFor(ctx, input.venue)
      const dishes = await venueDishes(ctx, venue)
      const sold = dishes.filter(d => d.sold.length)
      return {
        venue: venue.name,
        sold_out: sold.map(d => d.name + ' (' + untilText(d.until, venue.timezone) + ')'),
        ...(sold.length ? {} : { note: 'Nothing is sold out.' }),
      }
    },
  },

  {
    name: 'set_sold_out',
    section: 'orders',
    title: 'Mark dishes sold out',
    description:
      'Marks dishes sold out at a venue (today: back on at midnight; until_back: until someone puts it back) or back on. ' +
      'Tills, online ordering, the orders board and menu screens all show it straight away. Dishes are named as on the menu.',
    input: z.object({
      venue: VenueText,
      dishes: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
      sold_out: z.enum(['today', 'until_back', 'back_on']),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      const p = await soldOutPlan(ctx, input)
      const word = { today: 'Sold out today', until_back: 'Sold out until put back', back_on: 'Back on' }[input.sold_out]
      return {
        title: input.sold_out === 'back_on' ? 'Put these back on?' : 'Mark these sold out?',
        lines: [p.venue.name + ': ' + word, ...p.picked.map(d => d.name + (d.menus.length > 1 ? ' (' + d.menus.length + ' menus)' : ''))],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: input.sold_out === 'back_on' ? 'Put back on' : 'Mark sold out',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'web_orders', 'manage')
      return audited(ctx, 'set_sold_out', input, async () => {
        const p = await soldOutPlan(ctx, input)
        const mode = input.sold_out === 'back_on' ? false : input.sold_out === 'today' ? 'today' : 'indefinite'
        for (const d of p.picked) {
          for (const id of d.ids) {
            await callApi(ctx, 'PUT', `/api/orders/availability/${p.venue.id}/${id}`, { body: { sold_out: mode } })
          }
        }
        return { venue: p.venue.name, dishes: p.picked.map(d => d.name), message: input.sold_out === 'back_on' ? 'Back on.' : 'Marked sold out.' }
      })
    },
  },

  {
    name: 'till_day',
    section: 'till',
    title: 'Till day figures',
    description:
      'A trading day\'s till figures at a venue (default: the latest day; live X figures while it is open, else its Z report): ' +
      'sales, VAT by rate, covers, average check, takings by payment type, tips, refunds, voids, discounts, top dishes, ' +
      'revenue streams, order types, staff, open checks, cash expected and declared, and whether Cash Recon was filled.',
    input: z.object({ venue: VenueText, date: DateStr.optional().describe('The business date; default the latest trading day') }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'pos_reports', 'view')
      const venue = await venueFor(ctx, input.venue)
      const days = await callApi(ctx, 'GET', `/api/pos/venues/${venue.id}/days?limit=120`)
      if (!days.length) throw new ToolError(venue.name + ' has no till trading days yet.', 404)
      const day = input.date ? days.find(d => d.business_date === input.date) : days[0]
      if (!day) throw new ToolError('No trading day on ' + longDate(input.date) + '. Latest: ' + days.slice(0, 5).map(d => shortDate(d.business_date)).join(', ') + '.', 404)
      const r = await callApi(ctx, 'GET', `/api/pos/venues/${venue.id}/days/${day.id}`)
      const f = r.figures
      const cur = venue.currency
      const nm = (map, id) => (id ? r.names?.[map]?.[id] : null) || (id ? 'Unknown' : 'None')
      return {
        venue: venue.name, day: longDate(r.business_date),
        state: r.live ? 'open (live X figures)' : 'closed (Z ' + r.z_number + ')',
        sales: {
          total: pence(f.sales.total, cur), net: pence(f.sales.net, cur), vat: pence(f.sales.vat_total, cur),
          discounts: pence(f.sales.discounts, cur), service_charge: pence(f.sales.service_charge, cur),
          checks: f.counts.closed || 0, covers: f.covers, average_check: pence(f.sales.average_check, cur),
        },
        vat_by_rate: f.vat.map(v => v.rate + '%: ' + pence(v.vat, cur) + ' on ' + pence(v.net, cur)),
        takings: f.tenders.map(t => t.label + ': ' + pence(t.amount, cur) + (t.tips ? ' + tips ' + pence(t.tips, cur) : '') + (t.refunds ? ', refunds ' + pence(t.refunds, cur) : '')),
        takings_total: pence(f.takings, cur),
        tips: pence(f.tips, cur),
        ...(f.refunds.count ? { refunds: plural(f.refunds.count, 'refund') + ', ' + pence(f.refunds.amount, cur) } : {}),
        ...(f.voids.count ? { voids: plural(f.voids.count, 'void') + ', ' + pence(f.voids.value, cur) } : {}),
        discounts: f.discounts.map(d => d.name + ': ' + pence(d.amount, cur) + ' (' + d.count + ')'),
        top_dishes: f.items.slice(0, 10).map(i => i.qty + ' x ' + i.name),
        revenue_streams: f.revenue_streams.map(s => nm('revenue_streams', s.id) + ': ' + pence(s.gross, cur)),
        order_types: f.order_types.map(t => nm('order_types', t.id) + ': ' + plural(t.checks, 'check') + ', ' + pence(t.total, cur)),
        staff: f.staff.filter(s => s.checks || s.tips).map(s => nm('staff', s.id) + ': ' + plural(s.checks, 'check') + ', ' + pence(s.total, cur) + (s.tips ? ', tips ' + pence(s.tips, cur) : '')),
        ...(f.open_checks.length ? { open_checks: f.open_checks.map(c => (c.order_no != null ? 'order ' + c.order_no : 'check ' + c.number) + ' ' + pence(c.balance, cur) + ' to pay') } : {}),
        cash_expected: pence(f.cash_expected, cur),
        ...(r.declared_cash != null ? { cash_declared: pence(r.declared_cash, cur) } : {}),
        cash_recon: r.recon_filled_at ? 'filled' : r.recon_error ? 'not filled: ' + r.recon_error : r.live ? 'fills when the day is closed' : 'not filled',
      }
    },
  },

  {
    name: 'till_checks',
    section: 'till',
    title: 'Till checks',
    description: 'A trading day\'s till checks (default the latest day): number, table or name, server, order type, status, total, paid, tips.',
    input: z.object({
      venue: VenueText,
      date: DateStr.optional(),
      status: z.enum(['open', 'closed', 'void', 'merged']).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'pos_reports', 'view')
      const venue = await venueFor(ctx, input.venue)
      const days = await callApi(ctx, 'GET', `/api/pos/venues/${venue.id}/days?limit=120`)
      const day = input.date ? days.find(d => d.business_date === input.date) : days[0]
      if (!day) throw new ToolError(input.date ? 'No trading day on ' + longDate(input.date) + '.' : venue.name + ' has no till trading days yet.', 404)
      const checks = await callApi(ctx, 'GET', `/api/pos/venues/${venue.id}/checks?day_id=${day.id}${input.status ? '&status=' + input.status : ''}&limit=300`)
      const cur = venue.currency
      return {
        venue: venue.name, day: longDate(day.business_date),
        checks: checks.map(c => ({
          number: numberText(c) + (c.order_no ? ' (order ' + c.order_no + ')' : ''),
          ...(c.table_label ? { table: c.table_label } : {}), ...(c.tab_name ? { name: c.tab_name } : {}),
          ...(c.server_name ? { server: c.server_name } : {}), ...(c.order_type_name ? { type: c.order_type_name } : {}),
          status: c.status, total: pence(c.total, cur), paid: pence(c.paid, cur),
          ...(Number(c.tips) ? { tips: pence(c.tips, cur) } : {}), ...(Number(c.refunded) ? { refunded: pence(c.refunded, cur) } : {}),
          opened: c.opened_at ? localParts(c.opened_at, venue.timezone).time : null,
        })),
        count: plural(checks.length, 'check'),
      }
    },
  },

  {
    name: 'kitchen_report',
    section: 'till',
    title: 'Kitchen speed report',
    description: 'Kitchen screen speed of service over dates (default today): per station tickets, average / median / slowest times, on time and late, by hour, and remakes with their reasons.',
    input: z.object({ venue: VenueText, from: DateStr.optional(), to: DateStr.optional() }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'pos_reports', 'view')
      const venue = await venueFor(ctx, input.venue)
      const from = input.from || venueToday(venue)
      const to = input.to || from
      const r = await callApi(ctx, 'GET', `/api/pos/venues/${venue.id}/kitchen-report?from=${from}&to=${to}`)
      const mins = s => (s == null ? null : Math.round(s / 6) / 10 + ' min')
      const nameOf = new Map(r.stations.map(s => [s.station_id, s.name]))
      return {
        venue: venue.name, from, to,
        stations: r.stations.map(s => ({
          station: s.name, tickets: s.tickets, average: mins(s.avg_secs), median: mins(s.median_secs), slowest: mins(s.max_secs),
          on_time: s.tickets ? Math.round(s.on_time * 100 / s.tickets) + '%' : null, late: s.late, target: s.target_mins + ' min',
        })),
        busiest_hours: [...r.hours].sort((a, b) => b.tickets - a.tickets).slice(0, 5)
          .map(h => String(h.hour).padStart(2, '0') + ':00 ' + (nameOf.get(h.station_id) || 'station') + ': ' + plural(h.tickets, 'ticket') + ', ' + mins(h.avg_secs) + ' average'),
        remakes: r.remakes.slice(0, 30).map(m => m.item_name + ' at ' + m.station + (m.reason ? ' (' + m.reason + ')' : '')),
        ...(r.stations.length ? {} : { note: 'No kitchen screen tickets in these dates.' }),
      }
    },
  },
]

async function refundPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const date = input.date || venueToday(venue)
  const { order } = await findOrder(ctx, venue, input.order, date)
  if (isGf(order)) throw new ToolError('GloriaFood orders are refunded in GloriaFood.', 422)
  const left = Number(order.paid_pence || 0) - Number(order.refunded_pence || 0)
  if (left <= 0) throw new ToolError(numberOf(order) + ' has nothing left to refund.', 409)
  const amount = input.amount != null ? Math.round(input.amount * 100) : left
  if (amount > left) throw new ToolError('Only ' + pence(left, venue.currency) + ' can be refunded.', 422)
  return { venue, date, order, left, amount }
}

async function soldOutPlan(ctx, input) {
  const venue = await venueFor(ctx, input.venue)
  const dishes = await venueDishes(ctx, venue)
  const picked = input.dishes.map(n => pickByName(dishes, n, d => d.name, 'dish on ' + venue.name + '\'s live menus', 'No published menus at this venue.'))
  if (new Set(picked.map(d => d.name)).size !== picked.length) throw new ToolError('A dish is named twice.', 422)
  const warnings = []
  for (const d of picked) {
    if (input.sold_out === 'back_on' && !d.sold.length) warnings.push(d.name + ' isn\'t sold out.')
    if (input.sold_out !== 'back_on' && d.sold.length === d.ids.length) warnings.push(d.name + ' is already sold out (' + untilText(d.until, venue.timezone) + ').')
  }
  return { venue, picked, warnings }
}
