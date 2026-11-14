// src/reports/run.js
//
// Running a report (docs/REPORTS.md 7.3): the definition is checked, turned
// into SQL by compile.js, run as the tenant in a read-only transaction and
// put in order by shape.js.
//
// The guards, in the order they act:
//
//   the definition's own problems     422, with each as a sentence
//   what the person's role can see    403 (or the column left out with a note)
//   two reports at once per group     a short wait, then 429
//   a statement that would read too   422 "narrow the period": the planner's
//     much                            own estimate, before anything runs
//   20 s on screen, 120 s for a file  422 "took too long"
//   5,000 rows on screen              the first 5,000, with a note
//
// A result is kept for a minute per person, definition and choices, so a
// page that asks twice (a refresh, the same report in two tabs) reads the
// database once. `fresh: true` asks again.

import crypto from 'node:crypto'
import { withReport } from '../config/db.js'
import { env } from '../config/env.js'
import { normaliseReport, reportProblems, resolveParams, rowId, valueSubject, LIMITS } from '../../../shared/reports/spec.js'
import { todayIn, addDays } from '../../../shared/reports/period.js'
import { drillSpec, countedBy, readsFrom } from '../../../shared/reports/drill.js'
import { CATALOGUE, CATALOGUE_MODULES, listColumns } from './catalogue/index.js'
import { compileReport, countedKey, ReportError, SCREEN_ROWS } from './compile.js'
import { shapeList, summaryShaper, matrixShaper } from './shape.js'
import { fillWorks } from './work/index.js'

const SCREEN_MS = 20000
const EXPORT_MS = 120000
const SLOTS = 2
const SLOT_WAIT_MS = 5000
const CACHE_MS = 60000
const CACHE_MAX = 200
/** The most rows a list's file holds. */
export const EXPORT_ROWS = 250000

const cache = new Map()

function cacheKey(ctx, spec, params, mode, cap) {
  const levels = CATALOGUE_MODULES.map(k => k + ':' + (ctx.levels?.[k] || 'none')).sort().join(',')
  return crypto.createHash('sha1')
    .update(JSON.stringify([ctx.tenantId, ctx.userKey || '', levels, spec, params, mode, cap ?? null]))
    .digest('hex')
}

/** Forget every kept result (tests, and after data a test changed). */
export const forgetReportResults = () => cache.clear()

