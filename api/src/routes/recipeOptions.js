// src/routes/recipeOptions.js
//
// What options do to a dish's recipe (inventory phase 2, migration 302;
// docs/INVENTORY.md 5.4, decision D3), mounted at /api/recipe-options. A rule
// is for an option of the option group library, for one dish only (an
// exception), or for a dish's own one-off option (by its label, as sales name
// it). It adds, takes out, swaps, scales, is a recipe of its own, or does
// nothing; an option with no rule follows its group's variation type
// (shared/costing.js ruleFor(), dishCost()).
//
//   GET    /                    the library's options by group, each with its
//                                rule, its exceptions and how many dishes have
//                                its group: covered (a rule), following its
//                                group's default, or a gap (an addition or a
//                                side with no rule)
//   GET    /options/:optionId   one option: its rule, the dishes with its group
//                                and which rule each follows, the exceptions
//   PUT    /rules               the whole rule (every field, rule 13), made or
//                                replaced for its option and dish
//   DELETE /rules/:optionRuleId
//
// Reading needs Recipes view, changing Recipes manage. Every id is the
// group's (rule 4): the option, the dish (on one of its menus), the items,
// the prep recipe it adds, the dish recipe it is.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { loadRecipes, loadCostItems } from '../services/costingSvc.js'
import { loadOptionRules, loadOptionLibrary, menusFor, dishIdsOnMenus } from '../services/dishCostSvc.js'
import {
  ruleFor, ruleText, ruleProblem, dishMap, unitChoices, recipeUnitChoices, OPTION_DEFAULTS, RULE_ACTION_KEYS,
} from '../../../shared/costing.js'

const uuid = z.string().uuid()
const opt = s => s.nullable()
// Every field of a rule: a save replaces the whole rule (rule 13).
export const RuleBody = z.object({
  option_id:     opt(uuid),
  dish_id:       opt(uuid),
  option_label:  opt(z.string().trim().min(1).max(200)),
  action:        z.enum(RULE_ACTION_KEYS),
  item_id:       opt(uuid),
  sub_recipe_id: opt(uuid),
  swap_item_id:  opt(uuid),
  qty:           opt(z.number().positive().max(100000)),
  unit:          opt(z.string().trim().min(1).max(30)),
  factor:        opt(z.number().positive().max(20)),
  recipe_id:     opt(uuid),
  note:          opt(z.string().trim().max(500)),
}).strict()

const canView = requirePermission('recipes', 'view')
const canManage = requirePermission('recipes', 'manage')
const who = req => req.user?.email ?? req.user?.sub ?? null

/** Gap, rule or default: how an option's own rule stands (a dish exception aside). */
function stateOf(option, rule) {
  if (rule) return 'rule'
  const t = option.variation_type
  if (t === 'addition' || t === 'side' || (!t && option.price_mode === 'extra' && Number(option.price_pence) > 0)) return 'gap'
  return 'default'
}

/** The dishes with each library group attached (draft menus): Map group id -> [dish]. */
function dishesByGroup(menus) {
  const out = new Map()
  for (const d of dishMap(menus).values()) {
    for (const g of d.variant_groups || []) (out.get(g.group_id) || out.set(g.group_id, []).get(g.group_id)).push(d)
  }
  return out
}

/** The fields a rule keeps for its action; the others are left empty. */
function ruleValues(b) {
  const keep = {
    add: ['item_id', 'sub_recipe_id', 'qty', 'unit'], remove: ['item_id'], swap: ['item_id', 'swap_item_id', 'qty', 'unit'],
    scale: ['factor'], recipe: ['recipe_id', 'qty'], nothing: [],
  }[b.action]
  const out = { action: b.action, note: b.note || null }
  for (const k of ['item_id', 'sub_recipe_id', 'swap_item_id', 'qty', 'unit', 'factor', 'recipe_id']) out[k] = keep.includes(k) ? (b[k] ?? null) : null
  return out
}

