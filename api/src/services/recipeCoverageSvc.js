// src/services/recipeCoverageSvc.js
//
// Coverage by sales (inventory phase 3, docs/INVENTORY.md 5.6 and principle
// 7): how much of what was sold can be costed. This file reads what was
// sold; the rule that judges it is shared/costing.js (salesCoverage(),
// soldState(): a dish sold at its venue, revenue stream and order type is
// costed when dishCost() there has no gaps and none of its options needs a
// rule; the share is the item mapping's coverageShare()). The Recipes page,
// the report subject Recipe coverage and Pepper all read through here.
//
// Since inventory phase 5 this is also the one reading of sold lines for
// usage from sales (services/stockUsageSvc.js, the job jobs/stock-usage.js):
// what counts as sold on each channel is written once (SOLD_FROM below),
// read summed for coverage (loadSold()) and line by line, with each line's
// options and a meal deal's picks, for usage (loadSoldLines()).
//
// What was sold, by trading day, as pence after discounts with VAT in:
//   till     our till's closed checks, lines not voided (pos_check_lines.net),
//            test till sales left out (pos_checks.is_generated, decision
//            D10); a kiosk's checks are counted as kiosk (the check's
//            server is a kiosk device). The trading day is the till's own
//            (pos_days.business_date: the day its Z closes, which Cash Recon
//            fills from). A void, marked wasted or not, is no sale: one
//            marked wasted is waste by itself (stock_void_waste)
//   online   our own online orders that count as sales (OWN_COUNTED in
//            onlineSalesSvc.js): each dish's line total less its discount,
//            on the order's service date
//   imported another till's receipts that weren't cancelled (ext_checks):
//            each item line's net, as the dish the item mapping put it on
//            (its main part); a line mapped to no dish (not mapped, kept as
//            sold, counted under a section) is listed by its name; an
//            ignored line is not a sale. A mapped line's extra dishes are
//            in its main dish's value. Imported sales have no order type.
// GloriaFood orders carry no dish ids (by name only) and are left out of
// coverage until they go through the item mapping (docs/INVENTORY.md phase
// 10); usage lists them as sold without a recipe.
//
//   loadSold(tx, tenantId, { venueIds, from, to, byDay })   the rows, summed
//   loadSoldLines(tx, tenantId, { venueId, from, to, refunds })   each sold
//                                    line with its options and picks (usage)
//   loadPickMix(tx, tenantId, dealIds, { from, to })   what guests picked in
//                                    each meal deal's steps (typical picks)
//   SOLD_FROM                        the channel fragments (also the usage
//                                    job's fingerprints)
//   coverageCtx(tx, tenantId)        the dish costing ctx (every menu, draft
//                                    and live; meal deals' choices) and
//                                    ctxFor(venueId) for salesCoverage()
//   salesCoverageFor(tx, tenantId, { venueId, days })   the page's figure

import { loadDishCosting, menusFor } from './dishCostSvc.js'
import { OWN_COUNTED } from './onlineSalesSvc.js'
import { salesCoverage, dishMap, COVERAGE_DAYS } from '../../../shared/costing.js'
import { sectionItemsOf } from '../../../shared/combos.js'
import { vatIncluded } from '../../../shared/orderPricing.js'
import { countsInRecon } from '../../../shared/gloriafood.js'

const COUNTED = [...OWN_COUNTED]

/**
 * Days as YYYY-MM-DD: the last `days` trading days up to yesterday (the
 * database's date), the same days as a report's "Last 30 days"
 * (last_n_days in shared/reports/period.js), so the page and the report
 * starter agree. Today is still trading.
 */
export async function lastDays(tx, days = COVERAGE_DAYS) {
  const [r] = await tx`SELECT (current_date - ${days}::int)::text AS from, (current_date - 1)::text AS to`
  return r
}

// ── What counts as sold, once per channel ─────────────────────────────
// Each fragment is the FROM and WHERE of one channel's sold lines between
// two trading days (inclusive) at some venues (null: every venue).

