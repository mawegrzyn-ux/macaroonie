// shared/reports/page.js
//
// A Page report: several reports in order, with words and page breaks
// between them, to read and print as one (docs/REPORTS.md 6, 11). A page
// holds references, never copies: each report is run as the person looking,
// through the usual checks, so a page shows nobody more than the reports
// themselves would.
//
// One set of rules for the API (the page routes, the print page), the
// admin's page editor and viewer, and Pepper's words for a page.
//
//   isPage(spec)              whether a definition is a page's
//   normalisePage(raw)        the one known shape from anything; never throws
//   pageProblems(spec)        what is wrong, as sentences
//   newPage()                 a page to start from
//   pageRefs(spec)            the reports it names, once each, in order
//   blockGiven(spec, choice)  what a report on the page is run with: the
//                             page's period and venues, put on the report's
//                             own period and venues choices
//   shownResult(result, show) a result as a block's Show says, for the screen
//   printShow(show)           the same choice for the print page's section
//   pageWords(spec)           the page in a line, for lists
//
// The shape:
//
//   { version: 1, kind: 'page',
//     blocks: [ { id, type: 'report', ref, show, title },   ref: a saved report's id or 'starter:<key>'
//               { id, type: 'text', title, text },
//               { id, type: 'break' } ],
//     period: null | <period>,         null: each report over its own period
//     venues: null | 'all' | [ids] }   null: each report for its own venues
//
// A page can't hold a page.

import { normalisePeriod } from './period.js'
import { cleanVenues } from './spec.js'

export const PAGE_SUBJECT = 'page'
export const PAGE_LIMITS = { blocks: 30, reports: 12, title: 120, text: 2000 }
export const BLOCK_TYPES = ['report', 'text', 'break']
export const BLOCK_LABELS = { report: 'Report', text: 'Words', break: 'Page break' }
export const SHOWS = ['both', 'chart', 'table']
export const SHOW_LABELS = { both: 'Chart and table', chart: 'Chart only', table: 'Table only' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STARTER = /^starter:[a-z0-9_]{1,60}$/
const BLOCK_ID = /^[a-z0-9]{1,12}$/

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
// Words someone typed, on one line or a few: no control characters.
function words(v, max, lines = false) {
  if (typeof v !== 'string') return ''
  const s = lines
    ? v.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n')
    : v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ')
  return s.trim().slice(0, max).trim()
}

/** A report's reference as a page keeps it, or null for anything else. */
export function cleanRef(v) {
  if (typeof v !== 'string') return null
  if (UUID.test(v)) return v.toLowerCase()
  return STARTER.test(v) ? v : null
}

export const isPage = spec => obj(spec).kind === 'page'

export function normalisePage(raw) {
  const r = obj(raw)
  const blocks = []
  let reports = 0
  for (const b0 of Array.isArray(r.blocks) ? r.blocks : []) {
    if (blocks.length >= PAGE_LIMITS.blocks) break
    const b = obj(b0)
    const id = typeof b.id === 'string' && BLOCK_ID.test(b.id) ? b.id : null
    if (b.type === 'report') {
      const ref = cleanRef(b.ref)
      if (!ref || reports >= PAGE_LIMITS.reports) continue
      reports += 1
      blocks.push({ id, type: 'report', ref, show: SHOWS.includes(b.show) ? b.show : 'both', title: words(b.title, PAGE_LIMITS.title) })
    } else if (b.type === 'text') {
      const title = words(b.title, PAGE_LIMITS.title), text = words(b.text, PAGE_LIMITS.text, true)
      if (title || text) blocks.push({ id, type: 'text', title, text })
    } else if (b.type === 'break') {
      // No break first, and never two in a row.
      if (blocks.length && blocks[blocks.length - 1].type !== 'break') blocks.push({ id, type: 'break' })
    }
  }
  while (blocks.length && blocks[blocks.length - 1].type === 'break') blocks.pop()
  // Every block has an id of its own: the one it came with, else the next free b<n>.
  const used = new Set()
  for (const b of blocks) {
    if (b.id && !used.has(b.id)) used.add(b.id)
    else b.id = null
  }
  let n = 0
  for (const b of blocks) {
    if (b.id) continue
    do { n += 1 } while (used.has('b' + n))
    b.id = 'b' + n
    used.add(b.id)
  }
  return {
    version: 1,
    kind: 'page',
    blocks,
    period: normalisePeriod(r.period) || null,
    venues: r.venues == null ? null : cleanVenues(r.venues),
  }
}

export function pageProblems(spec) {
  const out = []
  if (!spec.blocks.some(b => b.type === 'report')) out.push('Add at least one report to the page')
  return out
}

/** A page to start from: last week at every venue, nothing on it yet. */
export const newPage = () => normalisePage({ kind: 'page', blocks: [], period: { relative: 'last_week' }, venues: 'all' })

/** The reports a page names, once each, in the order they come. */
export const pageRefs = spec => [...new Set(spec.blocks.filter(b => b.type === 'report').map(b => b.ref))]

/**
 * What a report on a page is run with. `choice` is the page's
 * { period, venues } (either may be null: the report's own): each goes on
 * the report's first choice of that kind, and a report with no such choice
 * runs as it is.
 */
export function blockGiven(spec, choice = {}) {
  const given = {}
  const params = Array.isArray(spec?.params) ? spec.params : []
  const period = params.find(p => p.type === 'period')
  const venues = params.find(p => p.type === 'venues')
  if (choice.period && period) given[period.key] = choice.period
  if (choice.venues != null && venues) given[venues.key] = choice.venues
  return given
}

/** A result as a block's Show says, for a screen that draws by the report's own view (ResultCard). */
export function shownResult(result, show) {
  const view = result?.spec?.view
  if (!view) return result
  const next = show === 'table' ? { ...view, kind: 'table' } : { ...view, table_below: show !== 'chart' }
  return { ...result, spec: { ...result.spec, view: next } }
}

/** The same choice for a section of the print page (api/src/reports/export/print.js). */
export function printShow(show) {
  if (show === 'chart') return { table: false }
  if (show === 'table') return { chart: false }
  return { table: true }
}

/** "3 reports and 2 notes, over last week's dates" is the list's job: here, just what is on it. */
export function pageWords(raw) {
  const spec = normalisePage(raw)
  const reports = spec.blocks.filter(b => b.type === 'report').length
  const notes = spec.blocks.filter(b => b.type === 'text').length
  const parts = [reports === 1 ? '1 report' : reports + ' reports']
  if (notes) parts.push(notes === 1 ? '1 note' : notes + ' notes')
  return 'A page of ' + parts.join(' and ')
}
