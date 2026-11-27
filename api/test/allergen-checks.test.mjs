// The allergen check (inventory phase 8a, migration 316, 27 Nov 2026):
// allergens on a supplier's product (saved whole, unknown until checked),
// the roll-up through a dish's recipe, its prep recipe inside and its
// option's rule at the product each venue orders (another supplier at
// another venue, another suggestion), the differences against the dish's
// declaration in the menu's draft, items with unknown allergens as gaps,
// accepting (through the menus area's own save route: the draft changes,
// what guests are served doesn't, and Discard changes opens the check
// again), dismissing with a note (holding until the differences change, and
// taken back), Pepper's spec sheet reader (a stand-in Claude: names as data,
// no ids, nothing saved until the person saves) and its tools, find_dishes
// answering as before, the recipe editor's suggestion, the reports, another
// group's ids refused, and who may do what. Since the review fixes: a dish
// whose ingredients' allergens are unknown is "not all known", never
// "agrees" (the tab, its counts and Pepper); an accept always names the
// allergens ticked, and ticks left from before accept nothing; a gap shared
// by two venues is named at both; read_product_allergens is offered on
// Purchasing setup manage, not Recipes; its link searches the Inventory page
// by the item's name.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, sql, getApp, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return this } }
const answer = obj => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 2000, output_tokens: 300 } })
const blankRule = { option_id: null, dish_id: null, option_label: null, item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, note: null }

let ids, owner, operator, viewer, bOwner, soho, leeds, bVenue, brakes, bidfood
let noodles, oyster, fish, tamarind, prawns, egg, sauce, padthaiR, menu, padthai, plain, dip, bQuote, bDish
const q = (item, supplierId) => item.quotes.find(x => x.supplier_id === supplierId)

