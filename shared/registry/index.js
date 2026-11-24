// shared/registry/index.js: the object registry (docs/PEPPER_FIRST.md 13,
// decision 5; "Under the surface" in reports/AI first back office
// strategy.md; Pepper-first step 8A1, 24 Nov 2026).
//
// A registry over what exists, not an engine: one record per business object
// (a booking, a supplier, a fridge reading), each naming what is already
// there, by the names the app already uses. No tenant-defined tables.
//
// Each area keeps its records in shared/registry/<area>.js (the area slugs of
// docs/claude/areas), listed in files.js, exporting:
//
//   objects       its records: [{ ... }], fields below
//   notObjects    the report subjects of the area that are no business object,
//                 and why: { 'Why, in a sentence': ['subject.key', ...] }
//
// A record:
//   key       the object's name: the report subject's key where one exists
//             (the catalogue's subject names are the vocabulary), else
//             '<area>.<name>' ('bookings.closures')
//   label     its name, one: 'Supplier';  plural: 'Suppliers'
//   words     other names people use for it (optional): ['vendor']
//   table     the table its rows live in
//   subjects  the report subjects about it, its own first ([] when none)
//   page      the admin page that lists it (a path of shared/nav)
//   open      the address that opens one (optional): { page, with }, `with`
//             the link values that pick it out (some of the page's `accepts`:
//             venue, date, week, tab); openLink() builds it with pageLink()
//   actions   the Pepper tools that change it, by name ([] when none). What
//             each one costs if wrong (class), its checks (preconditions) and
//             its undo (inverse) are the tool's own: never copied here
//   forms     the forms that edit it (keys of shared/forms.js; [] when none)
//
// Checked by shared/test/registry.test.mjs (pages, forms, the fields) and
// api/test/pepper-registry.test.mjs (tools, subjects, tables: every change
// tool belongs to an object, every report subject to an object or to a
// notObjects reason).

import { FILES } from './files.js'
import { NAV_PAGES } from '../nav/index.js'
import { pageAccepts, pageLink } from '../nav/links.js'
import { FORMS } from '../forms.js'
import { searchTerms, wordForms } from '../navSearch.js'

export const RECORD_FIELDS = ['key', 'label', 'plural', 'words', 'table', 'subjects', 'page', 'open', 'actions', 'forms']
const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/

/** Every record, with `area` added: the file it is in. */
export const OBJECT_LIST = FILES.flatMap(([area, mod]) => (mod.objects || []).map(o => ({
  words: [], subjects: [], actions: [], forms: [], ...o, area,
})))

/** The records by key. */
export const OBJECTS = Object.fromEntries(OBJECT_LIST.map(o => [o.key, o]))

/** Report subjects that are no business object: { subject: { reason, area } }. */
export const NOT_OBJECTS = {}
for (const [area, mod] of FILES) {
  for (const [reason, keys] of Object.entries(mod.notObjects || {})) {
    for (const k of keys) NOT_OBJECTS[k] = { reason, area }
  }
}

/** The object a report subject is about, or null. */
export function objectOfSubject(subjectKey) {
  return OBJECT_LIST.find(o => o.subjects.includes(subjectKey)) || null
}

/** The objects a Pepper tool changes (usually one). */
export function objectsOfAction(toolName) {
  return OBJECT_LIST.filter(o => o.actions.includes(toolName))
}

/** The address that opens one (venue, date, week or tab as the page takes them), or its list page. */
export function openLink(record, values = {}) {
  if (!record.open) return record.page
  const keep = Object.fromEntries(Object.entries(values || {}).filter(([k]) => record.open.with.includes(k)))
  return pageLink(record.open.page, keep)
}

// Every word a record is known by: its name, plural, other words and key.
function namesOf(o) {
  return [o.label, o.plural, ...o.words, o.key.split('.').pop().replace(/_/g, ' ')]
}

/**
 * The records that best fit some words ("a supplier", "fridge temps",
 * "bookings.bookings"), best first: a key or a whole name first, then the
 * records whose names hold every word asked (a plural or singular counts).
 * [] when none does.
 */
export function findObjects(text) {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return []
  if (OBJECTS[t]) return [OBJECTS[t]]
  const terms = searchTerms(t)
  if (!terms.length) return []
  const same = (a, b) => a === b || wordForms(a).some(f => wordForms(b).includes(f))
  const whole = OBJECT_LIST.filter(o => namesOf(o).some(n => {
    const w = searchTerms(n)
    return w.length === terms.length && w.every(x => terms.some(y => same(x, y)))
  }))
  if (whole.length) return whole
  return OBJECT_LIST
    .map(o => {
      const words = namesOf(o).flatMap(searchTerms)
      const hits = terms.filter(x => words.some(w => same(x, w))).length
      return { o, hits }
    })
    .filter(x => x.hits === terms.length)
    .map(x => x.o)
}

