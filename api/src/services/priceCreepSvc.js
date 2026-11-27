// src/services/priceCreepSvc.js
//
// Price creep (inventory phase 7b, migration 315; docs/INVENTORY.md 8.2,
// 10.4). Public: the purchasing area's routes call priceChanged() after each
// change of a supplier price (a price typed in or edited, a venue's own price,
// an inventory import, a supplier's price list by code, an invoice's prices
// applied), in the same transaction, and register firesCostAlerts() once per
// plugin so the rule events go out after the change is saved.
//
//   priceCreep(tx, tenantId, change)   the work: the dishes whose recipes use
//       the changed items (the index from item to recipes to dishes,
//       dishesUsing() in shared/priceCreep.js, and the meal deals that can hold
//       them), costed at each venue and order type before the change (the price
//       history as it was: pricesAt()) and after it, by menuMargins() at today's
//       standard prices; the ones that crossed their cost target or limit
//       (priceCrossings(), the sweep's crossing rule) recorded in cost_alerts
//       with what moved (dishMoves()), and cost_target_states kept by
//       keepCrossings() (services/stockFoodCostSvc.js, the one function the
//       hourly sweep keeps them by), so the rule trigger dish_over_target fires
//       once whichever of the two notices a crossing first.
//       change: { quoteIds, venueIds (null: every venue: a company price),
//                 source (CREEP_SOURCE_KEYS), by, poId }
//       -> { worked: [dish ids], alerts: [cost_alerts rows], events: [rule events] }
//   priceChanged(tx, req, change)      the hook: priceCreep() in a savepoint
//       (a failure never stops the price being saved; it is logged), its rule
//       events kept on the request for firesCostAlerts()
//   firesCostAlerts(app)               an onResponse hook: the request's rule
//       events offered to the group's rules once the change was answered with
//       success (fireRulesLater(): never waited for)
//   loadCostAlerts(tx, tenantId, { venueId, since, unseen, dishId, limit })
//   historyFor(tx, tenantId, quoteIds) the price history rows pricesAt() reads
//   whyCostChanged(tx, tenantId, { dishId, venueId, orderTypeId, since })
//       a live dish's cost now against its cost at the start of a day (Pepper's
//       why_cost_changed, GET /api/cost-alerts/why): the same recipe at that
//       day's supplier prices (pricesAt() over the price history) and at
//       today's, each item it uses that moved and what that did to a serving
//       (dishMoves()), its cost % then and now at today's menu price, the
//       recipes changed since (recipes keep no history, so that is said, not
//       priced), the items with no price history back then, and the cost
//       alerts recorded for it since

import { fireRulesLater } from '../ai/ruleRunner.js'
import { loadRecipes } from './costingSvc.js'
import { loadDishCosting, loadLinks, loadCostingSettings, menusFor } from './dishCostSvc.js'
import { loadTaxRates } from './taxSvc.js'
import { keepCrossings, lockCostTargets, localDay } from './stockFoodCostSvc.js'
import { menuMargins, dishMap, dishMargin, usageOf } from '../../../shared/costing.js'
import { overTarget } from '../../../shared/foodCost.js'
import { menuCtx, comboItemIds, isCombo } from '../../../shared/combos.js'
import { resolveItemTypes } from '../../../shared/catalogue.js'
import { variantRules } from '../../../shared/orderPricing.js'
import { zonedToUtc } from './orderSvc.js'
import { httpError } from '../middleware/error.js'
import { pricesAt, dishesUsing, dealsHolding, dishMoves, priceCrossings, causeWords, CREEP_SOURCE_KEYS } from '../../../shared/priceCreep.js'

export const ALERT_COLS = `a.id, a.venue_id, v.name AS venue, a.dish_id, a.name, a.menu_id, a.menu, a.section, a.order_type_id, a.order_type,
  a.old_cost_pct::float8 AS old_cost_pct, a.new_cost_pct::float8 AS new_cost_pct, a.old_band, a.new_band,
  a.threshold_pct::float8 AS threshold_pct, a.target_pct::float8 AS target_pct, a.limit_pct::float8 AS limit_pct,
  a.source, a.cause, a.causes, a.po_id, a.changed_by, a.day::text AS day, a.at, a.seen_by, a.seen_at`

/** The price history of these supplier prices, oldest first (what pricesAt() reads). */
export function historyFor(tx, tenantId, quoteIds) {
  if (!quoteIds.length) return []
  return tx`
    SELECT quote_id, venue_id, price::float8 AS price, pack_base_qty::float8 AS pack_base_qty, changed_at
      FROM inv_price_history
     WHERE tenant_id = ${tenantId} AND quote_id = ANY(${quoteIds}::uuid[])
     ORDER BY changed_at, id`
}

