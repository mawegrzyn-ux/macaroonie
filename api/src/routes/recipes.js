// src/routes/recipes.js
//
// Recipes and prep recipes (inventory phase 1, migration 300; docs/INVENTORY.md
// 5.3), mounted at /api/recipes. What a recipe costs is worked out on every
// read by shared/costing.js from the rows loadCosting() reads
// (services/costingSvc.js); nothing stores a cost.
//
//   GET    /                 ?venue_id &basis &kind &q &active   the list, each
//                            with its coverage (fully, partly, not costed) and,
//                            for costing View, its cost at the venue (null venue
//                            = the group's own prices)
//   GET    /pickers          inventory items (names and units, no prices), prep
//                            recipes (the editor's line pickers) and dish recipes
//                            (linking dishes and options, phase 2)
//   GET    /:recipeId        ?venue_id &basis   one recipe: its lines, gaps,
//                            where it is used, its variations; for costing View
//                            its cost on each basis and the step by step
//                            explanation (supplier prices named only for people
//                            who see purchasing prices)
//   POST   /preview          ?venue_id &basis  { ...recipe, id? } what a recipe
//                            being edited would cost, before it is saved (the
//                            editor's live cost): nothing is written; a recipe
//                            inside itself comes back as `nesting`, not refused
//   POST   /                 a new recipe with its lines
//   PUT    /:recipeId        the whole recipe: every field and its lines (all
//                            replaced), as the page holds it (rule 13)
//   POST   /:recipeId/copy   { name?, variant? } a copy with its lines, a draft;
//                            variant: a variation of the original's group
//   PATCH  /:recipeId/active { is_active } switch off or on
//   DELETE /:recipeId        refused (409 in_use) while another recipe uses it
//
// Reading needs Recipes View, changing Recipes Manage; costs need Costing View
// (a cost tells what suppliers charge). Every id in a body is checked to be
// this group's (rule 4): items, prep recipes, the recipe a variation varies.
// A recipe inside itself, or nested deeper than five levels, is refused (422
// recipe_cycle / recipe_depth, nestingProblem() in shared/costing.js).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { permissionAtLeast } from '../config/modules.js'
import { requireAuth, requirePermission, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { loadVenue } from '../services/purchasingSvc.js'
import { loadRecipes, loadCosting, loadCostItems, recipeView } from '../services/costingSvc.js'
import { recipeCost, nestingProblem, BASIS_KEYS, YIELD_UNITS, unitChoices, recipeUnitChoices } from '../../../shared/costing.js'
import { PRICES_MODULE, seesPurchasingPrices, UNITS } from '../../../shared/procurement.js'
import { webLink } from '../../../shared/links.js'

const uuid = z.string().uuid()
const MAX_LINES = 200
// Blank becomes null.
const optText = max => z.string().trim().max(max).nullable().transform(v => v || null)
// A photo from the media library (/uploads/...) or a web address (rule 18).
const Photo = z.string().trim().max(1000).nullable().transform(v => v || null)
  .refine(v => v == null || /^\/uploads\/[^\s]+$/.test(v) || webLink(v) === v, 'Use a picture from the media library')

const LineBody = z.object({
  item_id:       uuid.nullable().optional(),
  sub_recipe_id: uuid.nullable().optional(),
  qty:           z.number().positive().max(10000000),
  unit:          z.string().trim().min(1).max(30),
  yield_pct:     z.number().min(1).max(100).nullable().optional(),
  note:          z.string().trim().max(500).nullable().optional(),
}).refine(l => !!l.item_id !== !!l.sub_recipe_id, 'Each line is an inventory item or a prep recipe')

// Every field of a recipe: a save (PUT) sends them all, the ones the page
// doesn't edit too (rule 13); a new recipe (POST) may leave some out.
const FIELDS = {
  name:             z.string().trim().min(1).max(200),
  kind:             z.enum(['dish', 'prep']),
  category:         optText(100),
  code:             optText(60),
  status:           z.enum(['draft', 'live']),
  yield_qty:        z.number().positive().max(10000000).nullable(),
  yield_unit:       optText(30),
  portions:         z.number().positive().max(100000).nullable(),
  loss_pct:         z.number().min(0).max(99.99),
  method:           optText(20000),
  photo_url:        Photo,
  shelf_life_hours: z.number().int().min(1).max(8760).nullable(),
  variant_of:       uuid.nullable(),
  notes:            optText(2000),
  is_active:        z.boolean(),
  lines:            z.array(LineBody).max(MAX_LINES),
}
export const RecipeSave = z.object(FIELDS).strict()
const DEFAULTS = {
  kind: 'dish', category: null, code: null, status: 'draft', yield_qty: null, yield_unit: null, portions: null, loss_pct: 0,
  method: null, photo_url: null, shelf_life_hours: null, variant_of: null, notes: null, is_active: true, lines: [],
}
export const RecipeNew = z.object({
  ...Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, k === 'name' ? v : v.optional()])),
}).strict().transform(b => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }))

