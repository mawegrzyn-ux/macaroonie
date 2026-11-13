// shared/reports/chart.js
//
// A report's result as a chart (docs/REPORTS.md 12). One renderer for the
// viewer, the builder's preview and the print page: a result in, an SVG
// string out, with where each mark sits so a page can answer a pointer or a
// tap. Nothing here touches the DOM, and every word that reaches the SVG is
// escaped (names come from menus, staff lists and typed text).
//
//   chartChoices(spec)             which kinds a definition can be drawn as,
//                                  and why not the others (the builder)
//   chartModel(result, { view })   what to draw: { ok: true, kind, ... } or
//                                  { ok: false, why } (why: a sentence, or
//                                  null when there is simply nothing to draw)
//   drawChart(model, opts)         { svg, width, height, targets, legend, label }
//   chartTip(model, target)        the words for one mark: { title, lines }
//   chartMark(model, target)       what a mark stands for, to open it up
//   renderChart(result, opts)      the model and the drawing together
//
// The kinds (view.kind in the definition):
//   bar      a bar for each row: side by side or stacked, upright or sideways
//   line     a line for each value, or for each group of a second grouping
//   area     a line with the space under it filled; the parts of one value
//            stack, different values stack when the report says so (else lines)
//   combo    bars with a line
//   parts    parts of a whole: one bar cut into up to six parts, each with
//            its share; more parts, or any below zero, are drawn as bars
//   figures  each value's total as a big number, with its change when the
//            report compares periods and a small trend when it runs by date
//   heat     a grid shaded by the value: a table across, or two groupings
//
// Rules the drawing keeps, so nobody has to remember them:
//   - figures of different kinds (pounds and a percentage) never share a
//     scale: each kind gets a plot of its own, one above the other, sharing
//     the rows. A chart with two scales on one plot can be made to say
//     anything
//   - colour tells series apart, in a fixed order, eight at most; a ninth is
//     added into "Everything else" when the value adds up
//   - one series takes the brand's main colour when it stands out on white
//   - words are never in a series colour, and every amount is in the table
//   - a scale always starts at zero

import { formatValue, formatMoney, formatPercent, formatDuration, changeText, WEEKDAYS } from './format.js'
import { VIEW_LABELS } from './spec.js'

export const CHART_KINDS = ['bar', 'line', 'area', 'combo', 'parts', 'figures', 'heat']

/** Series colours, in this order, never cycled. Checked for colour-blind separation on white. */
export const SERIES_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
/** One hue from light to dark, for amounts (a heat table). */
export const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']

const INK = '#0b0b0b'
const INK_2 = '#52514e'
const MUTED = '#898781'
const GRID = '#e1e0d9'
const BASE = '#c3c2b7'
const SURFACE = '#ffffff'
const WASH = '#f4f4f1'
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'

export const MAX_SERIES = 8
const MAX_BARS = 60          // rows of a chart whose rows have no order of their own
const MAX_POINTS = 400       // days, weeks, hours along the bottom
const MAX_HEAT_X = 40
const MAX_HEAT_Y = 60
const MAX_TILES = 8
const MAX_PANELS = 3
const STACK_PARTS = 6

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const YMD = /^\d{4}-\d{2}-\d{2}/
const ELLIPSIS = '…'
const MINUS = '−'

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const num = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const r1 = v => Math.round(v * 10) / 10
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const typeOf = c => c.format || c.type
const no = why => ({ ok: false, why })

// ── Words and colours ────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ESC[ch])

// How wide words come out, near enough to decide what fits: there is no
// font to measure with on a server.
const NARROW = new Set('iljtfrI1.,:;\'|!()[] '.split(''))
const WIDE = new Set('mwMW@%'.split(''))
export function textWidth(s, size = 12) {
  let w = 0
  for (const ch of String(s ?? '')) {
    if (NARROW.has(ch)) w += 0.3
    else if (WIDE.has(ch)) w += 0.86
    else if (ch >= '0' && ch <= '9') w += 0.58
    else if (ch >= 'A' && ch <= 'Z') w += 0.68
    else w += 0.55
  }
  return w * size * 1.04
}

/** Words cut to a width, with an ellipsis when they are cut. */
export function fitText(s, max, size = 12) {
  const full = String(s ?? '')
  if (textWidth(full, size) <= max) return full
  let out = full
  while (out.length > 1 && textWidth(out + ELLIPSIS, size) > max) out = out.slice(0, -1)
  return out.trimEnd() + ELLIPSIS
}

const HEX = /^#[0-9a-f]{6}$/
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const toHex = c => '#' + c.map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('')
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)) }
function luminance(hex) {
  const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
/** Black or white, whichever reads better on a colour. */
export const inkOn = hex => (contrast(hex, SURFACE) >= contrast(hex, INK) ? SURFACE : INK)

/**
 * A brand colour one series can wear: a colour code that stands out on
 * white (3:1). Null for anything else, and the usual blue is used.
 */
export function brandColour(hex) {
  const h = typeof hex === 'string' ? hex.trim().toLowerCase() : ''
  const full = /^#[0-9a-f]{3}$/.test(h) ? '#' + [...h.slice(1)].map(c => c + c).join('') : h
  return HEX.test(full) && contrast(full, SURFACE) >= 3 ? full : null
}

// Light to dark around one colour, for a heat table in the brand's colour.
const rampAround = base => [0.16, 0.27, 0.38, 0.5, 0.62, 0.74, 0.87, 1].map(t => mix(SURFACE, base, t))
  .concat([0.14, 0.28, 0.42].map(t => mix(base, '#000000', t)))

// ── Numbers along an axis ────────────────────────────────────

const symbolOf = currency => formatMoney(0, currency || 'GBP').replace(/[\d.,\s]/g, '')
const whole = v => Math.abs(v - Math.round(v)) < 1e-9

// How a set of amounts is written so they read as one family: the same unit
// (K, M) and the same decimals. `step` is the distance between an axis's
// marks: the marks then carry just the decimals the step needs.
function styleOf(values, col, step = null) {
  const type = typeOf(col)
  const real = values.filter(isNum)
  const top = Math.max(0, ...real.map(Math.abs))
  if (type === 'duration') return { type }
  if (type === 'percent') {
    if (step != null) return { type, min: 0, d: whole(step * 100) ? 0 : whole(step * 1000) ? 1 : 2 }
    const d = real.every(v => whole(v * 100)) ? 0 : 1
    return { type, min: d, d }
  }
  const [div, unit] = top >= 1e9 ? [1e9, 'B'] : top >= 1e6 ? [1e6, 'M'] : top >= 1e4 ? [1e3, 'K'] : [1, '']
  const money = type === 'money'
  if (step != null) {
    const s = step / div
    const d = whole(s) ? 0 : whole(s * 10) ? 1 : 2
    // Pounds and pence are never written with one decimal.
    const pence = money && !unit && d > 0
    return { type, div, unit, money, min: pence ? 2 : 0, d: pence ? 2 : d }
  }
  let d
  if (unit) d = real.every(v => whole(v / div)) || top / div >= 100 ? 0 : 1
  else if (money) d = real.every(whole) || top >= 100 ? 0 : 2
  else d = col.decimals ?? (real.every(whole) ? 0 : top < 10 ? 2 : 1)
  return { type, div, unit, money, min: d, d }
}

function write(v, st, currency) {
  if (!isNum(v)) return ''
  if (st.type === 'duration') return formatDuration(v)
  const pct = st.type === 'percent'
  const body = (pct ? Math.abs(v) * 100 : Math.abs(v) / st.div).toLocaleString('en-GB', { minimumFractionDigits: st.min, maximumFractionDigits: st.d })
  // Nothing is "£0" and "0%": never "£0K", "£0.00" or a minus in front of it.
  if (!/[1-9]/.test(body)) return pct ? '0%' : (st.money ? symbolOf(currency) : '') + '0'
  const sign = v < 0 ? MINUS : ''
  return pct ? sign + body + '%' : sign + (st.money ? symbolOf(currency) : '') + body + st.unit
}

/** The words along an axis: every mark in the same unit (£2.5K, £5K, £10K). */
export function axisLabels(ticks, col = {}, { currency } = {}) {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : null
  const st = styleOf(ticks, col, step)
  return ticks.map(t => write(t, st, currency))
}

/**
 * Amounts as short as the top of a bar or a cell wants them, all written
 * the same way: £1,211 beside £980, £12.5K beside £9.8K. The exact amount
 * is in the table and in what a mark says when it is pointed at.
 */
export function markLabels(values, col = {}, { currency } = {}) {
  const st = styleOf(values, col)
  return values.map(v => write(v, st, currency))
}

/** One amount, short: £12.5K, 1.2M, 45%, 12 min. */
export const shortValue = (v, col = {}, opts = {}) => markLabels([v], col, opts)[0]

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 604800]
function niceStep(raw, { counts, time }) {
  if (time) return TIME_STEPS.find(s => s >= raw) || Math.ceil(raw / 604800) * 604800
  if (!(raw > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const steps = counts ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  const step = steps.find(s => f <= s + 1e-9) * pow
  return counts ? Math.max(1, Math.round(step)) : step
}

/**
 * An axis from the smallest to the largest value: zero is always on it and
 * its marks are round numbers. A percentage is worked out in percent points
 * (25%, 50%), a duration in seconds, minutes and hours, a count in whole
 * numbers. { min, max, step, ticks }
 */
export function axisScale(lo, hi, { type, counts = false, target = 5 } = {}) {
  const min0 = Math.min(0, isNum(lo) ? lo : 0)
  let max0 = Math.max(0, isNum(hi) ? hi : 0)
  if (max0 === min0) max0 = type === 'percent' ? 0.1 : 1
  const k = type === 'percent' ? 100 : 1
  const step = niceStep(((max0 - min0) * k) / Math.max(1, target), { counts: counts && type !== 'percent', time: type === 'duration' }) / k
  const min = Math.floor(min0 / step + 1e-9) * step
  const max = Math.ceil(max0 / step - 1e-9) * step
  const ticks = []
  for (let i = 0; i <= Math.round((max - min) / step); i++) {
    const v = min + i * step
    ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12))
  }
  return { min, max, step, ticks }
}

