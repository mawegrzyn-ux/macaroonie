// src/services/opsToday.js
//
// The ops task feed (docs/CHAT_FIRST.md: P1, H2, H3, C1, C2, S1, S7): what
// needs doing at a venue today, worked out from the data and its rules, never
// by the AI. With the model down the person still sees every task.
//
// Each source reads through the admin routes in-process as the person
// (callApi), so every part keeps its own permission check and tenant filter;
// a part the person can't see is left out and named (not_included), as the
// day briefing does. Tasks are worked out on every request (there is no task
// store yet) and each has a stable key, so one thing to do is one card (C6).
//
// Groups, against the venue's time now:
//   late   due more than GRACE_MINS ago, or overdue by nature (a reading out
//          of range with no corrective action, yesterday's cash-up)
//   now    due within GRACE_MINS either side, or due today with no set time
//   next   due within NEXT_MINS
//   later  due later today, or this week / month

import { withTenant } from '../config/db.js'
import { permissionAtLeast, workLevel } from '../config/modules.js'
import { callApi, ToolError } from '../ai/context.js'
import { localParts, longDate, shortDate } from '../ai/tools/util.js'
import { staffTools } from '../ai/tools/staff.js'
import { rotaTools } from '../ai/tools/rota.js'
import { openDatesOrNull } from './openDays.js'
import { poNumberLabel, deadlinePassed } from '../../../shared/procurement.js'

export const GRACE_MINS = 30
export const NEXT_MINS = 120
export const GROUPS = ['late', 'now', 'next', 'later']
const BIG_PARTY = 8

const hhmm = t => (t ? String(t).slice(0, 5) : null)
const mins = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
const num = v => (v === null || v === undefined || v === '') ? null : Number(v)
const fmtTemp = t => (t === null || t === undefined) ? '' : Number(t).toFixed(1) + '°C'
const dayOnly = d => (d ? String(d).slice(0, 10) : null)
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekday = date => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(new Date(date + 'T12:00:00Z'))

/** Which group a task due at `due` (HH:MM, or null = some time today) falls in at `now`. */
export function groupFor(due, now, { overdue = false } = {}) {
  if (overdue) return 'late'
  if (!due) return 'now'
  const d = mins(due) - mins(now)
  if (d < -GRACE_MINS) return 'late'
  if (d <= GRACE_MINS) return 'now'
  if (d <= NEXT_MINS) return 'next'
  return 'later'
}

/** S1: overdue first, then by group; compliance before the rest; then by time. */
export function sortTasks(tasks) {
  const rank = t => GROUPS.indexOf(t.group)
  return [...tasks].sort((a, b) =>
    rank(a) - rank(b) ||
    (b.compliance ? 1 : 0) - (a.compliance ? 1 : 0) ||
    (a.due || '99:99').localeCompare(b.due || '99:99') ||
    a.title.localeCompare(b.title))
}

// Areas, the module each needs, and how it is read. A source returns tasks
// or throws; a 403 means the person can't see that area.
const AREAS = {
  food_safety: 'food_safety',
  checklists: 'checklists',
  hs_actions: 'hs_action_log',
  purchasing: 'purchasing',
  cash: 'cash_recon',
  online_orders: 'web_orders',
}

/** Units (fridges or hold stations) against their check times. */
function checkRounds({ kind, form, label, units, times, readings, key }, s) {
  const live = units.filter(u => u.is_active !== false)
  if (!live.length) return []
  return times.filter(t => t.is_active !== false).flatMap(t => {
    const logged = live.filter(u => readings.some(r => r[key] === u.id && r.capture_time_id === t.id)).length
    if (logged >= live.length) return []
    const due = hhmm(t.time_of_day)
    return [{
      key: kind + ':' + t.id, area: 'food_safety', kind, compliance: true,
      title: label + (t.label ? ': ' + t.label : ''),
      detail: logged + ' of ' + live.length + ' logged',
      due, group: groupFor(due, s.now),
      action: { form, label: 'Log temperatures', ref: { capture_time_id: t.id } },
    }]
  })
}