// The editor's draft: the recipe's fields as far as the page has them.
const PreviewBody = z.object({ id: uuid.nullable().optional(), ...Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, v.optional()])) })
  .transform(b => ({ ...DEFAULTS, name: 'This recipe', ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }))

const CopyBody = z.object({ name: z.string().trim().min(1).max(200).optional(), variant: z.boolean().optional() })
const ActiveBody = z.object({ is_active: z.boolean() })
const ListQuery = z.object({
  venue_id: uuid.optional(),
  basis:    z.enum(BASIS_KEYS).optional(),
  kind:     z.enum(['dish', 'prep']).optional(),
  q:        z.string().trim().max(100).optional(),
  active:   z.enum(['on', 'off', 'all']).optional(),
})
const OneQuery = z.object({ venue_id: uuid.optional(), basis: z.enum(BASIS_KEYS).optional() })

const canView = requirePermission('recipes', 'view')
const canManage = requirePermission('recipes', 'manage')

/** Who sees what: costs (Costing View), supplier prices in the explanation, changes. */
export async function access(req) {
  const lv = await permissionLevels(req, ['recipes', 'costing', PRICES_MODULE])
  return {
    manage: permissionAtLeast(lv.recipes, 'manage'),
    costs: permissionAtLeast(lv.costing, 'view'),
    prices: permissionAtLeast(lv.costing, 'view') && seesPurchasingPrices(lv[PRICES_MODULE]),
  }
}

const who = req => req.user?.email ?? req.user?.sub ?? null

/**
 * One recipe save at a time in a group: the nesting check reads every other
 * recipe's lines, so two saves at once (A into B, B into A) could each pass
 * against the other's old lines and write a loop. Held to the transaction's end.
 */
export const lockRecipes = (tx, tenantId) => tx`SELECT pg_advisory_xact_lock(hashtext(${'recipes:' + tenantId}))`

async function ownRecipe(tx, tenantId, id) {
  const [r] = await tx`SELECT id, name, kind, variant_of FROM recipes WHERE id = ${id} AND tenant_id = ${tenantId}`
  if (!r) throw httpError(404, 'Recipe not found')
  return r
}

/**
 * Checks a recipe before it is written: every line's item and prep recipe
 * is this group's (a dish recipe is never inside another), a prep recipe
 * says what it is made in, the variation names one of this group's recipes
 * that is no variation itself, and nothing nests into itself or too deep.
 */
