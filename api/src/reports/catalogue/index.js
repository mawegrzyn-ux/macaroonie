// src/reports/catalogue/index.js
//
// The report builder's data catalogue (docs/REPORTS.md 5): every subject a
// report can be about, put together and checked once when the API starts.
// A mistake in a subject (a link to nothing, a template naming a link the
// subject doesn't have) stops the start, never a report.
//
//   CATALOGUE              { subjects: { key: subject } } with the SQL (server only)
//   AREAS                  the headings subjects are listed under
//   catalogueView(levels, catalogue?)  what the browser and Pepper get:
//                          labels, types and links, no SQL, and only what
//                          the person's role may see
//   tenantCatalogue(tenantId)  the catalogue with the group's own fields
//                          (migration 285, Pepper-first step 8B1) on their
//                          objects' subjects: CATALOGUE itself when the group
//                          has none. Read per request (reportPerson()), so
//                          a new field shows at once in every process
//   customCatalogue(byObject)  the same from definitions already read
//
// Each area's subjects are a file of their own in this folder, gathered from
// it (below): `export const order = <number>` (where they come),
// `export const subjects = [subject({ ... }), ...]`, and `export const
// decisions` (its tables no subject reads, and why: decisions.js). Nothing
// here lists the files; AREAS, the headings, stays here.

import { gather } from './gather.js'
import { FILES } from './files.js'
import { templateRefs } from './define.js'
import { MODULE_KEYS, permissionAtLeast } from '../../config/modules.js'
import { ASSISTANT_NAME } from '../../../../shared/assistant.js'
import { NUMERIC_TYPES } from '../../../../shared/reports/format.js'
import { bucketsFor } from '../../../../shared/reports/paths.js'
import { LIMITS } from '../../../../shared/reports/spec.js'
import { CUSTOM_OBJECTS, fieldSql } from '../../../../shared/customFields.js'
import { definitionsFor } from '../../services/customFields.js'

export const AREAS = [
  { key: 'till', label: 'Till sales' },
  { key: 'online', label: 'Online orders' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'cash', label: 'Cash reconciliation' },
  { key: 'staff', label: 'Staff and rota' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'kiosks', label: 'Self-order kiosks' },
  { key: 'loyalty', label: 'Loyalty' },
  { key: 'purchasing', label: 'Purchasing' },
  { key: 'recipes', label: 'Recipes and costing' },
  { key: 'stock', label: 'Stock' },
  { key: 'safety', label: 'Food safety and H&S' },
  { key: 'guests', label: 'Customers' },
  { key: 'menus', label: 'Menus' },
  { key: 'website', label: 'Website and reviews' },
  { key: 'local', label: 'Local info' },
  { key: 'tech', label: 'Store tech' },
  { key: 'pepper', label: ASSISTANT_NAME },
  { key: 'shared', label: 'Your group' },
]

const AGGS = ['sum', 'avg', 'min', 'max', 'count', 'count_distinct']

