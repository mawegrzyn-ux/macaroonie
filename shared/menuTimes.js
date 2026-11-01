// shared/menuTimes.js
//
// Menu times (migration 230): when each menu is on at a venue, for the
// website (online ordering), the self-order kiosks and the tills, in one
// table (Menus > Menu times, routes/menuTimes.js). One set of rules for the
// API (online ordering's schedules, the till and kiosk configs), the admin
// page and the till and kiosk apps. Schedules themselves (dates, days and
// times of day) are shared/menuSchedule.js's.
//
// A venue's row for a menu:
//   { menu_id,
//     times,                  the menu's own times (a schedule; null = any time)
//     web:   { use, times },  online ordering
//     kiosk: { use, times },  self-order kiosks
//     till:  { use, times } } tills
// use  'off'     not on that channel
//      'menu'    the menu's own times (the usual)
//      'always'  any time on that channel
//      'own'     the channel's own times (its times)
//
// No row: the menu is on the tills and kiosks at any time. Online it is on
// when ordering_settings.menu_ids names it: the website's on / off is that
// list (the page's Website column writes it), so a stored web cell is never
// 'off'.
//
// Several menus can be on at once on a channel: a till and a kiosk show all
// of them (their sections one after another), online ordering lists them
// all. Menus on at the same time are a note on the page, not a refusal.

import { isScheduled, menuOnAt, scheduleLabel, scheduleError, schedulesOverlap } from './menuSchedule.js'

export const CHANNELS = ['web', 'kiosk', 'till']
export const CHANNEL_LABELS = { web: 'Website', kiosk: 'Kiosks', till: 'Tills' }
export const USES = ['off', 'menu', 'always', 'own']
export const USE_LABELS = { off: 'Off', menu: 'Menu\'s times', always: 'Any time', own: 'Own times' }
// The most times of day a schedule may have.
export const MAX_WINDOWS = 14

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-\d{2}-\d{2}$/
const toMins = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0) }
const hhmm = mins => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0')

