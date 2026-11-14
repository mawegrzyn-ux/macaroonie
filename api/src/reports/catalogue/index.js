// src/reports/catalogue/index.js
//
// The report builder's data catalogue (docs/REPORTS.md 5): every subject a
// report can be about, put together and checked once when the API starts.
// A mistake in a subject (a link to nothing, a template naming a link the
// subject doesn't have) stops the start, never a report.
//
//   CATALOGUE              { subjects: { key: subject } } with the SQL (server only)
//   AREAS                  the headings subjects are listed under
//   catalogueView(levels)  what the browser and Pepper get: labels, types
//                          and links, no SQL, and only what the person's
//                          role may see

import common from './common.js'
import till from './till.js'
import online from './online.js'
import bookings from './bookings.js'
import purchasing from './purchasing.js'
import safety from './safety.js'
import kitchen from './kitchen.js'
import kiosks from './kiosks.js'
import loyalty from './loyalty.js'
import cash from './cash.js'
import staff from './staff.js'
import local from './local.js'
import { templateRefs } from './define.js'
import { MODULE_KEYS } from '../../config/modules.js'
import { NUMERIC_TYPES } from '../../../../shared/reports/format.js'
import { bucketsFor } from '../../../../shared/reports/paths.js'
import { LIMITS } from '../../../../shared/reports/spec.js'

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
  { key: 'safety', label: 'Food safety and H&S' },
  { key: 'guests', label: 'Customers' },
  { key: 'menus', label: 'Menus' },
  { key: 'local', label: 'Local info' },
  { key: 'tech', label: 'Store tech' },
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
        if (!allowed.has(ref)) fail(s, what + ' names {' + ref + '}, which isn\'t one of its links to one row')
      }
    }

    check('id', s.id.sql)
    if (s.where) check('where', s.where)
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

export const CATALOGUE = build([common, till, online, bookings, cash, staff, kitchen, kiosks, loyalty, purchasing, safety, local])

/** Every module a subject, field, figure or link of the catalogue asks for. */
export const CATALOGUE_MODULES = [...new Set(Object.values(CATALOGUE.subjects).flatMap(s => [
  s.module,
  ...Object.values(s.fields).map(f => f.needs),
  ...Object.values(s.measures).map(m => m.needs),
  ...Object.values(s.links).map(l => l.needs),
]).filter(Boolean))]

const can = (levels, moduleKey) => !moduleKey || (levels?.[moduleKey] && levels[moduleKey] !== 'none')

/** May the person report on this subject (start a report from it, or count its rows)? */
export const canReportOn = (subject, levels) => !subject.hidden && can(levels, subject.module)
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

/**
 * The catalogue without its SQL, for the builder and for Pepper: each
 * subject with its fields, measures and links by key, and `base` (the
 * person may start a report from it). Fields and links the person's role
 * can't see are left out; subjects they can't report on stay as things to
 * look up (a server's name on a check), with no measures. A measure says
 * `across` when it can also be a figure of a report about something that
 * has several of these rows.
 */
export function catalogueView(levels) {
  const subjects = {}
  for (const s of Object.values(CATALOGUE.subjects)) {
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
        }
      }
    }
    const links = {}
    for (const l of Object.values(s.links)) {
      if (l.hidden || !canSee(l, levels)) continue
      const to = CATALOGUE.subjects[l.to]
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
