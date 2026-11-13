// src/reports/plan.js
//
// A report written as a plan: the catalogue's own paths (`till.lines`,
// `net_sales`, `check.server.name`) where the smart builder's answers have
// refs. Pepper's report tools (src/ai/tools/reports.js) write plans and send
// them through POST /api/reports/plan, so a plan runs as the person asking,
// with their role.
//
// A plan becomes a definition only through the smart builder's own steps
// (src/reports/smart.js): toSpec() with a slice whose refs are paths
// (pathSlice()), so only through the builder's edits (shared/reports/
// build.js); then runBuilt(): the checks, names found among the group's
// venues and in the report's own rows, a run as the person, what it shows
// said in words by describeReport().
//
//   PLAN                  the shape of a plan (zod; the tools' input too)
//   planAnswer(plan)      a plan as the smart builder's answer
//   planOf(catalogue, spec, venues, name)
//                         a definition written as a plan (a report as it is,
//                         to change), with `kept`: what it has that a plan
//                         can't say, kept when the plan is applied to it
//   planProblems(catalogue, plan)
//                         what in a plan names nothing the person's role can
//                         build with, with the near ones; null when nothing
//   planSpec(catalogue, plan, { report, venues })
//                         the definition a plan makes, without running it
//   planReport(person, { plan, report, venues, cap })
//                         -> { spec, name, about, assumed, couldnt,
//                              questions, result, problem, unknown }
//                         `report` is the definition the plan changes: its
//                         filters made of several parts, its drill-down
//                         settings and its averages of a calculation are kept
//                         while the plan stays about the same rows
//
// In a plan a figure is named by its place: v1, v2 and so on, in the order
// of `figures`. Calculations, sorting, a top N and a chart name figures that
// way; `count` is how many rows there are (with a `count: true` figure).

import { z } from 'zod'
import { catalogueView } from './catalogue/index.js'
import { pathSlice, toSpec, answerOf, runBuilt } from './smart.js'
import { dataTree, treeNodes, searchTree, setTotals, setView, filterWords, valueName } from '../../../shared/reports/build.js'
import {
  normaliseReport, rowId, VIEW_KINDS, COMPARE_WITH, FILTER_OPS, VALUE_FORMATS, LIMITS,
} from '../../../shared/reports/spec.js'
import { RELATIVE_PERIODS } from '../../../shared/reports/period.js'
import { MOMENT_BUCKETS } from '../../../shared/reports/format.js'

const arr = v => (Array.isArray(v) ? v : [])
const text = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const NEAR = 5

// ── The shape ────────────────────────────────────────────────

const Path = z.string().trim().min(1).max(160)
const Label = z.string().trim().max(LIMITS.label)
const Bucket = z.enum(MOMENT_BUCKETS)
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A day as YYYY-MM-DD')
const Name = z.string().trim().min(1).max(20)

const Grouping = z.object({
  field: Path.describe('A field\'s path, as find_fields gives it'),
  bucket: Bucket.optional().describe('A day or a moment grouped by day, week, month, quarter, year, weekday or hour, where the field allows it'),
  label: Label.optional().describe('A heading of its own'),
})

const Figure = z.object({
  figure: Path.optional().describe('A figure\'s path (prefer these: they carry the app\'s rules, e.g. net sales leaves out voided dishes)'),
  field: Path.optional().describe('A number field added up with agg, when no figure says it'),
  agg: z.enum(['sum', 'avg', 'min', 'max', 'count_distinct']).optional(),
  count: z.boolean().optional().describe('true: how many rows there are'),
  calc: z.string().trim().max(300).optional()
    .describe('Worked out from other figures by their names: v1 / v2, round(v1 / v2 * 100, 1); may use round, abs, min, max, if, total, running, rank, change, previous; not another calc'),
  label: Label.optional(),
  format: z.enum(VALUE_FORMATS).optional().describe('For a calc: money, number, percent (0.25 is 25%), duration (seconds)'),
  decimals: z.number().int().min(0).max(6).optional(),
  hidden: z.boolean().optional().describe('Worked out but not shown: to rank by or calculate with'),
})

