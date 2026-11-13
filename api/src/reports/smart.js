// src/reports/smart.js
//
// The smart builder (docs/REPORTS.md 10): a report from a few words ("net
// sales by dish last month at Ware, the top 20"), or from a photo or PDF of
// a report the person already has. They see the report with real data, what
// it shows in words, what was assumed and what couldn't be done, and save
// it, change it, or open it in the builder.
//
// How it is made:
//   1. A word index over the catalogue, as the person's role sees it, ranks
//      the subjects; the best few are listed in full and every other one in
//      a line (the slice). A subject is an S ref, each figure, field and link
//      of a listed subject an F ref: the model never sees a table or column
//      name, and never writes one.
//   2. One structured call (askForJson, the main model) answers with refs.
//   3. The answer becomes a definition only through the builder's own edits
//      (shared/reports/build.js), so it can only be what the builder could
//      have made. Venue names are found among the group's venues, names in
//      the data (a dish, a server) among the report's own rows.
//   4. The definition is checked and run as the person. When it can't be
//      used the model is asked once more with the reasons; when it picked a
//      subject listed in a line only, once more with that subject in full.
//      Two calls at most.
//   5. What the report shows is said by describeReport()
//      (shared/reports/describe.js) from the definition, never by the model.
//
// The model never sees a row of data, and can't save, schedule or send
// anything: the person does that, on the page.
//
//   smartBuild(person, { request, previous, files, venues, today })
//     person    reportPerson(req)
//     previous  { spec, requests, name }: a report built before, to change
//               (its name goes with it, so Pepper keeps it unless the change
//               makes it wrong)
//     files     checked files [{ media_type, data }]
//     venues    the group's venues [{ id, name }]
//     today     YYYY-MM-DD at the venues
//   -> { spec, name, about, assumed, couldnt, questions, result, problem }
//      questions: [{ question, choices: [{ label, change? }] }]; a choice
//      with a change is applied to the report as it is then (applyChange()
//      in shared/reports/choices.js, so answers to two questions add up);
//      one without is sent back as a change in words ("<question> <choice>")
//
//   rankSubjects(), buildSlice(), toSpec(), answerOf(), matchNames():
//   the parts, exported for the tests.

import { catalogueView } from './catalogue/index.js'
import { runReport } from './run.js'
import { ReportError } from './compile.js'
import { checkedSpec } from './access.js'
import { askForJson, fileBlocks, obj, str, bool, arr, oneOf, clip } from '../services/aiJson.js'
import {
  dataTree, treeNodes, pathUses, addRow, addColumn, addValue, addFilter, setParamDefault,
  setSort, setLimit, setCompare, compareProblem, setView, filterOps, filterValueKind, filterShape,
  filterValueOk, storedNumber, shownNumber, valueName, usedParams,
} from '../../../shared/reports/build.js'
import {
  normaliseReport, newReport, reportProblems, rowId, AGGS, AGG_LABELS, VALUE_FORMATS, VIEW_KINDS,
  VIEW_LABELS, COMPARE_WITH, FILTER_OPS, LIMITS,
} from '../../../shared/reports/spec.js'
import { RELATIVE_PERIODS, normalisePeriod, isYmd, dayText } from '../../../shared/reports/period.js'
import { resolvePath, pathLabel } from '../../../shared/reports/paths.js'
import { MOMENT_BUCKETS, WEEKDAYS_LONG } from '../../../shared/reports/format.js'
import { applyChange } from '../../../shared/reports/choices.js'
import { chartChoices } from '../../../shared/reports/chart.js'
import { describeReport } from '../../../shared/reports/describe.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

const DETAIL_BUDGET = 420    // nodes listed in full: about 7,000 tokens
const DETAIL_MIN = 3
const DETAIL_MAX = 8
const PREVIEW_ROWS = 200
const LOOKUPS = 3            // names looked up in the data, per build
const LOOKUP_ROWS = 500
const QUESTIONS = 3
const NOTES = 6

const list = v => (Array.isArray(v) ? v : [])
const text = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || '')

// ── The word index ───────────────────────────────────────────

const STOP = new Set((
  'a an the of for to in on at by and or with without from per each every all any my our me i we you your us '
  + 'is are was were be been being do does did can could would should will shall may might must '
  + 'what which who whom how when where why show shows showing give gives list make see want need needs please like '
  + 'report reports it its this that these those than then also just about into out over up down there here '
  + 'today yesterday tomorrow last next ago since so far get got let lets us one ones'
).split(' '))

