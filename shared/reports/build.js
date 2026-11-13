// shared/reports/build.js
//
// The report builder's rules (docs/REPORTS.md 9): what its screen needs to
// know that the definition's own rules (spec.js) don't say.
//
//   pathUses()    what a field, figure or link of the catalogue can be in a
//                 report about a subject: a grouping, a list column, a value
//                 (and how it is added up), a filter
//   dataTree()    everything a person can pick from, as the Data panel shows
//                 it; searchTree() finds in it
//   the edits     addRow(), addColumn(), addValue(), setKind(), setFilter()
//                 and the rest: each gives back a whole definition, checked
//   the words     rowName(), valueName(), filterWords(), filterParts(),
//                 paramWords(): what a shelf or a choice says
//   paramInputs() what a report asks for when it is opened
//
// The engine (api/src/reports/compile.js) has the last word on what runs.
// This file follows its rules so the screen only offers what will run, and
// api/test/reports-build.test.mjs runs everything offered here, for every
// subject, so the two can't drift apart unnoticed.

import { NUMERIC_TYPES, BUCKET_LABELS, WEEKDAYS_LONG, formatValue, formatDate } from './format.js'
import { resolvePath, pathLabel, bucketsFor } from './paths.js'
import { periodName, isYmd } from './period.js'
import {
  normaliseReport, newReport, rowId, rankKey, OPS_BY_TYPE, BUCKET_OPS, OP_LABELS, AGG_LABELS, LIMITS,
} from './spec.js'

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const arr = v => (Array.isArray(v) ? v : [])

// ── What a path can be ───────────────────────────────────────

/**
 * What a path of the catalogue can be in a report about `subjectKey`:
 *
 *   { ok, what: 'field' | 'measure' | 'link', path, label, type,
 *     group     it can be a grouping (a summary's rows, a matrix's columns)
 *     buckets   how a day or a moment can be grouped
 *     column    it can be a column of a list
 *     values    the values it can be: [{ measure } | { agg, field }]
 *     filter    null, 'value' (by what it says) or 'venues' (a link to the
 *               venue: by the venues the report is opened for) }
 *
 * or { ok: false, why } for a path the catalogue doesn't have.
 */
export function pathUses(catalogue, subjectKey, path) {
  const r = resolvePath(catalogue, subjectKey, path)
  if (!r.ok) return { ok: false, why: r.why }
  const out = {
    ok: true, what: r.kind, path, label: pathLabel(catalogue, subjectKey, path),
    type: r.kind === 'link' ? 'id' : r.def.type,
    group: false, buckets: [], column: false, values: [], filter: null,
  }
  const manyAt = r.hops.findIndex(h => h.link.many)

  // Rows there are several of for each of ours: only what adds up, and only
  // straight off the report's own rows. The catalogue says which figures do
  // (`across`: a total or a count, or one total over another).
  if (manyAt !== -1) {
    if (manyAt !== 0 || r.hops.slice(1).some(h => h.link.many)) return out
    if (r.kind === 'measure') {
      if (r.hops.length === 1 && r.def.across === true) out.values.push({ measure: path })
    } else if (r.kind === 'field' && NUMERIC_TYPES.includes(r.def.type) && r.def.adds === true) {
      for (const agg of ['sum', 'min', 'max']) out.values.push({ agg, field: path })
    }
    return out
  }

  if (r.kind === 'link') {
    // A list of rows is a folder of what can be added up, nothing itself.
    if (r.def.many) return out
    out.values.push({ agg: 'count_distinct', field: path })
    if (r.def.to === 'venue') out.filter = 'venues'
    return out
  }

  if (r.kind === 'measure') {
    // Through a link each figure would count once for every one of our rows.
    if (!r.hops.length) out.values.push({ measure: path })
    return out
  }

  // A field of the report's own rows, or of something each row has one of.
  const type = r.def.type
  const numeric = NUMERIC_TYPES.includes(type)
  out.group = true
  out.buckets = bucketsFor(type)
  out.column = true
  if (numeric) {
    // Totals and averages only of the report's own rows: a looked-up row's
    // number would be counted once for each of ours.
    if (!r.hops.length && r.def.adds === true) out.values.push({ agg: 'sum', field: path })
    if (!r.hops.length) out.values.push({ agg: 'avg', field: path })
    out.values.push({ agg: 'min', field: path }, { agg: 'max', field: path })
  } else {
    out.values.push({ agg: 'count_distinct', field: path })
  }
  if (OPS_BY_TYPE[type] && type !== 'time' && type !== 'id') out.filter = 'value'
  return out
}