const Filter = z.object({
  field: Path,
  bucket: Bucket.optional(),
  op: z.enum(FILTER_OPS).describe('text: is, is_not, in, not_in, contains, starts_with; a choice: is, is_not, in, not_in; numbers: is, gt, gte, lt, lte, between; a day: before, after, between, is; yes/no: is; any: empty, not_empty'),
  values: z.array(z.union([z.string().max(200), z.number(), z.boolean()])).max(LIMITS.in_values).default([])
    .describe('As people say them: money in pounds (12.50), a percentage as per cent (20), a duration in minutes, a day as YYYY-MM-DD, yes or no, a weekday by name, an hour (18 or 6pm), a choice by its label, names in the data (a dish, a server) as typed'),
  ask: z.boolean().optional().describe('The person picks it each time the report is opened'),
  label: Label.optional().describe('What they pick, when ask is true'),
})

export const PLAN = z.object({
  subject: z.string().trim().min(1).max(80).describe('What the report is about: one subject key, as find_fields gives it (till.lines for anything per dish, till.checks per check or server, till.payments for tenders and tips)'),
  list: z.boolean().optional().describe('true: the rows themselves, one line each; else figures added up'),
  by: z.array(Grouping).max(LIMITS.list_columns).optional().describe('A summary\'s groupings, outer first; a list\'s columns, in order'),
  across: z.array(Grouping).max(LIMITS.columns).optional().describe('Groupings across the top (a table across); not for a list'),
  figures: z.array(Figure).max(LIMITS.values).optional().describe('What a summary adds up; named v1, v2 and so on in this order'),
  filters: z.array(Filter).max(LIMITS.filters).optional(),
  period: z.object({
    relative: z.enum(RELATIVE_PERIODS).optional(),
    n: z.number().int().min(1).max(3660).optional().describe('With last_n_days and next_n_days'),
    from: Ymd.optional(),
    to: Ymd.optional(),
  }).optional().describe('Which days: relative (with n for last_n_days), or from and to. Left out: last week'),
  venues: z.array(z.string().trim().min(1).max(120)).max(100).optional().describe('Venue names as said; left out for every venue'),
  sort: z.array(z.object({
    by: z.string().trim().min(1).max(160).describe('A figure\'s name (v1), count, or a grouping\'s or list column\'s path'),
    dir: z.enum(['asc', 'desc']).optional(),
  })).max(LIMITS.sort).optional(),
  top: z.object({
    which: z.enum(['top', 'bottom']),
    n: z.number().int().min(1).max(LIMITS.top),
    by: Name.optional().describe('The figure ranked by (v1)'),
    rest: Label.optional().describe('A row for every other one put together ("Every other dish"); left out to leave them out'),
  }).optional(),
  compare: z.enum(COMPARE_WITH).optional().describe('Beside the period before, or the same period last year'),
  chart: z.object({
    kind: z.enum(VIEW_KINDS).describe('table (no chart), bar, line, area, combo, parts (shares of a total), figures (big numbers), heat'),
    x: Path.optional().describe('The grouping along the bottom (its path); left out for the first'),
    y: z.array(Name).max(8).optional().describe('The figures drawn, by name; left out for the first'),
    line: Name.optional().describe('In combo: the figure drawn as a line'),
    stacked: z.boolean().optional(),
    sideways: z.boolean().optional(),
    table_below: z.boolean().optional().describe('false: the chart without its table to begin with'),
  }).optional(),
  totals: z.object({
    grand: z.boolean().optional().describe('false: no total row'),
    subtotals: z.array(Path).max(LIMITS.rows).optional().describe('Groupings (their paths, as in by) with a subtotal after each of their groups'),
  }).optional(),
  name: z.string().trim().max(LIMITS.name).optional(),
})

// ── A plan as the smart builder's answer ─────────────────────

const words = v => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v))
const grouping = r => ({ ref: r.field, bucket: r.bucket || '', label: r.label || '' })