async function checkRecipe(tx, tenantId, id, b, all) {
  const itemIds = [...new Set(b.lines.map(l => l.item_id).filter(Boolean))]
  if (itemIds.length) {
    const found = await tx`SELECT id FROM inv_items WHERE tenant_id = ${tenantId} AND id = ANY(${itemIds}::uuid[])`
    if (found.length !== itemIds.length) throw httpError(404, 'Inventory item not found')
  }
  for (const l of b.lines.filter(x => x.sub_recipe_id)) {
    const sub = all.get(l.sub_recipe_id)
    if (!sub) throw httpError(404, 'Recipe not found')
    if (sub.kind !== 'prep') throw httpError(422, sub.name + ' is a dish: only prep recipes go inside other recipes', { code: 'not_prep' })
  }
  if (b.kind === 'prep' && b.yield_unit && !YIELD_UNITS.includes(b.yield_unit.toLowerCase())) {
    throw httpError(422, 'A prep recipe is made in ' + YIELD_UNITS.join(', '), { code: 'yield_unit' })
  }
  if (b.kind === 'dish' && all && id && [...all.values()].some(r => r.id !== id && r.lines.some(l => l.sub_recipe_id === id))) {
    throw httpError(422, 'Other recipes use this one inside them: it stays a prep recipe', { code: 'in_use' })
  }
  if (b.variant_of) {
    const head = all.get(b.variant_of)
    if (!head) throw httpError(404, 'Recipe not found')
    if (head.id === id) throw httpError(422, 'A recipe can\'t be a variation of itself', { code: 'variant_of' })
    if (head.variant_of) throw httpError(422, head.name + ' is itself a variation: pick the recipe it varies', { code: 'variant_of' })
    if (id && [...all.values()].some(r => r.variant_of === id)) {
      throw httpError(422, 'This recipe has variations of its own, so it can\'t be one', { code: 'variant_of' })
    }
  }
  const problem = nestingProblem(id, b.lines, all, b.name)
  if (problem) throw httpError(422, problem.message, { code: problem.code, path: problem.path })
}

/** A line as stored: one unit name per item as the item spells it, prep units lower case. */
function lineRows(tenantId, recipeId, lines, items) {
  return lines.map((l, i) => {
    let unit = l.unit.trim()
    const item = l.item_id ? items.get(l.item_id) : null
    if (item) unit = unitChoices(item).find(u => u.toLowerCase() === unit.toLowerCase()) || unit
    else if (UNITS[unit.toLowerCase()] || unit.toLowerCase() === 'portion') unit = unit.toLowerCase()
    return {
      tenant_id: tenantId, recipe_id: recipeId, sort_order: i, item_id: l.item_id || null, sub_recipe_id: l.sub_recipe_id || null,
      qty: l.qty, unit, yield_pct: l.yield_pct ?? null, note: l.note || null,
    }
  })
}

async function writeLines(tx, tenantId, recipeId, lines) {
  await tx`DELETE FROM recipe_lines WHERE recipe_id = ${recipeId} AND tenant_id = ${tenantId}`
  if (!lines.length) return
  const items = await loadCostItems(tx, tenantId, [...new Set(lines.map(l => l.item_id).filter(Boolean))])
  await tx`INSERT INTO recipe_lines ${tx(lineRows(tenantId, recipeId, lines, items),
    'tenant_id', 'recipe_id', 'sort_order', 'item_id', 'sub_recipe_id', 'qty', 'unit', 'yield_pct', 'note')}`
}

const recipeValues = b => ({
  name: b.name, kind: b.kind, category: b.category, code: b.code, status: b.status,
  // A dish has portions, a prep its yield and loss: the other's fields are kept empty.
  yield_qty: b.kind === 'prep' ? b.yield_qty : null,
  yield_unit: b.kind === 'prep' ? (b.yield_unit ? b.yield_unit.toLowerCase() : null) : null,
  portions: b.kind === 'dish' ? b.portions : null,
  loss_pct: b.kind === 'prep' ? b.loss_pct : 0,
  method: b.method, photo_url: b.photo_url, shelf_life_hours: b.shelf_life_hours, variant_of: b.variant_of,
  notes: b.notes, is_active: b.is_active,
})

/** The venue a cost is asked for (one of this group's), or null for the group's own prices. */
async function venueOf(tx, tenantId, venueId) {
  return venueId ? loadVenue(tx, tenantId, venueId) : null
}

