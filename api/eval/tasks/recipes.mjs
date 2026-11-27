// Recipes and costing (inventory phases 1 to 3): finding recipes, one
// recipe, what a dish costs, a menu's margins, linking a dish to a recipe at
// a venue and at an order type, a draft recipe made from a description, a
// recipe read in from pasted text, and costs asked by someone without
// Costing view. The fixtures (support/fixtures/recipes.mjs) give "Oak
// Cheddar" (a supplier price, a slice of 20 g), the prep "Oak Cheese sauce",
// the dish recipe "Oak Toastie" and its variation "Oak Toastie to take
// away", and link the menu's "Oak Pad Thai" to the Toastie for every venue
// and to the variation at Oak Ware.

const dishOf = ctx => ctx.sql`SELECT id FROM menu_items WHERE tenant_id = ${ctx.tenantId} AND name = 'Oak Pad Thai' ORDER BY created_at LIMIT 1`
const recipeNamed = (ctx, name) => ctx.sql`SELECT id, kind, status, source, notes, yield_qty::float8 AS yield_qty, yield_unit FROM recipes WHERE tenant_id = ${ctx.tenantId} AND name = ${name}`
const linesOf = (ctx, id) => ctx.sql`
  SELECT i.name AS item, l.qty::float8 AS qty, l.unit FROM recipe_lines l LEFT JOIN inv_items i ON i.id = l.item_id
   WHERE l.tenant_id = ${ctx.tenantId} AND l.recipe_id = ${id} ORDER BY l.sort_order`
const okCalls = (chat, name) => chat.calls.filter(c => c.name === name && c.result && !c.result.error)
/** A dish recipe of the group, with one line of the fixtures' cheddar. */
async function dishRecipe(ctx, name) {
  const [cheddar] = await ctx.sql`SELECT id FROM inv_items WHERE tenant_id = ${ctx.tenantId} AND name = 'Oak Cheddar'`
  const r = await ctx.owner.post('/api/recipes', { name, kind: 'dish', status: 'live', lines: [{ item_id: cheddar.id, qty: 60, unit: 'g' }] })
  if (r.status !== 201) throw new Error('making ' + name + ': ' + r.status)
  return r.json
}
/** The model's reading of the rarebit, with the cheddar's ref off the list it was sent. */
function rarebit(body) {
  const t = body.messages[0].content.at(-1).text
  const items = JSON.parse(t.slice(t.indexOf('{'))).inventory_items || []
  const ref = items.find(x => x.name === 'Oak Cheddar')?.ref || ''
  const line = (words, what, qty, unit, r = '') => ({ words, ref: r, what, code: '', qty, unit, note: '' })
  return {
    recipes: [{
      name: 'Oak Welsh rarebit', kind: 'dish', category: '', code: '', portions: '2', yield_qty: '', yield_unit: '', loss_pct: '', method: 'Melt, spread, grill.', notes: '',
      lines: [line('200 g Oak Cheddar', 'Oak Cheddar', '200', 'g', ref), line('2 slices sourdough', 'sourdough', '2', 'slice'), line('1 tsp mustard', 'mustard', '1', 'tsp')],
    }],
    notes: '',
  }
}

