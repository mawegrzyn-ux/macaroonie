// src/services/cashReconSvc.js
//
// Cash Recon days and weeks worked out on the server by the one rule in
// shared/cashRecon.js, for the week route (routes/cashRecon.js) and the
// report builder's Cash days and Cash weeks (reports/work/).
//
//   loadCashDays(tx, tenantId, { venueIds, ranges })
//       every daily report of the venues (null = every venue) on a day in
//       one of the ranges ([{ from, to }], null = every day), with its
//       figures: income, takings, service charges and the adjustment,
//       expenses, cash wages paid that day and the variance
//   loadCashWeeks(tx, tenantId, { venueIds, ranges })
//       every week (Monday) in the ranges that has a daily report or a wage
//       list, its reported days added up and the week's wages
//
// The figures use each venue's Cash Recon set-up as it is now, as the
// Cash Recon page does. A day's wages paid are the cash amounts on its own
// week's wage list with that day as their "paid on" day. Must be called
// inside a transaction as the tenant (withTenant() or the report pool).

import { reconSetup, cashDay, cashWeek, amountOf, pennies } from '../../../shared/cashRecon.js'

const DAY_MS = 86400000

/** The Monday of a day's week, as YYYY-MM-DD. */
export function mondayOf(day) {
  const d = new Date(day + 'T00:00:00Z')
  const back = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10)
}

export const addDays = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10)

// Ranges as two arrays for a parameterised "in one of these" test.
function rangeArrays(ranges) {
  const list = Array.isArray(ranges) ? ranges.filter(r => r && r.from && r.to && r.from <= r.to) : null
  return {
    any: !list,
    froms: (list || []).map(r => r.from),
    tos: (list || []).map(r => r.to),
  }
}

const venueArrays = venueIds => ({ all: !Array.isArray(venueIds), ids: Array.isArray(venueIds) ? venueIds : [] })

// Each venue's set-up: its income sources, service charge sources and
// payment channels, active or not (reconSetup() keeps the active ones).
async function setups(tx, tenantId, v) {
  const [sources, sc, channels] = await Promise.all([
    tx`SELECT id::text, venue_id::text, is_active, exclude_from_recon
         FROM cash_income_sources
        WHERE tenant_id = ${tenantId} AND (${v.all}::boolean OR venue_id = ANY(${v.ids}::uuid[]))`,
    tx`SELECT id::text, venue_id::text, is_active, takings_effect, income_effect
         FROM cash_sc_sources
        WHERE tenant_id = ${tenantId} AND (${v.all}::boolean OR venue_id = ANY(${v.ids}::uuid[]))`,
    tx`SELECT id::text, venue_id::text, is_active, counts_as_cash
         FROM cash_payment_channels
        WHERE tenant_id = ${tenantId} AND (${v.all}::boolean OR venue_id = ANY(${v.ids}::uuid[]))`,
  ])
  const byVenue = new Map()
  const of = id => {
    if (!byVenue.has(id)) byVenue.set(id, { income_sources: [], sc_sources: [], payment_channels: [] })
    return byVenue.get(id)
  }
  for (const r of sources) of(r.venue_id).income_sources.push(r)
  for (const r of sc) of(r.venue_id).sc_sources.push(r)
  for (const r of channels) of(r.venue_id).payment_channels.push(r)
  const out = new Map()
  return id => {
    if (!out.has(id)) out.set(id, reconSetup(byVenue.get(id)))
    return out.get(id)
  }
}

