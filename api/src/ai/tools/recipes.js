// src/ai/tools/recipes.js
//
// Recipes and what they cost (inventory phase 1, migration 300) for Pepper
// (staff assistant and staff MCP). Both tools only read, through the Recipes
// page's own routes (callApi to /api/recipes), so the figures and who sees
// them are the page's: costs only for people with Costing view (the routes
// leave them out otherwise), supplier names and pack prices in the
// explanation only for people who also see purchasing prices.
//
//   find_recipes   recipes by words, kind and how much of each is costed,
//                  with the cost per portion or unit at a venue      recipes, view
//   recipe         one recipe: what goes into it, the method, the gaps
//                  with how to fix each, and (Costing view) its cost
//                  on each basis with the step by step explanation   recipes, view
//
// The model is given names, never ids: a recipe is picked by its name.

import { z } from 'zod'
import { callApi, requireStaffPermission } from '../context.js'
import { VenueText, venueFor, pickByName, plural } from './util.js'
import { fmtNum, UNITS } from '../../../../shared/procurement.js'
import { pounds, perWord, BASIS_KEYS, COVERAGE } from '../../../../shared/costing.js'

const MAX_LIST = 40
const METHOD_MAX = 2000
const unitWord = u => (u === 'portion' ? 'portion' : UNITS[u]?.label ?? u)
const perText = r => (r.per_unit != null ? pounds(r.per_unit) + ' ' + perWord(r.unit) : null)
const makesText = r => (r.kind === 'prep'
  ? (r.yield_qty ? fmtNum(r.yield_qty) + ' ' + unitWord(r.yield_unit) + (r.loss_pct ? ' before ' + fmtNum(r.loss_pct) + '% lost in cooking' : '') : 'not set')
  : plural(Number(r.portions || 1), 'portion'))

const NO_COSTS = 'Costs aren\'t shown: they need Costing view (a cost tells what suppliers charge).'

async function venueQuery(ctx, input) {
  const venue = input.venue ? await venueFor(ctx, input.venue) : null
  const q = []
  if (venue) q.push('venue_id=' + venue.id)
  if (input.basis && input.basis !== 'standard') q.push('basis=' + input.basis)
  return { venue, q }
}

// What Pepper is told about this file's tools, gathered by tools/index.js.
export { recipeTools as tools }
export const order = 85
export const sections = {
  recipes: { label: 'Recipes: dishes and prep recipes, and what they cost at each venue', modules: ['recipes'] },
}
export const promptLines = [
  'Recipes: find_recipes (recipes and prep recipes by name, kind or how much is costed, with the cost per portion at a ' +
    'venue), recipe (what goes into one, its method, what could not be costed and how to fix it, and its cost with the ' +
    'steps it is worked out by).',
]

