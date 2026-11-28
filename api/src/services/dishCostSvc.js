// src/services/dishCostSvc.js
//
// What the cost engine needs to cost what is sold (inventory phase 2,
// migration 302; docs/INVENTORY.md 5.4, 5.5): the recipe links, the option
// rules, the option library, the group's venues, revenue streams and order
// types (and their names, for "why this recipe"), the goods' stock items by
// barcode, the cost % targets, and the menus' dishes. Read as the tenant,
// filtered by tenant_id. The rules themselves are shared/costing.js
// (recipeFor(), dishCost(), menuMargins()): nothing here works a cost out.
//
//   loadLinks(tx, tenantId, { dishIds, recipeId })      recipe_links rows
//   loadOptionRules(tx, tenantId, { optionId, dishId })  recipe_option_rules rows
//   loadOptionLibrary(tx, tenantId)   Map option id -> { label, group, variation_type, ... }
//   loadScopes(tx, tenantId)          { venues, streams, types, names }
//   loadCostingSettings(tx, tenantId) the targets (30 and 35 when none are saved)
//   goodsIndex(tx, tenantId)          Map barcode -> inventory item
//   loadDishCosting(tx, tenantId, venueId, { basis, menus, recipes })
//                                     the engine's ctx for dishes: loadCosting()'s
//                                     with all of the above
//   menusFor(tx, tenantId, version)   every menu, live (what tills sell) or draft
//   dishIdsOnMenus(tx, tenantId)      every dish on a menu, draft or live
//   copyRecipeLinks(tx, tenantId, newId, by)   a duplicated menu's links, dish rules
//                                     and section targets, onto the copy's ids
//                                     (public: routes/menus.js /duplicate calls it)
//   sweepRecipeLinks(log)             the nightly job (jobs/recipe-links.js): system
//                                     mode, each tenant on its own

import { systemSql, withSystem } from '../config/db.js'
import { loadRecipes, loadCosting } from './costingSvc.js'
import { loadMenuVersions } from './menuReleases.js'
import { dishMap, DEFAULT_TARGET_PCT, DEFAULT_LIMIT_PCT } from '../../../shared/costing.js'

export const MISSING_DAYS = 30

const LINK_COLS = tx => tx`
  l.id, l.dish_id, l.recipe_id, l.portions::float8 AS portions, l.venue_id, l.revenue_stream_id, l.order_type_id,
  l.missing_since, l.created_by, l.created_at, l.updated_at`

/** The group's recipe links (or a few dishes', or one recipe's). */
export async function loadLinks(tx, tenantId, { dishIds = null, recipeId = null } = {}) {
  return tx`
    SELECT ${LINK_COLS(tx)} FROM recipe_links l
     WHERE l.tenant_id = ${tenantId}
       ${dishIds ? tx`AND l.dish_id = ANY(${dishIds}::uuid[])` : tx``}
       ${recipeId ? tx`AND l.recipe_id = ${recipeId}` : tx``}
     ORDER BY l.created_at, l.id`
}

/** The group's option rules (or one option's, or one dish's). */
export async function loadOptionRules(tx, tenantId, { optionId = null, dishId = null } = {}) {
  return tx`
    SELECT r.id, r.option_id, r.dish_id, r.option_label, r.action, r.item_id, r.sub_recipe_id, r.swap_item_id,
           r.qty::float8 AS qty, r.unit, r.factor::float8 AS factor, r.recipe_id, r.note, r.missing_since,
           r.created_by, r.created_at, r.updated_at
      FROM recipe_option_rules r
     WHERE r.tenant_id = ${tenantId}
       ${optionId ? tx`AND r.option_id = ${optionId}` : tx``}
       ${dishId ? tx`AND r.dish_id = ${dishId}` : tx``}
     ORDER BY r.created_at, r.id`
}

/** Every option of the option group library with its group: Map id -> option. */
export async function loadOptionLibrary(tx, tenantId) {
  const rows = await tx`
    SELECT o.id, o.label, o.price_pence, o.sort_order, g.id AS group_id, g.name AS group_name, g.variation_type,
           g.price_mode, g.sort_order AS group_sort
      FROM menu_variant_options o
      JOIN menu_variant_groups g ON g.id = o.group_id AND g.tenant_id = o.tenant_id
     WHERE o.tenant_id = ${tenantId}
     ORDER BY g.sort_order, lower(g.name), o.sort_order, lower(o.label)`
  return new Map(rows.map(r => [r.id, r]))
}