/** A plan (PLAN's shape) as the answer toSpec() takes with pathSlice(). */
export function planAnswer(plan) {
  const ch = plan.chart || null
  return {
    subject: plan.subject,
    kind: plan.list ? 'list' : 'summary',
    rows: arr(plan.by).map(grouping),
    columns: arr(plan.across).map(grouping),
    values: arr(plan.figures).map((f, i) => ({
      name: 'v' + (i + 1),
      ref: f.calc ? '' : f.count ? 'COUNT' : (f.figure || f.field || ''),
      agg: f.calc || f.figure ? '' : f.count ? 'count' : (f.agg || ''),
      calc: f.calc || '',
      label: f.label || '',
      format: f.format || '',
      ...(f.decimals != null ? { decimals: f.decimals } : {}),
      ...(f.hidden ? { hidden: true } : {}),
    })),
    filters: arr(plan.filters).map(fl => ({
      ref: fl.field, bucket: fl.bucket || '', op: fl.op, values: arr(fl.values).map(words),
      ask: fl.ask === true, label: fl.label || '',
    })),
    period: {
      relative: plan.period?.relative || '', n: plan.period?.n || 0,
      from: plan.period?.from || '', to: plan.period?.to || '',
    },
    venues: arr(plan.venues),
    sort: arr(plan.sort).map(s => ({ by: s.by, dir: s.dir === 'desc' ? 'desc' : 'asc' })),
    limit: plan.top
      ? { which: plan.top.which, n: plan.top.n, by: plan.top.by || '', rest: plan.top.rest || '' }
      : { which: 'none', n: 0, by: '', rest: '' },
    compare: plan.compare || 'none',
    chart: ch
      ? { kind: ch.kind, x: ch.x || '', y: arr(ch.y), line: ch.line || '', stacked: !!ch.stacked, sideways: !!ch.sideways }
      : { kind: 'table', x: '', y: [], line: '', stacked: false, sideways: false },
    name: plan.name || '',
    assumed: [], couldnt: [], questions: [],
  }
}

// ── A definition as a plan ───────────────────────────────────

/**
 * A saved definition written as a plan, for a change: Pepper changes the
 * plan and sends it back. `kept` says in words what the definition has that
 * a plan can't say (filters made of several parts, averages of a
 * calculation, drill-down settings): applied to this definition, a plan
 * keeps them.
 */
export function planOf(catalogue, spec, venues = [], name = '') {
  const s = normaliseReport(spec)
  if (!catalogue.subjects[s.subject]) return { plan: { subject: s.subject }, kept: [] }
  const a = answerOf(catalogue, pathSlice(catalogue, s.subject), s, venues, name, { full: true })

  // answerOf() names values by their place among all of them; a plan names
  // only its own figures. A calc reading a value the plan can't hold (an
  // average of a calculation, kept as it is) reads it by its key.
  const rename = new Map(a.values.map((v, i) => [v.name, 'v' + (i + 1)]))
  const keyOf = new Map(s.values.map((v, i) => ['v' + (i + 1), v.key]))
  const re = t => text(t).replace(/\bv\d+\b/gi, m => rename.get(m.toLowerCase()) || keyOf.get(m.toLowerCase()) || m)
  const asName = t => (t ? re(t) : '')

  const plan = { subject: s.subject }
  if (a.kind === 'list') plan.list = true
  const g = r => ({ field: r.ref, ...(r.bucket ? { bucket: r.bucket } : {}), ...(r.label ? { label: r.label } : {}) })
  if (a.rows.length) plan.by = a.rows.map(g)
  if (a.columns.length) plan.across = a.columns.map(g)
  if (a.values.length) {
    plan.figures = a.values.map(v => {
      const extra = {
        ...(v.label ? { label: v.label } : {}), ...(v.format ? { format: v.format } : {}),
        ...(v.decimals != null ? { decimals: v.decimals } : {}), ...(v.hidden ? { hidden: true } : {}),
      }
      if (v.calc) return { calc: re(v.calc), ...extra }
      if (v.ref === 'COUNT') return { count: true, ...extra }
      if (v.agg) return { field: v.ref, agg: v.agg, ...extra }
      return { figure: v.ref, ...extra }
    })
  }
  if (a.filters.length) {
    plan.filters = a.filters.map(f => ({
      field: f.ref, ...(f.bucket ? { bucket: f.bucket } : {}), op: f.op, values: f.values,
      ...(f.ask ? { ask: true } : {}), ...(f.label ? { label: f.label } : {}),
    }))
  }
  const pd = a.period
  if (pd.relative) plan.period = { relative: pd.relative, ...(pd.n ? { n: pd.n } : {}) }
  else if (pd.from && pd.to) plan.period = { from: pd.from, to: pd.to }
  if (a.venues.length) plan.venues = a.venues
  if (a.sort.length) plan.sort = a.sort.map(x => ({ by: /^v\d+$/i.test(x.by) ? asName(x.by) : x.by, dir: x.dir }))
  if (a.limit.which !== 'none') {
    plan.top = { which: a.limit.which, n: a.limit.n, ...(a.limit.by ? { by: asName(a.limit.by) } : {}), ...(a.limit.rest ? { rest: a.limit.rest } : {}) }
  }
  if (a.compare !== 'none') plan.compare = a.compare
  if (a.chart.kind !== 'table') {
    plan.chart = {
      kind: a.chart.kind,
      ...(a.chart.x ? { x: a.chart.x } : {}),
      ...(a.chart.y.length ? { y: a.chart.y.map(asName) } : {}),
      ...(a.chart.line ? { line: asName(a.chart.line) } : {}),
      ...(a.chart.stacked ? { stacked: true } : {}),
      ...(a.chart.sideways ? { sideways: true } : {}),
      ...(s.view.table_below === false ? { table_below: false } : {}),
    }
  }
  if (s.kind !== 'list' && (s.totals.grand === false || s.totals.subtotals.length)) {
    const fieldOf = id => s.rows.find(r => rowId(r) === id)?.field
    plan.totals = {
      ...(s.totals.grand === false ? { grand: false } : {}),
      ...(s.totals.subtotals.length ? { subtotals: s.totals.subtotals.map(fieldOf).filter(Boolean) } : {}),
    }
  }
  if (a.name) plan.name = a.name

  const kept = []
  for (const f of s.filters) {
    if (f.any || f.all || f.has || f.counted) kept.push('Filter: ' + filterWords(catalogue, s.subject, f, { venues }))
  }
  for (const v of s.values) if (v.of) kept.push('Value: ' + (v.label || valueName(catalogue, s.subject, v)) + ' (' + v.key + ')')
  if (s.drill) kept.push('Its drill-down settings and what a row opens')
  return { plan, kept }
}