const venueCut = (tx, col, venues) => (venues ? tx`AND ${tx(col)} = ANY(${venues}::uuid[])` : tx``)

export const SOLD_FROM = {
  /** Our till and kiosks: lines not voided of closed checks, test sales left out, on the till's day (l, c, d, k). */
  till: (tx, tenantId, venues, from, to) => tx`
      FROM pos_check_lines l
      JOIN pos_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
      JOIN pos_days d ON d.id = l.day_id AND d.tenant_id = l.tenant_id
      LEFT JOIN pos_devices k ON k.id = c.server_id AND k.tenant_id = c.tenant_id AND k.kind = 'kiosk'
     WHERE l.tenant_id = ${tenantId} AND c.status = 'closed' AND l.status <> 'voided' AND NOT c.is_generated
       AND d.business_date BETWEEN ${from}::date AND ${to}::date
       ${venueCut(tx, 'c.venue_id', venues)}`,
  /** Our own online orders that count as sales, on their service date (i, o). */
  online: (tx, tenantId, venues, from, to) => tx`
      FROM order_items i
      JOIN orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
     WHERE i.tenant_id = ${tenantId} AND o.status = ANY(${COUNTED}::text[])
       AND o.service_date BETWEEN ${from}::date AND ${to}::date
       ${venueCut(tx, 'o.venue_id', venues)}`,
  /**
   * Another till's item lines of receipts not cancelled, ignored lines left
   * out (l, e; refunds only when asked). main: 'join' joins the line's main
   * part as p, 'none' keeps lines with none.
   */
  imported: (tx, tenantId, venues, from, to, { refunds = false, main = null } = {}) => tx`
      FROM ext_check_lines l
      JOIN ext_checks e ON e.id = l.check_id AND e.tenant_id = l.tenant_id
      ${main === 'join' ? tx`JOIN ext_line_parts p ON p.line_id = l.id AND p.tenant_id = l.tenant_id AND p.role = 'main'` : tx``}
     WHERE l.tenant_id = ${tenantId} AND l.line_kind = 'item' AND NOT e.cancelled
       AND ${refunds ? tx`e.kind IN ('sale', 'refund')` : tx`e.kind = 'sale'`}
       AND l.map_state IS DISTINCT FROM 'ignored'
       AND e.business_date BETWEEN ${from}::date AND ${to}::date
       ${main === 'none' ? tx`AND NOT EXISTS (SELECT 1 FROM ext_line_parts x WHERE x.line_id = l.id AND x.tenant_id = l.tenant_id AND x.role = 'main')` : tx``}
       ${venueCut(tx, 'e.venue_id', venues)}`,
}

/**
 * What was sold between from and to (trading days, YYYY-MM-DD, inclusive) at
 * these venues (null = every venue): [{ channel, dish_id, name, venue_id,
 * revenue_stream_id, order_type_id, mapping, qty, sales_pence, day? }],
 * summed by those (and by day when byDay).
 */
