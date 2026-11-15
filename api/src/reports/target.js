// src/reports/target.js
//
// Finding the report a request or a schedule is about (docs/REPORTS.md 18):
// a saved report the person can open, or a starter report in code. One
// place for the report routes (src/routes/reports.js), the schedule routes
// and the schedule sender (src/reports/send.js), so who may open what is
// decided the same way everywhere.
//
//   starterOf(id)              a starter for 'starter:<key>', else null
//   savedRow(tx, id, person)   a saved report's row the person can open, else null
//   loadTarget(id, person)     { ref, saved | starter, name, description, spec };
//                              throws 404 for a report they can't open
//   checkedForRun(raw)         a stored definition as it is today; throws
//                              ReportError with its problems
//
// A target's `spec` is the definition tidied as it is today: tidying may
// have moved on since the report was saved.

import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { rightsOn } from './access.js'
import { ReportError } from './compile.js'
import { STARTER_PREFIX, starterByKey } from './starters/index.js'
import { normaliseReport, reportProblems } from '../../../shared/reports/spec.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const reportNotFound = () => httpError(404, 'Report not found')

export const starterOf = id => (typeof id === 'string' && id.startsWith(STARTER_PREFIX) ? starterByKey(id.slice(STARTER_PREFIX.length)) : null)

export async function savedRow(tx, id, p) {
  if (!UUID_RE.test(String(id || ''))) return null
  const [row] = await tx`SELECT r.* FROM reports r WHERE r.tenant_id = ${p.tenantId} AND r.id = ${String(id)}`
  return row && rightsOn(row, p).open ? row : null
}

export function checkedForRun(raw) {
  const spec = normaliseReport(raw)
  const problems = reportProblems(spec)
  if (problems.length) throw new ReportError(problems)
  return spec
}

/** The target a starter or a saved row makes: what a run, a file or a send starts from. */
export function targetOf({ starter = null, saved = null }) {
  if (starter) return { ref: starter.ref, starter, name: starter.name, description: starter.about, spec: starter.spec }
  return { ref: saved.id, saved, name: saved.name, description: saved.description, spec: checkedForRun(saved.spec) }
}

export async function loadTarget(id, p) {
  const starter = starterOf(id)
  if (starter) return targetOf({ starter })
  const saved = await withTenant(p.tenantId, tx => savedRow(tx, String(id), p))
  if (!saved) throw reportNotFound()
  return targetOf({ saved })
}