// ── What a plan names that isn't there ──────────────────────

const pathWords = p => text(p).toLowerCase().split(/[._\s]+/).filter(w => w.length > 1)

// The nodes nearest a path that isn't there: the same last part first, then
// those holding its words.
function nearPaths(tree, nodes, path) {
  const last = text(path).toLowerCase().split('.').pop()
  const out = nodes.filter(n => n.path === last || n.path.endsWith('.' + last)).map(n => n.path)
  for (const w of pathWords(path)) {
    for (const n of searchTree(tree, w)) if (!out.includes(n.path)) out.push(n.path)
    if (out.length >= NEAR) break
  }
  return out.slice(0, NEAR)
}

function nearSubjects(catalogue, key) {
  const want = pathWords(key)
  const base = Object.values(catalogue.subjects).filter(s => s.base)
  const score = s => want.filter(w => (s.key + ' ' + s.label + ' ' + s.about).toLowerCase().includes(w)).length
  return base.map(s => ({ s, n: score(s) })).sort((x, y) => y.n - x.n)
    .slice(0, 8).map(({ s }) => ({ subject: s.key, label: s.label }))
}

/**
 * What in a plan names nothing the person's role can build with: a subject,
 * paths (with the near ones), figure names. Null when everything is there.
 *   -> { problem, unknown: { subject?, subjects?, paths?: [{ path, near }], names? } }
 */