// ── The Data panel ───────────────────────────────────────────

const usable = n => !!n && (n.uses.group || n.uses.column || n.uses.values.length > 0 || !!n.uses.filter)

/**
 * Everything a report about a subject can use, as the Data panel shows it:
 *
 *   { subject: { key, label, one, about, dated, venue },
 *     figures: [node], fields: [node], folders: [folder] }
 *
 *   node    { path, what, label, full, about, type, pii, trail, uses }
 *           `label` is its own name ("Name"), `full` what a column of it is
 *           headed ("Server"), `trail` the folders it sits in
 *   folder  a link: { key, path, label, about, many, one, to, node,
 *           figures, fields, folders }. `node` is the linked thing itself
 *           (how many different, the venues filter) when it has a use.
 *
 * Things each row has one of are walked `depth` links down. Lists of rows
 * (each check's payments) are offered straight off the subject only, with
 * what adds up.
 */
export function dataTree(catalogue, subjectKey, { depth = 2 } = {}) {
  const root = catalogue?.subjects?.[subjectKey]
  if (!root) return null

  const nodeOf = (path, def, trail) => {
    const uses = pathUses(catalogue, subjectKey, path)
    if (!uses.ok) return null
    return {
      path, what: uses.what, label: def.title || def.label, full: uses.label, about: def.about || '',
      type: uses.type, pii: !!def.pii, trail, uses,
    }
  }

  const contents = (subject, prefix, trail, left, seen) => {
    const figures = Object.entries(subject.measures || {}).map(([k, m]) => nodeOf(prefix + k, m, trail)).filter(usable)
    const fields = Object.entries(subject.fields || {}).map(([k, f]) => nodeOf(prefix + k, f, trail)).filter(usable)
    const folders = []
    if (left > 0) {
      for (const [k, link] of Object.entries(subject.links || {})) {
        const to = catalogue.subjects[link.to]
        if (!to) continue
        const inTrail = [...trail, link.label]
        const base = { key: k, path: prefix + k, label: link.label, about: link.about || to.about || '', one: to.one || '', to: to.key }
        if (link.many) {
          if (prefix) continue
          const inner = contents(to, k + '.', inTrail, 0, seen)
          if (!inner.figures.length && !inner.fields.length) continue
          folders.push({ ...base, many: true, node: null, ...inner })
          continue
        }
        // Not round in a circle (a table's check's table), and not the same
        // thing twice: a line's check's venue is the line's own venue. A link
        // straight to another row of the same kind (the order this one was
        // split from) is offered once, off the report's own rows.
        if (prefix && seen.includes(link.to)) continue
        if (prefix && root.links?.[k] && !root.links[k].many && root.links[k].to === link.to) continue
        const inner = contents(to, prefix + k + '.', inTrail, left - 1, [...seen, link.to])
        const node = nodeOf(prefix + k, link, trail)
        if (!usable(node) && !inner.fields.length && !inner.folders.length) continue
        folders.push({ ...base, many: false, node: usable(node) ? node : null, ...inner })
      }
    }
    return { figures, fields, folders }
  }

  return {
    subject: { key: root.key, label: root.label, one: root.one || '', about: root.about || '', dated: !!root.dated, venue: !!root.venue },
    ...contents(root, '', [], depth, [subjectKey]),
  }
}

/** Every node of a tree in the order the panel shows them: figures, fields, then each folder's. */
export function treeNodes(tree) {
  const out = []
  const walk = part => {
    out.push(...part.figures, ...part.fields)
    for (const f of part.folders) {
      if (f.node) out.push(f.node)
      walk(f)
    }
  }
  if (tree) walk(tree)
  return out
}

/**
 * The nodes that match what was typed: every word must be in the node's
 * name, its folders' names or what it is about. Names that start with the
 * words come first, then names that hold them, then the rest.
 */
export function searchTree(tree, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!tree || !words.length) return []
  const scored = []
  treeNodes(tree).forEach((n, i) => {
    const name = (n.label + ' ' + n.full).toLowerCase()
    const all = (name + ' ' + n.trail.join(' ') + ' ' + n.about).toLowerCase()
    if (!words.every(w => all.includes(w))) return
    const rank = name.startsWith(words[0]) ? 0 : words.every(w => name.includes(w)) ? 1 : 2
    scored.push({ n, rank, i })
  })
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).map(x => x.n)
}

// ── Words ────────────────────────────────────────────────────

/** What a grouping or a list column is headed. */
export function rowName(catalogue, subjectKey, r) {
  return r?.label || pathLabel(catalogue, subjectKey, r?.field, r?.bucket)
}

