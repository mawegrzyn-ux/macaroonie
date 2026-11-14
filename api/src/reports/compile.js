// src/reports/compile.js
//
// From a report definition to SQL (docs/REPORTS.md 7.1). Nobody writes
// SQL: a definition names subjects, fields, measures and links by their
// keys, and this file looks each one up in the data catalogue and puts the
// statement together from the catalogue's own templates.
//
//   - every table and column name comes from the catalogue;
//   - every value a person gave (a filter's words, a date, a venue) goes in
//     as a numbered parameter with its type, never into the statement;
//   - the tenant is $1 in every statement, on the base rows and on every
//     row joined to them (row-level security is on as well: reports run
//     through withReport(), as the tenant);
//   - a field the person's role can't see is left out of a list with a
//     note; a report that groups, filters or sorts by one is refused.
//
// Three shapes:
//
//   list      SELECT fields ... ORDER BY ... LIMIT            (+ a totals statement)
//   summary   an inner SELECT of group keys and the inputs of each figure,
//             grouped outside with GROUPING SETS: the rows, each subtotal
//             level and the grand total come from one statement, so an
//             average or a "how many different" is right at every level
//   matrix    the same with the column groupings: cells, row totals,
//             column totals and the grand total
//
// Figures through links:
//
//   a "one" link (a line's check)   only "how many different", smallest and
//                                   largest: a sum would count the check
//                                   once for every line
//   a "many" link (a check's lines) added up per base row in a LATERAL
//                                   subquery first, then across the rows
//
// compileReport() returns a plan: the statement(s) with their parameters
// and what shape.js needs to turn the rows into a result.

import { CATALOGUE, canReportOn, canSee, ACROSS_AGGS, openTarget } from './catalogue/index.js'
import { resolvePath, pathLabel, bucketsFor } from '../../../shared/reports/paths.js'
import { rowId, rankKey, AGG_LABELS, OPS_BY_TYPE, BUCKET_OPS } from '../../../shared/reports/spec.js'
import { parseExpr, exprToSql, exprRefs, exprProblem, ExprError } from '../../../shared/reports/expr.js'
import { resolvePeriod, comparePeriod, isYmd, periodText, rangeText } from '../../../shared/reports/period.js'
import { NUMERIC_TYPES } from '../../../shared/reports/format.js'

export const SCREEN_ROWS = 5000
export const GROUP_CAP = 50000
export const MATRIX_COLUMNS = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A report that can't run, with the reasons as sentences for the person. */
export class ReportError extends Error {
  constructor(problems, statusCode = 422) {
    const list = Array.isArray(problems) ? problems : [problems]
    super(list[0] || 'This report can\'t be run')
    this.name = 'ReportError'
    this.problems = list
    this.statusCode = statusCode
  }
}
// A field, measure or link the person's role may not see.
class Denied extends ReportError {
  constructor(label) { super('Your role can\'t see ' + label, 403); this.label = label }
}
const fail = (msg, status) => { throw new ReportError(msg, status) }

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const fromSql = s => s.from.table || s.from.sql

// ── One statement's parameters and aliases ───────────────────

class Statement {
  constructor(env) {
    this.env = env
    this.params = [env.tenantId]
    this.n = 0
    this.tzParam = null
  }
  p(value, cast) {
    this.params.push(value)
    return '$' + this.params.length + '::' + cast
  }
  alias(prefix = 't') { return prefix + this.n++ }
  // The group's own time zone, for rows with no venue.
  tz() {
    if (!this.tzParam) this.tzParam = this.p(this.env.tz || 'Europe/London', 'text')
    return this.tzParam
  }
}

// ── A subject's rows and the rows joined to them ─────────────

class Scope {
  constructor(st, subject, alias) {
    this.st = st
    this.subject = subject
    this.alias = alias
    this.joins = []
    this.links = new Map()
    this.laterals = new Map()
  }

  /** The row a "one" link leads to from a row of `fromSubject` (joined once). */
  follow(fromAlias, fromSubject, linkKey) {
    const id = fromAlias + '.' + linkKey
    const had = this.links.get(id)
    if (had) return had
    const link = fromSubject.links[linkKey]
    const to = CATALOGUE.subjects[link.to]
    // Its own column first: that may join other rows this one hangs off.
    const src = this.render(link.sql, fromAlias, fromSubject)
    const a = this.st.alias()
    const key = link.on ? a + '.' + link.on : to.id.sql.replaceAll('{t}', a)
    const on = [key + ' = ' + src, a + '.' + to.tenant + ' = $1']
    if (to.where) on.push('(' + to.where.replaceAll('{t}', a) + ')')
    this.joins.push('LEFT JOIN ' + fromSql(to) + ' ' + a + ' ON ' + on.join(' AND '))
    const out = { alias: a, subject: to }
    this.links.set(id, out)
    return out
  }

  /** A catalogue template as SQL for a row of `subject` known as `alias`. */
  render(template, alias, subject) {
    return template.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, name) => {
      if (name === 't') return alias
      if (name === 'tz') return this.tzOf(alias, subject)
      return this.follow(alias, subject, name).alias
    })
  }

  /** The time zone a row's moments are read in: its venue's, else the group's. */
  tzOf(alias, subject) {
    if (subject.key === 'venue') return 'COALESCE(' + alias + '.timezone, ' + this.st.tz() + ')'
    if (subject.links.venue) return 'COALESCE(' + this.follow(alias, subject, 'venue').alias + '.timezone, ' + this.st.tz() + ')'
    return this.st.tz()
  }

  /** FROM ... with every join made so far (call it last). */
  fromClause() {
    const laterals = [...this.laterals.values()].map(l => {
      const to = l.child.subject
      const cols = l.aggs.map((a, i) => a + ' AS m' + i).join(', ')
      return 'LEFT JOIN LATERAL (SELECT ' + cols + ' FROM ' + fromSql(to) + ' ' + l.child.alias + ' ' + l.child.joins.join(' ')
        + ' WHERE ' + l.conds.join(' AND ') + ') ' + l.alias + ' ON true'
    })
    return 'FROM ' + fromSql(this.subject) + ' ' + this.alias + ' ' + [...this.joins, ...laterals].join(' ')
  }
}