/** A word's root for the index: plurals and "-es" endings off. */
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** The words of a text that say what it is about, as roots. */
export const indexWords = t => String(t || '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/)
  .filter(w => w && !STOP.has(w)).map(stem)

// Other words people use for what the catalogue calls something else (roots).
const SYNONYMS = {
  revenue: ['sale', 'taking'], turnover: ['sale', 'taking'], income: ['sale', 'taking'], money: ['sale', 'taking'],
  sell: ['sale', 'sold'], selling: ['sale', 'sold'], sold: ['sale'], seller: ['sold', 'dish'],
  dish: ['item', 'product'], item: ['dish'], product: ['dish'], food: ['dish'], drink: ['dish'], meal: ['dish', 'deal'],
  waiter: ['server', 'staff'], waitress: ['server', 'staff'], server: ['staff'], staff: ['server', 'taken'],
  employee: ['staff', 'server'], cashier: ['server', 'staff'],
  guest: ['cover', 'customer'], cover: ['guest'], customer: ['guest'], diner: ['guest', 'cover'], people: ['guest', 'cover'],
  reservation: ['booking'], book: ['booking'], booked: ['booking'], noshow: ['show'],
  tip: ['gratuity'], gratuity: ['tip'],
  comp: ['discount'], voucher: ['discount'], offer: ['promotion', 'discount'], promo: ['promotion'],
  cancellation: ['cancel', 'cancelled'], cancel: ['cancelled'], cancelled: ['cancel'],
  tender: ['payment'], card: ['payment', 'tender'], cash: ['payment', 'tender'], paid: ['payment'],
  tax: ['vat'],
  online: ['order', 'web'], delivery: ['online', 'order'], website: ['online', 'web'], gloriafood: ['online'],
  category: ['section'], bill: ['check'], tab: ['check'], ticket: ['check'], receipt: ['check'],
  service: ['charge'], z: ['day', 'trading'], shift: ['day', 'trading'], spend: ['average'],
}

// BM25: how fast a word's repeats stop counting, and how much a subject with
// many fields counts each one for less (low: a subject isn't less about a word
// because it has more fields).
const K1 = 1.2
const B = 0.3

const docCache = new WeakMap()

// One document per subject the person can report on: words in its name
// count most, the names of its figures, fields and links next, what they
// are about and what each row belongs to least.
function subjectDocs(catalogue) {
  if (docCache.has(catalogue)) return docCache.get(catalogue)
  const docs = []
  for (const s of Object.values(catalogue.subjects)) {
    if (!s.base) continue
    const tf = new Map()
    let len = 0
    const add = (t, w) => { for (const x of indexWords(t)) { tf.set(x, (tf.get(x) || 0) + w); len += w } }
    add(s.label, 3); add(s.one, 3)
    add(list(catalogue.areas).find(a => a.key === s.area)?.label, 3)
    add(s.about, 1)
    for (const m of Object.values(s.measures)) { add(m.label, 2); add(m.about, 1) }
    for (const f of Object.values(s.fields)) {
      add(f.title || f.label, 2); add(f.about, 1)
      if (f.labels) add(Object.values(f.labels).join(' '), 1)
    }
    for (const l of Object.values(s.links)) {
      add(l.label, 2)
      const to = catalogue.subjects[l.to]
      if (!to) continue
      add(to.label, 1)
      for (const f of Object.values(to.fields)) add(f.title || f.label, 1)
      if (l.many) for (const m of Object.values(to.measures)) add(m.label, 1)
    }
    docs.push({ key: s.key, tf, len, figures: Object.keys(s.measures).length })
  }
  docCache.set(catalogue, docs)
  return docs
}

/**
 * The subjects a person can report on, the best fit for the request first
 * ([{ key, score }]): BM25 over each subject's words, a word and the other
 * words people use for it counting once. `pinned` (a subject's key) comes
 * first whatever the words say. Ties go to the subject with more figures.
 */
export function rankSubjects(catalogue, request, pinned = null) {
  const docs = subjectDocs(catalogue)
  const n = docs.length || 1
  const avg = docs.reduce((sum, d) => sum + d.len, 0) / n || 1
  const df = new Map()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1)
  const idf = t => Math.log(1 + (n - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5))
  const groups = [...new Set(indexWords(request))].map(t => [t, ...(SYNONYMS[t] || [])])
  return docs.map((d, i) => {
    let score = 0
    for (const g of groups) {
      let best = 0
      for (const t of g) {
        const f = d.tf.get(t)
        if (f) best = Math.max(best, idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / avg)))
      }
      score += best
    }
    return { key: d.key, score: d.key === pinned ? Infinity : score, figures: d.figures, i }
  }).sort((a, b) => b.score - a.score || b.figures - a.figures || a.i - b.i)
    .map(({ key, score }) => ({ key, score }))
}

// ── The slice: what the model is shown ───────────────────────

const AGG_WORDS = { sum: 'sum', avg: 'avg', min: 'min', max: 'max', count_distinct: 'count-different' }

function usesText(u) {
  const out = []
  if (u.values.some(v => v.measure)) out.push('figure')
  if (u.group) out.push(u.buckets.length ? 'group (' + u.buckets.join('/') + ')' : 'group')
  if (u.filter === 'value') out.push('filter')
  if (u.filter === 'venues') out.push('venues')
  const aggs = u.values.filter(v => v.agg).map(v => AGG_WORDS[v.agg]).filter(Boolean)
  if (aggs.length) out.push(aggs.join('/'))
  return out.join(', ')
}

function typeText(catalogue, subjectKey, n) {
  if (n.what === 'link') return 'a thing'
  if (n.type === 'yesno') return 'yes/no'
  if (n.type === 'choice') {
    const r = resolvePath(catalogue, subjectKey, n.path)
    const labels = r.ok && r.def.labels ? Object.values(r.def.labels) : []
    return labels.length ? 'choice: ' + labels.slice(0, 10).join(', ') : 'choice'
  }
  return n.type
}

/**
 * The subjects shown to the model for a request: the best few listed in
 * full (their figures, fields and what each row belongs to), the rest in a
 * line each. Returns { text, detailed: [key], s: Map(ref -> key),
 * sRefOf: Map(key -> ref), f: Map(ref -> { subject, path, node }),
 * fRefOf: Map('key|path' -> ref) }.
 */
export function buildSlice(catalogue, request, pinned = null) {
  const ranked = rankSubjects(catalogue, request, pinned)
  const trees = new Map()
  const treeOf = k => { if (!trees.has(k)) trees.set(k, dataTree(catalogue, k, { depth: 2 })); return trees.get(k) }

  const detailed = []
  let used = 0
  for (const r of ranked) {
    if (detailed.length >= DETAIL_MAX) break
    if (r.score <= 0 && detailed.length >= DETAIL_MIN) break
    const size = treeNodes(treeOf(r.key)).length
    if (used + size > DETAIL_BUDGET && detailed.length >= DETAIL_MIN && r.score !== Infinity) continue
    detailed.push(r.key)
    used += size
  }

  const order = [...detailed, ...ranked.map(r => r.key).filter(k => !detailed.includes(k))]
  const s = new Map(), sRefOf = new Map(), f = new Map(), fRefOf = new Map()
  order.forEach((k, i) => { s.set('S' + (i + 1), k); sRefOf.set(k, 'S' + (i + 1)) })

  const lines = ['The kinds of report this person can make. Only these refs exist.', '']
  let fn = 0
  for (const k of detailed) {
    const sub = catalogue.subjects[k]
    const tree = treeOf(k)
    const day = sub.fields?.date?.label
    lines.push(sRefOf.get(k) + ' ' + sub.label + ': ' + clip(sub.about || '', 220))
    lines.push(' Each row is one ' + (sub.one || 'row') + '.'
      + (day ? ' Its own day: ' + day + '.' : ' It has no day of its own (no period).')
      + (sub.venue ? ' It has a venue.' : ''))
    lines.push('  COUNT | how many ' + lowerFirst(sub.label) + ' | number | count')
    const node = n => {
      const ref = 'F' + ++fn
      f.set(ref, { subject: k, path: n.path, node: n })
      fRefOf.set(k + '|' + n.path, ref)
      const parts = [ref, n.full, typeText(catalogue, k, n)]
      const uses = usesText(n.uses)
      if (uses) parts.push(uses)
      if (n.about && !n.trail.length) parts.push(clip(n.about, 110))
      lines.push('  ' + parts.join(' | '))
    }
    if (tree.figures.length) { lines.push(' Figures:'); tree.figures.forEach(node) }
    if (tree.fields.length) { lines.push(' Fields:'); tree.fields.forEach(node) }
    const folder = (fo, trail) => {
      const name = [...trail, fo.label].join(' > ')
      lines.push(fo.many
        ? ' List of ' + name + ' (each ' + (sub.one || 'row') + ' has several; only totals):'
        : ' In ' + name + ' (each ' + (trail.length ? 'of these' : sub.one || 'row') + ' has one):')
      if (fo.node) node(fo.node)
      fo.figures.forEach(node)
      fo.fields.forEach(node)
      fo.folders.forEach(x => folder(x, [...trail, fo.label]))
    }
    tree.folders.forEach(x => folder(x, []))
    lines.push('')
  }
  const rest = order.slice(detailed.length)
  if (rest.length) {
    lines.push('Also possible (pick one of these and it is shown in full):')
    for (const k of rest) {
      const sub = catalogue.subjects[k]
      lines.push(sRefOf.get(k) + ' ' + sub.label + ': ' + clip(sub.about || '', 120))
    }
  }
  return { text: lines.join('\n'), detailed, s, sRefOf, f, fRefOf }
}