// ── Rows that have an order of their own: dates, weekdays, hours ──

const isOrdered = col => !!col && (col.type === 'date' || (col.type === 'moment' && !!col.bucket))
const bucketOf = col => (isOrdered(col) ? col.bucket || 'day' : null)
const cmpKey = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
const wordsOf = (k, col, currency) => (k == null || k === '' ? (col.empty || '(none)') : formatValue(k, col, { currency }) || String(k))
const atOf = (col, k) => ({ field: col.field, ...(col.bucket ? { bucket: col.bucket } : {}), value: k ?? null })

// A date down the side of a heat table: as the table writes it, without the
// year when every row is in the same one.
function sideLabels(ys, col, currency) {
  const b = bucketOf(col)
  if (!['day', 'week', 'month'].includes(b)) return
  const years = new Set(ys.filter(y => typeof y.k === 'string' && YMD.test(y.k)).map(y => y.k.slice(0, 4)))
  if (years.size !== 1) return
  for (const y of ys) if (typeof y.k === 'string' && YMD.test(y.k)) y.short = wordsOf(y.k, col, currency).replace(/ \d{4}$/, '')
}

// A date as it reads under a chart: "9 Nov", "Nov", "Q4 26", "Mon", "14:00".
// The year is only said when the rows run over more than one.
function shortLabel(k, col, years) {
  if (k == null || k === '') return col.empty || '(none)'
  const b = bucketOf(col)
  if (!b) return formatValue(k, col) || String(k)
  if (b === 'weekday') return WEEKDAYS[Number(k) - 1] || String(k)
  if (b === 'hour') return String(Number(k)).padStart(2, '0') + ':00'
  const s = String(k)
  if (!YMD.test(s)) return s
  const yy = s.slice(2, 4), month = MONTHS[+s.slice(5, 7) - 1], d = +s.slice(8, 10)
  if (b === 'year') return s.slice(0, 4)
  if (b === 'quarter') return 'Q' + (Math.floor((+s.slice(5, 7) - 1) / 3) + 1) + ' ' + yy
  if (b === 'month') return years ? month + ' ' + yy : month
  return d + ' ' + month + (years ? ' ' + yy : '')
}

function nextKey(k, b) {
  if (b === 'weekday' || b === 'hour') return Number(k) + 1
  const s = String(k)
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1, d = +s.slice(8, 10)
  const next = b === 'day' ? Date.UTC(y, m, d + 1)
    : b === 'week' ? Date.UTC(y, m, d + 7)
      : b === 'month' ? Date.UTC(y, m + 1, d)
        : b === 'quarter' ? Date.UTC(y, m + 3, d)
          : Date.UTC(y + 1, m, d)
  return new Date(next).toISOString().slice(0, 10)
}

// Every day (week, month, hour) from the first to the last, so a day with
// nothing shows as a gap. Null when the keys don't sit on one such run.
function sequence(keys, b) {
  if (keys.length < 2) return null
  const sorted = [...keys].sort(cmpKey)
  const last = sorted[sorted.length - 1]
  const out = [sorted[0]]
  while (cmpKey(out[out.length - 1], last) < 0) {
    if (out.length >= MAX_POINTS) return null
    out.push(nextKey(out[out.length - 1], b))
  }
  const have = new Set(out.map(String))
  return keys.every(k => have.has(String(k))) ? out : null
}

// ── What a definition can be drawn as ────────────────────────

/**
 * Each kind of chart for a definition: [{ kind, label, ok, why }], the table
 * first. `why` says what is missing when a kind doesn't fit. Whether a value
 * adds up to a whole is only known once the report has run: the chart says
 * so itself then.
 */
export function chartChoices(spec) {
  const n = spec?.rows?.length || 0
  const shown = (spec?.values || []).filter(v => !v.hidden).length
  const out = { table: { ok: true } }
  const set = (kind, why) => { out[kind] = why ? { ok: false, why } : { ok: true } }
  for (const kind of CHART_KINDS) {
    if (!spec || spec.kind === 'list') { set(kind, 'A list is shown as a table'); continue }
    if (!shown) { set(kind, 'Add a value first'); continue }
    if (spec.kind === 'matrix') {
      if (kind === 'combo') set(kind, 'Bars with a line are for a summary with one grouping')
      else if (kind === 'parts') set(kind, 'Parts of a whole are for a summary with one grouping')
      else if (kind === 'figures') set(kind, 'Figures are for a summary')
      else set(kind)
      continue
    }
    // The figures are the report's totals: with groupings they come from its Total row.
    if (kind === 'figures') { set(kind, n > 0 && spec.totals?.grand === false ? 'Switch the total on to show the report as figures' : null); continue }
    if (n === 0) { set(kind, 'Group the report by something first'); continue }
    if (kind === 'heat') set(kind, n === 2 ? null : 'A heat table needs two groupings, or a column across the top')
    else if (kind === 'parts') set(kind, n === 1 ? null : 'Parts of a whole need one grouping')
    else if (kind === 'combo') set(kind, n !== 1 ? 'Bars with a line need one grouping' : shown < 2 ? 'Bars with a line need two values: one for the bars, one for the line' : null)
    else set(kind)
  }
  return ['table', ...CHART_KINDS].map(kind => ({ kind, label: VIEW_LABELS[kind] || kind, ...out[kind] }))
}

// ── The model: what to draw ──────────────────────────────────

const groupingsOf = cols => cols.map((c, i) => ({ c, i })).filter(x => x.c.role === 'row').map((x, j) => ({ ...x, j }))
const bodyOf = rows => rows.map((r, ri) => ({ r, ri })).filter(x => x.r.kind === 'row' || x.r.kind === 'rest')
const restLabel = r => String(r.cells?.[0] ?? 'Everything else')

/**
 * Which of the values a report shows a chart of this kind draws: { ys:
 * [key], line: key | null }. `shown` is the keys of the values shown, in
 * their order; `view.y` picks among them (in the view's own order) and
 * `view.line` names the line of bars with a line.
 *
 *   figures   every value, unless the view picks some
 *   combo     the line is the value the view names, else the first one that
 *             isn't a bar, else (every value is picked as a bar) the last of
 *             the picks; the bars are the view's picks without it, else the
 *             first value that isn't the line. With one value there aren't
 *             two to draw ({ ys: [], line: null })
 *   others    the view's picks, else the first value
 *
 * One rule for the drawing and for the builder's Chart part (which ticks
 * what is drawn before anything has been picked).
 */
export function chartValues(kind, shown, view = {}) {
  const keys = Array.isArray(shown) ? shown : []
  const asked = (Array.isArray(view?.y) ? view.y : []).filter((k, i, all) => keys.includes(k) && all.indexOf(k) === i)
  if (kind === 'figures') return { ys: asked.length ? asked : [...keys], line: null }
  const first = asked.length ? asked : keys.slice(0, 1)
  if (kind !== 'combo') return { ys: first, line: null }
  const line = keys.includes(view?.line) ? view.line : keys.find(k => !first.includes(k)) ?? (first.length > 1 ? first[first.length - 1] : null)
  if (line == null) return { ys: [], line: null }
  let ys = first.filter(k => k !== line)
  if (!ys.length) ys = keys.filter(k => k !== line).slice(0, 1)
  return ys.length ? { ys, line } : { ys: [], line: null }
}

// A summary's values the view asks for, in the view's order; the first one
// shown when it asks for none (every one, for figures).
function pickValues(cols, view, { all = false } = {}) {
  const shown = cols.map((c, i) => ({ c, i })).filter(x => x.c.role === 'value' && !x.c.at)
  return chartValues(all ? 'figures' : 'bar', shown.map(x => x.c.key), view).ys.map(k => shown.find(x => x.c.key === k))
}

const seriesOf = (v, values, extra = {}) => ({
  key: v.c.key, label: v.c.label, type: typeOf(v.c), ...(v.c.decimals != null ? { decimals: v.c.decimals } : {}),
  adds: !!v.c.adds, value: { key: v.c.of || v.c.key, label: v.c.label }, values, ...extra,
})

