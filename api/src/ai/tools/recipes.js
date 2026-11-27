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
//   dish_cost      a menu dish at a venue, revenue stream and order type
//                  (phase 2): which recipe it uses there and why, and
//                  (Costing view) its cost, price, GP and cost % with
//                  the steps                              recipes or costing, view
//   menu_margins   a menu at a venue and order type: every dish's
//                  margin, worst first, uncosted ones named        costing, view
//
// The model is given names, never ids (rule 19): a recipe is picked by its
// name, and its page link searches the Recipes page for that name.

import { z } from 'zod'
import { callApi, requireStaffPermission, ToolError } from '../context.js'
import { VenueText, venueFor, tenantVenueList, pickByName, plural } from './util.js'
import { fmtNum, UNITS } from '../../../../shared/procurement.js'
import { pounds, perWord, BASIS_KEYS, COVERAGE, BANDS } from '../../../../shared/costing.js'

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

// This file's place, its areas and what Pepper is told about them (tools/index.js gathers them).
export const order = 85
export const sections = {
  recipes: { label: 'Recipes: dishes and prep recipes, and what they cost at each venue', modules: ['recipes'] },
}
export const promptLines = [
  'Recipes: find_recipes (recipes and prep recipes by name, kind or how much is costed, with the cost per portion at a ' +
    'venue), recipe (what goes into one, its method, what could not be costed and how to fix it, and its cost with the ' +
    'steps it is worked out by).',
  'Dish costs and margins: dish_cost (a menu dish at a venue, revenue stream and order type: which recipe or variation ' +
    'it uses there and why, what it costs, its price, GP and cost %, with the steps), menu_margins (every dish of a menu ' +
    'at a venue and order type, worst cost % first, with the dishes that can\'t be costed yet and how to fix each).',
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
        page: '/recipes?q=' + encodeURIComponent(r.name),
      }
    },
  },
]


// ── Dishes and margins (phase 2) ─────────────────────────────

const money = p => (p == null ? null : (p < 0 ? '-£' : '£') + (Math.abs(p) / 100).toFixed(2))
const pct = p => (p == null ? null : fmtNum(p, 1) + '%')
const bandText = b => (b ? BANDS[b].label.toLowerCase() : null)

/** The venue, revenue stream and order type named, as ids for the routes; names for the answer. */
async function scopeFor(ctx, input) {
  const venues = await tenantVenueList(ctx)
  const venue = input.venue ? await venueFor(ctx, input.venue) : venues.length === 1 ? venues[0] : null
  const scope = {}
  let stream = null
  let type = null
  if (input.stream || input.order_type) {
    const tax = await callApi(ctx, 'GET', '/api/tax-rates')
    if (input.stream) {
      if (!venue) throw new ToolError('Which venue is ' + input.stream + ' at?', 422)
      stream = pickByName((tax.streams || []).filter(s => s.venue_id === venue.id && s.is_active), input.stream, s => s.name, 'revenue stream at ' + venue.name, venue.name + ' has no revenue streams.')
    }
    if (input.order_type) type = pickByName((tax.order_types || []).filter(t => t.is_active), input.order_type, t => t.name, 'order type')
  }
  if (venue) scope.venue_id = venue.id
  if (stream) scope.revenue_stream_id = stream.id
  if (type) scope.order_type_id = type.id
  const where = [type ? type.name : null, stream ? stream.name + ' (' + venue.name + ')' : venue ? venue.name : 'the group\'s own prices'].filter(Boolean).join(' at ')
  return { scope, venue, stream, type, where }
}


const StreamText = z.string().trim().max(120).optional()
const TypeText = z.string().trim().max(60).optional()