// ── Finding a path ───────────────────────────────────────────

/**
 * A path of the definition in a scope: where its field, measure or link
 * lives ({ alias, owner }) with the links before it joined. A path that
 * goes through a "many" link comes back with `lateral`: the rows on the
 * other side, to be added up per base row.
 */
function locate(scope, path, env, { allowMany = false } = {}) {
  const rootKey = scope.subject.key
  const r = resolvePath(CATALOGUE, rootKey, path)
  if (!r.ok) fail(r.why)
  const label = pathLabel(CATALOGUE, rootKey, path)
  for (const h of r.hops) {
    if (h.link.hidden) fail('"' + path + '" isn\'t something a report can use')
    if (!canSee(h.link, env.levels)) throw new Denied(label)
    if (h.link.many && !canReportOn(CATALOGUE.subjects[h.to], env.levels)) throw new Denied(label)
  }
  if (r.kind === 'link' && r.def.hidden) fail('"' + path + '" isn\'t something a report can use')
  if (!canSee(r.def, env.levels)) throw new Denied(label)
  if (r.kind === 'link' && r.def.many && !canReportOn(CATALOGUE.subjects[r.def.to], env.levels)) throw new Denied(label)

  const manyAt = r.hops.findIndex(h => h.link.many)
  if (manyAt === -1) {
    let alias = scope.alias, owner = scope.subject
    for (const h of r.hops) { const j = scope.follow(alias, owner, h.key); alias = j.alias; owner = j.subject }
    return { ...r, path, label, scope, alias, owner, lateral: null }
  }

  const several = CATALOGUE.subjects[r.hops[manyAt].to]
  if (!allowMany) {
    fail(label + ' can\'t be used there: one ' + scope.subject.one + ' can have several. Add them up as a value, or start the report from ' + several.label)
  }
  // Only straight off the report's own rows: through another link first, the
  // rows on the far side would be counted once for each of ours.
  if (manyAt !== 0) fail(label + ' can\'t be added up from ' + scope.subject.label + '. Start the report from ' + CATALOGUE.subjects[r.hops[0].to].label)
  if (r.hops.slice(1).some(h => h.link.many)) fail(label + ' goes through two lists of rows; start the report closer to it')

  const link = r.hops[0].link
  const prefix = r.hops[0].key
  let lat = scope.laterals.get(prefix)
  if (!lat) {
    const child = new Scope(scope.st, several, scope.st.alias('c'))
    const conds = [child.alias + '.' + several.tenant + ' = $1',
      child.render(link.sql, child.alias, several) + ' = ' + scope.render(scope.subject.id.sql, scope.alias, scope.subject)]
    if (several.where) conds.push('(' + child.render(several.where, child.alias, several) + ')')
    lat = { alias: scope.st.alias('l'), child, conds, aggs: [] }
    scope.laterals.set(prefix, lat)
  }
  let alias = lat.child.alias, owner = several
  for (const h of r.hops.slice(1)) { const j = lat.child.follow(alias, owner, h.key); alias = j.alias; owner = j.subject }
  return { ...r, path, label, scope: lat.child, alias, owner, lateral: lat }
}

const fieldSql = loc => loc.scope.render(loc.def.sql, loc.alias, loc.owner)
const idTypeOf = loc => (loc.def.on ? 'uuid' : CATALOGUE.subjects[loc.def.to].idType)

// ── Days, weeks and hours ────────────────────────────────────

const TRUNC = { week: 'week', month: 'month', quarter: 'quarter', year: 'year' }

/**
 * A date or moment grouped by day, week, month, quarter, year, weekday or
 * hour. Moments are read at their venue's own time. `shift` moves each day
 * forward (a comparison period's rows land on the report's own).
 * Returns { sql, kind: 'date' | 'int' }.
 */
function bucketSql(loc, bucket, st, shift = null) {
  const t = loc.def.type
  const e = fieldSql(loc)
  const b = bucket && bucketsFor(t).includes(bucket) ? bucket : 'day'
  const moves = shift && b !== 'weekday' && b !== 'hour'
  if (t === 'date' && b === 'day' && !moves) return { sql: '(' + e + ')', kind: 'date' }
  let ts = t === 'moment' ? '((' + e + ') AT TIME ZONE ' + loc.scope.tzOf(loc.alias, loc.owner) + ')' : '((' + e + ')::timestamp)'
  if (moves) ts = '(' + ts + ' + ' + st.p(shift.n + (shift.unit === 'month' ? ' months' : ' days'), 'interval') + ')'
  if (b === 'weekday') return { sql: '(EXTRACT(ISODOW FROM ' + ts + ')::int)', kind: 'int' }
  if (b === 'hour') return { sql: '(EXTRACT(HOUR FROM ' + ts + ')::int)', kind: 'int' }
  if (b === 'day') return { sql: '(' + ts + '::date)', kind: 'date' }
  return { sql: "(date_trunc('" + TRUNC[b] + "', " + ts + ')::date)', kind: 'date' }
}

// ── Filters ──────────────────────────────────────────────────

const likeEscape = s => String(s).replace(/[\\%_]/g, c => '\\' + c)

function numberOf(v, label) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) fail(label + ': "' + v + '" isn\'t a number')
  return n
}
function dayOf(v, label) {
  if (!isYmd(v)) fail(label + ': "' + v + '" isn\'t a day (use YYYY-MM-DD)')
  return v
}
const listOf = v => (Array.isArray(v) ? v : [v])