// More series than colours: the largest stay, the others are added together
// when the value adds up, and left out (with a note) when it doesn't.
function foldSeries(series, cats, notes) {
  if (series.length <= MAX_SERIES) return series
  const weight = s => s.values.reduce((a, v) => a + Math.abs(v || 0), 0)
  const ranked = [...series].sort((a, b) => weight(b) - weight(a))
  if (series.every(s => s.adds)) {
    const keep = new Set(ranked.slice(0, MAX_SERIES - 1))
    const others = series.filter(s => !keep.has(s))
    const values = cats.map((_, c) => {
      let t = null
      for (const s of others) if (s.values[c] != null) t = (t || 0) + s.values[c]
      return t
    })
    notes.push('The chart draws the ' + (MAX_SERIES - 1) + ' largest on their own and adds the other ' + others.length + ' together')
    const first = series[0]
    return [...series.filter(s => keep.has(s)), {
      key: '__rest', label: 'Everything else', type: first.type, ...(first.decimals != null ? { decimals: first.decimals } : {}),
      adds: true, value: first.value, values, rest: true, at: null,
    }]
  }
  const keep = new Set(ranked.slice(0, MAX_SERIES))
  notes.push('The chart draws the ' + MAX_SERIES + ' largest of ' + series.length + ': the table has them all')
  return series.filter(s => keep.has(s))
}

// Rows along a line of time: in order, with the days nothing happened on as
// gaps. `sort` puts them in order first (a line always runs left to right);
// without it they are only filled when they are in order already.
function onTimeline(cats, series, xcol, { sort, dropRest, notes }) {
  const b = bucketOf(xcol)
  if (!b) return cats
  let dated = cats.map((c, i) => i).filter(i => !cats[i].rest && cats[i].k != null)
  const undated = cats.map((c, i) => i).filter(i => cats[i].k == null && !cats[i].rest)
  const rest = cats.map((c, i) => i).filter(i => cats[i].rest)
  const inOrder = dated.every((i, n) => n === 0 || cmpKey(cats[dated[n - 1]].k, cats[i].k) <= 0)
  if (!inOrder && !sort) return cats
  if (!inOrder) dated = [...dated].sort((a, z) => cmpKey(cats[a].k, cats[z].k))
  const seq = sequence(dated.map(i => cats[i].k), b)
  const place = new Map(dated.map(i => [String(cats[i].k), i]))
  let order = seq ? seq.map(k => (place.has(String(k)) ? place.get(String(k)) : { gap: k })) : dated
  order = [...order, ...undated]
  if (rest.length) {
    if (dropRest) notes.push('"' + cats[rest[0]].label + '" has no place along the bottom, so the chart leaves it out')
    else order = [...order, ...rest]
  }
  for (const s of series) s.values = order.map(o => (typeof o === 'number' ? s.values[o] : null))
  return order.map(o => (typeof o === 'number' ? cats[o] : { label: wordsOf(o.gap, xcol), k: o.gap, at: [atOf(xcol, o.gap)], gap: true }))
}

function shortLabels(cats, xcol) {
  if (!xcol) { for (const c of cats) c.short = c.short || c.label; return }
  const years = new Set(cats.filter(c => typeof c.k === 'string' && YMD.test(c.k)).map(c => c.k.slice(0, 4))).size > 1
  for (const c of cats) c.short = c.rest ? c.label : shortLabel(c.k, xcol, years)
}

// The rows and series of a bar, line, area or combo chart.
function plotData(ctx, kind) {
  const { result, view, cols, currency, notes } = ctx
  const G = groupingsOf(cols)
  const body = bodyOf(result.rows)
  let cats, series, xcol
  // The value every series shows, when the series are named after something
  // else (the columns across the top, another grouping): the legend can't say it.
  let of = null

  if (result.kind === 'matrix') {
    const keys = [...new Set(cols.filter(c => c.role === 'value' && c.at).map(c => c.of))]
    const vk = (view.y || []).find(k => keys.includes(k)) || keys[0]
    const across = cols.map((c, i) => ({ c, i })).filter(x => x.c.role === 'value' && x.c.at && x.c.of === vk)
    if (!across.length) return no('There is nothing to draw')
    if (keys.length > 1) notes.push('The chart shows one value: ' + across[0].c.label)
    if (G.length === 0) {
      // No rows down the side: the columns across the top are the chart's rows.
      const r = body[0]?.r
      if (!r) return no(null)
      cats = across.map(a => ({ label: a.c.group, k: a.c.at.length === 1 ? a.c.at[0].value : null, at: a.c.at.map(x => ({ ...x, value: x.value ?? null })), row: 0, col: a.i }))
      series = [seriesOf(across[0], across.map(a => num(r.cells[a.i])))]
      const one = across[0].c.at.length === 1 ? across[0].c.at[0] : null
      xcol = one ? { field: one.field, ...(one.bucket ? { bucket: one.bucket } : {}), type: one.bucket || cats.every(c => typeof c.k === 'string' && YMD.test(c.k)) ? 'date' : 'text', label: '' } : null
      if (xcol && !isOrdered(xcol)) xcol = null
    } else {
      cats = body.map(({ r, ri }) => (r.kind === 'rest'
        ? { label: restLabel(r), k: null, at: null, rest: true, row: ri }
        : { label: G.map(g => wordsOf(r.k[g.j], g.c, currency)).join(' · '), k: G.length === 1 ? r.k[0] ?? null : null, at: G.map(g => atOf(g.c, r.k[g.j])), row: ri }))
      series = across.map(a => seriesOf(a, body.map(({ r }) => num(r.cells[a.i])), {
        key: a.c.key, label: a.c.group, at: a.c.at.map(x => ({ ...x, value: x.value ?? null })), col: a.i,
      }))
      xcol = G.length === 1 ? G[0].c : null
      of = across[0].c.label
    }
  } else if (G.length === 0) {
    return no('Group the report by something to draw it as a chart, or show it as figures')
  } else if (G.length === 1) {
    const g = G[0]
    xcol = g.c
    cats = body.map(({ r, ri }) => (r.kind === 'rest'
      ? { label: restLabel(r), k: null, at: null, rest: true, row: ri }
      : { label: wordsOf(r.k[0], g.c, currency), k: r.k[0] ?? null, at: [atOf(g.c, r.k[0])], row: ri }))
    let ys = pickValues(cols, view)
    let line = null
    if (kind === 'combo') {
      const shown = pickValues(cols, {}, { all: true })
      const pick = chartValues('combo', shown.map(x => x.c.key), view)
      if (!pick.line) return no('Bars with a line need two values: one for the bars, one for the line')
      line = shown.find(x => x.c.key === pick.line)
      ys = pick.ys.map(k => shown.find(x => x.c.key === k))
    }
    series = ys.map(v => seriesOf(v, body.map(({ r }) => num(r.cells[v.i])), { col: v.i }))
    if (line) series.push(seriesOf(line, body.map(({ r }) => num(r.cells[line.i])), { col: line.i, mark: 'line' }))
    // One value beside the period before: the earlier period next to it.
    if (series.length === 1) {
      const p = cols.findIndex(c => c.role === 'compare' && c.of === series[0].key)
      if (p >= 0) series.push({ ...series[0], key: series[0].key + '__prev', label: 'Before', values: body.map(({ r }) => num(r.cells[p])), muted: true, col: p })
    }
  } else {
    // Two or more groupings: one of them along the bottom, a series for each
    // combination of the others.
    const xi = Math.max(0, G.findIndex(g => g.c.key === view.x))
    const gx = G[xi]
    const others = G.filter(g => g !== gx)
    xcol = gx.c
    const ys = pickValues(cols, view)
    const v = ys[0]
    if (!v) return no('There is nothing to draw')
    if (ys.length > 1) notes.push('With more than one grouping the chart shows one value: ' + v.c.label)
    if (result.rows.some(r => r.kind === 'rest')) notes.push('"' + restLabel(result.rows.find(r => r.kind === 'rest')) + '" isn\'t in the chart')
    const catAt = new Map()
    const serAt = new Map()
    cats = []
    series = []
    for (const { r, ri } of body) {
      if (r.kind !== 'row') continue
      const ck = JSON.stringify(r.k[gx.j] ?? null)
      const sk = JSON.stringify(others.map(g => r.k[g.j] ?? null))
      if (!catAt.has(ck)) { catAt.set(ck, cats.length); cats.push({ label: wordsOf(r.k[gx.j], gx.c, currency), k: r.k[gx.j] ?? null, at: [atOf(gx.c, r.k[gx.j])] }) }
      if (!serAt.has(sk)) {
        serAt.set(sk, series.length)
        series.push(seriesOf(v, [], {
          key: 's' + series.length, label: others.map(g => wordsOf(r.k[g.j], g.c, currency)).join(' · '),
          at: others.map(g => atOf(g.c, r.k[g.j])), col: v.i, rowAt: [],
        }))
      }
      const s = series[serAt.get(sk)]
      s.values[catAt.get(ck)] = num(r.cells[v.i])
      s.rowAt[catAt.get(ck)] = ri
    }
    for (const s of series) { s.values = cats.map((_, c) => s.values[c] ?? null); delete s.rowAt }
    of = v.c.label
  }

  if (!cats.length || !series.length) return no(null)
  series = foldSeries(series, cats, notes)
  return { cats, series, xcol, of }
}