export const tasks = [
  {
    id: 'recipes_find',
    area: 'recipes',
    why: 'The everyday question on the Recipes page: which recipes there are for a dish, read by find_recipes (phase 1).',
    say: () => 'Which toastie recipes do we have?',
    expect: 'answer',
    async check(ctx, chat) {
      const found = okCalls(chat, 'find_recipes').flatMap(c => (c.result.recipes || []).map(r => r.name))
      if (!found.length) return 'find_recipes found nothing'
      return found.includes('Oak Toastie') && found.includes('Oak Toastie to take away') ? true : 'found ' + JSON.stringify(found)
    },
    reference: () => [{ tool: 'find_recipes', input: { words: 'toastie' } }],
  },
  {
    id: 'recipe_lines',
    area: 'recipes',
    why: 'A cook asks what goes into a dish: the recipe tool, by name, with its lines (phase 1).',
    say: () => 'What goes into the Oak Toastie?',
    expect: 'answer',
    async check(ctx, chat) {
      const r = okCalls(chat, 'recipe').find(c => c.result.name === 'Oak Toastie')
      if (!r) return 'the recipe tool didn\'t read the Oak Toastie'
      const what = (r.result.lines || []).map(l => l.what)
      return what.includes('Oak Cheddar') && what.includes('Oak Cheese sauce') ? true : 'its lines were ' + JSON.stringify(what)
    },
    reference: () => [{ tool: 'recipe', input: { recipe: 'Oak Toastie' } }],
  },
  {
    id: 'dish_cost_at_venue',
    area: 'recipes',
    why: 'What a dish costs at a venue picks the recipe its links give there: Oak Hertford has no link of its own, so the Toastie for every venue (phase 2).',
    say: ctx => 'What does the Oak Pad Thai cost to make at ' + ctx.venue2.name + '?',
    expect: 'answer',
    async check(ctx, chat) {
      const c = okCalls(chat, 'dish_cost').find(x => x.result.dish === 'Oak Pad Thai')
      if (!c) return 'dish_cost didn\'t cost the Oak Pad Thai'
      if (c.result.recipe !== 'Oak Toastie') return 'it used ' + c.result.recipe + ' at ' + c.result.where
      return /^£\d/.test(c.result.cost || '') ? true : 'no cost: ' + c.result.cost
    },
    reference: ctx => [{ tool: 'dish_cost', input: { dish: 'Oak Pad Thai', venue: ctx.venue2.name } }],
  },
  {
    id: 'menu_margins_at_venue',
    area: 'recipes',
    why: 'The margins of a whole menu at a venue, worst cost % first (phase 2, the Menu margins page).',
    say: ctx => 'How are the margins on the Oak Lunch menu at ' + ctx.venue.name + '?',
    expect: 'answer',
    async check(ctx, chat) {
      const c = okCalls(chat, 'menu_margins').find(x => x.result.menu === 'Oak Lunch')
      if (!c) return 'menu_margins didn\'t read the Oak Lunch menu'
      return c.result.counts?.dishes >= 1 ? true : 'no dishes: ' + JSON.stringify(c.result.counts)
    },
    reference: ctx => [{ tool: 'menu_margins', input: { menu: 'Oak Lunch', venue: ctx.venue.name } }],
  },
  {
    id: 'link_recipe_at_venue',
    area: 'recipes',
    why: 'The owner\'s ask: a venue can use its own recipe for a dish (the variation matrix, phase 2); Pepper sets the cell by name (phase 3).',
    async setup(ctx) { ctx.made.recipe = await dishRecipe(ctx, 'Oak Pad Thai Hertford') },
    say: ctx => 'At ' + ctx.venue2.name + ', make the Oak Pad Thai use the Oak Pad Thai Hertford recipe.',
    expect: 'change',
    async check(ctx) {
      const [dish] = await dishOf(ctx)
      const [l] = await ctx.sql`SELECT recipe_id, order_type_id, revenue_stream_id FROM recipe_links WHERE tenant_id = ${ctx.tenantId} AND dish_id = ${dish.id} AND venue_id = ${ctx.venue2.id}`
      if (!l) return 'no link for the Oak Pad Thai at ' + ctx.venue2.name
      if (l.recipe_id !== ctx.made.recipe.id) return 'it links another recipe there'
      return !l.order_type_id && !l.revenue_stream_id ? true : 'the link is for an order type or a stream too'
    },
    reference: ctx => [{ tool: 'link_recipes', input: { links: [{ dish: 'Oak Pad Thai', recipe: 'Oak Pad Thai Hertford', venue: ctx.venue2.name }] } }],
  },
  {
    id: 'link_recipe_for_takeaway',
    area: 'recipes',
    why: 'The owner\'s ask: a recipe per order type (a takeaway version), at every venue; the takeaway cell, not the dish\'s own recipe (phase 3).',
    async setup(ctx) {
      ctx.made.recipe = await dishRecipe(ctx, 'Oak Pad Thai to go')
      ;[ctx.made.type] = await ctx.sql`SELECT id FROM order_types WHERE tenant_id = ${ctx.tenantId} AND name = 'Take out'`
    },
    say: () => 'When the Oak Pad Thai is sold as take out, at every venue, use the Oak Pad Thai to go recipe.',
    expect: 'change',
    async check(ctx) {
      const [dish] = await dishOf(ctx)
      const links = await ctx.sql`SELECT recipe_id, venue_id, order_type_id FROM recipe_links WHERE tenant_id = ${ctx.tenantId} AND dish_id = ${dish.id} AND recipe_id = ${ctx.made.recipe.id}`
      if (!links.length) return 'nothing links the Oak Pad Thai to go'
      const [l] = links
      if (l.order_type_id !== ctx.made.type?.id) return 'it isn\'t for take out'
      if (l.venue_id) return 'it is for one venue only'
      const [def] = await ctx.sql`SELECT r.name FROM recipe_links l JOIN recipes r ON r.id = l.recipe_id WHERE l.tenant_id = ${ctx.tenantId} AND l.dish_id = ${dish.id} AND l.venue_id IS NULL AND l.order_type_id IS NULL AND l.revenue_stream_id IS NULL`
      return def?.name === 'Oak Toastie' ? true : 'the dish\'s own recipe changed to ' + def?.name
    },
    reference: () => [{ tool: 'link_recipes', input: { links: [{ dish: 'Oak Pad Thai', recipe: 'Oak Pad Thai to go', order_type: 'Take out' }] } }],
  },
  {
    id: 'make_prep_recipe',
    area: 'recipes',
    why: 'Recipes come in by Pepper writing what the kitchen says (docs/INVENTORY.md 5.6): a draft, never live, with what matches nothing kept, never guessed.',
    say: () => 'Make a prep recipe called Oak Garlic butter that makes 500 g, with 400 g of Oak Cheddar and 100 g of wild garlic.',
    expect: 'change',
    async check(ctx) {
      const [r] = await recipeNamed(ctx, 'Oak Garlic butter')
      if (!r) return 'no recipe called Oak Garlic butter'
      if (r.status !== 'draft' || r.source !== 'pepper') return 'it is ' + r.status + ' from ' + r.source + ', not a draft Pepper wrote'
      if (r.kind !== 'prep' || r.yield_qty !== 500 || r.yield_unit !== 'g') return 'it is a ' + r.kind + ' making ' + r.yield_qty + ' ' + r.yield_unit
      const lines = await linesOf(ctx, r.id)
      if (!lines.some(l => l.item === 'Oak Cheddar' && l.qty === 400 && l.unit === 'g')) return 'its lines: ' + JSON.stringify(lines)
      return /garlic/i.test(r.notes || '') ? true : 'the wild garlic (no such item) wasn\'t kept in its notes'
    },
    reference: () => [{ tool: 'make_recipe', input: {
      name: 'Oak Garlic butter', kind: 'prep', makes_qty: 500, makes_unit: 'g',
      lines: [{ ingredient: 'Oak Cheddar', qty: 400, unit: 'g' }, { ingredient: 'wild garlic', qty: 100, unit: 'g' }],
    } }],
  },
  {
    id: 'read_recipe_text',
    area: 'recipes',
    why: 'Phase 3\'s reader from pasted text: refs mapped back to the item, lines that match nothing kept in the notes, a draft until a person checks it (the live check before the pull request, lesson of 24 Nov 2026).',
    say: () => 'Read this recipe in:\nOak Welsh rarebit (serves 2)\n200 g Oak Cheddar\n2 slices sourdough\n1 tsp mustard\nMelt, spread, grill.',
    expect: 'change',
    async check(ctx) {
      const [r] = await recipeNamed(ctx, 'Oak Welsh rarebit')
      if (!r) return 'no draft called Oak Welsh rarebit'
      if (r.status !== 'draft' || r.source !== 'reader') return 'it is ' + r.status + ' from ' + r.source + ', not a draft that was read in'
      const lines = await linesOf(ctx, r.id)
      if (!lines.some(l => l.item === 'Oak Cheddar' && l.qty === 200)) return 'the cheddar line is missing: ' + JSON.stringify(lines)
      return /sourdough/.test(r.notes || '') ? true : 'the sourdough (no such item) wasn\'t kept in its notes'
    },
    reference: () => [{ tool: 'read_recipes', input: { text: 'Oak Welsh rarebit (serves 2)\n200 g Oak Cheddar\n2 slices sourdough\n1 tsp mustard\nMelt, spread, grill.' } }],
    readers: () => [rarebit],
  },
  {
    id: 'costs_without_costing',
    area: 'recipes',
    as: 'operator',
    why: 'An operator reads recipes but has no Costing view (decision D7: a cost tells what suppliers charge): Pepper may say what goes in, never what it costs.',
    say: () => 'How much does the Oak Toastie cost per portion?',
    expect: 'answer',
    async check(ctx, chat) {
      const read = chat.calls.filter(c => ['recipe', 'find_recipes', 'dish_cost', 'menu_margins'].includes(c.name))
      if (!read.length) return 'nothing was read'
      const money = read.filter(c => /£\d/.test(JSON.stringify(c.result || {})))
      if (money.length) return 'a cost reached someone without Costing view: ' + money.map(c => c.name).join(', ')
      return read.some(c => /Costing view/.test(JSON.stringify(c.result || {}))) ? true : 'nothing said costs need Costing view'
    },
    reference: () => [{ tool: 'recipe', input: { recipe: 'Oak Toastie' } }],
  },
]