/**
 * A slice whose refs are the catalogue's own paths: every subject the
 * person can build on (by its key), and everything the builder offers for
 * `subjectKey`, two links deep (by its path). Plans written with paths
 * (Pepper's chat tools, src/reports/plan.js) go through toSpec() and
 * answerOf() with it, the way the smart builder's answers do with refs.
 */
export function pathSlice(catalogue, subjectKey) {
  const s = new Map(), sRefOf = new Map(), f = new Map(), fRefOf = new Map()
  for (const sub of Object.values(catalogue.subjects)) {
    if (!sub.base) continue
    s.set(ref(sub.key), sub.key)
    sRefOf.set(sub.key, sub.key)
  }
  const tree = catalogue.subjects[subjectKey]?.base ? dataTree(catalogue, subjectKey, { depth: 2 }) : null
  for (const n of treeNodes(tree)) {
    f.set(ref(n.path), { subject: subjectKey, path: n.path, node: n })
    fRefOf.set(subjectKey + '|' + n.path, n.path)
  }
  return { text: '', detailed: tree ? [subjectKey] : [], s, sRefOf, f, fRefOf }
}

// ── What the model answers ───────────────────────────────────

const int = { type: 'integer' }
const ROW = obj({ ref: str, bucket: oneOf(['', ...MOMENT_BUCKETS]), label: str })

export const ANSWER_SCHEMA = obj({
  subject: str,
  kind: oneOf(['summary', 'list']),
  rows: arr(ROW),
  columns: arr(ROW),
  values: arr(obj({
    name: str, ref: str, agg: oneOf(['', ...AGGS]), calc: str, label: str, format: oneOf(['', ...VALUE_FORMATS]),
  })),
  filters: arr(obj({
    ref: str, bucket: oneOf(['', ...MOMENT_BUCKETS]), op: oneOf(FILTER_OPS), values: arr(str), ask: bool, label: str,
  })),
  period: obj({ relative: oneOf(['', ...RELATIVE_PERIODS]), n: int, from: str, to: str }),
  venues: arr(str),
  sort: arr(obj({ by: str, dir: oneOf(['asc', 'desc']) })),
  limit: obj({ which: oneOf(['none', 'top', 'bottom']), n: int, by: str, rest: str }),
  compare: oneOf(['none', ...COMPARE_WITH]),
  chart: obj({ kind: oneOf(VIEW_KINDS), x: str, y: arr(str), line: str, stacked: bool, sideways: bool }),
  name: str,
  assumed: arr(str),
  couldnt: arr(str),
  questions: arr(obj({ question: str, choices: arr(str) })),
})

export const SYSTEM = `You turn a request for a report into a report definition for Macaroonie, the app a restaurant group runs on. You never see the data: the app builds what you answer, runs it and shows it to the person who asked.

What can be reported on is listed after these instructions: subjects (S refs), and for the ones listed in full their figures, fields and what each row belongs to (F refs). Use only refs that are listed. Never make one up, and never write a table or column name.

How to answer:
- subject: one S ref, the kind of row being counted (dishes sold for anything per dish or per section, checks for anything per check, per server or per table, payments for tenders and tips, trading days for a day's totals as the Z report has them). Empty when nothing listed fits: then say why in couldnt. Picking a subject listed in a line only is fine: you will be shown it in full and asked again.
- kind: summary (figures added up, grouped by something) or list (the rows themselves, one line each, as they are).
- rows: a summary's groupings, outer first; a list's columns, in order. A day or a moment can be grouped by a bucket (day, week, month, quarter, year, weekday, hour) where the field says so; empty bucket means as it is (a day by day). label renames it, else empty.
- columns: a grouping across the top (a table across), only when asked for one ("days across the top"). At most 2. Empty for a list.
- values: what a summary adds up, named v1, v2 and so on in order. Prefer a figure (marked figure): figures carry the app's rules (net sales leaves out voided dishes and cancelled orders). Use a field with an agg (sum, avg, min, max, count_distinct) only when no figure says it. ref COUNT with agg count is how many rows there are. A calc works out a value from others by their names: v1 / v2, round(v1 / v2 * 100, 1), v1 - v2; it may use round, abs, min, max, if, total (the column's total), running, rank, change, previous; it can't use another calc. For a calc leave ref and agg empty; for anything else leave calc empty. format only for a calc (money, number, percent with 0.25 meaning 25%, duration in seconds). Empty for a list.
- filters: only the rows that match. ref a field marked filter, or a thing marked venues. op by the field's type: text is, is_not, in, not_in, contains, starts_with; choice is, is_not, in, not_in; numbers is, gt, gte, lt, lte, between; a day before, after, between, is; yes/no is; any field empty, not_empty. values as text: a choice by its label as listed; a number as people say it (money in pounds like 12.50, a percentage as per cent like 20, a duration in minutes); a day as YYYY-MM-DD; yes or no; a weekday by name; an hour like 18 or 6pm; names in the data (a dish, a server, a section) as the request says them. ask true when the person should be able to choose it each time the report is opened, with label naming what they choose.
- period and venues are set apart from filters. period: relative from the list (n with last_n_days and next_n_days), or from and to as YYYY-MM-DD; leave it all empty (n 0) when the request says no period. venues: the venue names asked for as the request says them; empty for every venue.
- sort: by a value's name (v1) or the F ref of a grouping or list column; dir asc or desc. Empty to keep the usual order.
- limit: the top or bottom n of a summary's rows by a value's name, with rest naming the other rows put together ("Every other dish") or empty to leave them out. which none for every row.
- compare: previous_period or last_year when the request compares, else none.
- chart: kind table unless a chart is asked for or clearly helps: line for a trend over days, weeks or months; bar for a few groups side by side; parts for the shares of a total; combo for bars with a line; figures for a few totals as big numbers; heat for two groupings. x: the F ref of the grouping along the bottom (empty for the first); y: the values drawn by name (empty for the first); line: the value drawn as a line in combo.
- name: a short name for the report, 60 characters at most.
- assumed: what you decided that the request didn't say, one short sentence each (which figure "sales" means, a top 10 taken as top 10 by net sales). Don't mention the period or venues when none were said: the app says so itself.
- couldnt: what was asked that the listed subjects can't do, one short sentence each.
- questions: only when the request could mean two quite different reports. Still build the likeliest one. At most 2, each with 2 to 4 short choices.

The request may come with a photo or PDF of a report the person has now: build the same report from what is listed (its figures, its groupings, its period if one shows) and say in couldnt what can't be made.

When you are given the report as it is now, change it as the new request asks and keep the rest as it is, its name too unless the change makes the name wrong.

Write in plain British English. No emojis, no markdown.`