/** A schedule tidied: { from, until, times } or null when it says nothing (any time). */
export function cleanSchedule(s) {
  if (!s || typeof s !== 'object') return null
  const from = typeof s.from === 'string' && YMD.test(s.from) ? s.from : null
  const until = typeof s.until === 'string' && YMD.test(s.until) ? s.until : null
  const times = (Array.isArray(s.times) ? s.times : []).slice(0, MAX_WINDOWS)
    .map(t => ({
      days: [...new Set((Array.isArray(t?.days) ? t.days : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b),
      start: typeof t?.start === 'string' && HM.test(t.start.slice(0, 5)) ? t.start.slice(0, 5) : null,
      end: typeof t?.end === 'string' && HM.test(t.end.slice(0, 5)) ? t.end.slice(0, 5) : null,
    }))
    .filter(t => t.start && t.end)
  const out = { from, until, times }
  return isScheduled(out) ? out : null
}

/**
 * A channel's cell tidied: { use, times }. times only with 'own'; 'own' with
 * nothing set is any time ('always'). An unknown use is the usual 'menu'.
 */
export function cleanCell(c) {
  const use = USES.includes(c?.use) ? c.use : 'menu'
  if (use !== 'own') return { use, times: null }
  const times = cleanSchedule(c.times)
  return times ? { use, times } : { use: 'always', times: null }
}

/** A row tidied (every channel, the menu's times). */
export function cleanRow(r) {
  const out = { menu_id: r?.menu_id ?? null, times: cleanSchedule(r?.times) }
  for (const ch of CHANNELS) out[ch] = cleanCell(r?.[ch])
  return out
}

/** A row that says nothing beyond the usual: stored as no row at all. Web on / off doesn't count (menu_ids). */
export function isDefaultRow(r) {
  if (cleanSchedule(r?.times)) return false
  return CHANNELS.every(ch => {
    const c = cleanCell(r?.[ch])
    return c.use === 'menu' || (ch === 'web' && c.use === 'off')
  })
}

/**
 * The times a channel follows for a menu: a schedule, null for any time,
 * false when the menu isn't on that channel. row may be missing (any time).
 */
export function channelTimes(row, channel) {
  const c = cleanCell(row?.[channel])
  if (c.use === 'off') return false
  if (c.use === 'always') return null
  if (c.use === 'own') return c.times
  return cleanSchedule(row?.times)
}

/** "Mon–Fri 11:00–15:00", "Any time" or "Off": what a channel's cell means. */
export function channelLabel(row, channel) {
  const t = channelTimes(row, channel)
  if (t === false) return 'Off'
  if (t === null) return 'Any time'
  return scheduleLabel(t)
}

/** "Mon–Fri 11:00–15:00" or "Any time": a schedule (null = any time). */
export const timesLabel = t => (isScheduled(t) ? scheduleLabel(t) : 'Any time')

/**
 * Menus on at venue-local parts ({ date, dow, minutes }): each menu as a
 * device has it, { id, times } with times its channel's (null = any time).
 * Their ids, in the menus' order.
 */
export function menusOnNow(menus, parts) {
  return (menus || []).filter(m => menuOnAt(m.times || null, parts)).map(m => m.id)
}

/**
 * Which of a till's menus to show at parts. pick: what staff chose (More >
 * Menus), { ids, basis } or null; it holds while the menus on now are the
 * ones it was picked with (basis: the day and their ids), so when lunch
 * ends the till follows the menu times again by itself.
 * Returns { ids, auto, onNow, basis, none }: none = no menu is on now, and
 * the till shows every menu rather than nothing.
 */
export function tillMenusShown(menus, parts, pick = null) {
  const list = menus || []
  const onNow = menusOnNow(list, parts)
  const basis = parts.date + '|' + onNow.join(',')
  if (pick && pick.basis === basis) {
    const known = new Set(list.map(m => m.id))
    const ids = (pick.ids || []).filter(id => known.has(id))
    if (ids.length) return { ids: list.filter(m => ids.includes(m.id)).map(m => m.id), auto: false, onNow, basis, none: !onNow.length }
  }
  return { ids: onNow.length ? onNow : list.map(m => m.id), auto: true, onNow, basis, none: !onNow.length }
}

/**
 * A tap on a menu in a till layout's Menus zone (shared/pos/tillLayout.js):
 * what the till shows next, from what it shows now (tillMenusShown() plus
 * the till's menus: { menus, ids, onNow, none }). tap 'one' shows just that
 * menu; 'several' adds it or takes it off (one always stays). Returns null
 * when nothing changes, { follow: true } when the result is what the menu
 * times show by themselves (the till goes back to following them), else
 * { ids } to pick, in the till's menu order.
 */
export function switchMenus({ menus, ids, onNow, none }, menuId, tap = 'one') {
  const all = (menus || []).map(m => m.id)
  if (!all.includes(menuId)) return null
  const cur = (ids || []).filter(id => all.includes(id))
  let next = tap === 'several'
    ? (cur.includes(menuId) ? cur.filter(id => id !== menuId) : [...cur, menuId])
    : [menuId]
  if (!next.length) return null
  next = all.filter(id => next.includes(id))
  const same = (a, b) => a.length === b.length && a.every(id => b.includes(id))
  if (same(next, none ? all : (onNow || []))) return { follow: true }
  if (same(next, cur)) return null
  return { ids: next }
}

/** The next time today (HH:MM) one of these menus ({ id, times }) comes on after parts, or null. */
export function nextStart(menus, parts) {
  let best = null
  for (const m of menus || []) {
    const s = m.times
    if (!isScheduled(s)) continue
    if (s.from && parts.date < s.from) continue
    if (s.until && parts.date > s.until) continue
    for (const t of s.times || []) {
      if (!(t.days || []).includes(parts.dow)) continue
      const start = toMins(t.start)
      if (start > parts.minutes && (best == null || start < best)) best = start
    }
  }
  return best == null ? null : hhmm(best)
}

/**
 * What stops a save: [{ menu_id, channel (null = the menu's own times), message }].
 * names: { menuId: name } for the messages.
 */
export function menuTimesProblems(rows, names = {}) {
  const out = []
  for (const r of rows || []) {
    const name = names[r.menu_id] || 'A menu'
    const own = scheduleError(r.times, name)
    if (own) out.push({ menu_id: r.menu_id, channel: null, message: own })
    for (const ch of CHANNELS) {
      const c = r[ch]
      if (c?.use !== 'own') continue
      const e = scheduleError(c.times, name + ' on ' + CHANNEL_LABELS[ch].toLowerCase())
      if (e) out.push({ menu_id: r.menu_id, channel: ch, message: e })
    }
  }
  return out
}

/**
 * Notes, not refusals: menus on at the same time on a channel (it shows
 * both), from today on. [{ channel, menu_ids: [a, b], message }]. Only menus
 * with times count: one on at any time is on alongside every other menu.
 */
export function menuTimesWarnings(rows, names = {}, today = null) {
  const out = []
  // All day from a day already here, with no end: the same as any time.
  const anyTimeNow = t => !t.times?.length && !t.until && (!t.from || (today && t.from <= today))
  for (const ch of CHANNELS) {
    const timed = (rows || [])
      .map(r => ({ id: r.menu_id, t: channelTimes(r, ch) }))
      .filter(x => x.t && !anyTimeNow(x.t))
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (!schedulesOverlap(timed[i].t, timed[j].t, today)) continue
        const a = names[timed[i].id] || 'A menu'
        const b = names[timed[j].id] || 'a menu'
        out.push({
          channel: ch, menu_ids: [timed[i].id, timed[j].id],
          message: `${a} and ${b} are on at the same time on ${CHANNEL_LABELS[ch].toLowerCase()}: both show then.`,
        })
      }
    }
  }
  return out
}
