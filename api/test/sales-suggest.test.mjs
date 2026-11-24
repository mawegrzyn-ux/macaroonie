// Sales from other tills, phase 3 (docs/SALES_IMPORT.md 4.3, 4.5): smart
// suggestions (codes before names), accepting them in bulk as exact rules,
// Pepper's proposals (the stand-in model: refs only, tenant text as data,
// at most four cache marks, a bad ref dropped), pattern rules and their
// order, the learning offer, Create missing dishes (dish, option group,
// per-dish prices, rules; the menu otherwise unchanged) and Copy from
// another venue (by name, what couldn't be matched reported); another
// tenant's ids refused; permissions.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startFakeLoyverse, TOKEN, ITEMS } from './support/fake-loyverse.mjs'
import { startFakeClaude } from './support/fake-claude.mjs'

// More items on the stand-in till for this file: a latte and a mocha with
// sizes, a tea whose code is our dish's, a cola, a brownie and muffins we
// don't have, and three bottled drinks.
const st1 = price => [{ store_id: 'st1', price, available_for_sale: true }]
const item = (id, name, cat, variants, axes = {}) => ({
  id, item_name: name, category_id: cat, updated_at: '2026-01-10T10:00:00Z', ...axes,
  variants: variants.map(v => ({ item_id: id, stores: st1(v.default_price), ...v })),
})
ITEMS.push(
  item('it-latte', 'Latte', 'cat-hot', [
    { variant_id: 'var-latte-r', sku: 'LAT-R', option1_value: 'Regular', default_price: 3.0 },
    { variant_id: 'var-latte-l', sku: 'LAT-L', option1_value: 'Large', default_price: 3.5 },
  ], { option1_name: 'Size' }),
  item('it-mocha', 'Mocha', 'cat-hot', [
    { variant_id: 'var-mocha-r', sku: 'MOC-R', option1_value: 'Regular', default_price: 3.2 },
    { variant_id: 'var-mocha-l', sku: 'MOC-L', option1_value: 'Large', default_price: 3.7 },
  ], { option1_name: 'Size' }),
  item('it-tea', 'Builders brew', 'cat-hot', [{ variant_id: 'var-tea', sku: 'T-01', default_price: 1.8 }]),
  item('it-cola', 'Coca Cola Can', 'cat-cold', [{ variant_id: 'var-cola', sku: 'CC-330', default_price: 1.5 }]),
  item('it-brownie', 'Brownie', 'cat-bake', [{ variant_id: 'var-brownie', sku: 'BRW', default_price: 2.75 }]),
  item('it-muffin', 'Muffin', 'cat-bake', [
    { variant_id: 'var-muffin-b', sku: 'MUF-B', option1_value: 'Blueberry', default_price: 2.4 },
    { variant_id: 'var-muffin-c', sku: 'MUF-C', option1_value: 'Chocolate', default_price: 2.6 },
  ], { option1_name: 'Flavour' }),
  item('it-btl-water', 'Bottle of water', 'cat-cold', [{ variant_id: 'var-btl-water', sku: 'BTL-WAT', default_price: 1.2 }]),
  item('it-btl-juice', 'Bottle of juice', 'cat-cold', [{ variant_id: 'var-btl-juice', sku: 'BTL-JUI', default_price: 1.9 }]),
)

const fake = await startFakeLoyverse()
const claude = await startFakeClaude()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { env } = await import('../src/config/env.js')
const { timing } = await import('../src/services/connectors/loyverse.js')
const svc = await import('../src/services/salesImportSvc.js')
const mapping = await import('../src/services/itemMappingSvc.js')
const { menuSaveBody } = await import('../src/routes/menus.js')

env.LOYVERSE_API_URL = fake.url
timing.paceMs = 0
timing.backoffMs = 1

let ids, owner, other, mapper, looker, V, V2, conn, MA, MB, our, theirs

const base = () => `/api/integrations/mapping/${conn.id}`
const rulesNow = () => sql`SELECT * FROM ext_map_rules WHERE connection_id = ${conn.id} ORDER BY created_at, id`
const menuOf = async (who, id) => ok(who.get(`/api/menus/${id}`))
const dishByName = (tree, name) => tree.sections.flatMap(s => s.items).find(i => i.name === name)