const SOURCES = {
  async food_safety(ctx, v, s) {
    const q = path => callApi(ctx, 'GET', `/api/food-safety/${path}${path.includes('?') ? '&' : '?'}venue_id=${v.id}`)
    const [equipment, times, temps, stations, holdTimes, holds, sessions, cooking, deliveries] = await Promise.all([
      q('equipment'), q('capture-times'), q('temp-logs?date=' + s.date),
      q('hold-stations'), q('hold-capture-times'), q('holds?date=' + s.date),
      q('cooking-sessions'), q('cooking?date=' + s.date), q('deliveries?date=' + s.date),
    ])
    const tasks = []
    // A closed day expects no checks (R4); readings already out of range still need an action.
    if (!s.closed) {
      tasks.push(...checkRounds({ kind: 'fridge_check', form: 'temps', label: 'Fridge and freezer check', units: equipment, times, readings: temps, key: 'equipment_id' }, s))
      tasks.push(...checkRounds({ kind: 'hold_check', form: 'holds', label: 'Hot and cold hold check', units: stations, times: holdTimes, readings: holds, key: 'station_id' }, s))
      for (const x of sessions.filter(x => x.is_active !== false)) {
        const need = num(x.required_items_count) || 0
        const logged = cooking.filter(c => c.session_id === x.id).length
        if (!need || logged >= need) continue
        const due = hhmm(x.time_of_day)
        tasks.push({
          key: 'cooking:' + x.id, area: 'food_safety', kind: 'cooking_check', compliance: true,
          title: 'Cooking checks' + (x.label ? ': ' + x.label : ''),
          detail: logged + ' of ' + need + ' logged',
          due, group: due ? groupFor(due, s.now) : 'now',
          action: { form: 'cooking', label: 'Log cooking checks', ref: { session_id: x.id } },
        })
      }
    }
    const nameOf = (list, id) => list.find(u => u.id === id)?.name || 'A reading'
    const fix = (kind, form, r, what) => ({
      key: 'fix:' + kind + ':' + r.id, area: 'food_safety', kind: 'corrective_action', compliance: true,
      title: 'Corrective action needed: ' + what,
      detail: 'Out of range with no corrective action',
      due: null, group: 'late',
      action: form ? { form, label: 'Add the action' } : { path: '/food-safety', label: 'Open food safety' },
    })
    for (const r of temps) if (r.is_within_range === false && !r.corrective_action) tasks.push(fix('fridge', 'temps', r, nameOf(equipment, r.equipment_id) + ' ' + fmtTemp(r.temperature_c)))
    for (const r of holds) if (r.is_within_range === false && !r.corrective_action) tasks.push(fix('hold', 'holds', r, nameOf(stations, r.station_id) + ' ' + fmtTemp(r.temperature_c)))
    for (const c of cooking) if (c.is_within_range === false && !c.corrective_action) tasks.push(fix('cooking', 'cooking', c, c.dish_name + ' ' + fmtTemp(c.core_temp_c)))
    for (const d of deliveries) {
      const passed = d.packaging_ok && d.damage_ok && d.quality_ok && d.temp_ok && d.accepted
      if (!passed && !d.corrective_action) tasks.push(fix('delivery', null, d, 'delivery from ' + d.vendor_name))
    }
    return tasks
  },

  async checklists(ctx, v, s) {
    const due = await callApi(ctx, 'GET', `/api/checklists/due?venue_id=${v.id}&date=${s.date}`)
    return due.filter(d => !d.not_required && d.instance?.status !== 'completed').map(d => {
      const daily = d.template.frequency === 'daily'
      const ticked = d.instance?.checked_count ?? 0
      return {
        key: 'checklist:' + d.template.id, area: 'checklists', kind: 'checklist', compliance: true,
        title: d.template.name,
        detail: [d.template.department, ticked + ' of ' + d.template.item_count + ' ticked',
          daily ? null : d.template.frequency === 'weekly' ? 'this week' : 'this month'].filter(Boolean).join(' · '),
        due: null, group: daily ? 'now' : 'later',
        action: { form: 'checklist', label: ticked ? 'Carry on' : 'Tick it off', ref: { template: d.template } },
      }
    })
  },

  async hs_actions(ctx, v, s) {
    const rows = await callApi(ctx, 'GET', `/api/hs-action-log/entries?venue_id=${v.id}&status=open`)
    return rows.filter(e => dayOnly(e.due_date) && dayOnly(e.due_date) <= s.date).map(e => ({
      key: 'hs_action:' + e.id, area: 'hs_actions', kind: 'hs_action', compliance: true,
      title: e.task,
      detail: (dayOnly(e.due_date) < s.date ? 'Overdue since ' + shortDate(dayOnly(e.due_date)) : 'Due today') +
        (e.priority && e.priority !== 'medium' ? ' · ' + e.priority + ' priority' : ''),
      due: null, group: dayOnly(e.due_date) < s.date ? 'late' : 'now',
      action: { path: '/hs-action-log', label: 'Open the action log' },
    }))
  },

  // Orders to send (late once the supplier's order deadline for the day has
  // passed, deadlinePassed()), deliveries due today, and deliveries sent for
  // an earlier day that nobody booked in (late).
  async purchasing(ctx, v, s) {
    const yesterday = addDays(s.date, -1)
    const [toSend, sent, unbooked] = await Promise.all([
      callApi(ctx, 'GET', `/api/purchasing/pos?venue_id=${v.id}&status=to_send&order=asc&limit=60`),
      callApi(ctx, 'GET', `/api/purchasing/pos?venue_id=${v.id}&status=sent&from=${s.date}&to=${s.date}&limit=60`),
      callApi(ctx, 'GET', `/api/purchasing/pos?venue_id=${v.id}&status=sent&to=${yesterday}&limit=60`),
    ])
    const now = { date: s.date, time: s.now }
    const lateToSend = p => !!p.delivery_date && deadlinePassed(p, dayOnly(p.delivery_date), now)
    // Late ones first, then the soonest deliveries (the list comes soonest first).
    const ordered = [...toSend.filter(lateToSend), ...toSend.filter(p => !lateToSend(p))]
    const tasks = [
      ...ordered.slice(0, 10).map(p => {
        const day = dayOnly(p.delivery_date)
        const late = lateToSend(p)
        return {
          key: 'po_send:' + p.id, area: 'purchasing', kind: 'po_to_send', compliance: false,
          title: 'Send the order to ' + p.supplier_name,
          detail: poNumberLabel(p.number) + (day ? ' · delivery ' + shortDate(day) : '') +
            (late ? (day < s.date ? ' · the delivery day has passed' : ' · past the order deadline') : '') +
            (p.send_error ? ' · last try failed' : ''),
          due: null, group: late ? 'late' : 'now',
          action: { path: '/purchasing?po=' + p.id, label: 'Send it' },
        }
      }),
      ...sent.filter(p => dayOnly(p.delivery_date) === s.date).slice(0, 10).map(p => ({
        key: 'delivery:' + p.id, area: 'purchasing', kind: 'delivery_due', compliance: false,
        title: 'Book in the delivery from ' + p.supplier_name,
        detail: poNumberLabel(p.number) + ' · due today',
        due: null, group: 'now',
        action: { path: '/purchasing?po=' + p.id, label: 'Book it in' },
      })),
      ...unbooked.slice(0, 10).map(p => ({
        key: 'delivery:' + p.id, area: 'purchasing', kind: 'delivery_not_booked', compliance: false,
        title: 'Book in the delivery from ' + p.supplier_name,
        detail: poNumberLabel(p.number) + ' · was due ' + shortDate(dayOnly(p.delivery_date)) + ', not booked in',
        due: null, group: 'late',
        action: { path: '/purchasing?po=' + p.id, label: 'Book it in' },
      })),
    ]
    if (s.levels.purchasing_approve === 'manage') {
      const waiting = await callApi(ctx, 'GET', `/api/purchasing/orders?status=requested&venue_id=${v.id}`)
      if (waiting.length) tasks.push({
        key: 'approve:' + v.id, area: 'purchasing', kind: 'orders_to_approve', compliance: false,
        title: plural(waiting.length, 'supplier order') + ' waiting for approval',
        detail: 'Asked for by ' + [...new Set(waiting.map(o => o.requested_by).filter(Boolean))].slice(0, 3).join(', '),
        due: null, group: 'now',
        action: { path: '/purchasing', label: 'Look at them' },
      })
    }
    return tasks
  },

  async cash(ctx, v, s) {
    const yesterday = addDays(s.date, -1)
    const open = await withTenant(ctx.tenantId, tx => openDatesOrNull(tx, ctx.tenantId, v.id, [yesterday]))
    if (open && !open.includes(yesterday)) return []
    const report = await callApi(ctx, 'GET', `/api/venues/${v.id}/cash-recon/daily/${yesterday}`)
    if (report?.status === 'submitted') return []
    return [{
      key: 'cash_up:' + yesterday, area: 'cash', kind: 'cash_up', compliance: false,
      title: 'Cash-up for ' + weekday(yesterday) + ' not submitted',
      detail: report ? 'Started, not submitted' : 'Not started',
      due: null, group: 'late',
      action: { path: '/cash-recon', label: 'Do the cash-up' },
    }]
  },

  async online_orders(ctx, v, s) {
    const board = await callApi(ctx, 'GET', `/api/orders?venue_id=${v.id}&date=${s.date}`)
    const waiting = (board?.orders || []).filter(o => o.status === 'placed')
    if (!waiting.length) return []
    return [{
      key: 'web_orders:' + v.id, area: 'online_orders', kind: 'online_orders', compliance: false,
      title: plural(waiting.length, 'online order') + ' waiting to be accepted',
      detail: waiting.slice(0, 3).map(o => '#' + (o.day_number ?? o.number ?? '') + (o.customer_name ? ' ' + o.customer_name : '')).join(', '),
      due: null, group: 'now',
      action: { path: '/orders', label: 'Open the board' },
    }]
  },
}

