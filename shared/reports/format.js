// shared/reports/format.js
//
// How a report's values are shown: one implementation for the screen, the
// print page and the files (CSV and Excel take the plain value, see
// plainValue()). Values arrive from the engine already in everyday units:
// money in pounds (or the venue's currency), percentages as fractions
// (0.2 = 20%), days as 'YYYY-MM-DD', moments as the venue's own wall time
// ('YYYY-MM-DDTHH:MM:SS', no time zone: a 14:05 sale reads 14:05 wherever
// the reader is), times as 'HH:MM', durations in seconds.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const VALUE_TYPES = ['text', 'number', 'money', 'percent', 'date', 'moment', 'time', 'duration', 'yesno', 'choice', 'id']
export const NUMERIC_TYPES = ['number', 'money', 'percent', 'duration']
/** How a date or moment can be grouped. */
export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year', 'weekday']
export const MOMENT_BUCKETS = [...DATE_BUCKETS, 'hour']
export const BUCKET_LABELS = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', weekday: 'Day of the week', hour: 'Hour' }

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const YMD = /^\d{4}-\d{2}-\d{2}/

const moneyFormats = new Map()
function moneyFormat(currency) {
  const c = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'GBP'
  if (!moneyFormats.has(c)) {
    let f
    try { f = new Intl.NumberFormat('en-GB', { style: 'currency', currency: c }) }
    catch { f = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }) }
    moneyFormats.set(c, f)
  }
  return moneyFormats.get(c)
}

export function formatMoney(v, currency = 'GBP') {
  if (!isNum(v)) return ''
  // No "-£0.00" for a rounding crumb.
  const n = Math.abs(v) < 0.005 ? 0 : v
  return moneyFormat(currency).format(n)
}

export function formatNumber(v, decimals = null) {
  if (!isNum(v)) return ''
  const d = decimals == null ? (Number.isInteger(v) ? 0 : Math.abs(v) < 10 ? 2 : 1) : decimals
  return v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** A fraction as a percentage: 0.153 -> "15.3%". */
export function formatPercent(v, decimals = 1) {
  if (!isNum(v)) return ''
  return (v * 100).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%'
}

/** Seconds as "45 s", "12 min", "1 h 05 min", "2 d 3 h". */
export function formatDuration(v) {
  if (!isNum(v)) return ''
  const s = Math.round(Math.abs(v))
  const sign = v < 0 ? '-' : ''
  if (s < 60) return sign + s + ' s'
  const mins = Math.round(s / 60)
  if (mins < 60) return sign + mins + ' min'
  const h = Math.floor(mins / 60), m = mins % 60
  if (h < 48) return sign + h + ' h' + (m ? ' ' + String(m).padStart(2, '0') + ' min' : '')
  const d = Math.floor(h / 24)
  return sign + d + ' d' + (h % 24 ? ' ' + (h % 24) + ' h' : '')
}

const weekdayOf = ymd => (new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay() + 6) % 7

/**
 * A day, or the start of a week, month, quarter or year, by how it was
 * grouped: "Thu 12 Nov 2026", "w/c 9 Nov 2026", "Nov 2026", "Q4 2026", "2026".
 */
export function formatDate(v, bucket = 'day') {
  if (v == null || v === '') return ''
  if (bucket === 'weekday') return WEEKDAYS_LONG[Number(v) - 1] || ''
  if (bucket === 'hour') return String(Number(v)).padStart(2, '0') + ':00'
  const s = String(v)
  if (!YMD.test(s)) return s
  const y = s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10)
  if (bucket === 'year') return y
  if (bucket === 'quarter') return 'Q' + (Math.floor((m - 1) / 3) + 1) + ' ' + y
  if (bucket === 'month') return MONTHS[m - 1] + ' ' + y
  if (bucket === 'week') return 'w/c ' + d + ' ' + MONTHS[m - 1] + ' ' + y
  return WEEKDAYS[weekdayOf(s)] + ' ' + d + ' ' + MONTHS[m - 1] + ' ' + y
}

/** A moment at its venue: "12 Nov 2026 14:05". */
export function formatMoment(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  if (!YMD.test(s)) return s
  return +s.slice(8, 10) + ' ' + MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4) + (s.length >= 16 ? ' ' + s.slice(11, 16) : '')
}

/**
 * A cell as words. `col` is the result's column: { type, bucket, labels,
 * empty, format, decimals }; `ctx.currency` the currency of money.
 */
export function formatValue(v, col = {}, ctx = {}) {
  if (v == null || v === '') return col.empty || ''
  const type = col.format || col.type
  switch (type) {
    case 'money': return formatMoney(Number(v), ctx.currency || col.currency)
    case 'percent': return formatPercent(Number(v), col.decimals ?? 1)
    case 'number': return formatNumber(Number(v), col.decimals ?? null)
    case 'duration': return formatDuration(Number(v))
    case 'date': return formatDate(v, col.bucket || 'day')
    case 'moment': return col.bucket ? formatDate(v, col.bucket) : formatMoment(v)
    case 'time': return String(v).slice(0, 5)
    case 'yesno': return v === true || v === 'true' ? 'Yes' : 'No'
    case 'choice': return col.labels?.[v] ?? String(v)
    default: return String(v)
  }
}

/**
 * A cell for a file: numbers stay numbers (money in pounds, a percentage as
 * the fraction's percent points so 15.3 reads as 15.3%), days and moments as
 * ISO text a spreadsheet understands, everything else as its words.
 */
export function plainValue(v, col = {}) {
  if (v == null || v === '') return col.empty && !NUMERIC_TYPES.includes(col.format || col.type) ? col.empty : ''
  const type = col.format || col.type
  switch (type) {
    case 'money': return Math.round(Number(v) * 100) / 100
    case 'percent': return Math.round(Number(v) * 10000) / 100
    case 'number': case 'duration': return Number(v)
    case 'date': case 'moment':
      if (col.bucket === 'weekday' || col.bucket === 'hour' || col.bucket === 'quarter' || col.bucket === 'month' || col.bucket === 'year' || col.bucket === 'week') return formatDate(v, col.bucket)
      return type === 'moment' ? String(v).replace('T', ' ').slice(0, 19) : String(v).slice(0, 10)
    case 'yesno': return v === true || v === 'true' ? 'Yes' : 'No'
    case 'choice': return col.labels?.[v] ?? String(v)
    default: return String(v)
  }
}

/** A column's heading for a file: money says its currency, a percentage its sign, a duration its unit. */
export function plainHeading(col = {}, ctx = {}) {
  const label = col.group ? col.group + ': ' + col.label : col.label
  const type = col.format || col.type
  if (type === 'percent') return label + ' (%)'
  if (type === 'duration') return label + ' (seconds)'
  if (type === 'money' && (ctx.currency || col.currency)) return label + ' (' + (ctx.currency || col.currency) + ')'
  return label
}

/**
 * A text cell made safe for a spreadsheet: one that starts like a formula
 * gets an apostrophe in front (the online transactions export's rule).
 */
export function safeText(v) {
  const s = v == null ? '' : String(v)
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s
}

/** One CSV cell: numbers as they are, text made safe and quoted when needed. */
export function csvCell(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = safeText(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The change from `before` to `now` as a fraction, or null when there is nothing to compare with. */
export function changeOf(now, before) {
  if (!isNum(now) || !isNum(before) || before === 0) return null
  return (now - before) / Math.abs(before)
}