export function planProblems(catalogue, plan) {
  const sub = catalogue.subjects[text(plan.subject).toLowerCase()]
  if (!sub?.base) {
    return {
      problem: '"' + text(plan.subject) + '" isn\'t a subject this role can build reports on',
      unknown: { subject: text(plan.subject), subjects: nearSubjects(catalogue, plan.subject) },
    }
  }
  const tree = dataTree(catalogue, sub.key, { depth: 2 })
  const nodes = treeNodes(tree)
  const known = new Set(nodes.map(n => n.path))

  const paths = []
  const see = p => { if (p && !paths.includes(p)) paths.push(p) }
  for (const r of [...arr(plan.by), ...arr(plan.across)]) see(r.field)
  for (const f of arr(plan.figures)) { see(f.figure); see(f.field) }
  for (const f of arr(plan.filters)) see(f.field)
  for (const s of arr(plan.sort)) if (!/^(v\d+|count)$/i.test(text(s.by))) see(s.by)
  see(plan.chart?.x)
  for (const p of arr(plan.totals?.subtotals)) see(p)
  const missing = paths.filter(p => !known.has(text(p).toLowerCase()))

  const figures = arr(plan.figures)
  const names = []
  const seeName = n => { const t = text(n).toLowerCase(); if (/^v\d+$/.test(t) && Number(t.slice(1)) > figures.length && !names.includes(t)) names.push(t) }
  for (const f of figures) for (const m of text(f.calc).match(/\bv\d+\b/gi) || []) seeName(m)
  for (const s of arr(plan.sort)) seeName(s.by)
  seeName(plan.top?.by)
  for (const y of arr(plan.chart?.y)) seeName(y)
  seeName(plan.chart?.line)
  const empty = figures.map((f, i) => (f.figure || f.field || f.count || f.calc ? null : 'v' + (i + 1))).filter(Boolean)

  if (!missing.length && !names.length && !empty.length) return null
  const parts = []
  if (missing.length) parts.push(sub.label + ' have nothing called ' + missing.map(p => '"' + p + '"').join(', '))
  if (names.length) parts.push('the plan has no figure ' + names.join(', ') + ' (figures are v1 to v' + figures.length + ' in their order)')
  if (empty.length) parts.push('figure ' + empty.join(', ') + ' says nothing: give it a figure, a field with agg, count or a calc')
  return {
    problem: parts.join('; '),
    unknown: {
      ...(missing.length ? { paths: missing.map(p => ({ path: p, near: nearPaths(tree, nodes, p) })) } : {}),
      ...(names.length ? { names } : {}),
    },
  }
}

// ── Building and running ─────────────────────────────────────

const sameFigure = (a, b) => (a.measure || '') === (b.measure || '') && (a.agg || '') === (b.agg || '')
  && (a.field || '') === (b.field || '') && (a.of || '') === (b.of || '') && !a.calc && !b.calc
const squash = t => text(t).replace(/\s+/g, '')

// A plan applied to a report keeps the keys of the values it still has (a
// figure that is the same figure, a calculation that reads the same), so a
// change through Pepper doesn't rename what a sort, a chart, or anything
// outside the report (a data link's columns) points at. Nothing is renamed
// when the keys would clash. -> { spec, rename }
function keepKeys(out, prev) {
  const map = new Map()
  const used = new Set()
  const claim = (v, want) => {
    if (!want || used.has(want.key)) return
    map.set(v.key, want.key)
    used.add(want.key)
  }
  for (const v of out.values) if (!v.calc) claim(v, prev.values.find(w => !used.has(w.key) && sameFigure(v, w)))
  const swap = t => text(t).replace(/[a-z][a-z0-9_]*/gi, m => map.get(m) || m)
  for (const v of out.values) if (v.calc) claim(v, prev.values.find(w => !used.has(w.key) && w.calc && squash(w.calc) === squash(swap(v.calc))))
  const same = { spec: out, rename: k => k }
  if (![...map].some(([a, b]) => a !== b)) return same
  const keys = out.values.map(v => map.get(v.key) || v.key)
  if (new Set(keys).size !== keys.length) return same
  const re = k => map.get(k) || k
  return {
    rename: re,
    spec: normaliseReport({
      ...out,
      values: out.values.map(v => ({ ...v, key: re(v.key), ...(v.calc ? { calc: swap(v.calc) } : {}) })),
      sort: out.sort.map(x => ({ ...x, by: re(x.by) })),
      view: { ...out.view, y: arr(out.view.y).map(re), ...(out.view.line ? { line: re(out.view.line) } : {}) },
    }),
  }
}

