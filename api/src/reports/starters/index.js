// src/reports/starters/index.js
//
// The starter reports (docs/REPORTS.md 11, Appendix B), put together and
// checked once when the API starts. A starter that names a field the
// catalogue no longer has, loses a part to normaliseReport(), or whose
// drill-downs can't be made stops the start: never a person's run.
//
//   STARTERS             every starter: { key, ref, name, about, area, subject, module, spec }
//   starterByKey(key)    one of them, or null
//   starterRef(key)      'starter:<key>': how a starter is named where a
//                        saved report's id would be (stars, runs, the routes)

import till from './till.js'
import online from './online.js'
import bookings from './bookings.js'
import purchasing from './purchasing.js'
import safety from './safety.js'
import loyalty from './loyalty.js'
import kitchen from './kitchen.js'
import kiosks from './kiosks.js'
import cash from './cash.js'
import staff from './staff.js'
import { CATALOGUE, CATALOGUE_MODULES, listColumns } from '../catalogue/index.js'
import { compileReport } from '../compile.js'
import { normaliseReport, reportProblems, resolveParams, rowId } from '../../../../shared/reports/spec.js'
import { drillSpec } from '../../../../shared/reports/drill.js'

export const STARTER_PREFIX = 'starter:'
export const starterRef = key => STARTER_PREFIX + key

const EVERYTHING = Object.fromEntries(CATALOGUE_MODULES.map(k => [k, 'view']))
const NOBODY = '00000000-0000-0000-0000-000000000000'

// A definition as someone who may see everything, on a fixed day: the
// catalogue's own answer to "can this run", with nothing read.
function compiles(spec) {
  const plan = compileReport(spec, { tenantId: NOBODY, levels: EVERYTHING, params: resolveParams(spec, {}), today: '2026-01-15', tz: 'Europe/London' })
  if (plan.notes.length) throw new Error(plan.notes.join('; '))
}

const count = v => (Array.isArray(v) ? v.length : 0)

function build(lists) {
  const out = []
  const seen = new Set()
  for (const s of lists.flat()) {
    const fail = msg => { throw new Error('Starter report ' + s.key + ': ' + msg) }
    if (seen.has(s.key)) fail('two starters have this key')
    seen.add(s.key)

    const spec = normaliseReport(s.spec)
    const problems = reportProblems(spec)
    if (problems.length) fail(problems.join('; '))
    const subject = CATALOGUE.subjects[spec.subject]
    if (!subject || subject.hidden) fail('"' + spec.subject + '" isn\'t something to report on')

    // What is written is what runs: the check may not have dropped a part.
    const raw = s.spec
    const kept = [
      ['rows', count(raw.rows), spec.rows.length],
      ['columns', count(raw.columns), spec.columns.length],
      ['values', spec.kind === 'list' ? 0 : count(raw.values), spec.values.length],
      ['filters', count(raw.filters), spec.filters.length],
      ['sort', count(raw.sort), spec.sort.length],
      ['subtotals', count(raw.totals?.subtotals), spec.totals.subtotals.length],
      ['drill.down', count(raw.drill?.down), count(spec.drill?.down)],
      ['drill.rows', count(raw.drill?.rows), count(spec.drill?.rows)],
      ['limit', raw.limit ? 1 : 0, spec.limit ? 1 : 0],
      ['compare', raw.compare ? 1 : 0, spec.compare ? 1 : 0],
      ['also', count(raw.also), spec.also.length],
      ['also filters', (raw.also || []).reduce((n, a) => n + count(a.filters), 0), spec.also.reduce((n, a) => n + a.filters.length, 0)],
      ['kind', raw.kind || spec.kind, spec.kind],
      ['view', raw.view?.kind || 'table', spec.view.kind],
    ]
    for (const [what, wrote, has] of kept) if (wrote !== has) fail('its ' + what + ' didn\'t survive the check (' + wrote + ' written, ' + has + ' kept)')

    try {
      compiles(spec)
      // Its drill-downs, each as the definition a tap would run.
      if (spec.kind !== 'list') {
        const rows = drillSpec(spec, { at: [], to: 'rows' }, { listColumns: listColumns(spec.subject, EVERYTHING) })
        if (rows.problem) throw new Error('its rows: ' + rows.problem)
        compiles(rows.spec)
        for (const d of spec.drill?.down || []) {
          const next = drillSpec(spec, { at: [], to: d })
          if (next.problem) throw new Error('drill to ' + rowId(d) + ': ' + next.problem)
          compiles(next.spec)
        }
      }
    } catch (e) {
      fail(e.message)
    }

    out.push(Object.freeze({
      key: s.key,
      ref: starterRef(s.key),
      name: s.name,
      about: s.about,
      area: subject.area,
      subject: spec.subject,
      module: subject.module,
      spec,
    }))
  }
  return out
}

export const STARTERS = build([till, online, bookings, cash, staff, purchasing, safety, loyalty, kitchen, kiosks])

const BY_KEY = new Map(STARTERS.map(s => [s.key, s]))
export const starterByKey = key => BY_KEY.get(key) || null
