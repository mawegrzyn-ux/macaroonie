// src/services/stockFoodCostSvc.js
//
// Food cost beyond one stock period (inventory phase 6b; docs/INVENTORY.md
// 8.1, 8.2, 10.3, 10.4). The figures are shared/foodCost.js's over what is
// kept already: dish_cost_days (usage from sales), stock_periods and their
// figures (shared/variance.js through services/stockVarianceSvc.js), the
// menu margins worked out on each read (menuMargins() in shared/costing.js).
//
//   weekStart(day)                                the Monday of a day's week
//   weekFigures(tx, tenantId, venueId, start)     Cash Recon's week line and the food cost widget:
//                                                 theoretical from the week's sales, actual from the
//                                                 stock period covering the week (else the latest
//                                                 closed one, named), the recent closed periods
//   venueOverTarget(tx, tenantId, venueId, pre)   the venue's dishes over their cost target now
//   menuMarginsWeek(tx, tenantId, venueId, from, to)   sold margins by menu (the widget)
//   setupGaps(tx, tenantId, venueId, { modules }) Home's set-up gaps for stock and costing (GAP_MODULES)
//   stockOverview(tx, tenantId, access)           each venue's stock in a line (the Overview tile)
//   sweepCostTargets(app, log, { tenantIds })     the job (jobs/cost-targets.js): each venue's dishes
//                                                 over target kept in cost_target_states, and the rule
//                                                 trigger dish_over_target fired once per crossing (and
//                                                 per rise in a band, for rules with a % of their own)
//   keepCrossings(tx, tenantId, venue, dishes, { only })   the one writer of cost_target_states, shared
//                                                 with the price creep hook (inventory phase 7b,
//                                                 services/priceCreepSvc.js: only the dishes a price
//                                                 change reached), so a crossing fires once whichever
//                                                 notices it first; lockCostTargets() before it

import { systemSql, withTenant } from '../config/db.js'
import { daysFoodCost, weekFoodCost, overTarget, targetCrossings, marginsByMenu, overviewWords } from '../../../shared/foodCost.js'
import { menuMargins } from '../../../shared/costing.js'
import { resolveItemTypes } from '../../../shared/catalogue.js'
import { PERIOD_COLS, periodFigures, periodDays, currentPeriod, toReview } from './stockVarianceSvc.js'
import { DAY_STARTS_AT } from './stockSvc.js'
import { loadDishCosting, loadCostingSettings, menusFor } from './dishCostSvc.js'
import { loadRecipes } from './costingSvc.js'
import { loadTaxRates } from './taxSvc.js'
import { fireRules } from '../ai/ruleRunner.js'

const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
// How many closed periods the widget lists, and how many of the best sellers Home's gap looks at.
export const RECENT_PERIODS = 4
export const TOP_SELLERS = 10
export const TOP_SELLER_DAYS = 14

