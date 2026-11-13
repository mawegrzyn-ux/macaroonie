// shared/reports/describe.js
//
// What a report shows, in one sentence, worked out from its definition
// (docs/REPORTS.md 10, "Say what was built in words"). The smart builder
// says it under **What this shows**, so the words always match what will
// run; Pepper's report tools say it too.
//
//   describeReport(catalogue, spec, ctx)
//     ctx: { venues: [{ id, name }], periodText (the period as the run
//            worked it out: "Last month (Oct 2026)"), currency }
//
//   "Net sales and quantity sold by dish, the top 20 by net sales, for last
//    month (Oct 2026) at Ware, drawn as bars."
//   "A list of till payments, showing tender, taken and check number, where
//    tender is cash, for yesterday at every venue."

import { valueName, rowName, filterWords, blankValue } from './build.js'
import { pathLabel } from './paths.js'
import { periodName, normalisePeriod } from './period.js'
import { rankKey } from './spec.js'

// How each kind of chart reads after "drawn as".
const DRAWN_AS = {
  bar: 'bars', line: 'lines', area: 'an area', combo: 'bars with a line', parts: 'parts of a whole',
  figures: 'figures', heat: 'a heat table',
}

const arr = v => (Array.isArray(v) ? v : [])
const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || '')
const upperFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
export function andList(list, max = 4) {
  const xs = list.filter(Boolean)
  if (xs.length <= 1) return xs.join('')
  if (xs.length > max) return xs.slice(0, max).join(', ') + ' and ' + (xs.length - max) + ' more'
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
}

/** The venues a report is for, in words: "at Ware", "at every venue", "at 3 venues". */
export function venuesWords(value, venues = []) {
  if (!Array.isArray(value) || !value.length) return 'at every venue'
  const names = value.map(id => arr(venues).find(v => v.id === id)?.name).filter(Boolean)
  if (names.length === value.length) return 'at ' + andList(names, 3)
  return 'at ' + value.length + (value.length === 1 ? ' venue' : ' venues')
}

/**
 * The report in one sentence. Empty for a definition about nothing the
 * catalogue knows.
 */
export function describeReport(catalogue, spec, ctx = {}) {
  const subject = catalogue?.subjects?.[spec?.subject]
  if (!subject) return ''
  const key = spec.subject
  const parts = []

  if (spec.kind === 'list') {
    const cols = arr(spec.rows).map(r => lowerFirst(rowName(catalogue, key, r)))
    parts.push('A list of ' + lowerFirst(subject.label) + (cols.length ? ', showing ' + andList(cols, 6) : ''))
  } else {
    const shown = arr(spec.values).filter(v => !v.hidden)
    const values = shown.map(v => lowerFirst(valueName(catalogue, key, v)))
    const rows = arr(spec.rows).map(r => lowerFirst(rowName(catalogue, key, r)))
    const cols = arr(spec.columns).map(r => lowerFirst(rowName(catalogue, key, r)))
    let text = values.length ? andList(values, 5) : 'How many ' + lowerFirst(subject.label)
    if (rows.length) text += ' by ' + rows.join(' then by ')
    if (cols.length) text += (rows.length ? ', with ' : ' with ') + andList(cols) + ' across the top'
    if (!rows.length && !cols.length) text += ' in total'
    parts.push(upperFirst(text))
    if (spec.limit) {
      const which = spec.limit.top ? 'top' : 'bottom'
      const by = shown.find(v => v.key === rankKey(spec))
      parts.push('the ' + which + ' ' + spec.limit[which] + (by ? ' by ' + lowerFirst(valueName(catalogue, key, by)) : '')
        + (spec.limit.rest_as ? ' with the rest together as "' + spec.limit.rest_as + '"' : ''))
    }
  }

  // What it is filtered by, other than its period and venues (said below).
  const params = arr(spec.params)
  const paramOf = k => params.find(p => p.key === k)
  const filters = []
  for (const f of arr(spec.filters)) {
    const param = f.param ? paramOf(f.param) : null
    if (f.param && !param) continue
    if (param?.type === 'period' || param?.type === 'venues') continue
    // Asked each time: as it starts, or the field alone when it starts empty.
    if (param && f.field && blankValue(param.default)) {
      filters.push(lowerFirst(pathLabel(catalogue, key, f.field, f.bucket)) + ' chosen each time')
      continue
    }
    const words = filterWords(catalogue, key, f, { ...ctx, params })
    if (words) filters.push(lowerFirst(words) + (param ? ' (chosen each time)' : ''))
  }
  if (filters.length) parts.push('where ' + andList(filters, 5))

  const period = params.find(p => p.type === 'period')
  const venues = params.find(p => p.type === 'venues')
  const when = period ? (ctx.periodText || periodName(period.default)) : ''
  // "Last month (Oct 2026)" reads "for last month ..."; "Oct 2026" keeps its capital.
  const relative = !!normalisePeriod(period?.default)?.relative
  const where = venues ? venuesWords(venues.default, ctx.venues) : ''
  const whenWhere = [when ? 'for ' + (relative ? lowerFirst(when) : when) : '', where].filter(Boolean).join(' ')
  if (whenWhere) parts.push(whenWhere)

  if (spec.compare?.with === 'previous_period') parts.push('compared with the period before')
  if (spec.compare?.with === 'last_year') parts.push('compared with the same dates last year')
  if (DRAWN_AS[spec.view?.kind] && spec.kind !== 'list') parts.push('drawn as ' + DRAWN_AS[spec.view.kind])

  return parts.join(', ') + '.'
}
