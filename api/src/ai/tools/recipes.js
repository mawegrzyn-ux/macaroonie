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
// Phase 3, change tools (confirm cards; recipes manage):
//   read_recipes   reads recipes from files attached in the chat or text
//                  pasted (the recipe reader, POST /api/ai/recipes/read),
//                  shows what was read and makes DRAFTS on Confirm (POST
//                  /api/recipes/drafts); never live. The card pins the
//                  reading, so Confirm makes exactly what it showed.  consequential
//   link_recipes   links dishes to recipes by name, for every venue or at a
//                  venue, revenue stream or order type (the matrix cell in
//                  words), shown before it is set; Undo puts each cell back.
//                                                                    reversible
//   make_recipe    a draft recipe from a description with lines; lines not
//                  found among the items and prep recipes are kept in its
//                  notes                                          consequential
//
// Phase 7a (menu engineering and scenarios, migration 314):
//   menu_engineering  each section's dishes from what sold as stars,
//                  plough-horses, puzzles and dogs (GET /api/menu-margins/
//                  engineering; GP and classes with till reports view)  costing, view
//   save_scenario  a cost scenario from names: changes for a dish, a section
//                  or every dish, the figures at the mix on the card, saved
//                  (or the same-named one changed); pushing prices and
//                  publishing stay on the pages                     consequential
//
// Phase 7b (price creep, migration 315):
//   why_cost_changed  a dish's cost now against its cost at the start of a day:
//                  which items moved and by how much, from the supplier price
//                  history (GET /api/cost-alerts/why), its cost % then and now,
//                  the recipes changed since and the cost alerts recorded for
//                  it; supplier names and pack prices with purchasing prices
//                                                                    costing, view
//
// The model is given names, never ids (rule 19): a recipe is picked by its
// name, and its page link searches the Recipes page for that name.

