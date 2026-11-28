// Allergen checks opened again when something changes (inventory phase 8b,
// migration 317, 27 Nov 2026): each kind of change calls one hook
// (allergensChanged()) where it is saved, and the affected dishes' checks are
// worked out again: a product's allergens saved (a dismissed check opens
// again, with its decision in the history; saving the same holds it), a
// supplier price edited so another product is the cheapest, the usual
// supplier switched at one venue, a product substituted on receiving (unknown
// until it is a supplier price with allergens), a supplier switched off, a
// recipe line, a link and an option rule. A check a change opened says what
// changed, goes on Today as "Allergen checks to review" for whoever can decide
// it (Recipes manage and Menus manage), and leaves it once decided. A failure
// in the hook never stops the change. Another group's changes never touch
// these checks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { addDays, nowAt } from '../../shared/procurement.js'

const blankRule = { option_id: null, dish_id: null, option_label: null, item_id: null, sub_recipe_id: null, swap_item_id: null, qty: null, unit: null, factor: null, recipe_id: null, note: null }
const CHECK = { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true, chilled_temp_c: 3 }

let ids, owner, operator, viewer, bOwner, soho, leeds, brakes, bidfood
let noodles, oyster, egg, peanuts, sauce, padthaiR, plainR, menu, padthai, plain, addEgg
const q = (item, supplierId) => item.quotes.find(x => x.supplier_id === supplierId)
const check = dishId => ok(owner.get('/api/allergen-checks/dishes/' + dishId))
const setAllergens = (quote, contains = [], may = []) => ok(owner.put(`/api/inventory/quotes/${quote.id}/allergens`, { known: true, contains, may_contain: may, source: 'Spec sheet' }))
const marks = async dishId => (await sql`SELECT status, change, changed_at FROM allergen_checks WHERE tenant_id = ${ids.a} AND dish_id = ${dishId}`)[0] || null
async function decide(dishId) {
  const c = await check(dishId)
  if (c.state === 'open') await ok(owner.post(`/api/allergen-checks/dishes/${dishId}/dismiss`, { fingerprint: c.fingerprint, note: 'Checked by hand' }))
  return check(dishId)
}
async function asRole(permissions, fn) {
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin)
    VALUES (${ids.a}, ${'ar_' + randomUUID().slice(0, 8)}, 'Reopen', ${sql.json(permissions)}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try { return await fn() } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
}
const todayCard = async (who, venueId) => (await ok(who.get('/api/ops/today?venue_id=' + venueId))).tasks.find(t => t.area === 'allergen_checks') || null

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-re', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-re', timezone: 'Europe/London', currency: 'GBP' }))).id
  await sql`UPDATE venues SET is_active = false WHERE tenant_id = ${ids.a} AND id NOT IN (${soho}, ${leeds})`
  await ok(owner.post('/api/menus/dietary/standard-allergens', {}))
  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print', lead_days: 1 }))
  bidfood = await ok(owner.post('/api/suppliers', { name: 'Bidfood', send_method: 'print', lead_days: 1 }))
  const item = async (name, base_unit, suppliers) => {
    let i = await ok(owner.post('/api/inventory/items', { name, base_unit }))
    for (const [s, price, extra] of suppliers) {
      i = await ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: s.id, pack_name: 'Pack', pack_qty: 1, pack_unit: base_unit === 'each' ? 'each' : base_unit === 'ml' ? 'l' : 'kg', price, ...extra }))
    }
    return i
  }
  noodles = await item('Rice noodles', 'g', [[brakes, 3, { supplier_code: 'RN1' }], [bidfood, 5]])
  oyster = await item('Oyster sauce', 'ml', [[brakes, 4], [bidfood, 6]])
  egg = await item('Free range egg', 'each', [[brakes, 0.3]])
  peanuts = await item('Peanuts', 'g', [[brakes, 8]])
  await setAllergens(q(noodles, brakes.id), [])
  await setAllergens(q(noodles, bidfood.id), ['gluten'])
  await setAllergens(q(oyster, brakes.id), ['molluscs', 'soya'])
  await setAllergens(q(oyster, bidfood.id), ['molluscs', 'soya'], ['sesame'])
  await setAllergens(q(egg, brakes.id), ['eggs'])
  await setAllergens(q(peanuts, brakes.id), ['peanuts'])
  // Everyone orders Brakes' oyster sauce for now.
  await ok(owner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: null, quote_id: q(oyster, brakes.id).id }))
  sauce = await ok(owner.post('/api/recipes', { name: 'Pad thai sauce', kind: 'prep', yield_qty: 1, yield_unit: 'l', status: 'live', lines: [{ item_id: oyster.id, qty: 500, unit: 'ml' }] }))
  padthaiR = await ok(owner.post('/api/recipes', { name: 'Pad thai', kind: 'dish', status: 'live', lines: [
    { item_id: noodles.id, qty: 150, unit: 'g' }, { sub_recipe_id: sauce.id, qty: 80, unit: 'ml' },
  ] }))
  plainR = await ok(owner.post('/api/recipes', { name: 'Plain noodles', kind: 'dish', status: 'live', lines: [{ item_id: noodles.id, qty: 200, unit: 'g' }] }))
  const vg = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', variation_type: 'addition', options: [{ label: 'Add egg', price_pence: 100 }] }))
  addEgg = vg.options[0]
  // Add egg changes nothing for now (an option with no rule is a gap).
  await ok(owner.put('/api/recipe-options/rules', { ...blankRule, option_id: addEgg.id, action: 'nothing' }))
  const m = await ok(owner.post('/api/menus', { name: 'Dinner', slug: 'dinner-re' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [{ title: 'Noodles', items: [
    { name: 'Pad thai', price_pence: 1250, is_orderable: true, dietary: ['molluscs', 'soya'], variant_groups: [], variants: [] },
    { name: 'Plain noodles', price_pence: 600, is_orderable: true, dietary: [], variant_groups: [{ group_id: vg.id, overrides: [] }], variants: [] },
  ] }] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  padthai = menu.sections[0].items.find(i => i.name === 'Pad thai').id
  plain = menu.sections[0].items.find(i => i.name === 'Plain noodles').id
  await ok(owner.put(`/api/recipe-links/dishes/${padthai}/cell`, { recipe_id: padthaiR.id, portions: 1 }))
  await ok(owner.put(`/api/recipe-links/dishes/${plain}/cell`, { recipe_id: plainR.id, portions: 1 }))
  await ok(owner.post(`/api/menus/${m.id}/publish`, {}))
})
test.after(async () => { await closeApp() })

test('both dishes agree to begin with: nothing open, nothing on Today', async () => {
  const list = await ok(owner.get('/api/allergen-checks'))
  assert.equal(list.rows.find(r => r.dish_id === padthai).state, 'agree')
  assert.equal(list.rows.find(r => r.dish_id === plain).state, 'agree')
  const s = await ok(owner.get('/api/allergen-checks/summary?venue_id=' + soho))
  assert.equal(s.count, 0)
  assert.equal(await todayCard(owner, soho), null)
})

test('a product\'s allergens saved opens the check, says what changed, and puts it on Today until decided', async () => {
  // Brakes' oyster sauce turns out to hold wheat: Pad thai doesn't declare gluten.
  await setAllergens(q(oyster, brakes.id), ['molluscs', 'soya', 'gluten'])
  const c = await check(padthai)
  assert.equal(c.state, 'open')
  assert.deepEqual(c.differences.map(d => d.allergen), ['gluten'])
  assert.match(c.change, /Oyster sauce: a product's allergens saved \(Brakes\)/)
  assert.ok(c.changed_at)
  const s = await ok(owner.get('/api/allergen-checks/summary?venue_id=' + soho))
  assert.equal(s.count, 1)
  assert.deepEqual(s.dishes.map(d => d.dish), ['Pad thai'])
  assert.equal(s.can_decide, true)
  const card = await todayCard(owner, soho)
  assert.ok(card, 'on Today')
  assert.equal(card.title, 'Allergen checks to review')
  assert.match(card.detail, /1 dish' allergens to look at again: Pad thai/)
  assert.equal(card.action.path, '/recipes?tab=allergens&changed=1')
  assert.ok(await todayCard(owner, leeds), 'a dish on a menu for every venue is on each venue\'s Today')
  // Not for someone who can look but not decide.
  await asRole({ recipes: 'view', menus: 'view' }, async () => {
    assert.equal((await ok(viewer.get('/api/allergen-checks/summary?venue_id=' + soho))).can_decide, false)
    assert.equal(await todayCard(viewer, soho), null)
  })
  // Dismissed: off Today, the mark cleared.
  await ok(owner.post(`/api/allergen-checks/dishes/${padthai}/dismiss`, { fingerprint: c.fingerprint, note: 'Gluten is on the sign' }))
  assert.equal((await marks(padthai)).changed_at, null)
  assert.equal((await ok(owner.get('/api/allergen-checks/summary?venue_id=' + soho))).count, 0)
  assert.equal(await todayCard(owner, soho), null)
})

test('a dismissal holds when the change doesn\'t change what differs; it opens again, with its history, when it does', async () => {
  await setAllergens(q(oyster, brakes.id), ['molluscs', 'soya', 'gluten'])
  assert.equal((await check(padthai)).state, 'dismissed', 'the same allergens saved again: nothing differs anew')
  assert.equal((await marks(padthai)).changed_at, null)
  await setAllergens(q(oyster, brakes.id), ['molluscs', 'soya', 'gluten', 'celery'])
  const c = await check(padthai)
  assert.equal(c.state, 'open')
  assert.deepEqual(c.differences.map(d => d.allergen).sort(), ['celery', 'gluten'])
  assert.equal(c.history.at(-1).status, 'dismissed')
  assert.equal(c.history.at(-1).note, 'Gluten is on the sign')
  assert.match(c.change, /allergens saved/)
  // Put back as it was, and decided.
  await setAllergens(q(oyster, brakes.id), ['molluscs', 'soya'])
  const back = await check(padthai)
  assert.equal(back.state, 'agree', 'nothing differs: the open check goes')
  assert.equal(await marks(padthai), null)
})

test('the usual supplier switched at one venue', async () => {
  // Leeds orders Bidfood's oyster sauce, which may contain sesame.
  await ok(owner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: leeds, quote_id: q(oyster, bidfood.id).id }))
  const c = await check(padthai)
  assert.equal(c.state, 'open')
  assert.deepEqual(c.differences.map(d => [d.allergen, d.kind, d.where.join(',')]), [['sesame', 'missing_may', 'Leeds']])
  assert.equal(c.change, 'Oyster sauce: the usual supplier switched at Leeds')
  // Switched back: nothing differs.
  await ok(owner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: leeds, quote_id: null }))
  assert.equal((await check(padthai)).state, 'agree')
})

