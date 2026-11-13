// src/reports/catalogue/coverage.js
//
// What the catalogue uses of each table it reads (docs/REPORTS.md 5.3 and
// 5.6), worked out from the subjects themselves. Read by the coverage test
// (api/test/reports-catalogue.test.mjs) and by scripts/report-catalogue.js.

const OWN = /\{t\}\.([a-z_][a-z0-9_]*)/g
const ownColumns = sql => [...String(sql || '').matchAll(OWN)].map(m => m[1])

/** Column names that are never offered, whatever table they are in. */
export const SECRET_COLUMN = /(^|_)(hash|token|secret|password|salt|api_key|pin)(_|$)/

/**
 * Each table a subject reads as it is, with the columns its subjects use:
 * { tables: Map(table -> { subjects: [keys], used: Set, skipped: Set }),
 *   derived: [subject keys written as their own SELECT, which can't be
 *   followed column by column] }.
 *
 * A column counts as used when a field, a measure, a link, the subject's id,
 * its tenant column or its rule for which rows count reads it. `skipped` are
 * the id columns a subject leaves out on purpose (its `skip` list).
 */
export function columnUse(catalogue) {
  const tables = new Map()
  const derived = []
  const entry = table => {
    if (!tables.has(table)) tables.set(table, { subjects: [], used: new Set(), skipped: new Set() })
    return tables.get(table)
  }
  const subjects = Object.values(catalogue.subjects)

  for (const s of subjects) {
    if (!s.from.table) { derived.push(s.key); continue }
    const e = entry(s.from.table)
    e.subjects.push(s.key)
    const read = sql => { for (const c of ownColumns(sql)) e.used.add(c) }
    if (s.tenant) e.used.add(s.tenant)
    read(s.id.sql)
    read(s.where)
    for (const f of Object.values(s.fields)) { read(f.sql); read(f.bound) }
    for (const m of Object.values(s.measures)) { read(m.sql); read(m.where) }
    for (const l of Object.values(s.links)) if (!l.many) read(l.sql)
    for (const c of s.skip) e.skipped.add(c)
  }

  // The other side of a link: a "many" link's column is on their row, and a
  // "one" link's `on` names a column of the row it leads to.
  for (const s of subjects) {
    for (const l of Object.values(s.links)) {
      const to = catalogue.subjects[l.to]
      if (!to?.from.table) continue
      const e = entry(to.from.table)
      if (l.many) for (const c of ownColumns(l.sql)) e.used.add(c)
      else if (l.on) e.used.add(l.on)
    }
  }
  return { tables, derived }
}

// A column that points at another row: named ..._id, or a uuid (closed_by, approved_by).
const isId = c => c.column.endsWith('_id') || c.type === 'uuid'

/**
 * The catalogue's tables against the database's columns.
 * `columns` is [{ table, column, type }] (information_schema.columns).
 * Gives, for each table a subject reads as it is:
 *   notOffered   columns no subject uses and no skip list names: waiting
 *                for someone to offer them or leave them out
 *   idsUndecided the ids among those (a link nobody has made or left out)
 *   stale        names in a skip list that aren't columns any more, or that a subject uses after all
 *   unknown      columns a subject reads that the table doesn't have
 */
export function tableCoverage(catalogue, columns) {
  const { tables, derived } = columnUse(catalogue)
  const byTable = new Map()
  for (const c of columns) {
    if (!byTable.has(c.table)) byTable.set(c.table, [])
    byTable.get(c.table).push(c)
  }
  const out = []
  for (const [table, e] of [...tables].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cols = byTable.get(table) || []
    const names = new Set(cols.map(c => c.column))
    out.push({
      table,
      subjects: e.subjects,
      columns: cols.length,
      notOffered: cols.filter(c => !e.used.has(c.column) && !e.skipped.has(c.column)).map(c => c.column),
      idsUndecided: cols.filter(c => isId(c) && !e.used.has(c.column) && !e.skipped.has(c.column)).map(c => c.column),
      stale: [...e.skipped].filter(c => !names.has(c) || e.used.has(c)).sort(),
      // Used by a subject, but not a column of the table: a typo the database would only show when the field is used.
      unknown: [...e.used].filter(c => !names.has(c)).sort(),
    })
  }
  return { tables: out, derived }
}

/** Every SQL template of the catalogue, with where it is: [{ where, sql }]. */
export function catalogueTemplates(catalogue) {
  const out = []
  for (const s of Object.values(catalogue.subjects)) {
    const add = (what, sql) => { if (sql) out.push({ where: s.key + ' ' + what, sql: String(sql) }) }
    add('from', s.from.sql)
    add('id', s.id.sql)
    add('where', s.where)
    for (const f of Object.values(s.fields)) { add('field ' + f.key, f.sql); add('field ' + f.key + ' bound', f.bound) }
    for (const m of Object.values(s.measures)) { add('measure ' + m.key, m.sql); add('measure ' + m.key + ' where', m.where) }
    for (const l of Object.values(s.links)) add('link ' + l.key, l.sql)
  }
  return out
}

/** Templates that read a column that must never be offered: [{ where, column }]. */
export function secretsRead(catalogue) {
  const out = []
  for (const t of catalogueTemplates(catalogue)) {
    for (const m of t.sql.matchAll(/\b([a-z_][a-z0-9_]*)\b/g)) {
      if (SECRET_COLUMN.test(m[1])) out.push({ where: t.where, column: m[1] })
    }
  }
  return out
}