// ── From answer to definition ────────────────────────────────

const ref = v => text(v).toUpperCase()
const WEEKDAYS = WEEKDAYS_LONG.map(d => d.toLowerCase())

function asWeekday(v) {
  const t = text(v).toLowerCase()
  if (/^[1-7]$/.test(t)) return Number(t)
  if (t.length < 3) return null
  const i = WEEKDAYS.findIndex(d => d.startsWith(t.slice(0, 3)))
  return i === -1 ? null : i + 1
}

function asHour(v) {
  const m = text(v).toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return h >= 0 && h <= 23 ? h : null
}

function asYesNo(v) {
  const t = text(v).toLowerCase()
  if (['yes', 'true', 'y', '1'].includes(t)) return true
  if (['no', 'false', 'n', '0'].includes(t)) return false
  return null
}

function asChoice(v, labels) {
  const t = text(v).toLowerCase()
  if (!t || !labels) return null
  const entries = Object.entries(labels)
  return (entries.find(([k, l]) => k.toLowerCase() === t || String(l).toLowerCase() === t)
    || entries.find(([, l]) => String(l).toLowerCase().startsWith(t))
    || [null])[0]
}

/** A period from the answer's period, or from a filter's values ([relative, n] or [from, to]). */
function periodFrom(p) {
  if (Array.isArray(p)) {
    const [a, b] = p.map(text)
    if (RELATIVE_PERIODS.includes(a)) return normalisePeriod({ relative: a, n: Number(b) })
    return isYmd(a) && isYmd(b) ? normalisePeriod({ from: a, to: b }) : null
  }
  if (!p || typeof p !== 'object') return null
  if (RELATIVE_PERIODS.includes(p.relative)) return normalisePeriod({ relative: p.relative, n: p.n })
  return isYmd(text(p.from)) && isYmd(text(p.to)) ? normalisePeriod({ from: text(p.from), to: text(p.to) }) : null
}

/**
 * Names that a typed name means, best first: the name exactly, then in
 * any case, then names starting with it, then names holding it, then names
 * holding each of its words. `names` come most used first.
 */
export function matchNames(typed, names) {
  const t = text(typed)
  const low = t.toLowerCase()
  if (!low) return []
  for (const test of [
    n => n === t,
    n => n.toLowerCase() === low,
    n => n.toLowerCase().startsWith(low),
    n => n.toLowerCase().includes(low),
  ]) {
    const hits = names.filter(test)
    if (hits.length) return hits
  }
  const words = low.split(/\s+/).filter(Boolean)
  return words.length > 1 ? names.filter(n => words.every(w => n.toLowerCase().includes(w))) : []
}

// A filter's value from the answer's words: undefined when they don't make one.
function filterValue(def, type, bucket, op, words) {
  const shape = filterShape(op)
  if (shape === 'none') return null
  const kind = filterValueKind(type, bucket, op)
  if (kind === 'period') return periodFrom(words) || undefined
  const one = w => {
    if (kind === 'weekday') return asWeekday(w)
    if (kind === 'hour') return asHour(w)
    if (kind === 'day') return isYmd(text(w)) ? text(w) : null
    if (kind === 'yesno') return asYesNo(w)
    if (kind === 'number') return storedNumber(type, text(w).replace(/[£$€%]/g, ''))
    if (kind === 'choice') return asChoice(w, def?.labels)
    return text(w) || null
  }
  const vals = words.map(one)
  if (vals.some(v => v === null)) return undefined
  if (shape === 'many') return vals.length ? vals : undefined
  if (shape === 'two') return vals.length === 2 ? vals : undefined
  return vals.length ? vals[0] : undefined
}

/**
 * The model's answer as a definition, made only through the builder's own
 * edits. `slice` is the one the answer was given against; `venues` the
 * group's ([{ id, name }]); `prev` the report it changes (its filters made
 * of several parts and its drill-downs are kept). Returns
 *
 *   { spec, name, assumed, couldnt, slips,
 *     questions  [{ question, choices: [{ label, change }] }]: each
 *                change as applyChange() (shared/reports/choices.js) takes it
 *     lookups    [{ index, cond, ask, label, typed: [names] }]: names to
 *                find in the report's own rows }
 *
 * `slips` counts refs the answer got wrong (not listed, or another
 * subject's): they are left out.
 */
