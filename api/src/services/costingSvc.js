// src/services/costingSvc.js
//
// What the cost engine (shared/costing.js) needs, read once per request
// (inventory phase 1, docs/INVENTORY.md 5.5): every recipe of the group with
// its lines (nesting is checked across all of them), the inventory items the
// lines use with their own units, those items' live supplier prices with
// each venue's own price, the preferred prices, and what was received of
// them (the price paid per pack: the invoice's, else the price ordered at).
// Read as the tenant and filtered by tenant_id, as every query is.
//
//   loadRecipes(tx, tenantId)            Map id -> recipe with its lines
//   loadCosting(tx, tenantId, venueId, { basis, recipes, itemIds })
//                                        the ctx recipeCost() / explain() take
//                                        (itemIds: items no recipe line uses
//                                        to price too, as option rules' items):
//                                        { items, recipes, quotes, preferred,
//                                        receipts, since, venueId, basis }
//   recipeView(recipe, ctx, { costs, prices })   a recipe with its cost, lines,
//                                        gaps and coverage; money only with costs

import { loadItemQuotes, loadPreferred } from './purchasingSvc.js'
import { recipeCost, explain, AVERAGE_DAYS, BASIS_KEYS } from '../../../shared/costing.js'

const RECIPE_COLS = tx => tx`
  r.id, r.name, r.kind, r.category, r.yield_qty::float8 AS yield_qty, r.yield_unit, r.portions::float8 AS portions,
  r.loss_pct::float8 AS loss_pct, r.method, r.photo_url, r.shelf_life_hours, r.code, r.status, r.variant_of,
  r.notes, r.is_active, r.created_by, r.created_at, r.updated_at`

/** Every recipe of the group (or these), with its lines in order: Map id -> recipe. */
export async function loadRecipes(tx, tenantId, ids = null) {
  const rows = await tx`
    SELECT ${RECIPE_COLS(tx)} FROM recipes r
     WHERE r.tenant_id = ${tenantId} ${ids ? tx`AND r.id = ANY(${ids}::uuid[])` : tx``}
     ORDER BY lower(r.name), r.created_at`
  const lines = rows.length ? await tx`
    SELECT l.id, l.recipe_id, l.sort_order, l.item_id, l.sub_recipe_id, l.qty::float8 AS qty, l.unit,
           l.yield_pct::float8 AS yield_pct, l.note
      FROM recipe_lines l
     WHERE l.tenant_id = ${tenantId} AND l.recipe_id = ANY(${rows.map(r => r.id)}::uuid[])
     ORDER BY l.recipe_id, l.sort_order, l.id` : []
  const map = new Map(rows.map(r => [r.id, { ...r, lines: [] }]))
  for (const l of lines) map.get(l.recipe_id)?.lines.push(l)
  return map
}

/** Inventory items by id with their own units (no prices). */
export async function loadCostItems(tx, tenantId, ids = null) {
  if (ids && !ids.length) return new Map()
  const items = await tx`
    SELECT i.id, i.name, i.base_unit, i.yield_pct::float8 AS yield_pct, i.recipe_unit, i.count_unit, i.is_active,
           i.code, i.storage, c.name AS category_name
      FROM inv_items i LEFT JOIN inv_categories c ON c.id = i.category_id AND c.tenant_id = i.tenant_id
     WHERE i.tenant_id = ${tenantId} ${ids ? tx`AND i.id = ANY(${ids}::uuid[])` : tx``}
     ORDER BY lower(i.name)`
  const units = items.length ? await tx`
    SELECT id, item_id, name, base_qty::float8 AS base_qty FROM inv_item_units
     WHERE tenant_id = ${tenantId} AND item_id = ANY(${items.map(i => i.id)}::uuid[])
     ORDER BY lower(name)` : []
  const map = new Map(items.map(i => [i.id, { ...i, units: [] }]))
  for (const u of units) map.get(u.item_id)?.units.push({ id: u.id, name: u.name, base_qty: u.base_qty })
  return map
}

/**
 * What was received of these items (at one venue, or every venue): the
 * receipts of the last AVERAGE_DAYS days and, older than that, each venue's
 * latest of each item (the last price paid). price = what was paid per pack
 * (invoice_price, else the price ordered at), ex VAT, pounds. Only lines in
 * the item's base unit as it is now: a line booked in before its base unit
 * changed has its pack size in the old unit (24 each is no 24 g), so it is
 * no price per base unit and is left out, never costed in the wrong unit.
 */
