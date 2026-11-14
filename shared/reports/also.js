// shared/reports/also.js
//
// Figures from other subjects in one report (docs/REPORTS.md 7.1): sales
// beside the hours on the rota, or beside the weather. A definition's
// `also` names up to three other subjects, and a value that says
// `from: <key>` is one of theirs. Each subject is grouped by what the
// report's rows show, in a query of its own, and the rows are lined up by
// their values afterwards: nothing is ever joined row to row, so no figure
// is counted twice.
//
// This file says how a row of the report's own subject is found in another
// subject, for the engine, the builder and Pepper alike:
//
//   the report's day      the other subject's own day, grouped the same
//                         way; a weekly subject (each row on its week's
//                         Monday) only by week or longer
//   a thing both lead to  a venue, a dish, a server: the same field of it,
//                         through the other subject's own links to it
//   anything else         only when the other subject is the same subject
//
// and which of the report's filters apply to the other subject too: those
// on the report's day and on its venue (the period and venues choices).

import { resolvePath, pathLabel, bucketsFor } from './paths.js'

/** How many links are walked from another subject to a thing the report's rows lead to. */
export const ALSO_HOPS = 2
/** What a weekly subject can be grouped by and still line up with days. */
export const WEEKLY_BUCKETS = ['week', 'month', 'quarter', 'year']

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const no = why => ({ ok: false, why })
const yes = (field, bucket) => ({ ok: true, field, ...(bucket ? { bucket } : {}) })

/** 'week' when each row of a subject sits on its week's Monday, else 'day'. */
export const grainOf = subject => (subject?.fields?.date?.grain === 'week' ? 'week' : 'day')

/**
 * Every way from one subject to another through one-row links, shortest
 * first and in the catalogue's order: [['check', 'server'], ['taken_by']].
 * A list of rows (a `many` link) is never walked: its rows would repeat.
 */
export function routesTo(catalogue, fromKey, toKey, maxHops = ALSO_HOPS) {
  const out = []
  let frontier = [{ key: fromKey, path: [], seen: [fromKey] }]
  for (let depth = 0; depth < maxHops && frontier.length; depth++) {
    const next = []
    for (const n of frontier) {
      for (const [k, l] of Object.entries(catalogue.subjects[n.key]?.links || {})) {
        if (l.many || l.hidden || n.seen.includes(l.to)) continue
        const path = [...n.path, k]
        if (l.to === toKey) out.push(path)
        else next.push({ key: l.to, path, seen: [...n.seen, l.to] })
      }
    }
    frontier = next
  }
  return out
}

/**
 * Where a row of a report about `mainKey` is found in `otherKey`'s rows:
 * { ok: true, field, bucket? } (a row for the other subject's own query),
 * or { ok: false, why } with a sentence saying why they can't be lined up.
 * `row` is { field, bucket? }, a path from the report's own subject.
 */