export default async function recipeOptionRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const [options, rules, recipes, menus] = await Promise.all([
      loadOptionLibrary(tx, req.tenantId), loadOptionRules(tx, req.tenantId), loadRecipes(tx, req.tenantId), menusFor(tx, req.tenantId, 'draft'),
    ])
    const items = await loadCostItems(tx, req.tenantId, [...new Set(rules.flatMap(r => [r.item_id, r.swap_item_id]).filter(Boolean))])
    const ctx = { items, recipes }
    const byGroup = dishesByGroup(menus)
    const groups = []
    for (const o of options.values()) {
      let g = groups.find(x => x.id === o.group_id)
      if (!g) groups.push(g = { id: o.group_id, name: o.group_name, variation_type: o.variation_type, price_mode: o.price_mode, dishes: (byGroup.get(o.group_id) || []).length, options: [] })
      const own = rules.find(r => r.option_id === o.id && !r.dish_id) || null
      g.options.push({
        id: o.id, label: o.label, price_pence: o.price_pence,
        rule: own ? { ...own, text: ruleText(own, ctx) } : null,
        exceptions: rules.filter(r => r.option_id === o.id && r.dish_id).length,
        state: stateOf(o, own), default_text: own ? null : OPTION_DEFAULTS[o.variation_type || 'none'],
      })
    }
    const all = groups.flatMap(g => g.options)
    return {
      groups, counts: { options: all.length, rule: all.filter(o => o.state === 'rule').length, gap: all.filter(o => o.state === 'gap').length, default: all.filter(o => o.state === 'default').length },
    }
  }))

  app.get('/options/:optionId', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const id = uuid.safeParse(req.params.optionId).success ? req.params.optionId : null
    const options = await loadOptionLibrary(tx, req.tenantId)
    const o = id ? options.get(id) : null
    if (!o) throw httpError(404, 'Option not found')
    const [rules, recipes, menus] = await Promise.all([loadOptionRules(tx, req.tenantId, { optionId: o.id }), loadRecipes(tx, req.tenantId), menusFor(tx, req.tenantId, 'draft')])
    const items = await loadCostItems(tx, req.tenantId, [...new Set(rules.flatMap(r => [r.item_id, r.swap_item_id]).filter(Boolean))])
    const ctx = { items, recipes }
    const dishes = dishMap(menus)
    const own = rules.find(r => !r.dish_id) || null
    const textOf = r => (r ? { ...r, text: ruleText(r, ctx), item_name: items.get(r.item_id)?.name ?? null, swap_item_name: items.get(r.swap_item_id)?.name ?? null, recipe_name: recipes.get(r.recipe_id || r.sub_recipe_id)?.name ?? null } : null)
    return {
      option: { id: o.id, label: o.label, price_pence: o.price_pence, group_id: o.group_id, group: o.group_name, variation_type: o.variation_type, price_mode: o.price_mode },
      rule: textOf(own), state: stateOf(o, own), default_text: OPTION_DEFAULTS[o.variation_type || 'none'],
      exceptions: rules.filter(r => r.dish_id).map(r => ({ ...textOf(r), dish_name: dishes.get(r.dish_id)?.name ?? null, menu: dishes.get(r.dish_id)?.menu ?? null, on_menu: dishes.has(r.dish_id) })),
      dishes: (dishesByGroup(menus).get(o.group_id) || []).map(d => {
        const hit = ruleFor(d.id, { id: o.id }, rules)
        return { id: d.id, name: d.name, menu: d.menu, section: d.section, rule_from: hit?.from ?? null }
      }),
    }
  }))

  app.put('/rules', { preHandler: canManage }, async req => {
    const b = RuleBody.parse(req.body || {})
    const problem = ruleProblem(b)
    if (problem) throw httpError(422, problem, { code: 'rule' })
    return withTenant(req.tenantId, async tx => {
      if (b.option_id) {
        const [o] = await tx`SELECT id FROM menu_variant_options WHERE id = ${b.option_id} AND tenant_id = ${req.tenantId}`
        if (!o) throw httpError(404, 'Option not found')
      }
      if (b.dish_id && !(await dishIdsOnMenus(tx, req.tenantId)).has(b.dish_id)) throw httpError(404, 'Dish not found')
      const v = ruleValues(b)
      const itemIds = [...new Set([v.item_id, v.swap_item_id].filter(Boolean))]
      const items = await loadCostItems(tx, req.tenantId, itemIds)
      if (items.size !== itemIds.length) throw httpError(404, 'Inventory item not found')
      for (const [field, kind] of [['sub_recipe_id', 'prep'], ['recipe_id', 'dish']]) {
        if (!v[field]) continue
        const [r] = await tx`SELECT id, name, kind FROM recipes WHERE id = ${v[field]} AND tenant_id = ${req.tenantId}`
        if (!r) throw httpError(404, 'Recipe not found')
        if (r.kind !== kind) {
          throw httpError(422, kind === 'prep' ? r.name + ' is a dish recipe: an option adds a prep recipe or an item, or is a dish recipe of its own'
            : r.name + ' is a prep recipe: add it to the dish instead (Adds)', { code: 'recipe_kind' })
        }
      }
      // A unit the item knows (its standard units, or its own), spelled as the item spells it.
      if (v.unit && (v.item_id || v.swap_item_id)) {
        const item = items.get(b.action === 'swap' ? v.swap_item_id : v.item_id)
        v.unit = unitChoices(item).find(u => u.toLowerCase() === v.unit.toLowerCase()) || v.unit
      } else if (v.unit && v.sub_recipe_id) {
        const [sub] = await tx`SELECT kind, yield_unit FROM recipes WHERE id = ${v.sub_recipe_id} AND tenant_id = ${req.tenantId}`
        v.unit = recipeUnitChoices(sub).find(u => u.toLowerCase() === v.unit.toLowerCase()) || v.unit.toLowerCase()
      }
      const key = { option_id: b.option_id || null, dish_id: b.dish_id || null, option_label: b.option_id ? null : b.option_label }
      const [found] = b.option_id
        ? await tx`SELECT id FROM recipe_option_rules WHERE tenant_id = ${req.tenantId} AND option_id = ${b.option_id} AND dish_id IS NOT DISTINCT FROM ${key.dish_id}::uuid`
        : await tx`SELECT id FROM recipe_option_rules WHERE tenant_id = ${req.tenantId} AND option_id IS NULL AND dish_id = ${b.dish_id} AND lower(option_label) = lower(${b.option_label})`
      const [rule] = found
        ? await tx`UPDATE recipe_option_rules SET ${tx({ ...v, option_label: key.option_label })}, missing_since = NULL, updated_at = now()
                    WHERE id = ${found.id} AND tenant_id = ${req.tenantId} RETURNING *`
        : await tx`INSERT INTO recipe_option_rules ${tx({ ...v, ...key, tenant_id: req.tenantId, created_by: who(req) })} RETURNING *`
      const recipes = await loadRecipes(tx, req.tenantId, [v.recipe_id, v.sub_recipe_id].filter(Boolean))
      return { rule: { ...rule, qty: rule.qty == null ? null : Number(rule.qty), factor: rule.factor == null ? null : Number(rule.factor), text: ruleText({ ...v }, { items, recipes }) }, made: !found }
    })
  })

  app.delete('/rules/:optionRuleId', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const id = uuid.safeParse(req.params.optionRuleId).success ? req.params.optionRuleId : null
    const [gone] = id ? await tx`DELETE FROM recipe_option_rules WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING id` : []
    if (!gone) throw httpError(404, 'Rule not found')
    return { deleted: true }
  }))
}
