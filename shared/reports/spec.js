// shared/reports/spec.js
//
// The report definition (docs/REPORTS.md 6): a report is a small JSON
// document, and normaliseReport() is the one check for it. Every way in
// goes through it: the builder, a saved report being opened, Pepper's
// answers, a drill-down. It keeps what it knows, in a known shape, and
// drops the rest; it never looks at the data catalogue (the server does
// that when it runs the report, as the person asking).
//
//   {
//     version: 1,
//     kind: 'list' | 'summary' | 'matrix',
//     subject: 'till.lines',
//     params:  [{ key, type: 'period' | 'venues' | 'value', label, default }],
//     rows:    [{ field: 'section.name', bucket?, label? }],     list: its columns
//     columns: [{ field, bucket?, label? }],                     matrix only
//     values:  [{ key, measure } | { key, agg, field } | { key, agg, of } | { key, calc }, ...label, format, decimals, hidden],
//     filters: [{ field, bucket?, op, value | param } | { any: [...] } | { all: [...] } | { has: link, where: [...], not? }
//               | { counted: [measure, ...] }],                   the rows at least one of these figures counts
//     sort:    [{ by: <value key or row id>, dir }],
//     limit:   { top | bottom: N, rest_as? },
//     totals:  { grand, subtotals: [row id] },
//     compare: { with: 'previous_period' | 'last_year' },
//     drill:   { down: [{ field, bucket? }], rows: [field], open },
//              open: what a list's row opens in the app ('self', a path of
//              links to one row, 'none'; left out, the subject's usual)
//     view:    { kind, x, y: [value key], line, stacked, sideways, table_below },     shared/reports/chart.js draws it
//   }
//
// A field is a path through the catalogue's links ending in a field:
// 'name', 'check.number', 'check.venue.name'. `date` is the subject's own
// report date and `venue` its venue, whichever columns hold them.

import { normalisePeriod } from './period.js'
import { parseExpr, exprRefs, exprProblem, ExprError, MAX_EXPR_LENGTH } from './expr.js'
import { MOMENT_BUCKETS } from './format.js'

export const SPEC_VERSION = 1
export const REPORT_KINDS = ['list', 'summary', 'matrix']
export const KIND_LABELS = { list: 'List', summary: 'Summary', matrix: 'Matrix' }
export const AGGS = ['sum', 'avg', 'count', 'count_distinct', 'min', 'max']
export const AGG_LABELS = { sum: 'Total', avg: 'Average', count: 'Count', count_distinct: 'How many different', min: 'Smallest', max: 'Largest' }
export const VIEW_KINDS = ['table', 'bar', 'line', 'area', 'combo', 'parts', 'figures', 'heat']
export const VIEW_LABELS = {
  table: 'Table', bar: 'Bars', line: 'Lines', area: 'Area', combo: 'Bars with a line',
  parts: 'Parts of a whole', figures: 'Figures', heat: 'Heat table',
}
export const COMPARE_WITH = ['previous_period', 'last_year']
export const COMPARE_LABELS = { previous_period: 'The period before', last_year: 'The same dates last year' }
export const VALUE_FORMATS = ['number', 'money', 'percent', 'duration']
export const PARAM_TYPES = ['period', 'venues', 'value']

/** What a filter can ask, by the kind of field (the engine checks the field's own kind). */
export const FILTER_OPS = [
  'is', 'is_not', 'in', 'not_in', 'contains', 'not_contains', 'starts_with',
  'gt', 'gte', 'lt', 'lte', 'between', 'before', 'after', 'in_period', 'empty', 'not_empty',
]
export const OP_LABELS = {
  is: 'is', is_not: 'is not', in: 'is one of', not_in: 'is none of', contains: 'contains', not_contains: 'doesn\'t contain',
  starts_with: 'starts with', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  between: 'is between', before: 'is before', after: 'is after', in_period: 'is in', empty: 'is empty', not_empty: 'isn\'t empty',
}
export const OPS_BY_TYPE = {
  text: ['is', 'is_not', 'in', 'not_in', 'contains', 'not_contains', 'starts_with', 'empty', 'not_empty'],
  choice: ['is', 'is_not', 'in', 'not_in', 'empty', 'not_empty'],
  id: ['is', 'is_not', 'in', 'not_in', 'empty', 'not_empty'],
  number: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'empty', 'not_empty'],
  money: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  percent: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  duration: ['gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  date: ['in_period', 'is', 'before', 'after', 'between', 'empty', 'not_empty'],
  moment: ['in_period', 'is', 'before', 'after', 'between', 'empty', 'not_empty'],
  time: ['is', 'before', 'after', 'between', 'empty', 'not_empty'],
  yesno: ['is'],
}
/** A date or moment grouped into weekdays or hours is filtered as a number. */
export const BUCKET_OPS = ['is', 'is_not', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between']

export const LIMITS = {
  name: 120, label: 80, text: 200, path_hops: 4,
  rows: 8, list_columns: 30, columns: 2, values: 20, filters: 30, filter_depth: 3, in_values: 200,
  params: 12, sort: 5, drill_down: 8, drill_rows: 30, top: 500, tags: 12,
  // How many links a row may go through to the record it opens in the app.
  open_hops: 2,
}

const PATH = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arr = v => (Array.isArray(v) ? v : [])
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const bool = v => v === true

/** A field path the catalogue could hold, or null. */
export function cleanPath(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!s || s.length > 160 || !PATH.test(s) || s.split('.').length > LIMITS.path_hops + 1) return null
  return s
}