/** Every daily report on a day in the ranges, with its figures. */
export async function loadCashDays(tx, tenantId, { venueIds = null, ranges = null } = {}) {
  const v = venueArrays(venueIds)
  const r = rangeArrays(ranges)
  const reports = await tx`
    SELECT id::text, venue_id::text, report_date::text AS date, status,
           submitted_at, submitted_by
      FROM cash_daily_reports
     WHERE tenant_id = ${tenantId}
       AND (${v.all}::boolean OR venue_id = ANY(${v.ids}::uuid[]))
       AND (${r.any}::boolean OR EXISTS (
             SELECT 1 FROM unnest(${r.froms}::date[], ${r.tos}::date[]) AS w(f, t)
              WHERE report_date BETWEEN w.f AND w.t))
     ORDER BY venue_id, report_date`
  if (!reports.length) return []
  const ids = reports.map(x => x.id)
  const [setupOf, income, takings, sc, expenses, wages] = await Promise.all([
    setups(tx, tenantId, v),
    tx`SELECT report_id::text, source_id::text AS id, gross_amount AS amount
         FROM cash_income_entries WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[])`,
    tx`SELECT report_id::text, channel_id::text AS id, amount
         FROM cash_takings_entries WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[])`,
    tx`SELECT report_id::text, source_id::text AS id, amount
         FROM cash_sc_entries WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[])`,
    tx`SELECT report_id::text,
              COALESCE(SUM(amount) FILTER (WHERE NOT paid_by_card), 0) AS cash,
              COALESCE(SUM(amount) FILTER (WHERE paid_by_card), 0) AS card
         FROM cash_expenses WHERE tenant_id = ${tenantId} AND report_id = ANY(${ids}::uuid[])
        GROUP BY report_id`,
    // Cash wages paid out of the till on a day of their own week.
    tx`SELECT wr.venue_id::text, we.paid_date::text AS date, COALESCE(SUM(we.cash_amount), 0) AS cash
         FROM cash_wage_entries we
         JOIN cash_wage_reports wr ON wr.id = we.wage_report_id AND wr.tenant_id = we.tenant_id
        WHERE we.tenant_id = ${tenantId}
          AND (${v.all}::boolean OR wr.venue_id = ANY(${v.ids}::uuid[]))
          AND we.paid_date IS NOT NULL
          AND we.paid_date BETWEEN wr.week_start AND wr.week_start + 6
          AND (${r.any}::boolean OR EXISTS (
                SELECT 1 FROM unnest(${r.froms}::date[], ${r.tos}::date[]) AS w(f, t)
                 WHERE we.paid_date BETWEEN w.f AND w.t))
        GROUP BY wr.venue_id, we.paid_date`,
  ])
  const amounts = new Map()
  const put = (kind, rows) => {
    for (const x of rows) amounts.set(x.report_id + '|' + kind + '|' + x.id, amountOf(amounts.get(x.report_id + '|' + kind + '|' + x.id)) + amountOf(x.amount))
  }
  put('income', income)
  put('takings', takings)
  put('sc', sc)
  const spent = new Map(expenses.map(x => [x.report_id, x]))
  const paid = new Map(wages.map(x => [x.venue_id + '|' + x.date, amountOf(x.cash)]))

  return reports.map(rep => ({
    report_id: rep.id,
    venue_id: rep.venue_id,
    date: rep.date,
    week_start: mondayOf(rep.date),
    status: rep.status,
    submitted_at: rep.submitted_at,
    submitted_by: rep.submitted_by,
    ...cashDay(setupOf(rep.venue_id), {
      amount: (kind, id) => amounts.get(rep.id + '|' + kind + '|' + id),
      expenses: spent.get(rep.id)?.cash ?? 0,
      cardExpenses: spent.get(rep.id)?.card ?? 0,
      wagesPaid: paid.get(rep.venue_id + '|' + rep.date) ?? 0,
    }),
  }))
}

/** Every week (its Monday in the ranges) with a daily report or a wage list. */
export async function loadCashWeeks(tx, tenantId, { venueIds = null, ranges = null } = {}) {
  const v = venueArrays(venueIds)
  // The days of those weeks: from the first Monday in each range to the
  // Sunday after its last Monday.
  const dayRanges = Array.isArray(ranges)
    ? ranges.filter(x => x && x.from && x.to && x.from <= x.to).map(x => {
        const first = mondayOf(x.from) === x.from ? x.from : addDays(mondayOf(x.from), 7)
        return { from: first, to: addDays(mondayOf(x.to), 6) }
      }).filter(x => x.from <= x.to)
    : null
  const r = rangeArrays(ranges)
  const [days, lists] = await Promise.all([
    dayRanges && !dayRanges.length ? [] : loadCashDays(tx, tenantId, { venueIds, ranges: dayRanges }),
    tx`SELECT wr.venue_id::text, wr.week_start::text AS week_start,
              COALESCE(SUM(we.total), 0) AS wages,
              COALESCE(SUM(we.cash_amount), 0) AS cash_wages,
              COALESCE(SUM(we.bank_amount), 0) AS bank_wages,
              COUNT(we.id)::int AS people
         FROM cash_wage_reports wr
         LEFT JOIN cash_wage_entries we ON we.wage_report_id = wr.id AND we.tenant_id = wr.tenant_id
        WHERE wr.tenant_id = ${tenantId}
          AND (${v.all}::boolean OR wr.venue_id = ANY(${v.ids}::uuid[]))
          AND (${r.any}::boolean OR EXISTS (
                SELECT 1 FROM unnest(${r.froms}::date[], ${r.tos}::date[]) AS w(f, t)
                 WHERE wr.week_start BETWEEN w.f AND w.t))
        GROUP BY wr.venue_id, wr.week_start`,
  ])
  const weeks = new Map()
  const of = (venueId, monday) => {
    const key = venueId + '|' + monday
    if (!weeks.has(key)) weeks.set(key, { venue_id: venueId, week_start: monday, days: [], list: null })
    return weeks.get(key)
  }
  for (const d of days) of(d.venue_id, d.week_start).days.push(d)
  for (const l of lists) of(l.venue_id, l.week_start).list = l
  const inRange = monday => !Array.isArray(ranges) || ranges.some(x => x && monday >= x.from && monday <= x.to)
  return [...weeks.values()]
    .filter(w => inRange(w.week_start))
    .sort((a, b) => (a.venue_id < b.venue_id ? -1 : a.venue_id > b.venue_id ? 1 : a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0))
    .map(w => {
      const fig = cashWeek(w.days, w.list?.cash_wages ?? 0)
      return {
        id: w.venue_id + ':' + w.week_start,
        venue_id: w.venue_id,
        week_start: w.week_start,
        ...fig,
        days_submitted: w.days.filter(d => d.status === 'submitted').length,
        wages: pennies(w.list?.wages ?? 0),
        bank_wages: pennies(w.list?.bank_wages ?? 0),
        wage_list: !!w.list,
      }
    })
}