/** One condition as SQL, or null when it asks for nothing (every venue, an empty choice). */
function conditionSql(scope, f, env) {
  const st = scope.st
  const label = pathLabel(CATALOGUE, scope.subject.key, f.field, f.bucket)
  let loc
  try { loc = locate(scope, f.field, env) } catch (e) {
    if (e instanceof Denied) fail('This report filters by ' + e.label + ', which your role can\'t see', 403)
    throw e
  }
  if (loc.kind === 'measure') fail(label + ' is a figure: a report filters by fields, not by its figures')

  // The value: its own, or what the run gave for its parameter.
  let op = f.op
  let v = f.value
  if (f.param) {
    const p = env.spec.params.find(x => x.key === f.param)
    v = env.params[f.param]
    if (p?.type === 'venues' && v === 'all') return null
    if (p?.type === 'value' && (v == null || v === '' || (Array.isArray(v) && !v.length))) return null
    if (Array.isArray(v) && op === 'is') op = 'in'
    if (Array.isArray(v) && op === 'is_not') op = 'not_in'
    if (!Array.isArray(v) && (op === 'in' || op === 'not_in')) v = [v]
  }

  // The thing itself (a link): compared by its id.
  if (loc.kind === 'link') {
    if (loc.def.many) fail(label + ': use "has" to filter by rows there are several of')
    const e = '(' + loc.scope.render(loc.def.sql, loc.alias, loc.owner) + ')'
    const type = idTypeOf(loc)
    const id = x => {
      const s = String(x)
      if (type === 'uuid' && !UUID.test(s)) fail(label + ': that isn\'t one of the choices')
      return s
    }
    if (!OPS_BY_TYPE.id.includes(op)) fail(label + ' can\'t be filtered that way')
    switch (op) {
      case 'is': return e + ' = ' + st.p(id(v), type)
      case 'is_not': return e + ' IS DISTINCT FROM ' + st.p(id(v), type)
      case 'in': return e + ' = ANY(' + st.p(listOf(v).map(id), type + '[]') + ')'
      case 'not_in': return '(' + e + ' IS NULL OR ' + e + ' <> ALL(' + st.p(listOf(v).map(id), type + '[]') + '))'
      case 'empty': return e + ' IS NULL'
      default: return e + ' IS NOT NULL'
    }
  }

  const type = loc.def.type
  const bucket = f.bucket && bucketsFor(type).includes(f.bucket) ? f.bucket : null
  if (f.bucket && !bucket) fail(label + ' can\'t be grouped by ' + f.bucket)

  // Grouped days and hours.
  if (bucket && bucket !== 'day') {
    if (!BUCKET_OPS.includes(op) && op !== 'empty' && op !== 'not_empty' && !['before', 'after'].includes(op)) fail(label + ' can\'t be filtered that way')
    const b = bucketSql(loc, bucket, st)
    if (op === 'empty') return b.sql + ' IS NULL'
    if (op === 'not_empty') return b.sql + ' IS NOT NULL'
    const cast = b.kind === 'int' ? 'int' : 'date'
    const val = x => (b.kind === 'int' ? Math.round(numberOf(x, label)) : dayOf(x, label))
    switch (op) {
      case 'is': return b.sql + ' = ' + st.p(val(v), cast)
      case 'is_not': return b.sql + ' IS DISTINCT FROM ' + st.p(val(v), cast)
      case 'in': return b.sql + ' = ANY(' + st.p(listOf(v).map(val), cast + '[]') + ')'
      case 'not_in': return '(' + b.sql + ' IS NULL OR ' + b.sql + ' <> ALL(' + st.p(listOf(v).map(val), cast + '[]') + '))'
      case 'gt': case 'after': return b.sql + ' > ' + st.p(val(v), cast)
      case 'gte': return b.sql + ' >= ' + st.p(val(v), cast)
      case 'lt': case 'before': return b.sql + ' < ' + st.p(val(v), cast)
      case 'lte': return b.sql + ' <= ' + st.p(val(v), cast)
      case 'between': return b.sql + ' BETWEEN ' + st.p(val(v[0]), cast) + ' AND ' + st.p(val(v[1]), cast)
      default: fail(label + ' can\'t be filtered that way')
    }
  }

  if (!(OPS_BY_TYPE[type] || []).includes(op)) fail(label + ' can\'t be filtered with "' + op + '"')
  const e = '(' + fieldSql(loc) + ')'

  if (type === 'text' || type === 'choice') {
    switch (op) {
      case 'is': return e + ' = ' + st.p(String(v), 'text')
      case 'is_not': return e + ' IS DISTINCT FROM ' + st.p(String(v), 'text')
      case 'in': return e + ' = ANY(' + st.p(listOf(v).map(String), 'text[]') + ')'
      case 'not_in': return '(' + e + ' IS NULL OR ' + e + ' <> ALL(' + st.p(listOf(v).map(String), 'text[]') + '))'
      case 'contains': return e + ' ILIKE ' + st.p('%' + likeEscape(v) + '%', 'text')
      case 'not_contains': return '(' + e + ' IS NULL OR ' + e + ' NOT ILIKE ' + st.p('%' + likeEscape(v) + '%', 'text') + ')'
      case 'starts_with': return e + ' ILIKE ' + st.p(likeEscape(v) + '%', 'text')
      case 'empty': return '(' + e + ' IS NULL OR ' + e + " = '')"
      default: return '(' + e + ' IS NOT NULL AND ' + e + " <> '')"
    }
  }

  if (NUMERIC_TYPES.includes(type)) {
    const n = x => numberOf(x, label)
    switch (op) {
      case 'is': return e + ' = ' + st.p(n(v), 'numeric')
      case 'is_not': return e + ' IS DISTINCT FROM ' + st.p(n(v), 'numeric')
      case 'in': return e + ' = ANY(' + st.p(listOf(v).map(n), 'numeric[]') + ')'
      case 'gt': return e + ' > ' + st.p(n(v), 'numeric')
      case 'gte': return e + ' >= ' + st.p(n(v), 'numeric')
      case 'lt': return e + ' < ' + st.p(n(v), 'numeric')
      case 'lte': return e + ' <= ' + st.p(n(v), 'numeric')
      case 'between': return e + ' BETWEEN ' + st.p(n(v[0]), 'numeric') + ' AND ' + st.p(n(v[1]), 'numeric')
      case 'empty': return e + ' IS NULL'
      default: return e + ' IS NOT NULL'
    }
  }

  if (type === 'yesno') {
    const yes = v === true || v === 'true' || v === 'yes' || v === 1
    return yes ? e + ' IS TRUE' : e + ' IS NOT TRUE'
  }

  if (type === 'date' || type === 'moment') {
    // Before the day is worked out: its time zone is a parameter of the
    // statement, and one that nothing then uses is an error to Postgres.
    if (op === 'empty') return e + ' IS NULL'
    if (op === 'not_empty') return e + ' IS NOT NULL'
    // A moment is compared by its day at its venue. The column itself is
    // bounded as well (a day either side), so an index on it can be used.
    const day = type === 'moment' ? '((' + e + ' AT TIME ZONE ' + loc.scope.tzOf(loc.alias, loc.owner) + ')::date)' : e
    const raw = type === 'moment' ? e : (loc.def.bound ? '(' + loc.scope.render(loc.def.bound, loc.alias, loc.owner) + ')' : null)
    const bounded = (sql, from, to) => {
      if (!raw) return sql
      const parts = [sql]
      if (from) parts.push(raw + ' >= (' + st.p(from, 'date') + ' - 1)::timestamp')
      if (to) parts.push(raw + ' < (' + st.p(to, 'date') + ' + 2)::timestamp')
      return '(' + parts.join(' AND ') + ')'
    }
    switch (op) {
      case 'in_period': {
        const r = resolvePeriod(v, env.today)
        if (!r) fail(label + ': choose a period')
        return bounded(day + ' BETWEEN ' + st.p(r.from, 'date') + ' AND ' + st.p(r.to, 'date'), r.from, r.to)
      }
      case 'is': return bounded(day + ' = ' + st.p(dayOf(v, label), 'date'), v, v)
      case 'before': return bounded(day + ' < ' + st.p(dayOf(v, label), 'date'), null, v)
      case 'after': return bounded(day + ' > ' + st.p(dayOf(v, label), 'date'), v, null)
      case 'between': {
        const [a, b] = [dayOf(v[0], label), dayOf(v[1], label)].sort()
        return bounded(day + ' BETWEEN ' + st.p(a, 'date') + ' AND ' + st.p(b, 'date'), a, b)
      }
      default: fail(label + ' can\'t be filtered that way')
    }
  }
  fail(label + ' can\'t be filtered')
}