/** How a row or column is named elsewhere in the definition: its field, with its grouping. */
export const rowId = r => (r.bucket ? r.field + ':' + r.bucket : r.field)

function cleanFieldRef(raw) {
  const r = typeof raw === 'string' ? { field: raw } : obj(raw)
  if (!r) return null
  // 'date:week' is the same as { field: 'date', bucket: 'week' }.
  let field = typeof r.field === 'string' ? r.field : ''
  let bucket = typeof r.bucket === 'string' ? r.bucket : null
  if (field.includes(':')) { [field, bucket] = field.split(':') }
  field = cleanPath(field)
  if (!field) return null
  const out = { field }
  if (bucket && MOMENT_BUCKETS.includes(bucket)) out.bucket = bucket
  const label = str(r.label, LIMITS.label)
  if (label) out.label = label
  return out
}

function uniqueBy(list, keyOf) {
  const seen = new Set()
  return list.filter(x => { const k = keyOf(x); if (seen.has(k)) return false; seen.add(k); return true })
}

function cleanScalar(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.slice(0, LIMITS.text)
  return null
}

function cleanFilterValue(op, v) {
  if (op === 'empty' || op === 'not_empty') return { ok: true }
  if (op === 'in_period') {
    const p = normalisePeriod(v)
    return p ? { ok: true, value: p } : { ok: false }
  }
  if (op === 'in' || op === 'not_in') {
    const list = arr(v).map(cleanScalar).filter(x => x !== null && x !== '').slice(0, LIMITS.in_values)
    return list.length ? { ok: true, value: [...new Set(list)] } : { ok: false }
  }
  if (op === 'between') {
    const list = arr(v).map(cleanScalar)
    return list.length === 2 && list[0] !== null && list[1] !== null && list[0] !== '' && list[1] !== ''
      ? { ok: true, value: list } : { ok: false }
  }
  const x = cleanScalar(v)
  return x === null || x === '' ? { ok: false } : { ok: true, value: x }
}

function cleanFilters(raw, paramKeys, depth = 0) {
  const out = []
  for (const f0 of arr(raw)) {
    if (out.length >= LIMITS.filters) break
    const f = obj(f0)
    if (!f) continue
    if (Array.isArray(f.any) || Array.isArray(f.all)) {
      if (depth >= LIMITS.filter_depth) continue
      const key = Array.isArray(f.any) ? 'any' : 'all'
      const inner = cleanFilters(f[key], paramKeys, depth + 1)
      if (inner.length) out.push({ [key]: inner })
      continue
    }
    if (Array.isArray(f.counted)) {
      // Only the rows these figures count (a dish sold is one on a closed
      // check). What a drill into "the rows behind a figure" is filtered by.
      const paths = [...new Set(f.counted.map(cleanPath).filter(Boolean))].slice(0, LIMITS.values)
      if (paths.length) out.push({ counted: paths })
      continue
    }
    if (typeof f.has === 'string') {
      if (depth >= LIMITS.filter_depth) continue
      const link = cleanPath(f.has)
      if (!link) continue
      const where = cleanFilters(f.where, paramKeys, depth + 1)
      out.push({ has: link, where, ...(f.not === true ? { not: true } : {}) })
      continue
    }
    const ref = cleanFieldRef(f)
    const op = FILTER_OPS.includes(f.op) ? f.op : null
    if (!ref || !op) continue
    const cond = { field: ref.field, ...(ref.bucket ? { bucket: ref.bucket } : {}), op }
    if (typeof f.param === 'string' && paramKeys.has(f.param)) {
      cond.param = f.param
    } else {
      const v = cleanFilterValue(op, f.value)
      if (!v.ok) continue
      if ('value' in v) cond.value = v.value
    }
    out.push(cond)
  }
  return out
}

