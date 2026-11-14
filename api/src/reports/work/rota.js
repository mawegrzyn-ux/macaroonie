// src/reports/work/rota.js
//
// Rota rows worked out in code for a report run (docs/REPORTS.md 20, phase
// 3b), merged into WORKS in work/index.js: each person's week, each venue's
// week, each tip pot's week and each person's share of it, all from
// loadRotaWeeks() (services/rotaWeeks.js), the same loader and rules as the
// Rota page's pay and tips; and each person's day from computeRotaDays()
// (services/rotaCalc.js), the minutes rules the week counts by.
//
// Which weeks: a venue's week (its Monday) is worked out when something is
// stored for it: rota entries, a week's own settings for someone, pay
// adjustments, tip moves, tip pot amounts, service charges feeding a tip
// pot, a wage list, or the week before's part-paid wages carrying in. A
// week is in a period when its Monday is, as the catalogue's date says.
// Pay is never split into days: the Rota page works it out for a week (a
// fixed weekly pay belongs to no one day).
//
// What is kept: a person's week with anything in it (entries, pay, points,
// tips, a place on the week's wage list), a venue's week with any person's
// week kept or any tip pot holding money, a pot's week holding money, and
// each share that isn't nothing. A week with nothing on the rota and no
// tips isn't a row.

import { loadRotaWeeks, loadShifts, addDays } from '../../services/rotaWeeks.js'
import { computeRotaDays } from '../../services/rotaCalc.js'

const MONEY = 'numeric'
const HOURS = 'numeric'

// The tables the rota rows are worked out from (the catalogue's from.tables).
export const WEEK_TABLES = [
  'rota_entries', 'rota_shifts', 'cash_staff', 'staff_roles', 'staff_shift_rates', 'staff_rota_off',
  'rota_week_staff', 'rota_pay_adjustments', 'rota_tip_moves', 'rota_tip_move_lines',
  'tip_pots', 'tip_pot_lines', 'rota_week_pot_lines', 'rota_week_pot_manual',
  'cash_sc_sources', 'cash_sc_entries', 'cash_daily_reports', 'cash_wage_reports', 'cash_wage_entries',
]
export const DAY_TABLES = ['rota_entries', 'rota_shifts']

const MONDAY_OF = col => '(' + col + ' - (EXTRACT(ISODOW FROM ' + col + ')::int - 1))::date'

/**
 * The venue weeks to work out: [{ venueId, monday }], for the run's venues
 * (null = every venue) with their Monday in one of its ranges (null = any).
 */
async function candidateWeeks(tx, tenantId, venueIds, ranges) {
  const rows = await tx.unsafe(`
    WITH weeks AS (
      SELECT venue_id, ${MONDAY_OF('work_date')} AS monday FROM rota_entries WHERE tenant_id = $1
      UNION SELECT venue_id, week_start FROM rota_week_staff WHERE tenant_id = $1
      UNION SELECT venue_id, week_start FROM rota_pay_adjustments WHERE tenant_id = $1
      UNION SELECT venue_id, week_start FROM rota_tip_moves WHERE tenant_id = $1
      UNION SELECT venue_id, week_start FROM rota_week_pot_lines WHERE tenant_id = $1
      UNION SELECT venue_id, week_start FROM rota_week_pot_manual WHERE tenant_id = $1
      UNION SELECT r.venue_id, ${MONDAY_OF('r.report_date')}
              FROM cash_sc_entries e
              JOIN cash_daily_reports r ON r.id = e.report_id AND r.tenant_id = e.tenant_id
              JOIN cash_sc_sources s ON s.id = e.source_id AND s.tenant_id = e.tenant_id
             WHERE e.tenant_id = $1 AND s.tip_pot_id IS NOT NULL
      UNION SELECT r.venue_id, r.week_start
              FROM cash_wage_reports r
              JOIN cash_wage_entries e ON e.wage_report_id = r.id AND e.tenant_id = r.tenant_id
             WHERE r.tenant_id = $1 AND e.staff_id IS NOT NULL
      UNION SELECT r.venue_id, r.week_start + 7
              FROM cash_wage_reports r
              JOIN cash_wage_entries e ON e.wage_report_id = r.id AND e.tenant_id = r.tenant_id
             WHERE r.tenant_id = $1 AND e.staff_id IS NOT NULL AND e.cash_amount > 0
               AND e.cash_amount + e.bank_amount < e.total
    )
    SELECT DISTINCT w.venue_id, w.monday::text AS monday
      FROM weeks w
      JOIN venues v ON v.id = w.venue_id AND v.tenant_id = $1
     WHERE ($2::uuid[] IS NULL OR w.venue_id = ANY($2::uuid[]))
     ORDER BY w.venue_id, monday`, [tenantId, venueIds || null])
  const inRange = d => !ranges || ranges.some(r => d >= r.from && d <= r.to)
  return rows.filter(r => inRange(r.monday)).map(r => ({ venueId: r.venue_id, monday: r.monday }))
}

