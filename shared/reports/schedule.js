// shared/reports/schedule.js
//
// Report schedules (docs/REPORTS.md 14): when a report runs by itself, how it
// is sent, and only when. One set of rules for the API (the minute sweep and
// the routes), the admin (the schedule window) and Pepper's tools.
//
// A schedule's parts, each normalised to one known shape:
//
//   timing     { every: 'day', time }
//              { every: 'week', days: [1..7] (1 = Monday), time }
//              { every: 'month', on: { day: 1..31 | 'last' }, time }
//              { every: 'month', on: { week: 'first'..'fourth' | 'last', weekday: 1..7 }, time }
//              time is 'HH:MM' at the venue (a day the month lacks, the 31st
//              in April, runs on its last day)
//   delivery   { in_message, attach: 'none' | 'csv' | 'xlsx' | 'pdf', keep_file }
//   condition  { when: 'always' } | { when: 'rows' }
//              { when: 'figure', value, op, than, scope: 'total' | 'any' }
//              `than` is in the figure's own units, as result cells hold
//              them (money in pounds, a percentage as a fraction, a
//              duration in seconds): the screen turns what is typed into
//              them with storedNumber() (build.js)
//   recipients [{ user_id } | { email }]
//
//   normaliseTiming(t) / timingProblem(t) / timingText(t)
//   nextRunAt(timing, after, tz)   the first moment strictly after `after`
//   isLate(due, now)               missed by more than LATE_HOURS
//   normaliseDelivery(d) / deliveryProblem(d) / deliveryText(d)
//   normaliseCondition(c) / conditionProblem(c, kind, values) / conditionText(c, value)
//   conditionMet(c, result)        { met, why }
//   normaliseRecipients(list) / recipientsProblem(list)
//   periodProblem(spec, params, today)   a period that doesn't move with the date

import { zonedInstant, localDateTime } from '../localInfo.js'
import { addDays, resolvePeriod, rangeText, isYmd } from './period.js'
import { WEEKDAYS_LONG, formatValue } from './format.js'
import { resolveParams, periodParams } from './spec.js'

export const EVERY = ['day', 'week', 'month']
export const WEEKS = ['first', 'second', 'third', 'fourth', 'last']
export const ATTACH = ['none', 'csv', 'xlsx', 'pdf']
export const ATTACH_LABELS = { none: 'No file', csv: 'CSV file', xlsx: 'Excel file', pdf: 'PDF' }
// "attached as a CSV file"
export const ATTACH_WORDS = { csv: 'a CSV file', xlsx: 'an Excel file', pdf: 'a PDF' }
export const WHEN = ['always', 'rows', 'figure']
export const OPS = ['over', 'at_least', 'under', 'at_most', 'outside']
export const OP_WORDS = {
  over: 'is over', at_least: 'is at least', under: 'is under', at_most: 'is at most', outside: 'is more than',
}
export const SCOPES = ['total', 'any']
export const DEFAULT_TIME = '08:00'
// A run the server missed (it was down at the time) runs once on recovery if
// it is no later than this; else it is skipped and the next one waits.
export const LATE_HOURS = 6
export const MAX_RECIPIENTS = 50

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const int = (v, lo, hi) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

export const isEmail = s => typeof s === 'string' && s.length <= 254 && EMAIL.test(s.trim())

/* ------------------------------------------------------------------ timing */

export function normaliseTiming(raw) {
  const t = obj(raw)
  const every = EVERY.includes(t.every) ? t.every : 'day'
  const time = TIME.test(String(t.time || '')) ? t.time : DEFAULT_TIME
  if (every === 'week') {
    const days = [...new Set((Array.isArray(t.days) ? t.days : []).map(d => int(d, 1, 7)).filter(d => d != null))]
      .sort((a, b) => a - b)
    // Every day of the week is every day.
    if (days.length === 7) return { every: 'day', time }
    return { every, days, time }
  }
  if (every === 'month') {
    const on = obj(t.on)
    if (on.week != null || on.weekday != null) {
      return { every, on: { week: WEEKS.includes(on.week) ? on.week : 'first', weekday: int(on.weekday, 1, 7) ?? 1 }, time }
    }
    return { every, on: { day: on.day === 'last' ? 'last' : (int(on.day, 1, 31) ?? 1) }, time }
  }
  return { every: 'day', time }
}