export async function loadSold(tx, tenantId, { venueIds = null, from, to, byDay = false } = {}) {
  const venues = venueIds && venueIds.length ? venueIds : null
  const day = d => (byDay ? tx`${d}::text` : tx`NULL::text`)
  const [till, online, mapped, unmapped] = await Promise.all([
    tx`
      SELECT (CASE WHEN k.id IS NOT NULL THEN 'kiosk' ELSE 'till' END) AS channel, l.item_id AS dish_id, min(l.name) AS name,
             c.venue_id, COALESCE(l.revenue_stream_id, c.revenue_stream_id) AS revenue_stream_id, c.order_type_id,
             NULL::text AS mapping, sum(l.qty)::float8 AS qty, sum(l.net)::bigint AS sales_pence, ${day(tx`d.business_date`)} AS day
      ${SOLD_FROM.till(tx, tenantId, venues, from, to)}
       GROUP BY 1, 2, 4, 5, 6, 10`,
    tx`
      SELECT 'online'::text AS channel, i.menu_item_id AS dish_id, min(i.name) AS name,
             o.venue_id, o.revenue_stream_id, o.order_type_id,
             NULL::text AS mapping, sum(i.qty)::float8 AS qty, sum(i.line_total_pence - i.discount_pence)::bigint AS sales_pence,
             ${day(tx`o.service_date`)} AS day
      ${SOLD_FROM.online(tx, tenantId, venues, from, to)}
       GROUP BY 2, 4, 5, 6, 10`,
    tx`
      SELECT 'imported'::text AS channel, COALESCE(p.item_id, p.combo_id) AS dish_id, min(l.name) AS name,
             e.venue_id, NULL::uuid AS revenue_stream_id, NULL::uuid AS order_type_id,
             NULL::text AS mapping, sum(l.qty)::float8 AS qty, sum(l.net_pence)::bigint AS sales_pence, ${day(tx`e.business_date`)} AS day
      ${SOLD_FROM.imported(tx, tenantId, venues, from, to, { main: 'join' })}
       GROUP BY 2, 4, 10`,
    tx`
      SELECT 'imported'::text AS channel, NULL::uuid AS dish_id, l.name AS name,
             e.venue_id, NULL::uuid AS revenue_stream_id, NULL::uuid AS order_type_id,
             COALESCE(l.map_state, 'unmapped') AS mapping, sum(l.qty)::float8 AS qty, sum(l.net_pence)::bigint AS sales_pence,
             ${day(tx`e.business_date`)} AS day
      ${SOLD_FROM.imported(tx, tenantId, venues, from, to, { main: 'none' })}
       GROUP BY 3, 4, 7, 10`,
  ])
  return [...till, ...online, ...mapped, ...unmapped].map(r => ({ ...r, sales_pence: Number(r.sales_pence) || 0, qty: Number(r.qty) || 0 }))
}

/**
 * Each line sold at one venue between from and to (trading days, inclusive),
 * for usage (phase 5): [{ channel ('till', 'kiosk', 'online', 'imported',
 * 'gloriafood'), day, at (when it was sold: the check's close, the order's
 * placing, the receipt's close), dish_id (null: no dish), name, qty,
 * sales_pence (after discounts, VAT in), net_pence (VAT out), venue_id,
 * revenue_stream_id, order_type_id, options, picks, mapping, refund }].
 *   till       options: the line's modifiers ([{ option_id, prefix }]), picks:
 *              a meal deal's combo parts, from the check's own record
 *   online     options by their words ([{ group, label }]), picks: the deal's
 *              parts with their options' words; the order type is the order's,
 *              else what Ordering setup gives its fulfilment, else the group's
 *              type of that name (as online tax reads it)
 *   imported   one row per dish the item mapping made of a line: its main
 *              dish (or meal deal: picks null, its typical picks) with the
 *              options mapped with it, and each extra dish on its own; a line
 *              mapped to no dish has dish_id null and its mapping; a refund
 *              (refunds: the group's setting) has qty below zero
 *   gloriafood by name only (dish_id null), counted as GloriaFood's own
 *              reports count (accepted, not test orders), on its day
 */
