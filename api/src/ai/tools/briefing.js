// src/ai/tools/briefing.js
//
// day_briefing: a venue's day in one call, for "what's on today?" and the
// start of a shift. Each part is one of Pepper's own reading tools, run as
// the person asking, so each keeps its own permission check: a part the
// person can't see is left out and named, never worked round.
//
//   bookings     day_overview (count, covers, by hour, big parties)
//   staff        whos_working
//   hs           hs_status (checklists, checks logged, out of range)
//   deliveries   purchase_orders still to come today
//   to_approve   supplier orders waiting for approval (order_requests)
//   cash         yesterday's cash_day (status and variance)
//   orders       online_orders still open today
//   sold_out     sold_out
//   emails       booking emails that failed (email_log)
//   screens      menu screens that are offline (screens_status)

import { z } from 'zod'
import { ToolError, isStaff } from '../context.js'
import { venueFor, venueToday, addDays, longDate } from './util.js'
import { staffTools as bookingTools } from './staff.js'
import { hsTools } from './hs.js'
import { rotaTools } from './rota.js'
import { cashTools } from './cash.js'
import { orderTools } from './orders.js'
import { siteTools } from './site.js'
import { purchasingTools } from './purchasing.js'

const ALL = [...bookingTools, ...hsTools, ...rotaTools, ...cashTools, ...orderTools, ...siteTools, ...purchasingTools]
const tool = name => {
  const t = ALL.find(x => x.name === name)
  if (!t) throw new Error('day_briefing needs the ' + name + ' tool')
  return t
}

const BIG_PARTY = 8
// 2026-02-31 matches YYYY-MM-DD but isn't a day.
const realDay = d => { const t = Date.parse(d + 'T12:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d }

// Each part names the venue by id (two venues may share a name).
const PARTS = [
  ['bookings', async (ctx, v, date) => {
    const d = await tool('day_overview').run(ctx, { venue_id: v.id, date })
    const big = d.list.filter(b => b.party_size >= BIG_PARTY && !['cancelled', 'no_show'].includes(b.status))
    return {
      bookings: d.bookings, covers: d.covers, by_hour: d.by_hour,
      ...(big.length ? { big_parties: big.slice(0, 10).map(b => ({ time: b.time, guest: b.guest_name, party_size: b.party_size, table: b.table })) } : {}),
    }
  }],
  ['staff', async (ctx, v, date) => {
    const w = await tool('whos_working').run(ctx, { venue: v.id, date })
    return {
      ...(w.open === false ? { open: false } : {}),
      working: w.working, hours_total: w.hours_total,
      ...(w.time_off ? { time_off: w.time_off } : {}), ...(w.away ? { away: w.away } : {}), ...(w.note ? { note: w.note } : {}),
    }
  }],
  ['health_and_safety', async (ctx, v, date) => {
    const h = await tool('hs_status').run(ctx, { venue_id: v.id, date })
    const mine = h.venues?.[0]
    if (!mine) return { note: 'Nothing set up' }
    const { venue_id, venue, ...rest } = mine
    return rest
  }],
  ['deliveries_due', async (ctx, v, date) => {
    const p = await tool('purchase_orders').run(ctx, { venue_id: v.id, status: 'open', from: date, to: date })
    return { purchase_orders: p.purchase_orders.slice(0, 15) }
  }],
  ['orders_to_approve', async (ctx, v) => {
    const r = await tool('order_requests').run(ctx, { venue_id: v.id })
    return {
      waiting: r.waiting_for_approval.length + (r.more_waiting || 0),
      ...(r.waiting_for_approval.length ? {
        orders: r.waiting_for_approval.slice(0, 5).map(o => ({ order_id: o.order_id, list: o.list, asked_by: o.asked_by, lines: o.lines.length })),
        you_can_approve: r.you_can_approve,
      } : {}),
    }
  }],
  ['yesterdays_cash_up', async (ctx, v, date) => {
    const c = await tool('cash_day').run(ctx, { venue: v.id, date: addDays(date, -1) })
    return { date: c.date, status: c.status, ...(c.totals?.variance ? { variance: c.totals.variance } : {}) }
  }],
  ['online_orders', async (ctx, v, date) => {
    const o = await tool('online_orders').run(ctx, { venue: v.id, date, only_open: true })
    return { ordering: o.ordering, open: o.open.slice(0, 15), count: o.count }
  }],
  ['sold_out', async (ctx, v) => {
    const s = await tool('sold_out').run(ctx, { venue: v.id })
    return s
  }],
  ['failed_emails', async ctx => {
    const e = await tool('email_log').run(ctx, { only_failed: true, limit: 5 })
    return { failed_recently: e.failed_recently, latest: e.emails }
  }],
  ['screens_offline', async (ctx, v) => {
    const s = await tool('screens_status').run(ctx, { venue: v.id })
    return { offline: s.screens.filter(x => x.status === 'offline') }
  }],
]

export const briefingTools = [
  {
    name: 'day_briefing',
    section: 'general',
    title: 'Day briefing',
    description:
      'A venue\'s day in one go (default today): bookings and big parties, who is working, health & safety due and out-of-range ' +
      'readings, supplier deliveries due, supplier orders waiting for approval, yesterday\'s cash-up, open online orders, sold out dishes, failed booking emails and ' +
      'offline menu screens. Parts the person can\'t see are left out and listed. Use it for "what\'s on today?", "brief me" or ' +
      'the start of a shift, then summarise: the things to act on first, then the rest in a few lines.',
    input: z.object({
      venue: z.string().trim().max(100).optional().describe('Venue name; can be left out when there is one venue'),
      date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(realDay, 'Not a real date')
        .optional().describe('YYYY-MM-DD; defaults to today at the venue'),
    }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const venue = await venueFor(ctx, input.venue)
      const date = input.date || venueToday(venue)
      const out = { venue: venue.name, date, day: longDate(date) }
      const notIncluded = []
      const results = await Promise.all(PARTS.map(async ([key, fn]) => {
        try {
          return [key, await fn(ctx, venue, date)]
        } catch (err) {
          if (err instanceof ToolError && err.status === 403) return [key, { skipped: 'no_access' }]
          return [key, { error: err instanceof ToolError ? err.message : 'Couldn\'t load this part' }]
        }
      }))
      for (const [key, value] of results) {
        if (value?.skipped === 'no_access') notIncluded.push(key)
        else out[key] = value
      }
      if (notIncluded.length) out.not_included = { parts: notIncluded, why: 'The person\'s role can\'t see these areas.' }
      return out
    },
  },
]