export async function loadReceipts(tx, tenantId, itemIds, venueId = null) {
  const out = {}
  if (!itemIds.length) return { receipts: out, since: null }
  const since = new Date(Date.now() - AVERAGE_DAYS * 86400000).toISOString()
  const venueCut = venueId ? tx`AND po.venue_id = ${venueId}` : tx``
  const rows = await tx`
    WITH got AS (
      SELECT pl.id, po.venue_id, pl.item_id, po.received_at AS at, pl.received_qty::float8 AS packs,
             pl.pack_base_qty::float8 AS pack_base_qty, COALESCE(pl.invoice_price, pl.price)::float8 AS price,
             pl.pack_label, pl.base_unit, s.name AS supplier_name
        FROM purchase_order_lines pl
        JOIN purchase_orders po ON po.id = pl.po_id AND po.tenant_id = pl.tenant_id
        JOIN inv_items i ON i.id = pl.item_id AND i.tenant_id = pl.tenant_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
       WHERE pl.tenant_id = ${tenantId} AND pl.item_id = ANY(${itemIds}::uuid[])
         AND pl.received_qty > 0 AND pl.pack_base_qty > 0 AND pl.base_unit = i.base_unit
         AND po.received_at IS NOT NULL AND po.status <> 'cancelled' ${venueCut}
    ), latest AS (
      SELECT DISTINCT ON (venue_id, item_id) id FROM got ORDER BY venue_id, item_id, at DESC, id
    )
    SELECT * FROM got WHERE at >= ${since}::timestamptz OR id IN (SELECT id FROM latest)
     ORDER BY at DESC`
  for (const r of rows) (out[r.item_id] ||= []).push(r)
  return { receipts: out, since }
}

/**
 * The cost engine's ctx for one venue (null = the group's own prices) on a
 * basis: every recipe (passed in when already loaded), the items their lines
 * use, those items' prices and what was received of them.
 */
export async function loadCosting(tx, tenantId, venueId = null, { basis = 'standard', recipes = null, itemIds: more = [] } = {}) {
  const all = recipes || await loadRecipes(tx, tenantId)
  // The items the recipes' lines use, and any more asked for (the items option rules add or swap in).
  const itemIds = [...new Set([...[...all.values()].flatMap(r => r.lines.map(l => l.item_id).filter(Boolean)), ...more.filter(Boolean)])]
  const [items, quotes, preferred, got] = await Promise.all([
    loadCostItems(tx, tenantId, itemIds),
    loadItemQuotes(tx, tenantId, itemIds),
    loadPreferred(tx, tenantId, itemIds),
    loadReceipts(tx, tenantId, itemIds, venueId),
  ])
  return {
    items, recipes: all, quotes, preferred, receipts: got.receipts, since: got.since,
    venueId: venueId ?? null, basis: BASIS_KEYS.includes(basis) ? basis : 'standard',
  }
}

/**
 * A recipe as the API returns it: its fields and lines (each with what it
 * is: an item's or a prep recipe's name and units), what could not be
 * costed and the coverage; with costs (costing View) its cost, cost per
 * portion or per unit, each line's cost and, asked for, the explanation;
 * with prices (purchasing prices) the explanation names each supplier price.
 */
export function recipeView(recipe, ctx, { costs = false, prices = false, withExplain = false } = {}) {
  const r = recipeCost(recipe, ctx)
  const saved = new Map((recipe.lines || []).map(l => [l.id, l]))
  const lines = r.lines.map(l => {
    const own = saved.get(l.id) || {}
    const item = l.item_id ? ctx.items.get(l.item_id) : null
    const sub = l.sub_recipe_id ? ctx.recipes.get(l.sub_recipe_id) : null
    return {
      id: l.id, sort_order: l.sort_order, item_id: l.item_id ?? null, sub_recipe_id: l.sub_recipe_id ?? null,
      qty: l.qty, unit: l.unit, yield_pct: own.yield_pct ?? null, note: own.note ?? null,
      kind: l.kind, name: l.name, problem: l.problem, partial: l.partial,
      base_qty: l.base_qty, base_unit: l.base_unit, bought_qty: l.bought_qty, used_yield_pct: l.yield_pct,
      item: item ? { id: item.id, name: item.name, base_unit: item.base_unit, yield_pct: item.yield_pct, recipe_unit: item.recipe_unit, is_active: item.is_active, units: item.units } : null,
      sub_recipe: sub ? { id: sub.id, name: sub.name, kind: sub.kind, yield_unit: sub.yield_unit, is_active: sub.is_active } : null,
      ...(costs ? { per_base: l.per_base, cost: l.cost, how: l.source?.how ?? null } : {}),
    }
  })
  const out = {
    ...recipe, lines,
    unit: r.unit, makes: r.makes, coverage: r.coverage, complete: r.complete, gaps: r.gaps,
    costs_shown: !!costs,
  }
  if (costs) {
    out.cost = r.cost
    out.per_unit = r.per_unit
    out.basis = r.basis
    if (withExplain) out.explanation = explain(recipe, ctx, { prices, result: r })
  }
  return out
}
