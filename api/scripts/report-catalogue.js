#!/usr/bin/env node
// scripts/report-catalogue.js
//
// The report builder's data catalogue against the database
// (docs/REPORTS.md 5.3 and 5.6). It reads information_schema only: no rows.
//
//   node api/scripts/report-catalogue.js
//       Where things stand: every table's decision (in the catalogue,
//       planned, settings, left out), tables with none, and for each table
//       the catalogue reads, the columns it doesn't offer yet. Exits 1 when
//       something needs deciding (what api/test/reports-catalogue.test.mjs
//       fails on).
//
//   node api/scripts/report-catalogue.js <table> [<table> ...]
//       A draft subject for each table named, from its columns, types,
//       checks and foreign keys: something to paste into a file under
//       api/src/reports/catalogue/ and then curate (names, what to leave
//       out, what counts as a sale).
//
//   node api/scripts/report-catalogue.js --area <area>
//       A draft for every table planned for that area (till, kitchen, cash,
//       staff, purchasing, safety, loyalty ...: see decisions.js).
//
// Env: the API's own (cd api && set -a; source .env; set +a), since the
// catalogue reads a few lists from services that load the configuration.

import postgres from 'postgres'
import { CATALOGUE } from '../src/reports/catalogue/index.js'
import { PLANNED, checkDecisions, tableDecisions } from '../src/reports/catalogue/decisions.js'
import { tableCoverage, secretsRead, SECRET_COLUMN } from '../src/reports/catalogue/coverage.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} })

const argv = process.argv.slice(2)
const areaAt = argv.indexOf('--area')
const area = areaAt !== -1 ? argv[areaAt + 1] : null
const named = argv.filter((a, i) => !a.startsWith('--') && (areaAt === -1 || i !== areaAt + 1))

async function schema() {
  const columns = await sql`
    SELECT table_name AS "table", column_name AS "column", data_type AS type, udt_name AS udt,
           is_nullable = 'YES' AS nullable, ordinal_position AS pos
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
     ORDER BY table_name, ordinal_position`
  // Foreign keys on one column: which table each points at.
  const fks = await sql`
    SELECT c.conrelid::regclass::text AS "table", a.attname AS "column", c.confrelid::regclass::text AS "to"
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.connamespace = 'public'::regnamespace`
  // CHECK (col = ANY (ARRAY['a', 'b'])) and enum types: the values a text column can hold.
  const checks = await sql`
    SELECT c.conrelid::regclass::text AS "table", pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'c' AND c.connamespace = 'public'::regnamespace`
  const enums = await sql`
    SELECT t.typname AS udt, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
     GROUP BY t.typname`
  return { columns, fks, checks, enums }
}

// ── Where things stand ───────────────────────────────────────

async function report() {
  const { columns } = await schema()
  const tables = [...new Set(columns.map(c => c.table))]
  const d = checkDecisions(CATALOGUE, tables)
  const cover = tableCoverage(CATALOGUE, columns)
  const secrets = secretsRead(CATALOGUE)
  let wrong = 0

  console.log('Tables: ' + tables.length)
  console.log('  in the catalogue  ' + d.counts.subject)
  console.log('  planned           ' + d.counts.planned)
  console.log('  settings          ' + d.counts.settings)
  console.log('  left out          ' + d.counts.out)

  const list = (title, names) => {
    if (!names.length) return
    wrong += names.length
    console.log('\n' + title)
    for (const n of names) console.log('  ' + n)
  }
  list('No decision yet (add a subject, or a line in catalogue/decisions.js):', d.missing)
  list('Decided more than once:', d.twice)
  list('Named in decisions.js, but not a table any more:', d.gone)

  const planned = tableDecisions(CATALOGUE).filter(x => x.kind === 'planned')
  console.log('\nPlanned, by area:')
  for (const a of Object.keys(PLANNED)) {
    const mine = planned.filter(x => x.area === a)
    console.log('  ' + a.padEnd(11) + String(mine.length).padStart(3) + '  (phase ' + (PLANNED[a].phase || 3) + ')')
  }

  let waiting = 0
  console.log('\nColumns not offered yet, by table:')
  for (const t of cover.tables) {
    waiting += t.notOffered.length
    console.log('  ' + t.table + ' (' + t.subjects.join(', ') + '): ' + (t.notOffered.length ? t.notOffered.length + ' of ' + t.columns + ': ' + t.notOffered.join(', ') : 'none'))
  }
  console.log('  ' + waiting + ' waiting in all')
  if (cover.derived.length) console.log('\nWritten as their own SELECT (not followed column by column): ' + cover.derived.join(', '))

  list('Id columns that are neither linked, offered nor in a skip list:', cover.tables.flatMap(t => t.idsUndecided.map(c => t.table + '.' + c)))
  list('Skip lists naming something that is used after all, or isn\'t a column:', cover.tables.flatMap(t => t.stale.map(c => t.table + '.' + c)))
  list('Columns a subject reads that the table doesn\'t have:', cover.tables.flatMap(t => t.unknown.map(c => t.table + '.' + c)))
  list('Templates that read a column that is never offered:', secrets.map(s => s.where + ': ' + s.column))

  console.log(wrong ? '\n' + wrong + ' to sort out' : '\nNothing to sort out')
  return wrong ? 1 : 0
}

