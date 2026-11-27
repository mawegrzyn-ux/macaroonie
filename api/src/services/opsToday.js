// src/services/opsToday.js
//
// The ops task feed (docs/CHAT_FIRST.md: P1, H2, H3, C1, C2, S1, S7): what
// needs doing at a venue today, worked out from the data and its rules, never
// by the AI. With the model down the person still sees every task.
//
// Each source reads through the admin routes in-process as the person
// (callApi), so every part keeps its own permission check and tenant filter;
// a part the person can't see is left out and named (not_included), as the
// day briefing does. Tasks are worked out on every request and each has a
// stable key, so one thing to do is one card (C6). What people decided about
// a task (its owner, a snooze, a skip with its reason, done by hand) is kept
// by that key in the task store (services/opsTasks.js, migration 278) and
// applied here: a set-aside task leaves `tasks` for `aside`. A source may
// also note a gap in the set-up it can see (`gaps`: no fridges at the venue),
// which Home's suggestions offer to whoever manages it (services/suggestions.js).
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
import { localParts, longDate, shortDate, mondayOf, money } from '../ai/tools/util.js'
import { staffTools } from '../ai/tools/staff.js'
import { rotaTools } from '../ai/tools/rota.js'
import { openDatesOrNull } from './openDays.js'
import { poNumberLabel, deadlinePassed } from '../../../shared/procurement.js'
import { weekAhead } from '../../../shared/localInfo.js'
import { loadStates, applyStates, canChange } from './opsTasks.js'
import { deviceOnline } from '../../../shared/techBoard.js'
import { pageLink } from '../../../shared/nav/links.js'

export const GRACE_MINS = 30
export const NEXT_MINS = 120
export const GROUPS = ['late', 'now', 'next', 'later']
const BIG_PARTY = 8
// The week ahead (local info): this many days from the feed's day, and at
// most this many headlines (the rest are counted, and on the Local info page).
const WEEK_DAYS = 7
const HEADLINES = 5
// Cash-ups: the day's own and the days before it that aren't submitted, this
// many days back (earlier days only once the venue uses Cash Recon these weeks).
const CASH_DAYS_BACK = 7

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
export const AREAS = {
  food_safety: 'food_safety',
  checklists: 'checklists',
  hs_actions: 'hs_action_log',
  purchasing: 'purchasing',
  cash: 'cash_recon',
  wages: 'cash_recon',
  online_orders: 'web_orders',
  report_alerts: 'reports',
  // Pepper-first step 5d: six more sources.
  failed_emails: 'email_templates',
  reviews: 'website',
  screens: 'screens',
  devices: 'pos_setup',
  sold_out: 'web_orders',
  rota: 'rota',
  // Inventory phase 4a: a count due on the count day, counts to approve; 4b: transfers to receive.
  stock: 'stock',
}

/** The module a task belongs to: its area's, or Purchasing approval for orders to approve. */
export const moduleOf = t => (t.kind === 'orders_to_approve' ? 'purchasing_approve' : AREAS[t.area])

/**
 * When a venue closes on a day, from the booking schedule's sittings
 * (doors close, else last orders): the latest of them. A sitting closing
 * after midnight counts as 23:59. Null when the day has no sittings.
 */