/** What is wrong with a timing as given (before normalising), as a sentence, or null. */
export function timingProblem(raw) {
  const t = obj(raw)
  if (t.every != null && !EVERY.includes(t.every)) return 'Pick every day, chosen days or every month'
  if (t.time != null && !TIME.test(String(t.time))) return 'Type the time as HH:MM, like 08:00'
  if (t.every === 'week') {
    const days = (Array.isArray(t.days) ? t.days : []).filter(d => int(d, 1, 7) != null)
    if (!days.length) return 'Pick at least one day of the week'
  }
  if (t.every === 'month') {
    const on = obj(t.on)
    if (on.week != null || on.weekday != null) {
      if (!WEEKS.includes(on.week) || int(on.weekday, 1, 7) == null) return 'Pick which week of the month and which day'
    } else if (on.day !== 'last' && int(on.day, 1, 31) == null) {
      return 'Pick a day of the month from 1 to 31, or the last day'
    }
  }
  return null
}

const lastOfMonth = ymd => {
  const y = +ymd.slice(0, 4), m = +ymd.slice(5, 7)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
const weekdayOf = ymd => ((new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1

/** Whether a timing runs on a day (YYYY-MM-DD). */
export function runsOn(timing, ymd) {
  const t = normaliseTiming(timing)
  if (t.every === 'day') return true
  if (t.every === 'week') return t.days.includes(weekdayOf(ymd))
  const day = +ymd.slice(8, 10)
  const last = lastOfMonth(ymd)
  if (t.on.day != null) return t.on.day === 'last' ? day === last : day === Math.min(t.on.day, last)
  if (weekdayOf(ymd) !== t.on.weekday) return false
  if (t.on.week === 'last') return day + 7 > last
  return Math.ceil(day / 7) === WEEKS.indexOf(t.on.week) + 1
}

/**
 * The first moment strictly after `after` that the timing runs, at its time
 * in the time zone, or null for a timing that never runs (no days picked).
 * A time a clock change skips (01:30 the night clocks go forward) runs an
 * hour later; a time that happens twice runs once.
 */
export function nextRunAt(timing, after = new Date(), tz = 'Europe/London') {
  const t = normaliseTiming(timing)
  if (t.every === 'week' && !t.days.length) return null
  const from = after instanceof Date ? after : new Date(after)
  if (!Number.isFinite(from.getTime())) return null
  let zone = tz
  try { localDateTime(from, zone) } catch { zone = 'Europe/London' }
  const start = localDateTime(from, zone).date
  // A month's last weekday is at most 37 days away; a leap day 4 years.
  for (let i = 0; i <= 400; i++) {
    const day = addDays(start, i)
    if (!runsOn(t, day)) continue
    const at = zonedInstant(day, t.time, zone)
    if (at.getTime() > from.getTime()) return at
  }
  return null
}

/** Whether a run due at `due` is too late to send when the sweep gets to it at `now`. */
export function isLate(due, now = new Date()) {
  const d = due instanceof Date ? due : new Date(due)
  return now.getTime() - d.getTime() > LATE_HOURS * 3600000
}

const ordinal = n => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'
  return n + s
}
const plural = d => WEEKDAYS_LONG[d - 1] + 's'
const listWords = parts => (parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1])

/** A timing in words: "Every day at 08:00", "Mondays and Fridays at 07:30", ... */
export function timingText(timing) {
  const t = normaliseTiming(timing)
  const at = ' at ' + t.time
  if (t.every === 'day') return 'Every day' + at
  if (t.every === 'week') {
    const d = t.days
    if (!d.length) return 'No days picked'
    if (d.join() === '1,2,3,4,5') return 'Weekdays' + at
    if (d.join() === '6,7') return 'Weekends' + at
    if (d.length === 1) return 'Every ' + WEEKDAYS_LONG[d[0] - 1] + at
    return listWords(d.map(plural)) + at
  }
  if (t.on.day != null) {
    return (t.on.day === 'last' ? 'On the last day' : 'On the ' + ordinal(t.on.day)) + ' of every month' + at
  }
  return 'On the ' + t.on.week + ' ' + WEEKDAYS_LONG[t.on.weekday - 1] + ' of every month' + at
}

/* ---------------------------------------------------------------- delivery */

export function normaliseDelivery(raw) {
  const d = obj(raw)
  const attach = ATTACH.includes(d.attach) ? d.attach : 'none'
  return {
    in_message: d.in_message !== false,
    attach,
    // A file is kept only when there is one.
    keep_file: attach !== 'none' && d.keep_file === true,
    // A schedule's send also raises a task on Today (phase 5): for the
    // venues in the report's scope, to people who can open the report.
    // Stored only when on, so schedules saved before it read the same.
    ...(d.today === true ? { today: true } : {}),
  }
}

export function deliveryProblem(raw) {
  const d = normaliseDelivery(raw)
  if (!d.in_message && d.attach === 'none') return 'Put the report in the email, attach a file, or both'
  return null
}

export function deliveryText(raw) {
  const d = normaliseDelivery(raw)
  const parts = []
  if (d.in_message) parts.push('the report in the email')
  if (d.attach !== 'none') parts.push(ATTACH_WORDS[d.attach] + ' attached')
  const words = listWords(parts)
  const text = words ? words[0].toUpperCase() + words.slice(1) : 'Nothing to send'
  const kept = d.keep_file ? text + ', kept in Past runs' : text
  return d.today ? kept + ', and a task on Today' : kept
}

/* --------------------------------------------------------------- condition */

export function normaliseCondition(raw) {
  const c = obj(raw)
  const when = WHEN.includes(c.when) ? c.when : 'always'
  if (when !== 'figure') return { when }
  const than = typeof c.than === 'number' && Number.isFinite(c.than) ? Math.round(c.than * 1e8) / 1e8 : null
  return {
    when,
    value: typeof c.value === 'string' ? c.value.slice(0, 60) : null,
    op: OPS.includes(c.op) ? c.op : 'over',
    than,
    scope: SCOPES.includes(c.scope) ? c.scope : 'any',
  }
}

/**
 * What is wrong with a condition for a report of this kind with these
 * values ([{ key, label, type }]): a sentence, or null.
 */
export function conditionProblem(raw, kind, values = []) {
  const c = normaliseCondition(raw)
  if (c.when !== 'figure') return null
  if (kind !== 'summary') return 'Only a summary has figures to watch: pick Every time or Only when there are rows'
  if (!c.value || !values.some(v => v.key === c.value)) return 'Pick one of the report\'s figures to watch'
  if (c.than == null) return 'Type the figure to compare with'
  if (c.op === 'outside' && c.than < 0) return 'For "either way", type a figure of 0 or more'
  return null
}

const passes = (op, v, than) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  if (op === 'over') return v > than
  if (op === 'at_least') return v >= than
  if (op === 'under') return v < than
  if (op === 'at_most') return v <= than
  return Math.abs(v) > than
}

