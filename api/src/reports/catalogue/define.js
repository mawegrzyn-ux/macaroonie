// src/reports/catalogue/define.js
//
// How the report builder's data catalogue is written (docs/REPORTS.md 5).
// A subject is something a report can be about (checks, dishes sold,
// bookings) or a thing reports group by (a venue, a server, a dish). The
// catalogue is the only place table and column names come from: the engine
// builds every statement from these definitions, and a person's report only
// ever names subjects, fields, measures and links by their keys.
//
//   subject({
//     key:    'till.checks',
//     label:  'Checks',                 one: 'check',
//     about:  'Every check a till or kiosk opened ...',
//     module: 'pos_reports',            who may report on it (View)
//     from:   'pos_checks',             a table, or { sql: '(SELECT ...)', tables: [...] }
//     where:  "{t}.status <> 'x'",      rows that count as this subject
//     id:     'id',  idType: 'text',    its key (a column or { sql })
//     name:   'number',                 the field that names a row
//     venue:  'venue_id',               gives the built-in `venue` link
//     date:   { sql: '{day}.business_date', label: 'Trading day' },   the built-in `date` field
//     fields:   { ... },  measures: { ... },  links: { ... },
//     list:   ['number', 'date', ...],  the columns a list of it starts with
//     open:   { page: '/pos/reports?check=:id&venue=:venue', module: 'pos_reports',
//               with: { venue: 'venue_id' } }
//                                       the page in the app that shows one of its rows
//                                       (docs/REPORTS.md 8): `:id` is the row's id (or
//                                       the `id` template), every other `:name` a `with`
//                                       template; `module` is what the person needs to
//                                       open that page. Or a link's key ('check'): its
//                                       rows open the row that link leads to
//     skip:   ['loyalty_member_id'],    columns left out on purpose: the coverage test
//                                       lists every other column no field reads as
//                                       waiting, and fails on an id column among them
//   })
//
// SQL is written as templates: {t} is the subject's own row, {linkname} the
// row a "one" link leads to (joined when used), {tz} the time zone of the
// row's venue (the group's first venue's when the subject has none).
//
// Values leave the catalogue in everyday units, whatever the column holds:
// money in pounds, percentages as fractions, durations in seconds.

const COLUMN = /^[a-z_][a-z0-9_]*$/
const SUBJECT_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/
const KEY = /^[a-z][a-z0-9_]*$/

