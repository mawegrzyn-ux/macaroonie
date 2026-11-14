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
//
// A report with figures from other subjects (its `also`): breaking a row
// down keeps them, each held to the row as it finds it (shared/reports/
// also.js); one that can't be lined up with the row goes, with the figures
// and calculations that read it. The rows behind one of its figures are
// that subject's rows.

import { normaliseReport, rowId, LIMITS } from './spec.js'
import { parseExpr, exprRefs } from './expr.js'
import { sharedFilters, heldFilters } from './also.js'

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
 * `from` is whose rows: null the report's own subject, else the key of one
 * of its other subjects; figures of any other subject count none of them.
 */
export function countedBy(spec, valueKey = null, { from = null } = {}) {
  const byKey = new Map(spec.values.map(v => [v.key, v]))
  const mine = v => (v.from || null) === from
  const start = valueKey && byKey.has(valueKey) ? [byKey.get(valueKey)] : spec.values.filter(v => !v.hidden && mine(v))
  const out = new Set()
  const seen = new Set()
  const add = v => {
    if (!v || seen.has(v.key)) return true
    seen.add(v.key)
    if (!v.calc && !mine(v)) return true          // another subject's rows, not these
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

// The subject a value's rows come from: one of the report's other subjects
// (its key), else null. A calculation's are those of the values it reads,
// when they are all one subject's.
function readsFrom(spec, key) {
  const byKey = new Map(spec.values.map(v => [v.key, v]))
  const v = byKey.get(key)
  if (!v) return null
  if (!v.calc) return v.from || null
  let names = []
  try { names = exprRefs(parseExpr(v.calc)) } catch { return null }
  const froms = new Set(names.map(n => byKey.get(n)?.from || null))
  return froms.size === 1 ? [...froms][0] : null
}

// The report's values without the figures of the subjects that went, and
// without the calculations reading them (a calculation never reads another).
function keepValues(spec, dropped) {
  if (!dropped.size) return spec.values
  const gone = new Set(spec.values.filter(v => v.from && dropped.has(v.from)).map(v => v.key))
  return spec.values.filter(v => {
    if (gone.has(v.key)) return false
    if (!v.calc) return true
    try { return !exprRefs(parseExpr(v.calc)).some(n => gone.has(n)) } catch { return true }
  })
}

/**
 * The definition a drill asks for, from the report's own definition.
 *   catalogue    the data catalogue (catalogueView() or the API's own):
 *                needed to hold the report's other subjects to a row
 *   listColumns  the usual list columns, used when the report names none:
 *                an array for the report's own subject, or a function of a
 *                subject's key (the rows behind another subject's figure)
 *   extra        paths the engine may have grouped a result by on its own
 *                (the currency, for venues in more than one), so a row of
 *                such a result can still say which group it sits in
 * Returns { spec } or { problem }.
 */
export function drillSpec(spec, drill, { catalogue = null, listColumns = [], extra = [] } = {}) {
  const d = cleanDrill(drill)
  if (!d) return { problem: 'That isn\'t something this report can open' }
  if (spec.kind === 'list') return { problem: 'A list is already its own rows' }
  const columnsFor = typeof listColumns === 'function' ? listColumns : subject => (subject === spec.subject ? listColumns : [])

  // "This row": only groupings the report has (or offers to break down by).
  const groupings = new Map()
  for (const r of [...spec.rows, ...spec.columns, ...(spec.drill?.down || [])]) groupings.set(rowId(r), r)
  for (const field of extra) if (field && !groupings.has(field)) groupings.set(field, { field })
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

  // The other subjects, each held to this row as it finds it; one that can't
  // be lined up with the row goes.
  const parts = []
  const dropped = new Set()
  for (const a of spec.also || []) {
    const h = !held.length ? { ok: true, filters: [] } : catalogue ? heldFilters(catalogue, spec.subject, a.subject, held) : { ok: false }
    if (h.ok) parts.push({ ...a, filters: [...a.filters, ...h.filters] })
    else dropped.add(a.key)
  }

  if (d.to === 'rows') {
    // A figure of another subject: that subject's rows, with the report's
    // period and venues as it takes them, its own filters and this row.
    const from = d.value ? readsFrom(spec, d.value) : null
    if (from) {
      const part = parts.find(a => a.key === from)
      if (!part || !catalogue) return { problem: 'The rows behind that figure can\'t be listed for this row' }
      const columns = columnsFor(part.subject)
      if (!columns.length) return { problem: 'This report has no rows to show' }
      const counted = countedBy(spec, d.value, { from })
      return {
        spec: normaliseReport({
          version: spec.version, kind: 'list', subject: part.subject, params: spec.params,
          rows: columns.map(field => ({ field })),
          filters: [...sharedFilters(catalogue, { ...spec, filters }, part.subject).filters, ...part.filters, ...(counted ? [{ counted }] : [])],
        }),
      }
    }
    const columns = spec.drill?.rows?.length ? spec.drill.rows : columnsFor(spec.subject)
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
  const values = keepValues(spec, dropped)
  const valueKeys = new Set(values.map(v => v.key))
  return {
    spec: normaliseReport({
      version: spec.version, kind: 'summary', subject: spec.subject, params: spec.params,
      also: parts,
      rows: [next], values, filters,
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