/** The rows of another subject that point at ours: EXISTS (...). */
function hasSql(scope, f, env) {
  const st = scope.st
  const parts = f.has.split('.')
  let alias = scope.alias, owner = scope.subject
  for (const key of parts.slice(0, -1)) {
    const link = owner.links[key]
    if (!link || link.many) fail('"' + f.has + '" isn\'t a list of rows this report can look into')
    if (link.hidden || !canSee(link, env.levels)) fail('This report filters by ' + link.label + ', which your role can\'t see', 403)
    const j = scope.follow(alias, owner, key)
    alias = j.alias; owner = j.subject
  }
  const link = owner.links[parts[parts.length - 1]]
  if (!link || !link.many) fail('"' + f.has + '" isn\'t a list of rows this report can look into')
  const to = CATALOGUE.subjects[link.to]
  if (link.hidden || !canSee(link, env.levels) || !canReportOn(to, env.levels)) fail('This report filters by ' + to.label + ', which your role can\'t see', 403)
  const child = new Scope(st, to, st.alias('c'))
  const conds = [child.alias + '.' + to.tenant + ' = $1',
    child.render(link.sql, child.alias, to) + ' = ' + scope.render(owner.id.sql, alias, owner)]
  if (to.where) conds.push('(' + child.render(to.where, child.alias, to) + ')')
  conds.push(...filtersSql(child, f.where, env))
  return (f.not ? 'NOT ' : '') + 'EXISTS (SELECT 1 FROM ' + fromSql(to) + ' ' + child.alias + ' ' + child.joins.join(' ') + ' WHERE ' + conds.join(' AND ') + ')'
}

/**
 * "Only the rows these figures count": each figure's own rule (a dish sold
 * is one on a closed check that wasn't voided), any of them. What a drill
 * into the rows behind a figure is filtered by, so the list adds up to the
 * figure. A figure with no rule counts every row, and one added up through a
 * list of other rows is about those rows, not ours: either way nothing of
 * ours is left out (null).
 */
function countedParts(subject, paths, levels) {
  const rules = new Set()
  const labels = []
  for (const path of paths || []) {
    const r = resolvePath(CATALOGUE, subject.key, path)
    if (!r.ok || r.kind !== 'measure') fail('"' + path + '" isn\'t one of ' + subject.label + '\' figures')
    if (r.hops.length) return null
    if (!canSee(r.def, levels)) continue
    const parts = r.def.ratio ? r.def.ratio.map(k => subject.measures[k]) : [r.def]
    for (const m of parts) {
      if (!m || !m.where) return null
      rules.add(m.where)
    }
    labels.push(r.def.label)
  }
  return rules.size ? { rules: [...rules], labels } : null
}

function countedRules(scope, f, env) {
  const parts = countedParts(scope.subject, f.counted, env.levels)
  if (!parts) return { sql: null, labels: [] }
  const sql = parts.rules.map(w => '(' + scope.render(w, scope.alias, scope.subject) + ')')
  return { sql: sql.length === 1 ? sql[0] : '(' + sql.join(' OR ') + ')', labels: parts.labels }
}

/**
 * The same as something to compare: which rows these figures count between
 * them, '' when that is every row. Two figures with the same answer list the
 * same rows, so a tap on either means the same thing.
 */
export function countedKey(subjectKey, paths, levels) {
  const subject = CATALOGUE.subjects[subjectKey]
  if (!subject || !paths?.length) return ''
  try {
    const parts = countedParts(subject, paths, levels)
    return parts ? parts.rules.slice().sort().join(' | ') : ''
  } catch { return '' }
}

function filtersSql(scope, filters, env) {
  const out = []
  for (const f of filters || []) {
    if (f.any || f.all) {
      const inner = filtersSql(scope, f.any || f.all, env)
      if (inner.length) out.push('(' + inner.join(f.any ? ' OR ' : ' AND ') + ')')
    } else if (f.has) out.push(hasSql(scope, f, env))
    else if (f.counted) {
      const { sql } = countedRules(scope, f, env)
      if (sql) out.push(sql)
    } else {
      const sql = conditionSql(scope, f, env)
      if (sql) out.push(sql)
    }
  }
  return out
}

// Which rows: the tenant's, the subject's own rule, then the report's filters.
function whereSql(scope, filters, env) {
  const s = scope.subject
  const out = [scope.alias + '.' + s.tenant + ' = $1']
  if (s.where) out.push('(' + scope.render(s.where, scope.alias, s) + ')')
  out.push(...filtersSql(scope, filters, env))
  return out
}

