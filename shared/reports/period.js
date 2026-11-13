// shared/reports/period.js
//
// Periods for reports (docs/REPORTS.md 5.5, 6): "last week" is kept as
// "last week" in a saved report and turned into two dates when it runs.
// Dates are plain 'YYYY-MM-DD' strings: every subject's report date is
// already a day at its venue (a trading day, a service date, the local day
// of a booking), so a period is the same pair of dates for every venue.
// Weeks run Monday to Sunday, as everywhere else in the app.
//
// One implementation for the API (the engine), the admin (the period
// picker's labels) and Pepper.

export const RELATIVE_PERIODS = [
  'today', 'yesterday', 'tomorrow',
  'this_week', 'last_week', 'next_week', 'week_to_date',
  'this_month', 'last_month', 'next_month', 'month_to_date',
  'this_quarter', 'last_quarter', 'quarter_to_date',
  'this_year', 'last_year', 'year_to_date',
  'last_n_days', 'next_n_days',
]

export const PERIOD_LABELS = {
  today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow',
  this_week: 'This week', last_week: 'Last week', next_week: 'Next week', week_to_date: 'This week so far',
  this_month: 'This month', last_month: 'Last month', next_month: 'Next month', month_to_date: 'This month so far',
  this_quarter: 'This quarter', last_quarter: 'Last quarter', quarter_to_date: 'This quarter so far',
  this_year: 'This year', last_year: 'Last year', year_to_date: 'This year so far',
  last_n_days: 'Last N days', next_n_days: 'Next N days',
}

export const MAX_PERIOD_DAYS = 3700
export const MAX_N_DAYS = 730

const YMD = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const toDate = ymd => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)))
const toYmd = d => d.toISOString().slice(0, 10)

/** A real calendar day written YYYY-MM-DD. */
export function isYmd(v) {
  return typeof v === 'string' && YMD.test(v) && toYmd(toDate(v)) === v
}

export function addDays(ymd, n) {
  const d = toDate(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return toYmd(d)
}

/** The same day n months on; a day the month lacks becomes its last day (31 Jan + 1 = 28 Feb). */
export function addMonths(ymd, n) {
  const y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1, day = +ymd.slice(8, 10)
  const first = new Date(Date.UTC(y, m + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(day, last))
  return toYmd(first)
}

export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000)

/** Monday of the week a day is in. */
export function mondayOf(ymd) {
  const dow = (toDate(ymd).getUTCDay() + 6) % 7
  return addDays(ymd, -dow)
}
const monthStart = ymd => ymd.slice(0, 8) + '01'
const monthEnd = ymd => addDays(addMonths(monthStart(ymd), 1), -1)
const quarterStart = ymd => ymd.slice(0, 5) + String(Math.floor((+ymd.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01'
const quarterEnd = ymd => addDays(addMonths(quarterStart(ymd), 3), -1)
const yearStart = ymd => ymd.slice(0, 4) + '-01-01'
const yearEnd = ymd => ymd.slice(0, 4) + '-12-31'

/** Today's date in a time zone ('Europe/London'), as YYYY-MM-DD. */
export function todayIn(timeZone = 'Europe/London', now = new Date()) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  }
  const v = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return v.year + '-' + v.month + '-' + v.day
}

/**
 * A period as a definition may hold it: { relative, n? } or { from, to },
 * or null when it is neither. Fixed ranges are put the right way round and
 * cut to MAX_PERIOD_DAYS.
 */
export function normalisePeriod(p) {
  if (!p || typeof p !== 'object') return null
  if (typeof p.relative === 'string') {
    if (!RELATIVE_PERIODS.includes(p.relative)) return null
    if (p.relative === 'last_n_days' || p.relative === 'next_n_days') {
      const n = Math.round(Number(p.n))
      if (!Number.isFinite(n) || n < 1) return null
      return { relative: p.relative, n: Math.min(n, MAX_N_DAYS) }
    }
    return { relative: p.relative }
  }
  if (isYmd(p.from) && isYmd(p.to)) {
    let [from, to] = p.from <= p.to ? [p.from, p.to] : [p.to, p.from]
    if (daysBetween(from, to) > MAX_PERIOD_DAYS) from = addDays(to, -MAX_PERIOD_DAYS)
    return { from, to }
  }
  return null
}

/**
 * The two dates a period means on `today` (a YYYY-MM-DD at the venue), both
 * included, with `step`: how far back the period before it is.
 */
export function resolvePeriod(period, today) {
  const p = normalisePeriod(period)
  if (!p || !isYmd(today)) return null
  if (!p.relative) {
    const f = fixedStep(p.from, p.to)
    return { from: p.from, to: p.to, step: f.step, ...(f.whole ? { whole: true } : {}) }
  }
  const week = mondayOf(today)
  switch (p.relative) {
    case 'today':     return { from: today, to: today, step: { unit: 'day', n: 1 } }
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1), step: { unit: 'day', n: 1 } }
    case 'tomorrow':  return { from: addDays(today, 1), to: addDays(today, 1), step: { unit: 'day', n: 1 } }
    case 'this_week': return { from: week, to: addDays(week, 6), step: { unit: 'day', n: 7 } }
    case 'last_week': return { from: addDays(week, -7), to: addDays(week, -1), step: { unit: 'day', n: 7 } }
    case 'next_week': return { from: addDays(week, 7), to: addDays(week, 13), step: { unit: 'day', n: 7 } }
    case 'week_to_date': return { from: week, to: today, step: { unit: 'day', n: 7 } }
    case 'this_month': return { from: monthStart(today), to: monthEnd(today), step: { unit: 'month', n: 1 }, whole: true }
    case 'last_month': { const d = addMonths(monthStart(today), -1); return { from: d, to: monthEnd(d), step: { unit: 'month', n: 1 }, whole: true } }
    case 'next_month': { const d = addMonths(monthStart(today), 1); return { from: d, to: monthEnd(d), step: { unit: 'month', n: 1 }, whole: true } }
    case 'month_to_date': return { from: monthStart(today), to: today, step: { unit: 'month', n: 1 } }
    case 'this_quarter': return { from: quarterStart(today), to: quarterEnd(today), step: { unit: 'month', n: 3 }, whole: true }
    case 'last_quarter': { const d = addMonths(quarterStart(today), -3); return { from: d, to: quarterEnd(d), step: { unit: 'month', n: 3 }, whole: true } }
    case 'quarter_to_date': return { from: quarterStart(today), to: today, step: { unit: 'month', n: 3 } }
    case 'this_year': return { from: yearStart(today), to: yearEnd(today), step: { unit: 'month', n: 12 }, whole: true }
    case 'last_year': { const d = addMonths(yearStart(today), -12); return { from: d, to: yearEnd(d), step: { unit: 'month', n: 12 }, whole: true } }
    case 'year_to_date': return { from: yearStart(today), to: today, step: { unit: 'month', n: 12 } }
    case 'last_n_days': return { from: addDays(today, -p.n), to: addDays(today, -1), step: { unit: 'day', n: p.n } }
    case 'next_n_days': return { from: today, to: addDays(today, p.n - 1), step: { unit: 'day', n: p.n } }
    default: return null
  }
}