function cleanParams(raw) {
  const out = []
  for (const p0 of arr(raw)) {
    if (out.length >= LIMITS.params) break
    const p = obj(p0)
    const key = typeof p?.key === 'string' && /^[a-z][a-z0-9_]{0,30}$/.test(p.key) ? p.key : null
    if (!key || !PARAM_TYPES.includes(p.type) || out.some(x => x.key === key)) continue
    const label = str(p.label, LIMITS.label)
    const base = { key, type: p.type, ...(label ? { label } : {}) }
    if (p.type === 'period') {
      out.push({ ...base, default: normalisePeriod(p.default) || { relative: 'last_week' } })
    } else if (p.type === 'venues') {
      out.push({ ...base, default: cleanVenues(p.default) })
    } else {
      const d = Array.isArray(p.default)
        ? p.default.map(cleanScalar).filter(x => x !== null && x !== '').slice(0, LIMITS.in_values)
        : cleanScalar(p.default)
      out.push({ ...base, default: d === '' ? null : d })
    }
  }
  return out
}

/** 'all', or a list of venue ids. */
export function cleanVenues(v) {
  if (Array.isArray(v)) {
    const ids = [...new Set(v.filter(x => typeof x === 'string' && UUID.test(x)).map(x => x.toLowerCase()))].slice(0, 500)
    return ids.length ? ids : 'all'
  }
  return 'all'
}

function cleanValues(raw) {
  const out = []
  const keys = new Set()
  const unique = base => {
    let k = base, n = 2
    while (keys.has(k)) k = base + '_' + n++
    keys.add(k)
    return k
  }
  let calcs = 0
  for (const v0 of arr(raw)) {
    if (out.length >= LIMITS.values) break
    const v = obj(v0)
    if (!v) continue
    let entry = null
    let base = null
    if (typeof v.measure === 'string') {
      const m = cleanPath(v.measure)
      if (!m) continue
      entry = { measure: m }
      base = m
    } else if (typeof v.calc === 'string') {
      const text = v.calc.trim().slice(0, MAX_EXPR_LENGTH)
      if (!text) continue
      entry = { calc: text }
      base = 'calc_' + ++calcs
    } else if (AGGS.includes(v.agg)) {
      if (typeof v.of === 'string' && v.of.trim()) {
        if (v.agg === 'count' || v.agg === 'count_distinct') continue
        entry = { agg: v.agg, of: v.of.trim().slice(0, MAX_EXPR_LENGTH) }
        base = v.agg + '_' + ++calcs
      } else if (v.agg === 'count' && !v.field) {
        entry = { agg: 'count' }
        base = 'count'
      } else {
        const f = cleanPath(v.field)
        if (!f) continue
        entry = { agg: v.agg, field: f }
        base = v.agg + '_' + f.replace(/\./g, '_')
      }
    } else continue
    const wanted = typeof v.key === 'string' && KEY.test(v.key) && v.key.length <= 60 ? v.key : null
    entry = { key: unique(wanted || base), ...entry }
    const label = str(v.label, LIMITS.label)
    if (label) entry.label = label
    if (VALUE_FORMATS.includes(v.format)) entry.format = v.format
    if (Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 6) entry.decimals = v.decimals
    if (v.hidden === true) entry.hidden = true
    out.push(entry)
  }
  return out
}

/**
 * A definition in the one known shape. Unknown parts are dropped; a part
 * that makes no sense with the rest is dropped too (columns in a list,
 * subtotals with a top N). The result always has every key.
 */