// ── The report's subject and period ──────────────────────────

function baseSubject(spec, env) {
  const s = CATALOGUE.subjects[spec.subject]
  if (!s || s.hidden) fail('There is nothing to report on called "' + spec.subject + '"')
  if (!canReportOn(s, env.levels)) fail('Your role can\'t report on ' + s.label, 403)
  return s
}

/** The period the report is about: its first "date is in ..." filter. */
export function mainPeriod(spec, env) {
  const i = spec.filters.findIndex(f => f.field === 'date' && !f.bucket && f.op === 'in_period')
  if (i === -1) return null
  const f = spec.filters[i]
  const period = f.param ? env.params[f.param] : f.value
  const range = resolvePeriod(period, env.today)
  if (!range) return null
  return { index: i, period, range, text: periodText(period, env.today) }
}

// ── Output columns ───────────────────────────────────────────

// A field as it leaves the database: numbers as numbers, days and moments
// as text (a moment at its venue's own time), the rest as words.
function outSql(loc) {
  if (loc.kind === 'link') return '(' + loc.scope.render(loc.def.sql, loc.alias, loc.owner) + ')::text'
  const e = fieldSql(loc)
  switch (loc.def.type) {
    case 'number': case 'money': case 'percent': case 'duration': return '(' + e + ')::float8'
    case 'date': return "to_char(" + e + ", 'YYYY-MM-DD')"
    case 'moment': return "to_char((" + e + ') AT TIME ZONE ' + loc.scope.tzOf(loc.alias, loc.owner) + ", 'YYYY-MM-DD\"T\"HH24:MI:SS')"
    case 'yesno': return '(' + e + ')'
    default: return '(' + e + ')::text'
  }
}

function columnOf(loc, ref, extra = {}) {
  const d = loc.def
  return {
    key: rowId(ref),
    field: ref.field,
    ...(ref.bucket ? { bucket: ref.bucket } : {}),
    label: ref.label || pathLabel(CATALOGUE, loc.rootKey ?? loc.scope.subject.key, ref.field, ref.bucket),
    type: loc.kind === 'link' ? 'id' : d.type,
    ...(d.labels ? { labels: d.labels } : {}),
    ...(d.decimals != null ? { decimals: d.decimals } : {}),
    ...(d.empty ? { empty: d.empty } : {}),
    ...(d.pii ? { pii: true } : {}),
    role: 'row',
    ...extra,
  }
}

// ── Lists ────────────────────────────────────────────────────

/**
 * A list's statement. `what`: 'rows' (the rows, at most `limit`) or
 * 'totals' (how many there are and the sums of its money and count columns).
 */
function buildList(spec, env, what, limit, withOpen = false) {
  const st = new Statement(env)
  const subject = baseSubject(spec, env)
  const scope = new Scope(st, subject, st.alias())
  const notes = []
  const cols = []
  for (const r of spec.rows) {
    let loc
    try { loc = locate(scope, r.field, env) } catch (e) {
      if (e instanceof Denied) { notes.push(e.label + ' is left out: your role can\'t see it'); continue }
      throw e
    }
    if (loc.kind === 'measure') fail(loc.label + ' is a figure: a list shows fields. Make it a summary to add things up')
    if (loc.kind === 'link' && loc.def.many) fail(loc.label + ' can\'t be a column: one ' + subject.one + ' can have several')
    const col = columnOf({ ...loc, rootKey: subject.key }, r)
    // Sums only of the report's own rows' numbers: a looked-up row's would repeat.
    const adds = loc.kind === 'field' && !loc.hops.length && NUMERIC_TYPES.includes(loc.def.type) && loc.def.adds === true
    cols.push({ col, loc, adds })
  }
  if (!cols.length) fail('None of this list\'s columns can be shown to your role', 403)
  const where = whereSql(scope, spec.filters, env)
  // Said on the page (not something left out for the person's role, which
  // is what `notes` are): a list that only holds the rows a figure counts.
  const says = []
  for (const f of spec.filters) {
    if (!f.counted) continue
    const { sql, labels } = countedRules(scope, f, env)
    if (!sql) continue
    const towards = labels.length > 3 ? 'the figures' : labels.length > 1 ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1] : labels[0]
    says.push('Only the ' + lowerFirst(subject.label) + ' that count towards ' + towards + ' are listed')
  }
  const idSql = '(' + scope.render(subject.id.sql, scope.alias, subject) + ')'

  if (what === 'totals') {
    const sums = cols.map((c, i) => (c.adds ? '(SUM(' + fieldSql(c.loc) + '))::float8 AS s' + i : null)).filter(Boolean)
    const text = 'SELECT COUNT(*)::int AS n' + (sums.length ? ', ' + sums.join(', ') : '') + ' ' + scope.fromClause() + ' WHERE ' + where.join(' AND ')
    return { text, params: st.params, columns: cols.map(c => c.col), adds: cols.map(c => c.adds), notes, says }
  }

  // The order asked for, else the subject's usual one; the row's own id last
  // so the order is always the same.
  const order = []
  const sorts = spec.sort.length ? spec.sort : subject.sort
  for (const s of sorts) {
    let loc
    try { loc = locate(scope, s.by, env) } catch (e) {
      // The subject's usual order is only a default: left out when it can't be used.
      if (!spec.sort.length) continue
      if (e instanceof Denied) fail('This report is sorted by ' + e.label + ', which your role can\'t see', 403)
      throw e
    }
    if (loc.kind !== 'field') continue
    order.push('(' + fieldSql(loc) + ') ' + (s.dir === 'desc' ? 'DESC' : 'ASC') + ' NULLS LAST')
  }
  order.push(idSql)
  const select = cols.map((c, i) => outSql(c.loc) + ' AS c' + i).concat(idSql + '::text AS _id')
  // What a row opens in the app, for this person (docs/REPORTS.md 8): the
  // values its page's address needs, each as text (_o_id, _o_<name>). Only
  // on the page's rows: a file has no use for them.
  const target = withOpen ? openTarget(subject.key, spec.drill?.open, env.levels) : null
  let open = null
  if (target) {
    let alias = scope.alias, owner = subject
    for (const k of target.hops) { const j = scope.follow(alias, owner, k); alias = j.alias; owner = j.subject }
    const parts = [['id', target.id || owner.id.sql], ...Object.entries(target.with)]
    for (const [n, tpl] of parts) select.push('(' + scope.render(tpl, alias, owner) + ')::text AS _o_' + n)
    open = { page: target.page, label: target.label, path: target.path, names: parts.map(p => p[0]) }
  }
  const text = 'SELECT ' + select.join(', ') + ' ' + scope.fromClause() + ' WHERE ' + where.join(' AND ')
    + ' ORDER BY ' + order.join(', ') + ' LIMIT ' + Math.max(1, Math.round(limit))
  return { text, params: st.params, columns: cols.map(c => c.col), adds: cols.map(c => c.adds), notes, says, open }
}