// A chosen range that is whole calendar months steps back by that many
// months (October against September, whatever their lengths); any other
// range by its own number of days.
function fixedStep(from, to) {
  if (from === monthStart(from) && to === monthEnd(to)) {
    const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1
    return { step: { unit: 'month', n: months }, whole: true }
  }
  return { step: { unit: 'day', n: daysBetween(from, to) + 1 }, whole: false }
}

/**
 * The period a report is compared with: the one before it
 * ('previous_period') or the same dates a year earlier ('last_year').
 * `shift` is what turns a day of that period into its day in the report's
 * own period (added to it), so the two line up row by row.
 */
export function comparePeriod(range, mode) {
  if (!range) return null
  const whole = !!range.whole
  if (mode === 'last_year') {
    return {
      from: addMonths(range.from, -12),
      to: whole ? monthEnd(addMonths(monthStart(range.to), -12)) : addMonths(range.to, -12),
      shift: { unit: 'month', n: 12 },
    }
  }
  if (mode !== 'previous_period') return null
  const step = range.step || fixedStep(range.from, range.to).step
  if (step.unit === 'month') {
    return {
      from: addMonths(range.from, -step.n),
      to: whole ? monthEnd(addMonths(monthStart(range.to), -step.n)) : addMonths(range.to, -step.n),
      shift: { unit: 'month', n: step.n },
    }
  }
  return { from: addDays(range.from, -step.n), to: addDays(range.to, -step.n), shift: { unit: 'day', n: step.n } }
}

/** "8 Nov 2026" */
export function dayText(ymd) {
  if (!isYmd(ymd)) return ''
  return +ymd.slice(8, 10) + ' ' + MONTHS[+ymd.slice(5, 7) - 1] + ' ' + ymd.slice(0, 4)
}

/** "2 to 8 Nov 2026", "28 Oct to 3 Nov 2026", "29 Dec 2025 to 4 Jan 2026"; one day as "8 Nov 2026". */
export function rangeText(from, to) {
  if (!isYmd(from) || !isYmd(to)) return ''
  if (from === to) return dayText(from)
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7)
  // Whole months and years read better by name.
  if (from === monthStart(from) && to === monthEnd(to)) {
    if (from === yearStart(from) && to === yearEnd(to) && sameYear) return from.slice(0, 4)
    if (sameMonth) return MONTHS[+from.slice(5, 7) - 1] + ' ' + from.slice(0, 4)
  }
  const a = sameMonth ? String(+from.slice(8, 10))
    : sameYear ? +from.slice(8, 10) + ' ' + MONTHS[+from.slice(5, 7) - 1]
    : dayText(from)
  return a + ' to ' + dayText(to)
}

/** What a period is called: "Last week", "Last 30 days", or its dates for a chosen range. */
export function periodName(period) {
  const p = normalisePeriod(period)
  if (!p) return ''
  if (!p.relative) return rangeText(p.from, p.to)
  if (p.relative === 'last_n_days') return p.n === 1 ? 'Yesterday' : 'Last ' + p.n + ' days'
  if (p.relative === 'next_n_days') return p.n === 1 ? 'Today' : 'Next ' + p.n + ' days'
  return PERIOD_LABELS[p.relative]
}

/** "Last week (2 to 8 Nov 2026)"; a chosen range is just its dates. */
export function periodText(period, today) {
  const p = normalisePeriod(period)
  const r = resolvePeriod(p, today)
  if (!p || !r) return ''
  if (!p.relative) return rangeText(r.from, r.to)
  return periodName(p) + ' (' + rangeText(r.from, r.to) + ')'
}
