// src/services/rotaWeeks.js
//
// Rota weeks as the Rota page works them out: everything services/
// rotaCalc.js needs for a venue's week, read from the database, then
// computeRotaWeek(). One week at a time for the Rota page's pay routes
// (routes/rota.js), many at once for the report builder's rota subjects
// (reports/work/index.js), with the same queries, so a report and the page
// can never disagree.
//
//   computeWeek(tx, tenantId, venueId, monday, { carry })    one week
//   loadRotaWeeks(tx, tenantId, pairs, { carry, memo })      many weeks:
//     pairs [{ venueId, monday }] -> Map 'venueId|monday' -> week
//
// carry (default true) adds what earlier weeks left unallocated: every
// earlier £ tap (minus the sum of tip_unallocated) plus what each earlier
// week's spare points were worth. Only weeks with spare points left need
// their pots worked out (without their own carry). Pay and checks on
// people's own balances don't need it: pass carry: false.
//
// memo (a Map) keeps weeks worked out in one transaction, so a report over
// many weeks works out each earlier week with spare points once.
//
// The loaders the Rota page's other routes share (settings, shifts, tip
// pots, staff, entries, who is off the rota) live here too, so there is
// one copy of each.

import { computeRotaWeek } from './rotaCalc.js'

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

const keyOf = (venueId, monday) => venueId + '|' + monday

export async function loadSettings(tx, tenantId) {
  const [row] = await tx`
    SELECT mode, slot_minutes, tip_round_to::float8 AS tip_round_to, tip_round_mode,
           hide_closed_on_rota, hide_closed_on_print
      FROM rota_settings WHERE tenant_id = ${tenantId}
  `
  return row ?? {
    mode: 'day_parts', slot_minutes: 30, tip_round_to: null, tip_round_mode: 'nearest',
    hide_closed_on_rota: false, hide_closed_on_print: false,
  }
}

export function loadShifts(tx, tenantId) {
  return tx`
    SELECT id, name, start_time::text AS start_time, end_time::text AS end_time,
           points::float8 AS points, sort_order, is_active
      FROM rota_shifts
     WHERE tenant_id = ${tenantId}
     ORDER BY sort_order, start_time, id
  `
}

/** Tip pots with their manual lines and allocated SC source ids (all venues). */
export async function loadPots(tx, tenantId) {
  const [pots, lines, sources] = await Promise.all([
    tx`SELECT id, name, distribution, payout_method, payout_to, surcharges, sort_order, is_active FROM tip_pots
        WHERE tenant_id = ${tenantId} ORDER BY sort_order, name, id`,
    tx`SELECT id, pot_id, name, kind, sort_order, is_active FROM tip_pot_lines
        WHERE tenant_id = ${tenantId} ORDER BY sort_order, created_at, id`,
    tx`SELECT id, tip_pot_id FROM cash_sc_sources
        WHERE tenant_id = ${tenantId} AND tip_pot_id IS NOT NULL`,
  ])
  return pots.map(p => ({
    ...p,
    lines:      lines.filter(l => l.pot_id === p.id),
    source_ids: sources.filter(x => x.tip_pot_id === p.id).map(x => x.id),
  }))
}

/** Every staff member of these venues, active or not, in the Staff page's
 *  order, each with their role and per-shift rates. */
export async function loadVenueStaff(tx, tenantId, venueIds) {
  const rows = await tx`
    SELECT s.id, s.venue_id, s.name, s.role_id, s.pay_type, s.pay_basis,
           s.default_rate::float8 AS default_rate, s.pay_method, s.bank_amount::float8 AS bank_amount,
           s.is_active, s.sort_order, s.left_on::text AS left_on, s.left_note,
           r.name AS role_name, r.points_multiplier::float8 AS role_multiplier
      FROM cash_staff s
      LEFT JOIN staff_roles r ON r.id = s.role_id AND r.tenant_id = s.tenant_id
     WHERE s.tenant_id = ${tenantId}
       AND s.venue_id = ANY(${venueIds}::uuid[])
     ORDER BY s.venue_id, s.sort_order, s.name, s.id
  `
  if (!rows.length) return rows
  const rates = await tx`
    SELECT staff_id, shift_id, rate::float8 AS rate
      FROM staff_shift_rates
     WHERE tenant_id = ${tenantId}
       AND staff_id = ANY(${rows.map(r => r.id)}::uuid[])
  `
  const byStaff = {}
  for (const r of rates) (byStaff[r.staff_id] ??= {})[r.shift_id] = r.rate
  return rows.map(r => ({ ...r, shift_rates: byStaff[r.id] ?? {} }))
}