/** H2: the day at a glance (bookings and who is working), from Pepper's own reading tools. */
async function summary(ctx, v, s) {
  const tool = (list, name) => list.find(t => t.name === name)
  const out = {}
  const [bookings, staff] = await Promise.allSettled([
    s.levels.bookings !== 'none' ? tool(staffTools, 'day_overview').run(ctx, { venue_id: v.id, date: s.date }) : null,
    s.levels.rota !== 'none' ? tool(rotaTools, 'whos_working').run(ctx, { venue: v.id, date: s.date }) : null,
  ])
  if (bookings.status === 'fulfilled' && bookings.value) {
    const d = bookings.value
    const live = d.list.filter(b => !['cancelled', 'no_show'].includes(b.status))
    out.bookings = {
      count: d.bookings, covers: d.covers,
      big_parties: live.filter(b => b.party_size >= BIG_PARTY).slice(0, 5)
        .map(b => ({ time: b.time, guest: b.guest_name, party_size: b.party_size })),
    }
  }
  if (staff.status === 'fulfilled' && staff.value) {
    const w = staff.value
    out.staff = { working: (w.working || []).length, open: w.open !== false }
  }
  return out
}

/**
 * The feed for one venue and day. `levels` are the person's module levels
 * (permissionLevels()); `time` (HH:MM) is the moment to judge against, and
 * defaults to the venue's time now (a past day = all due, a future one = none yet).
 */