/**
 * The run's rota weeks, worked out once per run (a report reading two of
 * the rota works shares them): { pairs, weeks, wages }.
 */
async function rotaWeeks(tx, ctx) {
  const memo = ctx.memo
  const known = memo && memo.get('rota:weeks')
  if (known) return known
  const pairs = await candidateWeeks(tx, ctx.tenantId, ctx.venueIds, ctx.ranges)
  const weeks = pairs.length ? await loadRotaWeeks(tx, ctx.tenantId, pairs, { memo: memo || new Map() }) : new Map()
  const wages = pairs.length ? await wageFigures(tx, ctx.tenantId, pairs) : new Map()
  const out = { pairs, weeks, wages }
  if (memo) memo.set('rota:weeks', out)
  return out
}

/**
 * Each person's entries on each venue week's Cash Recon wage list (entries
 * typed without a person can't be matched to anyone and aren't counted):
 * Map 'venue|monday|staff' -> { name, wage, wage_bank, wage_cash, wage_unpaid }.
 * What is still to pay is worked out per entry, as the Wages page does.
 */
async function wageFigures(tx, tenantId, pairs) {
  const rows = await tx`
    SELECT r.venue_id, r.week_start::text AS monday, e.staff_id, MIN(e.name) AS name,
           SUM(COALESCE(e.total, 0))::float8 AS wage,
           SUM(COALESCE(e.bank_amount, 0))::float8 AS wage_bank,
           SUM(COALESCE(e.cash_amount, 0))::float8 AS wage_cash,
           SUM(GREATEST(GREATEST(COALESCE(e.total, 0) - COALESCE(e.bank_amount, 0), 0) - COALESCE(e.cash_amount, 0), 0))::float8 AS wage_unpaid
      FROM unnest(${pairs.map(p => p.venueId)}::uuid[], ${pairs.map(p => p.monday)}::date[]) AS w(venue_id, monday)
      JOIN cash_wage_reports r ON r.tenant_id = ${tenantId} AND r.venue_id = w.venue_id AND r.week_start = w.monday
      JOIN cash_wage_entries e ON e.wage_report_id = r.id AND e.tenant_id = ${tenantId}
     WHERE e.staff_id IS NOT NULL
     GROUP BY r.venue_id, r.week_start, e.staff_id
  `
  return new Map(rows.map(r => [r.venue_id + '|' + r.monday + '|' + r.staff_id, r]))
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// The rota figures of a person's week that can make it worth a row.
const PERSON_FIGURES = [
  'hours', 'paid_hours', 'computed_pay', 'base_pay', 'pay', 'pay_shortfall', 'carried_owed', 'extra_pay',
  'deductions', 'advance', 'advance_repay', 'points', 'base_points', 'points_adjustment', 'points_nudge',
  'tip_adjustment', 'tip_unallocated', 'tip_share', 'tip_share_from_pots', 'tip_cash', 'tip_bank',
]
const personKept = (r, onList) => onList || r.entry_count > 0 || r.pay_override != null || r.adjustments.length > 0
  || PERSON_FIGURES.some(k => Number(r[k] || 0) !== 0)

// A person on a week's wage list the rota has nothing for: every rota figure nothing.
const NOTHING_ON_ROTA = {
  ...Object.fromEntries(PERSON_FIGURES.map(k => [k, 0])),
  role_name: null, pay_type: null, pay_basis: null, pay_override: null, pay_method: null,
  entry_count: 0, days_worked: 0, paid_days: 0, absence_hours: {}, bank_pay: 0, cash_pay: 0, adjustments: [],
}

const potHasMoney = p => [p.sources_total, p.gross, p.total, p.distributed, p.unallocated].some(v => Number(v || 0) !== 0)
  || (p.lines || []).some(l => Number(l.value || 0) !== 0)

/** A person's week as a row, the wage list's figures beside it. */
function personRow(tenantId, venueId, monday, r, wage) {
  const a = r.absence_hours || {}
  return {
    tenant_id: tenantId, id: venueId + ':' + monday + ':' + r.staff_id, venue_id: venueId, staff_id: r.staff_id, date: monday,
    name: r.name, role_name: r.role_name, pay_type: r.pay_type, pay_basis: r.pay_type === 'hourly' ? null : r.pay_basis,
    entry_count: r.entry_count, days_worked: r.days_worked, paid_days: r.paid_days,
    hours: r.hours, paid_hours: r.paid_hours,
    sick_hours: a.sick || 0, pto_hours: a.pto || 0, uto_hours: a.uto || 0, abs_hours: a.abs || 0,
    computed_pay: r.computed_pay, pay_override: r.pay_override, base_pay: r.base_pay,
    extra_pay: r.extra_pay, deductions: r.deductions, advance: r.advance, advance_repay: r.advance_repay,
    carried_owed: r.carried_owed, pay: r.pay, pay_shortfall: r.pay_shortfall,
    pay_method: r.pay_method, bank_pay: r.bank_pay, cash_pay: r.cash_pay,
    base_points: r.base_points, points_adjustment: r.points_adjustment, points_nudge: r.points_nudge, points: r.points,
    tip_share_from_pots: r.tip_share_from_pots, tip_adjustment: r.tip_adjustment, tip_unallocated: r.tip_unallocated,
    tip_share: r.tip_share, tip_cash: r.tip_cash, tip_bank: r.tip_bank,
    on_wage_list: !!wage,
    wage: wage ? round2(wage.wage) : null, wage_bank: wage ? round2(wage.wage_bank) : null,
    wage_cash: wage ? round2(wage.wage_cash) : null, wage_unpaid: wage ? round2(wage.wage_unpaid) : null,
  }
}

const TIME_OFF = [['sick_minutes', 'sick'], ['pto_minutes', 'pto'], ['uto_minutes', 'uto'], ['abs_minutes', 'abs']]

export const ROTA_WORKS = {
  // Each person's week at a venue, as the Rota page's pay and tips tables
  // have it, with the week's wage list beside it. Someone on the wage list
  // the rota has nothing for is still a row (their rota figures nothing).
  rota_staff_weeks: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['staff_id', 'uuid'], ['date', 'date'],
      ['name', 'text'], ['role_name', 'text'], ['pay_type', 'text'], ['pay_basis', 'text'],
      ['entry_count', 'int'], ['days_worked', 'int'], ['paid_days', 'int'],
      ['hours', HOURS], ['paid_hours', HOURS], ['sick_hours', HOURS], ['pto_hours', HOURS], ['uto_hours', HOURS], ['abs_hours', HOURS],
      ['computed_pay', MONEY], ['pay_override', MONEY], ['base_pay', MONEY], ['extra_pay', MONEY], ['deductions', MONEY],
      ['advance', MONEY], ['advance_repay', MONEY], ['carried_owed', MONEY], ['pay', MONEY], ['pay_shortfall', MONEY],
      ['pay_method', 'text'], ['bank_pay', MONEY], ['cash_pay', MONEY],
      ['base_points', 'numeric'], ['points_adjustment', 'numeric'], ['points_nudge', 'numeric'], ['points', 'numeric'],
      ['tip_share_from_pots', MONEY], ['tip_adjustment', MONEY], ['tip_unallocated', MONEY], ['tip_share', MONEY],
      ['tip_cash', MONEY], ['tip_bank', MONEY],
      ['on_wage_list', 'boolean'], ['wage', MONEY], ['wage_bank', MONEY], ['wage_cash', MONEY], ['wage_unpaid', MONEY],
    ],
    async fill(tx, ctx) {
      const { pairs, weeks, wages } = await rotaWeeks(tx, ctx)
      const out = []
      for (const p of pairs) {
        const week = weeks.get(p.venueId + '|' + p.monday)
        const seen = new Set()
        for (const r of week.rows) {
          const key = p.venueId + '|' + p.monday + '|' + r.staff_id
          seen.add(key)
          const wage = wages.get(key)
          if (personKept(r, !!wage)) out.push(personRow(ctx.tenantId, p.venueId, p.monday, r, wage))
        }
        // On the week's wage list with nothing on the rota (or left off it).
        for (const [key, wage] of wages) {
          if (seen.has(key) || !key.startsWith(p.venueId + '|' + p.monday + '|')) continue
          out.push(personRow(ctx.tenantId, p.venueId, p.monday, {
            ...NOTHING_ON_ROTA, staff_id: wage.staff_id, name: wage.name,
          }, wage))
        }
      }
      return out
    },
  },

  // Each venue's week: the Rota page's totals.
  rota_weeks: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['date', 'date'],
      ['people', 'int'], ['entry_count', 'int'],
      ['hours', HOURS], ['paid_hours', HOURS], ['sick_hours', HOURS], ['pto_hours', HOURS], ['uto_hours', HOURS], ['abs_hours', HOURS],
      ['pay', MONEY], ['pay_bank', MONEY], ['pay_cash', MONEY], ['pay_shortfall', MONEY],
      ['points', 'numeric'], ['tips_gross', MONEY], ['surcharges', MONEY], ['tips_in', MONEY], ['tips_shared', MONEY],
      ['kept_by_house', MONEY], ['tips_added', MONEY], ['tips_taken_out', MONEY], ['tips_carried_in', MONEY],
      ['tips_unallocated', MONEY], ['points_unallocated', 'numeric'], ['tips_unallocated_points', MONEY],
      ['tips_carry_out', MONEY], ['tips_cash', MONEY], ['tips_bank', MONEY], ['tips_handed_on', MONEY],
      ['tip_settled_in', 'text'],
    ],
    async fill(tx, ctx) {
      const { pairs, weeks } = await rotaWeeks(tx, ctx)
      const out = []
      for (const p of pairs) {
        const week = weeks.get(p.venueId + '|' + p.monday)
        // The wage list doesn't make a rota week: only the rota's own figures do.
        if (!week.rows.some(r => personKept(r, false)) && !week.pots.some(potHasMoney)) continue
        const sum = k => round2(week.rows.reduce((s, r) => s + Number(r[k] || 0), 0))
        const off = k => round2(week.rows.reduce((s, r) => s + Number((r.absence_hours || {})[k] || 0), 0))
        const t = week.totals
        out.push({
          tenant_id: ctx.tenantId, id: p.venueId + ':' + p.monday, venue_id: p.venueId, date: p.monday,
          people: week.rows.filter(r => r.entry_count > 0).length, entry_count: sum('entry_count'),
          hours: t.hours, paid_hours: t.paid_hours,
          sick_hours: off('sick'), pto_hours: off('pto'), uto_hours: off('uto'), abs_hours: off('abs'),
          pay: t.pay, pay_bank: t.pay_bank, pay_cash: t.pay_cash, pay_shortfall: sum('pay_shortfall'),
          points: t.points, tips_gross: t.tips_gross, surcharges: t.surcharges, tips_in: t.tips_in,
          tips_shared: t.tips_shared, kept_by_house: t.kept_by_house, tips_added: t.tips_added,
          tips_taken_out: t.tips_taken_out, tips_carried_in: t.tips_carried_in, tips_unallocated: t.tips_unallocated,
          points_unallocated: t.points_unallocated, tips_unallocated_points: t.tips_unallocated_points,
          tips_carry_out: t.tips_carry_out, tips_cash: t.tips_cash, tips_bank: t.tips_bank,
          tips_handed_on: t.tips_handed_on, tip_settled_in: week.tip_settled_in,
        })
      }
      return out
    },
  },

  // Each tip pot's week at a venue: what went in and how it was shared.
  rota_pot_weeks: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['pot_id', 'uuid'], ['date', 'date'],
      ['name', 'text'], ['distribution', 'text'],
      ['sources', MONEY], ['lines', MONEY], ['gross', MONEY], ['surcharge', MONEY], ['total', MONEY],
      ['distributed', MONEY], ['unallocated', MONEY], ['kept_by_house', MONEY], ['difference', MONEY],
      ['payout_method', 'text'], ['payout_to', 'text'], ['paid_to_people', MONEY],
    ],
    async fill(tx, ctx) {
      const { pairs, weeks } = await rotaWeeks(tx, ctx)
      const out = []
      for (const p of pairs) {
        for (const pot of weeks.get(p.venueId + '|' + p.monday).pots) {
          if (!potHasMoney(pot)) continue
          out.push({
            tenant_id: ctx.tenantId, id: p.venueId + ':' + p.monday + ':' + pot.id, venue_id: p.venueId, pot_id: pot.id,
            date: p.monday, name: pot.name, distribution: pot.distribution,
            sources: pot.sources_total, lines: round2((pot.lines || []).reduce((s, l) => s + Number(l.value || 0), 0)),
            gross: pot.gross, surcharge: pot.surcharge, total: pot.total, distributed: pot.distributed,
            unallocated: pot.unallocated, kept_by_house: pot.kept_by_house, difference: pot.difference,
            payout_method: pot.payout_method, payout_to: pot.payout_to,
            paid_to_people: pot.paid_to_people ?? null,
          })
        }
      }
      return out
    },
  },

  // Each person's share of each tip pot in a week.
  rota_tip_shares: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['staff_id', 'uuid'], ['pot_id', 'uuid'],
      ['date', 'date'], ['share', MONEY],
    ],
    async fill(tx, ctx) {
      const { pairs, weeks } = await rotaWeeks(tx, ctx)
      const out = []
      for (const p of pairs) {
        for (const r of weeks.get(p.venueId + '|' + p.monday).rows) {
          for (const [potId, share] of Object.entries(r.pot_shares || {})) {
            if (!Number(share)) continue
            out.push({
              tenant_id: ctx.tenantId, id: p.venueId + ':' + p.monday + ':' + r.staff_id + ':' + potId,
              venue_id: p.venueId, staff_id: r.staff_id, pot_id: potId, date: p.monday, share,
            })
          }
        }
      }
      return out
    },
  },

  // Each person's day on the rota at a venue: the minutes their entries add
  // up to by status, as the week counts them.
  rota_days: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['staff_id', 'uuid'], ['date', 'date'],
      ['week_start', 'date'], ['entry_count', 'int'],
      ['on_minutes', 'int'], ['pto_minutes', 'int'], ['sick_minutes', 'int'], ['uto_minutes', 'int'], ['abs_minutes', 'int'],
      ['worked', 'boolean'], ['paid', 'boolean'], ['kind', 'text'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const [shifts, entries] = await Promise.all([
        loadShifts(tx, tenantId),
        tx`
          SELECT venue_id, staff_id, work_date::text AS work_date, shift_id,
                 to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time, status
            FROM rota_entries
           WHERE tenant_id = ${tenantId}
             AND (${venueIds || null}::uuid[] IS NULL OR venue_id = ANY(${venueIds || null}::uuid[]))
           ORDER BY venue_id, staff_id, work_date, start_time NULLS FIRST, id
        `,
      ])
      const inRange = d => !ranges || ranges.some(r => d >= r.from && d <= r.to)
      const byVenue = new Map()
      for (const e of entries) {
        if (!inRange(e.work_date)) continue
        const list = byVenue.get(e.venue_id)
        if (list) list.push(e)
        else byVenue.set(e.venue_id, [e])
      }
      const out = []
      for (const [venueId, list] of byVenue) {
        for (const d of computeRotaDays({ shifts, entries: list })) {
          const dow = (new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7
          const row = {
            tenant_id: tenantId, id: venueId + ':' + d.date + ':' + d.staff_id, venue_id: venueId, staff_id: d.staff_id,
            date: d.date, week_start: addDays(d.date, -dow), entry_count: d.entries,
            on_minutes: Math.round(d.minutes.on), worked: d.worked, paid: d.paid, kind: d.kind,
          }
          for (const [col, k] of TIME_OFF) row[col] = Math.round(d.minutes[k])
          out.push(row)
        }
      }
      return out
    },
  },
}
