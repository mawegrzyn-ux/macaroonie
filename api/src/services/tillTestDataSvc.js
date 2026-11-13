// api/src/services/tillTestDataSvc.js
//
// Test till sales for past days (the Test data page, docs/REPORTS.md phase
// 1c; migration 245): trading days with their checks, as if the venue's tills
// and kiosks had taken them. The checks are made by tillSalesGen.js through
// the till's own check rules and stored the way the sequencer stores a check
// (posSvc.js projectionRows()): its lines, payments, discounts, charges and
// VAT by rate, so Till reports and the report builder read them as real sales.
//
// What it never touches: a date with a real trading day, events, print jobs,
// kitchen orders, Cash Recon, loyalty, the till's own numbers. Every row it
// makes says is_generated; Clear removes only those.

import crypto from 'node:crypto'
import { httpError } from '../middleware/error.js'
import { tillConfig, loadTillStaff, projectionRows } from './posSvc.js'
import { venuePromotions, publicPromotion } from './promoSvc.js'
import { openDatesOrNull } from './openDays.js'
import { generateDay, dayCount, nextDate } from './tillSalesGen.js'
import { isPriced, itemChoices } from '../../../shared/orderPricing.js'

export const TILL_MAX_DAYS = 31       // days a request fills
export const TILL_MAX_ORDERS = 10_000 // orders a request makes
export const TILL_MAX_PER_DAY = 1_000 // orders a day, on average
export const TILL_MAX_BACK_DAYS = 1_100 // about three years back

const DAY_MS = 86_400_000
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)

function dateList(from, to) {
  const out = []
  for (let d = from; d <= to; d = nextDate(d)) out.push(d)
  return out
}

/** Rows into a table a few hundred at a time (a statement takes at most 65,535 values). */
async function insertRows(tx, table, rows) {
  if (!rows.length) return
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const per = Math.max(1, Math.floor(60_000 / keys.length))
  for (let i = 0; i < rows.length; i += per) {
    const part = rows.slice(i, i + per).map(r => Object.fromEntries(keys.map(k => [k, r[k] === undefined ? null : r[k]])))
    await tx`INSERT INTO ${tx(table)} ${tx(part, keys)}`
  }
}

// Dishes the till could sell: on a section of one of its menus, with a price.
function sellable(config) {
  let n = 0
  for (const m of config.menus || []) for (const s of m.sections || []) for (const id of s.item_ids || []) {
    const it = config.items?.[id]
    if (it && isPriced(it, itemChoices(it, it.variant_rules || {}))) n++
  }
  return n
}

/**
 * What a range would be filled with: the dates the generator will fill, and
 * those it leaves alone (closed in the venue's schedule, or a real trading
 * day on that date), with the orders it would make (dayCount()).
 */
async function plan(tx, tenantId, venueId, { dateFrom, dateTo, perDay, skipClosed, seed }) {
  const dates = dateList(dateFrom, dateTo)
  let open = new Set(dates)
  if (skipClosed) {
    const list = await openDatesOrNull(tx, tenantId, venueId, dates)
    if (list) open = new Set(list)
  }
  const real = new Set((await tx`
    SELECT business_date::text AS d FROM pos_days
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND NOT is_generated
       AND business_date BETWEEN ${dateFrom}::date AND ${dateTo}::date
  `).map(r => r.d))
  const fill = []
  const closed = []
  const realDays = []
  for (const d of dates) {
    if (real.has(d)) realDays.push(d)
    else if (!open.has(d)) closed.push(d)
    else fill.push({ date: d, count: dayCount(perDay, d, seed + '|' + venueId) })
  }
  return { fill, closed, real: realDays }
}

/** What the generator made in a range: { days, checks }. */
async function generatedIn(tx, tenantId, venueId, dateFrom, dateTo) {
  const [r] = await tx`
    SELECT count(DISTINCT d.id)::int AS days, count(c.id)::int AS checks
      FROM pos_days d
      LEFT JOIN pos_checks c ON c.day_id = d.id AND c.tenant_id = d.tenant_id AND c.is_generated
     WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${venueId} AND d.is_generated
       AND d.business_date BETWEEN ${dateFrom}::date AND ${dateTo}::date
  `
  return r
}

async function removeGenerated(tx, tenantId, venueId, dateFrom, dateTo) {
  // The checks first: a check's day_id would only be set to null.
  const checks = await tx`
    DELETE FROM pos_checks c USING pos_days d
     WHERE c.day_id = d.id AND c.tenant_id = ${tenantId} AND c.venue_id = ${venueId} AND c.is_generated
       AND d.tenant_id = ${tenantId} AND d.venue_id = ${venueId} AND d.is_generated
       AND d.business_date BETWEEN ${dateFrom}::date AND ${dateTo}::date
  `
  const days = await tx`
    DELETE FROM pos_days
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_generated
       AND business_date BETWEEN ${dateFrom}::date AND ${dateTo}::date
  `
  return { days: days.count, checks: checks.count }
}

/**
 * Fill past trading days with test till sales.
 *   opts: { dateFrom, dateTo, perDay (orders a day, on average), skipClosed,
 *           seed, dryRun }
 * Generated days already in the range are made again; dates with a real
 * trading day are left alone. Returns what was (or, dry run, would be) done.
 */