export async function opsToday(ctx, venue, { date, time, levels }) {
  const now = localParts(new Date(), venue.timezone)
  const day = date || now.date
  const at = time || (day < now.date ? '23:59' : day > now.date ? '00:00' : now.time)
  const [closed] = await Promise.all([
    callApi(ctx, 'GET', `/api/hs-settings?venue_id=${venue.id}&date=${day}`).then(r => !!r.closed).catch(() => false),
  ])
  const s = { date: day, now: at, closed, levels }

  const tasks = []
  const notIncluded = []
  const errors = []
  await Promise.all(Object.entries(SOURCES).map(async ([area, fn]) => {
    if ((levels[AREAS[area]] || 'none') === 'none') { notIncluded.push(area); return }
    try {
      for (const t of await fn(ctx, venue, s)) {
        // can_act: the person can do it here, not only look (U1): Use where
        // the module offers it (checks, checklists, H&S actions), else Manage.
        const module = t.kind === 'orders_to_approve' ? 'purchasing_approve' : AREAS[area]
        tasks.push({ ...t, can_act: permissionAtLeast(levels[module], workLevel(module)) })
      }
    } catch (err) {
      if (err instanceof ToolError && err.status === 403) notIncluded.push(area)
      else errors.push({ area, message: err instanceof ToolError ? err.message : 'Couldn\'t load this part' })
    }
  }))

  // C6: one card per key, whichever source found it.
  const byKey = new Map()
  for (const t of tasks) if (!byKey.has(t.key)) byKey.set(t.key, t)
  const list = sortTasks([...byKey.values()])
  const counts = Object.fromEntries(GROUPS.map(g => [g, list.filter(t => t.group === g).length]))

  return {
    venue: { id: venue.id, name: venue.name, timezone: venue.timezone },
    date: day, day: longDate(day), now: at, is_today: day === now.date, closed,
    summary: await summary(ctx, venue, s).catch(() => ({})),
    tasks: list, counts,
    ...(notIncluded.length ? { not_included: notIncluded.sort() } : {}),
    ...(errors.length ? { errors } : {}),
  }
}

/** The modules the feed reads, for permissionLevels(). */
export const OPS_MODULES = [...new Set([...Object.values(AREAS), 'purchasing_approve', 'bookings', 'rota'])]