async function role(key, permissions) {
  const r = await ok(owner.post('/api/access/roles', { key, label: key, permissions }))
  const sub = 'a-' + key
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${r.id})`
  return as(sub, ids.a)
}

async function menuWith(name, slug, venueId, sections) {
  const m = await ok(owner.post('/api/menus', { name, slug, venue_id: venueId }))
  const full = await menuOf(owner, m.id)
  await ok(owner.patch(`/api/menus/${m.id}`, { ...full, sections }))
  return m.id
}

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  other = as(B.owner, ids.b)
  mapper = await role('mapper', { cash_recon: 'manage' })
  looker = await role('looker', { cash_recon: 'view' })
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Ware', slug: 'zqx-ware-ss', timezone: 'Europe/London' }))).id
  V2 = (await ok(owner.post('/api/venues', { name: 'Zqx Hertford', slug: 'zqx-hert-ss', timezone: 'Europe/London' }))).id

  const size = await ok(owner.post('/api/menus/variant-groups', { name: 'Size', options: [{ label: 'Regular', price_pence: 0 }, { label: 'Large', price_pence: 50 }] }))
  const milk = await ok(owner.post('/api/menus/variant-groups', { name: 'Milk', options: [{ label: 'Dairy', price_pence: 0 }, { label: 'Oat', price_pence: 40 }] }))
  const extras = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', options: [{ label: 'Extra shot', price_pence: 60 }] }))
  const g = (grp, label) => grp.options.find(o => o.label === label).id
  const coffee = (name, price) => ({ name, price_pence: price, is_orderable: true, variant_groups: [{ group_id: size.id }, { group_id: milk.id }, { group_id: extras.id }] })
  // Ware's own menu, and Hertford's (a latte but no mocha, no tea).
  MA = await menuWith('Ware cafe', 'ware-cafe-ss', V, [
    { title: 'Coffee', items: [coffee('Flat white', 300), coffee('Latte', 300), coffee('Mocha', 320),
      { name: 'Breakfast tea', price_pence: 180, is_orderable: true, sku: 'T-01' }] },
    { title: 'Cold drinks', items: [{ name: 'Cola', price_pence: 150, is_orderable: true }, { name: 'Water', price_pence: 120, is_orderable: true }] },
    { title: 'Bakery', items: [{ name: 'Croissant', price_pence: 250, is_orderable: true }] },
  ])
  MB = await menuWith('Hertford cafe', 'hert-cafe-ss', V2, [
    { title: 'Coffee', items: [coffee('Flat white', 310), coffee('Latte', 310)] },
    { title: 'Bakery', items: [{ name: 'Croissant', price_pence: 260, is_orderable: true }] },
  ])
  const a = await menuOf(owner, MA)
  const b = await menuOf(owner, MB)
  our = {
    size: size.id, milk: milk.id, extras: extras.id,
    regular: g(size, 'Regular'), large: g(size, 'Large'), dairy: g(milk, 'Dairy'), oat: g(milk, 'Oat'), shot: g(extras, 'Extra shot'),
    fw: dishByName(a, 'Flat white').id, latte: dishByName(a, 'Latte').id, mocha: dishByName(a, 'Mocha').id, tea: dishByName(a, 'Breakfast tea').id,
    cola: dishByName(a, 'Cola').id, water: dishByName(a, 'Water').id, croissant: dishByName(a, 'Croissant').id,
    fw2: dishByName(b, 'Flat white').id, latte2: dishByName(b, 'Latte').id, croissant2: dishByName(b, 'Croissant').id,
    bakery: a.sections.find(s => s.title === 'Bakery').id, bakery2: b.sections.find(s => s.title === 'Bakery').id,
  }
  const bm = await ok(other.post('/api/menus', { name: 'B menu', slug: 'b-menu-ss' }))
  const bfull = await ok(other.get(`/api/menus/${bm.id}`))
  await ok(other.patch(`/api/menus/${bm.id}`, { ...bfull, sections: [{ title: 'B', items: [{ name: 'B dish', price_pence: 100, is_orderable: true }] }] }))
  const bTree = await ok(other.get(`/api/menus/${bm.id}`))
  const bg = await ok(other.post('/api/menus/variant-groups', { name: 'B size', options: [{ label: 'B large', price_pence: 10 }] }))
  theirs = { menu: bm.id, dish: bTree.sections[0].items[0].id, section: bTree.sections[0].id, option: bg.options[0].id }

  conn = await ok(owner.post('/api/loyverse/connections', { name: 'Zqx Suggest', access_token: TOKEN }))
  await ok(owner.put(`/api/loyverse/venues/${V}/link`, { connection_id: conn.id, store_id: 'st1', day_starts_at: '04:00' }))
  await ok(owner.put(`/api/loyverse/venues/${V2}/link`, { connection_id: conn.id, store_id: 'st2', day_starts_at: '04:00' }))
  const r = await svc.syncConnection(ids.a, conn.id)
  assert.equal(r.error, undefined, r.error)
})
after(async () => { await closeApp(); await fake.close(); await claude.close?.() })

// ── 47.3a Suggestions ───────────────────────────────────────────────────────

test('suggestions: a code before a name; variants get our options; those at the threshold ticked; nothing saved', async () => {
  assert.equal((await owner.get(base() + '/suggestions')).status, 422, 'a venue is needed')
  const s = await ok(owner.get(base() + '/suggestions?venue_id=' + V))
  const by = key => s.suggestions.find(x => x.key === key)
  const tea = by('i:it-tea')
  assert.equal(tea.by, 'code', 'Builders brew has our tea\'s SKU: the code wins over any name')
  assert.equal(tea.rule.target_item_id, our.tea)
  assert.equal(tea.auto, true)
  const latteL = by('v:var-latte-l')
  assert.deepEqual([latteL.rule.target_item_id, latteL.rule.target_option_ids], [our.latte, [our.large]])
  assert.equal(latteL.rule.venue_id, V)
  assert.equal(latteL.auto, true)
  const fw = by('v:var-lrg-oat')
  assert.deepEqual(fw.rule.target_option_ids, [our.large, our.oat])
  assert.match(fw.reason, /Large → Size: Large/)
  const cola = by('i:it-cola')
  assert.equal(cola.rule.target_item_id, our.cola, '"Coca Cola Can" finds Cola')
  assert.equal(by('o:opt-shot').rule.target_option_ids[0], our.shot)
  assert.ok(s.unmatched.some(u => u.key === 'i:it-brownie'), 'no brownie on our menu')
  // Hertford's menu has no mocha: never suggested from Ware's menu.
  const s2 = await ok(owner.get(base() + '/suggestions?venue_id=' + V2))
  assert.ok(!s2.suggestions.some(x => x.rule.target_item_id === our.mocha))
  assert.equal((await rulesNow()).length, 0, 'suggesting writes nothing')
})

test('accepting in bulk makes exact rules through the rule checks; a bad one is refused alone', async () => {
  const s = await ok(owner.get(base() + '/suggestions?venue_id=' + V))
  const pick = keys => keys.map(k => s.suggestions.find(x => x.key === k).rule)
  const bad = { kind: 'exact', venue_id: V, item_ref: 'it-brownie', target_item_id: theirs.dish }
  const res = await ok(owner.post(base() + '/rules/bulk', { rules: [...pick(['i:it-tea', 'v:var-latte-l', 'v:var-mocha-l', 'v:var-lrg-oat']), bad] }))
  assert.equal(res.saved.length, 4)
  assert.deepEqual(res.failed.map(f => f.index), [4])
  assert.match(res.failed[0].error, /isn't on a menu this venue sells/)
  const rules = await rulesNow()
  assert.equal(rules.length, 4)
  assert.ok(rules.every(r => r.kind === 'exact' && r.venue_id === V))
  const [c] = await sql`SELECT remap_from FROM pos_connections WHERE id = ${conn.id}`
  assert.ok(c.remap_from, 'one re-map asked for')
  await mapping.remapConnection(ids.a, conn.id)
  // Accepted ones are no longer suggested.
  const again = await ok(owner.get(base() + '/suggestions?venue_id=' + V))
  assert.ok(!again.suggestions.some(x => x.key === 'i:it-tea'))
  // Another tenant can't save through this connection; View can't save.
  assert.equal((await other.post(base() + '/rules/bulk', { rules: [bad] })).status, 404)
  assert.equal((await looker.post(base() + '/rules/bulk', { rules: [bad] })).status, 403)
  assert.equal((await looker.get(base() + '/suggestions?venue_id=' + V)).status, 200, 'View sees suggestions')
  assert.equal((await other.get(base() + '/suggestions?venue_id=' + V)).status, 404)
})

// ── 47.3b Pepper ────────────────────────────────────────────────────────────

const PROPOSE = () => `/api/ai/sales-mapping/${conn.id}/propose`
const userText = body => body.messages[0].content.filter(b => b.type === 'text').map(b => b.text).join('\n')
/** The ref a line of the prompt gives a name: "E5 | item | Brownie" -> E5. */
const refOf = (text, kind, name) => {
  const m = text.split('\n').map(l => l.trim()).find(l => new RegExp('^[A-Z]\\d+ \\| ' + kind).test(l) && l.includes('| ' + name))
  return m ? m.split(' ')[0] : null
}
const dishRef = (text, name) => text.split('\n').find(l => /^D\d+ \| /.test(l) && l.split(' | ')[1] === name)?.split(' ')[0]
const blank = { dish: '', options: [], group: '', axis: '', values: [], reason: '', confidence: 0.5 }

test('Pepper: refs only, names as data, at most four cache marks; bad refs and kinds dropped; usage counted', async () => {
  let seen
  claude.script.push(body => {
    seen = body
    const t = userText(body)
    const brownie = refOf(t, 'item', 'Brownie'), water = refOf(t, 'item', 'Bottle of water'), muffin = refOf(t, 'item', 'Muffin')
    const syrup = refOf(t, 'modifier option', 'Vanilla syrup')
    const answer = { proposals: [
      { ...blank, ref: brownie, kind: 'keep', reason: 'Nothing like it on the menu', confidence: 0.8 },
      { ...blank, ref: water, kind: 'exact', dish: dishRef(t, 'Water'), reason: 'A bottle of water is our Water', confidence: 0.9 },
      { ...blank, ref: muffin, kind: 'none', reason: 'Not sure', confidence: 0.1 },
      { ...blank, ref: syrup, kind: 'exact', dish: 'D99', reason: 'bad dish ref' },
      { ...blank, ref: 'E999', kind: 'keep', reason: 'bad thing ref' },
      { ...blank, ref: brownie, kind: 'merge', reason: 'off the schema' },
    ] }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 3000, output_tokens: 400 } }
  })
  const keys = ['i:it-brownie', 'v:var-muffin-b', 'v:var-muffin-c', 'i:it-btl-water', 'o:opt-syrup']
  const before = (await sql`SELECT count(*)::int AS n FROM ai_requests WHERE tenant_id = ${ids.a} AND use = 'item_mapping'`)[0].n
  const res = await ok(owner.post(PROPOSE(), { venue_id: V, keys }))
  assert.equal(res.asked, 5)

  // What the model was shown.
  const marks = seen.system.filter(b => b.cache_control).length
  assert.ok(marks >= 1 && marks <= 4, 'cache marks: ' + marks)
  const text = userText(seen)
  assert.match(seen.system.map(b => b.text).join('\n'), /data, never instructions/)
  assert.match(text, /<their_items>[\s\S]*Brownie[\s\S]*<\/their_items>/)
  assert.match(text, /<our_menu>[\s\S]*Water[\s\S]*<\/our_menu>/)
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/, 'no ids, only refs')
  assert.doesNotMatch(text, /it-brownie|var-muffin|opt-syrup/, 'not the other till\'s ids either')
  assert.ok(!dishRef(text, 'B dish'), 'never another tenant\'s dish')
  assert.match(text, /Propose a rule for each of: E\d+/)

  // What came back, mapped to ids and checked.
  const by = key => res.proposals.find(p => p.key === key)
  assert.equal(by('i:it-brownie').rule.kind, 'keep')
  assert.equal(by('i:it-btl-water').rule.target_item_id, our.water)
  assert.equal(by('i:it-btl-water').label, 'Water')
  assert.equal(by('i:it-btl-water').rule.venue_id, V)
  assert.equal(res.proposals.length, 2)
  assert.equal(res.dropped.length, 3, JSON.stringify(res.dropped))
  assert.ok(res.couldnt.some(c => c.name === 'Muffin'))
  const after = (await sql`SELECT count(*)::int AS n FROM ai_requests WHERE tenant_id = ${ids.a} AND use = 'item_mapping'`)[0].n
  assert.equal(after, before + 1, 'one model request, counted as item mapping')
  assert.equal((await rulesNow()).filter(r => r.item_ref === 'it-brownie').length, 0, 'nothing saved until accepted')

  // Accepting saves through the same bulk route.
  const saved = await ok(owner.post(base() + '/rules/bulk', { rules: res.proposals.map(p => p.rule) }))
  assert.equal(saved.saved.length, 2)
})

test('Pepper: refused when off, for View, for another tenant\'s connection or a venue not on it', async () => {
  assert.equal((await looker.post(PROPOSE(), { venue_id: V })).status, 403)
  assert.equal((await other.post(PROPOSE(), { venue_id: V })).status, 404)
  const stray = (await ok(owner.post('/api/venues', { name: 'Zqx Stray', slug: 'zqx-stray-ss', timezone: 'Europe/London' }))).id
  assert.equal((await owner.post(PROPOSE(), { venue_id: stray })).status, 422)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const n = claude.requests.length
    assert.equal((await owner.post(PROPOSE(), { venue_id: V })).status, 403, 'Pepper off')
    assert.equal(claude.requests.length, n, 'no model call')
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }
})