/** The recipes linked to these dishes (at any scope) and every prep recipe inside them: Map id -> recipe. */
function recipesFor(recipes, links, dishIds) {
  const out = new Map()
  const todo = links.filter(l => dishIds.has(l.dish_id)).map(l => l.recipe_id)
  while (todo.length) {
    const id = todo.pop()
    if (out.has(id) || !recipes.has(id)) continue
    const r = recipes.get(id)
    out.set(id, r)
    for (const l of r.lines || []) if (l.sub_recipe_id && !out.has(l.sub_recipe_id)) todo.push(l.sub_recipe_id)
  }
  return out
}

// A ctx with one menu's dishes in it, as menuMargins() makes it (a meal deal's picks come from the menu).
const onMenu = (ctx, menu) => ({ ...ctx, dishes: dishMap([menu], ctx.dishes), combo: menuCtx(menu) })

export async function priceCreep(tx, tenantId, change = {}) {
  const empty = { worked: [], alerts: [], events: [] }
  const quoteIds = [...new Set((change.quoteIds || []).filter(Boolean))]
  if (!quoteIds.length) return empty
  const source = CREEP_SOURCE_KEYS.includes(change.source) ? change.source : 'manual'
  const items = await tx`SELECT DISTINCT item_id FROM inv_quotes WHERE tenant_id = ${tenantId} AND id = ANY(${quoteIds}::uuid[])`
  const itemIds = items.map(r => r.item_id)
  if (!itemIds.length) return empty

  // The index: the recipes using the items, up through the prep recipes they sit in, to the dishes linked to any of them.
  const [recipes, links] = await Promise.all([loadRecipes(tx, tenantId), loadLinks(tx, tenantId)])
  const { dishIds } = dishesUsing(itemIds, recipes, links)
  if (!dishIds.size) return empty
  // On a live menu (what is sold), with the meal deals that can hold them.
  const live = (await menusFor(tx, tenantId, 'live')).map(m => resolveItemTypes(m))
  const work = new Set([...dishIds, ...dealsHolding(live, dishIds)])
  const menus = live.filter(m => (m.sections || []).some(s => (s.items || []).some(i => work.has(i.id))))
  if (!menus.length) return empty
  // What costing them needs: their recipes, and those of every dish a deal among them can hold.
  const need = new Set(work)
  for (const m of menus) {
    const mctx = menuCtx(m)
    for (const s of m.sections || []) for (const i of s.items || []) if (work.has(i.id) && isCombo(i)) for (const id of comboItemIds(i, mctx)) need.add(id)
  }
  const [ctx, types, rates, settings, venueRows, [{ now }]] = await Promise.all([
    loadDishCosting(tx, tenantId, null, { recipes: recipesFor(recipes, links, need) }),
    tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`,
    loadTaxRates(tx, tenantId), loadCostingSettings(tx, tenantId),
    tx`SELECT id, name, timezone FROM venues WHERE tenant_id = ${tenantId} AND is_active ORDER BY created_at`,
    tx`SELECT now() AS now`,
  ])
  // The changed items' supplier prices as they were before this change: its history rows carry the
  // transaction's own moment, so "before" is every row strictly before it.
  const changedQuotes = itemIds.flatMap(id => (ctx.quotes.get(id) || []).map(q => q.id))
  const history = await historyFor(tx, tenantId, changedQuotes)
  const then = pricesAt(new Map(itemIds.map(id => [id, ctx.quotes.get(id) || []])), history, now, { strict: true })
  const priorQuotes = new Map(ctx.quotes)
  for (const [id, qs] of then.quotes) priorQuotes.set(id, qs)
  const before = { ...ctx, quotes: priorQuotes, _memo: new Map() }
  const after = { ...ctx, _memo: new Map() }
  const scopes = types.length ? types : [{ id: null, name: null }]
  const venues = change.venueIds?.length ? venueRows.filter(v => change.venueIds.includes(v.id)) : venueRows

  await lockCostTargets(tx, tenantId)
  const alerts = []
  const events = []
  for (const v of venues) {
    const here = menus.filter(m => !m.venue_id || m.venue_id === v.id)
    if (!here.length) continue
    const b = { ...before, venueId: v.id }
    const a = { ...after, venueId: v.id }
    const rowsB = []
    const rowsA = []
    for (const m of here) {
      for (const t of scopes) {
        const scope = { venue_id: v.id, revenue_stream_id: null, order_type_id: t.id }
        const tag = r => ({ ...r, menu_id: m.id, menu: m.name, order_type_id: t.id, order_type: t.name })
        for (const r of menuMargins(m, scope, b, { rates, settings, withOptions: false, only: work })) rowsB.push(tag(r))
        for (const r of menuMargins(m, scope, a, { rates, settings, withOptions: false, only: work })) rowsA.push(tag(r))
      }
    }
    // The states first (the rule trigger, by the sweep's own function), then the alerts.
    events.push(...await keepCrossings(tx, tenantId, v, overTarget(rowsA), { only: work }))
    const day = localDay(v.timezone, new Date(now))
    for (const c of priceCrossings(rowsB, rowsA)) {
      const menu = here.find(m => m.id === c.menu_id)
      const scope = { venue_id: v.id, revenue_stream_id: null, order_type_id: c.order_type_id }
      const moves = menu ? dishMoves(c.dish_id, scope, onMenu(b, menu), onMenu(a, menu)) : { items: [] }
      const causes = moves.items.map(m => ({
        item_id: m.item_id, name: m.name, base_unit: m.base_unit, qty_base: m.qty_base,
        before: m.before, after: m.after, pct: m.pct, effect: m.effect, quote_before: m.quote_before, quote_after: m.quote_after,
      }))
      const [row] = await tx`
        INSERT INTO cost_alerts (tenant_id, venue_id, dish_id, name, menu_id, menu, section, order_type_id, order_type,
                                 old_cost_pct, new_cost_pct, old_band, new_band, threshold_pct, target_pct, limit_pct,
                                 source, cause, causes, po_id, changed_by, day, at)
        VALUES (${tenantId}, ${v.id}, ${c.dish_id}, ${String(c.name).slice(0, 200)}, ${c.menu_id}, ${c.menu}, ${c.section}, ${c.order_type_id}, ${c.order_type},
                ${c.old_cost_pct}, ${c.new_cost_pct}, ${c.old_band}, ${c.new_band}, ${c.threshold_pct}, ${c.target_pct}, ${c.limit_pct},
                ${source}, ${causeWords(causes).slice(0, 500)}, ${tx.json(causes)}, ${change.poId ?? null}, ${change.by ?? null}, ${day}, ${now})
        RETURNING id`
      alerts.push({ id: row.id, venue_id: v.id, venue: v.name, ...c, source, cause: causeWords(causes), causes, day })
    }
  }
  return { worked: [...work], alerts, events }
}

/**
 * The hook the purchasing routes call after a supplier price changes, in the
 * transaction that changed it: priceCreep() in a savepoint, so a failure in
 * it never stops the price being saved (it is logged); the rule events are
 * kept on the request and sent by firesCostAlerts() once the answer went out.
 */
export async function priceChanged(tx, req, change = {}) {
  try {
    const r = await tx.savepoint(sp => priceCreep(sp, req.tenantId, { by: req.user?.email ?? null, ...change }))
    if (r.events.length) (req.costEvents ||= []).push(...r.events)
    return r
  } catch (err) {
    req.log?.warn?.({ err: err?.message }, 'Price creep not worked out')
    return { worked: [], alerts: [], events: [], failed: true }
  }
}

/** Once per route plugin that calls priceChanged(): its rule events go to the group's rules after a successful answer. */
export function firesCostAlerts(app) {
  app.addHook('onResponse', async (req, reply) => {
    const events = req.costEvents
    req.costEvents = null
    if (!events?.length || reply.statusCode >= 400 || !req.tenantId) return
    for (const e of events) fireRulesLater(app, req.tenantId, e, req.log)
  })
}

/** Cost alerts, newest first: at a venue, since a day, not seen yet, for a dish. */
export function loadCostAlerts(tx, tenantId, { venueId = null, since = null, unseen = false, dishId = null, limit = 200 } = {}) {
  return tx`
    SELECT ${tx.unsafe(ALERT_COLS)}
      FROM cost_alerts a
      JOIN venues v ON v.id = a.venue_id AND v.tenant_id = a.tenant_id
     WHERE a.tenant_id = ${tenantId}
       ${venueId ? tx`AND a.venue_id = ${venueId}` : tx``}
       ${since ? tx`AND a.day >= ${since}::date` : tx``}
       ${unseen ? tx`AND a.seen_at IS NULL` : tx``}
       ${dishId ? tx`AND a.dish_id = ${dishId}` : tx``}
     ORDER BY a.at DESC, a.name
     LIMIT ${limit}`
}

/** A dish on a live menu: { menu, section, item }, or null. */
function liveDish(menus, dishId) {
  for (const m of menus) for (const s of m.sections || []) for (const i of s.items || []) if (i.id === dishId) return { menu: m, section: s, item: i }
  return null
}

export async function whyCostChanged(tx, tenantId, { dishId, venueId = null, orderTypeId = null, since }) {
  const live = (await menusFor(tx, tenantId, 'live')).map(m => resolveItemTypes(m))
  const found = liveDish(live, dishId)
  if (!found) throw httpError(404, 'Dish not found on a live menu')
  const { menu, section, item } = found
  const [venue] = venueId ? await tx`SELECT id, name, timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}` : [null]
  if (venueId && !venue) throw httpError(404, 'Venue not found')
  const types = await tx`SELECT id, name FROM order_types WHERE tenant_id = ${tenantId} AND is_active ORDER BY sort_order, name`
  const type = orderTypeId ? types.find(t => t.id === orderTypeId) : types[0] || null
  if (orderTypeId && !type) throw httpError(404, 'Order type not found')
  const tz = venue?.timezone || 'Europe/London'
  const at = zonedToUtc(since, '00:00', tz)
  const scope = { venue_id: venue?.id ?? null, revenue_stream_id: null, order_type_id: type?.id ?? null }
  const [ctx, rates, settings] = await Promise.all([
    loadDishCosting(tx, tenantId, scope.venue_id, { menus: [menu] }), loadTaxRates(tx, tenantId), loadCostingSettings(tx, tenantId),
  ])
  const now = onMenu({ ...ctx, _memo: new Map() }, menu)
  // The items one serving uses now (a meal deal's typical picks), and their supplier prices as they were.
  const itemIds = usageOf({ dish_id: dishId, qty: 1 }, scope, now).items.map(i => i.item_id)
  const quotes = new Map(itemIds.map(id => [id, ctx.quotes.get(id) || []]))
  const history = await historyFor(tx, tenantId, [...quotes.values()].flat().map(q => q.id))
  const then = pricesAt(quotes, history, at)
  const priorQuotes = new Map(ctx.quotes)
  for (const [id, qs] of then.quotes) priorQuotes.set(id, qs)
  const before = onMenu({ ...ctx, quotes: priorQuotes, _memo: new Map() }, menu)
  const moves = dishMoves(dishId, scope, before, now)
  const rules = variantRules(menu)
  const rowThen = dishMargin(item, section, menu, scope, before, { rates, settings, rules, withOptions: false })
  const rowNow = dishMargin(item, section, menu, scope, now, { rates, settings, rules, withOptions: false })
  const pct = r => (r.kind === 'deal' ? r.cost_pct_max : r.cost_pct)
  // Recipes keep no history: the ones this dish uses that were changed since are named, not priced.
  const recipeIds = [...new Set(ctx.links.filter(l => l.dish_id === dishId || (isCombo(item) && comboItemIds(item, menuCtx(menu)).includes(l.dish_id))).map(l => l.recipe_id))]
  const changed = recipeIds.length ? await tx`
    SELECT name, updated_at FROM recipes WHERE tenant_id = ${tenantId} AND id = ANY(${recipeIds}::uuid[]) AND updated_at >= ${at}
     ORDER BY updated_at DESC` : []
  const unknownItems = [...new Set(then.unknown.map(qid => [...quotes.entries()].find(([, qs]) => qs.some(q => q.id === qid))?.[0]).filter(Boolean))]
    .map(id => ctx.items.get(id)?.name).filter(Boolean)
  const alerts = await loadCostAlerts(tx, tenantId, { venueId: scope.venue_id, since, dishId })
  return {
    dish: { id: item.id, name: item.name, menu: menu.name, section: section.title ?? null, kind: rowNow.kind },
    venue: venue ? { id: venue.id, name: venue.name } : null, order_type: type ? { id: type.id, name: type.name } : null,
    since, at,
    cost_then: moves.cost_before, cost_now: moves.cost_after, change: moves.change,
    change_pct: moves.cost_before > 0 && moves.cost_after != null ? Math.round((moves.cost_after - moves.cost_before) / moves.cost_before * 1000) / 10 : null,
    cost_pct_then: pct(rowThen) ?? null, cost_pct_now: pct(rowNow) ?? null, band_then: rowThen.band ?? null, band_now: rowNow.band ?? null,
    price_pence: rowNow.price_pence ?? null, thresholds: rowNow.thresholds,
    items: moves.items, uncosted: moves.uncosted,
    no_history: unknownItems, recipes_changed: changed.map(r => ({ name: r.name, at: r.updated_at })),
    alerts,
  }
}