async function setAllergens(quote, contains = [], may = [], who = owner) {
  return ok(who.put(`/api/inventory/quotes/${quote.id}/allergens`, { known: true, contains, may_contain: may, source: 'Spec sheet' }))
}
async function checks(query = '') { return ok(owner.get('/api/allergen-checks' + query)) }
const rowOf = (list, dishId) => list.rows.find(r => r.dish_id === dishId)
async function draftDeclared(menuId, dishId) {
  const m = await ok(owner.get('/api/menus/' + menuId))
  return m.sections.flatMap(s => s.items).find(i => i.id === dishId)
}
async function asRole(permissions, fn) {
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin)
    VALUES (${ids.a}, ${'al_' + randomUUID().slice(0, 8)}, 'Allergens', ${sql.json(permissions)}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try {
    return await fn()
  } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
}
async function pepper(sub, name, input, { describe = false } = {}) {
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  return describe ? tool.describe(ctx, parsed) : tool.run(ctx, parsed)
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-al', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-al', timezone: 'Europe/London', currency: 'GBP' }))).id
  bVenue = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-al', timezone: 'Europe/London' }))).id
  // Every venue but the two is switched off, so the checks are at Soho and Leeds.
  await sql`UPDATE venues SET is_active = false WHERE tenant_id = ${ids.a} AND id NOT IN (${soho}, ${leeds})`
  await ok(owner.post('/api/menus/dietary/standard-allergens', {}))
  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  bidfood = await ok(owner.post('/api/suppliers', { name: 'Bidfood', send_method: 'print' }))
  const item = async (name, base_unit, suppliers) => {
    let i = await ok(owner.post('/api/inventory/items', { name, base_unit }))
    for (const [s, price, extra] of suppliers) {
      i = await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: s.id, pack_name: 'Pack', pack_qty: 1, pack_unit: base_unit === 'each' ? 'each' : base_unit === 'ml' ? 'l' : 'kg', price, ...extra }))
    }
    return i
  }
  noodles = await item('Rice noodles', 'g', [[brakes, 3]])
  oyster = await item('Oyster sauce', 'ml', [[brakes, 4, { product_name: 'Lee Kum Kee oyster sauce' }], [bidfood, 5]])
  fish = await item('Fish sauce', 'ml', [[brakes, 3]])
  tamarind = await item('Tamarind paste', 'g', [[brakes, 6]])
  prawns = await item('King prawns', 'g', [[brakes, 15]])
  egg = await item('Free range egg', 'each', [[brakes, 0.3]])
  await setAllergens(q(noodles, brakes.id), [])
  await setAllergens(q(oyster, brakes.id), ['molluscs', 'soya', 'gluten'])
  await setAllergens(q(oyster, bidfood.id), ['molluscs', 'soya'], ['sesame'])
  await setAllergens(q(fish, brakes.id), ['fish'])
  await setAllergens(q(prawns, brakes.id), ['crustaceans'])
  await setAllergens(q(egg, brakes.id), ['eggs'])
  // Brakes' oyster sauce is the group's choice; Leeds orders Bidfood's (dearer, so chosen by hand).
  await ok(owner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: null, quote_id: q(oyster, brakes.id).id }))
  await ok(owner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: leeds, quote_id: q(oyster, bidfood.id).id }))
  sauce = await ok(owner.post('/api/recipes', { name: 'Pad thai sauce', kind: 'prep', yield_qty: 1, yield_unit: 'l', status: 'live', lines: [
    { item_id: oyster.id, qty: 400, unit: 'ml' }, { item_id: fish.id, qty: 200, unit: 'ml' }, { item_id: tamarind.id, qty: 300, unit: 'g' },
  ] }))
  // The egg in a unit with no size: it is still in the dish.
  padthaiR = await ok(owner.post('/api/recipes', { name: 'Pad thai', kind: 'dish', status: 'live', lines: [
    { item_id: noodles.id, qty: 150, unit: 'g' }, { item_id: egg.id, qty: 1, unit: 'piece' }, { sub_recipe_id: sauce.id, qty: 80, unit: 'ml' },
  ] }))
  const vg = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', variation_type: 'addition', options: [{ label: 'Add prawns', price_pence: 250 }] }))
  const addPrawns = vg.options[0]
  await ok(owner.put('/api/recipe-options/rules', { ...blankRule, option_id: addPrawns.id, action: 'add', item_id: prawns.id, qty: 60, unit: 'g' }))
  const m = await ok(owner.post('/api/menus', { name: 'Dinner', slug: 'dinner-al' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [{ title: 'Noodles', items: [
    // Declared: gluten, eggs, celery (nothing has it) and molluscs as may contain only.
    { name: 'Pad thai', price_pence: 1250, is_orderable: true, dietary: ['gluten', 'eggs', 'celery', 'molluscs'], allergen_levels: { molluscs: 'may_contain' },
      variant_groups: [{ group_id: vg.id, overrides: [] }], variants: [] },
    { name: 'Plain noodles', price_pence: 600, is_orderable: true, dietary: [], variant_groups: [], variants: [] },
    { name: 'Soup of the day', price_pence: 500, is_orderable: true, dietary: ['celery'], variant_groups: [], variants: [] },
    // Its one ingredient's allergens are unknown (the tamarind paste, until the roll-up test puts them in).
    { name: 'Tamarind dip', price_pence: 300, is_orderable: true, dietary: [], variant_groups: [], variants: [] },
  ] }] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  padthai = menu.sections[0].items.find(i => i.name === 'Pad thai').id
  plain = menu.sections[0].items.find(i => i.name === 'Plain noodles').id
  dip = menu.sections[0].items.find(i => i.name === 'Tamarind dip').id
  await ok(owner.put(`/api/recipe-links/dishes/${padthai}/cell`, { recipe_id: padthaiR.id, portions: 1 }))
  await ok(owner.put(`/api/recipe-links/dishes/${plain}/cell`, { recipe_id: (await ok(owner.post('/api/recipes', { name: 'Plain noodles', kind: 'dish', status: 'live', lines: [{ item_id: noodles.id, qty: 200, unit: 'g' }] }))).id }))
  await ok(owner.put(`/api/recipe-links/dishes/${dip}/cell`, { recipe_id: (await ok(owner.post('/api/recipes', { name: 'Tamarind dip', kind: 'dish', status: 'live', lines: [{ item_id: tamarind.id, qty: 50, unit: 'g' }] }))).id }))
  await ok(owner.post(`/api/menus/${m.id}/publish`, {}))
  // The other group's product and dish.
  const bSup = await ok(bOwner.post('/api/suppliers', { name: 'Theirs', send_method: 'print' }))
  const bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Their sauce', base_unit: 'ml' }))
  bQuote = (await ok(bOwner.post(`/api/inventory/items/${bItem.id}/quotes`, { supplier_id: bSup.id, pack_name: 'Tub', pack_qty: 1, pack_unit: 'l', price: 2 }))).quotes[0]
  const bm = await ok(bOwner.post('/api/menus', { name: 'Theirs', slug: 'theirs-al' }))
  const bFull = await ok(bOwner.get('/api/menus/' + bm.id))
  await ok(bOwner.patch('/api/menus/' + bm.id, { ...bFull, sections: [{ title: 'S', items: [{ name: 'Their dish', price_pence: 100, is_orderable: true, variant_groups: [], variants: [] }] }] }))
  bDish = (await ok(bOwner.get('/api/menus/' + bm.id))).sections[0].items[0].id
})
test.after(async () => { await claude.close(); await closeApp() })

test('a supplier product\'s allergens: saved whole, unknown until checked, shown on the item', async () => {
  const item = await ok(owner.get('/api/inventory/items/' + oyster.id))
  const bq = q(item, brakes.id)
  assert.deepEqual(bq.allergens_contains.sort(), ['gluten', 'molluscs', 'soya'])
  assert.equal(bq.allergens_source, 'Spec sheet')
  assert.ok(bq.allergens_checked_at)
  assert.equal(bq.allergens_checked_by, 'a-owner@test.local')
  const tam = q(await ok(owner.get('/api/inventory/items/' + tamarind.id)), brakes.id)
  assert.equal(tam.allergens_checked_at, null, 'not checked: unknown')
  // Made unknown again, then put back.
  const cleared = await ok(owner.put(`/api/inventory/quotes/${q(fish, brakes.id).id}/allergens`, { known: false, contains: ['fish'], may_contain: [], source: 'x' }))
  const f = q(cleared, brakes.id)
  assert.deepEqual([f.allergens_checked_at, f.allergens_contains, f.allergens_source], [null, [], null])
  await setAllergens(q(fish, brakes.id), ['fish'])
  // Refused: a key that isn't one of the 14, both levels at once, a field left out (rule 13), another group's, and without Purchasing setup manage.
  assert.equal((await owner.put(`/api/inventory/quotes/${bq.id}/allergens`, { known: true, contains: ['garlic'], may_contain: [], source: null })).status, 400)
  const both = await owner.put(`/api/inventory/quotes/${bq.id}/allergens`, { known: true, contains: ['soya'], may_contain: ['soya'], source: null })
  assert.equal(both.status, 422)
  assert.match(both.json.error, /Soya can't be both/)
  assert.equal((await owner.put(`/api/inventory/quotes/${bq.id}/allergens`, { known: true, contains: [] })).status, 400)
  assert.equal((await owner.put(`/api/inventory/quotes/${bQuote.id}/allergens`, { known: true, contains: [], may_contain: [], source: null })).status, 404)
  assert.equal((await bOwner.put(`/api/inventory/quotes/${bq.id}/allergens`, { known: true, contains: [], may_contain: [], source: null })).status, 404)
  assert.equal((await operator.put(`/api/inventory/quotes/${bq.id}/allergens`, { known: true, contains: [], may_contain: [], source: null })).status, 403)
})

test('the roll-up through the prep recipe and the option\'s rule, each venue at its own supplier, unknown allergens as gaps', async () => {
  const list = await checks()
  const row = rowOf(list, padthai)
  assert.equal(row.status, 'open')
  assert.equal(row.checkable, true)
  assert.equal(row.complete, false, 'the tamarind paste is unknown')
  assert.deepEqual(row.venues.sort(), ['Leeds', 'Soho'])
  const kinds = Object.fromEntries(row.differences.map(d => [d.allergen, d.kind]))
  assert.deepEqual(kinds, { crustaceans: 'missing', fish: 'missing', molluscs: 'weaker', sesame: 'missing_may', soya: 'missing' })
  assert.ok(!kinds.celery, 'a declared allergen nothing has isn\'t said while a product is unknown')
  const soya = row.differences.find(d => d.allergen === 'soya')
  assert.equal(soya.text, 'The recipe has soya; the dish does not say so')
  assert.ok(soya.evidence.some(e => e.item === 'Oyster sauce' && e.supplier === 'Brakes' && e.via.includes('Pad thai sauce')))
  // The prawns come with the option, by its rule.
  assert.ok(row.differences.find(d => d.allergen === 'crustaceans').evidence.some(e => e.option === 'Add prawns'))
  // Another supplier at another venue: Leeds' oyster sauce may hold sesame, Soho's has gluten.
  const sesame = row.differences.find(d => d.allergen === 'sesame')
  assert.deepEqual(sesame.where, ['Leeds'])
  assert.equal(sesame.evidence[0].supplier, 'Bidfood')
  const at = name => row.groups.find(g => g.where.includes(name))
  assert.equal(at('Soho').levels.gluten, 'contains')
  assert.equal(at('Leeds').levels.gluten, undefined)
  assert.equal(at('Leeds').levels.sesame, 'may_contain')
  assert.notEqual(at('Soho'), at('Leeds'), 'the two venues are told apart')
  // Unknown allergens are gaps, by name and venue: unknown at both venues, one gap named at both.
  const tam = row.gaps.filter(g => g.reason === 'unknown' && g.item === 'Tamarind paste')
  assert.equal(tam.length, 1)
  assert.equal(tam[0].text, 'Allergens unknown for Tamarind paste at Soho, Leeds (Brakes: Tamarind paste)')
  // A dish whose recipe agrees with what it declares has nothing open; one with no recipe can't be checked.
  assert.equal(rowOf(list, plain).status, null)
  const soup = list.rows.find(r => r.dish === 'Soup of the day')
  assert.equal(soup.checkable, false)
  assert.ok(soup.gaps.some(g => g.reason === 'no_recipe'))
  assert.equal(soup.state, 'not_checkable')
  assert.equal(rowOf(list, plain).state, 'agree', 'every product of the plain noodles is known')
  // Every ingredient unknown: nothing differs, and that is "not all known", never "agrees" (the tab, its counts, Pepper).
  const dipRow = rowOf(list, dip)
  assert.deepEqual([dipRow.checkable, dipRow.complete, dipRow.status, dipRow.state, dipRow.differences.length], [true, false, null, 'incomplete', 0])
  assert.equal(dipRow.groups.length, 1)
  assert.deepEqual(dipRow.groups[0].levels, {})
  assert.equal(dipRow.groups[0].complete, false)
  assert.deepEqual([list.counts.incomplete, list.counts.agree, list.counts.not_checkable], [1, 1, 1])
  assert.deepEqual(list.rows.map(r => r.state).slice(0, 2), ['open', 'incomplete'], 'open first, then what isn\'t all known')
  const dipSays = await pepper(A.owner, 'allergen_check', { dish: 'Tamarind dip' })
  assert.match(dipSays.suggested, /^not known yet/)
  assert.match(dipSays.differences[0], /None found so far, but not everything is known/)
  assert.match(dipSays.status, /^not all known/)
  assert.doesNotMatch(JSON.stringify([dipSays.suggested, dipSays.differences, dipSays.status]), /agree|none of the 14/i)
  assert.equal(dipSays.complete, false)
  assert.equal(list.rows[0].dish_id, padthai, 'open first')
  assert.equal(list.counts.open, 1)
  assert.equal(list.can_decide, true)
  // Stored: one open check.
  const [stored] = await sql`SELECT status, dish, menu, gaps, complete FROM allergen_checks WHERE tenant_id = ${ids.a} AND dish_id = ${padthai}`
  assert.deepEqual({ ...stored }, { status: 'open', dish: 'Pad thai', menu: 'Dinner', gaps: 1, complete: false })
  // The venue filter.
  const atLeeds = await checks('?venue_id=' + leeds)
  assert.ok(rowOf(atLeeds, padthai))
  assert.equal((await owner.get('/api/allergen-checks?venue_id=' + bVenue)).status, 404, 'another group\'s venue')
  // Once the tamarind is known (free of all 14), the celery nothing has is said too.
  await setAllergens(q(tamarind, brakes.id), [])
  const knownList = await checks()
  const known = rowOf(knownList, padthai)
  assert.equal(known.complete, true)
  assert.equal(known.differences.find(d => d.allergen === 'celery').text, 'The dish declares celery; nothing in the recipe has it')
  assert.equal(rowOf(knownList, dip).state, 'agree', 'the dip, once its tamarind is known')
  assert.equal((await pepper(A.owner, 'allergen_check', { dish: 'Tamarind dip' })).differences[0], 'None: the recipe and the declaration agree.')
})

test('the recipe editor\'s suggestion: a recipe\'s own allergens at each venue', async () => {
  const s = await ok(owner.get('/api/allergen-checks/recipes/' + sauce.id))
  assert.equal(s.name, 'Pad thai sauce')
  const soho = s.groups.find(g => g.venues.includes('Soho'))
  const leedsG = s.groups.find(g => g.venues.includes('Leeds'))
  assert.equal(soho.levels.gluten, 'contains')
  assert.equal(leedsG.levels.sesame, 'may_contain')
  assert.equal((await owner.get('/api/allergen-checks/recipes/' + randomUUID())).status, 404)
})

test('accepting writes the declaration into the menu\'s draft through the menus route; guests are served the same until it is published', async () => {
  const pepperBefore = await pepper(A.owner, 'find_dishes', { free_from: ['soya'] })
  const before = rowOf(await checks(), padthai)
  // A stale fingerprint is refused: nobody accepts what they didn't see.
  const stale = await owner.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: 'soya:missing::', allergens: ['soya'] })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.code, 'changed')
  // Accept the soya only: the rest stays open.
  const one = await ok(owner.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: before.fingerprint, allergens: ['soya'] }))
  assert.deepEqual(one.just_accepted, ['soya'])
  assert.equal(one.status, 'open', 'what wasn\'t accepted stays open')
  assert.ok(!one.differences.some(d => d.allergen === 'soya'))
  assert.equal(one.history.at(-1).status, 'accepted')
  assert.equal(one.history.at(-1).by, 'a-owner@test.local')
  let dish = await draftDeclared(menu.id, padthai)
  assert.ok(dish.dietary.includes('soya'), 'the draft declares soya')
  assert.ok(dish.dietary.includes('celery'), 'nothing else changed yet')
  // The allergens are always named: an accept that names none is refused.
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: one.fingerprint })).status, 400)
  // Ticks left from before (the soya, accepted already) name none of what differs now: refused, nothing accepted.
  const leftOver = await owner.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: one.fingerprint, allergens: ['soya'] })
  assert.equal(leftOver.status, 422)
  assert.equal(leftOver.json.code, 'nothing')
  assert.deepEqual(rowOf(await checks(), padthai).differences.map(d => d.allergen), one.differences.map(d => d.allergen), 'nothing more accepted')
  // Then everything that differs now, by name.
  const all = await ok(owner.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: one.fingerprint, allergens: one.differences.map(d => d.allergen) }))
  assert.equal(all.status, 'accepted')
  assert.deepEqual(all.differences, [])
  assert.deepEqual(all.accepted.map(d => d.allergen).sort(), ['celery', 'crustaceans', 'fish', 'molluscs', 'sesame'])
  assert.equal(all.decided_by, 'a-owner@test.local')
  assert.equal(all.published, false, 'the draft is not live yet')
  dish = await draftDeclared(menu.id, padthai)
  assert.deepEqual(dish.dietary.sort(), ['crustaceans', 'eggs', 'fish', 'gluten', 'molluscs', 'sesame', 'soya'])
  assert.equal(dish.allergen_levels.sesame, 'may_contain')
  assert.equal(dish.allergen_levels.molluscs, undefined, 'molluscs now contains')
  // Every other field of the menu is as it was: only the dish's tags changed (the Allergen matrix's own save).
  const after = await ok(owner.get('/api/menus/' + menu.id))
  assert.equal(after.sections[0].items.find(i => i.id === padthai).price_pence, 1250)
  assert.equal(after.sections[0].items.find(i => i.id === padthai).variant_groups.length, 1)
  // What guests are served is unchanged until the menu's allergens are published: find_dishes answers as before.
  const live = await ok(owner.get(`/api/menus/${menu.id}/allergens?version=live`))
  const liveDish = live.sections.flatMap(s => s.items).find(i => i.id === padthai)
  const tags = await ok(owner.get('/api/menus/dietary/all'))
  const soyaTag = tags.find(t => t.standard_key === 'soya')
  assert.equal(liveDish.levels[soyaTag.id], undefined, 'live: still no soya')
  assert.deepEqual(await pepper(A.owner, 'find_dishes', { free_from: ['soya'] }), pepperBefore, 'find_dishes reads the live declaration: unchanged')
  // Accepted stays accepted on the next read.
  assert.equal(rowOf(await checks(), padthai).status, 'accepted')
  // Discard changes (the live release back into the draft): the check opens again, the acceptance in its history.
  const pub = await ok(owner.get(`/api/menus/${menu.id}/publish`))
  await ok(owner.post(`/api/menus/${menu.id}/releases/${pub.live.release_id}/restore`, {}))
  const reopened = rowOf(await checks(), padthai)
  assert.equal(reopened.status, 'open')
  assert.ok(reopened.history.some(h => h.status === 'accepted' && h.differences.some(d => d.allergen === 'celery')))
})