export function toSpec(catalogue, slice, answer, { venues = [], prev = null } = {}) {
  const subjectKey = slice.s.get(ref(answer?.subject))
  const sub = catalogue.subjects[subjectKey]
  const out = { spec: null, name: '', assumed: [], couldnt: [], slips: 0, questions: [], lookups: [], keys: {} }
  if (!sub?.base) return out
  const kind = answer.kind === 'list' ? 'list' : 'summary'
  const isList = kind === 'list'
  const couldnt = s => out.couldnt.push(s)

  const nodeOf = r => {
    const x = slice.f.get(ref(r))
    if (!x || x.subject !== subjectKey) { if (text(r)) out.slips++; return null }
    return x
  }
  // A thing (a link) grouped, listed or filtered is its name.
  const named = x => {
    const r = resolvePath(catalogue, subjectKey, x.path)
    if (r.ok && r.kind === 'link' && !r.def.many) {
      const to = catalogue.subjects[r.def.to]
      if (to?.name) return x.path + '.' + to.name
    }
    return x.path
  }
  const labelOf = path => pathLabel(catalogue, subjectKey, path)

  let spec = newReport(subjectKey, { dated: !!sub.dated, venue: !!sub.venue })
  if (isList) spec = normaliseReport({ ...spec, kind: 'list' })

  // Rows: a summary's groupings, a list's columns.
  for (const r of list(answer.rows)) {
    const x = nodeOf(r.ref)
    if (!x) continue
    const path = named(x)
    const uses = pathUses(catalogue, subjectKey, path)
    if (!(isList ? uses.column : uses.group)) {
      couldnt((isList ? 'A list can\'t show ' : 'It can\'t be grouped by ') + lowerFirst(uses.label || x.node.full) + ' as it is')
      continue
    }
    const bucket = !isList && uses.buckets.includes(r.bucket) && r.bucket !== 'day' ? r.bucket : null
    const label = clip(r.label, LIMITS.label)
    spec = addRow(spec, { field: path, ...(bucket ? { bucket } : {}), ...(label ? { label } : {}) })
  }
  if (isList && !spec.rows.length) for (const field of list(sub.list)) spec = addRow(spec, field)

  // A grouping across the top: a table across.
  for (const c of list(answer.columns)) {
    if (isList) { couldnt('A list can\'t have a grouping across the top'); break }
    const x = nodeOf(c.ref)
    if (!x) continue
    const path = named(x)
    const uses = pathUses(catalogue, subjectKey, path)
    if (!uses.group) { couldnt('It can\'t be grouped by ' + lowerFirst(uses.label || x.node.full)); continue }
    const bucket = uses.buckets.includes(c.bucket) && c.bucket !== 'day' ? c.bucket : null
    const label = clip(c.label, LIMITS.label)
    spec = addColumn(spec, { field: path, ...(bucket ? { bucket } : {}), ...(label ? { label } : {}) })
  }

  // Values, the plain ones first: a calculation reads them by name.
  const keyOf = new Map()
  const keyOfRef = r => {
    if (/^count$/i.test(text(r))) return spec.values.find(v => v.agg === 'count' && !v.field)?.key || null
    const x = slice.f.get(ref(r))
    if (!x || x.subject !== subjectKey) return null
    return spec.values.find(v => v.measure === x.path)?.key || null
  }
  const valueFor = v => {
    if (/^count$/i.test(text(v.ref))) return { agg: 'count' }
    const x = nodeOf(v.ref)
    if (!x) return null
    const uses = pathUses(catalogue, subjectKey, x.path)
    if (uses.what === 'measure') {
      if (uses.values.some(w => w.measure)) return { measure: x.path }
      couldnt(x.node.full + ' can\'t be added up in this report')
      return null
    }
    const offers = uses.values.filter(w => w.agg)
    if (!offers.length) { couldnt(x.node.full + ' can\'t be added up'); return null }
    const agg = AGGS.includes(v.agg) ? v.agg : ''
    const wanted = agg === 'count' ? 'count_distinct' : agg
    const hit = offers.find(w => w.agg === wanted) || (!agg ? offers.find(w => w.agg === 'sum') : null)
    if (hit) return { agg: hit.agg, field: hit.field }
    if (agg === 'count') return { agg: 'count' }
    const picked = { agg: offers[0].agg, field: offers[0].field }
    out.assumed.push('Showed ' + lowerFirst(valueName(catalogue, subjectKey, picked)) + ': '
      + lowerFirst(x.node.full) + ' can\'t be ' + (agg === 'avg' ? 'averaged' : agg === 'sum' ? 'totalled' : 'added up that way') + ' here')
    return picked
  }
  const nameOf = v => text(v.name).toLowerCase()
  // decimals and hidden come only from plans (src/reports/plan.js): the model's answers have neither.
  const extras = v => {
    const label = clip(v.label, LIMITS.label)
    return {
      ...(label ? { label } : {}),
      ...(VALUE_FORMATS.includes(v.format) ? { format: v.format } : {}),
      ...(Number.isInteger(v.decimals) && v.decimals >= 0 && v.decimals <= 6 ? { decimals: v.decimals } : {}),
      ...(v.hidden === true ? { hidden: true } : {}),
    }
  }
  const sameValue = (a, b) => (a.measure || '') === (b.measure || '') && (a.agg || '') === (b.agg || '') && (a.field || '') === (b.field || '')
  if (!isList) {
    const all = list(answer.values)
    for (const v of all.filter(x => !text(x.calc))) {
      const value = valueFor(v)
      if (!value) continue
      const before = spec.values.length
      spec = addValue(spec, { ...value, ...extras(v) })
      const key = spec.values.length > before ? spec.values[spec.values.length - 1].key : spec.values.find(w => sameValue(w, value))?.key
      if (key && nameOf(v)) keyOf.set(nameOf(v), key)
    }
    for (const v of all.filter(x => text(x.calc))) {
      let unknown = false
      const calc = text(v.calc).replace(/\b(v\d+|F\d+|COUNT)\b/gi, m => {
        const k = /^v\d+$/i.test(m) ? keyOf.get(m.toLowerCase()) : keyOfRef(m)
        if (!k) { unknown = true; return m }
        return k
      })
      if (unknown) { couldnt('"' + (clip(v.label, LIMITS.label) || 'A calculation') + '" uses a value the report doesn\'t have'); continue }
      const before = spec.values.length
      spec = addValue(spec, { calc, ...extras(v) })
      if (spec.values.length > before && nameOf(v)) keyOf.set(nameOf(v), spec.values[spec.values.length - 1].key)
    }
  } else if (list(answer.values).length) {
    out.assumed.push('A list shows its rows as they are, so nothing is added up')
  }

  // Filters; the venues and the report's own period are set apart.
  const venueNames = list(answer.venues).map(text).filter(Boolean)
  let period = periodFrom(answer.period)
  for (const fl of list(answer.filters)) {
    const x = nodeOf(fl.ref)
    if (!x) continue
    let uses = pathUses(catalogue, subjectKey, x.path)
    if (uses.filter === 'venues') { venueNames.push(...list(fl.values).map(text).filter(Boolean)); continue }
    if (x.path === 'date' && !text(fl.bucket) && fl.op === 'in_period') {
      period = periodFrom(list(fl.values)) || period
      continue
    }
    let path = x.path
    if (uses.what === 'link') { path = named(x); uses = pathUses(catalogue, subjectKey, path) }
    const what = lowerFirst(uses.label || x.node.full)
    if (uses.filter !== 'value') { couldnt('It can\'t be filtered by ' + what); continue }
    const bucket = uses.buckets.includes(fl.bucket) && fl.bucket !== 'day' ? fl.bucket : null
    const ops = filterOps(uses.type, bucket)
    const words = list(fl.values).map(text).filter(Boolean)
    let op = fl.op
    if ((op === 'is' || op === 'is_not') && words.length > 1) op = op === 'is' ? 'in' : 'not_in'
    if (!ops.includes(op)) {
      const swap = { in: 'is', is: 'in', not_in: 'is_not', is_not: 'not_in' }[op]
      if (swap && ops.includes(swap) && (swap === 'in' || swap === 'not_in' || words.length === 1)) op = swap
      else { couldnt('It can\'t be filtered that way by ' + what); continue }
    }
    const r = resolvePath(catalogue, subjectKey, path)
    const value = filterValue(r.ok ? r.def : null, uses.type, bucket, op, words)
    const shape = filterShape(op)
    if (shape !== 'none' && (value === undefined || !filterValueOk(uses.type, bucket, op, value))) {
      couldnt('"' + words.join(', ') + '" isn\'t something ' + what + ' can be')
      continue
    }
    const cond = { field: path, ...(bucket ? { bucket } : {}), op, ...(shape === 'none' ? {} : { value }) }
    const label = clip(fl.label, LIMITS.label)
    const index = spec.filters.length
    const next = addFilter(spec, cond, { ask: fl.ask === true, label })
    if (next === spec) { couldnt('The report has as many filters as it can take'); continue }
    spec = next
    // Names in the data are found in the report's own rows once it is built.
    if (filterValueKind(uses.type, bucket, op) === 'text' && ['is', 'is_not', 'in', 'not_in'].includes(op)) {
      out.lookups.push({ index, cond, ask: fl.ask === true, label, typed: [].concat(value) })
    }
  }

  // The period.
  if (sub.dated) {
    if (period) spec = setParamDefault(spec, 'period', period)
    else out.assumed.push('No period was asked for, so it shows last week')
  } else if (period) {
    couldnt(sub.label + ' have no day of their own, so the period was left out')
  }

  // The venues, found among the group's own.
  if (venueNames.length) {
    if (!sub.venue) couldnt(sub.label + ' aren\'t for a venue, so the venues were left out')
    else {
      const ids = []
      const names = venues.map(v => v.name)
      for (const typed of venueNames) {
        const hits = matchNames(typed, names)
        if (!hits.length) { couldnt('There\'s no venue called "' + typed + '"'); continue }
        const found = venues.filter(v => hits.includes(v.name))
        const first = found[0].id
        ids.push(first)
        if (found.length > 1) {
          const swap = to => ({ venues: { from: first, to } })
          out.questions.push({
            question: 'Which venue did you mean by "' + typed + '"?',
            choices: [
              ...found.slice(0, 4).map(v => ({ label: v.name, change: swap([v.id]) })),
              { label: 'All of them', change: swap(found.map(v => v.id)) },
            ],
          })
        }
      }
      if (ids.length) spec = setParamDefault(spec, 'venues', [...new Set(ids)])
    }
  }

  // Sort, top N, comparing, the chart.
  const groupId = r => {
    const x = nodeOf(r)
    if (!x) return null
    const path = named(x)
    const row = [...spec.rows, ...spec.columns].find(y => y.field === path)
    return row ? rowId(row) : null
  }
  const sortBy = by => {
    const t = text(by)
    if (/^v\d+$/i.test(t)) return keyOf.get(t.toLowerCase()) || null
    if (/^count$/i.test(t)) return keyOfRef(t)
    if (isList) { const x = nodeOf(t); return x ? named(x) : null }
    return groupId(t) || keyOfRef(t)
  }
  const sort = list(answer.sort).map(s => ({ by: sortBy(s.by), dir: s.dir === 'desc' ? 'desc' : 'asc' })).filter(s => s.by)
  if (sort.length) spec = setSort(spec, sort)

  const lim = answer.limit || {}
  if ((lim.which === 'top' || lim.which === 'bottom') && Number(lim.n) >= 1) {
    if (isList) couldnt('A list shows every row, so it isn\'t cut to the ' + lim.which + ' ' + Math.round(Number(lim.n)))
    else {
      const n = Math.min(LIMITS.top, Math.round(Number(lim.n)))
      spec = setLimit(spec, { which: lim.which, n, by: sortBy(lim.by) || undefined, rest: clip(lim.rest, LIMITS.label) })
    }
  }

  if (COMPARE_WITH.includes(answer.compare)) {
    const why = compareProblem(catalogue, spec)
    if (why) couldnt(why)
    else spec = setCompare(spec, answer.compare)
  }

  const ch = answer.chart || {}
  if (!isList && VIEW_KINDS.includes(ch.kind) && ch.kind !== 'table') {
    const x = text(ch.x) ? groupId(ch.x) : null
    const y = list(ch.y).map(n => keyOf.get(text(n).toLowerCase())).filter(Boolean)
    const line = keyOf.get(text(ch.line).toLowerCase()) || null
    const next = setView(spec, {
      kind: ch.kind, ...(x ? { x } : {}), ...(y.length ? { y } : {}), ...(line ? { line } : {}),
      stacked: ch.stacked === true, sideways: ch.sideways === true,
    })
    const fit = chartChoices(next).find(k => k.kind === ch.kind)
    if (fit && !fit.ok) couldnt('It can\'t be drawn as ' + lowerFirst(VIEW_LABELS[ch.kind]) + ': ' + lowerFirst(fit.why))
    else spec = next
  }

  // What the report changed from had that answers can't say: filters made of
  // several parts and its drill-downs, kept while it stays about the same rows.
  if (prev && prev.subject === subjectKey) {
    const kept = prev.filters.filter(f => f.any || f.all || f.has || f.counted)
    if (kept.length) {
      const want = usedParams({ filters: kept })
      const params = [...spec.params, ...prev.params.filter(p => want.has(p.key) && !spec.params.some(x => x.key === p.key))]
      spec = normaliseReport({ ...spec, params, filters: [...spec.filters, ...kept] })
    }
    if (prev.drill) spec = normaliseReport({ ...spec, drill: prev.drill })
  }

  out.spec = spec
  out.name = clip(answer.name, 60) || sub.label
  out.keys = Object.fromEntries(keyOf)
  return out
}