function plotModel(ctx, kind) {
  const { view, currency, notes } = ctx
  const data = plotData(ctx, kind)
  if (data.ok === false) return data
  let { cats } = data
  const { series, xcol, of } = data
  const ordered = isOrdered(xcol)
  const timeline = kind !== 'bar'

  if (ordered) cats = onTimeline(cats, series, xcol, { sort: timeline, dropRest: timeline, notes })
  const cap = ordered ? MAX_POINTS : MAX_BARS
  if (cats.length > cap) {
    notes.push('The chart draws the first ' + cap + ' of ' + cats.length + ' rows: the table has them all')
    cats = cats.slice(0, cap)
    for (const s of series) s.values = s.values.slice(0, cap)
  }
  shortLabels(cats, ordered || (xcol && !xcol.labels) ? xcol : null)

  // A plot for each kind of figure: pounds, counts and percentages never
  // share a scale.
  const panels = []
  for (const s of series) {
    let p = panels.findIndex(x => x.type === s.type)
    if (p < 0) {
      if (panels.length >= MAX_PANELS) { s.skip = true; continue }
      p = panels.push({ type: s.type }) - 1
    }
    s.panel = p
  }
  const skipped = series.filter(s => s.skip)
  if (skipped.length) notes.push('Not drawn (too many kinds of figure for one chart): ' + skipped.map(s => s.label).join(', '))
  const drawn = series.filter(s => !s.skip)

  let unstacked = false
  panels.forEach((p, i) => {
    const mine = drawn.filter(s => s.panel === i)
    const bars = mine.filter(s => s.mark !== 'line')
    const base = kind === 'combo' ? 'bar' : kind
    const canStack = bars.length > 1 && bars.every(s => s.adds && !s.muted)
    const negative = bars.some(s => s.values.some(v => v != null && v < 0))
    p.counts = mine.every(s => s.type === 'number' && s.decimals === 0)
    p.label = of || mine.map(s => s.label).join(', ')
    if (base === 'area') {
      // Areas on top of each other hide one another: they stack, or they are
      // lines. Parts of one value (another grouping, the columns of a table
      // across) stack by themselves; different values (bookings and guests)
      // only when the report says so, since their sum may mean nothing.
      if (bars.length === 1) p.mark = 'area'
      else if (canStack && !negative && (of || view.stacked)) { p.mark = 'area'; p.stacked = true }
      else { p.mark = 'line'; if (!canStack || negative) unstacked = true }
    } else {
      p.mark = base
      if (base === 'bar' && view.stacked && bars.length > 1) { if (canStack) p.stacked = true; else unstacked = true }
    }
    for (const s of bars) s.mark = p.mark
  })
  if (unstacked) notes.push(kind === 'area' ? 'These figures don\'t add up to a whole, so they are drawn as lines' : 'These figures don\'t add up to a whole, so the bars sit side by side')

  return {
    ok: true, kind, form: 'plot', cats, series: drawn, panels, ...(of ? { of } : {}),
    x: { label: xcol?.label || '', ordered },
    sideways: kind === 'bar' && !!view.sideways,
    notes, currency,
  }
}

function partsModel(ctx) {
  const { result, view, cols, currency, notes } = ctx
  const G = groupingsOf(cols)
  if (result.kind !== 'summary' || G.length !== 1) return no('Parts of a whole are for a summary with one grouping')
  const v = pickValues(cols, view)[0]
  if (!v) return no('There is nothing to draw')
  if (!v.c.adds) return no(v.c.label + ' doesn\'t add up to a whole (an average or a rate can\'t be cut into parts). Bars show it better')
  const g = G[0]
  const body = bodyOf(result.rows)
  let cats = body.map(({ r, ri }) => (r.kind === 'rest'
    ? { label: restLabel(r), k: null, at: null, rest: true, row: ri }
    : { label: wordsOf(r.k[0], g.c, currency), k: r.k[0] ?? null, at: [atOf(g.c, r.k[0])], row: ri }))
  let values = body.map(({ r }) => num(r.cells[v.i]))
  if (!values.some(x => x)) return no(null)
  const negative = values.some(x => x != null && x < 0)
  const sum = values.reduce((a, x) => a + (x || 0), 0)
  const grand = num(result.totals?.cells?.[v.i])
  const total = negative ? null : Math.max(sum, grand ?? sum)
  // A top few without their "everything else": the rest of the whole, in grey.
  if (!negative && grand != null && grand - sum > Math.max(0.005, Math.abs(grand) * 1e-6)) {
    cats = [...cats, { label: 'Everything else', k: null, at: null, rest: true }]
    values = [...values, grand - sum]
  }
  const series = [seriesOf(v, values, { col: v.i, panel: 0, mark: 'bar' })]
  if (negative) notes.push('Some of these are below zero, so they are drawn as bars, not as parts of a whole')
  if (negative || cats.length > STACK_PARTS) {
    if (cats.length > MAX_BARS) {
      notes.push('The chart draws the first ' + MAX_BARS + ' of ' + cats.length + ' rows: the table has them all')
      cats = cats.slice(0, MAX_BARS)
      series[0].values = series[0].values.slice(0, MAX_BARS)
    }
    shortLabels(cats, null)
    return {
      ok: true, kind: 'parts', form: 'plot', cats, series, panels: [{ type: series[0].type, mark: 'bar', counts: series[0].type === 'number' && series[0].decimals === 0, label: series[0].label }],
      x: { label: g.c.label, ordered: false }, sideways: true, total, notes, currency,
    }
  }
  return { ok: true, kind: 'parts', form: 'stack', cats, series, total, x: { label: g.c.label, ordered: false }, notes, currency }
}

function heatModel(ctx) {
  const { result, view, cols, currency, notes } = ctx
  const G = groupingsOf(cols)
  const body = bodyOf(result.rows)
  let xs, ys, cells, value, xLabel = '', yLabel = ''
  if (result.kind === 'matrix') {
    const keys = [...new Set(cols.filter(c => c.role === 'value' && c.at).map(c => c.of))]
    const vk = (view.y || []).find(k => keys.includes(k)) || keys[0]
    const across = cols.map((c, i) => ({ c, i })).filter(x => x.c.role === 'value' && x.c.at && x.c.of === vk)
    if (!across.length) return no('There is nothing to draw')
    if (keys.length > 1) notes.push('The heat table shows one value: ' + across[0].c.label)
    value = seriesOf(across[0], [])
    xs = across.map(a => ({ label: a.c.group, short: a.c.group, at: a.c.at.map(x => ({ ...x, value: x.value ?? null })), col: a.i }))
    const one = across[0].c.at.length === 1 ? across[0].c.at[0] : null
    if (one) {
      const xcol = { field: one.field, ...(one.bucket ? { bucket: one.bucket } : {}), type: one.bucket || xs.every(x => typeof x.at[0].value === 'string' && YMD.test(x.at[0].value)) ? 'date' : 'text' }
      if (isOrdered(xcol)) {
        const years = new Set(xs.map(x => String(x.at[0].value).slice(0, 4))).size > 1
        for (const x of xs) x.short = shortLabel(x.at[0].value, xcol, years)
      }
    }
    ys = body.map(({ r, ri }) => (r.kind === 'rest'
      ? { label: restLabel(r), at: null, rest: true, row: ri }
      : { label: G.length ? G.map(g => wordsOf(r.k[g.j], g.c, currency)).join(' · ') : value.label, k: G.length === 1 ? r.k[0] ?? null : null, at: G.map(g => atOf(g.c, r.k[g.j])), row: ri }))
    if (G.length === 1) sideLabels(ys, G[0].c, currency)
    cells = body.map(({ r }) => across.map(a => num(r.cells[a.i])))
    // What runs across the top is named by the result (its columns only carry the values).
    xLabel = (Array.isArray(result.meta?.across) ? result.meta.across : []).filter(Boolean).join(', ')
    yLabel = G.map(g => g.c.label).join(', ')
  } else if (G.length === 2) {
    // The grouping named as the chart's "x" goes across the top; else the second.
    const xi = G.findIndex(g => g.c.key === view.x)
    const gx = G[xi >= 0 ? xi : 1], gy = G[xi >= 0 ? 1 - xi : 0]
    const v = pickValues(cols, view)[0]
    if (!v) return no('There is nothing to draw')
    value = seriesOf(v, [])
    const xAt = new Map(), yAt = new Map()
    xs = []
    ys = []
    const rowsOnly = body.filter(x => x.r.kind === 'row')
    for (const { r } of rowsOnly) {
      const xk = JSON.stringify(r.k[gx.j] ?? null), yk = JSON.stringify(r.k[gy.j] ?? null)
      if (!xAt.has(xk)) { xAt.set(xk, xs.length); xs.push({ k: r.k[gx.j] ?? null, label: wordsOf(r.k[gx.j], gx.c, currency), at: [atOf(gx.c, r.k[gx.j])] }) }
      if (!yAt.has(yk)) { yAt.set(yk, ys.length); ys.push({ k: r.k[gy.j] ?? null, label: wordsOf(r.k[gy.j], gy.c, currency), at: [atOf(gy.c, r.k[gy.j])] }) }
    }
    // Across the top in its own order when it has one (dates, hours, sizes).
    const sortable = isOrdered(gx.c) || xs.every(x => x.k == null || typeof x.k === 'number')
    const order = xs.map((_, i) => i)
    if (sortable) order.sort((a, b) => (xs[a].k == null ? 1 : xs[b].k == null ? -1 : cmpKey(xs[a].k, xs[b].k)))
    const place = new Map(order.map((from, to) => [from, to]))
    xs = order.map(i => xs[i])
    const years = new Set(xs.filter(x => typeof x.k === 'string' && YMD.test(x.k)).map(x => x.k.slice(0, 4))).size > 1
    for (const x of xs) x.short = isOrdered(gx.c) ? shortLabel(x.k, gx.c, years) : x.label
    sideLabels(ys, gy.c, currency)
    cells = ys.map(() => xs.map(() => null))
    for (const { r } of rowsOnly) {
      const xk = JSON.stringify(r.k[gx.j] ?? null), yk = JSON.stringify(r.k[gy.j] ?? null)
      cells[yAt.get(yk)][place.get(xAt.get(xk))] = num(r.cells[v.i])
    }
    if (result.rows.some(r => r.kind === 'rest')) notes.push('"' + restLabel(result.rows.find(r => r.kind === 'rest')) + '" isn\'t in the heat table')
    xLabel = gx.c.label
    yLabel = gy.c.label
  } else {
    return no('A heat table needs two groupings, or a column across the top')
  }
  if (!xs.length || !ys.length) return no(null)
  if (xs.length > MAX_HEAT_X || ys.length > MAX_HEAT_Y) {
    const cut = [ys.length > MAX_HEAT_Y ? MAX_HEAT_Y + ' of ' + ys.length + ' rows' : null, xs.length > MAX_HEAT_X ? MAX_HEAT_X + ' of ' + xs.length + ' columns' : null]
    notes.push('The heat table draws the first ' + cut.filter(Boolean).join(' and ') + ': the table has them all')
    xs = xs.slice(0, MAX_HEAT_X)
    ys = ys.slice(0, MAX_HEAT_Y)
    cells = cells.slice(0, MAX_HEAT_Y).map(row => row.slice(0, MAX_HEAT_X))
  }
  return { ok: true, kind: 'heat', form: 'heat', xs, ys, cells, value, xLabel, yLabel, notes, currency }
}