// ── Figures ──────────────────────────────────────────────────

// The inputs of each figure go into the inner SELECT (a0, a1, ...), the
// figure itself into the outer one (v0, v1, ...).
class Figures {
  constructor() { this.list = []; this.byKey = new Map() }
  has(cacheKey) { return this.byKey.get(cacheKey) || null }
  // `agg` is how the figure adds up across rows (what it is over no rows at
  // all: a total or a count is 0, an average is nothing).
  add(cacheKey, inner, agg) {
    if (cacheKey && this.byKey.has(cacheKey)) return this.byKey.get(cacheKey)
    const i = this.list.length
    const f = { in: 'a' + i, out: 'v' + i, inner, outer: OUTER[agg]('a' + i), agg }
    this.list.push(f)
    if (cacheKey) this.byKey.set(cacheKey, f)
    return f
  }
}

const when = (cond, expr) => (cond ? 'CASE WHEN ' + cond + ' THEN ' + expr + ' END' : expr)
const OUTER = {
  sum: a => '(COALESCE(SUM(' + a + '), 0))::float8',
  count: a => '(COUNT(' + a + '))::float8',
  count_distinct: a => '(COUNT(DISTINCT ' + a + '))::float8',
  avg: a => '(AVG(' + a + '))::float8',
  min: a => '(MIN(' + a + '))::float8',
  max: a => '(MAX(' + a + '))::float8',
}

/** A plain measure of the catalogue as a figure. */
function measureFigure(scope, figs, loc) {
  const m = loc.def
  const had = figs.has('m:' + loc.path)
  if (had) return had
  const cond = m.where ? loc.scope.render(m.where, loc.alias, loc.owner) : null
  const expr = m.agg === 'count' ? '1' : loc.scope.render(m.sql, loc.alias, loc.owner)
  if (!loc.lateral) {
    if (loc.hops.length) {
      fail(loc.label + ' can\'t be added up from ' + scope.subject.label + ': each ' + loc.owner.one + ' would be counted once for every ' + scope.subject.one
        + '. Start the report from ' + loc.owner.label)
    }
    return figs.add('m:' + loc.path, when(cond, expr), m.agg)
  }
  // Through a list of rows: added up for each of our rows first.
  if (loc.hops.length > 1) fail(loc.label + ' can\'t be added up from ' + scope.subject.label + '. Start the report from ' + loc.owner.label)
  if (!ACROSS_AGGS.includes(m.agg)) {
    fail(loc.label + ' can\'t be worked out from ' + scope.subject.label + ' (an average or a "how many different" doesn\'t add up across rows). Start the report from ' + loc.owner.label)
  }
  const per = { sum: 'SUM', count: 'COUNT', min: 'MIN', max: 'MAX' }[m.agg] + '(' + when(cond, expr) + ')'
  const i = loc.lateral.aggs.push(per) - 1
  return figs.add('m:' + loc.path, loc.lateral.alias + '.m' + i, m.agg === 'count' ? 'sum' : m.agg)
}

/**
 * Every value of a summary or matrix: [{ key, label, type, decimals,
 * hidden, src }] where src is { fig } (a column of the result), { ratio:
 * [fig, fig] } or { calc: tree }.
 */
