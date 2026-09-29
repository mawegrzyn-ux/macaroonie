// shared/menuSchedule.js
//
// When a menu can be ordered online (migration 130,
// ordering_settings.menu_schedules). One implementation used by the API
// (services/orderSvc.js: which menus are on at a collection time, and
// routes/orders.js: rejecting overlaps on save) and by the admin Ordering
// setup page (live overlap check before saving).
//
// A schedule, per venue per menu:
//   { from: 'YYYY-MM-DD' | null,   first day the menu is on (null = no start)
//     until: 'YYYY-MM-DD' | null,  last day it is on (null = no end)
//     times: [{ days: [0-6], start: 'HH:MM', end: 'HH:MM' }] }
// days: 0 = Sunday, like ordering_settings.hours. No times = all day on the
// days it's in date range. No schedule (or an empty one) = always on.
// A time window must end after it starts on the same day (no overnight).
//
// A collection time at exactly a window's end still counts (11:00-15:00
// takes a 15:00 order), matching how collection slots include the closing
// time. Windows that only touch (15:00 end, 15:00 start) don't overlap.
//
// Overlaps: two scheduled menus may not be on at the same moment from
// today on (a menu that has already ended can't clash), and a menu's own
// windows may not overlap. Menus without a schedule are always
// on (e.g. drinks alongside a lunch / dinner menu) and are not checked.

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const toMins = t => {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number)
  return h * 60 + (m || 0)
}

export function isScheduled(s) {
  return !!s && (!!s.from || !!s.until || (Array.isArray(s.times) && s.times.length > 0))
}

/** Is the menu on at a venue-local date (YYYY-MM-DD), day of week and minute of the day? */
export function menuOnAt(s, { date, dow, minutes }) {
  if (!isScheduled(s)) return true
  if (s.from && date < s.from) return false
  if (s.until && date > s.until) return false
  if (!s.times?.length) return true
  return s.times.some(t => (t.days || []).includes(dow) && minutes >= toMins(t.start) && minutes <= toMins(t.end))
}

/** Is the menu on at any time of a venue-local date? */
export function menuOnDate(s, date, dow) {
  if (!isScheduled(s)) return true
  if (s.from && date < s.from) return false
  if (s.until && date > s.until) return false
  if (!s.times?.length) return true
  return s.times.some(t => (t.days || []).includes(dow))
}

function datesMeet(a, b, today) {
  const start = today || '0000-01-01'
  const aFrom = a.from && a.from > start ? a.from : start, aUntil = a.until || '9999-12-31'
  const bFrom = b.from && b.from > start ? b.from : start, bUntil = b.until || '9999-12-31'
  return aFrom <= bUntil && bFrom <= aUntil && aFrom <= aUntil && bFrom <= bUntil
}

function windowsMeet(x, y) {
  return (x.days || []).some(d => (y.days || []).includes(d))
    && toMins(x.start) < toMins(y.end) && toMins(y.start) < toMins(x.end)
}

/** Do two scheduled menus' schedules share a moment (on or after `today`, when given)? */
export function schedulesOverlap(a, b, today = null) {
  if (!isScheduled(a) || !isScheduled(b)) return false
  if (!datesMeet(a, b, today)) return false
  const aAllDay = !a.times?.length
  const bAllDay = !b.times?.length
  // A menu with no times is on all day, every day of its date range, so it
  // meets any other menu that is on at all in that range.
  if (aAllDay && bAllDay) return true
  if (aAllDay) return b.times.some(t => t.days?.length)
  if (bAllDay) return a.times.some(t => t.days?.length)
  return a.times.some(x => b.times.some(y => windowsMeet(x, y)))
}

/** "Mon–Fri 11:00–15:00, Sat 12:00–16:00 · from 1 Jun 2026" */
export function scheduleLabel(s) {
  if (!isScheduled(s)) return ''
  const parts = []
  for (const t of s.times || []) parts.push(`${daysLabel(t.days || [])} ${t.start}–${t.end}`)
  const fmt = d => {
    const [y, m, day] = d.split('-').map(Number)
    return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`
  }
  let dates = ''
  if (s.from && s.until) dates = `${fmt(s.from)} to ${fmt(s.until)}`
  else if (s.from) dates = `from ${fmt(s.from)}`
  else if (s.until) dates = `until ${fmt(s.until)}`
  return [parts.join(', '), dates].filter(Boolean).join(' · ')
}

/** Days as ranges in Monday-first order: [1,2,3,4,5] -> "Mon–Fri", all 7 -> "Every day". */
export function daysLabel(days) {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const on = order.filter(d => days.includes(d))
  if (on.length === 7) return 'Every day'
  const runs = []
  for (const d of on) {
    const last = runs[runs.length - 1]
    if (last && order.indexOf(d) === order.indexOf(last[last.length - 1]) + 1) last.push(d)
    else runs.push([d])
  }
  return runs.map(r => (r.length > 2 ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r[r.length - 1]]}` : r.map(d => DAY_SHORT[d]).join(', '))).join(', ')
}

/**
 * First problem with the schedules of the chosen menus, or null.
 * @param {string[]} menuIds   chosen menus, in order
 * @param {object}   schedules { menuId: schedule }
 * @param {object}   names     { menuId: name } for messages
 * @param {string}   today     YYYY-MM-DD; clashes before it are ignored
 */
export function scheduleProblem(menuIds, schedules, names = {}, today = null) {
  const name = id => names[id] || 'A menu'
  const list = menuIds.filter(id => isScheduled(schedules?.[id]))
  for (const id of list) {
    const s = schedules[id]
    if (s.from && s.until && s.from > s.until) return `${name(id)}: the end date is before the start date.`
    for (const t of s.times || []) {
      if (!t.days?.length) return `${name(id)}: pick at least one day for each time.`
      if (!(toMins(t.end) > toMins(t.start))) return `${name(id)}: each time must end after it starts (${t.start}–${t.end}).`
    }
    const ts = s.times || []
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        if (windowsMeet(ts[i], ts[j])) return `${name(id)}: its times overlap (${ts[i].start}–${ts[i].end} and ${ts[j].start}–${ts[j].end}).`
      }
    }
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (schedulesOverlap(schedules[list[i]], schedules[list[j]], today)) {
        return `${name(list[i])} and ${name(list[j])} are both on at the same time. Change their days, times or dates so they don't overlap.`
      }
    }
  }
  return null
}