function build(lists) {
  const subjects = {}
  for (const s of lists.flat()) {
    if (subjects[s.key]) throw new Error('Report catalogue: two subjects are called "' + s.key + '"')
    subjects[s.key] = s
  }
  const fail = (s, msg) => { throw new Error('Report catalogue, ' + s.key + ': ' + msg) }

  for (const s of Object.values(subjects)) {
    if (!AREAS.some(a => a.key === s.area)) fail(s, 'unknown area "' + s.area + '"')
    if (s.module && !MODULE_KEYS.includes(s.module)) fail(s, 'unknown module "' + s.module + '"')
    if (s.name && !s.fields[s.name]) fail(s, 'its naming field "' + s.name + '" isn\'t one of its fields')

    const ones = new Set(Object.values(s.links).filter(l => !l.many).map(l => l.key))
    // A template may read the subject's own row, the venue's time zone and
    // the rows its "one" links lead to.
    const check = (what, sql, allowed = ones) => {
      for (const ref of templateRefs(sql)) {
        if (ref === 't') continue
        if (ref === 'tz') { if (what.startsWith('link venue')) fail(s, what + ' can\'t use {tz}'); continue }
        // The person running the report: only in a subject's own rule for
        // which rows count (a record that is each person's own). Nothing can
        // link to such a subject (the check on links below: its rows are
        // picked through more than {t}).
        if (ref === 'me') { if (what !== 'where') fail(s, what + ' can\'t use {me}: only a subject\'s where can'); continue }
        if (!allowed.has(ref)) fail(s, what + ' names {' + ref + '}, which isn\'t one of its links to one row')
      }
    }

    check('id', s.id.sql)
    if (s.where) check('where', s.where)
    // What it means to the people asking (define.js): words, a sentence, questions.
    for (const d of [...Object.values(s.fields), ...Object.values(s.measures)]) {
      const words = v => v == null || (Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim() && x.length <= 120))
      if (!words(d.synonyms)) fail(d.key + '\'s synonyms are a list of words')
      if (!words(d.examples)) fail(d.key + '\'s examples are a list of questions')
      if (d.instructions != null && (typeof d.instructions !== 'string' || !d.instructions.trim() || d.instructions.length > 400)) {
        fail(d.key + '\'s instructions are a sentence or two')
      }
    }
    for (const f of Object.values(s.fields)) {
      check('field ' + f.key, f.sql)
      if (f.bound) check('field ' + f.key + ' bound', f.bound)
      if (f.type === 'choice' && (!f.labels || !Object.keys(f.labels).length)) fail(s, 'field ' + f.key + ' is a choice without labels')
      if (f.needs && !MODULE_KEYS.includes(f.needs)) fail(s, 'field ' + f.key + ' needs an unknown module')
    }
    for (const m of Object.values(s.measures)) {
      if (m.needs && !MODULE_KEYS.includes(m.needs)) fail(s, 'measure ' + m.key + ' needs an unknown module')
      if (m.ratio) {
        for (const part of m.ratio) {
          const p = s.measures[part]
          if (!p || p.ratio) fail(s, 'measure ' + m.key + ' divides "' + part + '", which isn\'t a plain measure of this subject')
        }
        continue
      }
      if (!AGGS.includes(m.agg)) fail(s, 'measure ' + m.key + ' has no way of adding up')
      if (m.agg !== 'count' && !m.sql) fail(s, 'measure ' + m.key + ' needs a column')
      if (!NUMERIC_TYPES.includes(m.type)) fail(s, 'measure ' + m.key + ' must be a number, money, a percentage or a duration')
      if (m.sql) check('measure ' + m.key, m.sql)
      if (m.where) check('measure ' + m.key + ' where', m.where)
    }
    for (const l of Object.values(s.links)) {
      const to = subjects[l.to]
      if (!to) fail(s, 'link ' + l.key + ' leads to "' + l.to + '", which isn\'t a subject')
      if (l.needs && !MODULE_KEYS.includes(l.needs)) fail(s, 'link ' + l.key + ' needs an unknown module')
      // Rows worked out in code are filled for the run's own subject, its
      // venues and period: nothing can reach them through a link.
      if (to.from.work) fail(s, 'link ' + l.key + ' leads to ' + to.key + ', whose rows are worked out for each run')
      if (l.many) {
        // Their column, read on their row.
        const theirs = new Set(Object.values(to.links).filter(x => !x.many).map(x => x.key))
        check('link ' + l.key, l.sql, theirs)
      } else {
        check('link ' + l.key, l.sql)
        // The row it leads to is joined in one step: that subject's own
        // rule for which rows count can't lean on further links.
        if (to.where && templateRefs(to.where).some(r => r !== 't')) {
          fail(s, 'link ' + l.key + ' leads to ' + to.key + ', whose rows are picked through another link')
        }
        if (templateRefs(to.id.sql).some(r => r !== 't')) fail(s, 'link ' + l.key + ' leads to ' + to.key + ', whose id reads another link')
      }
    }
    // Links that read other links mustn't go round in a circle.
    const seen = new Set()
    const walk = (key, trail) => {
      if (trail.includes(key)) fail(s, 'links ' + [...trail, key].join(' > ') + ' go round in a circle')
      if (seen.has(key)) return
      seen.add(key)
      for (const ref of templateRefs(s.links[key].sql)) if (ones.has(ref)) walk(ref, [...trail, key])
    }
    for (const k of ones) walk(k, [])

    // The page a row opens: its own, or the one of the row a link leads to.
    if (typeof s.open === 'string') {
      const l = s.links[s.open]
      if (!l || l.many) fail(s, 'open names "' + s.open + '", which isn\'t one of its links to one row')
      if (typeof subjects[l.to]?.open !== 'object' || !subjects[l.to].open) fail(s, 'open follows ' + s.open + ' to ' + l.to + ', which has no page of its own')
    } else if (s.open) {
      if (!MODULE_KEYS.includes(s.open.module)) fail(s, 'open needs an unknown module "' + s.open.module + '"')
      if (s.open.id) check('open id', s.open.id)
      for (const [n, sql] of Object.entries(s.open.with)) check('open ' + n, sql)
    }

    for (const path of s.list) {
      const first = path.split('.')[0]
      if (!s.fields[first] && !s.links[first]) fail(s, 'its list names "' + path + '", which it doesn\'t have')
    }
    for (const o of s.sort) if (!s.fields[o.by.split('.')[0]] && !s.links[o.by.split('.')[0]]) fail(s, 'its sort names "' + o.by + '"')
  }
  return { subjects }
}