test('a supplier price changed so another product is the cheapest, and a supplier switched off', async () => {
  // Brakes' noodles dearer than Bidfood's, which hold gluten: both noodle dishes now hold it.
  await ok(owner.patch('/api/inventory/quotes/' + q(noodles, brakes.id).id, { price: 9 }))
  for (const d of [padthai, plain]) {
    const c = await check(d)
    assert.equal(c.state, 'open', d)
    assert.ok(c.differences.some(x => x.allergen === 'gluten'))
    assert.match(c.change, /Rice noodles: a supplier price added, changed or switched off/)
  }
  // Bidfood switched off: Brakes' noodles again, nothing differs.
  await ok(owner.patch('/api/suppliers/' + bidfood.id, { is_active: false }))
  assert.equal((await check(plain)).state, 'agree')
  assert.equal((await check(padthai)).state, 'agree')
  await ok(owner.patch('/api/suppliers/' + bidfood.id, { is_active: true }))
  // On again: Bidfood's noodles are the cheapest again; the change says so.
  const on = await check(plain)
  assert.equal(on.state, 'open')
  assert.equal(on.change, 'Bidfood switched on')
  await ok(owner.patch('/api/inventory/quotes/' + q(noodles, brakes.id).id, { price: 3 }))
  assert.equal((await check(plain)).state, 'agree')
})

