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
//                              throws 404 for a report they can't open, and
//                              422 for a Page report unless { page: true }
//                              (a page is opened, printed, copied and starred;
//                              it is never run, kept, scheduled or planned)
//   loadTargets(refs, person)  the reports a page names, in one read: a Map
//                              of ref to its target, or null for one that
//                              isn't there or isn't shared with the person; a
//                              report whose definition has problems comes
//                              back with `problem` and no spec
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
import { normalisePage, PAGE_SUBJECT } from '../../../shared/reports/page.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const reportNotFound = () => httpError(404, 'Report not found')

export const PAGE_ONLY = 'This is a page of several reports. Open it to read or print it: its reports are run, kept and scheduled one by one'

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
export function targetOf({ starter = null, saved = null }, { page = false } = {}) {
  if (starter) return { ref: starter.ref, starter, name: starter.name, description: starter.about, spec: starter.spec }
  if (saved.subject === PAGE_SUBJECT) {
    if (!page) throw httpError(422, PAGE_ONLY)
    return { ref: saved.id, saved, name: saved.name, description: saved.description, spec: normalisePage(saved.spec), page: true }
  }
  return { ref: saved.id, saved, name: saved.name, description: saved.description, spec: checkedForRun(saved.spec) }
}

export async function loadTarget(id, p, opts = {}) {
  const starter = starterOf(id)
  if (starter) return targetOf({ starter })
  const saved = await withTenant(p.tenantId, tx => savedRow(tx, String(id), p))
  if (!saved) throw reportNotFound()
  return targetOf({ saved }, opts)
}

export async function loadTargets(refs, p) {
  const out = new Map()
  const ids = [...new Set(refs.map(String).filter(r => UUID_RE.test(r)))]
  const rows = ids.length
    ? await withTenant(p.tenantId, tx => tx`SELECT r.* FROM reports r WHERE r.tenant_id = ${p.tenantId} AND r.id = ANY(${ids}::uuid[])`)
    : []
  const byId = new Map(rows.map(r => [r.id, r]))
  for (const ref of refs) {
    if (out.has(ref)) continue
    const starter = starterOf(ref)
    const saved = starter ? null : byId.get(String(ref).toLowerCase())
    // A page can't hold a page.
    if (!starter && (!saved || !rightsOn(saved, p).open || saved.subject === PAGE_SUBJECT)) { out.set(ref, null); continue }
    try {
      out.set(ref, targetOf({ starter, saved }))
    } catch (e) {
      if (!(e instanceof ReportError)) throw e
      out.set(ref, { ref: saved.id, saved, name: saved.name, description: saved.description, spec: null, problem: e.problems.join(' ') })
    }
  }
  return out
}