/** One recipe as the page shows it, at a venue on a basis. */
async function oneView(tx, req, id, { venueId = null, basis = 'standard' } = {}, can = null) {
  const a = can || await access(req)
  const all = await loadRecipes(tx, req.tenantId)
  const recipe = all.get(id)
  if (!recipe) throw httpError(404, 'Recipe not found')
  const venue = await venueOf(tx, req.tenantId, venueId)
  const ctx = await loadCosting(tx, req.tenantId, venue?.id ?? null, { basis, recipes: all })
  const view = recipeView(recipe, ctx, { costs: a.costs, prices: a.prices, withExplain: true })
  // Where it is used, and its variations (the group it belongs to).
  const headId = recipe.variant_of || recipe.id
  view.used_in = [...all.values()].filter(r => r.lines.some(l => l.sub_recipe_id === id)).map(r => ({ id: r.id, name: r.name, kind: r.kind }))
  view.variant_of_name = recipe.variant_of ? all.get(recipe.variant_of)?.name ?? null : null
  view.variations = [...all.values()].filter(r => r.id !== id && (r.id === headId || r.variant_of === headId))
    .map(r => ({ id: r.id, name: r.name, is_head: r.id === headId, status: r.status, is_active: r.is_active }))
  // Each basis side by side (D1: the standard price, with last paid beside it).
  if (a.costs) {
    view.bases = {}
    for (const k of BASIS_KEYS) {
      const c = k === ctx.basis ? { per_unit: view.per_unit, coverage: view.coverage } : recipeCost(recipe, { ...ctx, basis: k, _memo: undefined })
      view.bases[k] = { per_unit: c.per_unit, coverage: c.coverage }
    }
  }
  view.venue = venue ? { id: venue.id, name: venue.name } : null
  view.can = { manage: a.manage, costs: a.costs, prices: a.prices }
  view.unit_choices = view.lines.map(l => (l.item ? unitChoices(l.item) : recipeUnitChoices(all.get(l.sub_recipe_id))))
  return view
}