const valueWords = (v, col, currency) => (v == null ? 'empty' : formatValue(v, col || { type: 'number' }, { currency }))

/** A condition in words, with the figure watched ({ label, type }) when there is one. */
export function conditionText(raw, value = null, currency = null) {
  const c = normaliseCondition(raw)
  if (c.when === 'always') return 'Every time'
  if (c.when === 'rows') return 'Only when there are rows'
  const label = value?.label || 'the figure'
  const than = c.than == null ? '...' : valueWords(c.than, value, currency)
  const rest = c.op === 'outside' ? ' either way' : ''
  const where = c.scope === 'total' ? ' in total' : ' on any row'
  return 'Only when ' + label + ' ' + OP_WORDS[c.op] + ' ' + than + rest + where
}

// The rows that are the report's own: subtotals and "everything else" aren't.
const dataRows = result => (result?.rows || []).filter(r => r.kind === 'row' || r.kind == null)

/**
 * Whether a run's result meets the condition: { met, why }. `why` says, when
 * it isn't met, what was found instead (for the run's record).
 */
export function conditionMet(raw, result) {
  const c = normaliseCondition(raw)
  if (c.when === 'always') return { met: true, why: null }
  const rows = dataRows(result)
  if (c.when === 'rows') {
    // A list counts its rows. A summary counts the rows whose figures for this
    // period hold anything: one with no groupings always has its one row, a
    // compared one has rows for days only the period before had, and a
    // figure with a rule of its own reads 0 where rows exist but none count
    // (voids on a day without voids).
    const some = result?.kind === 'list' ? rows.length > 0 : rows.some(r => (r.cells || []).some((v, i) => {
      const role = result.columns?.[i]?.role
      return (role === 'value' || role === 'total') && v != null && v !== 0
    }))
    return some ? { met: true, why: null } : { met: false, why: 'There was nothing to report' }
  }
  const cols = result?.columns || []
  const i = cols.findIndex(col => col.key === c.value && col.role === 'value')
  const col = cols[i]
  if (i < 0) return { met: false, why: 'The figure it watches isn\'t in the report any more' }
  const currency = result?.meta?.currency || null
  if (c.scope === 'total') {
    // A summary with no groupings has its one row in rows, and no totals.
    const total = result?.totals?.cells ? result.totals.cells[i] : (rows.length === 1 && !(rows[0].k || []).length ? rows[0].cells[i] : null)
    if (passes(c.op, total, c.than)) return { met: true, why: null }
    return { met: false, why: col.label + ' was ' + valueWords(total, col, currency) + ' in total' }
  }
  if (rows.some(r => passes(c.op, r.cells?.[i], c.than))) return { met: true, why: null }
  return { met: false, why: 'No row\'s ' + col.label + ' ' + OP_WORDS[c.op].replace(/^is /, 'was ') + ' ' + valueWords(c.than, col, currency) + (c.op === 'outside' ? ' either way' : '') }
}