/**
 * How a field is reached, in words, for "how this is linked": the report's
 * subject, then each link on the way (["Dishes sold", "Check", "Server"]).
 * Empty for a field of the report's own rows.
 */
export function linkTrail(catalogue, subjectKey, path) {
  const r = resolvePath(catalogue, subjectKey, path)
  if (!r.ok) return []
  const links = [...r.hops.map(h => h.link.label), ...(r.kind === 'link' ? [r.def.label] : [])]
  return links.length ? [catalogue.subjects[subjectKey].label, ...links] : []
}

/** What a value is headed when it has no name of its own (as the engine names it). */
export function valueName(catalogue, subjectKey, v) {
  if (!v) return ''
  if (v.label) return v.label
  if (v.measure) return pathLabel(catalogue, subjectKey, v.measure)
  if (v.calc) return 'Calculation'
  if (v.of) return AGG_LABELS[v.agg] || ''
  if (v.agg === 'count' && !v.field) return catalogue?.subjects?.[subjectKey]?.label || 'Rows'
  const label = pathLabel(catalogue, subjectKey, v.field)
  if (v.agg === 'count') return label + ' (how many)'
  if (v.agg === 'count_distinct') return label + ' (how many different)'
  return AGG_LABELS[v.agg] + ' ' + lowerFirst(label)
}

/** What a value is, in a few words, for its row on the Values shelf. */
export function valueKindText(v) {
  if (!v) return ''
  if (v.measure) return 'Figure'
  if (v.calc) return 'Calculation'
  if (v.of) return AGG_LABELS[v.agg] + ' of a calculation'
  if (v.agg === 'count' && !v.field) return 'How many rows'
  return v.agg === 'count' ? 'How many' : AGG_LABELS[v.agg]
}

// ── Filters ──────────────────────────────────────────────────

/** How many values a way of filtering takes: 'none' | 'one' | 'two' | 'many' | 'period'. */
export function filterShape(op) {
  if (op === 'empty' || op === 'not_empty') return 'none'
  if (op === 'in' || op === 'not_in') return 'many'
  if (op === 'between') return 'two'
  if (op === 'in_period') return 'period'
  return 'one'
}

/** The ways a field of this type can be filtered, the usual one first. */
export function filterOps(type, bucket = null) {
  if (bucket && bucket !== 'day') {
    // A day of the week or an hour is picked from a list; a week or a month is a day.
    if (bucket === 'weekday') return ['in', 'not_in']
    return [...BUCKET_OPS.filter(op => op !== 'in' && op !== 'not_in'), 'empty', 'not_empty']
  }
  const ops = OPS_BY_TYPE[type] || []
  const first = { text: 'in', choice: 'in', number: 'gte', money: 'gte', percent: 'gte', duration: 'gte', date: 'in_period', moment: 'in_period', yesno: 'is' }[type]
  return first && ops.includes(first) ? [first, ...ops.filter(op => op !== first)] : ops
}

/** What a filter's value is typed as: 'text' | 'choice' | 'number' | 'yesno' | 'day' | 'weekday' | 'hour' | 'period'. */
export function filterValueKind(type, bucket, op) {
  if (op === 'in_period') return 'period'
  if (bucket === 'weekday') return 'weekday'
  if (bucket === 'hour') return 'hour'
  if (bucket && bucket !== 'day') return 'day'
  if (type === 'date' || type === 'moment') return 'day'
  if (NUMERIC_TYPES.includes(type)) return 'number'
  if (type === 'choice' || type === 'yesno') return type
  return 'text'
}

/**
 * A number as people type it: a percentage as per cent (0.2 is typed 20),
 * a duration in minutes (90 seconds is 1.5), anything else as it is.
 */
export function shownNumber(type, stored) {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return null
  const v = type === 'percent' ? stored * 100 : type === 'duration' ? stored / 60 : stored
  return Math.round(v * 1e6) / 1e6
}

/** The other way: what was typed, as the report keeps it. null for something that isn't a number. */
export function storedNumber(type, typed) {
  const text = String(typed ?? '').trim().replace(/,/g, '')
  if (!text || !/^-?\d*\.?\d+$/.test(text)) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  const v = type === 'percent' ? n / 100 : type === 'duration' ? n * 60 : n
  return Math.round(v * 1e8) / 1e8
}