function figuresModel(ctx) {
  const { result, view, cols, currency, notes } = ctx
  if (result.kind !== 'summary') return no('Figures are for a summary')
  const G = groupingsOf(cols)
  const cells = G.length === 0 ? result.rows[0]?.cells : result.totals?.cells
  if (!cells) return no('Switch the total on to show the report as figures')
  let values = pickValues(cols, view, { all: true })
  if (!values.length) return no('There is nothing to draw')
  if (values.length > MAX_TILES) {
    notes.push('The first ' + MAX_TILES + ' of ' + values.length + ' values are shown as figures')
    values = values.slice(0, MAX_TILES)
  }
  // A trend under each figure when the report runs by date.
  let trend = null
  if (G.length === 1 && isOrdered(G[0].c)) {
    const dated = bodyOf(result.rows).filter(x => x.r.kind === 'row' && x.r.k[0] != null).sort((a, b) => cmpKey(a.r.k[0], b.r.k[0]))
    if (dated.length >= 3) trend = dated
  }
  const tiles = values.map(v => {
    const p = cols.findIndex(c => c.role === 'compare' && c.of === v.c.key)
    const ch = cols.findIndex(c => c.role === 'change' && c.of === v.c.key)
    return {
      key: v.c.key, label: v.c.label, type: typeOf(v.c), ...(v.c.decimals != null ? { decimals: v.c.decimals } : {}),
      value: num(cells[v.i]),
      before: p >= 0 ? num(cells[p]) : null,
      change: ch >= 0 ? num(cells[ch]) : null,
      trend: trend ? trend.map(x => num(x.r.cells[v.i])) : null,
    }
  })
  const against = result.meta?.compare ? (result.meta.compare.with === 'last_year' ? 'last year' : 'the period before') : null
  return { ok: true, kind: 'figures', form: 'figures', tiles, against, notes, currency }
}

/**
 * What a result looks like as a chart. `opts.view` is used in place of the
 * definition's own view (the builder trying a kind out).
 */
export function chartModel(result, opts = {}) {
  const view = opts.view || result?.spec?.view || {}
  const kind = view.kind
  if (!result || !CHART_KINDS.includes(kind)) return no(null)
  if (result.kind === 'list') return no('A list is shown as a table')
  if (result.meta?.currency_column) return no('Your venues use more than one currency, so there is no chart: the table shows each currency on its own')
  if (!result.rows?.length || !result.columns?.length) return no(null)
  const ctx = { result, view, cols: result.columns, currency: result.meta?.currency || null, notes: [] }
  if (kind === 'figures') return figuresModel(ctx)
  if (kind === 'heat') return heatModel(ctx)
  if (kind === 'parts') return partsModel(ctx)
  return plotModel(ctx, kind)
}

// ── Drawing ──────────────────────────────────────────────────

const attrs = o => Object.entries(o).filter(([, v]) => v != null && v !== false).map(([k, v]) => ' ' + k + '="' + esc(v) + '"').join('')
const el = (name, a, inner = null) => '<' + name + attrs(a) + (inner == null ? '/>' : '>' + inner + '</' + name + '>')
const words = (x, y, s, o = {}) => el('text', {
  x: r1(x), y: r1(y), 'font-size': o.size || 12, fill: o.fill || INK_2,
  'text-anchor': o.anchor, 'font-weight': o.weight, 'dominant-baseline': o.baseline,
}, esc(s))
const hidden = o => (o.hidden instanceof Set ? o.hidden : new Set(o.hidden || []))
// The series switched off, among the ones the chart has. One always draws:
// a set that would switch every series off switches none off.
function offOf(m, o) {
  const asked = hidden(o)
  const off = new Set(m.series.filter(s => asked.has(s.key)).map(s => s.key))
  return off.size >= m.series.length ? new Set() : off
}
const widthOf = o => Math.max(260, Math.round(o.width || 720))

function frame(W, H, label, inner) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img"'
    + ' aria-label="' + esc(label) + '" font-family="' + esc(FONT) + '"'
    + ' style="max-width:100%;height:auto;display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact">'
    + '<title>' + esc(label) + '</title>' + inner + '</svg>'
}

// Each series' colour. It goes with the series, not with its place among the
// ones showing: hiding one never repaints the others.
function coloursOf(m, o) {
  const brand = brandColour(o.brand)
  const real = m.series.filter(s => !s.muted && !s.rest)
  const out = new Map()
  let slot = 0
  for (const s of m.series) {
    if (s.muted || s.rest) out.set(s.key, MUTED)
    else if (real.length === 1) out.set(s.key, brand || SERIES_COLOURS[0])
    else out.set(s.key, SERIES_COLOURS[slot++ % SERIES_COLOURS.length])
  }
  return out
}

const legendOf = (m, colours, off) => (m.series.length > 1
  ? m.series.map(s => ({ key: s.key, label: s.label, colour: colours.get(s.key), mark: s.mark === 'line' ? 'line' : 'box', hidden: off.has(s.key), toggle: true }))
  : [])

// A legend inside the drawing (the print page has no buttons): swatch and
// name, wrapping onto as many lines as it needs. { svg, height }
function legendInside(items, W) {
  const shown = items.filter(i => !i.hidden)
  if (!shown.length) return { svg: '', height: 0 }
  let x = 0, y = 0, svg = ''
  for (const it of shown) {
    const label = fitText(it.label, Math.min(W - 24, 260), 12)
    const w = 20 + textWidth(label, 12) + 16
    if (x > 0 && x + w > W) { x = 0; y += 20 }
    svg += it.mark === 'line'
      ? el('line', { x1: x, y1: y + 9, x2: x + 14, y2: y + 9, stroke: it.colour, 'stroke-width': 2, 'stroke-linecap': 'round' })
      : el('rect', { x, y: y + 4, width: 10, height: 10, rx: 2, fill: it.colour })
    svg += words(x + 20, y + 13, label)
    x += w
  }
  return { svg, height: y + 26 }
}

// A bar from its baseline to its end, rounded at the end only.
function barPath(x, w, y0, y1) {
  const h = Math.abs(y1 - y0)
  if (h < 0.5 || w <= 0) return ''
  const r = Math.min(4, w / 2, h)
  const d = y1 < y0 ? 1 : -1
  return 'M' + r1(x) + ',' + r1(y0) + 'V' + r1(y1 + d * r) + 'Q' + r1(x) + ',' + r1(y1) + ' ' + r1(x + r) + ',' + r1(y1)
    + 'H' + r1(x + w - r) + 'Q' + r1(x + w) + ',' + r1(y1) + ' ' + r1(x + w) + ',' + r1(y1 + d * r) + 'V' + r1(y0) + 'Z'
}
function sideBarPath(y, h, x0, x1) {
  const w = Math.abs(x1 - x0)
  if (w < 0.5 || h <= 0) return ''
  const r = Math.min(4, h / 2, w)
  const d = x1 > x0 ? 1 : -1
  return 'M' + r1(x0) + ',' + r1(y) + 'H' + r1(x1 - d * r) + 'Q' + r1(x1) + ',' + r1(y) + ' ' + r1(x1) + ',' + r1(y + r)
    + 'V' + r1(y + h - r) + 'Q' + r1(x1) + ',' + r1(y + h) + ' ' + r1(x1 - d * r) + ',' + r1(y + h) + 'H' + r1(x0) + 'Z'
}

function linePath(points) {
  let d = '', pen = false
  for (const p of points) {
    if (!p) { pen = false; continue }
    d += (pen ? 'L' : 'M') + r1(p[0]) + ',' + r1(p[1])
    pen = true
  }
  return d
}

const titleOf = m => {
  const names = m.form === 'plot' || m.form === 'stack' ? m.series.map(s => s.label).join(', ') : ''
  const what = m.form === 'heat' ? m.value.label : m.form === 'figures' ? m.tiles.map(t => t.label).join(', ') : m.of ? m.of + ' (' + names + ')' : names
  // Each name as it reads inside a sentence ("by day and hour"); initials keep their capitals ("VAT rate").
  const inline = s => String(s || '').split(', ').map(w => (/^[A-Z][a-z]/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w)).join(', ')
  const by = (m.form === 'heat' ? [m.yLabel, m.xLabel] : [m.x?.label]).filter(Boolean).map(inline).join(' and ')
  return (VIEW_LABELS[m.kind] || 'Chart') + ': ' + what + (by ? ' by ' + by : '')
}