/* -------------------------------------------------------------- recipients */

/** People by their user id and addresses outside the team, each once, at most MAX_RECIPIENTS. */
export function normaliseRecipients(list) {
  const out = []
  const seen = new Set()
  for (const r0 of Array.isArray(list) ? list : []) {
    const r = obj(r0)
    let key = null
    let item = null
    if (typeof r.user_id === 'string' && UUID.test(r.user_id)) {
      key = 'u:' + r.user_id.toLowerCase()
      item = { user_id: r.user_id.toLowerCase() }
    } else if (isEmail(r.email)) {
      const email = r.email.trim().toLowerCase()
      key = 'e:' + email
      item = { email }
    }
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= MAX_RECIPIENTS) break
  }
  return out
}

export function recipientsProblem(list) {
  const raw = Array.isArray(list) ? list : []
  for (const r0 of raw) {
    const r = obj(r0)
    if (r.email != null && !isEmail(r.email)) return String(r.email).slice(0, 80) + ' isn\'t an email address'
    if (r.email == null && !(typeof r.user_id === 'string' && UUID.test(r.user_id))) return 'Pick each person from your team, or type an email address'
  }
  if (!normaliseRecipients(raw).length) return 'Add at least one person to send it to'
  if (raw.length > MAX_RECIPIENTS) return 'Send it to ' + MAX_RECIPIENTS + ' people at most'
  return null
}

/* ------------------------------------------------------------------ period */

/**
 * A schedule must run over a period that moves with the date: one fixed to
 * days (1 to 7 November) would send the same days every time. Looks at every
 * period the report asks for, with the schedule's own choices.
 */
export function periodProblem(spec, params, today = null) {
  const keys = periodParams(spec)
  if (!keys.length) return null
  const given = resolveParams(spec, params || {})
  for (const key of keys) {
    const p = given[key]
    if (p && p.from && p.to) {
      const r = isYmd(today) ? resolvePeriod(p, today) : null
      return 'The period is fixed (' + (r ? rangeText(r.from, r.to) : p.from + ' to ' + p.to)
        + '), so every email would show the same days. Pick one that moves with the date, like yesterday or last week'
    }
  }
  return null
}