function oneValueOk(kind, v) {
  if (kind === 'number') return typeof v === 'number' && Number.isFinite(v)
  if (kind === 'weekday') return Number.isInteger(v) && v >= 1 && v <= 7
  if (kind === 'hour') return Number.isInteger(v) && v >= 0 && v <= 23
  if (kind === 'day') return isYmd(v)
  if (kind === 'yesno') return v === true || v === false
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Nothing picked for a filter: no value, no ticks, or both ends of a range
 * left empty. For a filter that asks each time this means "everything", so
 * something typed that isn't a value (NaN from a number box) is not blank.
 */
export const blankValue = v => v == null || v === '' || (Array.isArray(v) && v.every(x => x == null || x === ''))

/** Whether a filter has what its way of filtering needs (the screen's Apply button). */
export function filterValueOk(type, bucket, op, value) {
  const shape = filterShape(op)
  if (shape === 'none') return true
  if (shape === 'period') return !!periodName(value)
  const kind = filterValueKind(type, bucket, op)
  if (shape === 'many') return Array.isArray(value) && value.length > 0 && value.length <= LIMITS.in_values && value.every(v => oneValueOk(kind, v))
  if (shape === 'two') return Array.isArray(value) && value.length === 2 && value.every(v => oneValueOk(kind, v))
  return oneValueOk(kind, value)
}

function valueWords(def, bucket, op, v, ctx) {
  const kind = filterValueKind(def.type, bucket, op)
  if (kind === 'period') return periodName(v)
  if (kind === 'weekday') return WEEKDAYS_LONG[Number(v) - 1] || String(v)
  if (kind === 'hour') return String(Number(v)).padStart(2, '0') + ':00'
  if (kind === 'day') return formatDate(v, bucket && bucket !== 'day' ? bucket : 'day')
  if (kind === 'yesno') return v === true || v === 'true' || v === 'yes' || v === 1 ? 'yes' : 'no'
  return formatValue(v, def, { currency: ctx.currency })
}

const listWords = (list, max = 4) => (list.length <= max ? list.join(', ') : list.slice(0, max).join(', ') + ' and ' + (list.length - max) + ' more')

/**
 * A filter as its two parts: what is filtered and what it has to be.
 *
 *   { label: 'Status', rest: 'is one of Closed, Void', sep: ' ' }
 *   { label: 'Paid in full', rest: 'yes', sep: ': ' }
 *
 * ctx: { params (the report's), venues ([{ id, name }]), currency }. A
 * filter that asks each time says the value it starts with. `any`, `all`
 * and `has` filters are one sentence with no label of their own.
 */
export function filterParts(catalogue, subjectKey, f, ctx = {}) {
  if (!f) return { label: '', rest: '', sep: '' }
  if (f.any || f.all) {
    const inner = (f.any || f.all).map(x => filterWords(catalogue, subjectKey, x, ctx)).filter(Boolean)
    return { label: '', rest: (f.any ? 'Any of: ' : 'All of: ') + inner.join(f.any ? '; or ' : '; and '), sep: '' }
  }
  if (f.has) {
    const r = resolvePath(catalogue, subjectKey, f.has)
    const what = r.ok ? lowerFirst(r.def.label) : f.has
    const inner = r.ok ? arr(f.where).map(x => filterWords(catalogue, r.def.to, x, ctx)).filter(Boolean) : []
    return { label: '', rest: (f.not ? 'Has no ' : 'Has ') + what + (inner.length ? ' where ' + inner.join(' and ') : ''), sep: '' }
  }
  const label = pathLabel(catalogue, subjectKey, f.field, f.bucket)
  const r = resolvePath(catalogue, subjectKey, f.field)
  const param = f.param ? arr(ctx.params).find(p => p.key === f.param) : null
  const value = f.param ? param?.default : f.value
  const part = (rest, sep = ' ') => ({ label, rest, sep })

  // The venues the report is opened for.
  if (r.ok && r.kind === 'link') {
    if (param?.type === 'venues' || r.def.to === 'venue') {
      if (!Array.isArray(value) || !value.length) return part('every venue', ': ')
      const names = value.map(id => arr(ctx.venues).find(v => v.id === id)?.name).filter(Boolean)
      return part(names.length ? listWords(names, 3) : value.length + (value.length === 1 ? ' venue' : ' venues'), ': ')
    }
    const n = Array.isArray(value) ? value.length : value == null ? 0 : 1
    if (filterShape(f.op) === 'none') return part(OP_LABELS[f.op])
    return part(OP_LABELS[f.op] + ' ' + n + ' chosen')
  }

  const def = r.ok && r.kind === 'field' ? r.def : { type: 'text' }
  const shape = filterShape(f.op)
  if (shape === 'none') return part(OP_LABELS[f.op])
  // Asked each time with nothing to start from: every row until something is picked.
  const blank = value == null || value === '' || (Array.isArray(value) && !value.length)
  if (f.param && blank) return part('anything', ': ')
  let op = f.op
  let v = value
  // A list given where one value is asked for reads as the list it is.
  if (Array.isArray(v) && shape === 'one') op = op === 'is_not' ? 'not_in' : 'in'
  if (!Array.isArray(v) && (op === 'in' || op === 'not_in')) v = [v]
  const words = x => valueWords(def, f.bucket, op, x, ctx)
  if (def.type === 'yesno') return part(words(v), ': ')
  if (op === 'in' || op === 'not_in') {
    if (v.length === 1) return part(OP_LABELS[op === 'in' ? 'is' : 'is_not'] + ' ' + words(v[0]))
    return part(OP_LABELS[op] + ' ' + listWords(v.map(words)))
  }
  if (op === 'between') return part(OP_LABELS.between + ' ' + words(arr(v)[0]) + ' and ' + words(arr(v)[1]))
  return part(OP_LABELS[op] + ' ' + words(v))
}

/**
 * A filter as a sentence: "Status is one of Closed, Void", "Net is at least
 * £20.00", "Trading day is in Last week", "Has payments where Tender is
 * Cash".
 */
export function filterWords(catalogue, subjectKey, f, ctx = {}) {
  const p = filterParts(catalogue, subjectKey, f, ctx)
  return p.label + p.sep + p.rest
}

// Every plain condition of a report's filters, with the subject its field
// is a path from: conditions inside "has" are about the linked rows.
const walkFilters = (filters, fn, catalogue = null, subjectKey = null) => {
  for (const f of arr(filters)) {
    if (f.any || f.all) walkFilters(f.any || f.all, fn, catalogue, subjectKey)
    else if (f.has) {
      const r = catalogue ? resolvePath(catalogue, subjectKey, f.has) : null
      walkFilters(f.where, fn, catalogue, r?.ok && r.kind === 'link' ? r.def.to : null)
    } else fn(f, subjectKey)
  }
}

/** The keys of the parameters a report's filters ask for. */
export function usedParams(spec) {
  const out = new Set()
  walkFilters(spec?.filters, f => { if (f.param) out.add(f.param) })
  return out
}

/**
 * What a report asks for when it is opened: each parameter with the filter
 * that uses it and the field it filters, so the right input can be shown.
 *
 *   [{ key, type, label, named (the report gave it a name of its own),
 *      default, op, bucket, path, subject (the subject
 *      `path` is a path from: the linked rows' for a filter inside "has"),
 *      field: { type, labels, label } | null, kind (filterValueKind),
 *      shape (filterShape) }]
 */
export function paramInputs(catalogue, spec) {
  const out = []
  for (const p of arr(spec?.params)) {
    let cond = null, from = spec.subject
    walkFilters(spec.filters, (f, subject) => { if (!cond && f.param === p.key) { cond = f; from = subject } }, catalogue, spec.subject)
    if (!cond) continue
    const r = from ? resolvePath(catalogue, from, cond.field) : { ok: false }
    const def = r.ok && r.kind === 'field' ? r.def : null
    const label = p.label || (from ? pathLabel(catalogue, from, cond.field, cond.bucket) : cond.field)
    out.push({
      key: p.key, type: p.type, label, named: !!p.label, default: p.default,
      op: cond.op, bucket: cond.bucket || null, path: cond.field, subject: from,
      field: def ? { type: def.type, labels: def.labels || null, label: def.label } : null,
      kind: p.type === 'period' ? 'period' : p.type === 'venues' ? 'venues' : filterValueKind(def?.type || 'text', cond.bucket, cond.op),
      shape: p.type === 'period' ? 'period' : p.type === 'venues' ? 'many' : filterShape(cond.op),
    })
  }
  return out
}

/**
 * What one of a report's choices is set to, in words: "is one of Closed,
 * Void", "is at least £20.00", "anything". `input` is one of paramInputs()'s.
 */
export function paramWords(catalogue, input, value, ctx = {}) {
  if (!input?.subject) return ''
  const cond = { field: input.path, ...(input.bucket ? { bucket: input.bucket } : {}), op: input.op, param: input.key }
  return filterParts(catalogue, input.subject, cond, { ...ctx, params: [{ key: input.key, type: input.type, default: value }] }).rest
}

/** A parameter key for a filter on a path that the report doesn't use yet. */
export function paramKeyFor(spec, path, { op = null, bucket = null, venues = false } = {}) {
  let base = venues ? 'venues' : op === 'in_period' && path === 'date' ? 'period'
    : (String(path || '').toLowerCase() + (bucket && bucket !== 'day' ? '_' + bucket : '')).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z]/.test(base)) base = 'p_' + base
  base = base.slice(0, 26)
  const taken = new Set(arr(spec?.params).map(p => p.key))
  let key = base, n = 2
  while (taken.has(key)) key = base + '_' + n++
  return key
}