// One of the group's two places: held until the transaction ends.
async function takeSlot(tx, tenantId) {
  const deadline = Date.now() + SLOT_WAIT_MS
  for (;;) {
    for (let slot = 1; slot <= SLOTS; slot++) {
      const [r] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${'rpt:' + tenantId}), ${slot}::int) AS ok`
      if (r.ok) return
    }
    if (Date.now() > deadline) throw new ReportError('Two reports are already running for your group. Try again in a moment', 429)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

// What the run needs to know about the group's venues: the day it is there
// (the first venue in scope), the time zone for rows with no venue, and
// whether money comes in more than one currency.
async function scopeOf(tx, tenantId, spec, params) {
  const venues = await tx`
    SELECT id::text AS id, COALESCE(NULLIF(timezone, ''), 'Europe/London') AS timezone,
           COALESCE(NULLIF(btrim(currency::text), ''), 'GBP') AS currency
      FROM venues WHERE tenant_id = ${tenantId} ORDER BY created_at, id`
  let ids = null
  for (const p of spec.params) {
    if (p.type === 'venues' && Array.isArray(params[p.key])) { ids = new Set(params[p.key]); break }
  }
  const chosen = ids ? venues.filter(v => ids.has(v.id)) : venues
  const scope = chosen.length ? chosen : venues
  let tz = scope[0]?.timezone || 'Europe/London'
  let today
  try { today = todayIn(tz) } catch { tz = 'Europe/London'; today = todayIn(tz) }
  return {
    tz, today, currencies: [...new Set(scope.map(v => v.currency))],
    // The venues asked for, for rows worked out in code (null = every venue).
    venueIds: ids ? chosen.map(v => v.id) : null,
  }
}

// The statements a plan runs straight away (the rows for "everything else"
// are made later from the same report, so they read the same rows), the
// other subjects' too.
const statementsOf = plan => (plan.kind === 'list'
  ? [plan.rows, plan.totals]
  : [plan.main, plan.compare?.run, ...(plan.parts || []).flatMap(p => [p.run, p.compare?.run])]).filter(Boolean)

// The days the run's rows sit on: the period and the one it is compared
// with. Null when the report covers every day. A daily subject beside a
// weekly report reads every day of the weeks the period picks: up to six
// days past the period's last.
function rangesOf(plan) {
  if (!plan.period) return null
  const ranges = [plan.period.range, ...(plan.compare ? [{ from: plan.compare.from, to: plan.compare.to }] : [])]
  return (plan.parts || []).some(p => p.widen) ? ranges.map(r => ({ from: r.from, to: addDays(r.to, 6) })) : ranges
}

const hasMoney = plan => (plan.kind === 'list'
  ? plan.columns.some(c => c.type === 'money')
  : plan.values.some(v => v.type === 'money') || [...plan.rows, ...plan.cols].some(g => g.col.type === 'money'))

// Venues in more than one currency: pounds and euros never add up. A
// summary is grouped by currency first with a subtotal for each and no
// grand total; a list says each row's currency and sums nothing.
/** Where a subject's rows say their currency: the path the engine groups by on its own. Null when they don't. */
export function currencyPath(subjectKey) {
  const s = CATALOGUE.subjects[subjectKey]
  if (!s) return null
  return s.key === 'venue' ? 'currency' : s.links.venue && !s.links.venue.many ? 'venue.currency' : null
}

function perCurrency(spec) {
  const path = currencyPath(spec.subject)
  if (!path) return null
  const column = { field: path, label: 'Currency' }
  if (spec.kind === 'list') {
    const rows = spec.rows.some(r => r.field === path) ? spec.rows : [...spec.rows.slice(0, LIMITS.list_columns - 1), column]
    return { spec: { ...spec, rows }, column: path }
  }
  const rows = [column, ...spec.rows.filter(r => r.field !== path)].slice(0, LIMITS.rows)
  const subtotals = spec.limit || spec.kind !== 'summary' || rows.length < 2
    ? []
    : [path, ...spec.totals.subtotals.filter(x => x !== path && x !== rowId(rows[rows.length - 1]))]
  // No "everything else" row: it would add one currency to another.
  const limit = spec.limit ? { ...(spec.limit.top ? { top: spec.limit.top } : { bottom: spec.limit.bottom }) } : spec.limit
  return { spec: { ...spec, rows, limit, totals: { grand: false, subtotals } }, column: path }
}

// The planner's estimate for a statement, before it runs.
async function costOf(tx, stmt) {
  const [r] = await tx.unsafe('EXPLAIN (FORMAT JSON) ' + stmt.text, stmt.params)
  const raw = r?.['QUERY PLAN']
  const plan = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Number(plan?.[0]?.Plan?.['Total Cost']) || 0
}

const tooSlow = e => e?.code === '57014'
const SLOW = 'This report took too long. Narrow the period or add a filter'
const HEAVY = 'This report would read too much at once. Narrow the period or add a filter'

/**
 * Everything a run needs once it has its place in the queue: the plan (for
 * the venues' currencies too), the rows worked out in code that it reads,
 * and a way to run a statement with the cost check. Runs in withReport()'s
 * `before` step: the statements run once the transaction is read only.
 */
async function prepare(tx, ctx, spec0, params, { listLimit, costFactor = 1, open = true }) {
  await takeSlot(tx, ctx.tenantId)
  const scope = await scopeOf(tx, ctx.tenantId, spec0, params)
  const envc = { tenantId: ctx.tenantId, levels: ctx.levels, params, today: scope.today, tz: scope.tz }
  let spec = spec0
  let plan = compileReport(spec, envc, { listLimit, open })
  let currencyColumn = null
  if (scope.currencies.length > 1 && hasMoney(plan)) {
    const per = perCurrency(spec)
    if (per) {
      spec = per.spec
      currencyColumn = per.column
      plan = compileReport(spec, envc, { listLimit, open })
      plan.notes.push('Your venues use more than one currency, so money is shown for each currency on its own')
    }
  }
  const filled = await fillWorks(tx, statementsOf(plan).flatMap(st => st.works || []), {
    tenantId: ctx.tenantId, venueIds: scope.venueIds, ranges: rangesOf(plan), levels: ctx.levels,
  })
  const max = env.REPORT_MAX_COST * costFactor
  const check = async stmt => {
    const missing = (stmt.works || []).filter(w => !filled.has(w))
    if (missing.length) throw new Error('A report statement reads rows nobody filled for this run: ' + missing.join(', '))
    if (await costOf(tx, stmt) > max) throw new ReportError(HEAVY)
  }
  const exec = async stmt => { await check(stmt); return tx.unsafe(stmt.text, stmt.params) }
  return { scope, spec, base: spec0, envc, plan, currencyColumn, check, exec }
}

// withReport()'s options for a run: the time limit, and prepare() in the
// read-write moment before the transaction is made read only.
const runOptions = (ctx, spec0, params, timeoutMs, prep) => ({
  timeoutMs,
  before: tx => prepare(tx, ctx, spec0, params, prep),
})

/**
 * What a row of this result can be opened into, for the person asking
 * (docs/REPORTS.md 8): the levels the definition offers that aren't its
 * groupings already, each only if this person may group by it, and whether
 * the rows behind a figure can be listed. Each is tried the way a drill
 * would make it (shared/reports/drill.js) and compiled, so the page never
 * offers what the run would refuse. `of` is what the rows are (the
 * subject's name), `per_figure` says the rows behind one figure aren't the
 * rows behind another. Null for a list, and when there is nothing to offer.
 */
export function drillOffers(spec, envc) {
  if (spec.kind === 'list') return null
  const taken = new Set([...spec.rows, ...spec.columns].map(rowId))
  const down = []
  for (const level of spec.drill?.down || []) {
    if (taken.has(rowId(level))) continue
    const next = drillSpec(spec, { at: [], to: level }, { catalogue: CATALOGUE })
    if (next.problem) continue
    try {
      const plan = compileReport(next.spec, envc)
      down.push({ field: level.field, ...(level.bucket ? { bucket: level.bucket } : {}), label: plan.rows[0].col.label })
    } catch { /* not for this person, or no longer in the catalogue */ }
  }
  let rows = false
  const list = drillSpec(spec, { at: [], to: 'rows' }, { catalogue: CATALOGUE, listColumns: subject => listColumns(subject, envc.levels) })
  if (!list.problem) {
    try { rows = compileReport(list.spec, envc, { listLimit: 1 }).columns.length > 0 } catch { /* none of its columns are for this person */ }
  }
  if (!down.length && !rows) return null
  // Do the report's figures count different rows (sales on closed checks
  // beside cancelled orders, or another subject's rows)? Then which figure
  // was tapped decides which rows are listed; when they all count the same
  // ones, a tap means the row.
  const counts = new Set(spec.values.filter(v => !v.hidden).map(v => {
    const subject = valueSubject(spec, v)
    return subject + '|' + countedKey(subject, countedBy(spec, v.key, { from: v.from || null }), envc.levels)
  }))
  // The rows behind a figure of another subject are that subject's: what
  // each such figure's rows are called, for the page's words.
  const ofValues = {}
  for (const v of spec.values) {
    const from = readsFrom(spec, v.key)
    const other = from && (spec.also || []).find(a => a.key === from)
    const label = other && CATALOGUE.subjects[other.subject]?.label
    if (label) ofValues[v.key] = label
  }
  return {
    down, rows, of: CATALOGUE.subjects[spec.subject]?.label || '',
    ...(rows && counts.size > 1 ? { per_figure: true } : {}),
    ...(rows && Object.keys(ofValues).length ? { of_values: ofValues } : {}),
  }
}

function metaOf(p, shaped, started) {
  const { plan, scope, currencyColumn } = p
  return {
    drill: drillOffers(p.base, p.envc),
    // A list whose rows open in the app: the page's address (`:id` and the
    // names each row's `open` fills) and the words for it.
    open: plan.kind === 'list' && plan.open ? { page: plan.open.page, label: plan.open.label } : null,
    period: plan.period ? { from: plan.period.range.from, to: plan.period.range.to, text: plan.period.text } : null,
    compare: plan.compare ? { with: plan.compare.with, from: plan.compare.from, to: plan.compare.to, text: plan.compare.text } : null,
    currency: currencyColumn ? null : scope.currencies[0] || 'GBP',
    currency_column: currencyColumn,
    // A table across: what its columns are, in words (each column says only its own value).
    across: plan.cols?.length ? plan.cols.map(g => g.col.label) : null,
    tz: scope.tz,
    today: scope.today,
    row_count: shaped.row_count,
    truncated: shaped.truncated,
    notes: shaped.notes,
    ms: Date.now() - started,
    generated_at: new Date().toISOString(),
    cached_at: null,
  }
}

/**
 * Run a definition as a person.
 *
 *   ctx    { tenantId, userKey, levels }   levels: the person's level on each
 *                                          module the catalogue asks for
 *   given  the choices for the definition's parameters (period, venues)
 *   opts   { mode: 'screen' | 'export', cap, fresh }
 *
 * Returns { kind, subject, spec, columns, rows, totals, meta }; `spec` is
 * the definition as it ran. Throws ReportError (statusCode 422, 403 or 429)
 * with the reasons as sentences.
 */
export async function runReport(ctx, rawSpec, given = {}, opts = {}) {
  const started = Date.now()
  const mode = opts.mode === 'export' ? 'export' : 'screen'
  const cap = opts.cap ?? (mode === 'export' ? null : SCREEN_ROWS)
  const spec0 = normaliseReport(rawSpec)
  const problems = reportProblems(spec0)
  if (problems.length) throw new ReportError(problems)
  const params = resolveParams(spec0, given)

  const key = cacheKey(ctx, spec0, params, mode, cap)
  if (!opts.fresh) {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.result, meta: { ...hit.result.meta, cached_at: new Date(hit.at).toISOString() } }
  }

  let result
  try {
    const prep = { listLimit: (cap ?? EXPORT_ROWS) + 1, costFactor: mode === 'export' ? 10 : 1, open: mode !== 'export' }
    result = await withReport(ctx.tenantId, runOptions(ctx, spec0, params, mode === 'export' ? EXPORT_MS : SCREEN_MS, prep), async (tx, p) => {
      const { plan, exec } = p
      let shaped
      if (plan.kind === 'list') {
        const rows = await exec(plan.rows)
        const [total] = await exec(plan.totals)
        shaped = shapeList(plan, rows, total, { cap: cap ?? EXPORT_ROWS, sums: !p.currencyColumn })
      } else {
        const main = await exec(plan.main)
        const before = plan.compare ? await exec(plan.compare.run) : null
        // Each other subject's rows, grouped the same way in a statement of its own.
        const partRows = []
        for (const part of plan.parts || []) {
          partRows.push({ rows: await exec(part.run), compare: part.compare ? await exec(part.compare.run) : null })
        }
        const shaper = plan.kind === 'matrix' ? matrixShaper(plan, main) : summaryShaper(plan, main, before, partRows)
        const restOf = async make => {
          if (!make) return null
          const st = make(shaper.restKeys)
          return { names: st.names, rows: await exec(st) }
        }
        let rest = null, compareRest = null
        const parts = []
        if (shaper.restKeys && plan.rest) {
          rest = await restOf(plan.rest)
          compareRest = await restOf(plan.compare?.rest)
          for (const part of plan.parts || []) parts.push({ rest: await restOf(part.rest), compareRest: await restOf(part.compare?.rest) })
        }
        shaped = shaper.finish({ rest, compareRest, parts, cap })
      }
      return {
        kind: plan.kind,
        subject: p.spec.subject,
        spec: p.spec,
        columns: shaped.columns,
        rows: shaped.rows,
        totals: shaped.totals,
        meta: metaOf(p, shaped, started),
      }
    })
  } catch (e) {
    if (tooSlow(e)) throw new ReportError(SLOW)
    throw e
  }

  cache.set(key, { at: Date.now(), result })
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return result
}

/**
 * A list's rows a batch at a time, for a file bigger than memory should
 * hold. `on.start({ columns, meta })` is called once before the first rows
 * (nothing has been read yet: a refusal is thrown before it), then
 * `on.rows(cells[])` for each batch; either may be async. Resolves with
 * { rows, truncated }.
 */
export async function streamList(ctx, rawSpec, given = {}, on = {}) {
  const started = Date.now()
  const spec0 = normaliseReport(rawSpec)
  const problems = reportProblems(spec0)
  if (problems.length) throw new ReportError(problems)
  if (spec0.kind !== 'list') throw new ReportError('Only a list can be sent row by row')
  const params = resolveParams(spec0, given)
  try {
    const prep = { listLimit: EXPORT_ROWS + 1, costFactor: 10, open: false }
    return await withReport(ctx.tenantId, runOptions(ctx, spec0, params, EXPORT_MS, prep), async (tx, p) => {
      const { plan } = p
      await p.check(plan.rows)
      const numeric = plan.columns.map(c => c.type === 'number' || c.type === 'money' || c.type === 'percent' || c.type === 'duration')
      await on.start?.({
        columns: plan.columns,
        spec: p.spec,
        meta: metaOf(p, { row_count: null, truncated: false, notes: [...plan.notes, ...(plan.says || [])] }, started),
      })
      let count = 0
      let truncated = false
      const cursor = tx.unsafe(plan.rows.text, plan.rows.params).cursor(1000)
      for await (const batch of cursor) {
        let rows = batch
        if (count + rows.length > EXPORT_ROWS) { rows = rows.slice(0, EXPORT_ROWS - count); truncated = true }
        count += rows.length
        if (rows.length) {
          await on.rows?.(rows.map(r => plan.columns.map((c, i) => {
            const v = r['c' + i]
            return v == null ? null : numeric[i] ? Number(v) : v
          })))
        }
        if (truncated) break
      }
      return { rows: count, truncated }
    })
  } catch (e) {
    if (tooSlow(e)) throw new ReportError(SLOW)
    throw e
  }
}
