// src/reports/access.js
//
// Who may do what with reports (docs/REPORTS.md 17). What data a person
// sees is the engine's business: every run is compiled as the person
// looking, against the modules the catalogue names. This file is about the
// reports themselves.
//
//   Reports View      open and run reports shared with them and the starter
//                     reports; change the period and venues; drill
//   Reports Use       build and save their own; download files
//   Reports Manage    every report in the group; share one with roles or
//                     everyone; offer one to the team as a starter
//
//   reportPerson(req)        the caller: { tenantId, sub, email, level, levels,
//                            roleId, canUse, canManage, ctx } (ctx is what
//                            run.js takes)
//   rightsOn(row, person)    { open, edit, share } on a saved report
//   openTo(tx, person)       the same "open" rule as a SQL condition on `r`
//   runsFor(subject, levels) { runs, needs }: whether the person may report
//                            on the subject, else the area they would need
//   checkedSpec(raw, person) a definition tidied and checked as the person
//                            (nothing is read); throws ReportError
//   refuseOtherVenues(person, spec, params)
//                            404 when a definition or a run names another
//                            group's venue (the app's rule for venue ids)
//   recordRun(person, run)   one row of report_runs (never throws)
//   cleanUpReportRuns()      hourly: run records after 400 days

import { withTenant, systemSql } from '../config/db.js'
import { permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { effectiveRoleId } from '../services/roles.js'
import { permissionAtLeast, MODULES } from '../config/modules.js'
import { CATALOGUE, CATALOGUE_MODULES, canReportOn } from './catalogue/index.js'
import { compileReport, ReportError } from './compile.js'
import { normaliseReport, reportProblems, resolveParams, rowId } from '../../../shared/reports/spec.js'
import { todayIn } from '../../../shared/reports/period.js'

const MODULE_LABELS = Object.fromEntries(MODULES.map(m => [m.key, m.label]))
const KEEP_RUN_DAYS = 400
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function reportPerson(req) {
  const levels = await permissionLevels(req, [...CATALOGUE_MODULES, 'reports'])
  const level = levels.reports || 'none'
  const canManage = permissionAtLeast(level, 'manage')
  return {
    tenantId: req.tenantId,
    sub: req.user.sub,
    email: req.user.email || null,
    level,
    levels,
    // Only "shared with these roles" asks which role the person has.
    roleId: canManage ? null : await effectiveRoleId(req),
    canUse: permissionAtLeast(level, 'use'),
    canManage,
    ctx: { tenantId: req.tenantId, userKey: req.user.sub, levels },
  }
}

export function rightsOn(row, p) {
  const mine = row.owner_sub === p.sub
  const shared = row.shared === 'everyone'
    || (row.shared === 'roles' && !!p.roleId && (row.shared_role_ids || []).includes(p.roleId))
  return {
    open: p.canManage || mine || shared || !!row.is_starter,
    // Someone who made a report and has since lost Use can still open it.
    edit: p.canManage || (mine && p.canUse),
    share: p.canManage,
  }
}

export const openTo = (tx, p) => (p.canManage
  ? tx`true`
  : tx`(r.owner_sub = ${p.sub} OR r.is_starter OR r.shared = 'everyone'
        OR (r.shared = 'roles' AND ${p.roleId}::uuid = ANY(r.shared_role_ids)))`)

export function runsFor(subjectKey, levels) {
  const s = CATALOGUE.subjects[subjectKey]
  if (!s || s.hidden) return { runs: false, needs: null }
  if (canReportOn(s, levels)) return { runs: true, needs: null }
  return { runs: false, needs: MODULE_LABELS[s.module] || null }
}

export function checkedSpec(raw, p) {
  const spec = normaliseReport(raw)
  const problems = reportProblems(spec)
  if (problems.length) throw new ReportError(problems)
  // What the catalogue says about it, as the person saving it. The day and
  // time zone only decide which dates a period means: any will do.
  const plan = compileReport(spec, {
    tenantId: p.tenantId,
    levels: p.levels,
    params: resolveParams(spec, {}),
    today: todayIn('Europe/London'),
    tz: 'Europe/London',
  })
  return { spec, notes: plan.notes }
}

// The venue ids a definition or a run names: the venues it asks for (their
// usual choice and the one given), and any filter on a venue itself.
function namedVenues(spec, params) {
  const ids = new Set()
  const add = v => {
    for (const x of [].concat(v ?? [])) if (typeof x === 'string' && UUID_RE.test(x)) ids.add(x.toLowerCase())
  }
  const byKey = new Map((spec?.params || []).map(x => [x.key, x]))
  for (const x of byKey.values()) if (x.type === 'venues') { add(x.default); add(params?.[x.key]) }
  const walk = list => {
    for (const f of list || []) {
      if (f.any) walk(f.any)
      else if (f.all) walk(f.all)
      else if (f.has) walk(f.where)
      else if (f.field === 'venue' || String(f.field || '').endsWith('.venue')) {
        add(f.value)
        if (f.param) { add(byKey.get(f.param)?.default); add(params?.[f.param]) }
      }
    }
  }
  walk(spec?.filters)
  return [...ids]
}

/**
 * Refuse (404) a definition or a run that names another group's venue, as
 * every other route does for a venue id (middleware/venue.js). A report only
 * ever reads the group's own rows, so such an id would match nothing: this
 * keeps another group's ids out of saved definitions and run records. An id
 * that is no venue at all passes (a venue since deleted mustn't stop a save).
 */
export async function refuseOtherVenues(p, spec, params = {}) {
  const ids = namedVenues(spec, params)
  if (!ids.length) return
  // System mode: it has to see other groups' venues to refuse them.
  const [other] = await systemSql`
    SELECT 1 FROM venues WHERE id = ANY(${ids}::uuid[]) AND tenant_id <> ${p.tenantId} LIMIT 1`
  if (other) throw httpError(404, 'Venue not found')
}

// What a run's record keeps of the choices it was run with: the period and
// the venues as they are; any other choice as a number or yes / no, never as
// typed words (a guest's name typed into a filter isn't copied into a record
// kept for a year).
function recordable(spec, params) {
  const out = {}
  for (const p of spec?.params || []) {
    const v = params?.[p.key]
    out[p.key] = p.type === 'value' && (typeof v === 'string' || Array.isArray(v)) ? { set: true } : v ?? null
  }
  return out
}

// A drill as where it went, without the values it held.
const drillRecord = steps => (steps || []).map(s => ({
  to: s.to === 'rows' ? 'rows' : rowId(s.to),
  at: (s.at || []).map(rowId),
  ...(s.to === 'rows' && s.value ? { value: s.value } : {}),
}))

/**
 * Record a run or a file. `run`: { kind: 'run' | 'export', format, saved (a
 * reports row) | starter, name, spec, params, drill, rows, ms, error }.
 * Never throws: a report that ran is not failed by its record.
 */
export async function recordRun(p, run, log) {
  try {
    const params = { params: recordable(run.spec, run.params), ...(run.drill?.length ? { drill: drillRecord(run.drill) } : {}) }
    await withTenant(p.tenantId, async tx => {
      await tx`
        INSERT INTO report_runs (tenant_id, report_id, starter_key, report_name, subject, kind, format,
                                 user_sub, user_email, params, row_count, ms, error)
        VALUES (${p.tenantId}, ${run.saved?.id ?? null}, ${run.starter?.key ?? run.saved?.starter_key ?? null},
                ${String(run.name || '').slice(0, 120) || null}, ${run.spec?.subject ?? null},
                ${run.kind === 'export' ? 'export' : 'run'}, ${run.format ?? null},
                ${p.sub}, ${p.email}, ${tx.json(params)},
                ${Number.isFinite(run.rows) ? Math.round(run.rows) : null}, ${Number.isFinite(run.ms) ? Math.round(run.ms) : null},
                ${run.error ? String(run.error).slice(0, 300) : null})`
      if (run.saved?.id && !run.error) {
        await tx`UPDATE reports SET last_run_at = now() WHERE tenant_id = ${p.tenantId} AND id = ${run.saved.id}`
      }
    })
  } catch (err) {
    log?.warn({ err }, 'A report run wasn\'t recorded')
  }
}

export async function cleanUpReportRuns() {
  const rows = await systemSql`
    DELETE FROM report_runs WHERE created_at < now() - make_interval(days => ${KEEP_RUN_DAYS}) RETURNING 1`
  return { removed: rows.length }
}