// ── The edits ────────────────────────────────────────────────

const refOf = ref => (typeof ref === 'string' ? { field: ref } : { ...ref })
const move = (list, from, to) => {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}
const prune = spec => {
  const used = usedParams(spec)
  return { ...spec, params: spec.params.filter(p => used.has(p.key)) }
}

/** How many more of each part a report takes. */
export function roomLeft(spec) {
  return {
    rows: (spec.kind === 'list' ? LIMITS.list_columns : LIMITS.rows) - spec.rows.length,
    columns: LIMITS.columns - spec.columns.length,
    values: LIMITS.values - spec.values.length,
    filters: LIMITS.filters - spec.filters.length,
    params: LIMITS.params - spec.params.length,
  }
}

/**
 * A grouping added to a summary's rows (taken out of its columns when it
 * was there), or a column added to a list.
 */
export function addRow(spec, ref) {
  const r = refOf(ref)
  if (spec.kind === 'list') delete r.bucket
  const id = rowId(r)
  if (spec.rows.some(x => rowId(x) === id) || roomLeft(spec).rows <= 0) return spec
  return normaliseReport({ ...spec, rows: [...spec.rows, r], columns: spec.columns.filter(x => rowId(x) !== id) })
}

/** A grouping across the top: the report becomes a table across (a matrix). */
export function addColumn(spec, ref) {
  if (spec.kind === 'list') return spec
  const r = refOf(ref)
  const id = rowId(r)
  if (spec.columns.some(x => rowId(x) === id) || roomLeft(spec).columns <= 0) return spec
  return normaliseReport({ ...spec, kind: 'matrix', columns: [...spec.columns, r], rows: spec.rows.filter(x => rowId(x) !== id) })
}