// ── Names in the data ────────────────────────────────────────

// The names a field holds in the report's rows (its period and venues),
// most used first.
async function namesIn(p, spec, field) {
  const keep = new Set(spec.params.filter(x => x.type === 'period' || x.type === 'venues').map(x => x.key))
  const look = normaliseReport({
    subject: spec.subject, kind: 'summary',
    params: spec.params.filter(x => keep.has(x.key)),
    filters: spec.filters.filter(f => f.param && keep.has(f.param)),
    rows: [{ field }],
    values: [{ key: 'n', agg: 'count' }],
    sort: [{ by: 'n', dir: 'desc' }],
    limit: { top: LOOKUP_ROWS },
  })
  const res = await runReport(p.ctx, look, {}, { cap: LOOKUP_ROWS })
  return res.rows.filter(r => r.kind === 'row').map(r => r.k?.[0]).filter(v => typeof v === 'string' && v.trim())
}

// A filter's value with one name swapped for others (one or several).
const swapName = (lk, from, to) => ({ filter: { index: lk.index, from, to } })

/**
 * Names typed in filters (a dish, a server) found in the report's own rows:
 * one match is used, several are a question (the most used is shown), none
 * keeps the name as typed with a note. At most LOOKUPS fields are looked up.
 */
async function findNames(p, catalogue, spec, lookups) {
  const questions = [], notes = []
  for (const lk of lookups.slice(0, LOOKUPS)) {
    let names
    try {
      names = await namesIn(p, spec, lk.cond.field)
    } catch (e) {
      if (e instanceof ReportError) continue
      throw e
    }
    if (!names.length) continue
    const label = lowerFirst(pathLabel(catalogue, spec.subject, lk.cond.field))
    for (const typed of lk.typed) {
      const hits = matchNames(typed, names)
      if (!hits.length) { notes.push('No ' + label + ' "' + typed + '" was found in the report\'s period, so it is kept as typed'); continue }
      if (hits[0] !== typed) spec = applyChange(spec, swapName(lk, typed, [hits[0]]))
      if (hits.length > 1) {
        const all = lk.cond.op === 'is' || lk.cond.op === 'in'
        questions.push({
          question: 'Which ' + label + ' did you mean by "' + typed + '"?',
          choices: [
            ...hits.slice(0, 4).map(h => ({ label: h, change: swapName(lk, hits[0], [h]) })),
            ...(all ? [{ label: 'All of them', change: swapName(lk, hits[0], hits.slice(0, LIMITS.in_values)) }] : []),
          ],
        })
      }
    }
  }
  return { spec, questions, notes }
}