// The subjects are gathered from this folder: every file that exports
// `subjects` (the others, define.js, coverage.js, decisions.js and
// gather.js, are helpers), by its `order` and then its name. That order is
// the catalogue's: the builder lists an area's subjects in it, and Pepper
// and the smart builder take the first that fits. `subjects` is a list, or
// a function given every subject of the files with a list, and AREAS, and
// called after them all, whatever its order: Report runs name every other
// subject in their own words (runs.js), so they come last.
function gathered(files) {
  const listOf = (file, list) => {
    if (!Array.isArray(list)) throw new Error('Report catalogue: ' + file + '\'s subjects aren\'t a list')
    return list
  }
  for (const { file, order } of files) {
    if (!Number.isFinite(order)) throw new Error('Report catalogue: ' + file + ' needs an order (export const order = <number>)')
  }
  const isFn = f => typeof f.module.subjects === 'function'
  const lists = files.filter(f => !isFn(f)).map(f => listOf(f.file, f.module.subjects))
  const others = lists.flat()
  for (const f of files.filter(isFn)) lists.push(listOf(f.file, f.module.subjects(others, AREAS)))
  return lists
}

export const CATALOGUE = build(gathered(gather(FILES, 'subjects')))

// ── The group's own fields (Pepper-first step 8B1) ──────────────────────
// Each definition is a field of its object's subject (the registry's key is
// the subject's), keyed cf_<field_key> so it never meets a built-in field.
// Its SQL reads the row's `custom` column (fieldSql(), the key checked there);
// nothing else about the subject changes. On customers and staff a value may
// be about the person, so it counts as personal data (pii).
const CUSTOM_FIELD_TYPES = { text: 'text', number: 'number', yesno: 'yesno', date: 'date', choice: 'choice' }
const PERSONAL = new Set(['guests.customers', 'staff.people'])
export const customFieldKey = fieldKey => 'cf_' + fieldKey

export function customCatalogue(byObject) {
  const subjects = { ...CATALOGUE.subjects }
  let any = false
  for (const [objectKey, defs] of Object.entries(byObject || {})) {
    const base = CATALOGUE.subjects[objectKey]
    if (!base || !CUSTOM_OBJECTS[objectKey] || !defs?.length) continue
    const fields = { ...base.fields }
    for (const d of defs) {
      const key = customFieldKey(d.field_key)
      if (fields[key]) continue
      fields[key] = {
        key, label: d.label, type: CUSTOM_FIELD_TYPES[d.type], sql: fieldSql(d), col: null, custom: true,
        about: 'A field of your group\'s own' + (d.help ? ': ' + d.help : '.'),
        ...(d.type === 'choice' ? { labels: Object.fromEntries((d.options || []).map(o => [o, o])) } : {}),
        ...(PERSONAL.has(objectKey) ? { pii: true } : {}),
      }
    }
    subjects[objectKey] = { ...base, fields }
    any = true
  }
  return any ? { subjects } : CATALOGUE
}