test('dismissing with a note holds until the differences change; it can be taken back', async () => {
  const row = rowOf(await checks(), padthai)
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${padthai}/dismiss`, { fingerprint: row.fingerprint, note: '' })).status, 400, 'a note is needed')
  const d = await ok(owner.post(`/api/allergen-checks/dishes/${padthai}/dismiss`, { fingerprint: row.fingerprint, note: 'Celery salt in the garnish, not in the recipe' }))
  assert.equal(d.status, 'dismissed')
  assert.equal(d.note, 'Celery salt in the garnish, not in the recipe')
  // It holds on the next read, and when something that doesn't change the differences moves (Soho's noodles: still none).
  await setAllergens(q(noodles, brakes.id), [], [])
  assert.equal(rowOf(await checks(), padthai).status, 'dismissed')
  // The egg's product now says it may contain mustard: a new difference, so the check opens again.
  await setAllergens(q(egg, brakes.id), ['eggs'], ['mustard'])
  const again = rowOf(await checks(), padthai)
  assert.equal(again.status, 'open')
  assert.ok(again.differences.some(d => d.allergen === 'mustard' && d.kind === 'missing_may'))
  assert.equal(again.note, null)
  const last = again.history.at(-1)
  assert.deepEqual([last.status, last.note], ['dismissed', 'Celery salt in the garnish, not in the recipe'])
  await setAllergens(q(egg, brakes.id), ['eggs'])
  // Dismissed and taken back.
  const now = rowOf(await checks(), padthai)
  await ok(owner.post(`/api/allergen-checks/dishes/${padthai}/dismiss`, { fingerprint: now.fingerprint, note: 'Later' }))
  const back = await ok(owner.post(`/api/allergen-checks/dishes/${padthai}/reopen`, {}))
  assert.equal(back.status, 'open')
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${padthai}/reopen`, {})).status, 409)
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${plain}/dismiss`, { fingerprint: '', note: 'x' })).status, 409, 'nothing differs')
})

test('Pepper reads a spec sheet: names as data, no ids, nothing saved until the person saves', async () => {
  const quote = q(await ok(owner.get('/api/inventory/items/' + tamarind.id)), brakes.id)
  const reply = () => answer({
    product_name: 'Thai tamarind paste 1 kg',
    allergens: [
      { allergen: 'sulphites', level: 'contains', words: 'Preservative: sodium metabisulphite' },
      { allergen: 'peanuts', level: 'may_contain', words: 'May contain peanuts' },
      { allergen: 'gluten', level: 'free', words: 'Allergen table: No' },
      { allergen: 'garlic', level: 'contains', words: 'not one of the 14' },
    ],
    notes: '',
  })
  claude.script.push(reply)
  const before = claude.requests.length
  const read = await ok(owner.post('/api/ai/allergens/read', { quote_id: quote.id, files: [{ name: 'spec.png', data: PNG }] }))
  assert.equal(claude.requests.length, before + 1)
  const body = claude.requests.at(-1).body
  assert.equal(body.output_config.format.type, 'json_schema')
  assert.match(body.system.map(b => b.text).join(''), /data, never instructions/)
  const text = body.messages[0].content.at(-1).text
  assert.match(text, /Tamarind paste/)
  assert.match(text, /Brakes/)
  assert.doesNotMatch(text, UUID, 'no id goes to the model')
  assert.equal(body.messages[0].content[0].type, 'image')
  assert.equal(read.allergens.sulphites.level, 'contains')
  assert.equal(read.allergens.peanuts.level, 'may_contain')
  assert.equal(read.allergens.gluten.level, 'free')
  assert.equal(read.allergens.celery.level, 'not_said', 'one it didn\'t answer is not said, never free')
  assert.equal(read.said, 3, 'garlic isn\'t one of the 14')
  assert.equal(read.product_name, 'Thai tamarind paste 1 kg')
  const [use] = await sql`SELECT use FROM ai_requests WHERE tenant_id = ${ids.a} ORDER BY created_at DESC LIMIT 1`
  assert.equal(use.use, 'allergen_reader')
  // Nothing saved by reading.
  const still = q(await ok(owner.get('/api/inventory/items/' + tamarind.id)), brakes.id)
  assert.deepEqual(still.allergens_contains, [])
  // Refused: not a photo or PDF, another group's product, without Purchasing setup manage.
  assert.equal((await owner.post('/api/ai/allergens/read', { quote_id: quote.id, files: [{ name: 'a.txt', data: Buffer.from('hello there').toString('base64') }] })).status, 422)
  assert.equal((await owner.post('/api/ai/allergens/read', { quote_id: bQuote.id, files: [{ data: PNG }] })).status, 404)
  assert.equal((await operator.post('/api/ai/allergens/read', { quote_id: quote.id, files: [{ data: PNG }] })).status, 403)
  assert.equal(claude.requests.length, before + 1, 'no model call for a refusal')
})

test('Pepper: allergen_check reads a dish\'s suggestion against its declaration; read_product_allergens confirms first', async () => {
  const out = await pepper(A.owner, 'allergen_check', { dish: 'Pad thai' })
  assert.equal(out.dish, 'Pad thai')
  assert.ok(out.differences.some(d => /The recipe has soya; the dish does not say so/.test(d)))
  assert.ok(out.evidence.some(e => /Oyster sauce in Pad thai sauce \(Brakes: Lee Kum Kee oyster sauce\)/.test(e)))
  assert.match(out.declared, /gluten/i)
  assert.doesNotMatch(JSON.stringify(out), UUID, 'names, never ids')
  // Anyone with Recipes view: the operator.
  const op = await pepper(A.operator, 'allergen_check', { dish: 'Pad thai' })
  assert.equal(op.dish, 'Pad thai')
  // The spec reader as a change tool: the card shows the reading, Confirm saves it.
  const { makeContext } = await import('../src/ai/context.js')
  const app = await getApp()
  const [conv] = await sql`INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt)
    VALUES (${ids.a}, 'staff_chat', ${A.owner}, ${A.owner + '@test.local'}, 'test') RETURNING id`
  await sql`INSERT INTO ai_attachments (tenant_id, user_sub, conversation_id, kind, media_type, filename, bytes, data)
    VALUES (${ids.a}, ${A.owner}, ${conv.id}, 'image', 'image/png', 'prawn-spec.png', 70, ${Buffer.from(PNG, 'base64')})`
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet, conversationId: conv.id,
    auth: { authorization: 'Bearer test:' + A.owner }, principal: { sub: A.owner, email: 'a-owner@test.local' }, actor: 'a-owner@test.local',
  })
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const tool = audienceTools('staff').find(t => t.name === 'read_product_allergens')
  assert.ok(tool)
  assert.equal(tool.confirm, true)
  claude.script.push(() => answer({ product_name: 'King prawns 1 kg', allergens: [{ allergen: 'crustaceans', level: 'contains', words: 'Prawns (crustacean)' }, { allergen: 'sulphites', level: 'may_contain', words: 'May contain sulphites' }], notes: '' }))
  const input = parseInput(tool, { item: 'King prawns', supplier: 'Brakes', from_chat: true })
  const card = await tool.describe(ctx, input)
  assert.match(card.title, /King prawns/)
  assert.ok(card.lines.some(l => /Contains crustaceans/.test(l)))
  assert.ok(card.lines.some(l => /May contain sulphites/.test(l)))
  assert.doesNotMatch(JSON.stringify(card.lines), UUID)
  const done = await tool.run(ctx, parseInput(tool, { ...input, ...card.pin }))
  assert.match(done.message, /Saved/)
  // Its link opens the Inventory page searched by the item's name, never an id the page would read as one.
  assert.equal(done.page, '/inventory?q=' + encodeURIComponent('King prawns'))
  const saved = q(await ok(owner.get('/api/inventory/items/' + prawns.id)), brakes.id)
  assert.deepEqual(saved.allergens_contains, ['crustaceans'])
  assert.deepEqual(saved.allergens_may_contain, ['sulphites'])
  assert.match(saved.allergens_source, /prawn-spec\.png/)
  const [act] = await sql`SELECT tool FROM ai_actions WHERE tenant_id = ${ids.a} ORDER BY created_at DESC LIMIT 1`
  assert.equal(act.tool, 'read_product_allergens')
  await setAllergens(q(prawns, brakes.id), ['crustaceans'])
})

test('reports: allergen checks, dishes with differences, items with unknown allergens', async () => {
  await checks()
  const r1 = await ok(owner.post('/api/reports/starter:dishes_with_allergen_differences/run', {}), 'starter')
  const t1 = JSON.stringify(r1)
  assert.match(t1, /Pad thai/)
  assert.match(t1, /The recipe has soya; the dish does not say so/)
  assert.equal((await viewer.post('/api/reports/starter:dishes_with_allergen_differences/run', {})).status, 403, 'Recipes view')
  // The tamarind's product is known by now: an item with a product nobody has checked is listed.
  const garlic = await ok(owner.post('/api/inventory/items', { name: 'Garlic oil', base_unit: 'ml' }))
  await ok(owner.post(`/api/inventory/items/${garlic.id}/quotes`, { supplier_id: brakes.id, pack_name: 'Tub', pack_qty: 1, pack_unit: 'l', price: 4 }))
  await ok(owner.post('/api/recipes', { name: 'Garlic dressing', kind: 'prep', yield_qty: 1, yield_unit: 'l', status: 'live', lines: [{ item_id: garlic.id, qty: 100, unit: 'ml' }] }))
  const r2 = await ok(owner.post('/api/reports/starter:items_with_unknown_allergens/run', {}), 'starter')
  const t2 = JSON.stringify(r2)
  assert.match(t2, /Garlic oil/)
  assert.doesNotMatch(t2, /Oyster sauce/, 'a known product isn\'t listed')
  assert.equal((await operator.post('/api/reports/starter:items_with_unknown_allergens/run', {})).status, 403, 'Purchasing setup view')
})

test('another group\'s ids are refused, and who may do what', async () => {
  // Another group's dish, check and recipe.
  assert.equal((await bOwner.get(`/api/allergen-checks/dishes/${padthai}`)).status, 404)
  assert.equal((await bOwner.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: '', allergens: ['soya'] })).status, 404)
  assert.equal((await bOwner.post(`/api/allergen-checks/dishes/${padthai}/dismiss`, { fingerprint: '', note: 'x' })).status, 404)
  assert.equal((await bOwner.get(`/api/allergen-checks/recipes/${sauce.id}`)).status, 404)
  assert.equal((await owner.get(`/api/allergen-checks/dishes/${bDish}`)).status, 404)
  assert.ok(!(await ok(bOwner.get('/api/allergen-checks'))).rows.some(r => r.dish_id === padthai))
  // Recipes view reads; deciding needs Recipes manage and Menus manage.
  assert.equal((await viewer.get('/api/allergen-checks')).status, 403, 'no Recipes view')
  const opList = await ok(operator.get('/api/allergen-checks'))
  assert.equal(opList.can_decide, false)
  const row = rowOf(opList, padthai)
  assert.equal((await operator.post(`/api/allergen-checks/dishes/${padthai}/dismiss`, { fingerprint: row.fingerprint, note: 'x' })).status, 403)
  await asRole({ recipes: 'manage', menus: 'view' }, async () => {
    const r = await viewer.post(`/api/allergen-checks/dishes/${padthai}/accept`, { fingerprint: row.fingerprint, allergens: ['soya'] })
    assert.equal(r.status, 403)
    assert.match(r.json.error, /Menus manage/)
  })
  await asRole({ recipes: 'view' }, async () => {
    assert.equal((await viewer.get('/api/allergen-checks')).status, 200)
    assert.equal((await viewer.get('/api/allergen-checks/recipes/' + sauce.id)).status, 200)
  })
})

test('read_product_allergens is offered to whoever may save a product\'s allergens: Purchasing setup manage, not Recipes', async () => {
  const { toolAllowed, audienceTools } = await import('../src/ai/tools/index.js')
  const { objectActions } = await import('../src/ai/registry.js')
  const { OBJECTS } = await import('../../shared/registry/index.js')
  const tool = audienceTools('staff').find(t => t.name === 'read_product_allergens')
  assert.ok(toolAllowed(tool, { purchasing_setup: 'manage' }), 'a buyer with Purchasing setup manage')
  assert.ok(!toolAllowed(tool, { recipes: 'manage' }), 'not a chef with Recipes manage alone: its run would refuse them')
  assert.ok(!toolAllowed(tool, { purchasing_setup: 'view' }))
  // What the supplier price record says (what_can_i_do): the module and level the tool's run checks.
  const action = objectActions(OBJECTS['purchasing.prices']).find(a => a.name === 'read_product_allergens')
  assert.deepEqual([action.modules, action.needs], [['purchasing_setup'], 'manage'])
  // The staff connector lists it by the same rule.
  async function listed(permissions) {
    return asRole(permissions, async () => {
      const { token } = await ok(viewer.post('/api/ai/tokens', { name: 'Allergens' }))
      const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
      const app = await getApp()
      const res = await app.inject({
        method: 'POST', url: '/mcp/staff/thai-house',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
        payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      assert.equal(res.statusCode, 200, res.body.slice(0, 300))
      return res.json().result.tools.map(t => t.name)
    })
  }
  assert.ok((await listed({ ai_assistant: 'use', purchasing_setup: 'manage' })).includes('read_product_allergens'), 'Purchasing setup manage, no Recipes')
  const chef = await listed({ ai_assistant: 'use', recipes: 'manage' })
  assert.ok(!chef.includes('read_product_allergens'), 'Recipes manage alone')
  assert.ok(chef.includes('allergen_check'), 'the check itself is theirs')
})
