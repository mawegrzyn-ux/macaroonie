// shared/reports/choices.js
//
// The answer to one of the smart builder's questions, as a change any
// definition can take (docs/REPORTS.md 10). The server says what each
// choice changes; the page applies the choices picked one after another to
// the report as it is then, so answering one question never undoes another
// (picking the venue, then the dish).
//
//   { venues: { from: venueId, to: [venueIds] } }
//     the venue the report started with swapped for the ones chosen
//   { filter: { index, from: 'name', to: ['name', ...] } }
//     a name in a filter's value (the filter at that place in the report's
//     own filters) swapped for the ones chosen: two or more make the filter
//     "is one of" ("isn't one of" for one that leaves names out)
//
//   applyChange(spec, change) -> a whole checked definition, or the same
//   object when the change doesn't fit it (what it swaps isn't there)

import { setFilter, setParamDefault } from './build.js'
import { LIMITS } from './spec.js'

const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [])

export function applyChange(spec, change) {
  if (!spec || !change || typeof change !== 'object') return spec

  if (change.venues) {
    const { from } = change.venues
    const to = ids(change.venues.to)
    const p = (spec.params || []).find(x => x.type === 'venues')
    const now = Array.isArray(p?.default) ? p.default : []
    if (!p || !to.length || !now.includes(from)) return spec
    return setParamDefault(spec, p.key, [...new Set(now.flatMap(id => (id === from ? to : [id])))])
  }

  if (change.filter) {
    const { index, from } = change.filter
    const to = ids(change.filter.to)
    const f = Number.isInteger(index) ? (spec.filters || [])[index] : null
    if (!f?.field || !to.length) return spec
    const param = f.param ? (spec.params || []).find(x => x.key === f.param) : null
    const now = [].concat((param ? param.default : f.value) ?? [])
    if (!now.includes(from)) return spec
    const values = [...new Set(now.flatMap(v => (v === from ? to : [v])))].slice(0, LIMITS.in_values)
    const many = values.length > 1 || f.op === 'in' || f.op === 'not_in'
    const op = many ? (f.op === 'is_not' || f.op === 'not_in' ? 'not_in' : 'in') : f.op
    const cond = { field: f.field, ...(f.bucket ? { bucket: f.bucket } : {}), op, value: many ? values : values[0] }
    return setFilter(spec, index, cond, { ask: !!param, label: param?.label || '' })
  }

  return spec
}