export function matchRow(catalogue, mainKey, row, otherKey) {
  const main = catalogue?.subjects?.[mainKey]
  const other = catalogue?.subjects?.[otherKey]
  if (!main) return no('There is nothing to report on called "' + mainKey + '"')
  if (!other) return no('There is nothing to report on called "' + otherKey + '"')
  const r = resolvePath(catalogue, mainKey, row?.field)
  if (!r.ok) return no(r.why)
  if (r.kind !== 'field') return no('"' + row.field + '" isn\'t something to group by')
  const bucket = row.bucket && bucketsFor(r.def.type).includes(row.bucket) && row.bucket !== 'day' ? row.bucket : null
  const what = lowerFirst(pathLabel(catalogue, mainKey, row.field, bucket))

  // The same subject (lunch beside dinner): the same field.
  if (otherKey === mainKey) return yes(row.field, bucket)

  // The report's own day: the other subject's own day.
  if (!r.hops.length && r.key === 'date') {
    if (!other.fields?.date) return no(other.label + ' has no day of its own, so it can\'t be lined up by ' + what + '.')
    const mainWeekly = grainOf(main) === 'week'
    const otherWeekly = grainOf(other) === 'week'
    if (mainWeekly && !otherWeekly) {
      // Each of the report's rows is a week (its Monday): the other's days by week.
      if (!bucket || bucket === 'week') return yes('date', 'week')
      if (WEEKLY_BUCKETS.includes(bucket)) return yes('date', bucket)
      return no(main.label + ' has a row for each week, so it can\'t be lined up with ' + lowerFirst(other.label) + ' by ' + what + '.')
    }
    if (otherWeekly && !mainWeekly && !WEEKLY_BUCKETS.includes(bucket)) {
      return no(other.label + ' has a row for each week, so it lines up by week, month, quarter or year, not by ' + what + '.')
    }
    return yes('date', bucket)
  }

  // A field of the report's own rows means nothing to another subject.
  if (!r.hops.length) return no(other.label + ' can\'t be lined up by ' + what + ': it belongs to ' + lowerFirst(main.label) + ' only.')

  // A thing both lead to: the same field of it, through the other subject's links.
  const target = r.subject.key
  if (otherKey === target) return yes(r.key, bucket)
  const routes = routesTo(catalogue, otherKey, target)
  if (!routes.length) return no(other.label + ' isn\'t linked to ' + lowerFirst(r.subject.label) + ', so it can\'t be lined up by ' + what + '.')
  // The same link name first (a check's server, not who took a payment), then the shortest.
  const last = r.hops[r.hops.length - 1].key
  const route = routes.find(p => p[p.length - 1] === last) || routes[0]
  return yes([...route, r.key].join('.'), bucket)
}

/**
 * Every row of a report found in another subject, in the report's order:
 * { ok: true, rows: [{ field, bucket? }] }, or { ok: false, missing: [{ row, why }] }
 * listing each row that can't be lined up.
 */
export function matchRows(catalogue, spec, otherKey) {
  const rows = []
  const missing = []
  for (const row of spec.rows || []) {
    const m = matchRow(catalogue, spec.subject, row, otherKey)
    if (m.ok) rows.push({ field: m.field, ...(m.bucket ? { bucket: m.bucket } : {}) })
    else missing.push({ row, why: m.why })
  }
  return missing.length ? { ok: false, missing } : { ok: true, rows }
}

const onDay = f => f && typeof f.field === 'string' && f.field === 'date'
const onVenue = f => f && typeof f.field === 'string' && (f.field === 'venue' || f.field.startsWith('venue.'))

/**
 * The report's filters that apply to another subject too: those on the
 * report's day (the period) and on its venue (the venues). A filter in a
 * group of filters (any, all, has) stays with the report's own subject.
 * { filters, left }: `left` are the ones the other subject can't take (it
 * has no day or no venue, or one subject is weekly and the filter picks
 * days rather than a period or whole weeks), so the engine can say so when
 * they narrow anything.
 */
export function sharedFilters(catalogue, spec, otherKey) {
  const main = catalogue?.subjects?.[spec.subject]
  const other = catalogue?.subjects?.[otherKey]
  const filters = []
  const left = []
  if (!main || !other) return { filters, left }
  for (const f of spec.filters || []) {
    if (onDay(f)) {
      // Days and weeks agree on a period and on weeks or longer; "Fridays"
      // or "the 5th" mean different rows in each, so those stay put.
      const sameGrain = grainOf(main) === grainOf(other)
      const fits = !!other.fields?.date
        && (sameGrain || (f.op === 'in_period' && !f.bucket) || WEEKLY_BUCKETS.includes(f.bucket))
      ;(fits ? filters : left).push(f)
    } else if (onVenue(f)) {
      const fits = !!other.links?.venue && other.links.venue.to === main.links?.venue?.to
      ;(fits ? filters : left).push(f)
    }
  }
  return { filters, left }
}