export function normaliseReport(raw) {
  const r = obj(raw) || {}
  const subject = cleanPath(r.subject) || ''

  const params = cleanParams(r.params)
  const paramKeys = new Set(params.map(p => p.key))

  let columns = uniqueBy(arr(r.columns).map(cleanFieldRef).filter(Boolean), rowId).slice(0, LIMITS.columns)
  let values = cleanValues(r.values)

  // What kind of report: as said, else worked out from its parts.
  let kind = REPORT_KINDS.includes(r.kind) ? r.kind : (columns.length ? 'matrix' : values.length ? 'summary' : 'list')
  if (kind === 'matrix' && !columns.length) kind = 'summary'
  if (kind !== 'matrix') columns = []
  if (kind === 'list') values = []

  const rows = uniqueBy(arr(r.rows).map(cleanFieldRef).filter(Boolean), rowId)
    .slice(0, kind === 'list' ? LIMITS.list_columns : LIMITS.rows)
    // A list shows fields as they are: no grouping into weeks or months.
    .map(x => (kind === 'list' && x.bucket ? { field: x.field, ...(x.label ? { label: x.label } : {}) } : x))
  const rowIds = new Set(rows.map(rowId))
  // A matrix's column can't also be one of its rows.
  if (kind === 'matrix') columns = columns.filter(c => !rowIds.has(rowId(c)))
  if (kind === 'matrix' && !columns.length) kind = 'summary'

  const valueKeys = new Set(values.map(v => v.key))

  const filters = cleanFilters(r.filters, paramKeys)

  const sort = []
  for (const s0 of arr(r.sort)) {
    const s = obj(s0)
    const by = typeof s?.by === 'string' ? s.by.trim().toLowerCase() : ''
    if (!by || sort.some(x => x.by === by)) continue
    // A list sorts by any of its fields; a summary by a value or a grouping.
    const known = kind === 'list' ? !!cleanPath(by) : (valueKeys.has(by) || rowIds.has(by))
    if (!known) continue
    sort.push({ by, dir: s.dir === 'desc' ? 'desc' : 'asc' })
    if (sort.length >= LIMITS.sort) break
  }

  let limit = null
  const l = obj(r.limit)
  if (l && kind !== 'list') {
    const which = Number.isFinite(Number(l.top)) && Number(l.top) >= 1 ? 'top' : Number.isFinite(Number(l.bottom)) && Number(l.bottom) >= 1 ? 'bottom' : null
    if (which && rows.length) {
      limit = { [which]: Math.min(LIMITS.top, Math.round(Number(l[which]))) }
      const rest = str(l.rest_as, LIMITS.label)
      if (rest) limit.rest_as = rest
    }
  }

  const t = obj(r.totals) || {}
  // Subtotals sit after each group of an outer grouping, so the innermost
  // grouping never has one; with a top N there are none (the rows shown
  // wouldn't add up to them).
  const subtotals = limit || kind !== 'summary' ? [] : uniqueBy(
    arr(t.subtotals).map(x => (typeof x === 'string' ? x.trim().toLowerCase() : '')).filter(x => rowIds.has(x)),
    x => x,
  ).filter(x => x !== (rows.length ? rowId(rows[rows.length - 1]) : null))
  const totals = { grand: t.grand !== false, subtotals }

  const c = obj(r.compare)
  const compare = c && COMPARE_WITH.includes(c.with) && kind === 'summary' ? { with: c.with } : null

  let drill = null
  const d = obj(r.drill)
  if (d) {
    const down = uniqueBy(arr(d.down).map(cleanFieldRef).filter(Boolean), rowId).slice(0, LIMITS.drill_down)
      .map(x => ({ field: x.field, ...(x.bucket ? { bucket: x.bucket } : {}) }))
    const drows = [...new Set(arr(d.rows).map(cleanPath).filter(Boolean))].slice(0, LIMITS.drill_rows)
    // What a list's row opens in the app: 'self', a path of links to the row
    // that does, or 'none'. Left out, the subject's usual (docs/REPORTS.md 8).
    const open = d.open === 'self' || d.open === 'none' ? d.open
      : (p => (p && p.split('.').length <= LIMITS.open_hops ? p : null))(cleanPath(d.open))
    if (down.length || drows.length || open) drill = { down, rows: drows, ...(open ? { open } : {}) }
  }

  const v = obj(r.view) || {}
  const view = { kind: VIEW_KINDS.includes(v.kind) ? v.kind : 'table' }
  if (kind === 'list') view.kind = 'table'
  if (view.kind !== 'table') {
    const x = typeof v.x === 'string' ? v.x.trim().toLowerCase() : ''
    if (rowIds.has(x)) view.x = x
    const y = [...new Set(arr(v.y).filter(k => typeof k === 'string' && valueKeys.has(k)))]
    if (y.length) view.y = y
    if (bool(v.stacked)) view.stacked = true
    if (bool(v.sideways)) view.sideways = true
    if (typeof v.line === 'string' && valueKeys.has(v.line)) view.line = v.line
    view.table_below = v.table_below !== false
  }

  return { version: SPEC_VERSION, kind, subject, params, rows, columns, values, filters, sort, limit, totals, compare, drill, view }
}

