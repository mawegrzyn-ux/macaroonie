// src/routes/recipeLinks.js
//
// Menu dishes linked to recipes (inventory phase 2, migration 302;
// docs/INVENTORY.md 5.4), mounted at /api/recipe-links. A dish links to a
// recipe by default, and any venue, revenue stream or order type, or a mix of
// them, can use another recipe or a variation, or another number of portions:
// the variation matrix. Which link applies is recipeFor() in
// shared/costing.js, scored as taxFor() scores a tax rule.
//
//   GET    /dishes            ?menu_id   every dish on the group's menus (the
//                             draft) with its default recipe, how many cells
//                             use another, its coverage, a recipe it matches by
//                             product code then name (unlinked dishes), the
//                             stock item a goods dish's barcode is; and links
//                             whose dish is on no menu
//   GET    /dishes/:dishId    the matrix: rows every venue, each venue and its
//                             revenue streams; columns any order type, then
//                             each; each cell the recipe in effect, set there or
//                             inherited (and from which cell), its cost per
//                             portion at that venue and its margin (Costing
//                             view); the dish's options with their rules
//   PUT    /dishes/:dishId/cell   { venue_id, revenue_stream_id, order_type_id,
//                             recipe_id, portions }   one cell set (a link made
//                             or changed)
//   DELETE /links/:recipeLinkId   one cell cleared
//   POST   /bulk              { links: [{ dish_id, recipe_id, portions }] }
//                             default links for many dishes at once (Link 14
//                             dishes to their recipes); a dish with one already
//                             keeps it
//   POST   /goods             { dishes: [{ dish_id, item_id }] } a one-line
//                             recipe of the stock item for each goods dish,
//                             linked by default
//   GET    /recipes/:recipeId the dishes a recipe is linked to, with where
//   GET    /dishes/:dishId/cost   ?venue_id &revenue_stream_id &order_type_id
//                             &version (live | draft) &options (JSON)   what the
//                             dish costs there and why: the recipe and the
//                             reason, the steps, the recipe's own explanation,
//                             the price and VAT steps (Recipes or Costing view;
//                             money only with Costing view)
//
// Reading needs Recipes view, changing Recipes manage; costs and margins need
// Costing view, supplier prices in an explanation purchasing prices too
// (access() in routes/recipes.js). Every id is checked to be the group's
// (rule 4): the dish (on one of its menus), the recipe (a dish recipe), the
// venue, the revenue stream (and the venue is the stream's), the order type
// and the stock item. Dish ids are plain: the menu save re-inserts dishes
// under the same ids.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { access, lockRecipes } from './recipes.js'
import { loadRecipes, loadCostItems, loadCosting } from '../services/costingSvc.js'
import {
  loadLinks, loadDishCosting, loadScopes, loadCostingSettings, menusFor, dishIdsOnMenus, goodsIndex,
} from '../services/dishCostSvc.js'
import { loadTaxRates } from '../services/taxSvc.js'
import {
  recipeFor, recipeCost, dishCost, dishMargin, marginSteps, explain, scopeText, sameScope, ruleFor, ruleText,
  OPTION_DEFAULTS, dishMap,
} from '../../../shared/costing.js'
import { matchIndex, matchThing } from '../../../shared/itemMatch.js'
import { isCombo, menuCtx } from '../../../shared/combos.js'
import { itemChoices, variantRules } from '../../../shared/orderPricing.js'

const uuid = z.string().uuid()
const Portions = z.number().positive().max(1000)
const CellBody = z.object({
  venue_id:          uuid.nullable().optional(),
  revenue_stream_id: uuid.nullable().optional(),
  order_type_id:     uuid.nullable().optional(),
  recipe_id:         uuid,
  portions:          Portions.optional(),
})
const BulkBody = z.object({
  links: z.array(z.object({ dish_id: uuid, recipe_id: uuid, portions: Portions.optional() })).min(1).max(500),
})
const GoodsBody = z.object({
  dishes: z.array(z.object({ dish_id: uuid, item_id: uuid })).min(1).max(500),
})
const CostQuery = z.object({
  venue_id: uuid.optional(), revenue_stream_id: uuid.optional(), order_type_id: uuid.optional(),
  version: z.enum(['live', 'draft']).optional(),
  options: z.string().max(4000).optional(),
})
const OptionPick = z.array(z.object({
  option_id: z.string().min(1).max(250), prefix: z.enum(['no', 'light', 'extra', 'side']).nullable().optional(),
  qty: z.number().int().min(1).max(20).optional(),
})).max(30)