/** Today (YYYY-MM-DD) in a time zone. */
export const localDay = (tz, at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/London' }).format(at)

/** The Monday (YYYY-MM-DD) of the week a day is in. */
export function weekStart(day) {
  const d = new Date(Date.parse(String(day).slice(0, 10) + 'T12:00:00Z'))
  return addDays(d.toISOString().slice(0, 10), -((d.getUTCDay() + 6) % 7))
}

async function venueOf(tx, tenantId, venueId) {
  const [v] = await tx`
    SELECT v.id, v.name, v.timezone, v.currency, ps.day_starts_at FROM venues v
      LEFT JOIN pos_settings ps ON ps.venue_id = v.id AND ps.tenant_id = v.tenant_id
     WHERE v.id = ${venueId} AND v.tenant_id = ${tenantId}`
  return v || null
}

/** A period's food cost as it stands: frozen when closed, else worked out now. */
async function periodFoodCost(tx, tenantId, p) {
  if (p.status === 'closed' && p.figures) return p.figures.food_cost || null
  return (await periodFigures(tx, tenantId, p)).food_cost
}

/** The days a stored period holds: a closed one's frozen days, an open one's worked out (periodDays()). */
async function heldDays(tx, tenantId, p) {
  if (p.status === 'closed' && p.days_from) return { from: p.days_from, to: p.days_to }
  return periodDays(tx, tenantId, p)
}

/**
 * The week from `start` (a Monday) at a venue: theoretical food cost from the
 * week's trading days' sales (dish_cost_days, daysFoodCost()), and actual
 * only from a stock period: the stored one whose trading days hold all seven
 * (placed as variance places them: each day at its last sale), else the
 * latest closed period. -> { venue_id, week_start, week_end, currency,
 * theoretical, actual, lines, recent: [closed periods' food cost] }
 */
export async function weekFigures(tx, tenantId, venueId, start) {
  const end = addDays(start, 6)
  const v = await venueOf(tx, tenantId, venueId)
  const tz = v?.timezone || 'Europe/London'
  const dayStart = v?.day_starts_at || DAY_STARTS_AT
  const [rows, [win]] = await Promise.all([
    tx`
      SELECT d.day::text AS day, d.item_type, d.left_out, sum(d.net_pence)::float8 AS net_pence, sum(d.cost)::float8 AS cost,
             sum(d.qty)::float8 AS qty, sum(d.uncosted_qty)::float8 AS uncosted_qty
        FROM dish_cost_days d
       WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${venueId} AND d.day BETWEEN ${start}::date AND ${end}::date
       GROUP BY d.day, d.item_type, d.left_out`,
    tx`SELECT ((${start}::date + ${dayStart}::time)::timestamp AT TIME ZONE ${tz}) AS from_at,
              ((${end}::date + 1 + ${dayStart}::time)::timestamp AT TIME ZONE ${tz}) AS to_at`,
  ])
  const week = daysFoodCost(rows)
  // Stored periods overlapping the week; the newest whose days hold all seven covers it.
  const around = await tx`
    SELECT ${tx.unsafe(PERIOD_COLS)} FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND from_at < ${win.to_at} AND to_at > ${win.from_at}
     ORDER BY to_at DESC`
  let period = null
  let covers = false
  for (const p of around) {
    const days = await heldDays(tx, tenantId, p)
    if (days.from && days.to && days.from <= start && days.to >= end) { period = p; covers = true; break }
  }
  const closed = await tx`
    SELECT ${tx.unsafe(PERIOD_COLS)} FROM stock_periods
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND status = 'closed'
     ORDER BY to_at DESC LIMIT ${RECENT_PERIODS}`
  if (!period) period = closed[0] || null
  const fc = period ? await periodFoodCost(tx, tenantId, period) : null
  const line = weekFoodCost({ week, period: period ? { ...period, food_cost: fc } : null, covers, currency: v?.currency || 'GBP' })
  const recent = closed.map(p => {
    const f = p.figures?.food_cost || {}
    const complete = !!f.complete && f.actual_pct != null
    return {
      id: p.id, from_at: p.from_at, to_at: p.to_at,
      actual_pct: complete ? f.actual_pct : null, theoretical_pct: f.theoretical_pct ?? null, gap_pts: complete ? f.gap_pts ?? null : null,
      complete, net_food_pence: f.net_food_pence ?? null,
    }
  })
  return { venue_id: venueId, week_start: start, week_end: end, currency: v?.currency || 'GBP', ...line, recent, worked_at: new Date().toISOString() }
}

/**
 * The venue's dishes over their cost target now: every live menu for it (the
 * group's and its own) at every active order type, through menuMargins() at
 * today's standard prices, then overTarget(). pre: what a sweep loaded once
 * for the group ({ menus, types, rates, settings, recipes }).
 * -> { dishes: overTarget()'s, menus, settings }
 */
export async function venueOverTarget(tx, tenantId, venueId, pre = {}) {
  const menus = (pre.menus || (await menusFor(tx, tenantId, 'live')).map(m => resolveItemTypes(m)))
    .filter(m => !m.venue_id || m.venue_id === venueId)
  const settings = pre.settings || await loadCostingSettings(tx, tenantId)
  if (!menus.length) return { dishes: [], menus: 0, settings }
  const [types, rates, recipes] = await Promise.all([
    pre.types || tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
    pre.rates || loadTaxRates(tx, tenantId),
    pre.recipes || loadRecipes(tx, tenantId),
  ])
  const ctx = await loadDishCosting(tx, tenantId, venueId, { recipes })
  const rows = []
  const scopes = types.length ? types : [{ id: null, name: null }]
  for (const menu of menus) {
    for (const t of scopes) {
      for (const r of menuMargins(menu, { venue_id: venueId, revenue_stream_id: null, order_type_id: t.id }, ctx, { rates, settings, withOptions: false })) {
        rows.push({ ...r, menu_id: menu.id, menu: menu.name, order_type_id: t.id, order_type: t.name })
      }
    }
  }
  return { dishes: overTarget(rows), menus: menus.length, settings }
}

/**
 * Sold margins by menu at a venue over some trading days (the margin by menu
 * widget): dish_cost_days by dish, each dish's menu through its section
 * (menu_sections, the draft's ids), soldMargins() per menu (marginsByMenu()).
 */
export async function menuMarginsWeek(tx, tenantId, venueId, from, to) {
  const [rows, settings] = await Promise.all([
    tx`
      SELECT d.dish_id, d.name, d.section_id, d.section, d.left_out, m.id AS menu_id, m.name AS menu,
             sum(d.qty)::float8 AS qty, sum(d.sales_pence)::float8 AS sales_pence, sum(d.net_pence)::float8 AS net_pence,
             sum(d.cost)::float8 AS cost, sum(d.uncosted_qty)::float8 AS uncosted_qty, sum(d.typical_qty)::float8 AS typical_qty
        FROM dish_cost_days d
        LEFT JOIN menu_sections s ON s.id = d.section_id AND s.tenant_id = d.tenant_id
        LEFT JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id
       WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${venueId} AND d.day BETWEEN ${from}::date AND ${to}::date
       GROUP BY d.dish_id, d.name, d.section_id, d.section, d.left_out, m.id, m.name`,
    loadCostingSettings(tx, tenantId),
  ])
  return marginsByMenu(rows, settings)
}

// The modules Home's stock and costing set-up gaps are for (each gap is offered to whoever manages its own).
export const GAP_MODULES = ['stock', 'recipes', 'purchasing_setup']

/**
 * Home's set-up gaps for stock and costing at a venue (services/suggestions.js
 * offers each to whoever manages its module): no storage areas (Stock, once
 * the group has inventory items), best sellers of the last TOP_SELLER_DAYS days
 * with no recipe (Recipes, from usage from sales), inventory items used in
 * recipes with no price (Purchasing setup: as the cost engine prices them, an
 * active supplier price from an active supplier, or a delivery received in
 * the item's base unit). modules: only the gaps of these (the caller's, by the
 * route), so a best seller's name reaches only someone who manages Recipes.
 * A gap's path is a menu page and its tab separate (Home matches the page
 * against the person's menu, then pageLink() adds the venue and tab).
 * -> [{ key, module, path, tab?, reason }]
 */
export async function setupGaps(tx, tenantId, venueId, { modules = GAP_MODULES } = {}) {
  const wants = m => modules.includes(m)
  const [[v], [areas], top, [unpriced]] = await Promise.all([
    tx`SELECT name FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`,
    wants('stock') ? tx`
      SELECT (SELECT count(*)::int FROM stock_areas WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}) AS areas,
             EXISTS (SELECT 1 FROM inv_items WHERE tenant_id = ${tenantId} AND is_active) AS has_items` : [null],
    wants('recipes') ? tx`
      SELECT d.dish_id, d.name, sum(d.qty)::float8 AS qty, bool_and(d.recipe_id IS NULL) AS no_recipe
        FROM dish_cost_days d
       WHERE d.tenant_id = ${tenantId} AND d.venue_id = ${venueId} AND d.left_out IS NULL AND d.dish_id IS NOT NULL
         AND d.day >= current_date - ${TOP_SELLER_DAYS}::int
       GROUP BY d.dish_id, d.name
       ORDER BY sum(d.qty) DESC, d.name LIMIT ${TOP_SELLERS}` : [],
    // Priced as the cost engine prices (loadItemQuotes() and loadReceipts()): a switched-off quote,
    // or one from a switched-off supplier, is no price; nor is a delivery booked in another unit.
    wants('purchasing_setup') ? tx`
      SELECT count(DISTINCT i.id)::int AS n FROM inv_items i
        JOIN recipe_lines l ON l.item_id = i.id AND l.tenant_id = i.tenant_id
       WHERE i.tenant_id = ${tenantId} AND i.is_active
         AND NOT EXISTS (
           SELECT 1 FROM inv_quotes q JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = q.tenant_id
            WHERE q.item_id = i.id AND q.tenant_id = i.tenant_id AND q.is_active AND s.is_active)
         AND NOT EXISTS (
           SELECT 1 FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
            WHERE pl.item_id = i.id AND pl.tenant_id = i.tenant_id AND pl.received_qty > 0 AND pl.pack_base_qty > 0
              AND pl.base_unit = i.base_unit AND po.received_at IS NOT NULL AND po.status <> 'cancelled')` : [null],
  ])
  const at = v?.name ? ' at ' + v.name : ''
  const gaps = []
  if (areas?.has_items && !areas.areas) {
    gaps.push({ key: 'no_stock_areas:' + venueId, module: 'stock', path: '/stock', tab: 'settings', reason: 'No storage areas' + at + ' yet: the count sheet follows them shelf by shelf' })
  }
  const missing = top.filter(d => d.no_recipe)
  if (missing.length) {
    const names = missing.slice(0, 3).map(d => d.name).join(', ')
    // The Recipes page opens on coverage by sales: the dishes not costed, by sales value, with how to fix each.
    gaps.push({
      key: 'top_sellers_no_recipe:' + venueId, module: 'recipes', path: '/recipes',
      reason: missing.length + ' of the ' + top.length + ' best sellers' + at + ' have no recipe (' + names + (missing.length > 3 ? ' and more' : '') + '), so their cost isn\'t known',
    })
  }
  if (unpriced?.n) {
    gaps.push({ key: 'items_no_price', module: 'purchasing_setup', path: '/inventory', reason: unpriced.n + (unpriced.n === 1 ? ' inventory item used in recipes has' : ' inventory items used in recipes have') + ' no supplier price yet' })
  }
  return gaps
}

/**
 * Each active venue's stock in a line (the Overview tile): its last approved
 * full count, counts waiting for approval, transfers to receive, the latest
 * closed period's flagged items not reviewed and, with Costing view and till
 * reports view (access.sees_sales), this week's theoretical food cost % and
 * the latest closed period's actual against theoretical.
 */
export async function stockOverview(tx, tenantId, access) {
  const venues = await tx`SELECT id, name, timezone FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY lower(name)`
  const out = []
  let start = null
  for (const v of venues) {
    start = weekStart(localDay(v.timezone))
    const [[c], review] = await Promise.all([
      tx`
        SELECT (SELECT max(counted_at) FROM stock_counts WHERE tenant_id = ${tenantId} AND venue_id = ${v.id} AND status = 'approved' AND kind = 'full') AS last_full_count_at,
               (SELECT count(*)::int FROM stock_counts WHERE tenant_id = ${tenantId} AND venue_id = ${v.id} AND status = 'submitted') AS to_approve,
               (SELECT count(*)::int FROM stock_transfers WHERE tenant_id = ${tenantId} AND to_venue_id = ${v.id} AND status = 'sent') AS incoming`,
      toReview(tx, tenantId, v.id),
    ])
    const row = {
      venue_id: v.id, venue: v.name, last_full_count_at: c.last_full_count_at, to_approve: c.to_approve, incoming: c.incoming,
      flagged: review.reduce((n, p) => n + p.flagged, 0), unreviewed: review.reduce((n, p) => n + p.unreviewed, 0),
      has_period: !!(await currentPeriod(tx, tenantId, v.id)),
    }
    if (access.sees_sales) {
      const w = await weekFigures(tx, tenantId, v.id, start)
      row.theoretical_pct = w.theoretical.theoretical_pct
      row.actual = w.actual ? { pct: w.actual.pct, theoretical_pct: w.actual.theoretical_pct, covers: w.actual.covers, words: w.actual.period.words } : null
    }
    out.push({ ...row, words: overviewWords(row) })
  }
  return { venues: out, week_start: start, sees_sales: access.sees_sales }
}

// ── The cost targets sweep (the rule trigger dish_over_target) ──────────────

/** The lock the sweep and the price creep hook take before reading or writing a group's cost_target_states. */
export const lockCostTargets = (tx, tenantId) => tx`SELECT pg_advisory_xact_lock(hashtext(${'cost_targets:' + tenantId}))`

/**
 * The one place cost_target_states changes (rule 12), shared by the hourly
 * sweep (trackCostTargets(), every dish of every live menu) and the price
 * creep hook (services/priceCreepSvc.js, inventory phase 7b: only the dishes
 * whose recipes use the changed items, `only`), so the rule trigger fires once
 * for a crossing whichever of them notices it first: the dishes over target
 * at a venue now (overTarget()'s, of `only` when given) against the ones kept
 * there (of `only`). Crossings are written with `since` now and returned as
 * rule events (kind 'crossed'); dishes back under are deleted; the rest keep
 * their `since`, and those whose cost % went up are events too (kind 'rose',
 * keyed by their new cost %), which only a rule with a percentage of its own
 * takes, when the rise passes it (matches() in shared/rules.js). Each event
 * carries the last look's prev_band and prev_cost_pct (null when new). In the
 * caller's transaction, under lockCostTargets(). -> [event]
 */
export async function keepCrossings(tx, tenantId, venue, dishes, { only = null } = {}) {
  const ids = only ? [...only] : null
  if (ids && !ids.length) return []
  const states = await tx`
    SELECT dish_id, band, since, cost_pct::float8 AS cost_pct FROM cost_target_states
     WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id} ${ids ? tx`AND dish_id = ANY(${ids}::uuid[])` : tx``}`
  const now = only ? (dishes || []).filter(d => only.has(d.dish_id)) : (dishes || [])
  const { crossed, cleared, kept, rose } = targetCrossings(states, now)
  if (cleared.length) await tx`DELETE FROM cost_target_states WHERE tenant_id = ${tenantId} AND venue_id = ${venue.id} AND dish_id = ANY(${cleared}::uuid[])`
  const events = []
  for (const d of [...crossed, ...kept]) {
    const isNew = crossed.includes(d)
    const risen = !isNew && rose.includes(d)
    const [row] = await tx`
      INSERT INTO cost_target_states (tenant_id, venue_id, dish_id, name, menu_id, menu, order_type_id, band, cost_pct, target_pct, limit_pct, since, seen_at)
      VALUES (${tenantId}, ${venue.id}, ${d.dish_id}, ${String(d.name).slice(0, 200)}, ${d.menu_id}, ${d.menu}, ${d.order_type_id}, ${d.band},
              ${d.cost_pct}, ${d.target_pct}, ${d.limit_pct}, ${isNew ? new Date() : d.since}, now())
      ON CONFLICT (tenant_id, venue_id, dish_id) DO UPDATE SET name = EXCLUDED.name, menu_id = EXCLUDED.menu_id, menu = EXCLUDED.menu,
        order_type_id = EXCLUDED.order_type_id, band = EXCLUDED.band, cost_pct = EXCLUDED.cost_pct, target_pct = EXCLUDED.target_pct,
        limit_pct = EXCLUDED.limit_pct, since = EXCLUDED.since, seen_at = now()
      RETURNING since`
    if (isNew || risen) {
      const day = new Date().toISOString().slice(0, 10)
      // A crossing by venue, dish, band and `since`; a rise by its new cost % too (within one time over).
      const key = venue.id + ':' + d.dish_id + ':' + d.band + ':' + new Date(row.since).getTime() + (risen ? ':rose:' + d.cost_pct : '')
      events.push({
        trigger: 'dish_over_target', kind: isNew ? 'crossed' : 'rose', key, day,
        venue_id: venue.id, venue: venue.name, dish: d.name, menu: d.menu || '', section: d.section || '', order_type: d.order_type || '',
        cost_pct: d.cost_pct, target_pct: d.target_pct, limit_pct: d.limit_pct, band: d.band,
        prev_band: d.prev_band ?? null, prev_cost_pct: d.prev_cost_pct ?? null,
        band_words: d.band === 'over' ? 'over the limit' : 'over the target',
      })
    }
  }
  return events
}

/**
 * One group: each active venue's dishes over target now (venueOverTarget(),
 * every live menu), kept by keepCrossings(). In the caller's transaction
 * (withTenant), under lockCostTargets(). -> [event]
 */
export async function trackCostTargets(tx, tenantId) {
  const venues = await tx`SELECT id, name FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY created_at`
  const live = await menusFor(tx, tenantId, 'live')
  if (!live.length) {
    await tx`DELETE FROM cost_target_states WHERE tenant_id = ${tenantId}`
    return []
  }
  const [types, rates, settings, recipes] = await Promise.all([
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
    loadTaxRates(tx, tenantId), loadCostingSettings(tx, tenantId), loadRecipes(tx, tenantId),
  ])
  const pre = { menus: live.map(m => resolveItemTypes(m)), types, rates, settings, recipes }
  const events = []
  for (const v of venues) {
    const { dishes } = await venueOverTarget(tx, tenantId, v.id, pre)
    events.push(...await keepCrossings(tx, tenantId, v, dishes))
  }
  return events
}

/**
 * Every group with live menus and recipe links (system mode to find them; each
 * group then in its own withTenant()): trackCostTargets(), then each crossing
 * and rise offered to the group's rules (fireRules(): once per rule and event,
 * capped per day). tenantIds narrows the groups (a test). -> { tenants, crossed, rose, fired, failed }
 */
export async function sweepCostTargets(app, log = null, { tenantIds = null } = {}) {
  const tenants = tenantIds
    ? tenantIds.map(id => ({ tenant_id: id }))
    : await systemSql`SELECT DISTINCT tenant_id FROM recipe_links UNION SELECT DISTINCT tenant_id FROM cost_target_states`
  const out = { tenants: 0, crossed: 0, rose: 0, fired: 0, failed: 0 }
  for (const { tenant_id: tenantId } of tenants) {
    try {
      const events = await withTenant(tenantId, async tx => {
        await lockCostTargets(tx, tenantId)
        return trackCostTargets(tx, tenantId)
      })
      out.tenants++
      out.crossed += events.filter(e => e.kind === 'crossed').length
      out.rose += events.filter(e => e.kind === 'rose').length
      for (const e of events) {
        const r = await fireRules(app, tenantId, e, log || undefined)
        out.fired += r.filter(x => x.status === 'done').length
      }
    } catch (err) {
      out.failed++
      log?.warn?.({ err: err?.message, tenantId }, 'Cost targets sweep failed for a group')
    }
  }
  return out
}