// The values in the plan's order (toSpec() adds figures before
// calculations), with the averages of a calculation kept from the report
// back where they were in it.
function planOrder(out, plan, keys, rename, prev) {
  const order = arr(plan.figures).map((f, i) => keys['v' + (i + 1)]).filter(Boolean).map(rename)
  const byKey = new Map(out.values.map(v => [v.key, v]))
  const values = []
  for (const k of order) if (byKey.has(k) && !values.includes(byKey.get(k))) values.push(byKey.get(k))
  for (const v of out.values) if (!values.includes(v) && !v.of) values.push(v)
  if (prev) {
    prev.values.forEach((p, i) => {
      const v = p.of && byKey.get(p.key)
      if (v && !values.includes(v)) values.splice(Math.min(i, values.length), 0, v)
    })
  }
  for (const v of out.values) if (!values.includes(v)) values.push(v)
  if (values.every((v, i) => v === out.values[i])) return out
  return normaliseReport({ ...out, values })
}

// What toSpec() doesn't set from a plan: totals and the table under a chart;
// and, when the plan changes a report about the same rows, the keys of the
// values it keeps, the words of its own choices (Period, Venues) and its
// averages of a calculation (no plan can say them).
function finish(spec, plan, prev, keys = {}) {
  if (!spec) return spec
  let out = spec
  const same = prev && prev.subject === out.subject ? prev : null
  if (out.kind !== 'list') {
    let rename = k => k
    if (same) {
      const taken = new Set(out.values.map(v => v.key))
      const kept = same.values.filter(v => v.of && !taken.has(v.key))
      if (kept.length) out = normaliseReport({ ...out, values: [...out.values, ...kept] })
      ;({ spec: out, rename } = keepKeys(out, same))
    }
    out = planOrder(out, plan, keys, rename, same)
  }
  if (same) {
    const labelOf = new Map(same.params.filter(x => x.label).map(x => [x.key + '|' + x.type, x.label]))
    if (out.params.some(x => !x.label && labelOf.has(x.key + '|' + x.type))) {
      out = normaliseReport({ ...out, params: out.params.map(x => (x.label || !labelOf.has(x.key + '|' + x.type) ? x : { ...x, label: labelOf.get(x.key + '|' + x.type) })) })
    }
  }
  const t = plan.totals
  if (t && out.kind !== 'list') {
    const ids = arr(t.subtotals).map(p => {
      const path = text(p).toLowerCase()
      const row = out.rows.find(r => r.field === path) || out.rows.find(r => r.field.startsWith(path + '.') && r.field.split('.').length === path.split('.').length + 1)
      return row ? rowId(row) : null
    }).filter(Boolean)
    out = setTotals(out, { ...(typeof t.grand === 'boolean' ? { grand: t.grand } : {}), ...(t.subtotals ? { subtotals: ids } : {}) })
  }
  if (plan.chart?.table_below === false && out.view.kind !== 'table') out = setView(out, { table_below: false })
  return out
}

const EMPTY = { spec: null, name: '', about: '', assumed: [], couldnt: [], questions: [], result: null }

/**
 * A plan made into a definition, without running it: toSpec() through the
 * builder's edits, then what toSpec() leaves to finish(). `report` is the
 * definition the plan changes, or null. Check planProblems() first.
 *   -> toSpec()'s { spec, name, assumed, couldnt, slips, questions, lookups }
 */
export function planSpec(catalogue, plan, { report = null, venues = [] } = {}) {
  const prev = report ? normaliseReport(report) : null
  const subject = text(plan.subject).toLowerCase()
  const built = toSpec(catalogue, pathSlice(catalogue, subject), planAnswer({ ...plan, subject }), { venues, prev })
  built.spec = finish(built.spec, plan, prev, built.keys)
  return built
}

/** Build a report from a plan and run it as the person. See the top of this file. */
export async function planReport(p, { plan, report = null, venues = [], cap = 200 } = {}) {
  const catalogue = catalogueView(p.levels)
  const why = planProblems(catalogue, plan)
  if (why) return { ...EMPTY, problem: why.problem, unknown: why.unknown }

  const built = planSpec(catalogue, plan, { report, venues })
  const couldnt = [...built.couldnt]
  if (built.slips) couldnt.push('Part of the plan didn\'t match what the report holds, so it was left out')

  const ran = await runBuilt(p, catalogue, built, { venues, assumed: built.assumed, couldnt, cap })
  if (ran.problems) return { ...ran.failed, name: built.name, questions: [], result: null, unknown: null }
  return { ...ran.done, name: built.name, problem: null, unknown: null }
}