// Rows of a query over the venue weeks, by 'venue|monday', without those two.
function byWeek(rows) {
  const out = new Map()
  for (const { venue_id, monday, ...r } of rows) {
    const key = keyOf(venue_id, monday)
    const list = out.get(key)
    if (list) list.push(r)
    else out.set(key, [r])
  }
  return out
}

// The venue weeks as two arrays, for unnest() in a query.
const weekArrays = pairs => [pairs.map(p => p.venueId), pairs.map(p => p.monday)]

/** Rota entries of each venue week, by day then start time. */
async function entriesFor(tx, tenantId, pairs) {
  const [venues, mondays] = weekArrays(pairs)
  return byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday,
           e.id, e.staff_id, e.work_date::text AS work_date, e.shift_id,
           to_char(e.start_time, 'HH24:MI') AS start_time,
           to_char(e.end_time,   'HH24:MI') AS end_time, e.status
      FROM unnest(${venues}::uuid[], ${mondays}::date[]) AS w(venue_id, monday)
      JOIN rota_entries e ON e.tenant_id = ${tenantId} AND e.venue_id = w.venue_id
       AND e.work_date BETWEEN w.monday AND w.monday + 6
     ORDER BY w.venue_id, w.monday, e.work_date, e.start_time NULLS FIRST, e.id
  `)
}

/** One venue week's rota entries (the Rota grid, copying a week). */
export async function loadEntries(tx, tenantId, venueId, monday) {
  return (await entriesFor(tx, tenantId, [{ venueId, monday }])).get(keyOf(venueId, monday)) ?? []
}

/** Who has left and who has an off-rota period, at these venues, between from and to. */
export async function offRowsFor(tx, tenantId, venueIds, from, to) {
  const [left, periods] = await Promise.all([
    tx`SELECT id, venue_id, left_on::text AS left_on, left_note FROM cash_staff
        WHERE tenant_id = ${tenantId} AND venue_id = ANY(${venueIds}::uuid[])
          AND left_on IS NOT NULL AND left_on < ${to}::date`,
    tx`SELECT o.staff_id, s.venue_id, o.from_date::text AS from_date, o.to_date::text AS to_date, o.note
         FROM staff_rota_off o
         JOIN cash_staff s ON s.id = o.staff_id AND s.tenant_id = o.tenant_id
        WHERE o.tenant_id = ${tenantId} AND s.venue_id = ANY(${venueIds}::uuid[])
          AND o.from_date <= ${to}::date AND o.to_date >= ${from}::date`,
  ])
  return { left, periods }
}

/**
 * Who is off the rota on which of `dates` at a venue (migration 164): people
 * past their last working day (cash_staff.left_on) and people in an off-rota
 * period. Map staff_id -> { [date]: { kind: 'left', left_on, note } |
 * { kind: 'off', from, until, note } }. Leaving wins over a period on the
 * same day.
 */
export function offDayMarks({ left, periods }, venueId, dates) {
  const out = new Map()
  const mark = (id, date, v) => {
    const m = out.get(id) ?? {}
    m[date] ??= v
    out.set(id, m)
  }
  for (const s of left) {
    if (s.venue_id !== venueId) continue
    for (const d of dates) if (d > s.left_on) mark(s.id, d, { kind: 'left', left_on: s.left_on, note: s.left_note })
  }
  for (const p of periods) {
    if (p.venue_id !== venueId) continue
    for (const d of dates) if (d >= p.from_date && d <= p.to_date) mark(p.staff_id, d, { kind: 'off', from: p.from_date, until: p.to_date, note: p.note })
  }
  return out
}

export async function loadOffDays(tx, tenantId, venueId, dates) {
  return offDayMarks(await offRowsFor(tx, tenantId, [venueId], dates[0], dates[dates.length - 1]), venueId, dates)
}

/** True when the person is off the rota on every one of `dates`. */
export const offAll = (offDays, staffId, dates) => {
  const m = offDays.get(staffId)
  return !!m && dates.every(d => m[d])
}

/** Each venue week's tip moves, oldest first, each with its recipient lines. */
async function movesFor(tx, tenantId, pairs) {
  const [venues, mondays] = weekArrays(pairs)
  const moves = await tx`
    SELECT w.venue_id, w.monday::text AS monday,
           m.id, m.kind, m.action, m.from_staff_id, m.note, m.created_by, m.created_at
      FROM unnest(${venues}::uuid[], ${mondays}::date[]) AS w(venue_id, monday)
      JOIN rota_tip_moves m ON m.tenant_id = ${tenantId} AND m.venue_id = w.venue_id AND m.week_start = w.monday
     ORDER BY w.venue_id, w.monday, m.created_at, m.id
  `
  if (!moves.length) return new Map()
  const lines = await tx`
    SELECT move_id, to_staff_id, amount::float8 AS amount
      FROM rota_tip_move_lines
     WHERE tenant_id = ${tenantId} AND move_id = ANY(${moves.map(m => m.id)}::uuid[])
  `
  return byWeek(moves.map(m => ({ ...m, lines: lines.filter(l => l.move_id === m.id).map(({ move_id, ...l }) => l) })))
}

/**
 * What earlier weeks left unallocated, carried into each venue week (see
 * the top of the file). Map 'venue|monday' -> amount.
 */
async function carriedInFor(tx, tenantId, pairs, memo) {
  const venues = [...new Set(pairs.map(p => p.venueId))]
  const last = pairs.reduce((m, p) => (p.monday > m ? p.monday : m), pairs[0].monday)
  // Every earlier week's £ taps (in pence, exact) and whether it has spare points.
  const weeks = await tx`
    SELECT venue_id, week_start::text AS week,
           (COALESCE(SUM(tip_unallocated), 0) * 100)::float8 AS pence,
           COALESCE(SUM(points_nudge), 0) < 0 AS spare
      FROM rota_week_staff
     WHERE tenant_id = ${tenantId} AND venue_id = ANY(${venues}::uuid[]) AND week_start < ${last}::date
     GROUP BY venue_id, week_start
     ORDER BY venue_id, week_start
  `
  const before = p => weeks.filter(w => w.venue_id === p.venueId && w.week < p.monday)
  const spare = []
  for (const p of pairs) for (const w of before(p)) if (w.spare) spare.push({ venueId: w.venue_id, monday: w.week })
  const spareWeeks = spare.length ? await loadRotaWeeks(tx, tenantId, spare, { carry: false, memo }) : new Map()
  const out = new Map()
  for (const p of pairs) {
    const earlier = before(p)
    let total = 0 - earlier.reduce((s, w) => s + w.pence, 0) / 100
    for (const w of earlier) if (w.spare) total += spareWeeks.get(keyOf(w.venue_id, w.week)).totals.tips_unallocated_points
    out.set(keyOf(p.venueId, p.monday), Math.round(total * 100) / 100)
  }
  return out
}

/**
 * Rota weeks for several venue weeks at once: Map 'venueId|monday' -> what
 * computeWeek() gives for each. Mondays must be Mondays.
 */
export async function loadRotaWeeks(tx, tenantId, pairs, { carry = true, memo = new Map() } = {}) {
  const out = new Map()
  const todo = []
  const seen = new Set()
  for (const p of pairs) {
    const key = keyOf(p.venueId, p.monday)
    if (seen.has(key)) continue
    seen.add(key)
    const known = memo.get(key + '|' + carry)
    if (known) out.set(key, known)
    else todo.push({ venueId: p.venueId, monday: p.monday })
  }
  if (!todo.length) return out

  const venues = [...new Set(todo.map(p => p.venueId))]
  const mondays = todo.map(p => p.monday).sort()
  const [weekVenues, weekMondays] = weekArrays(todo)
  // The venue weeks as a table to join (a new fragment for each query).
  const W = () => tx`unnest(${weekVenues}::uuid[], ${weekMondays}::date[]) AS w(venue_id, monday)`
  const [shifts, settings, pots, staffAll, offRows, entries, moves] = await Promise.all([
    loadShifts(tx, tenantId), loadSettings(tx, tenantId), loadPots(tx, tenantId),
    loadVenueStaff(tx, tenantId, venues),
    offRowsFor(tx, tenantId, venues, mondays[0], addDays(mondays[mondays.length - 1], 6)),
    entriesFor(tx, tenantId, todo), movesFor(tx, tenantId, todo),
  ])
  // Each venue's service charge / tips for the week, per SC source feeding a pot.
  const scRows = byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday, s.id, s.name, s.tip_pot_id,
           COALESCE((SELECT SUM(e.amount)
                       FROM cash_sc_entries e
                       JOIN cash_daily_reports r ON r.id = e.report_id AND r.tenant_id = ${tenantId}
                      WHERE e.tenant_id = ${tenantId} AND e.source_id = s.id AND r.venue_id = w.venue_id
                        AND r.report_date BETWEEN w.monday AND w.monday + 6), 0)::float8 AS amount
      FROM ${W()}
      JOIN cash_sc_sources s ON s.tenant_id = ${tenantId} AND s.venue_id = w.venue_id AND s.tip_pot_id IS NOT NULL
     ORDER BY w.venue_id, w.monday, s.sort_order, s.name, s.id
  `)
  const lineAmounts = byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday, l.line_id, l.amount::float8 AS amount
      FROM ${W()}
      JOIN rota_week_pot_lines l ON l.tenant_id = ${tenantId} AND l.venue_id = w.venue_id AND l.week_start = w.monday
     ORDER BY w.venue_id, w.monday, l.line_id
  `)
  const manualRows = byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday, m.pot_id, m.staff_id, m.amount::float8 AS amount
      FROM ${W()}
      JOIN rota_week_pot_manual m ON m.tenant_id = ${tenantId} AND m.venue_id = w.venue_id AND m.week_start = w.monday
     ORDER BY w.venue_id, w.monday, m.pot_id, m.staff_id
  `)
  // Who each pot is paid to: the week's pick, else the latest earlier one.
  const payeeRows = byWeek(await tx`
    SELECT DISTINCT ON (w.venue_id, w.monday, p.pot_id)
           w.venue_id, w.monday::text AS monday, p.pot_id, p.week_start::text AS week_start, p.staff_ids
      FROM ${W()}
      JOIN rota_week_pot_payees p ON p.tenant_id = ${tenantId} AND p.venue_id = w.venue_id AND p.week_start <= w.monday
     ORDER BY w.venue_id, w.monday, p.pot_id, p.week_start DESC
  `)
  const weekStaff = byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday,
           ws.staff_id, ws.pay_override::float8 AS pay_override, ws.tip_unallocated::float8 AS tip_unallocated,
           ws.points_nudge::float8 AS points_nudge, ws.removed
      FROM ${W()}
      JOIN rota_week_staff ws ON ws.tenant_id = ${tenantId} AND ws.venue_id = w.venue_id AND ws.week_start = w.monday
     ORDER BY w.venue_id, w.monday, ws.staff_id
  `)
  // Pay adjustments in the week (migration 137), and what the week before's
  // Cash Recon wage rows left unpaid (total - bank transfer - cash paid),
  // which carries in. Only part-paid rows carry: a row with no cash paid at
  // all is either paid another way or not paid yet, and isn't counted as owed.
  const payAdjustments = byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday,
           a.id, a.staff_id, a.kind, a.amount::float8 AS amount, a.note, a.source_id
      FROM ${W()}
      JOIN rota_pay_adjustments a ON a.tenant_id = ${tenantId} AND a.venue_id = w.venue_id AND a.week_start = w.monday
     ORDER BY w.venue_id, w.monday, a.created_at, a.id
  `)
  const owedRows = byWeek(await tx`
    SELECT w.venue_id, w.monday::text AS monday,
           e.staff_id, SUM(e.total - e.bank_amount - e.cash_amount)::float8 AS owed
      FROM ${W()}
      JOIN cash_wage_reports r ON r.tenant_id = ${tenantId} AND r.venue_id = w.venue_id AND r.week_start = w.monday - 7
      JOIN cash_wage_entries e ON e.wage_report_id = r.id AND e.tenant_id = ${tenantId}
     WHERE e.staff_id IS NOT NULL AND e.cash_amount > 0 AND e.cash_amount + e.bank_amount < e.total
     GROUP BY w.venue_id, w.monday, e.staff_id
    HAVING SUM(e.total - e.bank_amount - e.cash_amount) > 0.004
     ORDER BY w.venue_id, w.monday, e.staff_id
  `)
  const carried = carry ? await carriedInFor(tx, tenantId, todo, memo) : null

  for (const p of todo) {
    const key = keyOf(p.venueId, p.monday)
    const week = buildWeek({
      monday: p.monday, shifts, settings, pots,
      staffAll: staffAll.filter(s => s.venue_id === p.venueId),
      offDays: offDayMarks(offRows, p.venueId, weekDates(p.monday)),
      entries: entries.get(key) ?? [], moves: moves.get(key) ?? [],
      scRows: scRows.get(key) ?? [], lineAmounts: lineAmounts.get(key) ?? [],
      manualRows: manualRows.get(key) ?? [], payeeRows: payeeRows.get(key) ?? [],
      weekStaff: weekStaff.get(key) ?? [], payAdjustments: payAdjustments.get(key) ?? [],
      owedRows: owedRows.get(key) ?? [], carriedIn: carried ? carried.get(key) : 0,
    })
    memo.set(key + '|' + carry, week)
    out.set(key, week)
  }
  return out
}