export function closingTime(sittings) {
  let last = null
  for (const x of sittings || []) {
    let close = hhmm(x.doors_close_time) || hhmm(x.closes_at)
    if (!close) continue
    const opens = hhmm(x.opens_at)
    if (opens && close < opens) close = '23:59'
    if (!last || close > last) last = close
  }
  return last
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

// A source's reads shared with another source on the same feed (the tech
// board, the day's sittings): worked out once per feed.
const once = (s, key, fn) => (s.memo[key] ||= fn())

/** The day's sittings (the booking schedule), or null when they can't be read. */
const sittingsOf = (ctx, v, s) => once(s, 'sittings', () =>
  callApi(ctx, 'GET', `/api/venues/${v.id}/schedule/sittings-for-date?date=${s.date}`).then(r => r.sittings || []).catch(() => null))

const SEEN_TODAY_MS = 24 * 3600_000
const SEEN_LATELY_MS = 3 * 3600_000
/**
 * Whether kit that isn't answering is worth a task now (screens, devices):
 * only on today's feed; while the venue trades (its first sitting less
 * OPEN_EARLY_MINS to its closing time) for kit seen in the last day; when the
 * day has no sittings to go by, only kit seen in the last three hours (it
 * dropped, rather than was switched off at close).
 */
const OPEN_EARLY_MINS = 30
async function offlineMatters(ctx, v, s, lastSeenAt) {
  if (s.date !== s.today || !lastSeenAt) return false
  const age = Date.now() - new Date(lastSeenAt).getTime()
  const sittings = await sittingsOf(ctx, v, s)
  const close = sittings?.length ? closingTime(sittings) : null
  const opens = (sittings || []).map(x => hhmm(x.opens_at)).filter(Boolean).sort()[0]
  if (!close || !opens) return age < SEEN_LATELY_MS
  const from = Math.max(0, mins(opens) - OPEN_EARLY_MINS)
  return mins(s.now) >= from && s.now <= close && age < SEEN_TODAY_MS
}
const lastSeenText = (at, tz) => 'Last seen ' + localParts(at, tz).time

const SOURCES = {
  async food_safety(ctx, v, s) {
    const q = path => callApi(ctx, 'GET', `/api/food-safety/${path}${path.includes('?') ? '&' : '?'}venue_id=${v.id}`)
    const [equipment, times, temps, stations, holdTimes, holds, sessions, cooking, deliveries] = await Promise.all([
      q('equipment'), q('capture-times'), q('temp-logs?date=' + s.date),
      q('hold-stations'), q('hold-capture-times'), q('holds?date=' + s.date),
      q('cooking-sessions'), q('cooking?date=' + s.date), q('deliveries?date=' + s.date),
    ])
    const tasks = []
    // Gaps in the set-up the feed can see (Home's suggestions, step 7a): no
    // fridges means no fridge checks will ever be due; fridges with no check
    // times, the same. Set up from Food safety's H&S settings.
    const fridges = equipment.filter(u => u.is_active !== false)
    if (!fridges.length) {
      s.gaps.push({ key: 'no_fridges', module: 'food_safety', path: '/food-safety', reason: 'No fridges set up at ' + v.name + ' yet' })
    } else if (!times.some(t => t.is_active !== false)) {
      s.gaps.push({ key: 'no_check_times', module: 'food_safety', path: '/food-safety', reason: 'No fridge check times set at ' + v.name })
    }
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

  // Report alerts (phase 5): a schedule whose condition was met today raised
  // a task here (delivery.today). Gone the next day; the report is the action.
  async report_alerts(ctx, v, s) {
    const { alerts } = await callApi(ctx, 'GET', `/api/reports/alerts?venue_id=${v.id}&date=${s.date}`)
    return alerts.map(a => ({
      key: 'report_alert:' + a.schedule_id, area: 'report_alerts', kind: 'report_alert',
      title: a.name,
      detail: a.condition_text === 'Every time' ? 'Sent by its schedule' : a.condition_text.replace(/^Only when /, ''),
      due: null, group: 'now',
      action: { path: '/reports/' + encodeURIComponent(a.report.id), label: 'Open the report' },
    }))
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

  // The cash-ups to do (R2: gone once submitted): the day's own, due when
  // the venue closes; yesterday's; and earlier days of the last week that
  // were never submitted, once the venue uses Cash Recon (a cash-up on any
  // day of these two weeks). Closed days need none. Each opens in place.
  // A venue that submits once a week (migration 259): a day is done once it
  // has figures, and last week's days still to submit are one task, from
  // the Monday (late from the Tuesday).
  async cash(ctx, v, s) {
    const days = Array.from({ length: CASH_DAYS_BACK + 1 }, (_, i) => addDays(s.date, i - CASH_DAYS_BACK))
    const open = await withTenant(ctx.tenantId, tx => openDatesOrNull(tx, ctx.tenantId, v.id, days))
    const isOpen = d => !open || open.includes(d)
    const monday = mondayOf(s.date)
    const weeks = await Promise.all([addDays(monday, -7), monday].map(w =>
      callApi(ctx, 'GET', `/api/venues/${v.id}/cash-recon/week/${w}`)))
    const status = new Map(weeks.flatMap(w => w.days || []).map(x => [x.date, x.status]))
    const inUse = [...status.values()].some(Boolean)
    const weekly = weeks[1]?.submit_mode === 'weekly'
    const yesterday = addDays(s.date, -1)
    const tasks = []
    if (weekly) {
      const lastMonday = addDays(monday, -7)
      const toSubmit = (weeks[0]?.days || []).filter(x => x.status === 'draft')
      if (toSubmit.length && s.date >= monday && monday <= s.today) {
        tasks.push({
          key: 'cash_week:' + lastMonday, area: 'cash', kind: 'cash_week', compliance: false,
          title: 'Submit last week\'s cash-up',
          detail: plural(toSubmit.length, 'day') + ' to submit, week of ' + shortDate(lastMonday),
          due: null, group: s.date > monday ? 'late' : 'now',
          action: { path: '/cash-recon', label: 'Open the week', ref: { week: lastMonday } },
        })
      }
    }
    for (const day of days) {
      if (!isOpen(day) || status.get(day) === 'submitted') continue
      // Weekly: a day with figures is done until the week is submitted.
      if (weekly && status.get(day)) continue
      // A day before the feed's is missed only once it has passed (a feed
      // for tomorrow doesn't count today as missed).
      if (day !== s.date && day >= s.today) continue
      if (day < yesterday && !inUse) continue
      const started = !!status.get(day)
      const action = { form: 'cash_up', label: started ? 'Carry on' : 'Do the cash-up', ref: { date: day } }
      if (day === s.date) {
        const sittings = await callApi(ctx, 'GET', `/api/venues/${v.id}/schedule/sittings-for-date?date=${day}`)
          .then(r => r.sittings).catch(() => [])
        const due = closingTime(sittings)
        const past = s.date < s.today
        tasks.push({
          key: 'cash_up:' + day, area: 'cash', kind: 'cash_up', compliance: false,
          title: s.date === s.today ? 'Today\'s cash-up' : 'Cash-up for ' + weekday(day),
          detail: started ? 'Started, not submitted' : weekly ? 'Not started (the week is submitted on Monday)' : 'Not started',
          due, group: past ? 'late' : due ? groupFor(due, s.now) : 'later',
          action,
        })
      } else {
        tasks.push({
          key: 'cash_up:' + day, area: 'cash', kind: 'cash_up', compliance: false,
          title: 'Cash-up for ' + (day === yesterday ? weekday(day) : shortDate(day)) + (weekly ? ' not done' : ' not submitted'),
          detail: started ? 'Started, not submitted' : 'Not started',
          due: null, group: 'late',
          action,
        })
      }
    }
    return tasks
  },

  // Last week's cash wages not all paid: cash due (total less bank) above
  // what was paid. They are paid in their own week, so by now they are late.
  async wages(ctx, v, s) {
    const week = addDays(mondayOf(s.date), -7)
    const report = await callApi(ctx, 'GET', `/api/venues/${v.id}/cash-recon/wages/${week}`)
    const unpaid = (report?.entries || []).map(e => Math.max(0,
      Math.round((num(e.total) || 0) * 100) - Math.round((num(e.bank_amount) || 0) * 100) - Math.round((num(e.cash_amount) || 0) * 100)))
    const owed = unpaid.filter(p => p > 0)
    if (!owed.length) return []
    const total = owed.reduce((a, b) => a + b, 0) / 100
    return [{
      key: 'wages:' + week, area: 'wages', kind: 'wages_to_pay', compliance: false,
      title: 'Wages to pay for the week of ' + shortDate(week),
      detail: (money(total) || '£' + total.toFixed(2)) + ' cash still to pay · ' + plural(owed.length, 'person', 'people'),
      due: null, group: 'late',
      action: { form: 'wages', label: 'Pay wages', ref: { week } },
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

  // Booking emails that failed or bounced on the feed's day (Email monitor's
  // log, read as the person). A failed email stays failed in the log, so
  // these are done by hand (MANUAL_DONE_KINDS) once someone has dealt with it.
  async failed_emails(ctx, v, s) {
    const rows = await callApi(ctx, 'GET', `/api/email-monitoring/log?venue_id=${v.id}&limit=200`)
    return rows
      .filter(e => ['failed', 'bounced'].includes(e.status) && e.venue_id === v.id && localParts(e.created_at, v.timezone).date === s.date)
      .slice(0, 10)
      .map(e => ({
        key: 'email_failed:' + e.id, area: 'failed_emails', kind: 'failed_email', compliance: false,
        title: 'Booking email ' + (e.status === 'bounced' ? 'bounced' : 'failed') + (e.guest_name ? ' for ' + e.guest_name : ''),
        detail: [e.subject, e.recipient, e.error ? String(e.error).slice(0, 80) : null].filter(Boolean).join(' · '),
        due: null, group: 'now',
        action: { path: '/email-monitoring', label: 'Look at it' },
      }))
  },

  // Reviews waiting in the To check inbox (Reviews): one task each, low
  // ratings now, the rest later. Gone once checked.
  async reviews(ctx, v, s) {
    const rows = await callApi(ctx, 'GET', `/api/reviews?venue_id=${v.id}&to_check=true&limit=10&sort=newest`)
    return rows.slice(0, 10).map(r => ({
      key: 'review:' + r.id, area: 'reviews', kind: 'review_to_check', compliance: false,
      title: 'Review to check: ' + r.rating + (Number(r.rating) === 1 ? ' star' : ' stars') + (r.reviewer_name ? ' from ' + r.reviewer_name : ''),
      detail: [r.platform, r.review_text ? String(r.review_text).replace(/\s+/g, ' ').slice(0, 90) : null].filter(Boolean).join(' · '),
      due: null, group: Number(r.rating) <= 2 ? 'now' : 'later',
      action: { path: '/reviews', label: 'Check it' },
    }))
  },

  // Menu screens that stopped answering while the venue trades (the Tech
  // board's own rule for online, shared/techBoard.js). Done by hand, or gone
  // once it answers again.
  async screens(ctx, v, s) {
    const board = await once(s, 'board', () => callApi(ctx, 'GET', `/api/tech-board/venues/${v.id}`))
    const out = []
    for (const x of board.screens || []) {
      if (!x.paired || x.state !== 'offline' || !(await offlineMatters(ctx, v, s, x.last_seen_at))) continue
      out.push({
        key: 'screen_offline:' + x.id, area: 'screens', kind: 'screen_offline', compliance: false,
        title: 'Menu screen offline: ' + x.name,
        detail: lastSeenText(x.last_seen_at, v.timezone) + ' · it keeps showing what it had; check its power and Wi-Fi',
        due: null, group: 'now',
        action: { path: '/pos/board', label: 'Look at it' },
      })
    }
    return out
  },

  // Tills, kitchen screens, kiosks and the venue hub that stopped answering
  // while the venue trades (the Tech board, shared/techBoard.js deviceOnline()).
  async devices(ctx, v, s) {
    const board = await once(s, 'board', () => callApi(ctx, 'GET', `/api/tech-board/venues/${v.id}`))
    const names = { till: 'Till', kds: 'Kitchen screen', kiosk: 'Kiosk', hub: 'Venue hub' }
    const out = []
    for (const d of board.devices || []) {
      if (!d.paired || deviceOnline(d) || !(await offlineMatters(ctx, v, s, d.last_seen_at))) continue
      out.push({
        key: 'device_offline:' + d.id, area: 'devices', kind: 'device_offline', compliance: false,
        title: (names[d.kind] || 'Device') + ' offline: ' + d.name,
        detail: lastSeenText(d.last_seen_at, v.timezone),
        due: null, group: 'now',
        action: { path: '/pos/board', label: 'Look at it' },
      })
    }
    return out
  },

  // Dishes sold out (on the till, online and menu screens), one task each:
  // put back on when there is more. Later, unless sold out since an earlier day.
  async sold_out(ctx, v, s) {
    const av = await callApi(ctx, 'GET', `/api/orders/availability/${v.id}`)
    const seen = new Map()
    for (const m of av.menus || []) for (const sec of m.sections || []) for (const i of sec.items || []) {
      if (!(i.sold_out || i.sold_out_until)) continue
      const name = String(i.name).trim()
      if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), i)
    }
    return [...seen.values()].slice(0, 10).map(i => ({
      key: 'sold_out:' + i.id, area: 'sold_out', kind: 'sold_out', compliance: false,
      title: i.name + ' is sold out',
      detail: i.sold_out_until ? 'Back on by itself at ' + localParts(i.sold_out_until, v.timezone).time + ' unless put back sooner' : 'Until someone puts it back',
      due: null, group: 'later',
      action: { form: 'sold_out', label: 'Put back on' },
    }))
  },

  // Next week's rota still empty from Thursday (late from Saturday), at a
  // venue with people on its rota. Gone once anyone is on it.
  async rota(ctx, v, s) {
    const day = new Date(s.date + 'T12:00:00Z').getUTCDay()   // 0 Sunday .. 6 Saturday
    if (![4, 5, 6, 0].includes(day)) return []
    const next = addDays(mondayOf(s.date), 7)
    const week = await callApi(ctx, 'GET', `/api/rota/venues/${v.id}/weeks/${next}`)
    if (!(week.staff || []).length || (week.entries || []).length) return []
    return [{
      key: 'rota_next_week:' + next, area: 'rota', kind: 'rota_not_ready', compliance: false,
      title: 'Next week\'s rota is empty',
      detail: 'Week of ' + shortDate(next) + ' · nobody is on it yet',
      due: null, group: day === 6 || day === 0 ? 'late' : 'now',
      action: { path: pageLink('/rota', { venue: v.id, week: next }), label: 'Do the rota' },
    }]
  },

  // Stock (inventory phase 4a): the count due on the venue's count day (a
  // stock setting) until that day's count, of the kind the venue counts, is
  // submitted (never a quick count of a few items), and counts waiting for
  // approval, for whoever may approve them (Stock manage, and not the counter
  // when a second person must approve). Phase 4b: each transfer sent to the
  // venue and not received yet, for whoever may receive it (Stock use). From
  // /api/stock as the person. The phone opens /stock links on its count page,
  // a transfer on the office's Stock page (admin/src/mobile/today.js).
  async stock(ctx, v, s) {
    const t = await callApi(ctx, 'GET', `/api/stock/venues/${v.id}/today?date=${s.date}`)
    const tasks = []
    if (t.count_due && !s.closed && t.can_count) {
      const key = t.settings.count_kind === 'key'
      tasks.push({
        key: 'stock_count:' + v.id + ':' + s.date, area: 'stock', kind: 'stock_count_due', compliance: false,
        title: key ? 'Key items count due' : 'Stock count due',
        detail: t.draft ? 'Started: carry on counting, then submit it' : weekday(s.date) + ' is the count day',
        due: null, group: 'now',
        action: { path: '/stock?tab=counts&venue=' + v.id + (t.draft ? '&count=' + t.draft.id : ''), label: t.draft ? 'Carry on' : 'Start the count' },
      })
    }
    for (const c of t.waiting.filter(x => x.can_approve)) {
      tasks.push({
        key: 'stock_approve:' + c.id, area: 'stock', kind: 'stock_count_to_approve', compliance: false,
        title: (c.kind === 'key' ? 'Key items count' : 'Stock count') + ' to approve',
        detail: 'Submitted' + (c.submitted_by ? ' by ' + c.submitted_by : '') + (c.submitted_at ? ' on ' + shortDate(localParts(c.submitted_at, v.timezone).date) : ''),
        due: null, group: 'now',
        action: { path: '/stock?tab=counts&venue=' + v.id + '&count=' + c.id, label: 'Review it' },
      })
    }
    for (const x of t.can_count ? t.incoming || [] : []) {
      tasks.push({
        key: 'stock_transfer:' + x.id, area: 'stock', kind: 'stock_transfer_to_receive', compliance: false,
        title: 'Transfer to receive from ' + x.from_name,
        detail: 'Transfer ' + x.number + ' · ' + x.lines + (x.lines === 1 ? ' item' : ' items') + ' · sent ' + shortDate(localParts(x.sent_at, v.timezone).date) + (x.sent_by ? ' by ' + x.sent_by : ''),
        due: null, group: 'now',
        action: { path: '/stock?tab=transfers&venue=' + v.id + '&transfer=' + x.id, label: 'Receive it' },
      })
    }
    return tasks
  },
}

/**
 * The day's sales so far, by till (sales import phase 4): our till's net
 * sales for its trading day of that date (the till's own day figures) and
 * another till's stored sales (Loyverse: its net sales, after refunds, from
 * GET /api/integrations/venues/:id/day), each through its route as the
 * person. { total_pence, currency, sources: [{ key, label, net_pence,
 * synced }] }, or null when no till has a day for it.
 */
async function daySales(ctx, v, date) {
  const [days, other] = await Promise.all([
    callApi(ctx, 'GET', `/api/pos/venues/${v.id}/days?limit=14`).catch(() => []),
    callApi(ctx, 'GET', `/api/integrations/venues/${v.id}/day?date=${date}`).catch(() => null),
  ])
  const sources = []
  const ours = (days || []).find(d => d.business_date === date)
  if (ours) {
    const r = await callApi(ctx, 'GET', `/api/pos/venues/${v.id}/days/${ours.id}`)
    sources.push({ key: 'macaroonie', label: 'Till', net_pence: Number(r.figures?.sales?.net) || 0, synced: true })
  }
  if (other?.linked && (other.synced || other.figures.receipts)) {
    sources.push({ key: other.system, label: other.label, net_pence: other.figures.net_sales, synced: !!other.covered })
  }
  if (!sources.length) return null
  return { total_pence: sources.reduce((n, x) => n + x.net_pence, 0), currency: v.currency || other?.currency || 'GBP', sources }
}

/**
 * H2: the day at a glance (bookings and who is working, from Pepper's own
 * reading tools) and the week ahead (the weather and local news from Local
 * info, through its own route as the person: weekAhead() in shared/localInfo.js).
 */
async function summary(ctx, v, s) {
  const tool = (list, name) => list.find(t => t.name === name)
  const can = module => (s.levels[module] || 'none') !== 'none'
  const out = {}
  const [bookings, staff, local, sales] = await Promise.allSettled([
    can('bookings') ? tool(staffTools, 'day_overview').run(ctx, { venue_id: v.id, date: s.date }) : null,
    can('rota') ? tool(rotaTools, 'whos_working').run(ctx, { venue: v.id, date: s.date }) : null,
    can('local_info')
      ? callApi(ctx, 'GET', `/api/local-info/items?venue_id=${v.id}&from=${s.date}&to=${addDays(s.date, WEEK_DAYS - 1)}`)
      : null,
    can('pos_reports') ? daySales(ctx, v, s.date) : null,
  ])
  if (sales.status === 'fulfilled' && sales.value) out.sales = sales.value
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
  if (local.status === 'fulfilled' && local.value) {
    out.local = weekAhead(local.value.items || [], s.date, { days: WEEK_DAYS, headlines: HEADLINES })
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
  const s = { date: day, now: at, today: now.date, closed, levels, memo: {}, gaps: [] }

  const tasks = []
  const notIncluded = []
  const errors = []
  await Promise.all(Object.entries(SOURCES).map(async ([area, fn]) => {
    if ((levels[AREAS[area]] || 'none') === 'none') { notIncluded.push(area); return }
    try {
      for (const t of await fn(ctx, venue, s)) {
        // can_act: the person can do it here, not only look (U1): Use where
        // the module offers it (checks, checklists, H&S actions), else Manage.
        // can_change: the person can assign, snooze or skip it (the task
        // store): Use where the module offers it, else Manage (stateLevel()).
        const module = moduleOf(t)
        tasks.push({ ...t, can_act: permissionAtLeast(levels[module], workLevel(module)), can_change: canChange(levels, module) })
      }
    } catch (err) {
      if (err instanceof ToolError && err.status === 403) notIncluded.push(area)
      else errors.push({ area, message: err instanceof ToolError ? err.message : 'Couldn\'t load this part' })
    }
  }))

  // C6: one card per key, whichever source found it.
  const byKey = new Map()
  for (const t of tasks) if (!byKey.has(t.key)) byKey.set(t.key, t)
  // The task store: owners shown, snoozed / skipped / done set aside.
  const states = await loadStates(ctx.tenantId, venue.id)
  const applied = applyStates([...byKey.values()], states, {
    date: day, isToday: day === now.date, me: ctx.principal?.sub || null, tz: venue.timezone, today: now.date,
  })
  const list = sortTasks(applied.tasks)
  const counts = Object.fromEntries(GROUPS.map(g => [g, list.filter(t => t.group === g).length]))

  return {
    venue: { id: venue.id, name: venue.name, timezone: venue.timezone },
    date: day, day: longDate(day), now: at, is_today: day === now.date, closed,
    summary: await summary(ctx, venue, s).catch(() => ({})),
    tasks: list, counts, aside: applied.aside,
    ...(s.gaps.length ? { gaps: s.gaps } : {}),
    ...(notIncluded.length ? { not_included: notIncluded.sort() } : {}),
    ...(errors.length ? { errors } : {}),
  }
}

/** The modules the feed reads, for permissionLevels(). */
export const OPS_MODULES = [...new Set([...Object.values(AREAS), 'purchasing_approve', 'bookings', 'rota', 'local_info', 'pos_reports'])]