/**
 * What stops a definition from running, as sentences (an empty list when
 * nothing does). The server adds what only the catalogue can say: fields
 * that don't exist, or that the person may not see.
 */
export function reportProblems(spec) {
  const out = []
  if (!spec?.subject) out.push('Choose what the report is about')
  if (spec.kind === 'list' && !spec.rows.length) out.push('Add at least one column to the list')
  if (spec.kind === 'summary' && !spec.rows.length && !spec.values.length) out.push('Add a value to add up, or something to group by')
  if (spec.kind === 'matrix' && !spec.values.some(v => !v.hidden)) out.push('A matrix needs a value in its cells')
  const keys = new Set(spec.values.map(v => v.key))
  const calcKeys = new Set(spec.values.filter(v => v.calc).map(v => v.key))
  for (const v of spec.values) {
    if (!v.calc) continue
    try {
      const ast = parseExpr(v.calc)
      const why = exprProblem(ast, { context: 'summary', known: n => keys.has(n) && n !== v.key })
      if (why) { out.push((v.label || v.key) + ': ' + why); continue }
      // A calculation reads plain values, not other calculations (no chains to untangle).
      const chained = exprRefs(ast).find(n => calcKeys.has(n))
      if (chained) out.push((v.label || v.key) + ': a calculation can\'t use another calculation ("' + chained + '")')
    } catch (e) {
      out.push((v.label || v.key) + ': ' + (e instanceof ExprError ? e.message : 'the calculation can\'t be read'))
    }
  }
  for (const v of spec.values) {
    if (!v.of) continue
    try {
      const why = exprProblem(parseExpr(v.of), { context: 'row' })
      if (why) out.push((v.label || v.key) + ': ' + why)
    } catch (e) {
      out.push((v.label || v.key) + ': ' + (e instanceof ExprError ? e.message : 'the calculation can\'t be read'))
    }
  }
  if (spec.limit && !spec.values.some(v => !v.hidden)) out.push('A top or bottom N needs a value to rank by')
  return out
}

/** The value a top or bottom N ranks by: the first sort that names a value, else the first value shown. */
export function rankKey(spec) {
  const keys = new Set(spec.values.map(v => v.key))
  const bySort = spec.sort.find(s => keys.has(s.by))
  if (bySort) return bySort.by
  return spec.values.find(v => !v.hidden)?.key || null
}

/** Every period parameter's key (a report usually has one). */
export const periodParams = spec => spec.params.filter(p => p.type === 'period').map(p => p.key)

/**
 * The values a run uses for a definition's parameters: what was given,
 * checked, else each parameter's default. { [key]: value }
 */
export function resolveParams(spec, given) {
  const g = obj(given) || {}
  const out = {}
  for (const p of spec.params) {
    const v = g[p.key]
    if (p.type === 'period') out[p.key] = normalisePeriod(v) || p.default
    else if (p.type === 'venues') out[p.key] = v === undefined ? p.default : cleanVenues(v)
    else if (v === undefined) out[p.key] = p.default
    else if (Array.isArray(v)) out[p.key] = v.map(cleanScalar).filter(x => x !== null && x !== '').slice(0, LIMITS.in_values)
    else { const x = cleanScalar(v); out[p.key] = x === '' ? null : x }
  }
  return out
}

/** A new, empty definition about a subject, with the usual period and venues to ask for. */
export function newReport(subject, { dated = true, venue = true } = {}) {
  return normaliseReport({
    version: SPEC_VERSION,
    kind: 'summary',
    subject,
    params: [
      ...(dated ? [{ key: 'period', type: 'period', default: { relative: 'last_week' } }] : []),
      ...(venue ? [{ key: 'venues', type: 'venues', default: 'all' }] : []),
    ],
    filters: [
      ...(dated ? [{ field: 'date', op: 'in_period', param: 'period' }] : []),
      ...(venue ? [{ field: 'venue', op: 'in', param: 'venues' }] : []),
    ],
  })
}