export const removeRow = (spec, id) => normaliseReport({ ...spec, rows: spec.rows.filter(x => rowId(x) !== id) })
export const removeColumn = (spec, id) => normaliseReport({ ...spec, columns: spec.columns.filter(x => rowId(x) !== id) })
const moved = (spec, part, from, to) => {
  const next = move(spec[part], from, to)
  return next === spec[part] ? spec : normaliseReport({ ...spec, [part]: next })
}
export const moveRow = (spec, from, to) => moved(spec, 'rows', from, to)
export const moveColumn = (spec, from, to) => moved(spec, 'columns', from, to)

/**
 * A grouping changed in place: how its days are grouped (`bucket`), its
 * name (`label`, empty for its own). What is sorted or subtotalled by it
 * follows the change. `where` is 'rows' or 'columns'.
 */
export function updateRow(spec, where, id, patch) {
  const list = spec[where] || []
  const i = list.findIndex(x => rowId(x) === id)
  if (i === -1) return spec
  const next = { ...list[i] }
  if ('bucket' in patch) { if (patch.bucket && patch.bucket !== 'day') next.bucket = patch.bucket; else delete next.bucket }
  if ('label' in patch) { if (patch.label) next.label = patch.label; else delete next.label }
  const nextId = rowId(next)
  if (nextId !== id && [...spec.rows, ...spec.columns].some(x => rowId(x) === nextId)) return spec
  const renamed = x => (x === id ? nextId : x)
  return normaliseReport({
    ...spec,
    [where]: list.map((x, n) => (n === i ? next : x)),
    sort: spec.sort.map(s => ({ ...s, by: renamed(s.by) })),
    totals: { ...spec.totals, subtotals: spec.totals.subtotals.map(renamed) },
    ...(spec.view?.x === id ? { view: { ...spec.view, x: nextId } } : {}),
  })
}

const sameValue = (a, b) => (a.measure || '') === (b.measure || '') && (a.agg || '') === (b.agg || '')
  && (a.field || '') === (b.field || '') && (a.calc || '') === (b.calc || '') && (a.of || '') === (b.of || '')

/** A value added to a summary. The same figure twice is only added once. */
export function addValue(spec, value) {
  if (spec.kind === 'list' || roomLeft(spec).values <= 0) return spec
  if (!value.calc && !value.of && spec.values.some(v => sameValue(v, value))) return spec
  return normaliseReport({ ...spec, values: [...spec.values, value] })
}