/**
 * What is wrong with the records, as sentences ([] = nothing). Pages and
 * forms are checked here; with `known` the API's side too:
 *   tools      Map(name -> { readOnly }) of Pepper's staff tools
 *   subjects   the report catalogue's subject keys
 *   tables     every table the catalogue has a decision on
 */
export function registryProblems(known = null) {
  const out = []
  const pages = new Set(NAV_PAGES.map(p => p.path))
  const seen = new Map()
  for (const o of OBJECT_LIST) {
    const at = o.area + ': ' + (o.key || '(no key)')
    if (!KEY.test(o.key || '')) out.push(at + ': the key is lower case words, area.name')
    if (seen.has(o.key)) out.push(at + ': the key is also in ' + seen.get(o.key))
    seen.set(o.key, o.area)
    for (const k of Object.keys(o)) if (!RECORD_FIELDS.includes(k) && k !== 'area') out.push(at + ': unknown field ' + k)
    if (!o.label || !o.plural) out.push(at + ': needs a label and a plural')
    if (!o.table || !/^[a-z_][a-z0-9_]*$/.test(o.table)) out.push(at + ': needs its table')
    for (const k of ['words', 'subjects', 'actions', 'forms']) if (!Array.isArray(o[k])) out.push(at + ': ' + k + ' is a list')
    if (!pages.has(o.page)) out.push(at + ': its page ' + o.page + ' is not a page of the app (shared/nav)')
    if (o.open) {
      if (!pages.has(o.open.page)) out.push(at + ': open names ' + o.open.page + ', not a page of the app')
      const takes = pageAccepts(o.open.page).keys
      for (const k of o.open.with || []) if (!takes.includes(k)) out.push(at + ': ' + o.open.page + ' doesn\'t open at a ' + k)
      if (!Array.isArray(o.open.with) || !o.open.with.length) out.push(at + ': open says what picks one out (with)')
    }
    for (const f of o.forms) if (!FORMS[f]) out.push(at + ': names the form ' + f + ', which isn\'t in shared/forms.js')
    for (const [i, s] of o.subjects.entries()) {
      if (o.subjects.indexOf(s) !== i) out.push(at + ': names the subject ' + s + ' twice')
    }
  }
  // A subject belongs to one object, or is listed as none, never both.
  const owner = new Map()
  for (const o of OBJECT_LIST) {
    for (const s of o.subjects) {
      if (owner.has(s)) out.push('The subject ' + s + ' is in ' + owner.get(s) + ' and ' + o.key)
      owner.set(s, o.key)
      if (NOT_OBJECTS[s]) out.push('The subject ' + s + ' is in ' + o.key + ' and listed as no object (' + NOT_OBJECTS[s].area + ')')
    }
  }
  if (!known) return out

  const tools = known.tools || new Map()
  const subjects = new Set(known.subjects || [])
  const tables = new Set(known.tables || [])
  for (const o of OBJECT_LIST) {
    const at = o.area + ': ' + o.key
    for (const a of o.actions) {
      const t = tools.get(a)
      if (!t) out.push(at + ': names the tool ' + a + ', which Pepper doesn\'t have')
      else if (t.readOnly) out.push(at + ': ' + a + ' only reads; actions are the tools that change it')
    }
    for (const s of o.subjects) if (!subjects.has(s)) out.push(at + ': names the subject ' + s + ', which isn\'t in the report catalogue')
    if (subjects.has(o.key) && o.subjects[0] !== o.key) out.push(at + ': its key is a report subject, so it comes first in its subjects')
    if (!subjects.has(o.key) && o.subjects.includes(o.key)) out.push(at + ': its key isn\'t a report subject')
    if (tables.size && !tables.has(o.table)) out.push(at + ': its table ' + o.table + ' has no decision in the report catalogue (not a table?)')
  }
  for (const s of Object.keys(NOT_OBJECTS)) if (!subjects.has(s)) out.push('notObjects names ' + s + ', which isn\'t in the report catalogue')
  for (const [name, t] of tools) {
    if (t.readOnly) continue
    if (!objectsOfAction(name).length) out.push('The change tool ' + name + ' belongs to no object')
  }
  for (const s of subjects) {
    if (!owner.has(s) && !NOT_OBJECTS[s]) out.push('The report subject ' + s + ' belongs to no object (or list it in notObjects with a reason)')
  }
  return out
}