export async function loadSoldLines(tx, tenantId, { venueId, from, to, refunds = false } = {}) {
  const venues = [venueId]
  const [till, online, imported, parts, gloria] = await Promise.all([
    tx`
      SELECT (CASE WHEN k.id IS NOT NULL THEN 'kiosk' ELSE 'till' END) AS channel, d.business_date::text AS day,
             COALESCE(c.closed_at, c.updated_at) AS at, l.id AS line_id, l.item_id AS dish_id, l.name, l.qty::float8 AS qty,
             l.net::int AS sales_pence, (l.net - l.vat)::int AS net_pence, c.venue_id,
             COALESCE(l.revenue_stream_id, c.revenue_stream_id) AS revenue_stream_id, c.order_type_id,
             (SELECT j FROM jsonb_array_elements(c.state->'lines') j WHERE j->>'id' = l.id LIMIT 1) AS line
      ${SOLD_FROM.till(tx, tenantId, venues, from, to)}`,
    tx`
      SELECT 'online'::text AS channel, o.service_date::text AS day, COALESCE(o.placed_at, o.created_at) AS at,
             i.id AS line_id, i.menu_item_id AS dish_id, i.name, i.qty::float8 AS qty,
             (i.line_total_pence - i.discount_pence)::int AS sales_pence, i.vat_rate::float8 AS vat_rate, o.venue_id,
             o.revenue_stream_id,
             COALESCE(o.order_type_id,
               (SELECT CASE WHEN (os.order_type_ids->>o.fulfilment) ~ '^[0-9a-f-]{36}$' THEN (os.order_type_ids->>o.fulfilment)::uuid END
                  FROM ordering_settings os WHERE os.venue_id = o.venue_id AND os.tenant_id = o.tenant_id),
               (SELECT ot.id FROM order_types ot WHERE ot.tenant_id = o.tenant_id AND ot.is_active
                   AND lower(ot.name) = replace(o.fulfilment, '_', ' ') ORDER BY ot.sort_order LIMIT 1)) AS order_type_id,
             i.options, i.parts
      ${SOLD_FROM.online(tx, tenantId, venues, from, to)}`,
    tx`
      SELECT 'imported'::text AS channel, e.business_date::text AS day, COALESCE(e.closed_at, e.opened_at, e.created_at) AS at,
             l.id AS line_id, l.name, l.qty::float8 AS qty, l.net_pence, l.tax_pence, e.venue_id, e.kind,
             COALESCE(l.map_state, 'unmapped') AS mapping
      ${SOLD_FROM.imported(tx, tenantId, venues, from, to, { refunds })}`,
    tx`
      SELECT p.line_id, p.part_no, p.role, p.item_id, p.option_id, p.combo_id, p.qty::float8 AS qty, p.net_pence
        FROM ext_line_parts p
       WHERE p.tenant_id = ${tenantId}
         AND p.line_id IN (SELECT l.id ${SOLD_FROM.imported(tx, tenantId, venues, from, to, { refunds })})
       ORDER BY p.line_id, p.part_no`,
    loadGloriaLines(tx, tenantId, venueId, from, to),
  ])
  const out = []
  for (const r of till) {
    const line = r.line || {}
    out.push({
      channel: r.channel, day: r.day, at: r.at, line_id: r.line_id, dish_id: r.dish_id, name: r.name, qty: r.qty,
      sales_pence: r.sales_pence, net_pence: r.net_pence, venue_id: r.venue_id, revenue_stream_id: r.revenue_stream_id,
      order_type_id: r.order_type_id, options: Array.isArray(line.modifiers) ? line.modifiers : [],
      picks: Array.isArray(line.combo) ? line.combo : null, mapping: null, refund: false,
    })
  }
  for (const r of online) {
    out.push({
      channel: 'online', day: r.day, at: r.at, line_id: r.line_id, dish_id: r.dish_id, name: r.name, qty: r.qty,
      sales_pence: r.sales_pence, net_pence: r.sales_pence - vatIncluded(r.sales_pence, r.vat_rate || 0),
      venue_id: r.venue_id, revenue_stream_id: r.revenue_stream_id, order_type_id: r.order_type_id,
      options: Array.isArray(r.options) ? r.options : [],
      picks: Array.isArray(r.parts) ? r.parts.map(p => ({ step_id: p.step_id, item_id: p.item_id, options: p.options || [] })) : null,
      mapping: null, refund: false,
    })
  }
  const partsOf = new Map()
  for (const p of parts) {
    if (!partsOf.has(p.line_id)) partsOf.set(p.line_id, [])
    partsOf.get(p.line_id).push(p)
  }
  for (const r of imported) {
    const sign = r.kind === 'refund' ? -1 : 1
    const base = {
      channel: 'imported', day: r.day, at: r.at, line_id: r.line_id, venue_id: r.venue_id, revenue_stream_id: null,
      order_type_id: null, picks: null, refund: r.kind === 'refund',
    }
    // VAT out: the line's tax shared over its parts by their net.
    const exVat = pence => (r.net_pence ? Math.round(pence - (r.tax_pence || 0) * pence / r.net_pence) : pence)
    const list = partsOf.get(r.line_id) || []
    const main = list.find(p => p.role === 'main')
    if (!main) {
      out.push({ ...base, dish_id: null, name: r.name, qty: sign * Math.abs(r.qty), sales_pence: sign * Math.abs(r.net_pence), net_pence: sign * Math.abs(exVat(r.net_pence)), options: [], mapping: r.mapping })
      continue
    }
    const opts = list.filter(p => p.role === 'option' && p.option_id)
    const mainNet = main.net_pence + opts.reduce((s, p) => s + p.net_pence, 0)
    out.push({
      ...base, dish_id: main.item_id || main.combo_id, name: r.name, qty: sign * Math.abs(main.qty || r.qty),
      sales_pence: sign * Math.abs(mainNet), net_pence: sign * Math.abs(exVat(mainNet)),
      options: opts.map(p => ({ option_id: p.option_id })), mapping: null,
    })
    for (const p of list.filter(x => x.role === 'dish' && x.item_id)) {
      out.push({ ...base, dish_id: p.item_id, name: r.name, qty: sign * Math.abs(p.qty || r.qty), sales_pence: sign * Math.abs(p.net_pence), net_pence: sign * Math.abs(exVat(p.net_pence)), options: [], mapping: null })
    }
  }
  return [...out, ...gloria]
}

