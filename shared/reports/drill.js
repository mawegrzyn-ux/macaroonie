// shared/reports/drill.js
//
// Drill-downs (docs/REPORTS.md 8). A row of a summary, or a cell of a
// matrix, stands for the rows behind it; drilling makes another definition
// from the report's own: the same subject, the same filters, plus "this
// row": each grouping the row sits in, held to its value.
//
//   to: 'rows'              the rows behind the figure, as a list. With
//                           `value` (one of the report's value keys) the
//                           rows that figure counts; without, the rows any
//                           of the report's figures count.
//   to: { field, bucket }   the same figures broken down by another field
//                           (one the report offers in drill.down)
//
// The server makes the drilled definition itself from the saved report and
// this small request, so a person who may only run a report can still drill
// into it without being able to run a definition of their own.

import { normaliseReport, rowId, LIMITS } from './spec.js'
import { parseExpr, exprRefs } from './expr.js'

const VALUE_KEY = /^[a-z][a-z0-9_]{0,59}$/

/** A drill request as it may be sent: { at: [{ field, bucket?, value }], to, value? }. Null when it says nothing. */
export function cleanDrill(raw) {
  if (!raw || typeof raw !== 'object') return null
  const at = []
  for (const a of Array.isArray(raw.at) ? raw.at : []) {
    if (!a || typeof a.field !== 'string' || at.length >= LIMITS.rows + LIMITS.columns + LIMITS.drill_down) continue
    const v = a.value
    const value = v === null || v === undefined || v === ''
      ? null
      : typeof v === 'number' ? (Number.isFinite(v) ? v : null)
        : typeof v === 'boolean' ? v
          : typeof v === 'string' ? v.slice(0, LIMITS.text) : null
    at.push({ field: a.field, ...(typeof a.bucket === 'string' ? { bucket: a.bucket } : {}), value })
  }
  let to = null
  if (raw.to === 'rows') to = 'rows'
  else if (raw.to && typeof raw.to === 'object' && typeof raw.to.field === 'string') {
    to = { field: raw.to.field, ...(typeof raw.to.bucket === 'string' ? { bucket: raw.to.bucket } : {}) }
  }
  if (!to) return null
  const value = to === 'rows' && typeof raw.value === 'string' && VALUE_KEY.test(raw.value) ? raw.value : null
  return { at, to, ...(value ? { value } : {}) }
}

/**
 * The catalogue figures behind a report's values, for "the rows behind a
 * figure": the measures the tapped value (or, with no value named, every
 * value the report shows) is made of. Null when one of them counts every
 * row (a plain total of a field, a count of rows), so nothing is left out.
 */
export function countedBy(spec, valueKey = null) {
  const byKey = new Map(spec.values.map(v => [v.key, v]))
  const start = valueKey && byKey.has(valueKey) ? [byKey.get(valueKey)] : spec.values.filter(v => !v.hidden)
  const out = new Set()
  const seen = new Set()
  const add = v => {
    if (!v || seen.has(v.key)) return true
    seen.add(v.key)
    if (v.measure) { out.add(v.measure); return true }
    if (v.calc) {
      let names = []
      try { names = exprRefs(parseExpr(v.calc)) } catch { return true }
      return names.every(n => add(byKey.get(n)))
    }
    return false          // a total, an average or a count of the rows themselves
  }
  for (const v of start) if (!add(v)) return null
  return out.size ? [...out] : null
}

/**
 * The definition a drill asks for, from the report's own definition.
 * `listColumns` are the subject's usual list columns (from the catalogue),
 * used when the report names none. `also` are paths the engine may have
 * grouped a result by on its own (the currency, for venues in more than one),
 * so a row of such a result can still say which group it sits in. Returns
 * { spec } or { problem }.
 */
export function drillSpec(spec, drill, { listColumns = [], also = [] } = {}) {
  const d = cleanDrill(drill)
  if (!d) return { problem: 'That isn\'t something this report can open' }
  if (spec.kind === 'list') return { problem: 'A list is already its own rows' }

  // "This row": only groupings the report has (or offers to break down by).
  const groupings = new Map()
  for (const r of [...spec.rows, ...spec.columns, ...(spec.drill?.down || [])]) groupings.set(rowId(r), r)
  for (const field of also) if (field && !groupings.has(field)) groupings.set(field, { field })
  const held = []
  for (const a of d.at) {
    const g = groupings.get(rowId(a))
    if (!g) return { problem: 'This report isn\'t grouped by "' + rowId(a) + '"' }
    if (held.some(h => rowId(h) === rowId(g))) continue
    held.push(a.value === null
      ? { field: g.field, ...(g.bucket ? { bucket: g.bucket } : {}), op: 'empty' }
      : { field: g.field, ...(g.bucket ? { bucket: g.bucket } : {}), op: 'is', value: a.value })
  }
  const filters = [...spec.filters, ...held]

  if (d.to === 'rows') {
    const columns = spec.drill?.rows?.length ? spec.drill.rows : listColumns
    if (!columns.length) return { problem: 'This report has no rows to show' }
    // The rows the figure is made of: a figure with a rule of its own (dishes
    // on closed checks, not voided) lists the rows that rule lets through.
    const counted = countedBy(spec, d.value)
    return {
      spec: normaliseReport({
        version: spec.version, kind: 'list', subject: spec.subject, params: spec.params,
        rows: columns.map(field => ({ field })),
        filters: counted ? [...filters, { counted }] : filters,
        // Each row opens what the report's rows open (the check, the booking).
        ...(spec.drill?.open ? { drill: { open: spec.drill.open } } : {}),
      }),
    }
  }

  const next = (spec.drill?.down || []).find(x => rowId(x) === rowId(d.to))
  if (!next) return { problem: 'This report can\'t be broken down by "' + rowId(d.to) + '"' }
  const valueKeys = new Set(spec.values.map(v => v.key))
  return {
    spec: normaliseReport({
      version: spec.version, kind: 'summary', subject: spec.subject, params: spec.params,
      rows: [next], values: spec.values, filters,
      // The same order where it is by a figure; a breakdown starts with the biggest.
      sort: spec.sort.filter(s => valueKeys.has(s.by)),
      totals: { grand: true },
      compare: spec.compare,
      // The next level down from there keeps the ones not used yet.
      drill: { down: (spec.drill?.down || []).filter(x => rowId(x) !== rowId(next) && !held.some(h => rowId(h) === rowId(x))), rows: spec.drill?.rows || [], open: spec.drill?.open },
      view: { kind: 'table' },
    }),
  }
}
