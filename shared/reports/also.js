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

/** Whether a filter of the report is one another subject can take: on the report's day or its venue. */
export const isShared = f => onDay(f) || onVenue(f)

/**
 * A filter of the report on its day or its venue, as another subject takes
 * it: { ok: true, filter } or { ok: false, why }. Between a daily and a
 * weekly subject a filter is translated, not copied:
 *
 *   weekly report, daily other   the days of the weeks it picks (grouped
 *                                by week: "week starting 5 Oct" is every
 *                                day of that week)
 *   daily report, weekly other   a period or whole weeks, months, quarters
 *                                and years only: a weekly row is the week
 *                                starting in the period; "Fridays" or one
 *                                day have no weekly row
 */
export function translateFilter(catalogue, mainKey, otherKey, f) {
  const main = catalogue?.subjects?.[mainKey]
  const other = catalogue?.subjects?.[otherKey]
  if (!main || !other || !isShared(f)) return no('That filter stays with the report\'s own subject')
  const what = lowerFirst(pathLabel(catalogue, mainKey, f.field, f.bucket))
  if (onVenue(f)) {
    return other.links?.venue && other.links.venue.to === main.links?.venue?.to
      ? { ok: true, filter: f }
      : no(other.label + ' has no venue, so the filter on ' + what + ' doesn\'t apply to it.')
  }
  if (!other.fields?.date) return no(other.label + ' has no day of its own, so the filter on ' + what + ' doesn\'t apply to it.')
  const mainWeekly = grainOf(main) === 'week'
  const otherWeekly = grainOf(other) === 'week'
  if (mainWeekly === otherWeekly) return { ok: true, filter: f }
  if (otherWeekly) {
    if (WEEKLY_BUCKETS.includes(f.bucket) || (!f.bucket && f.op === 'in_period')) return { ok: true, filter: f }
    return no(other.label + ' has a row for each week, so the filter on ' + what + ' doesn\'t apply to it.')
  }
  // A weekly report's day is its week's Monday: the other subject's days by week.
  if (!f.bucket || f.bucket === 'week') return { ok: true, filter: { ...f, bucket: 'week' } }
  if (WEEKLY_BUCKETS.includes(f.bucket)) return { ok: true, filter: f }
  return no(main.label + ' has a row for each week, so the filter on ' + what + ' doesn\'t apply to ' + lowerFirst(other.label) + '.')
}

/**
 * The report's filters that apply to another subject too: those on the
 * report's day (the period) and on its venue (the venues), as that subject
 * takes them (translateFilter()). A filter in a group of filters (any, all,
 * has) stays with the report's own subject. { filters, left }: `left` are
 * [{ filter, why }] for the ones the other subject can't take (it has no day
 * or no venue, or one subject is weekly and the filter picks days rather
 * than a period or whole weeks), so the engine can say so when they narrow
 * anything.
 */
export function sharedFilters(catalogue, spec, otherKey) {
  const filters = []
  const left = []
  if (!catalogue?.subjects?.[spec.subject] || !catalogue?.subjects?.[otherKey]) return { filters, left }
  for (const f of spec.filters || []) {
    if (!isShared(f)) continue
    const t = translateFilter(catalogue, spec.subject, otherKey, f)
    if (t.ok) filters.push(t.filter)
    else left.push({ filter: f, why: t.why })
  }
  return { filters, left }
}

/**
 * A drilled row's groupings (each held to its value) as another subject
 * finds them: { ok: true, filters } or { ok: false, why }. Filters on the
 * report's day or venue are left to sharedFilters() (they are the report's
 * filters by then); every other one is moved onto the field the other
 * subject lines that grouping up by (matchRow()). One the other subject
 * can't line up by means its figures can't be shown for this row.
 */
export function heldFilters(catalogue, mainKey, otherKey, held) {
  const filters = []
  for (const f of held || []) {
    if (isShared(f)) continue
    const m = matchRow(catalogue, mainKey, { field: f.field, ...(f.bucket ? { bucket: f.bucket } : {}) }, otherKey)
    if (!m.ok) return m
    const { bucket: _b, ...rest } = f
    filters.push({ ...rest, field: m.field, ...(m.bucket ? { bucket: m.bucket } : {}) })
  }
  return { ok: true, filters }
}
