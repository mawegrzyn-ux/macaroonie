// src/reports/drilled.js
//
// Drill steps as a request sends them (docs/REPORTS.md 8). The page never
// sends a drilled definition: it sends steps, and the server makes each
// definition from the report's own (shared/reports/drill.js), so someone who
// may only run a report can open its rows up without running a definition
// of their own, and sees only the columns their role may see.
//
//   drillSteps(raw)                 the steps tidied (cleanDrill); a step that
//                                   isn't one is refused (ReportError)
//   drilled(spec, steps, levels)    the definition the steps lead to, each
//                                   made from the one before

import { CATALOGUE, listColumns } from './catalogue/index.js'
import { ReportError } from './compile.js'
import { currencyPath } from './run.js'
import { cleanDrill, drillSpec } from '../../../shared/reports/drill.js'

export const drillSteps = raw => (raw || []).map(step => {
  const d = cleanDrill(step)
  if (!d) throw new ReportError('That isn\'t something this report can open')
  return d
})

export function drilled(spec, steps, levels) {
  let cur = spec
  for (const step of steps) {
    // The engine splits a result for venues in more than one currency by
    // itself (currencyPath()): a row of it holds the currency too.
    const next = drillSpec(cur, step, { catalogue: CATALOGUE, listColumns: subject => listColumns(subject, levels), extra: [currencyPath(cur.subject)] })
    if (next.problem) throw new ReportError(next.problem)
    cur = next.spec
  }
  return cur
}