export async function tenantCatalogue(tenantId) {
  if (!tenantId) return CATALOGUE
  return customCatalogue(await definitionsFor(tenantId))
}

/** Every module a subject, field, figure or link of the catalogue asks for. */
export const CATALOGUE_MODULES = [...new Set(Object.values(CATALOGUE.subjects).flatMap(s => [
  s.module,
  ...Object.values(s.fields).map(f => f.needs),
  ...Object.values(s.measures).map(m => m.needs),
  ...Object.values(s.links).map(l => l.needs),
]).filter(Boolean))]

// View on the module, or the level a subject asks for (Pepper's Activity is Manage).
const can = (levels, moduleKey, level = 'view') => !moduleKey || permissionAtLeast(levels?.[moduleKey], level)

/** May the person report on this subject (start a report from it, or count its rows)? */
export const canReportOn = (subject, levels) => !subject.hidden && can(levels, subject.module, subject.level)
/** May the person see this field or follow this link? */
export const canSee = (def, levels) => can(levels, def.needs)

/** How a figure may be added up when it is worked out for each of another subject's rows first (through a "many" link). */
export const ACROSS_AGGS = ['sum', 'count', 'min', 'max']

/**
 * Can a figure be worked out through a list of rows (a customer's bookings,
 * a check's payments)? A plain one that adds up, or a ratio of two that do.
 * An average or a "how many different" doesn't: the engine refuses those,
 * and the builder doesn't offer them.
 */
export function worksAcross(subject, m, levels = null) {
  if (!m.ratio) return ACROSS_AGGS.includes(m.agg)
  return m.ratio.every(k => {
    const part = subject.measures[k]
    return !!part && !part.ratio && ACROSS_AGGS.includes(part.agg) && (!levels || canSee(part, levels))
  })
}

/** A field's or measure's words for the people asking (define.js), where it has them. */
function context(d) {
  return {
    ...(d.synonyms?.length ? { synonyms: d.synonyms } : {}),
    ...(d.instructions ? { instructions: d.instructions } : {}),
    ...(d.examples?.length ? { examples: d.examples } : {}),
  }
}

/**
 * The catalogue without its SQL, for the builder and for Pepper: each
 * subject with its fields, measures and links by key, and `base` (the
 * person may start a report from it). Fields and links the person's role
 * can't see are left out; subjects they can't report on stay as things to
 * look up (a server's name on a check), with no measures. A measure says
 * `across` when it can also be a figure of a report about something that
 * has several of these rows.
 */