/**
 * A venue's GloriaFood orders that count (accepted, not test orders:
 * countsInRecon()) on its trading days from..to, each day from the link's
 * day basis (fulfil or accepted time) and day start in the venue's zone, as
 * Cash Recon's GloriaFood figures read them: [{ id, status, source, items,
 * at, day, updated_at }].
 */
export async function gloriaDayRows(tx, tenantId, venueId, from, to) {
  const rows = await tx`
    SELECT x.id, x.status, x.source, x.items, x.updated_at, x.at, x.day::text AS day FROM (
      SELECT g.id, g.status, g.source, g.items, g.updated_at,
             COALESCE(CASE WHEN gl.day_basis = 'accepted' THEN g.accepted_at ELSE g.fulfill_at END, g.accepted_at) AS at,
             ((COALESCE(CASE WHEN gl.day_basis = 'accepted' THEN g.accepted_at ELSE g.fulfill_at END, g.accepted_at)
               - (COALESCE(gl.day_starts_at, '00:00') || ':00')::interval) AT TIME ZONE COALESCE(v.timezone, 'Europe/London'))::date AS day
        FROM gloriafood_orders g
        JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id
        LEFT JOIN gloriafood_venue_links gl ON gl.venue_id = g.venue_id AND gl.tenant_id = g.tenant_id
       WHERE g.tenant_id = ${tenantId} AND g.venue_id = ${venueId}
    ) x
     WHERE x.day BETWEEN ${from}::date AND ${to}::date`
  return rows.filter(countsInRecon)
}

/** GloriaFood orders' dishes at a venue on its trading days, by name only. */
async function loadGloriaLines(tx, tenantId, venueId, from, to) {
  const rows = await gloriaDayRows(tx, tenantId, venueId, from, to)
  const out = []
  for (const g of rows) {
    for (const [i, d] of (Array.isArray(g.items) ? g.items : []).entries()) {
      const pence = Math.round(Number(d.total_pence) || 0)
      out.push({
        channel: 'gloriafood', day: g.day, at: g.at, line_id: g.id + ':' + i, dish_id: null, name: String(d.name || 'A dish'),
        qty: Number(d.qty) || 1, sales_pence: pence, net_pence: pence, venue_id: venueId, revenue_stream_id: null,
        order_type_id: null, options: [], picks: null, mapping: null, refund: false,
      })
    }
  }
  return out
}