/** The places and ways of selling a link can name, with their names: { venues, streams, types, names }. */
export async function loadScopes(tx, tenantId) {
  const [venues, streams, types] = await Promise.all([
    tx`SELECT id, name, is_active FROM venues WHERE tenant_id = ${tenantId} ORDER BY created_at, name`,
    tx`SELECT id, name, venue_id, menu_ids, is_active, sort_order FROM pos_revenue_streams
        WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
    tx`SELECT id, name, is_active, sort_order FROM order_types WHERE tenant_id = ${tenantId} ORDER BY sort_order, name`,
  ])
  const byId = list => Object.fromEntries(list.map(x => [x.id, x.name]))
  return { venues, streams, types, names: { venues: byId(venues), streams: byId(streams), types: byId(types) } }
}

/** The group's cost % targets, with a section's own: the defaults when none are saved. */
export async function loadCostingSettings(tx, tenantId) {
  const [row] = await tx`
    SELECT target_pct::float8 AS target_pct, limit_pct::float8 AS limit_pct, sections, updated_by, updated_at
      FROM costing_settings WHERE tenant_id = ${tenantId}`
  return row
    ? { ...row, sections: Array.isArray(row.sections) ? row.sections : [], saved: true }
    : { target_pct: DEFAULT_TARGET_PCT, limit_pct: DEFAULT_LIMIT_PCT, sections: [], updated_by: null, updated_at: null, saved: false }
}

/** Inventory items with a barcode, by barcode (a goods dish with the same barcode is offered a recipe of it). */
export async function goodsIndex(tx, tenantId) {
  const rows = await tx`
    SELECT id, name, base_unit, barcode FROM inv_items
     WHERE tenant_id = ${tenantId} AND barcode IS NOT NULL AND is_active
     ORDER BY created_at`
  const out = new Map()
  for (const r of rows) if (!out.has(r.barcode)) out.set(r.barcode, r)
  return out
}

/**
 * The cost engine's ctx for dishes at a venue (null = the group's own
 * prices) on a basis: loadCosting()'s, with the links, rules, options,
 * names, goods and the dishes of `menus`. The items option rules add or
 * swap in are priced too.
 */
export async function loadDishCosting(tx, tenantId, venueId = null, { basis = 'standard', menus = [], recipes = null } = {}) {
  const [all, links, rules, options, scopes, goods] = await Promise.all([
    recipes || loadRecipes(tx, tenantId),
    loadLinks(tx, tenantId),
    loadOptionRules(tx, tenantId),
    loadOptionLibrary(tx, tenantId),
    loadScopes(tx, tenantId),
    goodsIndex(tx, tenantId),
  ])
  const itemIds = rules.flatMap(r => [r.item_id, r.swap_item_id]).filter(Boolean)
  const base = await loadCosting(tx, tenantId, venueId, { basis, recipes: all, itemIds })
  return { ...base, links, rules, options, names: scopes.names, scopes, goods, dishes: dishMap(menus) }
}

/** Every menu of the group in a version: 'live' (what is sold now) or 'draft' (the menu tables). */
export function menusFor(tx, tenantId, version = 'live') {
  return loadMenuVersions(tx, tenantId, { version: version === 'draft' ? 'draft' : 'live' })
}

/** Every dish id on one of the group's menus: in the menu tables (the draft) or in what is live. */
export async function dishIdsOnMenus(tx, tenantId) {
  const draft = await tx`SELECT id FROM menu_items WHERE tenant_id = ${tenantId}`
  const ids = new Set(draft.map(r => r.id))
  for (const m of await loadMenuVersions(tx, tenantId, { version: 'live' })) {
    for (const s of m.sections || []) for (const i of s.items || []) ids.add(i.id)
  }
  return ids
}

/**
 * A duplicated menu (routes/menus.js POST /:id/duplicate) carries its
 * dishes' recipe links, their own option rules and its sections' cost %
 * targets onto the copy's ids. newId: old id -> new id (sections and dishes).
 * Rows already there for a new id are left as they are.
 */
export async function copyRecipeLinks(tx, tenantId, newId, by = null) {
  const olds = Object.keys(newId || {})
  if (!olds.length) return { links: 0, rules: 0, sections: 0 }
  const links = await tx`
    SELECT dish_id, recipe_id, portions, venue_id, revenue_stream_id, order_type_id FROM recipe_links
     WHERE tenant_id = ${tenantId} AND dish_id = ANY(${olds}::uuid[])`
  let copied = 0
  for (const l of links) {
    const rows = await tx`
      INSERT INTO recipe_links (tenant_id, dish_id, recipe_id, portions, venue_id, revenue_stream_id, order_type_id, created_by)
      VALUES (${tenantId}, ${newId[l.dish_id]}, ${l.recipe_id}, ${l.portions}, ${l.venue_id}, ${l.revenue_stream_id}, ${l.order_type_id}, ${by})
      ON CONFLICT DO NOTHING RETURNING id`
    copied += rows.length
  }
  const rules = await tx`
    SELECT option_id, dish_id, option_label, action, item_id, sub_recipe_id, swap_item_id, qty, unit, factor, recipe_id, note
      FROM recipe_option_rules WHERE tenant_id = ${tenantId} AND dish_id = ANY(${olds}::uuid[])`
  let ruled = 0
  for (const r of rules) {
    const rows = await tx`
      INSERT INTO recipe_option_rules ${tx({ ...r, tenant_id: tenantId, dish_id: newId[r.dish_id], created_by: by })}
      ON CONFLICT DO NOTHING RETURNING id`
    ruled += rows.length
  }
  const [settings] = await tx`SELECT sections FROM costing_settings WHERE tenant_id = ${tenantId}`
  const own = (settings?.sections || []).filter(s => newId[s.section_id])
  const sections = Array.isArray(settings?.sections) ? settings.sections : []
  const fresh = own.filter(s => !sections.some(x => x.section_id === newId[s.section_id])).map(s => ({ ...s, section_id: newId[s.section_id] }))
  if (fresh.length) {
    await tx`UPDATE costing_settings SET sections = ${tx.json([...sections, ...fresh])}, updated_at = now() WHERE tenant_id = ${tenantId}`
  }
  return { links: copied, rules: ruled, sections: fresh.length }
}

/**
 * One tenant's links and dish rules against its menus: a dish on no menu
 * (draft or live) is marked missing (missing_since), one that is back is
 * cleared, and what has been missing for MISSING_DAYS days is deleted; an
 * allergen check (phase 8a) and calorie check (phase 8b) of a dish on no menu is deleted.
 * Runs in a system-mode transaction (tx), filtered by the tenant.
 */
export async function sweepTenantLinks(tx, tenantId) {
  const on = await dishIdsOnMenus(tx, tenantId)
  const out = { marked: 0, back: 0, deleted: 0 }
  for (const table of ['recipe_links', 'recipe_option_rules']) {
    const rows = await tx`SELECT id, dish_id, missing_since FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND dish_id IS NOT NULL`
    const gone = rows.filter(r => !on.has(r.dish_id) && !r.missing_since).map(r => r.id)
    const back = rows.filter(r => on.has(r.dish_id) && r.missing_since).map(r => r.id)
    if (gone.length) out.marked += (await tx`UPDATE ${tx(table)} SET missing_since = now() WHERE tenant_id = ${tenantId} AND id = ANY(${gone}::uuid[]) RETURNING id`).length
    if (back.length) out.back += (await tx`UPDATE ${tx(table)} SET missing_since = NULL WHERE tenant_id = ${tenantId} AND id = ANY(${back}::uuid[]) RETURNING id`).length
    out.deleted += (await tx`
      DELETE FROM ${tx(table)} WHERE tenant_id = ${tenantId} AND missing_since < now() - make_interval(days => ${MISSING_DAYS})
      RETURNING id`).length
  }
  // Allergen checks (inventory phase 8a, migration 316) of dishes on no menu go at once: a check is worked out again on asking.
  out.allergen_checks = (await tx`
    DELETE FROM allergen_checks WHERE tenant_id = ${tenantId} AND NOT (dish_id = ANY(${[...on]}::uuid[])) RETURNING id`).length
  // And their calorie checks (phase 8b, migration 318).
  out.calorie_checks = (await tx`
    DELETE FROM calorie_checks WHERE tenant_id = ${tenantId} AND NOT (dish_id = ANY(${[...on]}::uuid[])) RETURNING id`).length
  return out
}

/** The nightly sweep over every tenant with links or dish rules (jobs/recipe-links.js). */
export async function sweepRecipeLinks(log = null) {
  const tenants = await systemSql`
    SELECT tenant_id FROM recipe_links UNION SELECT tenant_id FROM recipe_option_rules WHERE dish_id IS NOT NULL`
  const total = { tenants: 0, marked: 0, back: 0, deleted: 0 }
  for (const { tenant_id: tenantId } of tenants) {
    try {
      const r = await withSystem(tx => sweepTenantLinks(tx, tenantId))
      total.tenants++
      total.marked += r.marked
      total.back += r.back
      total.deleted += r.deleted
    } catch (err) {
      log?.warn?.({ err: err?.message, tenantId }, 'Recipe link sweep failed for a tenant')
    }
  }
  return total
}