test('a product substituted on receiving: unknown at that venue until what came is a supplier price', async () => {
  const today = nowAt('Europe/London').date
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Dry goods', venue_ids: [soho], item_ids: [noodles.id] }))
  const order = await ok(owner.post('/api/purchasing/orders', { venue_id: soho, list_id: list.id }))
  await ok(owner.put(`/api/purchasing/orders/${order.id}/lines`, { lines: [{ item_id: noodles.id, qty: 2, quote_id: q(noodles, brakes.id).id }] }))
  const placed = await ok(owner.post(`/api/purchasing/orders/${order.id}/submit`, { suppliers: { [brakes.id]: { delivery_date: addDays(today, 3) } } }))
  const poId = (placed.pos || placed.purchase_orders || [])[0]?.id || (await sql`SELECT id FROM purchase_orders WHERE tenant_id = ${ids.a} AND venue_id = ${soho} ORDER BY created_at DESC LIMIT 1`)[0].id
  const po = await ok(owner.get('/api/purchasing/pos/' + poId))
  const line = po.lines.find(l => l.item_id === noodles.id)
  await ok(owner.post(`/api/purchasing/pos/${poId}/receive`, { lines: [{ id: line.id, received_qty: 2, status: 'substituted', note: 'Egg noodles instead' }], check: CHECK }))
  const c = await check(plain)
  assert.equal(c.state, 'incomplete', 'what came isn\'t known: nothing differs, but it can\'t agree')
  const gap = c.gaps.find(g => g.reason === 'substitute')
  assert.ok(gap, JSON.stringify(c.gaps))
  assert.match(gap.text, /A substitute for Rice noodles was delivered at Soho on .*: its allergens aren't known/)
  assert.deepEqual(gap.where, ['Soho'], 'only at the venue it was delivered to')
  // What came, read off the invoice, added to the price list as Brakes' product (the line points at it), with egg in it.
  await sql`UPDATE purchase_order_lines SET invoice_code = 'EN9', invoice_name = 'Egg noodles', invoice_price = 4 WHERE id = ${line.id}`
  await ok(owner.post(`/api/purchasing/pos/${poId}/price-list`, { changes: [{ line_id: line.id, action: 'add', pack: { name: 'Pack', count: 1, qty: 1, unit: 'kg' } }] }))
  const item = await ok(owner.get('/api/inventory/items/' + noodles.id))
  const sub = item.quotes.find(x => x.supplier_code === 'EN9')
  assert.ok(sub)
  await setAllergens(sub, ['eggs', 'gluten'])
  const after = await check(plain)
  assert.equal(after.state, 'open')
  const gluten = after.differences.find(d => d.allergen === 'gluten')
  assert.deepEqual(gluten.where, ['Soho'])
  assert.match(gluten.evidence[0].substitute ? 'substitute' : '', /substitute/)
  // Delivered as ordered since: the substitute no longer counts.
  await ok(owner.post(`/api/purchasing/pos/${poId}/receive`, { lines: [{ id: line.id, received_qty: 2, status: 'ok' }], check: CHECK }))
  await sql`UPDATE purchase_order_lines SET quote_id = ${q(noodles, brakes.id).id} WHERE id = ${line.id}`
  assert.equal((await check(plain)).state, 'agree')
})

test('a recipe line, a link and an option rule changed each open the dishes they reach', async () => {
  // A recipe line: peanuts in the sauce reach Pad thai through its prep recipe.
  await ok(owner.put('/api/recipes/' + sauce.id, {
    name: sauce.name, kind: 'prep', category: null, code: null, status: 'live', yield_qty: 1, yield_unit: 'l', portions: null, loss_pct: 0, method: null,
    photo_url: null, shelf_life_hours: null, variant_of: null, notes: null, is_active: true,
    lines: [{ item_id: oyster.id, qty: 500, unit: 'ml', yield_pct: null, note: null }, { item_id: peanuts.id, qty: 50, unit: 'g', yield_pct: null, note: null }],
  }))
  const c = await check(padthai)
  assert.deepEqual(c.differences.map(d => d.allergen), ['peanuts'])
  assert.equal(c.change, 'Pad thai sauce changed')
  assert.equal((await check(plain)).state, 'agree', 'a dish not using it is left alone')
  // A link: Plain noodles at Leeds is made from the Pad thai recipe.
  await ok(owner.put(`/api/recipe-links/dishes/${plain}/cell`, { venue_id: leeds, recipe_id: padthaiR.id, portions: 1 }))
  const l = await check(plain)
  assert.equal(l.state, 'open')
  assert.equal(l.change, 'Which recipe Plain noodles uses changed')
  assert.ok(l.differences.some(d => d.allergen === 'peanuts' && d.where.join() === 'Leeds'))
  const linkId = (await sql`SELECT id FROM recipe_links WHERE tenant_id = ${ids.a} AND dish_id = ${plain} AND venue_id = ${leeds}`)[0].id
  await ok(owner.delete('/api/recipe-links/links/' + linkId))
  assert.equal((await check(plain)).state, 'agree', 'the link taken off')
  // An option rule: Add egg adds an egg to every dish offering it.
  await ok(owner.put('/api/recipe-options/rules', { ...blankRule, option_id: addEgg.id, action: 'add', item_id: egg.id, qty: 1, unit: 'each' }))
  const o = await check(plain)
  assert.deepEqual(o.differences.map(d => d.allergen), ['eggs'])
  assert.equal(o.change, 'Add egg: an option\'s rule changed')
  await ok(owner.put('/api/recipe-options/rules', { ...blankRule, option_id: addEgg.id, action: 'nothing' }))
  assert.equal((await check(plain)).state, 'agree')
  // Put the sauce back.
  await ok(owner.put('/api/recipes/' + sauce.id, {
    name: sauce.name, kind: 'prep', category: null, code: null, status: 'live', yield_qty: 1, yield_unit: 'l', portions: null, loss_pct: 0, method: null,
    photo_url: null, shelf_life_hours: null, variant_of: null, notes: null, is_active: true,
    lines: [{ item_id: oyster.id, qty: 500, unit: 'ml', yield_pct: null, note: null }],
  }))
  assert.equal((await check(padthai)).state, 'agree')
})

test('a dry run changes nothing; another group\'s changes never touch these checks; a failing hook never stops the change', async () => {
  await decide(padthai)
  const before = await marks(padthai)
  // A price update dry run: no check worked out.
  const r = await owner.post('/api/inventory/price-update', { supplier_id: brakes.id, rows: [{ code: 'RN1', price: 99 }], dry_run: true })
  assert.equal(r.status, 200, r.body)
  assert.deepEqual(await marks(padthai), before)
  // The other group saves its own product's allergens and its own preferred supplier.
  const bSup = await ok(bOwner.post('/api/suppliers', { name: 'Theirs', send_method: 'print' }))
  let bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Rice noodles', base_unit: 'g' }))
  bItem = await ok(bOwner.post(`/api/inventory/items/${bItem.id}/quotes`, { supplier_id: bSup.id, pack_name: 'Bag', pack_qty: 1, pack_unit: 'kg', price: 2 }))
  await ok(bOwner.put(`/api/inventory/quotes/${bItem.quotes[0].id}/allergens`, { known: true, contains: ['sesame'], may_contain: [], source: null }))
  assert.deepEqual(await marks(padthai), before)
  assert.equal((await sql`SELECT count(*)::int AS n FROM allergen_checks WHERE tenant_id = ${ids.b}`)[0].n, 0)
  // Our ids in their requests are refused, and theirs in ours.
  assert.equal((await bOwner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: null, quote_id: q(oyster, bidfood.id).id })).status, 404)
  assert.equal((await owner.put(`/api/inventory/items/${oyster.id}/preferred`, { venue_id: null, quote_id: bItem.quotes[0].id })).status, 404)
  assert.equal((await bOwner.get('/api/allergen-checks/summary?venue_id=' + soho)).status, 404)
  // A hook that fails (its table gone for the length of one change) is logged; the change is saved.
  await sql`ALTER TABLE allergen_checks RENAME TO allergen_checks_away`
  try {
    const saved = await owner.put(`/api/inventory/quotes/${q(egg, brakes.id).id}/allergens`, { known: true, contains: ['eggs', 'milk'], may_contain: [], source: 'Label' })
    assert.equal(saved.status, 200, saved.body)
  } finally {
    await sql`ALTER TABLE allergen_checks_away RENAME TO allergen_checks`
  }
  const [eq] = await sql`SELECT allergens_contains FROM inv_quotes WHERE id = ${q(egg, brakes.id).id}`
  assert.deepEqual(eq.allergens_contains.sort(), ['eggs', 'milk'])
  await setAllergens(q(egg, brakes.id), ['eggs'])
})

test('who may: Today\'s card and the summary need Recipes view; deciding needs Recipes manage and Menus manage', async () => {
  await asRole({ recipes: 'none', menus: 'manage' }, async () => {
    assert.equal((await viewer.get('/api/allergen-checks/summary')).status, 403)
  })
  await asRole({ recipes: 'manage', menus: 'view' }, async () => {
    const s = await ok(viewer.get('/api/allergen-checks/summary'))
    assert.equal(s.can_decide, false)
  })
})
