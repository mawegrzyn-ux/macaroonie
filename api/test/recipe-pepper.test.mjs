// Pepper's recipe change tools through the chat (inventory phase 3), against
// a stand-in Claude: read_recipes (from pasted text and from a file attached
// in the chat: a card showing what was read, the reading pinned so Confirm
// makes exactly that without asking the model again, drafts only),
// make_recipe (a draft from a description, an ingredient that matches
// nothing kept in its notes), link_recipes (by name, at a venue and at an
// order type; the card says what each cell holds now; Undo puts it back),
// recipe_coverage (names, never ids), and the refusals (no Recipes manage).
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A } = await import('./support/seed.mjs')
const { audienceTools } = await import('../src/ai/tools/index.js')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const COOK = 'a-pep-cook'
let ids, owner, cook, soho, takeOut, beef, mayo, burger, burgerToGo, dishId

const text = s => [{ type: 'text', text: s }]
const answer = obj => ({ stop_reason: 'end_turn', content: text(JSON.stringify(obj)) })
const sentLists = body => { const t = body.messages[0].content.at(-1).text; return JSON.parse(t.slice(t.indexOf('{'))) }
const refOf = (list, name) => list.find(x => x.name === name)?.ref

/** One tool call through the chat (the tool's own model calls answered by `readers`): { card, result, error }. */
async function call(who, tool, input, readers = []) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_r' + Math.random().toString(36).slice(2, 10), name: tool, input }] }),
    ...readers,
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  const r = await ok(who.post('/api/ai/chat', { message: 'go' }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  const sent = claude.requests.at(-1).body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result').at(-1)
  return { card, result: sent?.content?.[0]?.text ?? '', error: !!sent?.is_error, conversation: r.conversation_id }
}
const confirm = id => ok(owner.post(`/api/ai/actions/${id}/confirm`, {}))

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  const role = await ok(owner.post('/api/access/roles', { key: 'pepcook', label: 'Cook', permissions: { recipes: 'view', ai_assistant: 'view' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${COOK + '@test.local'}, 'operator', ${COOK}, ${role.id})`
  cook = as(COOK, ids.a)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-pep', timezone: 'Europe/London', currency: 'GBP' }))).id
  await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-pep', timezone: 'Europe/London', currency: 'GBP' }))
  takeOut = (await ok(owner.get('/api/tax-rates'))).order_types.find(t => t.name === 'Take out').id
  beef = await ok(owner.post('/api/inventory/items', { name: 'Beef patty', base_unit: 'each' }))
  mayo = await ok(owner.post('/api/inventory/items', { name: 'Mayonnaise', base_unit: 'ml' }))
  burger = await ok(owner.post('/api/recipes', { name: 'Burger', kind: 'dish', status: 'live', lines: [{ item_id: beef.id, qty: 1, unit: 'each' }] }))
  burgerToGo = await ok(owner.post(`/api/recipes/${burger.id}/copy`, { name: 'Burger to go', variant: true }))
  const m = await ok(owner.post('/api/menus', { name: 'Lunch', slug: 'lunch-pep' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [{ title: 'Mains', items: [{ name: 'Smash burger', price_pence: 1100, is_orderable: true, variant_groups: [], variants: [] }] }] }))
  dishId = (await ok(owner.get('/api/menus/' + m.id))).sections[0].items[0].id
})
test.after(async () => { await claude.close(); await closeApp() })

test('the tools: classes, Activity words and their place in the registry', async () => {
  const tools = Object.fromEntries(audienceTools('staff').map(t => [t.name, t]))
  assert.equal(tools.read_recipes.class, 'consequential')
  assert.equal(tools.make_recipe.class, 'consequential')
  assert.equal(tools.link_recipes.class, 'reversible')
  assert.equal(typeof tools.link_recipes.inverse, 'function')
  assert.equal(tools.recipe_coverage.class, 'read')
  const { ACTION_LABELS } = await import('../../shared/pepperActions.js')
  for (const n of ['read_recipes', 'make_recipe', 'link_recipes']) assert.ok(ACTION_LABELS[n], n + ' has Activity words')
  const { objects } = await import('../../shared/registry/recipes.js')
  assert.deepEqual(objects.find(o => o.key === 'recipes.recipes').actions, ['read_recipes', 'make_recipe'])
  assert.deepEqual(objects.find(o => o.key === 'recipes.links').actions, ['link_recipes'])
})

test('read_recipes from pasted text: a card of what was read, drafts only on Confirm, no second reading', async () => {
  const reader = body => {
    const { inventory_items: items } = sentLists(body)
    return answer({ recipes: [{
      name: 'Burger sauce', kind: 'prep', category: '', code: '', portions: '', yield_qty: '1', yield_unit: 'l', loss_pct: '', method: 'Mix.', notes: '',
      lines: [
        { words: '600 ml mayonnaise', ref: refOf(items, 'Mayonnaise'), what: 'mayonnaise', code: '', qty: '600', unit: 'ml', note: '' },
        { words: '1 tbsp yuzu kosho', ref: '', what: 'yuzu kosho', code: '', qty: '1', unit: 'tbsp', note: '' },
      ],
    }], notes: '' })
  }
  const { card, conversation } = await call(owner, 'read_recipes', { text: 'Burger sauce\n600 ml mayonnaise\n1 tbsp yuzu kosho' }, [reader])
  assert.ok(card, 'a card to confirm')
  assert.match(card.title, /Make 1 draft recipe/)
  assert.ok(card.lines.some(l => /Burger sauce \(prep, makes 1 l\): 600 ml Mayonnaise/.test(l)))
  assert.ok(card.lines.some(l => /not matched, kept in its notes: 1 tbsp yuzu kosho/.test(l)))
  assert.ok(card.lines.some(l => /partly costed \(not checked yet\)/.test(l)))
  assert.equal((await sql`SELECT 1 FROM recipes WHERE tenant_id = ${ids.a} AND name = 'Burger sauce'`).length, 0, 'nothing made before Confirm')
  const before = claude.requests.length
  await confirm(card.id)
  assert.equal(claude.requests.length, before, 'Confirm makes the pinned reading: no second model call')
  const [r] = await sql`SELECT id, status, source, notes FROM recipes WHERE tenant_id = ${ids.a} AND name = 'Burger sauce'`
  assert.deepEqual([r.status, r.source], ['draft', 'reader'])
  assert.match(r.notes, /yuzu kosho/)
  const [{ tool, ok: done }] = await sql`SELECT tool, ok FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'read_recipes' ORDER BY created_at DESC LIMIT 1`
  assert.deepEqual([tool, done], ['read_recipes', true])
  assert.ok(conversation)
})

test('read_recipes from a file attached in the chat', async () => {
  // A CSV attached in this chat by this person: the reader gets it as text.
  const [conv] = await sql`INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt)
    VALUES (${ids.a}, 'staff_chat', ${A.owner}, ${A.owner + '@test.local'}, 'test') RETURNING id`
  await sql`INSERT INTO ai_attachments (tenant_id, user_sub, conversation_id, kind, media_type, filename, bytes, data)
    VALUES (${ids.a}, ${A.owner}, ${conv.id}, 'text', 'text/csv', 'recipes.csv', 40, ${Buffer.from('Recipe,Ingredient,Qty\nBeef stack,Beef patty,2\n')})`
  const reader = body => {
    const { inventory_items: items } = sentLists(body)
    assert.match(body.messages[0].content[0].text, /Beef stack,Beef patty,2/)
    return answer({ recipes: [{ name: 'Beef stack', kind: 'dish', category: '', code: '', portions: '1', yield_qty: '', yield_unit: '', loss_pct: '', method: '', notes: '',
      lines: [{ words: '2 beef patty', ref: refOf(items, 'Beef patty'), what: 'beef patty', code: '', qty: '2', unit: 'each', note: '' }] }], notes: '' })
  }
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_att', name: 'read_recipes', input: { attached_files: ['recipes.csv'] } }] }),
    reader,
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'read these', conversation_id: conv.id }))
  const card = r.items.find(i => i.type === 'action' && i.status === 'pending')
  assert.ok(card, JSON.stringify(r.items.filter(i => i.type !== 'assistant')))
  assert.ok(card.lines.some(l => /Beef stack \(dish, 1 portion\): 2 each Beef patty/.test(l)))
  await confirm(card.id)
  assert.equal((await sql`SELECT 1 FROM recipes WHERE tenant_id = ${ids.a} AND name = 'Beef stack' AND status = 'draft' AND source = 'reader'`).length, 1)
  // Another person's file in the chat is never read.
  await sql`INSERT INTO ai_attachments (tenant_id, user_sub, conversation_id, kind, media_type, filename, bytes, data)
    VALUES (${ids.a}, ${COOK}, ${conv.id}, 'text', 'text/csv', 'theirs.csv', 5, ${Buffer.from('x,y\n')})`
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_att2', name: 'read_recipes', input: { attached_files: ['theirs.csv'] } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  const r2 = await ok(owner.post('/api/ai/chat', { message: 'and theirs', conversation_id: conv.id }))
  assert.ok(!r2.items.some(i => i.type === 'action' && i.status === 'pending'))
  const sent = claude.requests.at(-1).body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result').at(-1)
  assert.match(sent.content[0].text, /No attached file called "theirs.csv"/)
})

test('make_recipe: a draft from a description; an ingredient that matches nothing is kept in its notes', async () => {
  const { card } = await call(owner, 'make_recipe', {
    name: 'Double smash', kind: 'dish', portions: 1, method: 'Smash two patties.',
    lines: [{ ingredient: 'beef patty', qty: 2, unit: 'each' }, { ingredient: 'mayonnaise', qty: 20, unit: 'ml' }, { ingredient: 'unicorn dust', qty: 1, unit: 'pinch' }],
  })
  assert.ok(card.lines.some(l => l === '2 each Beef patty'))
  assert.ok(card.lines.some(l => /not found, kept in the notes: 1 pinch unicorn dust/.test(l)))
  await confirm(card.id)
  const [r] = await sql`SELECT id, status, source, notes, method FROM recipes WHERE tenant_id = ${ids.a} AND name = 'Double smash'`
  assert.deepEqual([r.status, r.source, r.method], ['draft', 'pepper', 'Smash two patties.'])
  assert.match(r.notes, /unicorn dust/)
  const lines = await sql`SELECT item_id, qty::float8 AS qty, unit FROM recipe_lines WHERE recipe_id = ${r.id} ORDER BY sort_order`
  assert.deepEqual(lines.map(l => [l.item_id, l.qty, l.unit]), [[beef.id, 2, 'each'], [mayo.id, 20, 'ml']])
})

test('link_recipes at a venue and at an order type: the card says what each cell holds; Undo puts it back', async () => {
  await ok(owner.put(`/api/recipe-links/dishes/${dishId}/cell`, { recipe_id: burger.id }))
  const { card } = await call(owner, 'link_recipes', { links: [
    { dish: 'Smash burger', recipe: 'Burger to go', order_type: 'take out' },
    { dish: 'Smash burger', recipe: 'Burger', venue: 'Soho', portions: 2 },
  ] })
  assert.match(card.title, /Link 2 dishes to recipes/)
  assert.deepEqual(card.lines, [
    'Smash burger, Take out at every venue: Burger to go (now Burger (from Every venue, any order type))',
    'Smash burger, Soho: Burger x 2 (now Burger (from Every venue, any order type))',
  ])
  assert.doesNotMatch(card.title + JSON.stringify(card.lines), UUID, 'the card names things, never ids')
  const done = await confirm(card.id)
  const links = await sql`SELECT recipe_id, venue_id, order_type_id, portions::float8 AS portions FROM recipe_links WHERE dish_id = ${dishId} ORDER BY created_at`
  assert.deepEqual(links.map(l => [l.recipe_id, l.venue_id, l.order_type_id, l.portions]), [
    [burger.id, null, null, 1], [burgerToGo.id, null, takeOut, 1], [burger.id, soho, null, 2],
  ])
  const takeaway = await ok(owner.get(`/api/recipe-links/dishes/${dishId}/cost?order_type_id=${takeOut}`))
  assert.equal(takeaway.recipe.name, 'Burger to go')
  // Undo: both cells cleared (they had nothing of their own), the default kept.
  const action = done.items?.find(i => i.type === 'action' && i.id === card.id) || card
  const undo = await owner.post(`/api/ai/actions/${action.id}/undo`, {})
  assert.equal(undo.status, 200, JSON.stringify(undo.json))
  const after = await sql`SELECT recipe_id, venue_id, order_type_id FROM recipe_links WHERE dish_id = ${dishId}`
  assert.deepEqual(after.map(l => [l.recipe_id, l.venue_id, l.order_type_id]), [[burger.id, null, null]])
  // A cell that had its own recipe gets it back.
  await ok(owner.put(`/api/recipe-links/dishes/${dishId}/cell`, { recipe_id: burgerToGo.id, venue_id: soho }))
  const second = await call(owner, 'link_recipes', { links: [{ dish: 'Smash burger', recipe: 'Burger', venue: 'Soho' }] })
  assert.deepEqual(second.card.lines, ['Smash burger, Soho: Burger (was Burger to go)'])
  await confirm(second.card.id)
  await ok(owner.post(`/api/ai/actions/${second.card.id}/undo`, {}))
  const [back] = await sql`SELECT recipe_id FROM recipe_links WHERE dish_id = ${dishId} AND venue_id = ${soho}`
  assert.equal(back.recipe_id, burgerToGo.id)
})

test('refusals: no Recipes manage, a recipe that is no dish recipe; coverage read in names only', async () => {
  const noCard = await call(cook, 'make_recipe', { name: 'Sneaky', lines: [{ ingredient: 'beef patty', qty: 1, unit: 'each' }] })
  assert.ok(!noCard.card, 'no card for a cook without Recipes manage')
  assert.ok(noCard.error)
  assert.match(noCard.result, /permission|manage|can't/i)
  const prep = await call(owner, 'link_recipes', { links: [{ dish: 'Smash burger', recipe: 'Burger sauce' }] })
  assert.ok(!prep.card)
  assert.match(prep.result, /No dish recipe called/)
  const cov = await call(owner, 'recipe_coverage', {})
  assert.doesNotMatch(cov.result, UUID)
  assert.match(cov.result, /Nothing was sold|costed/)
})