export async function generateTillSales(tx, tenantId, venueId, opts) {
  const { dateFrom, dateTo, perDay, skipClosed = true, seed = '', dryRun = false } = opts
  const [venue] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!venue) throw httpError(404, 'Venue not found')
  // One request at a time per venue: two would both replace the same days.
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'pos-test:' + venueId}))`

  const p = await plan(tx, tenantId, venueId, { dateFrom, dateTo, perDay, skipClosed, seed })
  const orders = p.fill.reduce((s, d) => s + d.count, 0)
  if (orders > TILL_MAX_ORDERS) {
    throw httpError(422, 'That is about ' + orders.toLocaleString('en-GB') + ' orders: pick fewer days or fewer orders a day (at most '
      + TILL_MAX_ORDERS.toLocaleString('en-GB') + ' at a time)', { code: 'too_many' })
  }
  const before = await generatedIn(tx, tenantId, venueId, dateFrom, dateTo)
  const result = {
    dry_run: !!dryRun,
    days: p.fill.filter(d => d.count > 0).length,
    orders,
    closed_days: p.closed.length,
    real_days: p.real,
    replaced: before,
  }
  if (dryRun) return result

  const config = await tillConfig(tx, tenantId, venueId)
  if (!sellable(config)) throw httpError(422, 'This venue\'s tills have no dishes with a price to sell: publish a menu with prices first', { code: 'no_dishes' })
  // The promotions as they could have been on these days (tillConfig() has
  // today's): a promotion's own dates and times are judged at each order.
  config.promotions = (await venuePromotions(tx, { id: venueId, tenant_id: tenantId }, dateFrom, 'pos'))
    .map(x => ({ ...publicPromotion(x, { withCode: true }), max_uses: null }))

  const staffAll = await loadTillStaff(tx, tenantId, venueId)
  if (!staffAll.length) throw httpError(422, 'This venue has no staff to take the orders: add people on the Staff page first', { code: 'no_staff' })
  const leaving = new Map((await tx`
    SELECT id, left_on::text AS left_on FROM cash_staff
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND left_on IS NOT NULL
  `).map(r => [r.id, r.left_on]))

  await removeGenerated(tx, tenantId, venueId, dateFrom, dateTo)

  const dayRows = []
  const rows = { pos_checks: [], pos_check_lines: [], pos_payments: [], pos_check_discounts: [], pos_check_charges: [], pos_check_vat: [] }
  const refused = []
  let made = 0
  let skipped = 0
  for (const { date, count } of p.fill) {
    if (!count) continue
    // People past their last working day don't take orders.
    const staff = staffAll.filter(s => !leaving.get(s.id) || leaving.get(s.id) >= date)
    const working = staff.length ? staff : staffAll
    const dayId = crypto.randomUUID()
    const out = generateDay({ config, date, dayId, staff: working, count, seed: seed + '|' + venueId })
    if (!out.checks.length) continue
    refused.push(...out.refused.map(r => ({ ...r, date })))
    skipped += out.skipped
    dayRows.push({
      id: dayId, tenant_id: tenantId, venue_id: venueId, business_date: date, z_number: null,
      opened_at: out.day.opened_at, closed_at: out.day.closed_at, closed_by: out.day.closed_by,
      declared_cash: out.day.declared_cash, close_notes: out.day.close_notes, figures: tx.json(out.day.figures),
      is_generated: true,
    })
    for (const c of out.checks) {
      const r = projectionRows(c, { tenantId, venueId, seq: 0 })
      rows.pos_checks.push({ ...r.check, state: tx.json(c), is_generated: true })
      rows.pos_check_lines.push(...r.lines)
      rows.pos_payments.push(...r.payments)
      rows.pos_check_discounts.push(...r.discounts)
      rows.pos_check_charges.push(...r.charges)
      rows.pos_check_vat.push(...r.vat)
      made++
    }
  }
  await insertRows(tx, 'pos_days', dayRows)
  for (const [table, list] of Object.entries(rows)) await insertRows(tx, table, list)
  return {
    ...result,
    days: dayRows.length,
    orders: made,
    // Orders the menu couldn't be priced for, and ones the till's rules
    // refused (none, unless the set-up changed while it ran).
    left_out: skipped,
    refused: refused.slice(0, 20),
    refused_count: refused.length,
  }
}

/** Remove the generated trading days in a range, with their checks. */
export async function clearTillSales(tx, tenantId, venueId, { dateFrom, dateTo, dryRun = false }) {
  const [venue] = await tx`SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!venue) throw httpError(404, 'Venue not found')
  await tx`SELECT pg_advisory_xact_lock(hashtext(${'pos-test:' + venueId}))`
  if (dryRun) return { dry_run: true, ...(await generatedIn(tx, tenantId, venueId, dateFrom, dateTo)) }
  return { dry_run: false, ...(await removeGenerated(tx, tenantId, venueId, dateFrom, dateTo)) }
}

/**
 * A range a request may fill: days before `today` (the venue's trading day
 * open now, businessDate()), at most TILL_MAX_DAYS, not too far back.
 */
export function tillRangeProblem(dateFrom, dateTo, today) {
  if (dateTo < dateFrom) return 'The last day must be on or after the first'
  if (dateTo >= today) return 'Only days before today\'s trading day can be filled (' + today + ' at this venue)'
  if (daysBetween(dateFrom, dateTo) + 1 > TILL_MAX_DAYS) return 'At most ' + TILL_MAX_DAYS + ' days at a time'
  if (daysBetween(dateFrom, today) > TILL_MAX_BACK_DAYS) return 'At most about three years back'
  return null
}