// ── A report as it is now, for a change ──────────────────────

function wordsOf(def, type, bucket, op, v) {
  const kind = filterValueKind(type, bucket, op)
  const one = x => {
    if (kind === 'weekday') return WEEKDAYS_LONG[Number(x) - 1] || String(x)
    if (kind === 'yesno') return x === true ? 'yes' : 'no'
    if (kind === 'number') return String(shownNumber(type, x) ?? x)
    if (kind === 'choice') return def?.labels?.[x] || String(x)
    return String(x)
  }
  return [].concat(v ?? []).map(one)
}

/**
 * A definition written the way the model answers, with the slice's refs:
 * the report as it is now, when it is to be changed. Parts the slice has no
 * ref for are left out (the model is told the report as it can change it).
 * `full` adds what plans say and the model's answers don't (decimals,
 * hidden values).
 */
export function answerOf(catalogue, slice, spec, venues = [], name = '', { full = false } = {}) {
  const k = spec.subject
  const fref = path => slice.fRefOf.get(k + '|' + path) || ''
  // A thing's name is listed as the thing.
  const refFor = path => fref(path) || (path.includes('.') ? fref(path.slice(0, path.lastIndexOf('.'))) : '')
  const names = new Map(spec.values.map((v, i) => [v.key, 'v' + (i + 1)]))
  const asName = key => names.get(key) || ''
  const row = r => ({ ref: refFor(r.field), bucket: r.bucket || '', label: r.label || '' })
  const values = spec.values.filter(v => !v.of).map(v => {
    const base = {
      name: asName(v.key), ref: '', agg: '', calc: '', label: v.label || '', format: v.format || '',
      // A plan says these too (`full`); the model's answers don't.
      ...(full && v.decimals != null ? { decimals: v.decimals } : {}), ...(full && v.hidden ? { hidden: true } : {}),
    }
    if (v.measure) return { ...base, ref: fref(v.measure) }
    if (v.calc) return { ...base, calc: v.calc.replace(/[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*/gi, t => names.get(t) || t) }
    if (v.agg === 'count' && !v.field) return { ...base, ref: 'COUNT', agg: 'count' }
    return { ...base, ref: refFor(v.field), agg: v.agg }
  }).filter(v => v.ref || v.calc)

  const out = {
    subject: slice.sRefOf.get(k) || '', kind: spec.kind === 'list' ? 'list' : 'summary',
    rows: spec.rows.map(row).filter(r => r.ref), columns: spec.columns.map(row).filter(r => r.ref),
    values, filters: [], period: { relative: '', n: 0, from: '', to: '' }, venues: [],
    sort: [], limit: { which: 'none', n: 0, by: '', rest: '' }, compare: spec.compare?.with || 'none',
    chart: { kind: spec.view?.kind || 'table', x: '', y: [], line: '', stacked: !!spec.view?.stacked, sideways: !!spec.view?.sideways },
    name: clip(name, 60), assumed: [], couldnt: [], questions: [],
  }
  for (const f of spec.filters) {
    if (f.any || f.all || f.has || f.counted) continue
    const param = f.param ? spec.params.find(x => x.key === f.param) : null
    if (param?.type === 'period') {
      const pd = param.default || {}
      out.period = { relative: pd.relative || '', n: pd.n || 0, from: pd.from || '', to: pd.to || '' }
      continue
    }
    if (param?.type === 'venues') {
      out.venues = Array.isArray(param.default) ? param.default.map(id => venues.find(v => v.id === id)?.name).filter(Boolean) : []
      continue
    }
    const r = resolvePath(catalogue, k, f.field)
    if (!r.ok) continue
    const value = param ? param.default : f.value
    out.filters.push({
      ref: refFor(f.field), bucket: f.bucket || '', op: f.op,
      values: f.op === 'in_period' ? [value?.relative || value?.from || '', String(value?.n || value?.to || '')] : wordsOf(r.def, r.def.type, f.bucket, f.op, value),
      ask: !!param, label: param?.label || '',
    })
  }
  out.filters = out.filters.filter(f => f.ref)
  const sortRef = by => names.get(by) || refFor(String(by).split(':')[0])
  out.sort = spec.sort.map(s => ({ by: sortRef(s.by), dir: s.dir })).filter(s => s.by)
  if (spec.limit) {
    const which = spec.limit.top ? 'top' : 'bottom'
    const rank = spec.sort.find(s => names.has(s.by))?.by
    out.limit = { which, n: spec.limit[which], by: rank ? asName(rank) : '', rest: spec.limit.rest_as || '' }
  }
  if (spec.view && spec.view.kind !== 'table') {
    out.chart.x = spec.view.x ? refFor(spec.view.x.split(':')[0]) : ''
    out.chart.y = list(spec.view.y).map(asName).filter(Boolean)
    out.chart.line = spec.view.line ? asName(spec.view.line) : ''
  }
  return out
}

// ── The build ────────────────────────────────────────────────

const WORDS = {
  badRequest: 'Claude couldn\'t take this request. If a file is attached, try a clearer photo (JPEG or PNG) or a PDF.',
  refusal: ASSISTANT_NAME + ' can\'t build this one. Try asking for the report in other words.',
  tooLong: 'That is too much to build in one go. Ask for a smaller report, then change it.',
}

const notes = items => [...new Set(items.map(x => clip(x, 200)).filter(Boolean))].slice(0, NOTES)

function userText({ request, venues, today, previous, current, feedback }) {
  const parts = []
  if (isYmd(today)) parts.push('Today at the venues: ' + WEEKDAYS_LONG[(new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7] + ' ' + dayText(today) + ' (' + today + ').')
  if (venues.length) parts.push('The group\'s venues: ' + venues.map(v => v.name).join(', ') + '.')
  if (current) {
    const asked = list(previous?.requests).map(t => clip(t, 2000)).filter(Boolean)
    if (asked.length) parts.push('Earlier they asked:\n' + asked.map(t => '- ' + t).join('\n'))
    parts.push('The report as it is now:\n' + JSON.stringify(current))
  }
  if (feedback) parts.push(feedback)
  parts.push((current ? 'Change it like this: ' : 'The request: ') + clip(request, 2000))
  return parts.join('\n\n')
}

function ask(p, { slice, files, ...rest }) {
  return askForJson({
    tenantId: p.tenantId,
    person: { sub: p.sub, email: p.email },
    system: [SYSTEM, slice.text],
    schema: ANSWER_SCHEMA,
    content: [...fileBlocks(files || []), { type: 'text', text: userText(rest) }],
    thinking: true,
    effort: 'medium',
    what: 'report',
    words: WORDS,
  })
}

const retryText = (answer, problems) => 'Your last answer:\n' + JSON.stringify(answer)
  + '\n\nIt couldn\'t be used:\n' + problems.map(x => '- ' + x).join('\n')
  + '\n\nAnswer again with these fixed, using only the refs listed.'

// A report that is too slow or too big, or the reports being busy: asking
// again wouldn't help.
const notForRetry = e => e.statusCode !== 422 || /too long|too much at once/i.test(e.message || '')

/**
 * A built definition (toSpec()'s output) checked, its names found in the
 * data, run as the person and said in words: the part the smart builder and
 * plans in paths share. `assumed` and `couldnt` are the notes so far.
 *   -> { done: { spec, about, assumed, couldnt, questions, result } }
 *   or { problems, retry, failed: { spec, about, assumed, couldnt, problem } }
 *      (retry: asking again with the reasons could help)
 */
export async function runBuilt(p, catalogue, built, { venues = [], assumed = [], couldnt = [], cap = PREVIEW_ROWS } = {}) {
  let spec = built.spec
  let problems = spec ? reportProblems(spec) : ['Nothing could be built from this']
  if (!problems.length) {
    try { spec = checkedSpec(spec, p).spec } catch (e) { if (e instanceof ReportError) problems = e.problems; else throw e }
  }
  const words = { assumed: notes(assumed), couldnt: notes(couldnt) }
  const failed = problem => ({ spec, about: spec ? describeReport(catalogue, spec, { venues }) : '', ...words, problem })
  if (problems.length) return { problems, retry: true, failed: failed(problems.join('. ')) }

  const found = await findNames(p, catalogue, spec, built.lookups)
  spec = found.spec
  words.couldnt = notes([...words.couldnt, ...found.notes])

  let result
  try {
    result = await runReport(p.ctx, spec, {}, { cap })
  } catch (e) {
    if (!(e instanceof ReportError)) throw e
    return { problems: e.problems, retry: !notForRetry(e), failed: failed(e.problems.join('. ')) }
  }

  const ctx = { venues, periodText: result.meta?.period?.text, currency: result.meta?.currency }
  const questions = [...built.questions, ...found.questions].slice(0, QUESTIONS).map(q => ({
    question: q.question,
    choices: q.choices.map(c => ({ label: c.label, change: c.change })),
  }))
  return { done: { spec, about: describeReport(catalogue, spec, ctx), ...words, questions, result } }
}

/** Build a report from a request. See the top of this file. */
export async function smartBuild(p, { request, previous = null, files = [], venues = [], today = null } = {}) {
  const catalogue = catalogueView(p.levels)
  const prev = previous?.spec ? normaliseReport(previous.spec) : null
  const pinned = prev && catalogue.subjects[prev.subject]?.base ? prev.subject : null
  let slice = buildSlice(catalogue, request + ' ' + list(previous?.requests).join(' '), pinned)
  let current = prev && pinned ? answerOf(catalogue, slice, prev, venues, previous?.name) : null
  let feedback = null
  const base = { request, venues, today, previous, files }

  for (let call = 1; call <= 2; call++) {
    const answer = await ask(p, { ...base, slice, current, feedback })
    const modelQuestions = list(answer.questions).slice(0, 2).map(q => ({
      question: clip(q.question, 200),
      choices: list(q.choices).map(c => clip(c, 80)).filter(Boolean).slice(0, 4).map(label => ({ label })),
    })).filter(q => q.question && q.choices.length >= 2)

    const subjectKey = slice.s.get(ref(answer.subject))
    if (!subjectKey) {
      if (text(answer.subject) && call === 1) {
        feedback = retryText(answer, ['"' + text(answer.subject) + '" isn\'t one of the subjects listed'])
        continue
      }
      return {
        spec: null, name: '', about: '', assumed: notes(list(answer.assumed)),
        couldnt: notes([...list(answer.couldnt), ...(list(answer.couldnt).length ? [] : ['None of the reports can show this'])]),
        questions: modelQuestions, result: null, problem: null,
      }
    }
    // A subject listed in a line only: ask again with it in full.
    if (!slice.detailed.includes(subjectKey) && call === 1) {
      slice = buildSlice(catalogue, request, subjectKey)
      current = prev && prev.subject === subjectKey ? answerOf(catalogue, slice, prev, venues, previous?.name) : current && null
      feedback = 'Build it from ' + slice.sRefOf.get(subjectKey) + ' (' + catalogue.subjects[subjectKey].label + '), now listed in full.'
      continue
    }

    const built = toSpec(catalogue, slice, answer, { venues, prev })
    const couldnt = [...list(answer.couldnt), ...built.couldnt]
    if (built.slips) couldnt.push('Part of the request couldn\'t be matched to what the reports hold')
    const ran = await runBuilt(p, catalogue, built, { venues, assumed: [...list(answer.assumed), ...built.assumed], couldnt })
    if (ran.problems) {
      if (call === 1 && ran.retry) { feedback = retryText(answer, ran.problems); continue }
      return { ...ran.failed, name: built.name, questions: modelQuestions, result: null }
    }
    const out = ran.done
    return {
      spec: out.spec, name: built.name, about: out.about, assumed: out.assumed, couldnt: out.couldnt,
      questions: [...out.questions, ...modelQuestions].slice(0, QUESTIONS),
      result: out.result, problem: null,
    }
  }
  // Both calls used up without a report (a subject named twice that isn't listed).
  return {
    spec: null, name: '', about: '', assumed: [],
    couldnt: ['The report couldn\'t be worked out. Try asking in other words'], questions: [], result: null, problem: null,
  }
}