/**
 * What guests picked in each step of these meal deals between two days (till
 * and kiosk checks, online orders): rows for pickMix() in shared/costing.js,
 * [{ deal_id, step_id, dish_id, qty }]. Read for typical picks only when a
 * sale of a deal says nothing of its picks (another till's mapped deal).
 */
export async function loadPickMix(tx, tenantId, dealIds, { from, to } = {}) {
  if (!dealIds?.length) return []
  const [till, online] = await Promise.all([
    tx`
      SELECT s.deal_id, p->>'step_id' AS step_id, p->>'item_id' AS dish_id, sum(s.qty)::float8 AS qty
        FROM (SELECT l.item_id AS deal_id, l.qty,
                     (SELECT j->'combo' FROM jsonb_array_elements(c.state->'lines') j WHERE j->>'id' = l.id LIMIT 1) AS combo
              ${SOLD_FROM.till(tx, tenantId, null, from, to)}
                 AND l.item_id = ANY(${dealIds}::uuid[])) s
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.combo) = 'array' THEN s.combo ELSE '[]'::jsonb END) p
       GROUP BY 1, 2, 3`,
    tx`
      SELECT s.deal_id, p->>'step_id' AS step_id, p->>'item_id' AS dish_id, sum(s.qty)::float8 AS qty
        FROM (SELECT i.menu_item_id AS deal_id, i.qty, i.parts
              ${SOLD_FROM.online(tx, tenantId, null, from, to)}
                 AND i.menu_item_id = ANY(${dealIds}::uuid[]) AND jsonb_typeof(i.parts) = 'array') s
       CROSS JOIN LATERAL jsonb_array_elements(s.parts) p
       GROUP BY 1, 2, 3`,
  ])
  return [...till, ...online].filter(r => r.step_id && r.dish_id)
}

/**
 * The dish costing ctx for coverage: every dish on a menu (the draft's
 * definition over what is live; a sale names the dish id both keep), the
 * meal deals' choices across every menu, at the group's prices; ctxFor(venueId)
 * the same at a venue's prices (standard basis: the venue's supplier choice),
 * each with its own memo.
 */
export async function coverageCtx(tx, tenantId) {
  const [live, draft] = await Promise.all([menusFor(tx, tenantId, 'live'), menusFor(tx, tenantId, 'draft')])
  const menus = [...live, ...draft]
  const base = await loadDishCosting(tx, tenantId, null, { menus })
  const dishes = dishMap(menus)
  const itemsById = Object.fromEntries([...dishes].map(([id, d]) => [id, d]))
  const ctx = { ...base, dishes, combo: { itemsById, sectionItems: sectionItemsOf(menus) } }
  const byVenue = new Map()
  const ctxFor = venueId => {
    const k = venueId || ''
    if (!byVenue.has(k)) byVenue.set(k, { ...ctx, venueId: venueId || null, _memo: new Map() })
    return byVenue.get(k)
  }
  return { ctx, ctxFor }
}

/** The Recipes page's coverage: the last `days` days at a venue (null = every venue), judged by salesCoverage(). */
export async function salesCoverageFor(tx, tenantId, { venueId = null, days = COVERAGE_DAYS } = {}) {
  const range = await lastDays(tx, days)
  const [rows, { ctxFor }] = await Promise.all([
    loadSold(tx, tenantId, { venueIds: venueId ? [venueId] : null, from: range.from, to: range.to }),
    coverageCtx(tx, tenantId),
  ])
  return { from: range.from, to: range.to, days, ...salesCoverage(rows, ctxFor) }
}