export default async function recipeRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => {
    const q = ListQuery.parse(req.query || {})
    const a = await access(req)
    return withTenant(req.tenantId, async tx => {
      const venue = await venueOf(tx, req.tenantId, q.venue_id)
      const all = await loadRecipes(tx, req.tenantId)
      const ctx = await loadCosting(tx, req.tenantId, venue?.id ?? null, { basis: q.basis, recipes: all })
      const words = (q.q || '').toLowerCase().split(/\s+/).filter(Boolean)
      const active = q.active || 'on'
      const usedIn = new Map()
      for (const r of all.values()) for (const l of r.lines) if (l.sub_recipe_id) usedIn.set(l.sub_recipe_id, (usedIn.get(l.sub_recipe_id) || 0) + 1)
      const rows = [...all.values()]
        .filter(r => !q.kind || r.kind === q.kind)
        .filter(r => active === 'all' || (active === 'on' ? r.is_active : !r.is_active))
        .filter(r => words.every(w => [r.name, r.category, r.code].some(x => (x || '').toLowerCase().includes(w))))
        .map(r => {
          const c = recipeCost(r, ctx)
          return {
            id: r.id, name: r.name, kind: r.kind, category: r.category, code: r.code, status: r.status,
            is_active: r.is_active, variant_of: r.variant_of, variant_of_name: r.variant_of ? all.get(r.variant_of)?.name ?? null : null,
            yield_qty: r.yield_qty, yield_unit: r.yield_unit, portions: r.portions, photo_url: r.photo_url,
            line_count: r.lines.length, used_in: usedIn.get(r.id) || 0, updated_at: r.updated_at,
            unit: c.unit, coverage: c.coverage, gaps: c.gaps.length,
            ...(a.costs ? { cost: c.cost, per_unit: c.per_unit } : {}),
          }
        })
      const counts = { full: 0, partial: 0, none: 0 }
      for (const r of rows) counts[r.coverage]++
      return {
        recipes: rows, counts,
        venue: venue ? { id: venue.id, name: venue.name } : null,
        basis: ctx.basis, can: { manage: a.manage, costs: a.costs, prices: a.prices },
      }
    })
  })

  app.get('/pickers', { preHandler: canView }, async req => withTenant(req.tenantId, async tx => {
    const items = await loadCostItems(tx, req.tenantId)
    const recipes = await tx`
      SELECT id, name, kind, yield_unit, is_active, variant_of, category, status, code FROM recipes
       WHERE tenant_id = ${req.tenantId} ORDER BY lower(name)`
    return {
      items: [...items.values()].map(i => ({ ...i, unit_choices: unitChoices(i) })),
      // Prep recipes go inside others; a variation varies a recipe that is no variation itself.
      recipes: recipes.filter(r => r.kind === 'prep').map(r => ({
        id: r.id, name: r.name, yield_unit: r.yield_unit, is_active: r.is_active,
        unit_choices: recipeUnitChoices({ kind: 'prep', yield_unit: r.yield_unit }),
      })),
      heads: recipes.filter(r => !r.variant_of).map(r => ({ id: r.id, name: r.name, kind: r.kind })),
      // Dish recipes, for linking menu dishes and options to (phase 2): a variation names the recipe it varies.
      dishes: recipes.filter(r => r.kind === 'dish').map(r => ({
        id: r.id, name: r.name, variant_of: r.variant_of, status: r.status, is_active: r.is_active, category: r.category, code: r.code,
      })),
      categories: [...new Set(recipes.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      yield_units: YIELD_UNITS,
    }
  }))

  app.post('/preview', { preHandler: canView }, async req => {
    const b = PreviewBody.parse(req.body || {})
    const q = OneQuery.parse(req.query || {})
    const a = await access(req)
    return withTenant(req.tenantId, async tx => {
      const all = await loadRecipes(tx, req.tenantId)
      if (b.id && !all.has(b.id)) throw httpError(404, 'Recipe not found')
      const itemIds = [...new Set(b.lines.map(l => l.item_id).filter(Boolean))]
      const found = itemIds.length ? await tx`SELECT id FROM inv_items WHERE tenant_id = ${req.tenantId} AND id = ANY(${itemIds}::uuid[])` : []
      if (found.length !== itemIds.length) throw httpError(404, 'Inventory item not found')
      if (b.lines.some(l => l.sub_recipe_id && !all.has(l.sub_recipe_id))) throw httpError(404, 'Recipe not found')
      const nesting = nestingProblem(b.id || null, b.lines, all, b.name)
      const id = b.id || '00000000-0000-0000-0000-000000000000'
      const draft = {
        ...(all.get(id) || {}), ...recipeValues(b), id,
        lines: b.lines.map((l, i) => ({ id: 'draft-' + i, sort_order: i, item_id: l.item_id || null, sub_recipe_id: l.sub_recipe_id || null, qty: l.qty, unit: l.unit, yield_pct: l.yield_pct ?? null, note: l.note ?? null })),
      }
      const recipes = new Map(all)
      recipes.set(id, draft)
      const venue = await venueOf(tx, req.tenantId, q.venue_id)
      const ctx = await loadCosting(tx, req.tenantId, venue?.id ?? null, { basis: q.basis, recipes })
      const view = recipeView(draft, ctx, { costs: a.costs, prices: a.prices, withExplain: true })
      return {
        unit: view.unit, makes: view.makes, coverage: view.coverage, complete: view.complete, gaps: view.gaps,
        lines: view.lines, costs_shown: view.costs_shown, nesting: nesting ? { code: nesting.code, message: nesting.message } : null,
        ...(a.costs ? { cost: view.cost, per_unit: view.per_unit, basis: view.basis, explanation: view.explanation } : {}),
        unit_choices: view.lines.map(l => (l.item ? unitChoices(l.item) : recipeUnitChoices(recipes.get(l.sub_recipe_id)))),
      }
    })
  })

  app.get('/:recipeId', { preHandler: canView }, async req => {
    const q = OneQuery.parse(req.query || {})
    return withTenant(req.tenantId, tx => oneView(tx, req, req.params.recipeId, { venueId: q.venue_id, basis: q.basis }))
  })

  app.post('/', { preHandler: canManage }, async (req, reply) => {
    const b = RecipeNew.parse(req.body || {})
    const out = await withTenant(req.tenantId, async tx => {
      await lockRecipes(tx, req.tenantId)
      const all = await loadRecipes(tx, req.tenantId)
      await checkRecipe(tx, req.tenantId, null, b, all)
      const [r] = await tx`
        INSERT INTO recipes ${tx({ ...recipeValues(b), tenant_id: req.tenantId, created_by: who(req) })}
        RETURNING id`
      await writeLines(tx, req.tenantId, r.id, b.lines)
      return oneView(tx, req, r.id)
    })
    return reply.code(201).send(out)
  })

  app.put('/:recipeId', { preHandler: canManage }, async req => {
    const b = RecipeSave.parse(req.body || {})
    const q = OneQuery.parse(req.query || {})
    return withTenant(req.tenantId, async tx => {
      const r = await ownRecipe(tx, req.tenantId, req.params.recipeId)
      await lockRecipes(tx, req.tenantId)
      const all = await loadRecipes(tx, req.tenantId)
      await checkRecipe(tx, req.tenantId, r.id, b, all)
      await tx`UPDATE recipes SET ${tx(recipeValues(b))}, updated_at = now() WHERE id = ${r.id} AND tenant_id = ${req.tenantId}`
      await writeLines(tx, req.tenantId, r.id, b.lines)
      return oneView(tx, req, r.id, { venueId: q.venue_id, basis: q.basis })
    })
  })

  app.post('/:recipeId/copy', { preHandler: canManage }, async (req, reply) => {
    const b = CopyBody.parse(req.body || {})
    const out = await withTenant(req.tenantId, async tx => {
      await ownRecipe(tx, req.tenantId, req.params.recipeId)
      await lockRecipes(tx, req.tenantId)
      const all = await loadRecipes(tx, req.tenantId)
      const from = all.get(req.params.recipeId)
      const body = {
        ...from, name: b.name || (from.name + (b.variant ? ' (variation)' : ' (copy)')).slice(0, 200), status: 'draft',
        variant_of: b.variant ? (from.variant_of || from.id) : from.variant_of,
        lines: from.lines.map(l => ({ item_id: l.item_id, sub_recipe_id: l.sub_recipe_id, qty: l.qty, unit: l.unit, yield_pct: l.yield_pct, note: l.note })),
      }
      await checkRecipe(tx, req.tenantId, null, body, all)
      const [r] = await tx`
        INSERT INTO recipes ${tx({ ...recipeValues(body), tenant_id: req.tenantId, created_by: who(req) })}
        RETURNING id`
      await writeLines(tx, req.tenantId, r.id, body.lines)
      return oneView(tx, req, r.id)
    })
    return reply.code(201).send(out)
  })

  app.patch('/:recipeId/active', { preHandler: canManage }, async req => {
    const b = ActiveBody.parse(req.body || {})
    return withTenant(req.tenantId, async tx => {
      const r = await ownRecipe(tx, req.tenantId, req.params.recipeId)
      await tx`UPDATE recipes SET is_active = ${b.is_active}, updated_at = now() WHERE id = ${r.id} AND tenant_id = ${req.tenantId}`
      return { id: r.id, is_active: b.is_active }
    })
  })

  app.delete('/:recipeId', { preHandler: canManage }, async req => withTenant(req.tenantId, async tx => {
    const r = await ownRecipe(tx, req.tenantId, req.params.recipeId)
    const used = await tx`
      SELECT DISTINCT p.name FROM recipe_lines l JOIN recipes p ON p.id = l.recipe_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${req.tenantId} AND l.sub_recipe_id = ${r.id} ORDER BY p.name`
    if (used.length) {
      const names = used.map(u => u.name)
      throw httpError(409, `${names.slice(0, 5).join(', ')}${names.length > 5 ? ' and ' + (names.length - 5) + ' more' : ''} ${names.length === 1 ? 'uses' : 'use'} ${r.name}: take it out of ${names.length === 1 ? 'that recipe' : 'those'} first, or switch it off`,
        { code: 'in_use', recipes: names })
    }
    await tx`DELETE FROM recipes WHERE id = ${r.id} AND tenant_id = ${req.tenantId}`
    return { deleted: true }
  }))
}