/** A value changed in place; it keeps its key, so calculations that read it still do. */
export function updateValue(spec, key, patch) {
  return normaliseReport({
    ...spec,
    values: spec.values.map(v => {
      if (v.key !== key) return v
      const next = { ...v, ...patch }
      for (const k of ['label', 'format', 'decimals', 'hidden']) if (next[k] == null || next[k] === '' || next[k] === false) delete next[k]
      return next
    }),
  })
}

export const removeValue = (spec, key) => normaliseReport({ ...spec, values: spec.values.filter(v => v.key !== key) })
export const moveValue = (spec, from, to) => moved(spec, 'values', from, to)

/** The values of a report that read a value's key in a calculation (they stop working without it). */
export function valueReaders(spec, key) {
  const name = new RegExp('(^|[^a-z0-9_])' + key + '($|[^a-z0-9_])', 'i')
  return spec.values.filter(v => v.key !== key && v.calc && name.test(v.calc))
}

/**
 * A filter added. `ask: true` lets whoever opens the report change it: the
 * value becomes the starting value of a parameter. `label` names what is
 * asked for.
 */
export function addFilter(spec, cond, { ask = false, label = '', venues = false } = {}) {
  if (roomLeft(spec).filters <= 0) return spec
  return setFilter(spec, spec.filters.length, cond, { ask, label, venues })
}

/** The filter at `index` (top level) replaced, or one added at the end. */
export function setFilter(spec, index, cond, { ask = false, label = '', venues = false } = {}) {
  const old = spec.filters[index]
  let params = spec.params
  let next
  if (ask) {
    // The same parameter again when the filter already asked; a new one otherwise.
    const type = venues ? 'venues' : cond.op === 'in_period' ? 'period' : 'value'
    const kept = old?.param && params.some(p => p.key === old.param && p.type === type) ? old.param : null
    if (!kept && roomLeft(spec).params <= 0) return spec
    const key = kept || paramKeyFor(spec, cond.field, { op: cond.op, bucket: cond.bucket, venues })
    const entry = { key, type, ...(label ? { label } : {}), default: cond.value ?? (venues ? 'all' : null) }
    params = kept ? params.map(p => (p.key === key ? entry : p)) : [...params, entry]
    next = { field: cond.field, ...(cond.bucket ? { bucket: cond.bucket } : {}), op: cond.op, param: key }
  } else {
    next = { field: cond.field, ...(cond.bucket ? { bucket: cond.bucket } : {}), op: cond.op, ...('value' in cond ? { value: cond.value } : {}) }
  }
  const filters = index >= spec.filters.length ? [...spec.filters, next] : spec.filters.map((f, i) => (i === index ? next : f))
  return normaliseReport(prune({ ...spec, params, filters }))
}

/** The filter at `index` (top level) taken off, with a parameter nothing asks for any more. */
export const removeFilter = (spec, index) => normaliseReport(prune({ ...spec, filters: spec.filters.filter((_, i) => i !== index) }))

/** What a parameter starts as: the report's usual period, venues or value. */
export function setParamDefault(spec, key, value) {
  return normaliseReport({ ...spec, params: spec.params.map(p => (p.key === key ? { ...p, default: value } : p)) })
}

/** What the report is sorted by: [{ by: a value's key or a grouping's id (a list: a field), dir }]. */
export const setSort = (spec, sort) => normaliseReport({ ...spec, sort })

/**
 * Only the top or bottom N, ranked by a value: { which: 'top' | 'bottom',
 * n, by (a value's key), rest (what the others are called, or '') }, or null
 * for every row. The rows shown come in the ranking's order.
 */
export function setLimit(spec, limit) {
  if (!limit) return normaliseReport({ ...spec, limit: null })
  const which = limit.which === 'bottom' ? 'bottom' : 'top'
  const by = spec.values.some(v => v.key === limit.by && !v.hidden) ? limit.by : rankKey(spec)
  const sort = by ? [{ by, dir: which === 'top' ? 'desc' : 'asc' }, ...spec.sort.filter(s => s.by !== by && !spec.values.some(v => v.key === s.by))] : spec.sort
  return normaliseReport({ ...spec, sort, limit: { [which]: limit.n, ...(limit.rest ? { rest_as: limit.rest } : {}) } })
}

/** A report's top or bottom N as setLimit() takes it, or null. */
export function limitOf(spec) {
  if (!spec.limit) return null
  const which = spec.limit.top ? 'top' : 'bottom'
  return { which, n: spec.limit[which], by: rankKey(spec), rest: spec.limit.rest_as || '' }
}