export const marginTools = [
  {
    name: 'dish_cost',
    activity: 'Looked at what a dish costs',
    section: 'recipes',
    modules: ['recipes', 'costing'],
    title: 'A dish\'s cost and margin',
    description:
      'One dish on the menus by name: which recipe it uses at a venue, revenue stream and order type and why (a dish ' +
      'links to a recipe for every venue, and a venue, a stream, an order type such as takeaway, or a mix can use another ' +
      'recipe or a variation; the closest wins), and for people with Costing view what one serving costs there, its menu ' +
      'price, the price net of VAT for that order type, the gross profit and cost % against the targets, with the steps. ' +
      'Leave the venue out for the group\'s own prices. Options can be named to cost them on it (extra cheese, no onion).',
    input: z.object({
      dish: z.string().trim().min(1).max(200).describe('The dish\'s name on the menu'),
      menu: z.string().trim().max(120).optional().describe('The menu, when dishes on two menus share the name'),
      venue: VenueText.describe('The venue; leave out for the group\'s own prices'),
      stream: StreamText.describe('A revenue stream at that venue (the bar, the terrace)'),
      order_type: TypeText.describe('The order type: eat in, take out, delivery...'),
      options: z.array(z.object({
        option: z.string().trim().min(1).max(200).describe('The option\'s name'),
        prefix: z.enum(['no', 'light', 'extra', 'side']).optional(),
      })).max(10).optional().describe('Options to cost on the dish'),
      draft: z.boolean().optional().describe('true for the menu as it is being edited instead of what is live'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'view').catch(async () => requireStaffPermission(ctx, 'costing', 'view'))
      const list = await callApi(ctx, 'GET', '/api/recipe-links/dishes')
      const menu = input.menu ? pickByName(list.menus, input.menu, m => m.name, 'menu', 'No menus yet.') : null
      const rows = menu ? list.dishes.filter(d => d.menu_id === menu.id) : list.dishes
      const dish = pickByName(rows, input.dish, d => d.name, 'dish', 'No dishes on the menus yet.')
      const { scope, where } = await scopeFor(ctx, input)
      const q = new URLSearchParams({ ...scope, version: input.draft ? 'draft' : 'live' })
      if (input.options?.length) {
        const m = await callApi(ctx, 'GET', '/api/recipe-links/dishes/' + dish.id)
        const picks = input.options.map(o => {
          const hit = pickByName(m.options.map(x => ({ ...x, id: x.option_id || 'v:' + x.label })), o.option, x => x.label, 'option of ' + dish.name, dish.name + ' has no options.')
          return { option_id: hit.option_id || 'v:' + hit.label, ...(o.prefix ? { prefix: o.prefix } : {}) }
        })
        q.set('options', JSON.stringify(picks))
      }
      const c = await callApi(ctx, 'GET', '/api/recipe-links/dishes/' + dish.id + '/cost?' + q.toString())
      const out = {
        dish: c.dish.name, menu: c.dish.menu, where,
        kind: c.dish.kind === 'deal' ? 'meal deal' : c.dish.kind,
        recipe: c.recipe ? c.recipe.name + (Number(c.portions) !== 1 ? ' x ' + c.portions : '') : null,
        ...(c.recipe ? { why: 'its link for ' + c.why + ' is the closest' } : {}),
        costed: c.coverage === 'not_needed' ? 'a service: no recipe needed' : COVERAGE[c.coverage],
        ...(c.gaps.length ? { gaps: c.gaps.map(g => g.text + '. ' + g.fix) } : {}),
        ...(c.options.length ? { options: c.options.map(o => o.label + ': ' + o.text) } : {}),
        page: '/recipes?tab=dishes&q=' + encodeURIComponent(c.dish.name),
      }
      if (!c.costs_shown) return { ...out, note: NO_COSTS }
      const m = c.margin
      return {
        ...out,
        ...(c.dish.kind === 'deal'
          ? { cost: c.min != null ? pounds(c.min) + ' to ' + pounds(c.max) + ' by what is picked' : 'not costed', cost_pct: m.cost_pct_min != null ? pct(m.cost_pct_min) + ' to ' + pct(m.cost_pct_max) : null }
          : { cost: c.cost != null ? pounds(c.cost) : 'not costed' }),
        price: m.price_pence != null ? (m.price_varies ? 'from ' : '') + money(m.price_pence) + ' with VAT' : 'no price',
        net_of_vat: money(m.net_pence) + ' (' + fmtNum(m.vat_rate, 2) + '% VAT)',
        ...(m.gp_pence != null ? { gross_profit: money(m.gp_pence) } : {}),
        ...(m.cost_pct != null ? { cost_pct: pct(m.cost_pct), against_target: bandText(m.band) + ' (target ' + pct(m.thresholds.target_pct) + ', limit ' + pct(m.thresholds.limit_pct) + ')' } : {}),
        steps: [...(c.steps || []).map(s => s.label + ': ' + s.text + (s.amount != null ? ' = ' + pounds(s.amount) : '')), ...(m.steps || []).map(s => s.label + ': ' + s.text)],
        ...(c.recipe_explanation?.text ? { inside_the_recipe: c.recipe_explanation.text } : {}),
        page: '/menu-margins',
      }
    },
  },

  {
    name: 'menu_margins',
    activity: 'Looked at a menu\'s margins',
    section: 'recipes',
    modules: ['costing'],
    title: 'A menu\'s margins',
    description:
      'Every dish of a menu at a venue (and revenue stream) and order type, from the Menu margins page (/menu-margins): ' +
      'its menu price, the price net of VAT for that order type, its cost, gross profit and cost %, against the group\'s ' +
      'target and limit cost %, the worst cost % first; meal deals with the range their picks give; and the dishes that ' +
      'can\'t be costed yet, by name, with how to fix each. Live menu unless the draft is asked for. Costing view only.',
    input: z.object({
      menu: z.string().trim().min(1).max(120).describe('The menu\'s name'),
      venue: VenueText.describe('The venue; leave out for the group\'s own prices'),
      stream: StreamText,
      order_type: TypeText.describe('The order type: eat in, take out, delivery...'),
      only: z.enum(['over_target', 'all']).optional().describe('over_target for the dishes above the target only'),
      draft: z.boolean().optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'costing', 'view')
      const choices = await callApi(ctx, 'GET', '/api/menu-margins')
      const menu = pickByName(choices.choices.menus, input.menu, m => m.name, 'menu', 'No menus yet.')
      const { scope, where } = await scopeFor(ctx, input)
      const q = new URLSearchParams({ menu_id: menu.id, ...scope, version: input.draft ? 'draft' : 'live' })
      const r = await callApi(ctx, 'GET', '/api/menu-margins?' + q.toString())
      if (r.message) return { menu: menu.name, where, message: r.message, page: '/menu-margins' }
      const pctOf = x => (x.kind === 'deal' ? x.cost_pct_max : x.cost_pct)
      const rows = r.rows.filter(x => pctOf(x) != null && (input.only !== 'over_target' || x.band === 'watch' || x.band === 'over'))
        .sort((a, b) => pctOf(b) - pctOf(a))
      return {
        menu: menu.name, where, version: r.menu.version,
        targets: 'target ' + pct(r.settings.target_pct) + ', limit ' + pct(r.settings.limit_pct),
        counts: { dishes: r.counts.dishes, over_the_limit: r.counts.over, over_target: r.counts.watch, partly_costed: r.counts.partial, not_costed: r.counts.uncosted },
        dishes: rows.slice(0, MAX_LIST).map(x => ({
          dish: x.name, ...(x.section ? { section: x.section } : {}),
          price: (x.price_varies ? 'from ' : '') + money(x.price_pence), net: money(x.net_pence),
          ...(x.kind === 'deal'
            ? { cost: pounds(x.cost_min) + ' to ' + pounds(x.cost_max), cost_pct: pct(x.cost_pct_min) + ' to ' + pct(x.cost_pct_max) }
            : { cost: pounds(x.cost), gross_profit: money(x.gp_pence), cost_pct: pct(x.cost_pct) }),
          against_target: bandText(x.band),
          ...(x.coverage === 'partial' ? { partly_costed: true } : {}),
          ...(x.recipe && x.why !== 'every venue' ? { recipe: x.recipe.name + ' (for ' + x.why + ')' } : {}),
        })),
        ...(rows.length > MAX_LIST ? { more: rows.length - MAX_LIST + ' more on the page' } : {}),
        ...(r.uncosted.length ? { not_costed: r.uncosted.map(u => u.name + ': ' + (u.fix || 'link it to a recipe')) } : {}),
        page: '/menu-margins',
      }
    },
  },
]

// What Pepper is told about this file's tools, gathered by tools/index.js.
export const tools = [...recipeTools, ...marginTools]