const canView = requirePermission('recipes', 'view')
const canManage = requirePermission('recipes', 'manage')
const canSeeCost = requireAnyPermission(['recipes', 'costing'], 'view')
const who = req => req.user?.email ?? req.user?.sub ?? null

/** A cell's key: its row (every venue, a venue, a stream) and column (any order type, a type). */
export const rowKey = s => (s.revenue_stream_id ? 's:' + s.revenue_stream_id : s.venue_id ? 'v:' + s.venue_id : 'all')
export const colKey = s => (s.order_type_id ? 't:' + s.order_type_id : 'any')
const cellKey = s => rowKey(s) + '|' + colKey(s)

/** The dish's menu, section and row in the menus (null when it is on none of them). */
function findDish(menus, dishId) {
  for (const m of menus) {
    for (const s of m.sections || []) {
      const item = (s.items || []).find(i => i.id === dishId)
      if (item) return { menu: m, section: s, item }
    }
  }
  return null
}

/** What kind of thing a dish is for costing: a meal deal, goods, a service or a dish. */
const kindOf = (item, type) => (isCombo(item) ? 'deal' : type === 'goods' ? 'goods' : type === 'service' ? 'service' : 'dish')

/** Checks a cell's scope is the group's; a stream fixes its venue. Returns the scope as stored. */
async function checkScope(tx, tenantId, b) {
  let venueId = b.venue_id || null
  if (b.revenue_stream_id) {
    const [s] = await tx`SELECT id, venue_id, name FROM pos_revenue_streams WHERE id = ${b.revenue_stream_id} AND tenant_id = ${tenantId}`
    if (!s) throw httpError(404, 'Revenue stream not found')
    if (venueId && venueId !== s.venue_id) throw httpError(422, s.name + ' is another venue\'s revenue stream', { code: 'stream_venue' })
    venueId = s.venue_id
  }
  if (venueId) {
    const [v] = await tx`SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
    if (!v) throw httpError(404, 'Venue not found')
  }
  if (b.order_type_id) {
    const [t] = await tx`SELECT id FROM order_types WHERE id = ${b.order_type_id} AND tenant_id = ${tenantId}`
    if (!t) throw httpError(404, 'Order type not found')
  }
  return { venue_id: venueId, revenue_stream_id: b.revenue_stream_id || null, order_type_id: b.order_type_id || null }
}

/** A recipe a dish can link to: one of the group's dish recipes. */
async function dishRecipe(tx, tenantId, id) {
  const [r] = await tx`SELECT id, name, kind FROM recipes WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Recipe not found')
  if (r.kind !== 'dish') throw httpError(422, r.name + ' is a prep recipe: a dish links to a dish recipe (a prep recipe goes inside one)', { code: 'not_dish' })
  return r
}

/** The dishes of these ids on the group's menus (draft or live), or a 404 naming none. */
async function ownDishes(tx, tenantId, ids) {
  const on = await dishIdsOnMenus(tx, tenantId)
  if (ids.some(id => !on.has(id))) throw httpError(404, 'Dish not found')
  return on
}

/** The dish with its menu, section, kind and options, from the draft (else what is live). */
async function loadDish(tx, tenantId, dishId, version = 'draft') {
  const first = await menusFor(tx, tenantId, version)
  let menus = first
  let found = findDish(first, dishId)
  if (!found) {
    menus = await menusFor(tx, tenantId, version === 'draft' ? 'live' : 'draft')
    found = findDish(menus, dishId)
  }
  if (!found) throw httpError(404, 'Dish not found')
  return { ...found, menus }
}

/** A dish's options (the library's on its groups, and its own) with the rule each follows. */
function dishOptions(item, ctx) {
  const out = []
  for (const c of itemChoices(item, {})) {
    for (const o of c.options) {
      const own = c.key === 'variants'
      const lib = own ? null : ctx.options.get(o.id)
      const hit = ruleFor(item.id, { id: o.id }, ctx.rules)
      out.push({
        option_id: own ? null : o.id, label: o.label, own, group: own ? 'Its own options' : c.name, group_id: own ? null : c.key,
        variation_type: lib?.variation_type ?? null, price_pence: o.price_pence ?? null, mode: c.mode,
        rule: hit ? { ...hit.rule, text: ruleText(hit.rule, ctx) } : null, rule_from: hit?.from ?? null,
        default_text: hit ? null : OPTION_DEFAULTS[(lib?.variation_type) || (own ? 'modification' : 'none')],
      })
    }
  }
  return out
}

/** Was this menu sold at the venue, and on this stream? (A menu for one venue; a stream naming its menus.) */
function soldAt(menu, scope, streams) {
  if (scope.venue_id && menu.venue_id && menu.venue_id !== scope.venue_id) return false
  if (scope.revenue_stream_id) {
    const s = streams.find(x => x.id === scope.revenue_stream_id)
    if (s && (s.menu_ids || []).length && !s.menu_ids.includes(menu.id)) return false
  }
  return true
}

export default async function recipeLinkRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── The Dishes tab ──────────────────────────────────────────
  app.get('/dishes', { preHandler: canView }, async req => {
    const q = z.object({ menu_id: uuid.optional() }).parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const menus = await menusFor(tx, req.tenantId, 'draft')
      const [recipes, links, goods, live] = await Promise.all([
        loadRecipes(tx, req.tenantId), loadLinks(tx, req.tenantId), goodsIndex(tx, req.tenantId), menusFor(tx, req.tenantId, 'live'),
      ])
      // Coverage at the group's own prices: whether each recipe can be costed carries no money (Recipes view).
      const ctx = await loadCosting(tx, req.tenantId, null, { recipes })
      const onMenus = new Set([...dishMap(menus).keys(), ...dishMap(live).keys()])
      const byDish = new Map()
      for (const l of links) (byDish.get(l.dish_id) || byDish.set(l.dish_id, []).get(l.dish_id)).push(l)
      const dishRecipes = [...recipes.values()].filter(r => r.kind === 'dish' && r.is_active)
      const idx = matchIndex({ dishes: dishRecipes.map(r => ({ id: r.id, name: r.name, sku: r.code, kind: 'item' })) })
      const rows = []
      for (const m of menus) {
        if (q.menu_id && m.id !== q.menu_id) continue
        for (const s of m.sections || []) {
          for (const i of s.items || []) {
            const kind = kindOf(i, i.item_type)
            const mine = byDish.get(i.id) || []
            const def = mine.find(l => !l.venue_id && !l.revenue_stream_id && !l.order_type_id) || null
            const defRecipe = def ? recipes.get(def.recipe_id) : null
            // The default recipe's coverage (full, partial, none); a dish linked only in some cells is 'some'.
            const coverage = kind === 'service' ? 'not_needed' : kind === 'deal' ? 'deal' : !mine.length ? 'unlinked'
              : defRecipe ? recipeCost(defRecipe, ctx).coverage : 'some'
            const row = {
              id: i.id, name: i.name, menu_id: m.id, menu: m.name, section_id: s.id, section: s.title, kind, item_type: i.item_type,
              sku: i.sku || null, barcode: i.barcode || null, price_pence: i.price_pence ?? null,
              default: def ? { link_id: def.id, recipe_id: def.recipe_id, recipe_name: defRecipe?.name ?? null, portions: def.portions } : null,
              links: mine.length, overrides: mine.length - (def ? 1 : 0), coverage, suggestion: null, goods_item: null,
            }
            if (!mine.length && kind === 'goods' && i.barcode && goods.get(i.barcode)) {
              const g = goods.get(i.barcode)
              row.goods_item = { id: g.id, name: g.name }
            } else if (!mine.length && (kind === 'dish' || kind === 'goods')) {
              const hit = matchThing({ kind: 'item', name: i.name, sku: i.sku || null, barcode: null }, idx).candidates[0]
              if (hit && hit.score >= 0.75) row.suggestion = { recipe_id: hit.target.item_id, recipe_name: hit.label, score: hit.score, by: hit.by, reason: hit.reason, sure: hit.score >= 0.9 }
            }
            rows.push(row)
          }
        }
      }
      // Links whose dish is on no menu now (the nightly sweep marks them, and deletes them after 30 days).
      const gone = links.filter(l => !onMenus.has(l.dish_id)).map(l => ({
        link_id: l.id, dish_id: l.dish_id, recipe_id: l.recipe_id, recipe_name: recipes.get(l.recipe_id)?.name ?? null,
        missing_since: l.missing_since,
      }))
      const a = await access(req)
      return {
        dishes: rows, missing: gone, menus: menus.map(m => ({ id: m.id, name: m.name })),
        counts: {
          dishes: rows.length, linked: rows.filter(r => r.links).length,
          unlinked: rows.filter(r => r.coverage === 'unlinked').length,
          suggested: rows.filter(r => r.suggestion).length, goods: rows.filter(r => r.goods_item).length,
        },
        can: { manage: a.manage, costs: a.costs },
      }
    })
  })

  // ── The matrix ──────────────────────────────────────────────
  app.get('/dishes/:dishId', { preHandler: canView }, async req => {
    const a = await access(req)
    return withTenant(req.tenantId, async tx => {
      const dishId = uuid.safeParse(req.params.dishId).success ? req.params.dishId : null
      if (!dishId) throw httpError(404, 'Dish not found')
      const { menu, section, item } = await loadDish(tx, req.tenantId, dishId, 'draft')
      const [ctx, rates, settings] = await Promise.all([
        loadDishCosting(tx, req.tenantId, null, { menus: [menu] }), loadTaxRates(tx, req.tenantId), loadCostingSettings(tx, req.tenantId),
      ])
      const { venues, streams, types } = ctx.scopes
      const dish = ctx.dishes.get(item.id)
      const kind = kindOf(item, dish.item_type)
      const mine = ctx.links.filter(l => l.dish_id === item.id)
      const rows = [{ key: 'all', kind: 'every', venue_id: null, revenue_stream_id: null, name: 'Every venue' }]
      for (const v of venues.filter(x => x.is_active || mine.some(l => l.venue_id === x.id))) {
        rows.push({ key: 'v:' + v.id, kind: 'venue', venue_id: v.id, revenue_stream_id: null, name: v.name })
        for (const s of streams.filter(x => x.venue_id === v.id && (x.is_active || mine.some(l => l.revenue_stream_id === x.id)))) {
          rows.push({ key: 's:' + s.id, kind: 'stream', venue_id: v.id, revenue_stream_id: s.id, name: s.name, venue_name: v.name })
        }
      }
      const cols = [{ key: 'any', order_type_id: null, name: 'Any order type' },
        ...types.filter(t => t.is_active || mine.some(l => l.order_type_id === t.id)).map(t => ({ key: 't:' + t.id, order_type_id: t.id, name: t.name }))]
      const names = Object.fromEntries([...rows.map(r => [r.key, r.name]), ...cols.map(c => [c.key, c.name])])
      const cells = {}
      const memo = new Map()
      for (const r of rows) {
        const here = { ...ctx, venueId: r.venue_id, _memo: memo }
        for (const c of cols) {
          const scope = { venue_id: r.venue_id, revenue_stream_id: r.revenue_stream_id, order_type_id: c.order_type_id }
          const set = mine.find(l => sameScope(l, scope)) || null
          const pick = recipeFor(item.id, scope, mine, { names: ctx.names })
          const recipe = pick ? ctx.recipes.get(pick.link.recipe_id) : null
          const from = pick ? cellKey(pick.link) : null
          const cell = {
            key: r.key + '|' + c.key, scope,
            set: set ? { link_id: set.id, recipe_id: set.recipe_id, portions: set.portions } : null,
            recipe: recipe ? { id: recipe.id, name: recipe.name, variant_of: recipe.variant_of, status: recipe.status } : null,
            portions: pick?.link.portions ?? null, why: pick?.why ?? null,
            inherited: !!pick && !set, from, from_name: from ? (names[from.split('|')[0]] || 'another venue') + ', ' + (names[from.split('|')[1]] || 'another order type').toLowerCase() : null,
            sold: soldAt(menu, scope, streams),
          }
          if (kind === 'dish' || kind === 'goods') {
            const m = dishMargin(item, section, menu, scope, here, { rates, settings, withOptions: false })
            cell.coverage = m.coverage
            cell.gaps = m.gaps.length
            if (a.costs) {
              cell.cost = m.cost
              if (cell.sold && m.price_pence != null) cell.margin = { net_pence: m.net_pence, gp_pence: m.gp_pence, cost_pct: m.cost_pct, band: m.band }
            }
          }
          cells[cell.key] = cell
        }
      }
      // A deal has no recipe: its range at the group's prices.
      const deal = kind === 'deal' ? dishCost(item.id, {}, { venue_id: null }, { ...ctx, combo: menuCtx(menu) }) : null
      return {
        dish: {
          id: item.id, name: item.name, menu_id: menu.id, menu: menu.name, menu_venue_id: menu.venue_id ?? null,
          section_id: section.id, section: section.title, kind, item_type: dish.item_type, sku: item.sku || null, barcode: item.barcode || null,
          price_pence: item.price_pence ?? null,
        },
        rows, cols, cells,
        links: mine.map(l => ({ ...l, where: scopeText(l, ctx.names), recipe_name: ctx.recipes.get(l.recipe_id)?.name ?? null, cell: cellKey(l) })),
        options: kind === 'deal' || kind === 'service' ? [] : dishOptions(item, ctx),
        deal: deal ? { min: a.costs ? deal.min : undefined, max: a.costs ? deal.max : undefined, coverage: deal.coverage, gaps: deal.gaps.length, parts: deal.parts.map(p => ({ step: p.step, choices: p.choices, costed: p.costed })) } : null,
        can: { manage: a.manage, costs: a.costs },
      }
    })
  })

  app.put('/dishes/:dishId/cell', { preHandler: canManage }, async req => {
    const b = CellBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const dishId = uuid.safeParse(req.params.dishId).success ? req.params.dishId : null
      if (!dishId) throw httpError(404, 'Dish not found')
      await ownDishes(tx, req.tenantId, [dishId])
      const scope = await checkScope(tx, req.tenantId, b)
      const recipe = await dishRecipe(tx, req.tenantId, b.recipe_id)
      const [found] = await tx`
        SELECT id FROM recipe_links
         WHERE tenant_id = ${req.tenantId} AND dish_id = ${dishId}
           AND venue_id IS NOT DISTINCT FROM ${scope.venue_id}::uuid
           AND revenue_stream_id IS NOT DISTINCT FROM ${scope.revenue_stream_id}::uuid
           AND order_type_id IS NOT DISTINCT FROM ${scope.order_type_id}::uuid`
      const portions = b.portions ?? 1
      const [link] = found
        ? await tx`
            UPDATE recipe_links SET recipe_id = ${recipe.id}, portions = ${portions}, missing_since = NULL, updated_at = now()
             WHERE id = ${found.id} AND tenant_id = ${req.tenantId}
            RETURNING id, dish_id, recipe_id, portions::float8 AS portions, venue_id, revenue_stream_id, order_type_id`
        : await tx`
            INSERT INTO recipe_links ${tx({ tenant_id: req.tenantId, dish_id: dishId, recipe_id: recipe.id, portions, ...scope, created_by: who(req) })}
            RETURNING id, dish_id, recipe_id, portions::float8 AS portions, venue_id, revenue_stream_id, order_type_id`
      return { link: { ...link, recipe_name: recipe.name }, made: !found }
    })
  })

  app.delete('/links/:recipeLinkId', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const id = uuid.safeParse(req.params.recipeLinkId).success ? req.params.recipeLinkId : null
    const [gone] = id ? await tx`DELETE FROM recipe_links WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id` : []
    if (!gone) throw httpError(404, 'Link not found')
    return { deleted: true }
  }))

  // ── Linking many at once ────────────────────────────────────
  app.post('/bulk', { preHandler: canManage }, async req => {
    const b = BulkBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      await ownDishes(tx, req.tenantId, b.links.map(l => l.dish_id))
      const recipeIds = [...new Set(b.links.map(l => l.recipe_id))]
      const found = await tx`SELECT id, name, kind FROM recipes WHERE tenant_id = ${req.tenantId} AND id = ANY(${recipeIds}::uuid[])`
      if (found.length !== recipeIds.length) throw httpError(404, 'Recipe not found')
      const prep = found.find(r => r.kind !== 'dish')
      if (prep) throw httpError(422, prep.name + ' is a prep recipe: a dish links to a dish recipe', { code: 'not_dish' })
      let linked = 0
      for (const l of b.links) {
        const rows = await tx`
          INSERT INTO recipe_links (tenant_id, dish_id, recipe_id, portions, created_by)
          VALUES (${req.tenantId}, ${l.dish_id}, ${l.recipe_id}, ${l.portions ?? 1}, ${who(req)})
          ON CONFLICT DO NOTHING RETURNING id`
        linked += rows.length
      }
      return { linked, kept: b.links.length - linked }
    })
  })

  app.post('/goods', { preHandler: canManage }, async req => {
    const b = GoodsBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      await ownDishes(tx, req.tenantId, b.dishes.map(d => d.dish_id))
      const itemIds = [...new Set(b.dishes.map(d => d.item_id))]
      const items = await loadCostItems(tx, req.tenantId, itemIds)
      if (items.size !== itemIds.length) throw httpError(404, 'Inventory item not found')
      const menus = await menusFor(tx, req.tenantId, 'draft')
      const dishes = dishMap([...menus, ...(await menusFor(tx, req.tenantId, 'live'))])
      await lockRecipes(tx, req.tenantId)
      let made = 0
      for (const d of b.dishes) {
        const dish = dishes.get(d.dish_id)
        const item = items.get(d.item_id)
        const [has] = await tx`
          SELECT 1 FROM recipe_links WHERE tenant_id = ${req.tenantId} AND dish_id = ${d.dish_id}
             AND venue_id IS NULL AND revenue_stream_id IS NULL AND order_type_id IS NULL`
        if (has) continue
        // One of the stock item a portion: each, as goods are sold (an item kept in grams needs a size for each).
        const [r] = await tx`
          INSERT INTO recipes ${tx({
            tenant_id: req.tenantId, name: (dish?.name || item.name).slice(0, 200), kind: 'dish', portions: 1, status: 'live',
            code: dish?.sku || null, notes: 'Made for the goods dish ' + (dish?.name || '') + ' from its stock item.', created_by: who(req),
          })} RETURNING id`
        await tx`INSERT INTO recipe_lines ${tx({ tenant_id: req.tenantId, recipe_id: r.id, sort_order: 0, item_id: item.id, qty: 1, unit: 'each' })}`
        await tx`INSERT INTO recipe_links ${tx({ tenant_id: req.tenantId, dish_id: d.dish_id, recipe_id: r.id, portions: 1, created_by: who(req) })}`
        made++
      }
      return { made, kept: b.dishes.length - made }
    })
  })

  // ── A recipe's dishes (the editor's Used on menus) ──────────
  app.get('/recipes/:recipeId', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const id = uuid.safeParse(req.params.recipeId).success ? req.params.recipeId : null
    const [r] = id ? await tx`SELECT id FROM recipes WHERE id = ${id} AND tenant_id = ${req.tenantId}` : []
    if (!r) throw httpError(404, 'Recipe not found')
    const [links, scopes, draft, live] = await Promise.all([
      loadLinks(tx, req.tenantId, { recipeId: r.id }), loadScopes(tx, req.tenantId),
      menusFor(tx, req.tenantId, 'draft'), menusFor(tx, req.tenantId, 'live'),
    ])
    const dishes = dishMap([...live, ...draft])
    return {
      links: links.map(l => {
        const d = dishes.get(l.dish_id)
        return {
          link_id: l.id, dish_id: l.dish_id, dish_name: d?.name ?? null, menu: d?.menu ?? null, section: d?.section ?? null,
          where: scopeText(l, scopes.names), portions: l.portions, on_menu: !!d, missing_since: l.missing_since,
          default: !l.venue_id && !l.revenue_stream_id && !l.order_type_id,
        }
      }).sort((x, y) => String(x.dish_name).localeCompare(String(y.dish_name)) || (y.default - x.default)),
    }
  }))

  // ── What a dish costs, step by step ─────────────────────────
  app.get('/dishes/:dishId/cost', { preHandler: canSeeCost }, async req => {
    const q = CostQuery.parse(req.query || {})
    let picks = []
    if (q.options) {
      try { picks = OptionPick.parse(JSON.parse(q.options)) } catch { throw httpError(400, 'options must be a list of { option_id, prefix }') }
    }
    const a = await access(req)
    return withTenant(req.tenantId, async tx => {
      const dishId = uuid.safeParse(req.params.dishId).success ? req.params.dishId : null
      if (!dishId) throw httpError(404, 'Dish not found')
      const scope = await checkScope(tx, req.tenantId, q)
      const { menu, section, item } = await loadDish(tx, req.tenantId, dishId, q.version || 'live')
      const [ctx, rates, settings] = await Promise.all([
        loadDishCosting(tx, req.tenantId, scope.venue_id, { menus: [menu] }), loadTaxRates(tx, req.tenantId), loadCostingSettings(tx, req.tenantId),
      ])
      const here = { ...ctx, combo: menuCtx(menu) }
      const row = dishMargin(item, section, menu, scope, here, { rates, settings, rules: variantRules(menu) })
      const dc = dishCost(item.id, { options: picks }, scope, here)
      const recipe = dc.recipe ? ctx.recipes.get(dc.recipe.id) : null
      const out = {
        dish: { id: item.id, name: item.name, menu_id: menu.id, menu: menu.name, section: section.title, kind: dc.kind, version: menu.version },
        where: scopeText(scope, ctx.names), recipe: dc.recipe, why: dc.why, portions: dc.portions, coverage: dc.coverage,
        gaps: dc.gaps, goods_item: dc.goods_item, options: dc.steps.filter(s => s.kind === 'option').map(s => ({ label: s.label, text: s.text, rule: s.rule })),
        costs_shown: a.costs,
      }
      if (a.costs) {
        Object.assign(out, {
          cost: dc.cost, min: dc.min, max: dc.max, typical: dc.typical, steps: dc.steps, lines: dc.lines,
          recipe_explanation: recipe ? explain(recipe, here, { prices: a.prices }) : null,
          margin: {
            price_pence: row.price_pence, price_varies: row.price_varies, vat_rate: row.vat_rate, net_pence: row.net_pence,
            cost_pence: picks.length ? null : row.cost_pence, gp_pence: picks.length ? null : row.gp_pence,
            cost_pct: picks.length ? null : row.cost_pct, band: picks.length ? null : row.band, thresholds: row.thresholds,
            cost_min: row.cost_min ?? null, cost_max: row.cost_max ?? null, cost_pct_min: row.cost_pct_min ?? null, cost_pct_max: row.cost_pct_max ?? null,
            steps: marginSteps(row), options: row.options,
          },
        })
      } else {
        out.steps = dc.steps.map(s => ({ ...s, amount: undefined, text: s.kind === 'recipe' ? 'for ' + dc.why : s.text }))
      }
      return out
    })
  })
}
