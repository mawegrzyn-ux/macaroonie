// src/services/sites.js
//
// Above the store (Pepper-first step 7c, reports/AI first back office
// strategy.md "Above the store: which site is off, and why"): for someone
// who runs several venues, each venue ranked by what needs it today, with
// the reasons, and the share of its tasks done in their window today and
// this week. By site, never by person (decision 8 of docs/PEPPER_FIRST.md 13).
//
// Read from the feed's own record (ops_task_days, migration 278), which the
// notices sweep keeps every five minutes per venue as the group's owner, so
// every area counts and no feed is worked out here. Cost per request: two
// queries (the group's venues, and one grouped read of ops_task_days over at
// most the last seven days of the group's venues), no route calls, no cache.
// The figures are as fresh as the last sweep (`seen_at`); a venue the sweep
// hasn't recorded today says so (`recorded: false`).
//
//   siteCounts(row)      a venue-day's counts -> { late, skipped, out_of_range, cash_up, offline }
//   completion(rows)     { due, in_window, share }: of the tasks that were
//                        due (finished, went late or were skipped), the share
//                        finished before they went late; null with none due
//   siteScore(counts)    the ranking: WEIGHTS times each count, summed
//   rankSites(venues, rows, now)   the venues ranked, with reasons and completion
//   sitesFor(tenantId)   all of it from the database

import { withTenant } from '../config/db.js'
import { localParts } from './opsTasks.js'

// What needs a site, and how much each counts in the ranking. Higher first;
// then the lower completion today; then the name.
export const WEIGHTS = { late: 3, out_of_range: 3, cash_up: 2, offline: 2, skipped: 1 }
const OFFLINE_KINDS = ['screen_offline', 'device_offline']

const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const mondayOf = date => addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7))

/** A venue-day's counts of what needs doing, from its grouped record row. */
export function siteCounts(r = {}) {
  return {
    late: r.late || 0, skipped: r.skipped || 0, out_of_range: r.out_of_range || 0,
    cash_up: r.cash_up || 0, offline: r.offline || 0,
  }
}

/** The share of due tasks done in their window, over venue-day rows: { due, in_window, share }. */
export function completion(rows) {
  let due = 0
  let inWindow = 0
  for (const r of rows) { due += r.due || 0; inWindow += r.in_window || 0 }
  return { due, in_window: inWindow, share: due ? Math.round((inWindow / due) * 1000) / 10 : null }
}

export const siteScore = c => Object.entries(WEIGHTS).reduce((n, [k, w]) => n + w * (c[k] || 0), 0)

/** The reasons a site needs someone, as chips: [{ key, text, tone }]. */
export function siteReasons(c) {
  const out = []
  if (c.late) out.push({ key: 'late', text: plural(c.late, 'task') + ' late', tone: 'red' })
  if (c.out_of_range) out.push({ key: 'out_of_range', text: plural(c.out_of_range, 'check') + ' out of range', tone: 'red' })
  if (c.cash_up) out.push({ key: 'cash_up', text: c.cash_up === 1 ? 'Cash-up missing' : c.cash_up + ' cash-ups missing', tone: 'amber' })
  if (c.offline) out.push({ key: 'offline', text: plural(c.offline, 'device') + ' offline', tone: 'amber' })
  if (c.skipped) out.push({ key: 'skipped', text: plural(c.skipped, 'task') + ' skipped today', tone: 'slate' })
  return out
}

/**
 * The venues ranked. `venues`: [{ id, name, timezone }]; `rows`: the grouped
 * record (venue_id, day, the counts, due, in_window, seen_at); `now`: the
 * instant. Each venue's today and week are its own (its time zone).
 */
export function rankSites(venues, rows, now = new Date()) {
  const sites = venues.map(v => {
    const today = localParts(now, v.timezone).date
    const monday = mondayOf(today)
    const mine = rows.filter(r => r.venue_id === v.id)
    const day = mine.find(r => r.day === today)
    const week = mine.filter(r => r.day >= monday && r.day <= today)
    const counts = siteCounts(day)
    return {
      venue_id: v.id, name: v.name, date: today,
      counts, score: siteScore(counts), reasons: siteReasons(counts),
      today: completion(day ? [day] : []), week: completion(week),
      recorded: !!day, seen_at: day?.seen_at ?? null,
    }
  })
  sites.sort((a, b) => b.score - a.score
    || (a.today.share ?? 101) - (b.today.share ?? 101)
    || a.name.localeCompare(b.name))
  return sites
}

/** Every active venue of the group, ranked, with the group's own completion today and this week. */
export async function sitesFor(tenantId, now = new Date()) {
  const { venues, rows } = await withTenant(tenantId, async tx => {
    const venues = await tx`
      SELECT id, name, timezone FROM venues WHERE tenant_id = ${tenantId} AND is_active = true ORDER BY name`
    if (!venues.length) return { venues, rows: [] }
    // Seven days back from the earliest venue's today covers every venue's week so far.
    const days = venues.map(v => localParts(now, v.timezone).date).sort()
    const rows = await tx`
      SELECT venue_id, day::text AS day,
             -- Late: a corrective action is late from the start; it counts as out of range, not twice.
             count(*) FILTER (WHERE late_at IS NOT NULL AND finished_at IS NULL AND NOT skipped AND kind <> 'corrective_action')::int AS late,
             count(*) FILTER (WHERE skipped)::int AS skipped,
             count(*) FILTER (WHERE kind = 'corrective_action' AND finished_at IS NULL AND NOT skipped)::int AS out_of_range,
             count(*) FILTER (WHERE kind = 'cash_up' AND finished_at IS NULL AND NOT skipped)::int AS cash_up,
             count(*) FILTER (WHERE kind = ANY(${OFFLINE_KINDS}::text[]) AND finished_at IS NULL AND NOT skipped)::int AS offline,
             count(*) FILTER (WHERE finished_at IS NOT NULL OR late_at IS NOT NULL OR skipped)::int AS due,
             count(*) FILTER (WHERE finished_at IS NOT NULL AND NOT skipped AND (late_at IS NULL OR finished_at <= late_at))::int AS in_window,
             max(last_seen_at) AS seen_at
        FROM ops_task_days
       WHERE tenant_id = ${tenantId} AND day >= ${addDays(days[0], -6)}::date AND day <= ${days[days.length - 1]}::date
       GROUP BY venue_id, day`
    return { venues, rows }
  })
  const sites = rankSites(venues, rows, now)
  const mine = rows.filter(r => sites.some(s => s.venue_id === r.venue_id && r.day === s.date))
  const weeks = rows.filter(r => sites.some(s => s.venue_id === r.venue_id && r.day >= mondayOf(s.date) && r.day <= s.date))
  return { sites, today: completion(mine), week: completion(weeks) }
}
