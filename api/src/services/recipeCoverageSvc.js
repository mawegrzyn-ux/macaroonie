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
// What was sold, by trading day, as pence after discounts with VAT in:
//   till     our till's closed checks, lines not voided (pos_check_lines.net),
//            test till sales left out (pos_checks.is_generated, decision
//            D10); a kiosk's checks are counted as kiosk (the check's
//            server is a kiosk device)
//   online   our own online orders that count as sales (OWN_COUNTED in
//            onlineSalesSvc.js): each dish's line total less its discount
//   imported another till's receipts that weren't cancelled (ext_checks):
//            each item line's net, as the dish the item mapping put it on
//            (its main part); a line mapped to no dish (not mapped, kept as
//            sold, counted under a section) is listed by its name; an
//            ignored line is not a sale. A mapped line's extra dishes are
//            in its main dish's value. Imported sales have no order type.
// GloriaFood orders carry no dish ids (by name only) and are left out until
// they go through the item mapping (docs/INVENTORY.md phase 10).
//
//   loadSold(tx, tenantId, { venueIds, from, to, byDay })   the rows
//   coverageCtx(tx, tenantId)        the dish costing ctx (every menu, draft
//                                    and live; meal deals' choices) and
//                                    ctxFor(venueId) for salesCoverage()
//   salesCoverageFor(tx, tenantId, { venueId, days })   the page's figure

import { loadDishCosting, menusFor } from './dishCostSvc.js'
import { OWN_COUNTED } from './onlineSalesSvc.js'
import { salesCoverage, dishMap, COVERAGE_DAYS } from '../../../shared/costing.js'
import { sectionItemsOf } from '../../../shared/combos.js'

const COUNTED = [...OWN_COUNTED]

/** Days as YYYY-MM-DD: the last `days` trading days up to today (the database's date). */
export async function lastDays(tx, days = COVERAGE_DAYS) {
  const [r] = await tx`SELECT (current_date - ${days}::int)::text AS from, current_date::text AS to`
  return r
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
        FROM pos_check_lines l
        JOIN pos_checks c ON c.id = l.check_id AND c.tenant_id = l.tenant_id
        JOIN pos_days d ON d.id = l.day_id AND d.tenant_id = l.tenant_id
        LEFT JOIN pos_devices k ON k.id = c.server_id AND k.tenant_id = c.tenant_id AND k.kind = 'kiosk'
       WHERE l.tenant_id = ${tenantId} AND c.status = 'closed' AND l.status <> 'voided' AND NOT c.is_generated
         AND d.business_date BETWEEN ${from}::date AND ${to}::date
         ${venues ? tx`AND c.venue_id = ANY(${venues}::uuid[])` : tx``}
       GROUP BY 1, 2, 4, 5, 6, 10`,
    tx`
      SELECT 'online'::text AS channel, i.menu_item_id AS dish_id, min(i.name) AS name,
             o.venue_id, o.revenue_stream_id, o.order_type_id,
             NULL::text AS mapping, sum(i.qty)::float8 AS qty, sum(i.line_total_pence - i.discount_pence)::bigint AS sales_pence,
             ${day(tx`o.service_date`)} AS day
        FROM order_items i
        JOIN orders o ON o.id = i.order_id AND o.tenant_id = i.tenant_id
       WHERE i.tenant_id = ${tenantId} AND o.status = ANY(${COUNTED}::text[])
         AND o.service_date BETWEEN ${from}::date AND ${to}::date
         ${venues ? tx`AND o.venue_id = ANY(${venues}::uuid[])` : tx``}
       GROUP BY 2, 4, 5, 6, 10`,
    tx`
      SELECT 'imported'::text AS channel, COALESCE(p.item_id, p.combo_id) AS dish_id, min(l.name) AS name,
             e.venue_id, NULL::uuid AS revenue_stream_id, NULL::uuid AS order_type_id,
             NULL::text AS mapping, sum(l.qty)::float8 AS qty, sum(l.net_pence)::bigint AS sales_pence, ${day(tx`e.business_date`)} AS day
        FROM ext_check_lines l
        JOIN ext_checks e ON e.id = l.check_id AND e.tenant_id = l.tenant_id
        JOIN ext_line_parts p ON p.line_id = l.id AND p.tenant_id = l.tenant_id AND p.role = 'main'
       WHERE l.tenant_id = ${tenantId} AND l.line_kind = 'item' AND e.kind = 'sale' AND NOT e.cancelled
         AND l.map_state IS DISTINCT FROM 'ignored'
         AND e.business_date BETWEEN ${from}::date AND ${to}::date
         ${venues ? tx`AND e.venue_id = ANY(${venues}::uuid[])` : tx``}
       GROUP BY 2, 4, 10`,
    tx`
      SELECT 'imported'::text AS channel, NULL::uuid AS dish_id, l.name AS name,
             e.venue_id, NULL::uuid AS revenue_stream_id, NULL::uuid AS order_type_id,
             COALESCE(l.map_state, 'unmapped') AS mapping, sum(l.qty)::float8 AS qty, sum(l.net_pence)::bigint AS sales_pence,
             ${day(tx`e.business_date`)} AS day
        FROM ext_check_lines l
        JOIN ext_checks e ON e.id = l.check_id AND e.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${tenantId} AND l.line_kind = 'item' AND e.kind = 'sale' AND NOT e.cancelled
         AND l.map_state IS DISTINCT FROM 'ignored'
         AND NOT EXISTS (SELECT 1 FROM ext_line_parts x WHERE x.line_id = l.id AND x.tenant_id = l.tenant_id AND x.role = 'main')
         AND e.business_date BETWEEN ${from}::date AND ${to}::date
         ${venues ? tx`AND e.venue_id = ANY(${venues}::uuid[])` : tx``}
       GROUP BY 3, 4, 7, 10`,
  ])
  return [...till, ...online, ...mapped, ...unmapped].map(r => ({ ...r, sales_pence: Number(r.sales_pence) || 0, qty: Number(r.qty) || 0 }))
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
