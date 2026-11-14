// src/reports/work/safety.js
//
// Each venue's H&S day worked out in code for a report run (docs/REPORTS.md
// 20, phase 3b), merged into WORKS in work/index.js: computeHsStatus()
// (services/hsStatus.js), the rule the Overview's H&S tiles and Pepper's
// hs_status show, flattened to one row per venue and day with the figures of
// each kind of check.
//
// Which days: every day of the run's periods up to today at each venue (a
// day still to come has nothing to say yet), at venues that are switched on.
// A report over every day starts on the first day anyone logged a check or
// completed a checklist, and a period covers MAX_DAYS at most (its most
// recent days). What a day expects is the checks set up now (fridges and
// their check times, hold stations, cooking sessions, checklists), as on the
// Overview: a fridge added last month is expected on earlier days too.

import { computeHsStatus, deriveStatus } from '../../services/hsStatus.js'
import { todayIn, addDays } from '../../../../shared/reports/period.js'

// The tables the H&S days are worked out from (the catalogue's from.tables).
// The settings they read as well (check times, opening days) stay decided as
// settings in catalogue/decisions.js.
export const HS_TABLES = [
  'checklist_templates', 'checklist_instances',
  'fs_equipment', 'fs_temp_logs', 'fs_hold_stations', 'fs_hold_checks',
  'fs_cooking_sessions', 'fs_cooking_checks', 'fs_delivery_checks',
]

/** The longest run of days one period is worked out for (about three years). */
export const MAX_DAYS = 1100

const COUNTS = [
  'expected', 'completed', 'missed', 'unresolved',
  'checklists_expected', 'checklists_done', 'checklists_missed',
  'fridge_expected', 'fridge_done', 'fridge_missed', 'fridge_unresolved',
  'hold_expected', 'hold_done', 'hold_missed', 'hold_unresolved',
  'cooking_expected', 'cooking_done', 'cooking_missed', 'cooking_unresolved',
  'deliveries', 'delivery_unresolved',
  'fs_expected', 'fs_done', 'fs_missed',
]

const short = (due, done) => Math.max(due - done, 0)

/** One venue's day from computeHsStatus() as a report row. */
export function hsDayRow(tenantId, date, v) {
  const required = v.checklists.filter(c => !c.not_required)
  const cat = key => v.categories.find(c => c.key === key) || { expected: 0, completed: 0, unresolved: 0 }
  const fridge = cat('equipment'), hold = cat('hold'), cooking = cat('cooking'), delivery = cat('delivery')
  const checklistsDone = required.filter(c => c.completed).length
  const fsExpected = fridge.expected + hold.expected + cooking.expected
  const fsDone = fridge.completed + hold.completed + cooking.completed
  return {
    tenant_id: tenantId,
    id: v.venue_id + '|' + date,
    venue_id: v.venue_id,
    date,
    status: v.status,
    // Food safety's own colour by the same rule: the fridge, hold and cooking
    // checks due and done, and anything unresolved (deliveries included).
    fs_status: v.closed && fsExpected === 0 && v.unresolved === 0 ? 'closed' : deriveStatus(fsExpected, fsDone, v.unresolved),
    closed: v.closed,
    expected: v.expected,
    completed: v.completed,
    missed: short(v.expected, v.completed),
    unresolved: v.unresolved,
    checklists_expected: required.length,
    checklists_done: checklistsDone,
    checklists_missed: required.length - checklistsDone,
    fridge_expected: fridge.expected, fridge_done: fridge.completed,
    fridge_missed: short(fridge.expected, fridge.completed), fridge_unresolved: fridge.unresolved,
    hold_expected: hold.expected, hold_done: hold.completed,
    hold_missed: short(hold.expected, hold.completed), hold_unresolved: hold.unresolved,
    cooking_expected: cooking.expected, cooking_done: cooking.completed,
    cooking_missed: short(cooking.expected, cooking.completed), cooking_unresolved: cooking.unresolved,
    // Deliveries aren't scheduled: they are counted, never due.
    deliveries: delivery.expected, delivery_unresolved: delivery.unresolved,
    fs_expected: fsExpected,
    fs_done: fsDone,
    fs_missed: short(fsExpected, fsDone),
  }
}

/**
 * The runs of days to work out: the ranges (null = from `first`) up to
 * `last`, joined where they meet, each MAX_DAYS at most.
 */
export function hsSpans(ranges, first, last) {
  const asked = ranges ? ranges.map(r => ({ from: r.from, to: r.to })) : (first ? [{ from: first, to: last }] : [])
  const clipped = asked
    .map(r => ({ from: r.from, to: r.to > last ? last : r.to }))
    .filter(r => r.from && r.to && r.from <= r.to)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const out = []
  for (const r of clipped) {
    const prev = out[out.length - 1]
    if (prev && r.from <= addDays(prev.to, 1)) { if (r.to > prev.to) prev.to = r.to }
    else out.push({ ...r })
  }
  for (const s of out) {
    const earliest = addDays(s.to, -(MAX_DAYS - 1))
    if (s.from < earliest) s.from = earliest
  }
  return out
}

/** The first day anyone logged a check or completed a checklist at these venues, or null. */
async function firstHsDay(tx, tenantId, venueIds) {
  const [row] = await tx.unsafe(`
    SELECT LEAST(
      (SELECT min(log_date) FROM fs_temp_logs WHERE tenant_id = $1 AND venue_id = ANY($2::uuid[])),
      (SELECT min(check_date) FROM fs_hold_checks WHERE tenant_id = $1 AND venue_id = ANY($2::uuid[])),
      (SELECT min(check_date) FROM fs_cooking_checks WHERE tenant_id = $1 AND venue_id = ANY($2::uuid[])),
      (SELECT min(delivery_date) FROM fs_delivery_checks WHERE tenant_id = $1 AND venue_id = ANY($2::uuid[])),
      (SELECT min(period_start) FROM checklist_instances WHERE tenant_id = $1 AND venue_id = ANY($2::uuid[]))
    )::text AS first`, [tenantId, venueIds])
  return row?.first || null
}

export const SAFETY_WORKS = {
  hs_days: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['date', 'date'],
      ['status', 'text'], ['fs_status', 'text'], ['closed', 'boolean'],
      ...COUNTS.map(c => [c, 'int']),
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const venues = await tx`
        SELECT id, timezone FROM venues
         WHERE tenant_id = ${tenantId} AND is_active = true
           ${venueIds ? tx`AND id = ANY(${venueIds}::uuid[])` : tx``}`
      if (!venues.length) return []
      const todayOf = new Map(venues.map(v => [v.id, todayIn(v.timezone || 'Europe/London')]))
      const last = [...todayOf.values()].sort().pop()
      const ids = venues.map(v => v.id)
      const first = ranges ? null : await firstHsDay(tx, tenantId, ids)
      const rows = []
      for (const span of hsSpans(ranges, first, last)) {
        const res = await computeHsStatus(tx, tenantId, span.from, span.to, last, { venueIds: ids })
        for (const day of res.days) {
          for (const v of day.venues) {
            if (day.date > todayOf.get(v.venue_id)) continue
            rows.push(hsDayRow(tenantId, day.date, v))
          }
        }
      }
      return rows
    },
  },
}