export const setTotals = (spec, totals) => normaliseReport({ ...spec, totals: { ...spec.totals, ...totals } })
export const setCompare = (spec, withWhat) => normaliseReport({ ...spec, compare: withWhat ? { with: withWhat } : null })

/**
 * Why a report can't be compared with an earlier period, as a sentence, or
 * null when it can: only a summary, and only one whose filters say which
 * period it is about.
 */
export function compareProblem(catalogue, spec) {
  if (spec.kind === 'list') return 'A list can\'t be compared with an earlier period: make it a summary'
  if (spec.kind === 'matrix') return 'A table across can\'t be compared with an earlier period: take its columns off first'
  const has = spec.filters.some(f => f.field === 'date' && !f.bucket && f.op === 'in_period')
  if (has) return null
  const label = catalogue?.subjects?.[spec.subject]?.fields?.date?.label
  if (!label) return catalogue?.subjects?.[spec.subject]?.label + ' have no day of their own to compare by'
  return 'Comparing needs the report\'s period: add the filter "' + label + ' is in ..."'
}

/**
 * A summary turned into a list or the other way round. The filters and what
 * the report asks for stay; the rest starts from what the other kind shows:
 *
 *   to a list     the subject's usual columns, then what the summary was
 *                 grouped by
 *   to a summary  the list's own totals: how many rows there are and each
 *                 number column added up, with nothing to group by yet
 *
 * A summary and a table across are the same thing here: 'summary' takes the
 * columns off a table across. (The builder keeps what each kind had, so
 * switching back gives it back: this is where a kind starts the first time.)
 */
export function setKind(spec, kind, catalogue) {
  const from = spec.kind === 'list' ? 'list' : 'summary'
  const to = kind === 'list' ? 'list' : 'summary'
  if (from === to) {
    if (kind === 'summary' && spec.kind === 'matrix') return normaliseReport({ ...spec, kind: 'summary', columns: [] })
    return spec
  }
  const subject = catalogue?.subjects?.[spec.subject]
  if (to === 'list') {
    const seen = new Set()
    const rows = []
    for (const r of [...arr(subject?.list).map(field => ({ field })), ...spec.rows, ...spec.columns]) {
      if (seen.has(r.field) || !pathUses(catalogue, spec.subject, r.field).column) continue
      seen.add(r.field)
      rows.push({ field: r.field })
    }
    return normaliseReport({
      ...spec, kind: 'list', rows: rows.slice(0, LIMITS.list_columns), columns: [], values: [], sort: [], limit: null, compare: null,
      totals: { grand: spec.totals.grand, subtotals: [] }, view: { kind: 'table' },
    })
  }
  const values = [{ agg: 'count' }]
  for (const r of spec.rows) {
    const sum = pathUses(catalogue, spec.subject, r.field).values?.find(v => v.agg === 'sum')
    if (sum) values.push({ ...sum, ...(r.label ? { label: r.label } : {}) })
  }
  return normaliseReport({ ...spec, kind: 'summary', rows: [], columns: [], values: values.slice(0, LIMITS.values), sort: [] })
}

/**
 * A new report about a subject, with something to show straight away: its
 * first figure by day when its rows have a day, a list of its usual columns
 * when they don't. The usual period and venues are asked for as newReport()
 * sets them up.
 */
export function startReport(catalogue, subjectKey) {
  const s = catalogue?.subjects?.[subjectKey]
  if (!s) return newReport(subjectKey)
  const base = newReport(subjectKey, { dated: !!s.dated, venue: !!s.venue })
  const first = Object.keys(s.measures || {})[0]
  if (s.dated && first) return normaliseReport({ ...base, kind: 'summary', rows: [{ field: 'date' }], values: [{ measure: first }] })
  const usual = arr(s.list).map(field => ({ field }))
  if (usual.length) return normaliseReport({ ...base, kind: 'list', rows: usual })
  return first ? normaliseReport({ ...base, values: [{ measure: first }] }) : base
}

/** What a report can be sorted by: [{ by, label }], its groupings then its values (a list: its columns). */
export function sortChoices(catalogue, spec) {
  if (spec.kind === 'list') return spec.rows.map(r => ({ by: r.field, label: rowName(catalogue, spec.subject, r) }))
  return [
    ...spec.rows.map(r => ({ by: rowId(r), label: rowName(catalogue, spec.subject, r) })),
    ...spec.values.map(v => ({ by: v.key, label: valueName(catalogue, spec.subject, v) })),
  ]
}

export { BUCKET_LABELS }