function valuesOf(scope, spec, env, figs, notes) {
  const subject = scope.subject
  const out = []
  const denied = new Set()
  for (const v of spec.values) {
    const base = { key: v.key, hidden: !!v.hidden, ...(v.decimals != null ? { decimals: v.decimals } : {}) }
    try {
      if (v.measure) {
        const loc = locate(scope, v.measure, env, { allowMany: true })
        if (loc.kind !== 'measure') fail('"' + v.measure + '" isn\'t one of ' + subject.label + '\' figures')
        const m = loc.def
        const meta = { ...base, label: v.label || loc.label, type: v.format || m.type, ...(base.decimals == null && m.decimals != null ? { decimals: m.decimals } : {}) }
        if (m.ratio) {
          const prefix = v.measure.includes('.') ? v.measure.slice(0, v.measure.lastIndexOf('.') + 1) : ''
          const parts = m.ratio.map(k => measureFigure(scope, figs, locate(scope, prefix + k, env, { allowMany: true })))
          out.push({ ...meta, src: { ratio: parts.map(p => p.out) } })
        } else out.push({ ...meta, src: { fig: measureFigure(scope, figs, loc).out } })
        continue
      }

      if (v.calc) {
        out.push({ ...base, label: v.label || 'Calculation', type: v.format || 'number', src: { calc: parseExpr(v.calc) } })
        continue
      }

      if (v.of) {
        // A sum of a calculation on each row: its names are the subject's own number fields.
        const ast = parseExpr(v.of)
        const refs = {}
        const types = new Set()
        for (const name of exprRefs(ast)) {
          const loc = locate(scope, name, env)
          if (loc.kind !== 'field' || loc.hops.length || !NUMERIC_TYPES.includes(loc.def.type)) {
            fail((v.label || v.key) + ': "' + name + '" isn\'t one of ' + subject.label + '\' own number fields')
          }
          refs[name] = fieldSql(loc)
          types.add(loc.def.type)
        }
        const why = exprProblem(ast, { context: 'row', known: n => n in refs })
        if (why) fail((v.label || v.key) + ': ' + why)
        const f = figs.add(null, exprToSql(ast, n => refs[n]), v.agg)
        // Money in, money out (net - discounts); anything mixed is a plain number until a format is chosen.
        const type = v.format || (types.size === 1 && types.has('money') && v.agg !== 'count' && v.agg !== 'count_distinct' ? 'money' : 'number')
        out.push({ ...base, label: v.label || AGG_LABELS[v.agg], type, src: { fig: f.out } })
        continue
      }

      if (v.agg === 'count' && !v.field) {
        const f = figs.add('count', '1', 'count')
        out.push({ ...base, label: v.label || subject.label, type: 'number', decimals: base.decimals ?? 0, src: { fig: f.out } })
        continue
      }

      // A way of adding up a field.
      const loc = locate(scope, v.field, env, { allowMany: true })
      if (loc.kind === 'measure') fail(loc.label + ' is already a figure: add it as it is')
      const isLink = loc.kind === 'link'
      if (isLink && (loc.def.many || v.agg !== 'count_distinct')) fail(loc.label + ' can only be counted ("how many different")')
      const type = isLink ? 'id' : loc.def.type
      const numeric = NUMERIC_TYPES.includes(type)
      if ((v.agg === 'sum' || v.agg === 'avg') && !numeric) fail(loc.label + ' isn\'t a number: it can be counted, not added up')
      if ((v.agg === 'min' || v.agg === 'max') && !numeric) fail(loc.label + ': the smallest and largest are for numbers')
      const expr = isLink ? '(' + loc.scope.render(loc.def.sql, loc.alias, loc.owner) + ')' : '(' + fieldSql(loc) + ')'
      // "Total guests", "Largest total"; a count names what is counted first: "Server (how many different)".
      const label = v.label || (v.agg === 'count' ? loc.label + ' (how many)'
        : v.agg === 'count_distinct' ? loc.label + ' (how many different)'
          : AGG_LABELS[v.agg] + ' ' + lowerFirst(loc.label))
      const outType = v.format || (v.agg === 'count' || v.agg === 'count_distinct' ? 'number' : type)
      const meta = { ...base, label, type: outType, ...(base.decimals == null && (v.agg === 'count' || v.agg === 'count_distinct') ? { decimals: 0 } : {}) }
      let f = figs.has(v.agg + ':' + v.field)
      if (f) {
        // The same figure twice (under two names): worked out once.
      } else if (loc.lateral) {
        if (v.agg === 'avg' || v.agg === 'count_distinct') fail(label + ' can\'t be worked out from ' + subject.label + '. Start the report from ' + loc.lateral.child.subject.label)
        const per = { sum: 'SUM', count: 'COUNT', min: 'MIN', max: 'MAX' }[v.agg] + '(' + expr + ')'
        const i = loc.lateral.aggs.push(per) - 1
        f = figs.add(v.agg + ':' + v.field, loc.lateral.alias + '.m' + i, v.agg === 'count' ? 'sum' : v.agg)
      } else {
        if (loc.hops.length && (v.agg === 'sum' || v.agg === 'avg')) {
          fail(label + ' can\'t be worked out from ' + subject.label + ': each ' + loc.owner.one + ' would be counted once for every ' + subject.one
            + '. Start the report from ' + loc.owner.label)
        }
        f = figs.add(v.agg + ':' + v.field, expr, v.agg)
      }
      out.push({ ...meta, src: { fig: f.out } })
    } catch (e) {
      if (e instanceof Denied) {
        notes.push((v.label || e.label) + ' is left out: your role can\'t see it')
        denied.add(v.key)
        continue
      }
      if (e instanceof ExprError) fail((v.label || v.key) + ': ' + e.message)
      throw e
    }
  }
  // A calculation reading a value the role can't see goes with it (a share
  // of a hidden figure would give it away), and so does one reading that.
  for (;;) {
    const v = out.find(x => x.src.calc && exprRefs(x.src.calc).some(n => denied.has(n)))
    if (!v) break
    out.splice(out.indexOf(v), 1)
    denied.add(v.key)
    notes.push(v.label + ' is left out: your role can\'t see what it is worked out from')
  }
  // A calculation can only read the values that are there.
  const keys = new Set(out.map(v => v.key))
  for (const v of out) {
    if (!v.src.calc) continue
    const missing = exprRefs(v.src.calc).find(n => !keys.has(n))
    if (missing) fail(v.label + ': "' + missing + '" isn\'t one of this report\'s values')
  }
  return out
}

// ── Summaries and matrices ───────────────────────────────────

// A grouping as a key in the inner SELECT (always text, so every level and
// every comparison lines up) with what the result says about it.
function groupOf(scope, ref, env, shift) {
  const st = scope.st
  let loc
  try { loc = locate(scope, ref.field, env) } catch (e) {
    if (e instanceof Denied) fail('This report groups by ' + e.label + ', which your role can\'t see', 403)
    throw e
  }
  if (loc.kind !== 'field') fail(loc.label + ' can\'t be grouped by: group by one of its fields (its name)')
  const type = loc.def.type
  const col = columnOf({ ...loc, rootKey: scope.subject.key }, ref)
  if (type === 'date' || type === 'moment') {
    // A day, or the first day of its week, month, quarter or year; a weekday
    // (1 Monday to 7 Sunday) or an hour as a number. A moment with no
    // grouping named is grouped by its day.
    const bucket = ref.bucket && bucketsFor(type).includes(ref.bucket) ? ref.bucket : 'day'
    const b = bucketSql(loc, bucket, st, shift)
    const { bucket: _b, ...rest } = col
    return {
      col: { ...rest, type: 'date', ...(bucket === 'day' ? {} : { bucket }), empty: '(none)' },
      text: b.kind === 'int' ? '(' + b.sql + ')::text' : "to_char(" + b.sql + ", 'YYYY-MM-DD')",
      parse: b.kind === 'int' ? 'number' : 'text',
    }
  }
  const e = '(' + fieldSql(loc) + ')'
  if (NUMERIC_TYPES.includes(type)) return { col: { ...col, empty: '(none)' }, text: e + '::float8::text', parse: 'number' }
  // Not said counts as no.
  if (type === 'yesno') return { col, text: 'COALESCE(' + e + ', false)::text', parse: 'yesno' }
  return { col: { ...col, empty: '(none)' }, text: 'NULLIF(' + e + "::text, '')", parse: 'text' }
}