// The range a plot's scale has to hold.
function rangeOf(p, series, n) {
  let lo = 0, hi = 0
  if (p.stacked) {
    for (let c = 0; c < n; c++) {
      let up = 0, down = 0
      for (const s of series) { const v = s.values[c]; if (v > 0) up += v; else if (v < 0) down += v }
      hi = Math.max(hi, up)
      lo = Math.min(lo, down)
    }
  } else {
    for (const s of series) for (const v of s.values) if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v) }
  }
  return { lo, hi }
}

function drawPlot(m, o) {
  const W = widthOf(o)
  const off = offOf(m, o)
  const colours = coloursOf(m, o)
  const legend = legendOf(m, colours, off)
  const series = m.series.filter(s => !off.has(s.key))
  const panels = m.panels.map((p, i) => ({ ...p, series: series.filter(s => s.panel === i) })).filter(p => p.series.length)
  const inside = o.legend === 'inside' ? legendInside(legend, W) : { svg: '', height: 0 }
  const n = m.cats.length
  const label = titleOf(m)

  // Names that have no order of their own and don't fit under their bars go
  // down the side instead.
  const onlyBars = panels.length === 1 && panels[0].mark === 'bar'
  const widest = Math.max(...m.cats.map(c => textWidth(c.short, 11)))
  const roomEach = (W - 60) / n
  const sideways = onlyBars && (m.sideways || (!m.x.ordered && (widest + 10 > roomEach || n > 16)))
  return sideways
    ? sidePlot(m, { W, panel: panels[0], colours, legend, inside, label, o })
    : uprightPlot(m, { W, panels, colours, legend, inside, label, o, widest })
}