// One venue week from its loaded rows: who is on it, the pots' inputs, then
// computeRotaWeek().
function buildWeek({ monday, shifts, settings, pots, staffAll, offDays, entries, moves, scRows, lineAmounts,
  manualRows, payeeRows, weekStaff, payAdjustments, owedRows, carriedIn }) {
  const lineAmt = new Map(lineAmounts.map(l => [l.line_id, l.amount]))
  const payeesOf = new Map(payeeRows.map(r => [r.pot_id, r]))

  // Active pots, plus inactive ones that still hold money this week.
  const potInputs = pots.map(p => {
    const sources = scRows.filter(r => r.tip_pot_id === p.id).map(r => ({ id: r.id, name: r.name, amount: r.amount }))
    const lines = p.lines
      .filter(l => l.is_active || lineAmt.has(l.id))
      .map(l => ({ id: l.id, name: l.name, kind: l.kind, amount: lineAmt.get(l.id) ?? 0, is_active: l.is_active }))
    const manual = {}
    for (const m of manualRows.filter(m => m.pot_id === p.id)) manual[m.staff_id] = m.amount
    const pick = payeesOf.get(p.id)
    return {
      id: p.id, name: p.name, distribution: p.distribution, is_active: p.is_active,
      payout_method: p.payout_method, payout_to: p.payout_to,
      payees: pick?.staff_ids ?? [], payees_week: pick?.week_start ?? null,
      surcharges: p.surcharges,
      sources, sources_total: sources.reduce((s, x) => s + x.amount, 0), lines, manual,
    }
  }).filter(p => p.is_active || p.sources_total > 0 || p.lines.some(l => l.amount !== 0) || Object.keys(p.manual).length)

  const carriedOwed = Object.fromEntries(owedRows.map(r => [r.staff_id, r.owed]))
  const withEntries = new Set([
    ...payAdjustments.map(a => a.staff_id), ...owedRows.map(r => r.staff_id),
    ...entries.map(e => e.staff_id), ...manualRows.map(m => m.staff_id),
    ...weekStaff.filter(w => w.pay_override != null || w.tip_unallocated !== 0 || w.points_nudge !== 0).map(w => w.staff_id),
    ...moves.flatMap(m => [m.from_staff_id, ...m.lines.map(l => l.to_staff_id)]).filter(Boolean),
    ...potInputs.filter(p => p.payout_to === 'people').flatMap(p => p.payees),
  ])
  // Active staff and anyone with something this week. People taken off this
  // week, or off the rota all week (left, or an off-rota period), are left
  // out, unless they have something this week (entries, money) to show.
  const removed = new Set(weekStaff.filter(w => w.removed).map(w => w.staff_id))
  const dates = weekDates(monday)
  const staff = staffAll
    .filter(s => s.is_active || withEntries.has(s.id))
    .filter(s => (!removed.has(s.id) && !offAll(offDays, s.id, dates)) || withEntries.has(s.id))
  const tipRounding = settings.tip_round_to ? { to: settings.tip_round_to, mode: settings.tip_round_mode } : null
  const result = computeRotaWeek({ shifts, staff, entries, weekStaff, moves, pots: potInputs, tipRounding, payAdjustments, carriedOwed, carriedIn })
  const nameOf = new Map(staff.map(s => [s.id, s.name]))
  // Which week each pot's payees were picked in (null = never picked).
  result.pots.forEach((p, i) => { p.payees_week = potInputs[i].payees_week })
  return {
    ...result,
    week_start: monday,
    moves: moves.map(m => ({
      ...m,
      from_name: m.from_staff_id ? (nameOf.get(m.from_staff_id) ?? 'Unknown') : null,
      lines: m.lines.map(l => ({ ...l, name: nameOf.get(l.to_staff_id) ?? 'Unknown' })),
      total: Math.round(m.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100,
    })),
  }
}

/** Everything the pay calculation needs for one venue week, worked out. */
export async function computeWeek(tx, tenantId, venueId, monday, { carry = true, memo } = {}) {
  return (await loadRotaWeeks(tx, tenantId, [{ venueId, monday }], { carry, memo })).get(keyOf(venueId, monday))
}
