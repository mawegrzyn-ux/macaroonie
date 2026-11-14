// src/reports/work/index.js
//
// Rows worked out in code for a report run (docs/REPORTS.md 5.4, 20): the
// figures whose rules live in code, which a catalogue template can't say in
// SQL (Cash Recon's variance, rota pay and tips, a day's H&S status). A
// subject reads them with `from: { work: '<name>', tables: [...] }`.
//
// Before a run's statements, fillWorks() makes a temporary table for each
// work they read (pg_temp.rpt_<name>, dropped with the transaction), fills
// it for the run's venues and period, and lets the planner know its size.
// It runs inside withReport()'s `before` step, while the transaction may
// still make temporary tables; the statements made from the person's report
// run after it is read only.
//
//   WORKS[name] = {
//     columns: [[column, postgres type], ...]   tenant_id comes first: the
//                                               compiler filters on it like
//                                               on any other subject's rows
//     fill: async (tx, { tenantId, venueIds, ranges, levels, memo }) => rows
//   }
//
//   venueIds   the venues the report asks for (null = every venue)
//   ranges     the period and the one it is compared with ([{ from, to }],
//              null = every day): which days a work's rows sit on is its own
//              business (a week by its Monday)
//   levels     the person's module levels; columns a role can't see are
//              left out by the catalogue's `needs`, so a work may fill them
//   memo       a Map shared by the works of one run, for what several of
//              them work out from the same rows (the rota's weeks)
//
// A fill reads as the tenant (row-level security) and still filters
// tenant_id itself, as every query does. Its rows are objects keyed by
// column; a column it leaves out is NULL.

import { workTable } from '../catalogue/define.js'
import { CATALOGUE } from '../catalogue/index.js'
import { catalogueTemplates } from '../catalogue/coverage.js'
import { loadCashDays, loadCashWeeks } from '../../services/cashReconSvc.js'
import { ROTA_WORKS } from './rota.js'

const MONEY = 'numeric'

const CASH_FIGURES = [
  ['income', MONEY], ['income_left_out', MONEY], ['takings', MONEY], ['cash_takings', MONEY],
  ['service_charges', MONEY], ['sc_adjustment', MONEY], ['expenses', MONEY], ['card_expenses', MONEY],
  ['wages_paid', MONEY], ['expected', MONEY], ['counted', MONEY], ['variance', MONEY],
]

export const WORKS = {
  // A Cash Recon day: one daily report with its figures by the shared rule.
  cash_days: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'uuid'], ['venue_id', 'uuid'], ['date', 'date'], ['week_start', 'date'],
      ['status', 'text'], ['submitted_at', 'timestamptz'], ['submitted_by', 'text'],
      ...CASH_FIGURES,
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const days = await loadCashDays(tx, tenantId, { venueIds, ranges })
      return days.map(d => ({ ...d, tenant_id: tenantId, id: d.report_id }))
    },
  },
  // A Cash Recon week (a venue's Monday to Sunday): its reported days added
  // up and the week's wage list, with the wages paid on no counted day.
  cash_weeks: {
    columns: [
      ['tenant_id', 'uuid'], ['id', 'text'], ['venue_id', 'uuid'], ['date', 'date'],
      ['days', 'int'], ...CASH_FIGURES,
      ['cash_wages', MONEY], ['wages_off_days', MONEY],
      ['days_submitted', 'int'], ['wages', MONEY], ['bank_wages', MONEY], ['wage_list', 'boolean'],
    ],
    async fill(tx, { tenantId, venueIds, ranges }) {
      const weeks = await loadCashWeeks(tx, tenantId, { venueIds, ranges })
      return weeks.map(w => ({ ...w, tenant_id: tenantId, date: w.week_start }))
    },
  },
  // Rota pay, tips and hours (work/rota.js).
  ...ROTA_WORKS,
}

const NAME = /^[a-z][a-z0-9_]{0,40}$/
// A statement can carry 65,535 values: rows go in chunks well under that.
const VALUES_PER_INSERT = 30000

/**
 * Make, fill and ANALYZE a temporary table for each work in `names`.
 * Returns the set of works filled. Throws for a work nobody wrote.
 */
export async function fillWorks(tx, names, ctx) {
  const filled = new Set()
  const shared = { ...ctx, memo: ctx.memo || new Map() }
  for (const name of new Set(names)) {
    const work = WORKS[name]
    if (!work || !NAME.test(name)) throw new Error('Report rows "' + name + '" aren\'t worked out anywhere')
    const table = workTable(name)
    const cols = work.columns.map(c => c[0])
    await tx.unsafe('CREATE TEMPORARY TABLE ' + table + ' ('
      + work.columns.map(([c, type]) => '"' + c + '" ' + type).join(', ')
      + ') ON COMMIT DROP')
    const rows = (await work.fill(tx, shared)) || []
    const per = Math.max(1, Math.floor(VALUES_PER_INSERT / cols.length))
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per).map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null])))
      await tx`INSERT INTO ${tx(table)} ${tx(chunk, ...cols)}`
    }
    await tx.unsafe('ANALYZE ' + table)
    filled.add(name)
  }
  return filled
}

/** A work's columns, or null for a work nobody wrote. */
export const workColumns = name => (WORKS[name] ? WORKS[name].columns.map(c => c[0]) : null)

/**
 * What doesn't fit between the catalogue and the works: a subject reading
 * rows nobody works out, or a column of them its templates read that the
 * work doesn't have. Checked when the API starts (below) and by the
 * catalogue test.
 */
export function workProblems(catalogue = CATALOGUE) {
  const out = []
  for (const s of Object.values(catalogue.subjects)) {
    if (!s.from.work) continue
    const cols = workColumns(s.from.work)
    if (!cols) { out.push(s.key + ' reads rows called "' + s.from.work + '", which nothing works out'); continue }
    if (cols[0] !== 'tenant_id') out.push('the rows called "' + s.from.work + '" must start with tenant_id')
    const have = new Set(cols)
    for (const t of catalogueTemplates({ subjects: { [s.key]: s } })) {
      for (const m of t.sql.matchAll(/\{t\}\.([a-z_][a-z0-9_]*)/g)) {
        if (!have.has(m[1])) out.push(t.where + ' reads ' + m[1] + ', which the rows called "' + s.from.work + '" don\'t have')
      }
    }
  }
  return out
}

{
  const problems = workProblems()
  if (problems.length) throw new Error('Report catalogue: ' + problems.join('; '))
}