export function catalogueView(levels, catalogue = CATALOGUE) {
  const subjects = {}
  for (const s of Object.values(catalogue.subjects)) {
    const base = canReportOn(s, levels)
    const fields = {}
    for (const f of Object.values(s.fields)) {
      if (!canSee(f, levels)) continue
      fields[f.key] = {
        key: f.key, label: f.label, type: f.type,
        ...(f.title ? { title: f.title } : {}),
        ...(f.about ? { about: f.about } : {}),
        ...(f.labels ? { labels: f.labels } : {}),
        ...(f.pii ? { pii: true } : {}),
        ...(f.adds ? { adds: true } : {}),
        ...(f.decimals != null ? { decimals: f.decimals } : {}),
        ...(f.grain === 'week' ? { grain: 'week' } : {}),
        ...(bucketsFor(f.type).length ? { buckets: bucketsFor(f.type) } : {}),
        ...(f.custom ? { custom: true } : {}),
        ...context(f),
      }
    }
    const measures = {}
    if (base) {
      for (const m of Object.values(s.measures)) {
        if (!canSee(m, levels)) continue
        measures[m.key] = {
          key: m.key, label: m.label, type: m.type,
          ...(m.about ? { about: m.about } : {}),
          ...(m.decimals != null ? { decimals: m.decimals } : {}),
          ...(m.ratio ? { ratio: true } : { agg: m.agg }),
          ...(worksAcross(s, m, levels) ? { across: true } : {}),
          ...context(m),
        }
      }
    }
    const links = {}
    for (const l of Object.values(s.links)) {
      if (l.hidden || !canSee(l, levels)) continue
      const to = catalogue.subjects[l.to]
      // Counting another subject's rows needs that subject; looking one row up doesn't.
      if (l.many && !canReportOn(to, levels)) continue
      links[l.key] = { key: l.key, label: l.label, to: l.to, ...(l.many ? { many: true } : {}), ...(l.about ? { about: l.about } : {}) }
    }
    // What a row opens (docs/REPORTS.md 8): `page` when this person may open
    // the page in the app that shows one of these rows, `opens` what a row
    // usually opens ('self', or the link to the row that does).
    const page = s.open && typeof s.open === 'object' && can(levels, s.open.module) ? { label: s.open.label } : null
    subjects[s.key] = {
      key: s.key, label: s.label, one: s.one, about: s.about, area: s.area, base,
      ...(s.name ? { name: s.name } : {}),
      ...(page ? { page } : {}),
      ...(s.open ? { opens: typeof s.open === 'string' ? s.open : 'self' } : {}),
      dated: !!s.fields.date, venue: !!s.links.venue,
      fields, measures, links,
      list: s.list.filter(p => viewable(s, p, levels)),
      sort: s.sort,
    }
  }
  return { areas: AREAS, subjects }
}

// Whether every step of a path in a subject's usual list is something the person may see.
function viewable(s, path, levels) {
  const parts = path.split('.')
  let cur = s
  for (let i = 0; i < parts.length - 1; i++) {
    const l = cur.links[parts[i]]
    if (!l || l.many || !canSee(l, levels)) return false
    cur = CATALOGUE.subjects[l.to]
  }
  const f = cur.fields[parts[parts.length - 1]]
  return !!f && canSee(f, levels)
}

/**
 * What a list's rows open in the app (docs/REPORTS.md 8): `want` is the
 * definition's drill.open ('self', a path of links to one row, or 'none';
 * left out, the subject's usual). Null when nothing opens: none asked for,
 * a path that doesn't lead to a row with a page of its own, a link the
 * person's role can't follow, or a page they may not open. Otherwise
 * { path, hops, subject, page, label, id, with }: the links to follow, the
 * row's subject, its page with `:id` and the `with` names in it, and the
 * templates that fill them (`id` null: the row's own id).
 */
export function openTarget(subjectKey, want, levels) {
  const subject = CATALOGUE.subjects[subjectKey]
  if (!subject || want === 'none') return null
  let path = want
  if (path == null) {
    if (!subject.open) return null
    path = typeof subject.open === 'string' ? subject.open : 'self'
  }
  const hops = path === 'self' ? [] : String(path).split('.')
  if (hops.length > LIMITS.open_hops) return null
  let cur = subject
  for (const k of hops) {
    const l = cur.links[k]
    if (!l || l.many || l.hidden || !canSee(l, levels)) return null
    cur = CATALOGUE.subjects[l.to]
  }
  const o = cur?.open
  if (!o || typeof o !== 'object' || !can(levels, o.module)) return null
  return { path, hops, subject: cur, page: o.page, label: o.label, id: o.id, with: o.with }
}

/** A subject's usual list columns the person may see (for drill-downs to the rows). */
export const listColumns = (subjectKey, levels) => {
  const s = CATALOGUE.subjects[subjectKey]
  return s ? s.list.filter(p => viewable(s, p, levels)) : []
}

/**
 * A report whose subject (or a subject it shows beside it) is each person's
 * own record ({me} in its rule, e.g. usage.mine): it can only be run by the
 * person, never scheduled or made a data link, which run as their owner and
 * would send the owner's record to others (decision 8 of the Pepper-first plan).
 */
export function ownRecordOnly(spec) {
  const keys = [spec?.subject, ...((spec?.also || []).map(a => a?.subject))].filter(Boolean)
  return keys.some(k => JSON.stringify(CATALOGUE.subjects[k]?.where ?? '').includes('{me}'))
}