export const labelOf = key => {
  const s = String(key).replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A column of the subject's own table, or { sql: template }, as a template. */
function source(src) {
  if (typeof src === 'string') {
    if (!COLUMN.test(src)) throw new Error('"' + src + '" isn\'t a column name (use { sql } for anything else)')
    return { sql: '{t}.' + src, col: src }
  }
  if (src && typeof src.sql === 'string' && src.sql.trim()) return { sql: src.sql.trim(), col: null }
  throw new Error('A column name or { sql } is needed')
}

const field = (type, src, opts = {}) => ({ ...opts, type, ...source(src) })

// ── Fields ────────────────────────────────────────────────────
// Options: label, title (the heading when it stands alone), about, pii
// (personal data), needs (a module the person must also be able to view),
// adds (a number that makes sense to add up), empty (what an empty value
// reads as), decimals.

export const text = (src, opts) => field('text', src, opts)
export const number = (src, opts) => field('number', src, opts)
export const yesno = (src, opts) => field('yesno', src, opts)
/** A calendar day (a date column, or an expression that gives one). */
export const date = (src, opts) => field('date', src, opts)
/** A moment in time (timestamptz); shown and grouped at its venue's own time. */
export const moment = (src, opts) => field('moment', src, opts)
/** Seconds. */
export const duration = (src, opts) => field('duration', src, opts)
/** One of a known set of values: labels = { value: 'What it is called' }. */
export const choice = (src, labels, opts) => field('choice', src, { ...opts, labels })

/** Money. unit: 'pence' (the default: integer pence) or 'pounds'. */
export function money(src, opts = {}) {
  const { unit = 'pence', ...rest } = opts
  const s = source(src)
  return { adds: true, ...rest, type: 'money', col: s.col, sql: unit === 'pence' ? '((' + s.sql + ')::numeric / 100)' : '((' + s.sql + ')::numeric)' }
}

/** A percentage. unit: 'percent' (the default: 20 means 20%) or 'fraction'. */
export function percent(src, opts = {}) {
  const { unit = 'percent', ...rest } = opts
  const s = source(src)
  return { ...rest, type: 'percent', col: s.col, sql: unit === 'percent' ? '((' + s.sql + ')::numeric / 100)' : '((' + s.sql + ')::numeric)' }
}

// ── Measures ──────────────────────────────────────────────────
// A figure worked out over rows: options label, about, type ('number' |
// 'money' | 'percent' | 'duration'), unit (money: 'pence' | 'pounds'),
// where (a template: only rows it holds for count), decimals, needs.

function measure(agg, src, opts = {}) {
  const { unit = 'pence', type = 'number', ...rest } = opts
  let sql = null, col = null
  if (src != null) {
    const s = source(src)
    col = s.col
    sql = type === 'money' && unit === 'pence' ? '((' + s.sql + ')::numeric / 100)' : '(' + s.sql + ')'
  }
  return { where: null, ...rest, agg, type, sql, col }
}
export const sum = (src, opts) => measure('sum', src, opts)
export const avg = (src, opts) => measure('avg', src, opts)
export const min = (src, opts) => measure('min', src, opts)
export const max = (src, opts) => measure('max', src, opts)
/** How many rows (that `where` holds for). */
export const count = opts => measure('count', null, { ...opts, type: 'number' })
/** How many different values. */
export const countDistinct = (src, opts) => measure('count_distinct', src, { ...opts, type: 'number' })
/** One measure divided by another, worked out at every level of a report (never added up). */
export const ratio = (numerator, denominator, opts = {}) => ({ type: 'number', ...opts, ratio: [numerator, denominator] })

// ── Links ─────────────────────────────────────────────────────
// one():  this row points at one row of another subject (a check's server).
//         `src` is the column (or { sql }) on this side; `on` the column on
//         the other side when it isn't that subject's id.
// many(): the other subject's rows point at this one (a check's lines).
//         `theirSrc` is the column on their side.
// Options: label, about, needs (a module), hidden.

export const one = (to, src, opts = {}) => ({ ...opts, to, many: false, ...source(src) })
export const many = (to, theirSrc, opts = {}) => ({ ...opts, to, many: true, ...source(theirSrc) })

// ── Subjects ──────────────────────────────────────────────────

export function subject(def) {
  const fail = msg => { throw new Error('Report catalogue, ' + (def?.key || '(no key)') + ': ' + msg) }
  if (!def || !SUBJECT_KEY.test(def.key || '')) fail('needs a key like "till.checks"')
  if (!def.label) fail('needs a label')
  if (!def.from) fail('needs a table (from)')

  const from = typeof def.from === 'string'
    ? { table: def.from, sql: null, tables: [def.from] }
    : { table: null, sql: String(def.from.sql || '').trim(), tables: def.from.tables || [] }
  if (from.table && !COLUMN.test(from.table)) fail('"' + from.table + '" isn\'t a table name')
  if (!from.table && !from.sql) fail('needs a table or { sql }')

  let id
  try { id = source(def.id === undefined ? 'id' : def.id) } catch (e) { fail('id: ' + e.message) }

  const s = {
    key: def.key,
    label: def.label,
    one: def.one || def.label.toLowerCase(),
    about: def.about || '',
    area: def.area || def.key.split('.')[0],
    module: def.module ?? null,
    hidden: !!def.hidden,
    from,
    where: def.where || null,
    id: { sql: id.sql, col: id.col },
    idType: def.idType === 'text' ? 'text' : 'uuid',
    tenant: def.tenant === undefined ? 'tenant_id' : def.tenant,
    name: def.name || null,
    fields: {},
    measures: {},
    links: {},
    list: def.list || [],
    sort: def.sort || [],
    skip: def.skip || [],
    open: null,
  }

  // The page that shows one of its rows (checked against the links in index.js).
  if (def.open != null) {
    if (typeof def.open === 'string') {
      if (!KEY.test(def.open)) fail('open: "' + def.open + '" isn\'t a link\'s key')
      s.open = def.open
    } else {
      const o = def.open
      const names = typeof o.page === 'string' ? [...o.page.matchAll(/:([a-z_][a-z0-9_]*)/g)].map(m => m[1]) : []
      if (typeof o.page !== 'string' || !o.page.startsWith('/') || !names.includes('id')) fail('open needs a page in the app with :id in it')
      if (!o.module) fail('open needs the module the page asks for')
      const withs = o.with || {}
      for (const n of names) if (n !== 'id' && !withs[n]) fail('open\'s page names :' + n + ', which isn\'t one of its values')
      for (const n of Object.keys(withs)) {
        if (!KEY.test(n) || n === 'id') fail('open: "' + n + '" can\'t name a value')
        if (!names.includes(n)) fail('open has a value "' + n + '" its page doesn\'t use')
      }
      let id
      try { id = o.id == null ? null : source(o.id).sql } catch (e) { fail('open id: ' + e.message) }
      const w = {}
      try { for (const [n, src] of Object.entries(withs)) w[n] = source(src).sql } catch (e) { fail('open: ' + e.message) }
      s.open = { page: o.page, module: o.module, id, with: w, label: o.label || 'Open the ' + s.one }
    }
  }

  const put = (bag, kind, k, v) => {
    if (!KEY.test(k)) fail(kind + ' "' + k + '": keys are lower case words joined by _')
    if (s.fields[k] || s.measures[k] || s.links[k]) fail('"' + k + '" is used twice (fields, measures and links share one set of names)')
    bag[k] = { key: k, ...v, label: v.label || labelOf(k) }
  }

  try {
    // The report date comes first in the field list.
    if (def.date) {
      const d = typeof def.date === 'string' ? source(def.date) : { sql: String(def.date.sql).trim(), col: null }
      put(s.fields, 'field', 'date', {
        type: 'date', sql: d.sql, col: d.col,
        bound: (typeof def.date === 'object' && def.date.bound) || null,
        label: (typeof def.date === 'object' && def.date.label) || 'Date',
        about: (typeof def.date === 'object' && def.date.about) || '',
      })
    }
    for (const [k, f] of Object.entries(def.fields || {})) put(s.fields, 'field', k, f)
    for (const [k, m] of Object.entries(def.measures || {})) put(s.measures, 'measure', k, m)
    if (def.venue) put(s.links, 'link', 'venue', { label: 'Venue', ...one('venue', def.venue) })
    for (const [k, l] of Object.entries(def.links || {})) put(s.links, 'link', k, l)
  } catch (e) {
    if (String(e.message).startsWith('Report catalogue')) throw e
    fail(e.message)
  }
  return s
}

/** The names a template reads: 't', 'tz' and the links it goes through. */
export function templateRefs(sql) {
  const out = new Set()
  for (const m of String(sql || '').matchAll(/\{([a-z_][a-z0-9_]*)\}/g)) out.add(m[1])
  return [...out]
}