import { z } from 'zod'
import { withTenant } from '../../config/db.js'
import { callApi, requireStaffPermission, ToolError } from '../context.js'
import { VenueText, venueFor, tenantVenueList, pickByName, plural, audited } from './util.js'
import { fmtNum, UNITS } from '../../../../shared/procurement.js'
import { pounds, perWord, perBaseText, BASIS_KEYS, COVERAGE, BANDS, sameScope, toBase, inRecipeUnit, YIELD_UNITS, readLineKept } from '../../../../shared/costing.js'
import { moveWords, dayWords } from '../../../../shared/priceCreep.js'
import { matchIndex, matchThing, normName } from '../../../../shared/itemMatch.js'
import { averageText } from '../../../../shared/engineering.js'

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
    'at a venue and order type, worst cost % first, with the dishes that can\'t be costed yet and how to fix each), ' +
    'why_cost_changed (a dish\'s cost now against a date: which ingredients\' supplier prices moved and by how much, and ' +
    'the dishes a price change took over their cost target, the price creep alerts).',
  'Getting recipes in: read_recipes (recipes from photos, a PDF or a CSV attached in the chat, or pasted text, made as ' +
    'drafts once the person confirms), make_recipe (a draft recipe from their description), link_recipes (dishes linked ' +
    'to recipes for every venue, or at a venue, revenue stream or order type), recipe_coverage (how much of what sold ' +
    'can be costed, and the dishes to cost first).',
  'Menu engineering and what-ifs: menu_engineering (each section\'s dishes from what sold as stars, plough-horses, ' +
    'puzzles and dogs, with GP per unit and what to do with each), save_scenario (price or cost changes on a menu with ' +
    'the cost % and GP at what really sold before and after, saved for the Scenarios tab; pushing prices into a menu and ' +
    'publishing are the person\'s steps on the pages).',
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
async function scopeFor(ctx, input, { onlyVenue = true } = {}) {
  const venues = await tenantVenueList(ctx)
  // A group with one venue costs at it when none is named; a link names the venue only when asked (else every venue).
  const venue = input.venue ? await venueFor(ctx, input.venue) : onlyVenue && venues.length === 1 ? venues[0] : null
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
  const where = [type ? type.name : null, stream ? stream.name + ' (' + venue.name + ')' : venue ? venue.name : onlyVenue ? 'the group\'s own prices' : 'every venue'].filter(Boolean).join(' at ')
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
      // Found by name through a route that takes Recipes or Costing view, as the cost route does.
      const list = await callApi(ctx, 'GET', '/api/recipe-links/names')
      const menu = input.menu ? pickByName(list.menus, input.menu, m => m.name, 'menu', 'No menus yet.') : null
      const rows = menu ? list.dishes.filter(d => d.menu_id === menu.id) : list.dishes
      const dish = pickByName(rows, input.dish, d => d.name, 'dish', 'No dishes on the menus yet.')
      const { scope, where } = await scopeFor(ctx, input)
      const q = new URLSearchParams({ ...scope, version: input.draft ? 'draft' : 'live' })
      if (input.options?.length) {
        const picks = input.options.map(o => {
          const hit = pickByName(dish.options, o.option, x => x.label, 'option of ' + dish.name, dish.name + ' has no options.')
          return { option_id: hit.option_id, ...(o.prefix ? { prefix: o.prefix } : {}) }
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

// ── Getting recipes in (phase 3) ─────────────────────────────

const MAX_CARD = 40
const unitText = (qty, unit) => fmtNum(qty) + ' ' + (UNITS[unit]?.label ?? unit)
const kindText = r => (r.kind === 'prep'
  ? 'prep' + (r.yield_qty && r.yield_unit ? ', makes ' + unitText(r.yield_qty, r.yield_unit) : ', what it makes not read')
  : 'dish, ' + plural(Number(r.portions || 1), 'portion'))
const DRAFT_NOTE = 'Each is a draft: it shows as partly costed (not checked yet) until someone checks it on the Recipes page and makes it live.'

/** Files attached in this chat by this person, by name ('all' or none named: every one), as the reader takes them. */
async function chatFiles(ctx, names) {
  if (ctx.channel !== 'staff_chat' || !ctx.conversationId) {
    throw new ToolError('Attached files can only be read in the chat. Paste the recipes as text instead.', 422)
  }
  const files = await withTenant(ctx.tenantId, tx => tx`
    SELECT id, filename, kind, data FROM ai_attachments
     WHERE tenant_id = ${ctx.tenantId} AND conversation_id = ${ctx.conversationId} AND user_sub = ${ctx.principal?.sub ?? ''}
     ORDER BY created_at`)
  if (!files.length) throw new ToolError('No files are attached in this chat. Attach the recipes (photos, a PDF or a CSV) or paste them.', 404)
  const picked = names?.length ? names.map(n => pickByName(files, n, f => f.filename, 'attached file')) : files
  const out = { files: [], text: [] }
  for (const f of picked) {
    if (f.kind === 'text') out.text.push(Buffer.from(f.data).toString('utf8'))
    else out.files.push({ name: f.filename, data: Buffer.from(f.data).toString('base64') })
  }
  return out
}

/** The reading as POST /api/recipes/drafts takes it: matched lines with a quantity are lines, the rest kept in the notes. */
export function draftsFromReading(read) {
  const key = i => 'r' + (i + 1)
  return {
    source: 'reader',
    recipes: read.recipes.map((r, i) => {
      // The review's own rule (readLineKept() in shared/costing.js): matched, with a quantity, a recipe of this reading only if it is a prep.
      const ok = l => readLineKept(l, l.match.kind === 'new' ? read.recipes[l.match.new_idx] ?? null : null)
      return {
        key: key(i), name: r.name, kind: r.kind, category: r.category, code: r.code,
        portions: r.kind === 'dish' ? r.portions || 1 : null,
        yield_qty: r.kind === 'prep' && r.yield_unit ? r.yield_qty : null, yield_unit: r.kind === 'prep' && r.yield_qty ? r.yield_unit : null,
        loss_pct: r.kind === 'prep' ? r.loss_pct || 0 : 0, method: r.method, notes: r.notes,
        lines: r.lines.filter(ok).map(l => ({
          ...(l.match.kind === 'item' ? { item_id: l.match.item_id } : l.match.kind === 'recipe' ? { sub_recipe_id: l.match.sub_recipe_id } : { new_key: key(l.match.new_idx) }),
          qty: l.qty, unit: l.unit, note: l.note,
        })),
        left_out: r.lines.filter(l => !ok(l)).map(l => l.words),
      }
    }),
  }
}

/** What read_recipes will make, in words: the card's lines and warnings. */
function readingCard(read) {
  const lines = []
  const warnings = []
  for (const r of read.recipes.slice(0, MAX_CARD)) {
    const ok = r.lines.filter(l => l.match.state === 'matched' && l.qty > 0)
    const rest = r.lines.filter(l => !ok.includes(l))
    lines.push(r.name + ' (' + kindText(r) + '): ' + ok.map(l => unitText(l.qty, l.unit) + ' ' + l.match.name).join(', ') + (ok.length ? '' : 'no lines matched'))
    if (rest.length) {
      lines.push('  not matched, kept in its notes: ' + rest.map(l => l.words + (l.match.state === 'suggested' ? ' (maybe ' + l.match.name + ')' : l.qty == null ? ' (no quantity)' : '')).join('; '))
    }
    for (const l of ok) if (l.unit_problem) warnings.push(r.name + ': ' + l.unit_problem + ' (the line shows as a gap until it has one)')
    if (r.existing) warnings.push('A recipe called ' + r.existing.name + ' is already on the Recipes page: this makes another one.')
  }
  if (read.recipes.length > MAX_CARD) lines.push('and ' + plural(read.recipes.length - MAX_CARD, 'more recipe'))
  if (read.notes) warnings.push(read.notes)
  return { lines, warnings }
}

const ReadPin = z.object({ source: z.literal('reader'), recipes: z.array(z.any()).min(1).max(50) })

async function readPlan(ctx, input) {
  if (!input.attached_files?.length && !input.text?.trim() && input.from_chat !== true) {
    throw new ToolError('Say which attached file to read (attached_files) or pass the recipes as text.', 422)
  }
  const got = input.attached_files?.length || input.from_chat ? await chatFiles(ctx, input.attached_files) : { files: [], text: [] }
  const text = [...got.text, input.text || ''].filter(t => t.trim()).join('\n\n').slice(0, 60000)
  const read = await callApi(ctx, 'POST', '/api/ai/recipes/read', { body: { files: got.files, text, hint: input.hint || '' } })
  return { read, body: draftsFromReading(read) }
}

// An ingredient named by the model: an inventory item or a prep recipe, by its exact name, else a sure match by name or code.
function findThing(name, pickers) {
  const items = (pickers.items || []).filter(i => i.is_active !== false)
  const preps = (pickers.recipes || []).filter(r => r.is_active !== false)
  const want = normName(name)
  const exact = [...items.map(i => ({ kind: 'item', thing: i })), ...preps.map(r => ({ kind: 'recipe', thing: r }))].filter(x => normName(x.thing.name) === want)
  if (exact.length === 1) return exact[0]
  const idx = matchIndex({ dishes: [...items.map(i => ({ id: 'i:' + i.id, name: i.name, sku: i.code || null, kind: 'item' })), ...preps.map(r => ({ id: 'r:' + r.id, name: r.name, kind: 'item' }))] })
  const hit = matchThing({ kind: 'item', name, sku: null }, idx)
  if (!hit.auto) return null
  const id = hit.best.target.item_id
  return id.startsWith('i:') ? { kind: 'item', thing: items.find(i => i.id === id.slice(2)) } : { kind: 'recipe', thing: preps.find(r => r.id === id.slice(2)) }
}

async function makePlan(ctx, input) {
  const pickers = await callApi(ctx, 'GET', '/api/recipes/pickers')
  const kind = input.kind || 'dish'
  if (kind === 'prep' && input.makes_unit && !YIELD_UNITS.includes(input.makes_unit)) throw new ToolError('A prep recipe is made in ' + YIELD_UNITS.join(', ') + '.', 422)
  const lines = []
  const leftOut = []
  const shown = []
  const warnings = []
  for (const l of input.lines) {
    const unit = String(l.unit || 'each').trim().toLowerCase() === 'each' ? 'each' : String(l.unit).trim()
    const words = unitText(l.qty, unit) + ' ' + l.ingredient + (l.note ? ', ' + l.note : '')
    const hit = findThing(l.ingredient, pickers)
    if (!hit) {
      leftOut.push(words)
      shown.push('not found, kept in the notes: ' + words)
      continue
    }
    const problem = hit.kind === 'item' ? toBase(l.qty, unit, hit.thing).problem : inRecipeUnit(l.qty, unit, { kind: 'prep', ...hit.thing }).problem
    if (problem) warnings.push(problem + ' (the line shows as a gap until it has one)')
    lines.push({ ...(hit.kind === 'item' ? { item_id: hit.thing.id } : { sub_recipe_id: hit.thing.id }), qty: l.qty, unit, note: l.note || null })
    shown.push(unitText(l.qty, unit) + ' ' + hit.thing.name + (hit.kind === 'recipe' ? ' (prep recipe)' : '') + (l.note ? ', ' + l.note : ''))
  }
  const recipe = {
    key: 'r1', name: input.name, kind, category: input.category || null, code: null,
    portions: kind === 'dish' ? input.portions || 1 : null,
    yield_qty: kind === 'prep' && input.makes_qty && input.makes_unit ? input.makes_qty : null,
    yield_unit: kind === 'prep' && input.makes_qty && input.makes_unit ? input.makes_unit : null,
    loss_pct: kind === 'prep' ? input.loss_pct || 0 : 0, method: input.method || null, notes: input.notes || null,
    lines, left_out: leftOut,
  }
  if ((pickers.dishes || []).concat(pickers.recipes || []).some(r => normName(r.name) === normName(input.name))) {
    warnings.push('A recipe called ' + input.name + ' is already on the Recipes page: this makes another one.')
  }
  return { body: { source: 'pepper', recipes: [recipe] }, shown, warnings, recipe }
}

/** Each link asked for, found by name: the dish, the recipe, the cell in words and what it holds now. */
async function linkPlan(ctx, input) {
  const [names, pickers] = await Promise.all([callApi(ctx, 'GET', '/api/recipe-links/names'), callApi(ctx, 'GET', '/api/recipes/pickers')])
  const recipes = (pickers.dishes || []).filter(r => r.is_active !== false)
  const out = []
  for (const l of input.links) {
    const menu = l.menu ? pickByName(names.menus, l.menu, m => m.name, 'menu', 'No menus yet.') : null
    const dish = pickByName(menu ? names.dishes.filter(d => d.menu_id === menu.id) : names.dishes, l.dish, d => d.name, 'dish', 'No dishes on the menus yet.')
    const recipe = pickByName(recipes, l.recipe, r => r.name, 'dish recipe', 'No dish recipes yet: make one with make_recipe or on the Recipes page.')
    const { scope, where } = await scopeFor(ctx, l, { onlyVenue: false })
    if (out.some(x => x.dish.id === dish.id && sameScope(x.scope, scope))) throw new ToolError(dish.name + ' is asked twice for ' + where + '.', 422)
    const m = await callApi(ctx, 'GET', '/api/recipe-links/dishes/' + dish.id)
    if (m.dish.kind === 'deal' || m.dish.kind === 'service') throw new ToolError(dish.name + (m.dish.kind === 'deal' ? ' is a meal deal: it costs the dishes picked in it, so it has no recipe.' : ' is a service: it has no recipe.'), 422)
    const set = m.links.find(x => sameScope(x, scope))
    const cell = Object.values(m.cells).find(c => sameScope(c.scope, scope))
    out.push({
      dish, recipe, scope, where, portions: l.portions ?? 1,
      before: set ? { recipe_id: set.recipe_id, recipe_name: set.recipe_name, portions: set.portions } : null,
      inherited: !set && cell?.recipe ? cell.recipe.name + ' (from ' + (cell.from_name || 'another cell') + ')' : null,
    })
  }
  return out
}

const RecipeText = z.string().trim().min(1).max(200)

export const changeTools = [
  {
    name: 'read_recipes',
    class: 'consequential',
    title: 'Read recipes in',
    activity: 'Read the recipes',
    section: 'recipes',
    description:
      'Reads recipes from files attached in this chat (photos of recipe cards, a PDF, a CSV) and / or text the person ' +
      'pasted: each recipe\'s name, dish or prep, what it makes, its lines matched to the group\'s inventory items and prep ' +
      'recipes, and its method. The card shows what was read; confirming makes them as DRAFT recipes, never live: a person ' +
      'checks each on the Recipes page and makes it live, and until then it shows as partly costed. Lines that match ' +
      'nothing are kept in each draft\'s notes. attached_files: the files\' names as attached (leave out with from_chat ' +
      'true for every file attached); text: recipes typed or pasted in the chat, as they were written.',
    input: z.object({
      attached_files: z.array(z.string().trim().min(1).max(200)).max(10).optional().describe('Names of files attached in this chat'),
      from_chat: z.boolean().optional().describe('true: read every file attached in this chat'),
      text: z.string().max(60000).optional().describe('The recipes as the person wrote or pasted them'),
      hint: z.string().max(500).optional().describe('Anything to know: "quantities are for 10 portions"'),
      read: ReadPin.optional().describe('Never set: the card pins what was read'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      // The card always shows a fresh reading; Confirm makes exactly the pinned one.
      const { read, body } = await readPlan(ctx, input)
      const card = readingCard(read)
      return {
        title: 'Make ' + plural(read.recipes.length, 'draft recipe') + ' from what was read?',
        lines: [...card.lines, DRAFT_NOTE],
        ...(card.warnings.length ? { warningTitle: 'Check', warnings: card.warnings } : {}),
        confirmLabel: 'Make drafts',
        pin: { read: body },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      const body = input.read || (await readPlan(ctx, input)).body
      return audited(ctx, 'read_recipes', { attached_files: input.attached_files, text: input.text ? input.text.slice(0, 200) : undefined, recipes: body.recipes.length }, async () => {
        const r = await callApi(ctx, 'POST', '/api/recipes/drafts', { body })
        return {
          made: r.made.map(m => m.name + (m.kind === 'prep' ? ' (prep)' : '')),
          message: 'Made ' + plural(r.made.length, 'draft recipe') + '. ' + DRAFT_NOTE,
          page: '/recipes',
        }
      })
    },
  },

  {
    name: 'make_recipe',
    class: 'consequential',
    title: 'Make a recipe',
    activity: 'Wrote a draft recipe',
    section: 'recipes',
    description:
      'Makes a DRAFT recipe from the person\'s description: its name, dish (costed per portion) or prep (a batch used ' +
      'inside other recipes, with what it makes: makes_qty and makes_unit g, kg, ml, cl, l, each or portion), and its ' +
      'lines, each an ingredient named as the inventory item or prep recipe it is, with a quantity and unit. An ' +
      'ingredient that matches none is kept in its notes, never guessed. Shown on a card first; a person checks the ' +
      'draft on the Recipes page and makes it live. To link it to a menu dish afterwards, use link_recipes.',
    input: z.object({
      name: RecipeText,
      kind: z.enum(['dish', 'prep']).optional().describe('dish (default) or prep'),
      portions: z.number().positive().max(1000).optional().describe('A dish: how many portions it makes (default 1)'),
      makes_qty: z.number().positive().max(100000).optional().describe('A prep recipe: how much it makes'),
      makes_unit: z.string().trim().max(30).optional().describe('A prep recipe: g, kg, ml, cl, l, each or portion'),
      loss_pct: z.number().min(0).max(99).optional().describe('A prep recipe: what cooking loses, in %'),
      category: z.string().trim().max(100).optional(),
      method: z.string().max(20000).optional(),
      notes: z.string().max(1500).optional(),
      lines: z.array(z.object({
        ingredient: z.string().trim().min(1).max(200).describe('The inventory item or prep recipe, by name'),
        qty: z.number().positive().max(10000000),
        unit: z.string().trim().min(1).max(30).describe('g, kg, ml, l, each, or the item\'s own unit (slice, tbsp)'),
        note: z.string().trim().max(300).optional(),
      })).min(1).max(60),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      const p = await makePlan(ctx, input)
      return {
        title: 'Make the draft recipe ' + input.name + '?',
        lines: [input.name + ' (' + kindText({ ...p.recipe, yield_qty: p.recipe.yield_qty }) + ')', ...p.shown, ...(input.method ? ['Method: ' + input.method.slice(0, 200) + (input.method.length > 200 ? '...' : '')] : []), DRAFT_NOTE],
        ...(p.warnings.length ? { warningTitle: 'Check', warnings: p.warnings } : {}),
        confirmLabel: 'Make draft',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      const p = await makePlan(ctx, input)
      return audited(ctx, 'make_recipe', input, async () => {
        const r = await callApi(ctx, 'POST', '/api/recipes/drafts', { body: p.body })
        return {
          made: r.made[0].name, lines: p.recipe.lines.length, ...(p.recipe.left_out.length ? { kept_in_notes: p.recipe.left_out } : {}),
          message: 'Made ' + r.made[0].name + ' as a draft. It shows as partly costed until someone checks it on the Recipes page and makes it live.',
          page: '/recipes?q=' + encodeURIComponent(r.made[0].name),
        }
      })
    },
  },

  {
    name: 'link_recipes',
    class: 'reversible',
    title: 'Link dishes to recipes',
    activity: 'Linked dishes to recipes',
    section: 'recipes',
    description:
      'Links menu dishes to dish recipes by name: which recipe (and how many portions of it) a dish uses for every venue, ' +
      'or at a venue, a revenue stream at a venue, an order type (takeaway, delivery) or a mix: a cell of the dish\'s ' +
      'variation matrix on the Recipes page. Leave venue, stream and order_type out for every venue. A closer cell beats ' +
      'every venue. The card shows what each cell holds now and what it becomes; Undo puts each back.',
    input: z.object({
      links: z.array(z.object({
        dish: z.string().trim().min(1).max(200).describe('The dish\'s name on the menu'),
        menu: z.string().trim().max(120).optional().describe('The menu, when two menus have a dish of that name'),
        recipe: RecipeText.describe('The dish recipe\'s name'),
        venue: VenueText.describe('A venue; leave out for every venue'),
        stream: StreamText.describe('A revenue stream at that venue'),
        order_type: TypeText.describe('An order type: eat in, take out, delivery...'),
        portions: z.number().positive().max(1000).optional().describe('Portions of the recipe one sale uses (default 1)'),
      })).min(1).max(30),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      const plan = await linkPlan(ctx, input)
      return {
        title: 'Link ' + plural(plan.length, 'dish', 'dishes') + ' to recipes?',
        lines: plan.map(p => p.dish.name + ', ' + p.where + ': ' + p.recipe.name + (Number(p.portions) !== 1 ? ' x ' + fmtNum(p.portions) : '')
          + (p.before ? ' (was ' + p.before.recipe_name + (Number(p.before.portions) !== 1 ? ' x ' + fmtNum(p.before.portions) : '') + ')'
            : p.inherited ? ' (now ' + p.inherited + ')' : ' (no recipe there now)')),
        confirmLabel: 'Link',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      const plan = await linkPlan(ctx, input)
      return audited(ctx, 'link_recipes', input, async () => {
        const done = []
        const undo = []
        for (const p of plan) {
          await callApi(ctx, 'PUT', '/api/recipe-links/dishes/' + p.dish.id + '/cell', { body: { ...p.scope, recipe_id: p.recipe.id, portions: p.portions } })
          done.push(p.dish.name + ', ' + p.where + ': ' + p.recipe.name)
          undo.push({ dish_id: p.dish.id, dish: p.dish.name, scope: p.scope, before: p.before ? { recipe_id: p.before.recipe_id, portions: p.before.portions } : null })
        }
        return { linked: done, message: 'Linked. Costs and margins follow at once.', page: '/recipes?tab=dishes', _undo: { links: undo } }
      })
    },
    // Undo: each cell back to the recipe it had, or cleared where it had none.
    async inverse(ctx, undo) {
      await requireStaffPermission(ctx, 'recipes', 'manage')
      const back = []
      for (const u of undo.links || []) {
        if (u.before) {
          await callApi(ctx, 'PUT', '/api/recipe-links/dishes/' + u.dish_id + '/cell', { body: { ...u.scope, ...u.before } })
        } else {
          const m = await callApi(ctx, 'GET', '/api/recipe-links/dishes/' + u.dish_id)
          const set = m.links.find(x => sameScope(x, u.scope))
          if (set) await callApi(ctx, 'DELETE', '/api/recipe-links/links/' + set.id)
        }
        back.push(u.dish)
      }
      return { message: 'Put back: ' + back.join(', ') + '.' }
    },
  },

  {
    name: 'recipe_coverage',
    activity: 'Looked at how much of what sold is costed',
    section: 'recipes',
    title: 'Coverage by sales',
    description:
      'How much of what was sold in the last days (30 unless asked) can be costed, at a venue or every venue: the share ' +
      'of sales costed, by till, kiosk, online and other tills (test till sales left out), and the dishes that can\'t be ' +
      'costed yet, most sold first, each with how to fix it (link a recipe, finish the recipe, add an option rule, map ' +
      'another till\'s item). Sales in pounds only for people who see till reports.',
    input: z.object({
      venue: VenueText.describe('A venue; leave out for every venue'),
      days: z.number().int().min(1).max(365).optional(),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'recipes', 'view')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      const q = new URLSearchParams({ ...(venue ? { venue_id: venue.id } : {}), ...(input.days ? { days: String(input.days) } : {}) })
      const c = await callApi(ctx, 'GET', '/api/recipes/coverage' + (q.toString() ? '?' + q.toString() : ''))
      const pct = p => (p == null ? 'nothing sold' : fmtNum(p, 1) + '%')
      if (!c.sold) return { where: venue ? venue.name : 'every venue', message: 'Nothing was sold in the last ' + plural(c.days, 'day') + ' (test till sales are left out).', page: '/recipes' }
      return {
        where: venue ? venue.name : 'every venue', days: c.days, costed: pct(c.percent) + ' of sales',
        ...(c.can.money ? { sales: money(c.total_pence - c.left_out_pence), costed_sales: money(c.costed_pence) } : {}),
        by_channel: Object.fromEntries(Object.entries(c.channels).map(([k, v]) => [k, pct(v.percent)])),
        not_costed: c.dishes.slice(0, MAX_LIST).map(d => ({
          dish: d.name, ...(c.can.money ? { sales: money(d.sales_pence) } : { share_of_sales: d.share_pct + '%' }), sold: fmtNum(d.qty),
          ...(d.where.length === 1 ? { at: d.where[0] } : {}), fix: d.fixes.slice(0, 3).map(f => f.text),
        })),
        ...(c.dishes.length > MAX_LIST ? { more: c.dishes.length - MAX_LIST + ' more on the page' } : {}),
        ...(c.left_out.length ? { left_out: c.left_out.slice(0, 10).map(l => l.name + ': ' + l.why) } : {}),
        page: '/recipes',
      }
    },
  },
]

// ── Menu engineering and scenarios (phase 7a) ────────────────

const CLASS_PLURAL = { star: 'stars', plough_horse: 'plough_horses', puzzle: 'puzzles', dog: 'dogs' }
const NO_AVERAGE = 'not costed: none of the section\'s units could be costed'
const AUTO_DEALS_NOTE = 'When the till, a kiosk or online ordering finds one of these deals among dishes rung up one by one, it is a discount '
  + 'over those dishes: they count in their own sections at what they took after the saving, and the deal has no units for them. '
  + 'Only a deal rung up from its own button counts as a deal.'
const MAX_SECTIONS = 8
const MAX_DISHES = 30
const qtyWords = n => fmtNum(n, Number.isInteger(n) ? 0 : 1)

const ChangeIn = z.object({
  what: z.enum(['price', 'cost']).describe('price (the menu price, VAT included) or cost (what one costs)'),
  dish: z.string().trim().max(200).optional().describe('The dish it is for, by name; leave dish and section out for every dish'),
  section: z.string().trim().max(120).optional().describe('The menu section it is for, by name'),
  how: z.enum(['percent', 'amount', 'set']).describe('percent (5 = up 5%, -10 = down 10%), amount (pounds added, -0.25 takes 25p off) or set (pounds)'),
  value: z.number().min(-1000).max(10000),
  round_to: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]).optional().describe('A price change: round new prices to 1, 5, 10, 50 or 100 pence'),
  round: z.enum(['up', 'nearest', 'down']).optional(),
})

/**
 * The venue, stream and order type of a scenario changed in place: what the
 * person named, else what the saved one has (a venue named without a stream
 * leaves the saved stream only when it is that venue's).
 */
async function savedScope(ctx, input, saved) {
  const venue = input.venue ? await venueFor(ctx, input.venue) : null
  const venueId = venue ? venue.id : saved.venue_id
  let streamId = venue && venue.id !== saved.venue_id ? null : saved.revenue_stream_id
  let typeId = saved.order_type_id
  if (input.stream || input.order_type) {
    const tax = await callApi(ctx, 'GET', '/api/tax-rates')
    if (input.stream) {
      if (!venueId) throw new ToolError('Which venue is ' + input.stream + ' at?', 422)
      const at = venue?.name || (await tenantVenueList(ctx)).find(v => v.id === venueId)?.name || 'that venue'
      streamId = pickByName((tax.streams || []).filter(x => x.venue_id === venueId && x.is_active), input.stream, x => x.name, 'revenue stream at ' + at, at + ' has no revenue streams.').id
    }
    if (input.order_type) typeId = pickByName((tax.order_types || []).filter(t => t.is_active), input.order_type, t => t.name, 'order type').id
  }
  return { venue_id: venueId || null, revenue_stream_id: streamId || null, order_type_id: typeId || null }
}

const noteWords = n => (n == null || n === '' ? 'none' : n.length > 80 ? n.slice(0, 77) + '...' : n)

/**
 * A scenario's body from names: the menu, the scope and each change's dish
 * or section, found by name (rule 19: names, never ids). With replace and a
 * saved scenario of that name on the menu, the body starts from the saved
 * one (rule 13: a whole save sends every field back) and takes only what the
 * person named: the changes, and the venue, stream, order type, days or notes
 * when given; `changed` says in words what else will change.
 */
async function scenarioPlan(ctx, input) {
  const choices = await callApi(ctx, 'GET', '/api/menu-margins')
  const menu = pickByName(choices.choices.menus, input.menu, m => m.name, 'menu', 'No menus yet.')
  // The scenario of that name on this menu, changed when the person asks for it to be.
  const list = await callApi(ctx, 'GET', '/api/cost-scenarios')
  const same = list.scenarios.find(x => x.menu_id === menu.id && x.name.trim().toLowerCase() === input.name.trim().toLowerCase()) || null
  const was = input.replace && same ? await callApi(ctx, 'GET', '/api/cost-scenarios/' + same.id) : null
  const saved = was?.scenario || null
  let base
  if (saved) {
    base = {
      name: saved.name, menu_id: menu.id, ...(await savedScope(ctx, input, saved)),
      mix_days: input.days || saved.mix_days, notes: input.notes !== undefined ? input.notes || null : saved.notes ?? null,
    }
  } else {
    const { scope } = await scopeFor(ctx, input, { onlyVenue: false })
    base = {
      name: input.name, menu_id: menu.id, venue_id: scope.venue_id || null, revenue_stream_id: scope.revenue_stream_id || null,
      order_type_id: scope.order_type_id || null, mix_days: input.days || 28, notes: input.notes || null,
    }
  }
  // The draft's sections and dishes, from the scenario's own read (Costing view, like the tool).
  const blank = await callApi(ctx, 'POST', '/api/cost-scenarios/preview', { body: { ...base, changes: [] } })
  const sections = blank.figures.sections.map(x => ({ id: x.section_id, name: x.section || '' }))
  const dishes = blank.figures.dishes.map(d => ({ id: d.dish_id, name: d.name }))
  const changes = input.changes.map(c => {
    if (c.dish && c.section) throw new ToolError('A change is for a dish or a section, not both: ' + c.dish + ' or ' + c.section + '?', 422)
    const dish = c.dish ? pickByName(dishes, c.dish, d => d.name, 'dish on ' + menu.name, menu.name + ' has no dishes.') : null
    const section = c.section ? pickByName(sections, c.section, x => x.name, 'section of ' + menu.name, menu.name + ' has no sections.') : null
    return {
      what: c.what, applies: dish ? 'dish' : section ? 'section' : 'all', section_id: section?.id ?? null, dish_id: dish?.id ?? null,
      how: c.how, value: c.value,
      round_to: c.what === 'price' && c.how !== 'set' ? (c.round_to ?? 1) : null, round: c.what === 'price' && c.how !== 'set' ? (c.round ?? 'nearest') : null,
    }
  })
  const body = { ...base, changes }
  const fig = await callApi(ctx, 'POST', '/api/cost-scenarios/preview', { body })
  // What a change in place does besides the changes, said on the card.
  const changed = []
  if (saved) {
    changed.push('Its ' + plural((saved.changes || []).length, 'change') + ' replaced by ' + (changes.length === 1 ? 'this one' : 'these ' + changes.length))
    if (base.venue_id !== saved.venue_id || base.revenue_stream_id !== saved.revenue_stream_id || base.order_type_id !== saved.order_type_id) {
      changed.push('Where: ' + was.where + ' to ' + fig.where)
    }
    if (base.mix_days !== saved.mix_days) changed.push('The mix: the last ' + plural(saved.mix_days, 'day') + ' to the last ' + plural(base.mix_days, 'day'))
    if ((base.notes ?? null) !== (saved.notes ?? null)) changed.push('Notes: ' + noteWords(saved.notes) + ' to ' + noteWords(base.notes))
  }
  return { menu, where: fig.where, body, fig, same, saved, changed }
}

/** A scenario's figures in words for a card or an answer (sales at the mix only when the route gave them). */
function scenarioWords(fig) {
  const t = fig.figures.total
  const out = ['Cost % at what sold (' + fig.mix.from + ' to ' + fig.mix.to + '): ' + (pct(t.before.cost_pct) || 'no costed sales') + ' to ' + (pct(t.after.cost_pct) || '-')]
  if (fig.sees_sales && t.before.gp_pence != null) out.push('Gross profit at the mix: ' + money(t.before.gp_pence) + ' to ' + money(t.after.gp_pence) + ' (' + (t.change.gp_pence >= 0 ? '+' : '') + money(t.change.gp_pence) + ')')
  if (t.left_out_units > 0) out.push(qtyWords(t.left_out_units) + ' units of dishes with no cost are left out of both sides')
  return out
}

export const engineeringTools = [
  {
    name: 'menu_engineering',
    activity: 'Looked at menu engineering',
    section: 'recipes',
    modules: ['costing'],
    title: 'Menu engineering',
    description:
      'Menu engineering from what really sold (Kasavana and Smith), from the Menu margins page\'s Engineering tab: each ' +
      'menu section\'s dishes as stars (sell well and earn at least the section\'s average gross profit per unit), ' +
      'plough-horses (sell well, earn less), puzzles (earn more, sell little) and dogs (neither), with units, share of the ' +
      'section\'s units, GP per unit, total GP and cost %, and what to do with each class. Popular is a share of at least 70% ' +
      'of an equal share. A meal deal rung up as a deal is one dish of its own section; an automatic deal the till found ' +
      'among dishes rung up one by one is a discount over them (they count in their own sections at what they took). ' +
      'At a venue or every venue, one menu or all, a section ' +
      'or all, over the last days (28 unless asked). GP and the classes need till reports view as well as Costing view.',
    input: z.object({
      menu: z.string().trim().max(120).optional().describe('A menu, by name; leave out for every menu'),
      section: z.string().trim().max(120).optional().describe('One section, by name'),
      venue: VenueText.describe('A venue; leave out for every venue'),
      days: z.number().int().min(1).max(93).optional().describe('The last days up to yesterday (28 unless asked)'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'costing', 'view')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      let menu = null
      if (input.menu) {
        const choices = await callApi(ctx, 'GET', '/api/menu-margins')
        menu = pickByName(choices.choices.menus, input.menu, m => m.name, 'menu', 'No menus yet.')
      }
      const q = new URLSearchParams({ ...(venue ? { venue_id: venue.id } : {}), ...(menu ? { menu_id: menu.id } : {}), days: String(input.days || 28) })
      const e = await callApi(ctx, 'GET', '/api/menu-margins/engineering?' + q.toString())
      const where = venue ? venue.name : 'every venue'
      if (!e.sections.length) return { where, days: e.from + ' to ' + e.to, message: 'Nothing sold was worked out for these days' + (menu ? ' on ' + menu.name : '') + '.', page: '/menu-margins?tab=engineering' }
      let sections = e.sections
      if (input.section) {
        const hit = pickByName(sections, input.section, s => s.section || '', 'section that sold', 'Nothing sold in any section.')
        sections = [hit]
      }
      const out = sections.slice(0, MAX_SECTIONS).map(s => {
        const row = {
          section: s.section, ...(s.menu ? { menu: s.menu } : {}), dishes_sold: s.dish_count, units: qtyWords(s.units),
          popular_from: pct(s.popular_pct) + ' of the section\'s units',
        }
        if (e.sees_sales) {
          // An average none of whose units could be costed is a gap, never £0.00.
          row.average_gp_per_unit = averageText(s, money, NO_AVERAGE)
          for (const [k, plural] of Object.entries(CLASS_PLURAL)) row[plural] = s.dishes.filter(d => d.class === k).map(d => d.name)
          const none = s.dishes.filter(d => d.class == null).map(d => d.name)
          if (none.length) row.not_costed = none
        }
        row.dishes = s.dishes.slice(0, MAX_DISHES).map(d => ({
          dish: d.name, ...(d.kind === 'deal' ? { meal_deal: true } : {}), units: qtyWords(d.units), share: pct(d.share_pct), popular: d.popular,
          ...(e.sees_sales ? {
            class: d.class ? e.classes[d.class].label : 'not costed',
            gp_per_unit: d.gp_per_unit_pence == null ? null : money(Math.round(d.gp_per_unit_pence)),
            total_gp: money(d.gp_pence), cost_pct: pct(d.cost_pct),
          } : {}),
          ...(d.uncosted_units > 0 ? { units_left_out_of_gp: qtyWords(d.uncosted_units) } : {}),
        }))
        if (s.dishes.length > MAX_DISHES) row.more = s.dishes.length - MAX_DISHES + ' more on the page'
        return row
      })
      return {
        where, ...(menu ? { menu: menu.name } : {}), days: e.from + ' to ' + e.to, sections: out,
        ...(sections.length > MAX_SECTIONS ? { more_sections: sections.length - MAX_SECTIONS + ' more on the page' } : {}),
        ...(e.auto_deals?.length ? {
          automatic_deals: e.auto_deals.map(d => d.name + (menu ? '' : ' (' + d.menu + ')')),
          automatic_deals_note: AUTO_DEALS_NOTE,
        } : {}),
        ...(e.sees_sales
          ? { what_to_do: Object.fromEntries(Object.entries(CLASS_PLURAL).map(([k, plural]) => [plural, e.classes[k].suggestion])) }
          : { note: 'GP, cost % and the classes come from what the till took: they need till reports view as well, so only units and shares are here.' }),
        page: '/menu-margins?tab=engineering',
      }
    },
  },

  {
    name: 'save_scenario',
    class: 'consequential',
    title: 'Save a cost scenario',
    activity: 'Saved a cost scenario',
    section: 'recipes',
    modules: ['costing'],
    description:
      'Saves a what-if on a menu (the Menu margins page\'s Scenarios tab): price or cost changes, each by a percentage or ' +
      'a figure, or set, for a dish, a section or every dish, in order, at a venue (and revenue stream) and order type, ' +
      'and shows the cost % and gross profit at what really sold before and after. Nothing on the menu changes: pushing a ' +
      'scenario\'s prices into the menu\'s draft is done on the page (it needs Menus manage), and publishing after that. ' +
      'replace: true changes the scenario of the same name on that menu instead of saving another: its changes become ' +
      'these, and its venue, stream, order type, days and notes stay as saved unless given here. Costing manage.',
    input: z.object({
      name: z.string().trim().min(1).max(120),
      menu: z.string().trim().min(1).max(120).describe('The menu, by name'),
      venue: VenueText.describe('The venue whose prices and sales to use; leave out for the group\'s prices and every venue\'s sales'),
      stream: StreamText.describe('A revenue stream at that venue'),
      order_type: TypeText.describe('The order type (its VAT and its sales): eat in, take out...'),
      days: z.number().int().min(1).max(93).optional().describe('The mix: units sold over the last days up to yesterday (28 unless asked)'),
      changes: z.array(ChangeIn).min(1).max(20),
      notes: z.string().trim().max(1000).optional(),
      replace: z.boolean().optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'costing', 'manage')
      const p = await scenarioPlan(ctx, input)
      const skipped = [...new Set(p.fig.figures.dishes.flatMap(d => d.skipped || []))]
      return {
        title: (p.saved ? 'Change' : 'Save') + ' the scenario ' + (p.saved ? p.saved.name : input.name) + ' on ' + p.menu.name + '?',
        lines: [p.where + ', the menu\'s draft', ...p.changed, ...p.fig.words, ...scenarioWords(p.fig)],
        ...(skipped.length || (p.same && !input.replace)
          ? { warningTitle: 'Check', warnings: [...skipped, ...(p.same && !input.replace ? ['A scenario called ' + p.same.name + ' is saved already: this saves another (replace changes it)'] : [])] }
          : {}),
        confirmLabel: p.saved ? 'Change it' : 'Save',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'costing', 'manage')
      const p = await scenarioPlan(ctx, input)
      return audited(ctx, 'save_scenario', { name: input.name, menu: input.menu, changes: input.changes.length }, async () => {
        // A change in place sends the whole saved scenario back, with only what was named changed (rule 13).
        if (p.saved) await callApi(ctx, 'PUT', '/api/cost-scenarios/' + p.saved.id, { body: p.body })
        else await callApi(ctx, 'POST', '/api/cost-scenarios', { body: p.body })
        return {
          saved: input.name, menu: p.menu.name, where: p.where, changes: p.fig.words, figures: scenarioWords(p.fig),
          message: 'Saved. Nothing on the menu has changed: push its prices into the menu\'s draft from the Scenarios tab, then publish the menu, when you want them.',
          page: '/menu-margins?tab=scenarios',
        }
      })
    },
  },
]

// ── Price creep (phase 7b) ───────────────────────────────────

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const signed = p => (p == null ? null : (p < 0 ? '-' : '+') + pounds(Math.abs(p)))

/** One item's move for the answer: "Chicken thighs: £6.00 a kg to £6.72 a kg (up 12%), +£0.36 a serving (Brakes, Bag 1 kg)". */
function moveText(m, prices) {
  const was = m.before == null ? 'no price' : perBaseText(m.before, m.base_unit)
  const now = m.after == null ? 'no price' : perBaseText(m.after, m.base_unit)
  const q = prices && m.quote_after ? ' (' + [m.quote_after.supplier, m.quote_after.pack].filter(Boolean).join(', ') + ')' : ''
  return m.name + ': ' + was + ' to ' + now + (m.pct != null ? ' (' + (m.pct >= 0 ? 'up ' : 'down ') + Math.abs(m.pct) + '%)' : '') +
    (m.effect != null ? ', ' + signed(m.effect) + ' a serving' : '') + q
}

export const creepTools = [
  {
    name: 'why_cost_changed',
    activity: 'Looked at why a dish\'s cost changed',
    section: 'recipes',
    modules: ['costing'],
    title: 'Why a dish\'s cost changed',
    description:
      'A dish on a live menu: what one serving costs now against what the same recipe cost at the start of a day (30 ' +
      'days ago unless a day is given), from the supplier price history, which ingredients\' prices moved and by how much ' +
      'and what each did to a serving, its cost % then and now at today\'s menu price against the targets, the recipes ' +
      'changed since (recipes keep no history, so only prices are compared, on today\'s recipe), and the price creep ' +
      'alerts recorded for it since (a price change that took it over its cost target or limit). Costing view; supplier ' +
      'names and packs need purchasing prices too.',
    input: z.object({
      dish: z.string().trim().min(1).max(200).describe('The dish\'s name on the menu'),
      menu: z.string().trim().max(120).optional().describe('The menu, when dishes on two menus share the name'),
      venue: VenueText.describe('The venue; leave out for the group\'s own prices'),
      order_type: TypeText.describe('The order type for the cost %: eat in, take out...'),
      since: Day.optional().describe('The day to compare with, YYYY-MM-DD (30 days ago unless asked)'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'costing', 'view')
      const list = await callApi(ctx, 'GET', '/api/recipe-links/names')
      const menu = input.menu ? pickByName(list.menus, input.menu, m => m.name, 'menu', 'No menus yet.') : null
      const rows = menu ? list.dishes.filter(d => d.menu_id === menu.id) : list.dishes
      const dish = pickByName(rows, input.dish, d => d.name, 'dish', 'No dishes on the menus yet.')
      const { scope, where } = await scopeFor(ctx, input)
      const q = new URLSearchParams({ dish_id: dish.id, ...(scope.venue_id ? { venue_id: scope.venue_id } : {}), ...(scope.order_type_id ? { order_type_id: scope.order_type_id } : {}) })
      if (input.since) q.set('since', input.since)
      const r = await callApi(ctx, 'GET', '/api/cost-alerts/why?' + q.toString())
      const moved = r.items.filter(m => m.before != null || m.after != null)
      const out = {
        dish: r.dish.name, menu: r.dish.menu, where: where + (r.order_type ? ' (' + r.order_type.name + ')' : ''),
        since: 'the start of ' + dayWords(r.since) + ' ' + r.since.slice(0, 4),
        cost_then: r.cost_then == null ? 'not costed' : pounds(r.cost_then) + ' a serving',
        cost_now: r.cost_now == null ? 'not costed' : pounds(r.cost_now) + ' a serving',
        ...(r.change != null ? { change: signed(r.change) + (r.change_pct != null ? ' (' + (r.change_pct >= 0 ? 'up ' : 'down ') + Math.abs(r.change_pct) + '%)' : '') } : {}),
        ...(r.cost_pct_then != null || r.cost_pct_now != null ? {
          cost_pct: (pct(r.cost_pct_then) || 'none') + ' then, ' + (pct(r.cost_pct_now) || 'none') + ' now, at today\'s menu price' +
            ' (target ' + pct(r.thresholds?.target_pct) + ', limit ' + pct(r.thresholds?.limit_pct) + ')',
        } : {}),
        moved: moved.length ? moved.map(m => moveText(m, r.sees_prices)) : ['No ingredient\'s supplier price moved since then.'],
        ...(r.no_history?.length ? { no_price_history_then: r.no_history.join(', ') + ': no price recorded before then, so taken as today\'s' } : {}),
        ...(r.recipes_changed?.length ? { recipes_changed_since: r.recipes_changed.map(x => x.name).join(', ') + ' (recipes keep no history: this compares prices only, on today\'s recipe)' } : {}),
        ...(r.uncosted?.length ? { not_costed: r.uncosted.map(g => g.text) } : {}),
        ...(r.alerts?.length ? {
          price_creep_alerts: r.alerts.map(a => dayWords(a.day) + ': crossed ' + pct(a.threshold_pct) + ' at ' + a.venue + ' (' +
            (pct(a.old_cost_pct) || 'not costed') + ' to ' + pct(a.new_cost_pct) + '): ' + a.cause + (a.seen_by ? ', seen by ' + a.seen_by : '')),
        } : {}),
        page: '/menu-margins?alerts=1',
      }
      if (moved.length) out.summary = moved.slice(0, 2).map(moveWords).join(', ')
      return out
    },
  },
]

// What Pepper is told about this file's tools, gathered by tools/index.js.
export const tools = [...recipeTools, ...marginTools, ...changeTools, ...engineeringTools, ...creepTools]