export const recipeTools = [
  {
    name: 'find_recipes',
    activity: 'Looked at the recipes',
    section: 'recipes',
    title: 'Find recipes',
    description:
      'The group\'s recipes from the Recipes page (/recipes): dishes (costed per portion) and prep recipes (a sauce or a ' +
      'batch, costed per unit it makes and used inside other recipes). Filter by words in the name, category or code, by ' +
      'kind, and by how much of each is costed (full, partial: some lines have no supplier price or no size for their ' +
      'unit, none). For people with Costing view each comes with its cost per portion or unit at the venue asked (left ' +
      'out: the group\'s own prices), at today\'s standard supplier prices unless a basis is asked.',
    input: z.object({
      words: z.string().trim().max(100).optional().describe('Words in the recipe\'s name, category or code'),
      kind: z.enum(['dish', 'prep']).optional(),
      coverage: z.enum(['full', 'partial', 'none']).optional().describe('How much of it can be costed'),
      venue: VenueText.describe('The venue whose prices to cost at; leave out for the group\'s own prices'),
      basis: z.enum(BASIS_KEYS).optional().describe('standard (the price ordered on today), last (last paid there) or average (average paid there)'),
      switched_off: z.boolean().optional().describe('true for the recipes switched off instead'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'view')
      const { venue, q } = await venueQuery(ctx, input)
      if (input.kind) q.push('kind=' + input.kind)
      if (input.words) q.push('q=' + encodeURIComponent(input.words))
      q.push('active=' + (input.switched_off ? 'off' : 'on'))
      const out = await callApi(ctx, 'GET', '/api/recipes?' + q.join('&'))
      const rows = out.recipes.filter(r => !input.coverage || r.coverage === input.coverage)
      return {
        costs_at: out.can.costs ? (venue ? venue.name : 'the group\'s own prices') + ', ' + (out.basis || 'standard') + ' prices' : undefined,
        ...(out.can.costs ? {} : { note: NO_COSTS }),
        found: rows.length,
        recipes: rows.slice(0, MAX_LIST).map(r => ({
          name: r.name, kind: r.kind === 'prep' ? 'prep recipe' : 'dish',
          ...(r.category ? { category: r.category } : {}),
          ...(r.status === 'draft' ? { status: 'draft' } : {}),
          makes: makesText(r),
          costed: COVERAGE[r.coverage],
          ...(r.gaps ? { gaps: r.gaps } : {}),
          ...(out.can.costs ? { cost: perText(r) || 'no cost yet' } : {}),
          ...(r.variant_of_name ? { variation_of: r.variant_of_name } : {}),
          ...(r.used_in ? { used_inside: plural(r.used_in, 'recipe') } : {}),
        })),
        ...(rows.length > MAX_LIST ? { more: rows.length - MAX_LIST + ' more: ask with more words' } : {}),
        ...(!rows.length ? { message: out.recipes.length ? 'None of them matches that.' : 'No recipes yet: they are made on the Recipes page (/recipes).' } : {}),
        page: '/recipes',
      }
    },
  },

  {
    name: 'recipe',
    activity: 'Looked at a recipe',
    section: 'recipes',
    title: 'A recipe and its cost',
    description:
      'One recipe by name: what goes into it (each inventory item or prep recipe, how much, in what unit, its yield and ' +
      'note), what it makes, the method, where it is used and its variations, and anything that could not be costed with ' +
      'how to fix it. For people with Costing view: its cost per portion or unit at the venue asked (or the group\'s own ' +
      'prices), each line\'s cost, the cost on each basis (standard, last paid, average paid) and the step by step ' +
      'explanation, which you can show the person as it is.',
    input: z.object({
      recipe: z.string().trim().min(1).max(200).describe('The recipe\'s name'),
      venue: VenueText.describe('The venue whose prices to cost at; leave out for the group\'s own prices'),
      basis: z.enum(BASIS_KEYS).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'view')
      const all = await callApi(ctx, 'GET', '/api/recipes?active=all')
      const pick = pickByName(all.recipes, input.recipe, r => r.name, 'recipe', 'No recipes yet: they are made on the Recipes page (/recipes).')
      const { venue, q } = await venueQuery(ctx, input)
      const r = await callApi(ctx, 'GET', '/api/recipes/' + pick.id + (q.length ? '?' + q.join('&') : ''))
      const costs = r.costs_shown
      return {
        name: r.name, kind: r.kind === 'prep' ? 'prep recipe' : 'dish',
        ...(r.category ? { category: r.category } : {}),
        status: r.status, ...(r.is_active ? {} : { switched_off: true }),
        makes: makesText(r),
        lines: r.lines.map(l => ({
          what: l.name || (l.item_id ? 'an item that is gone' : 'a recipe that is gone'),
          ...(l.kind === 'recipe' ? { is: 'prep recipe' } : {}),
          amount: fmtNum(l.qty) + ' ' + unitWord(l.unit),
          ...(l.yield_pct != null ? { line_yield: fmtNum(l.yield_pct) + '%' } : l.used_yield_pct != null && l.used_yield_pct < 100 ? { item_yield: fmtNum(l.used_yield_pct) + '%' } : {}),
          ...(l.note ? { note: l.note } : {}),
          ...(costs ? { cost: l.cost != null ? pounds(l.cost) : 'not costed' } : {}),
        })),
        costed: COVERAGE[r.coverage],
        ...(r.gaps.length ? { gaps: r.gaps.map(g => g.text + '. ' + g.fix) } : {}),
        ...(costs ? {
          costs_at: (venue ? venue.name : 'the group\'s own prices') + ', ' + r.basis + ' prices',
          cost: perText(r) || 'no cost yet',
          ...(r.cost != null ? { whole_recipe: pounds(r.cost) } : {}),
          on_each_basis: Object.fromEntries(Object.entries(r.bases || {}).map(([k, b]) => [k, b.per_unit != null ? pounds(b.per_unit) : 'not costed'])),
          explanation: r.explanation?.text,
        } : { note: NO_COSTS }),
        ...(r.method ? { method: r.method.length > METHOD_MAX ? r.method.slice(0, METHOD_MAX) + '...' : r.method } : {}),
        ...(r.used_in?.length ? { used_inside: r.used_in.map(x => x.name) } : {}),
        ...(r.variant_of_name ? { variation_of: r.variant_of_name } : {}),
        ...(r.variations?.length ? { variations: r.variations.map(x => x.name) } : {}),
        ...(r.shelf_life_hours ? { keeps_for: plural(r.shelf_life_hours, 'hour') } : {}),
        page: '/recipes?recipe=' + r.id,
      }
    },
  },
]