function uprightPlot(m, { W, panels, colours, legend, inside, label, o, widest }) {
  const { currency } = m
  const n = m.cats.length
  const fs = 11
  for (const p of panels) {
    const { lo, hi } = rangeOf(p, p.series, n)
    p.scale = axisScale(lo, hi, { type: p.type, counts: p.counts, target: panels.length > 1 ? 3 : 5 })
    p.ticks = axisLabels(p.scale.ticks, { type: p.type }, { currency })
  }
  // A value at the end of each line (four at most), where they don't collide.
  const lines = panels.flatMap(p => p.series.filter(s => s.mark === 'line' || p.mark === 'line' || (p.mark === 'area' && !p.stacked)))
  const ends = lines.length && lines.length <= 4
    ? lines.map(s => { let i = s.values.length - 1; while (i >= 0 && s.values[i] == null) i--; return i === n - 1 ? { s, text: markLabels(s.values, s, { currency })[i] } : null })
    : []
  const endW = ends.length && ends.every(Boolean) ? Math.max(...ends.map(e => textWidth(e.text, fs))) + 10 : 0

  const left = Math.ceil(Math.max(30, ...panels.flatMap(p => p.ticks.map(t => textWidth(t, fs)))) + 10)
  const right = Math.ceil(Math.max(12, endW))
  const plotW = Math.max(40, W - left - right)
  const band = plotW / n
  const single = panels.length === 1 && panels[0].series.length === 1 && panels[0].mark === 'bar'
  const caps = single ? markLabels(panels[0].series[0].values, panels[0].series[0], { currency }) : null
  const capped = !!caps && Math.max(...caps.map(t => textWidth(t, fs))) + 4 <= band
  // A plot says which figure it draws wherever the legend doesn't: one
  // series has no legend, and series named after a grouping don't name it.
  const titled = panels.length > 1 || !!m.of || m.series.length === 1

  // Room for the amounts on the bars whenever they could show (one series,
  // or one left after the legend hid the others): the plot never moves.
  const capRoom = m.panels.length === 1 && m.panels[0].mark === 'bar' ? 12 : 0

  let y = inside.height + 8
  const first = panels.length > 1 ? clamp(Math.round(W * 0.3), 150, 210) : clamp(Math.round(W * 0.4), 180, 300)
  panels.forEach((p, i) => {
    if (titled) { p.titleY = y + 11; y += 18 }
    if (i === 0) y += capRoom
    p.top = y
    p.h = i === 0 ? first : 120
    y += p.h + (i < panels.length - 1 ? 16 : 0)
  })
  const bottom = y
  const H = bottom + 26

  let svg = inside.svg
  const targets = []
  for (const p of panels) {
    const { min, max } = p.scale
    const py = v => p.top + p.h - ((v - min) / (max - min)) * p.h
    const zero = py(0)
    if (titled) svg += words(left, p.titleY, fitText(p.label, plotW, 11), { size: 11, weight: 600, fill: INK_2 })
    // Marks along the side, a hairline for each.
    p.scale.ticks.forEach((t, i) => {
      const ty = py(t)
      if (t !== 0) svg += el('line', { x1: left, y1: r1(ty), x2: left + plotW, y2: r1(ty), stroke: GRID, 'stroke-width': 1 })
      svg += words(left - 6, ty + 4, p.ticks[i], { size: fs, anchor: 'end' })
    })

    const bars = p.series.filter(s => s.mark === 'bar')
    if (bars.length) {
      const k = p.stacked ? 1 : bars.length
      const inner = Math.min(band * 0.76, k * 24 + (k - 1) * 2)
      const bw = Math.max(1, (inner - (k - 1) * 2) / k)
      for (let c = 0; c < n; c++) {
        const x0 = left + c * band + (band - inner) / 2
        if (p.stacked) {
          let up = 0, down = 0
          const last = { up: null, down: null }
          bars.forEach((s, si) => { const v = s.values[c]; if (v > 0) last.up = si; else if (v < 0) last.down = si })
          bars.forEach((s, si) => {
            const v = s.values[c]
            if (!v) return
            const from = v > 0 ? up : down
            const to = from + v
            if (v > 0) up = to; else down = to
            const a = py(from), b = py(to)
            const end = (v > 0 ? last.up : last.down) === si
            // A gap the colour of the page between one part and the next.
            const gap = !end && Math.abs(b - a) > 3 ? (v > 0 ? 2 : -2) : 0
            svg += end
              ? el('path', { d: barPath(x0, bw, a, b), fill: colours.get(s.key) })
              : el('rect', { x: r1(x0), y: r1(Math.min(a, b + gap)), width: r1(bw), height: r1(Math.abs(b + gap - a)), fill: colours.get(s.key) })
          })
        } else {
          bars.forEach((s, si) => {
            const v = s.values[c]
            if (v == null || v === 0) return
            svg += el('path', { d: barPath(x0 + si * (bw + 2), bw, zero, py(v)), fill: colours.get(s.key) })
          })
        }
        if (capped && panels[0].series[0].values[c] != null) {
          const v = panels[0].series[0].values[c]
          svg += words(left + c * band + band / 2, v >= 0 ? py(v) - 5 : py(v) + 13, caps[c], { size: fs, anchor: 'middle' })
        }
      }
    }

    const cx = c => left + c * band + band / 2
    if (p.mark === 'area' && p.stacked) {
      const lower = Array(n).fill(0)
      for (const s of p.series) {
        const upper = lower.map((v, c) => v + (s.values[c] || 0))
        const top = upper.map((v, c) => [cx(c), py(v)])
        const under = lower.map((v, c) => [cx(c), py(v)]).reverse()
        svg += el('path', { d: linePath(top) + 'L' + under.map(q => r1(q[0]) + ',' + r1(q[1])).join('L') + 'Z', fill: colours.get(s.key), 'fill-opacity': 0.88, stroke: SURFACE, 'stroke-width': 1.5, 'stroke-linejoin': 'round' })
        for (let c = 0; c < n; c++) lower[c] = upper[c]
      }
    } else {
      for (const s of p.series) {
        if (s.mark === 'bar') continue
        const pts = s.values.map((v, c) => (v == null ? null : [cx(c), py(v)]))
        const colour = colours.get(s.key)
        if (s.mark === 'area') {
          // The wash under the line, one run at a time (a gap stays a gap).
          let run = []
          const flush = () => {
            if (run.length > 1) svg += el('path', { d: linePath(run) + 'V' + r1(zero) + 'H' + r1(run[0][0]) + 'Z', fill: colour, 'fill-opacity': 0.12 })
            run = []
          }
          for (const q of pts) { if (q) run.push(q); else flush() }
          flush()
        }
        svg += el('path', { d: linePath(pts), fill: 'none', stroke: colour, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
        // Dots when there are few enough to tell apart; a point on its own always gets one.
        pts.forEach((q, c) => {
          if (!q) return
          const alone = !pts[c - 1] && !pts[c + 1]
          if (n <= 31 || alone) svg += el('circle', { cx: r1(q[0]), cy: r1(q[1]), r: 4, fill: colour, stroke: SURFACE, 'stroke-width': 2 })
        })
      }
    }
    svg += el('line', { x1: left, y1: r1(zero), x2: left + plotW, y2: r1(zero), stroke: BASE, 'stroke-width': 1 })
  }

  if (endW) {
    const placed = ends.map(e => { const p = panels.find(x => x.series.includes(e.s)); const { min, max } = p.scale; return { ...e, y: p.top + p.h - ((e.s.values[n - 1] - min) / (max - min)) * p.h } })
      .sort((a, b) => a.y - b.y)
    if (placed.every((e, i) => i === 0 || e.y - placed[i - 1].y >= 13)) {
      for (const e of placed) svg += words(left + plotW - band / 2 + 8, e.y + 4, e.text, { size: fs })
    }
  }

  // Names along the bottom: every one when they fit, else every few.
  const every = Math.max(1, Math.ceil((Math.min(widest, 120) + 10) / band))
  const room = Math.min(120, band * every - 6)
  m.cats.forEach((c, i) => {
    if (i % every !== 0) return
    const text = fitText(c.short, Math.max(room, 24), fs)
    const half = textWidth(text, fs) / 2
    const x = clamp(left + i * band + band / 2, half, W - half)
    svg += words(x, bottom + 16, text, { size: fs, anchor: 'middle' })
  })

  const top0 = panels[0].top
  m.cats.forEach((c, i) => targets.push({ x: r1(left + i * band), y: top0, w: r1(band), h: bottom - top0, cat: i }))
  return { svg: frame(W, H, label, svg), width: W, height: H, targets, legend, label }
}

function sidePlot(m, { W, panel, colours, legend, inside, label }) {
  const { currency } = m
  const n = m.cats.length
  const fs = 11
  const bars = panel.series
  const k = panel.stacked ? 1 : bars.length
  const bh = k === 1 ? 16 : 12
  const rowH = Math.max(28, k * bh + (k - 1) * 2 + 12)
  const labelW = Math.ceil(Math.min(Math.max(...m.cats.map(c => textWidth(c.label, 12))) + 12, W * 0.38, 220))
  // One series: its value at the end of each bar (and its share, for parts of a whole).
  const single = bars.length === 1
  const share = v => (m.total ? ' · ' + formatPercent(v / m.total, 1) : '')
  const caps = single ? m.cats.map((_, c) => { const v = bars[0].values[c]; return v == null ? '' : formatValue(v, bars[0], { currency }) + share(v) }) : null
  const capW = caps ? Math.ceil(Math.max(...caps.map(t => textWidth(t, fs))) + 10) : 12
  const { lo, hi } = rangeOf(panel, bars, n)
  const scale = axisScale(lo, hi, { type: panel.type, counts: panel.counts, target: W < 480 ? 3 : 5 })
  const left = labelW
  const plotW = Math.max(40, W - left - capW)
  const px = v => left + ((v - scale.min) / (scale.max - scale.min)) * plotW
  const zero = px(0)
  // Which figure the bars are, wherever the legend doesn't say.
  const titled = !!m.of || m.series.length === 1
  const top = inside.height + 6 + (titled ? 18 : 0)
  const H = top + n * rowH + 24

  let svg = inside.svg
  if (titled) svg += words(0, inside.height + 13, fitText(panel.label, W, 11), { size: 11, weight: 600, fill: INK_2 })
  const tickText = axisLabels(scale.ticks, { type: panel.type }, { currency })
  scale.ticks.forEach((t, ti) => {
    const x = px(t)
    if (t !== 0) svg += el('line', { x1: r1(x), y1: top, x2: r1(x), y2: top + n * rowH, stroke: GRID, 'stroke-width': 1 })
    const text = tickText[ti]
    svg += words(clamp(x, left + textWidth(text, fs) / 2, W - textWidth(text, fs) / 2), top + n * rowH + 16, text, { size: fs, anchor: 'middle' })
  })
  const targets = []
  m.cats.forEach((c, i) => {
    const y = top + i * rowH
    svg += words(left - 8, y + rowH / 2 + 4, fitText(c.label, labelW - 12, 12), { anchor: 'end', fill: c.rest ? MUTED : INK_2 })
    const y0 = y + (rowH - (k * bh + (k - 1) * 2)) / 2
    if (panel.stacked) {
      let up = 0, down = 0
      const last = { up: null, down: null }
      bars.forEach((s, si) => { const v = s.values[i]; if (v > 0) last.up = si; else if (v < 0) last.down = si })
      bars.forEach((s, si) => {
        const v = s.values[i]
        if (!v) return
        const from = v > 0 ? up : down
        const to = from + v
        if (v > 0) up = to; else down = to
        const a = px(from), b = px(to)
        const end = (v > 0 ? last.up : last.down) === si
        const gap = !end && Math.abs(b - a) > 3 ? (v > 0 ? -2 : 2) : 0
        svg += end
          ? el('path', { d: sideBarPath(y0, bh, a, b), fill: colours.get(s.key) })
          : el('rect', { x: r1(Math.min(a, b + gap)), y: r1(y0), width: r1(Math.abs(b + gap - a)), height: bh, fill: colours.get(s.key) })
      })
    } else {
      bars.forEach((s, si) => {
        const v = s.values[i]
        if (v == null || v === 0) return
        svg += el('path', { d: sideBarPath(y0 + si * (bh + 2), bh, zero, px(v)), fill: c.rest && single ? MUTED : colours.get(s.key) })
      })
    }
    if (caps && caps[i]) svg += words(Math.max(zero, px(bars[0].values[i])) + 6, y + rowH / 2 + 4, caps[i], { size: fs })
    targets.push({ x: 0, y, w: W, h: rowH, cat: i })
  })
  svg += el('line', { x1: r1(zero), y1: top, x2: r1(zero), y2: top + n * rowH, stroke: BASE, 'stroke-width': 1 })
  return { svg: frame(W, H, label, svg), width: W, height: H, targets, legend, label }
}

// Parts of a whole: one bar, a block for each part, its share inside when
// there is room. The legend names the parts in the order they sit.
function drawStack(m, o) {
  const W = widthOf(o)
  const s = m.series[0]
  const total = m.total || s.values.reduce((a, v) => a + Math.max(0, v || 0), 0)
  const colour = i => (m.cats[i].rest ? MUTED : SERIES_COLOURS[i % SERIES_COLOURS.length])
  const legend = m.cats.map((c, i) => ({ key: 'p' + i, label: c.label, colour: colour(i), mark: 'box', hidden: false, toggle: false }))
  const inside = o.legend === 'inside' ? legendInside(legend, W) : { svg: '', height: 0 }
  const label = titleOf(m)
  const head = s.label + ' · ' + formatValue(total, s, { currency: m.currency }) + ' in all'
  const top = inside.height + 20
  const shown = s.values.map((v, i) => ({ v, i })).filter(x => x.v > 0)
  const room = W - (shown.length - 1) * 2
  let svg = inside.svg + words(0, inside.height + 12, fitText(head, W, 11), { size: 11, weight: 600, fill: INK_2 })
  const targets = []
  let x = 0
  for (const { v, i } of shown) {
    const w = total > 0 ? (v / total) * room : 0
    if (w >= 0.5) {
      svg += el('rect', { x: r1(x), y: top, width: r1(w), height: 28, rx: Math.min(4, w / 2), fill: colour(i) })
      const text = formatPercent(v / total, v / total < 0.1 ? 1 : 0)
      if (textWidth(text, 12) + 16 <= w) svg += words(x + 8, top + 18, text, { fill: inkOn(colour(i)), weight: 600 })
      targets.push({ x: r1(x), y: top - 6, w: r1(Math.max(w, 1)), h: 40, cat: i })
    }
    x += w + 2
  }
  const H = top + 28 + 6
  return { svg: frame(W, H, label, svg), width: W, height: H, targets, legend, label }
}

function drawHeat(m, o) {
  const W = widthOf(o)
  const { currency } = m
  const nx = m.xs.length, ny = m.ys.length
  const fs = 11
  const brand = brandColour(o.brand)
  const ramp = brand ? rampAround(brand) : RAMP
  const labelW = Math.ceil(Math.min(Math.max(...m.ys.map(y => textWidth(y.short || y.label, 12))) + 12, W * 0.36, 200))
  const cw = clamp((W - labelW) / nx, 6, 76)
  const chH = ny > 24 ? 22 : 30
  const top = 22
  const all = m.cells.flat().filter(v => v != null)
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all)
  const shade = v => ramp[Math.round(clamp(hi > lo ? (v - lo) / (hi - lo) : 0, 0, 1) * (ramp.length - 1))]
  const label = titleOf(m)

  let svg = ''
  const widest = Math.max(...m.xs.map(x => textWidth(x.short, fs)))
  const every = Math.max(1, Math.ceil((Math.min(widest, 90) + 8) / cw))
  m.xs.forEach((x, i) => {
    if (i % every !== 0) return
    const text = fitText(x.short, Math.max(24, cw * every - 6), fs)
    svg += words(clamp(labelW + i * cw + cw / 2, labelW + textWidth(text, fs) / 2, W - textWidth(text, fs) / 2), top - 8, text, { size: fs, anchor: 'middle' })
  })
  const targets = []
  // Every cell and both ends of the scale written the same way.
  const [from, to, ...flat] = markLabels([lo, hi, ...m.cells.flat()], m.value, { currency })
  const texts = m.cells.map((row, yi) => row.map((v, xi) => flat[yi * nx + xi]))
  const fits = Math.max(0, ...flat.map(t => textWidth(t, fs))) + 6 <= cw - 2
  m.ys.forEach((yv, yi) => {
    const y = top + yi * chH
    svg += words(labelW - 8, y + chH / 2 + 4, fitText(yv.short || yv.label, labelW - 12, 12), { anchor: 'end', fill: yv.rest ? MUTED : INK_2 })
    m.xs.forEach((xv, xi) => {
      const v = m.cells[yi][xi]
      const x = labelW + xi * cw
      const fill = v == null ? WASH : shade(v)
      svg += el('rect', { x: r1(x), y, width: r1(Math.max(1, cw - 2)), height: chH - 2, rx: Math.min(3, cw / 3), fill })
      if (v != null && fits) svg += words(x + (cw - 2) / 2, y + chH / 2 + 3, texts[yi][xi], { size: fs, anchor: 'middle', fill: inkOn(fill) })
      targets.push({ x: r1(x), y, w: r1(cw), h: chH, cat: yi, series: xi })
    })
  })
  // The scale: lightest to darkest, with what each end stands for.
  const sy = top + ny * chH + 10
  let sx = labelW
  svg += words(labelW - 8, sy + 10, fitText(m.value.label, labelW - 12, fs), { size: fs, weight: 600, anchor: 'end', fill: INK_2 })
  svg += words(sx, sy + 10, from, { size: fs })
  sx += textWidth(from, fs) + 6
  ramp.forEach((c, i) => { svg += el('rect', { x: r1(sx + i * 12), y: sy, width: 12, height: 12, fill: c }) })
  svg += words(sx + ramp.length * 12 + 6, sy + 10, to, { size: fs })
  const H = sy + 18
  return { svg: frame(W, H, label, svg), width: W, height: H, targets, legend: [], label }
}

// A change as it is written (+12.4%) is format.js's: the table says it the same way.
export { changeText }

function drawFigures(m, o) {
  const W = widthOf(o)
  const { currency } = m
  const brand = brandColour(o.brand) || SERIES_COLOURS[0]
  const n = m.tiles.length
  const gap = 12
  // As many across as fit (four at most), then evened out: five are three and two.
  const fit = clamp(Math.floor((W + gap) / (168 + gap)), 1, Math.min(n, 4))
  const per = Math.ceil(n / Math.ceil(n / fit))
  const tw = (W - (per - 1) * gap) / per
  const changes = m.tiles.some(t => t.change != null)
  const trends = m.tiles.some(t => t.trend)
  const onWhat = m.against ? 'on ' + m.against : ''
  // "+12.4% on the period before" on one line when every tile has the room.
  const split = changes && !!onWhat && m.tiles.some(t => t.change != null && textWidth(changeText(t.change) + ' ' + onWhat, 12) > tw - 28)
  const th = 64 + (changes ? (split ? 34 : 20) : 0) + (trends ? 38 : 0)
  const label = titleOf(m)
  let svg = ''
  m.tiles.forEach((t, i) => {
    const x = (i % per) * (tw + gap), y = Math.floor(i / per) * (th + gap)
    svg += el('rect', { x: r1(x), y, width: r1(tw), height: th, rx: 8, fill: WASH })
    svg += words(x + 14, y + 24, fitText(t.label, tw - 28, 12), { size: 12 })
    const full = t.value == null ? '–' : formatValue(t.value, t, { currency })
    const big = textWidth(full, 24) <= tw - 28 ? full : shortValue(t.value, t, { currency })
    svg += words(x + 14, y + 52, big, { size: 24, weight: 600, fill: INK })
    let ty = y + 64
    if (changes) {
      // No colour for up or down: whether more is better depends on the figure.
      if (t.change != null && split) {
        svg += words(x + 14, ty + 8, changeText(t.change), { size: 12 })
        svg += words(x + 14, ty + 22, fitText(onWhat, tw - 28, 11), { size: 11, fill: MUTED })
      } else if (t.change != null) {
        svg += words(x + 14, ty + 8, fitText(changeText(t.change) + (onWhat ? ' ' + onWhat : ''), tw - 28, 12), { size: 12 })
      }
      ty += split ? 34 : 20
    }
    if (t.trend) {
      const vals = t.trend
      const real = vals.filter(v => v != null)
      if (real.length >= 2) {
        const lo = Math.min(...real), hi = Math.max(...real)
        const sx = c => x + 14 + (c / (vals.length - 1)) * (tw - 28)
        const sy = v => ty + 26 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * 22
        const pts = vals.map((v, c) => (v == null ? null : [sx(c), sy(v)]))
        svg += el('path', { d: linePath(pts), fill: 'none', stroke: MUTED, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
        let lastAt = vals.length - 1
        while (lastAt >= 0 && vals[lastAt] == null) lastAt--
        if (lastAt >= 0) svg += el('circle', { cx: r1(sx(lastAt)), cy: r1(sy(vals[lastAt])), r: 4, fill: brand, stroke: WASH, 'stroke-width': 2 })
      }
    }
  })
  const H = Math.ceil(n / per) * (th + gap) - gap
  return { svg: frame(W, H, label, svg), width: W, height: H, targets: [], legend: [], label }
}

/**
 * A model as a drawing.
 *
 *   opts.width    how wide, in pixels (the page measures its own room)
 *   opts.brand    the brand's main colour, for a chart of one series
 *   opts.hidden   keys of series switched off in the legend
 *   opts.legend   'inside' draws the legend in the SVG (a printed page);
 *                 otherwise the page shows `legend` itself, as buttons
 *
 * { svg, width, height, targets: [{ x, y, w, h, cat, series? }], legend:
 *   [{ key, label, colour, mark, hidden, toggle }], label }
 */
export function drawChart(model, opts = {}) {
  if (!model?.ok) return { svg: '', width: 0, height: 0, targets: [], legend: [], label: '' }
  if (model.form === 'figures') return drawFigures(model, opts)
  if (model.form === 'heat') return drawHeat(model, opts)
  if (model.form === 'stack') return drawStack(model, opts)
  return drawPlot(model, opts)
}

export function renderChart(result, opts = {}) {
  const model = chartModel(result, opts)
  if (!model.ok) return { ok: false, why: model.why, model }
  return { ok: true, model, ...drawChart(model, opts) }
}

// ── What a mark says and stands for ──────────────────────────

/**
 * The words for one mark: { title, lines: [{ label, value, colour }] }, a
 * line for every series that has something at that row (the pointer never
 * has to find a line); `none: true` and no lines when nothing does.
 * `opts.hidden` leaves switched-off series out.
 */
export function chartTip(model, target, opts = {}) {
  if (!model?.ok || !target) return null
  const { currency } = model
  if (model.form === 'heat') {
    const y = model.ys[target.cat], x = model.xs[target.series]
    if (!y || !x) return null
    const v = model.cells[target.cat][target.series]
    const title = y.label + ' · ' + x.label
    if (v == null) return { title, lines: [], none: true }
    return { title, lines: [{ label: model.value.label, value: formatValue(v, model.value, { currency }), colour: null }] }
  }
  if (model.form === 'figures') return null
  const cat = model.cats[target.cat]
  if (!cat) return null
  if (model.form === 'stack') {
    const s = model.series[0]
    const v = s.values[target.cat]
    return {
      title: cat.label,
      lines: [
        { label: s.label, value: formatValue(v, s, { currency }), colour: cat.rest ? MUTED : SERIES_COLOURS[target.cat % SERIES_COLOURS.length] },
        ...(model.total ? [{ label: 'Share', value: formatPercent(v / model.total, 1), colour: null }] : []),
      ],
    }
  }
  const off = offOf(model, opts)
  const colours = coloursOf(model, opts)
  const shown = model.series.filter(s => !off.has(s.key))
  // A line for each series that has something at this row.
  const lines = shown.filter(s => s.values[target.cat] != null)
    .map(s => ({ label: s.label, value: formatValue(s.values[target.cat], s, { currency }), colour: colours.get(s.key) }))
  if (!lines.length) return { title: cat.label, lines: [], none: true }
  if (model.total && shown.length === 1 && shown[0].values[target.cat] != null) {
    lines.push({ label: 'Share', value: formatPercent(shown[0].values[target.cat] / model.total, 1), colour: null })
  }
  // The parts of a stack, and what they come to.
  const stacked = model.panels?.filter(p => p.stacked) || []
  if (stacked.length === 1 && shown.every(s => model.panels[s.panel]?.stacked) && lines.length > 1) {
    const sum = shown.reduce((a, s) => a + (s.values[target.cat] || 0), 0)
    lines.push({ label: 'Total', value: formatValue(sum, shown[0], { currency }), colour: null })
  }
  return { title: cat.label, lines }
}

/**
 * What a mark stands for, for opening it up (docs/REPORTS.md 8): { at,
 * label, value }, where `at` holds each grouping to the mark's value and
 * `value` is the one figure it shows (when it shows one). Null for a mark
 * that stands for nothing in particular: "everything else", a day with
 * nothing on it.
 */
export function chartMark(model, target) {
  if (!model?.ok || !target) return null
  if (model.form === 'heat') {
    const y = model.ys[target.cat], x = model.xs[target.series]
    if (!y || !x || !y.at) return null
    return { at: [...y.at, ...x.at], label: y.label + ' · ' + x.label, value: model.value.value }
  }
  if (model.form === 'figures') return null
  const cat = model.cats[target.cat]
  if (!cat || !cat.at || cat.rest || cat.gap) return null
  const real = model.series.filter(s => !s.muted && !s.rest)
  const keys = new Set(real.map(s => s.value?.key))
  return { at: cat.at, label: cat.label, value: keys.size === 1 ? real[0].value : null }
}