/**
 * A summary's or matrix's statement.
 *   opts.shift    move date groupings forward (a comparison period)
 *   opts.exclude  key tuples of the rows already shown: this run adds up
 *                 every other row ("Everything else")
 */
function buildGrouped(spec, env, opts = {}) {
  const st = new Statement(env)
  const subject = baseSubject(spec, env)
  const scope = new Scope(st, subject, st.alias())
  const notes = []
  const rows = spec.rows.map(r => groupOf(scope, r, env, opts.shift))
  const cols = spec.columns.map(r => groupOf(scope, r, env, opts.shift))
  const figs = new Figures()
  const values = valuesOf(scope, spec, env, figs, notes)
  if (!values.some(v => !v.hidden) && spec.values.length) fail('None of this report\'s figures can be shown to your role', 403)
  const where = whereSql(scope, spec.filters, env)

  const keys = [...rows, ...cols].map((g, i) => ({ ...g, name: 'g' + i }))
  const innerCols = [...keys.map(g => g.text + ' AS ' + g.name), ...figs.list.map(f => f.inner + ' AS ' + f.in)]
  if (!innerCols.length) innerCols.push('1 AS one')
  const inner = 'SELECT ' + innerCols.join(', ') + ' ' + scope.fromClause() + ' WHERE ' + where.join(' AND ')

  const rowNames = keys.slice(0, rows.length).map(g => g.name)
  const colNames = keys.slice(rows.length).map(g => g.name)
  const set = list => '(' + list.join(', ') + ')'
  // The keys that come back, and the levels they are added up at. `lvl` has
  // a bit for each key, the first key's highest: set when that key is added
  // up over (a subtotal or total row).
  let names, sets
  if (opts.exclude) {
    // Everything else: one row (a matrix: one for each column and one for all).
    names = colNames
    sets = cols.length ? [set(colNames), '()'] : []
  } else if (spec.kind === 'matrix') {
    names = [...rowNames, ...colNames]
    sets = [...new Set([set(names), set(rowNames), set(colNames), '()'])]
  } else {
    names = rowNames
    sets = []
    for (let i = rows.length; i >= 0; i--) sets.push(set(rowNames.slice(0, i)))
  }

  const outerCols = [
    ...names,
    names.length ? 'GROUPING(' + names.join(', ') + ')::int AS lvl' : '0 AS lvl',
    ...figs.list.map(f => f.outer + ' AS ' + f.out),
  ]
  let text = 'SELECT ' + outerCols.join(', ') + ' FROM (' + inner + ') q'
  if (opts.exclude) {
    // The rows already shown, as arrays: a key and whether it is empty, for each
    // grouping. The flags go as words: postgres.js would send an array of
    // true / false as one boolean, which can't be cast to an array.
    const n = rowNames.length
    const arrays = [], defs = [], conds = []
    for (let i = 0; i < n; i++) {
      arrays.push(st.p(opts.exclude.map(k => (k[i] == null ? '' : String(k[i]))), 'text[]'), st.p(opts.exclude.map(k => (k[i] == null ? 'y' : 'n')), 'text[]'))
      defs.push('k' + i, 'n' + i)
      conds.push('(CASE WHEN top.n' + i + ' = \'y\' THEN q.' + rowNames[i] + ' IS NULL ELSE q.' + rowNames[i] + ' = top.k' + i + ' END)')
    }
    text += ' WHERE NOT EXISTS (SELECT 1 FROM unnest(' + arrays.join(', ') + ') AS top(' + defs.join(', ') + ') WHERE ' + conds.join(' AND ') + ')'
  }
  if (names.length) text += ' GROUP BY GROUPING SETS (' + sets.join(', ') + ')'
  text += ' LIMIT ' + (GROUP_CAP + 1)

  return {
    text, params: st.params, notes,
    names,
    rows: rows.map(g => ({ col: g.col, parse: g.parse })),
    cols: cols.map(g => ({ col: g.col, parse: g.parse })),
    values,
    figures: figs.list.map(f => ({ out: f.out, agg: f.agg })),
  }
}

// ── The plan ─────────────────────────────────────────────────

/**
 * Everything needed to run a definition: env = { tenantId, levels, params
 * (resolved), today, tz, spec }. Throws ReportError with sentences when it
 * can't be run.
 */
export function compileReport(spec, envIn, { listLimit = SCREEN_ROWS + 1, open = true } = {}) {
  const env = { ...envIn, spec }
  const period = mainPeriod(spec, env)

  if (spec.kind === 'list') {
    const rows = buildList(spec, env, 'rows', listLimit, open)
    const totals = buildList(spec, env, 'totals')
    return { kind: 'list', subject: spec.subject, period, rows, totals, columns: rows.columns, adds: rows.adds, notes: rows.notes, says: rows.says, open: rows.open }
  }

  const main = buildGrouped(spec, env)
  const plan = {
    kind: spec.kind, subject: spec.subject, period, main,
    rows: main.rows, cols: main.cols, values: main.values, figures: main.figures, notes: main.notes,
    sort: spec.sort, limit: spec.limit, totals: spec.totals, rankKey: spec.limit ? rankKey(spec) : null,
    compare: null,
    // "Everything else" needs the rows shown first: built once they are known.
    rest: spec.limit?.rest_as ? keys => buildGrouped(spec, env, { exclude: keys }) : null,
  }

  if (spec.compare) {
    if (!period) fail('Comparing needs a period: add "' + (CATALOGUE.subjects[spec.subject]?.fields.date?.label || 'Date') + ' is in ..." to the report\'s filters')
    const before = comparePeriod(period.range, spec.compare.with)
    const filters = spec.filters.map((f, i) => (i === period.index ? { field: 'date', op: 'in_period', value: { from: before.from, to: before.to } } : f))
    const earlier = { ...spec, filters }
    plan.compare = {
      with: spec.compare.with,
      from: before.from, to: before.to, text: rangeText(before.from, before.to),
      // Its days are moved forward onto the report's own, so the two line up row by row.
      run: buildGrouped(earlier, env, { shift: before.shift }),
      rest: spec.limit?.rest_as ? keys => buildGrouped(earlier, env, { exclude: keys, shift: before.shift }) : null,
    }
  }
  return plan
}
