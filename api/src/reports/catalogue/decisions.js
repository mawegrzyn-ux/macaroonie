// src/reports/catalogue/decisions.js
//
// Every table in the database has a decision (docs/REPORTS.md 5.6):
//
//   in the catalogue   a subject reads it. Not listed anywhere: it is worked
//                      out from the catalogue itself (each subject's tables)
//   planned            will be reported on in a later phase: its area, and
//                      whether its rows are things that happen (counted and
//                      added up) or things to group by (names, people, places)
//   settings           how something is set up: a few named fields will be
//                      offered beside the subject they belong to, the rest
//                      left out
//   left out           never reported on, with the reason
//
// Each area's catalogue file says which of its tables no subject reads, and
// why, in its own `decisions`, beside its subjects:
//
//   export const decisions = {
//     settings: ['pos_settings', ...],
//     out: { 'Secrets and keys': ['...'], ... },          a reason: its tables
//     planned: { till: { happen: [...], group: [...], phase: 3 } },
//   }
//
// This file gathers them from every file of the folder that exports
// `decisions` (gather.js): a reason that two files give is one reason here,
// with their tables put together. A table goes in the file of the area that
// owns it.
//
// api/test/reports-catalogue.test.mjs compares the decisions with the
// database: a table with no decision, with two (in one file or in two), or a
// name that is no longer a table fails it. A new table needs a subject that
// reads it, or a line in its area's `decisions`. `node
// api/scripts/report-catalogue.js` prints where things stand.

import { gather } from './gather.js'

const KINDS = ['settings', 'out', 'planned']

/** Reported on later. { area: { happen: [...], group: [...] } }, all in phase 3 unless `phase` says otherwise. */
export const PLANNED = {}
/** How something is set up: a few named fields offered later, the rest left out. */
export const SETTINGS = []
/** Never reported on. { reason: [tables] } */
export const LEFT_OUT = {}

for (const { file, module } of await gather(import.meta.url, 'decisions')) {
  const d = module.decisions
  const fail = msg => { throw new Error('Report catalogue, ' + file + '\'s decisions: ' + msg) }
  if (!d || typeof d !== 'object') fail('not an object')
  for (const k of Object.keys(d)) if (!KINDS.includes(k)) fail('"' + k + '" isn\'t one of ' + KINDS.join(', '))
  if (d.settings && !Array.isArray(d.settings)) fail('settings must be a list of tables')
  SETTINGS.push(...(d.settings || []))
  for (const [reason, tables] of Object.entries(d.out || {})) {
    if (!Array.isArray(tables)) fail('out: "' + reason + '" must be a list of tables')
    ;(LEFT_OUT[reason] ||= []).push(...tables)
  }
  for (const [area, a] of Object.entries(d.planned || {})) {
    if (!Array.isArray(a.happen || []) || !Array.isArray(a.group || [])) fail('planned: ' + area + '\'s happen and group must be lists of tables')
    const have = (PLANNED[area] ||= { happen: [], group: [] })
    have.happen.push(...(a.happen || []))
    have.group.push(...(a.group || []))
    if (a.phase != null) {
      if (have.phase != null && have.phase !== a.phase) fail('planned: ' + area + ' is phase ' + have.phase + ' in another file')
      have.phase = a.phase
    }
  }
}

/** The tables a catalogue's subjects read. Map(table -> [subject keys]). */
export function catalogueTables(catalogue) {
  const out = new Map()
  for (const s of Object.values(catalogue.subjects)) {
    for (const t of s.from.tables) {
      if (!out.has(t)) out.set(t, [])
      out.get(t).push(s.key)
    }
  }
  return out
}

/**
 * Every decision as one list: [{ table, kind: 'subject' | 'planned' |
 * 'settings' | 'out', ... }], a table once for each place it is named (the
 * test fails on a table named twice).
 */
export function tableDecisions(catalogue) {
  const out = []
  for (const [table, subjects] of catalogueTables(catalogue)) out.push({ table, kind: 'subject', subjects })
  for (const [area, a] of Object.entries(PLANNED)) {
    for (const table of a.happen) out.push({ table, kind: 'planned', area, rows: 'happen', phase: a.phase || 3 })
    for (const table of a.group) out.push({ table, kind: 'planned', area, rows: 'group', phase: a.phase || 3 })
  }
  for (const table of SETTINGS) out.push({ table, kind: 'settings' })
  for (const [reason, tables] of Object.entries(LEFT_OUT)) for (const table of tables) out.push({ table, kind: 'out', reason })
  return out
}

/**
 * The decisions against the tables a database has: { missing (tables with
 * no decision), twice (decided more than once), gone (named in a decision,
 * not a table any more), counts }.
 */
export function checkDecisions(catalogue, tables) {
  const list = tableDecisions(catalogue)
  const seen = new Map()
  for (const d of list) seen.set(d.table, (seen.get(d.table) || 0) + 1)
  const have = new Set(tables)
  const counts = { subject: 0, planned: 0, settings: 0, out: 0 }
  for (const d of list) counts[d.kind]++
  return {
    missing: tables.filter(t => !seen.has(t)).sort(),
    twice: [...seen].filter(([, n]) => n > 1).map(([t]) => t).sort(),
    gone: [...seen.keys()].filter(t => !have.has(t)).sort(),
    counts,
  }
}