// ── A draft subject ──────────────────────────────────────────

const words = name => { const s = name.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
const quote = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const MONEY_NAME = /(^|_)(amount|total|subtotal|price|cost|fee|tip|tips|discount|refund|refunded|deposit|charge|vat|tax|net|gross|pay|wage|wages|value|balance)(_|$)/
const PERSONAL = /(^|_)(email|phone|address|postcode|first_name|last_name|guest_name|customer_name|dob|birthday)(_|$)/
const NUMBERS = new Set(['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'])

function draft(table, { columns, fks, checks, enums }) {
  const cols = columns.filter(c => c.table === table)
  if (!cols.length) return '// ' + table + ': no such table\n'
  const subjectOf = new Map()
  for (const s of Object.values(CATALOGUE.subjects)) if (s.from.table && !subjectOf.has(s.from.table)) subjectOf.set(s.from.table, s.key)
  const fk = new Map(fks.filter(f => f.table === table).map(f => [f.column, f.to]))
  const enumOf = new Map(enums.map(e => [e.udt, e.labels]))
  // CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
  const choices = new Map()
  for (const c of checks.filter(c => c.table === table)) {
    const m = c.def.match(/\(+\(?([a-z_][a-z0-9_]*)\)?(?:::text)? = ANY \(+ARRAY\[(.+?)\]/)
    if (!m) continue
    const values = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map(x => x[1].replace(/''/g, "'"))
    if (values.length) choices.set(m[1], values)
  }
  const decision = tableDecisions(CATALOGUE).find(x => x.table === table)
  const areaOf = decision?.area || '?'

  const fields = []
  const links = []
  const measures = ['count: count({ label: ' + quote(words(table)) + ' }),']
  const left = []
  let venue = null
  let dateField = null
  let tenant = false

  for (const c of cols) {
    const name = c.column
    if (name === 'id') continue
    if (name === 'tenant_id') { tenant = true; continue }
    if (SECRET_COLUMN.test(name)) { left.push(name + ': never offered'); continue }
    if (name === 'venue_id') { venue = name; continue }
    // Something that points at another row: named ..._id, or a uuid (closed_by, approved_by).
    if (name.endsWith('_id') || c.type === 'uuid') {
      const key = name.endsWith('_id') ? name.slice(0, -3) : name
      const to = fk.get(name)
      if (!to) left.push(name + ': an id with no foreign key: link it by hand (one(\'<subject>\', ' + quote(name) + ')) or add it to skip')
      else if (subjectOf.has(to)) links.push(key + ': one(' + quote(subjectOf.get(to)) + ', ' + quote(name) + '),')
      else links.push('// ' + key + ': one(\'?\', ' + quote(name) + '),   -> ' + to + ' (not a subject yet)')
      continue
    }
    const pii = PERSONAL.test(name) ? ', { pii: true }' : ''
    const values = choices.get(name) || (c.type === 'USER-DEFINED' ? enumOf.get(c.udt) : null)
    if (values) {
      fields.push(name + ': choice(' + quote(name) + ', { ' + values.map(v => (/^[a-z_][a-z0-9_]*$/.test(v) ? v : quote(v)) + ': ' + quote(words(v))).join(', ') + ' }),')
    } else if (c.type === 'boolean') {
      fields.push(name + ': yesno(' + quote(name) + '),')
    } else if (NUMBERS.has(c.type)) {
      if (name.endsWith('_pence')) {
        const key = name.slice(0, -6)
        fields.push(key + ': money(' + quote(name) + '),')
        measures.push(key + ': sum(' + quote(name) + ', { type: \'money\' }),')
      } else if (c.type === 'numeric' && MONEY_NAME.test(name)) {
        fields.push(name + ': money(' + quote(name) + ', { unit: \'pounds\' }),   // pounds? check the column')
        measures.push(name + ': sum(' + quote(name) + ', { type: \'money\', unit: \'pounds\' }),')
      } else {
        fields.push(name + ': number(' + quote(name) + '),')
      }
    } else if (c.type === 'date') {
      if (!dateField) dateField = name
      else fields.push(name + ': date(' + quote(name) + '),')
    } else if (c.type.startsWith('timestamp')) {
      fields.push(name + ': moment(' + quote(name) + '),')
    } else if (c.type.startsWith('time')) {
      fields.push(name + ': text({ sql: "to_char({t}.' + name + ', \'HH24:MI\')" }),')
    } else if (c.type === 'text' || c.type === 'character varying' || c.type === 'character' || c.type === 'citext') {
      fields.push(name + ': text(' + quote(name) + pii + '),')
    } else {
      left.push(name + ' (' + (c.type === 'ARRAY' ? c.udt.replace(/^_/, '') + '[]' : c.type) + '): left out')
    }
  }
  const name = cols.some(c => c.column === 'name') ? 'name' : cols.some(c => c.column === 'title') ? 'title' : null
  const out = []
  out.push('// ' + table + ': ' + cols.length + ' columns' + (decision ? ' (' + (decision.kind === 'subject' ? 'already read by ' + decision.subjects.join(', ') : decision.kind === 'planned' ? 'planned: ' + decision.area + ', things ' + (decision.rows === 'happen' ? 'that happen' : 'to group by') : decision.kind === 'settings' ? 'settings' : 'left out: ' + decision.reason) + ')' : ' (no decision yet)'))
  out.push('subject({')
  out.push('  key: ' + quote(areaOf + '.' + table) + ',')
  out.push('  label: ' + quote(words(table)) + ', one: ' + quote(words(table).toLowerCase()) + ',')
  out.push('  about: \'\',')
  out.push('  module: \'?\',')
  out.push('  from: ' + quote(table) + ',')
  if (!tenant) out.push('  tenant: null,   // no tenant_id: check how its rows are kept to one group')
  if (!cols.some(c => c.column === 'id')) out.push('  id: \'?\',   // no id column')
  if (name) out.push('  name: ' + quote(name) + ',')
  if (venue) out.push('  venue: ' + quote(venue) + ',')
  if (dateField) out.push('  date: ' + quote(dateField) + ',')
  out.push('  fields: {')
  for (const f of fields) out.push('    ' + f)
  out.push('  },')
  out.push('  measures: {')
  for (const m of measures) out.push('    ' + m)
  out.push('  },')
  out.push('  links: {')
  for (const l of links) out.push('    ' + l)
  out.push('  },')
  if (left.length) {
    out.push('  // Not offered:')
    for (const l of left) out.push('  //   ' + l)
  }
  out.push('}),')
  return out.join('\n') + '\n'
}

async function drafts(tables) {
  const s = await schema()
  for (const t of tables) console.log(draft(t, s))
  return 0
}

let code = 0
try {
  if (area) {
    const a = PLANNED[area]
    if (!a) {
      console.error('No area called "' + area + '". Areas: ' + Object.keys(PLANNED).join(', '))
      code = 1
    } else code = await drafts([...a.happen, ...a.group])
  } else if (named.length) code = await drafts(named)
  else code = await report()
} catch (e) {
  console.error(e.message)
  code = 1
}
await sql.end({ timeout: 2 })
process.exit(code)
