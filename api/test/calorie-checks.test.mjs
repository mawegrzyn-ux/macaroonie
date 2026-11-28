// Suggested calories (inventory phase 8b, migration 318, 27 Nov 2026): an
// item's energy saved on the Inventory page (per 100 g, per 100 ml or each;
// the other kind refused), one serving of a dish rolled up through a nested
// prep recipe (a batch's energy over what it makes after its loss, the
// part used of a trimmed item) and compared with menu_items.calories; an
// item with no energy is a gap (no suggestion, only "at least", and nothing
// to accept); accepting writes the figure into the menu's draft only (what
// guests see waits for publishing; Discard changes puts it back and the check
// opens again); a dismissal holds while the recipe stays within the
// tolerance, and an item's energy changed opens it again and puts it on
// Today; the recipe editor's own figure; the reports; another group's ids
// refused; and who may do what.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'

let ids, owner, viewer, bOwner, soho, brakes, rice, onion, butter, egg, mystery, sauce, glaze, friedR, menu, fried, plainDish, bDish
const check = dishId => ok(owner.get('/api/allergen-checks/dishes/' + dishId))
const draftDish = async dishId => (await ok(owner.get('/api/menus/' + menu.id))).sections.flatMap(s => s.items).find(i => i.id === dishId)
async function asRole(permissions, fn) {
  const [role] = await sql`INSERT INTO tenant_roles (tenant_id, key, label, permissions, is_builtin)
    VALUES (${ids.a}, ${'kc_' + randomUUID().slice(0, 8)}, 'Calories', ${sql.json(permissions)}, false) RETURNING id`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  try { return await fn() } finally {
    await sql`UPDATE users SET custom_role_id = NULL WHERE auth0_user_id = ${A.viewer} AND tenant_id = ${ids.a}`
  }
}
async function discard() {
  const live = (await ok(owner.get(`/api/menus/${menu.id}/publish`))).live
  await ok(owner.post(`/api/menus/${menu.id}/releases/${live.release_id}/restore`, {}))
}

// One serving of Fried rice (the recipe makes 2): 200 g onion used (trimmed to 80%: 250 g bought) at 40 kcal per
// 100 g, 300 g rice at 130, 2 eggs at 70, 100 g of the glaze (400 g of a butter sauce that loses half its weight,
// 1 kg of butter at 740 making 500 g, and 600 g rice: 6,700 kcal a kg). (80 + 390 + 140 + 670) / 2 = 640.
const SERVING = 640

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-kc', timezone: 'Europe/London', currency: 'GBP' }))).id
  await sql`UPDATE venues SET is_active = false WHERE tenant_id = ${ids.a} AND id <> ${soho}`
  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }))
  const item = async (name, base_unit, extra = {}) => {
    const i = await ok(owner.post('/api/inventory/items', { name, base_unit, ...extra }))
    return ok(owner.post(`/api/inventory/items/${i.id}/quotes`, { supplier_id: brakes.id, pack_name: 'Pack', pack_qty: 1, pack_unit: base_unit === 'each' ? 'each' : 'kg', price: 2 }))
  }
  rice = await item('Jasmine rice', 'g', { kcal_per_100g: 130, kcal_source: 'Label' })
  onion = await item('Onion', 'g', { yield_pct: 80, kcal_per_100g: 40 })
  butter = await item('Butter', 'g', { kcal_per_100g: 740 })
  egg = await item('Egg', 'each', { kcal_each: 70 })
  mystery = await item('House seasoning', 'g')
  sauce = await ok(owner.post('/api/recipes', { name: 'Butter sauce', kind: 'prep', yield_qty: 1, yield_unit: 'kg', loss_pct: 50, status: 'live', lines: [{ item_id: butter.id, qty: 1000, unit: 'g' }] }))
  glaze = await ok(owner.post('/api/recipes', { name: 'Rice glaze', kind: 'prep', yield_qty: 1, yield_unit: 'kg', status: 'live', lines: [
    { sub_recipe_id: sauce.id, qty: 400, unit: 'g' }, { item_id: rice.id, qty: 600, unit: 'g' },
  ] }))
  friedR = await ok(owner.post('/api/recipes', { name: 'Fried rice', kind: 'dish', portions: 2, status: 'live', lines: [
    { item_id: onion.id, qty: 200, unit: 'g' }, { item_id: rice.id, qty: 300, unit: 'g' }, { item_id: egg.id, qty: 2, unit: 'each' },
    { sub_recipe_id: glaze.id, qty: 100, unit: 'g' },
  ] }))
  const plainR = await ok(owner.post('/api/recipes', { name: 'Seasoned rice', kind: 'dish', status: 'live', lines: [
    { item_id: rice.id, qty: 200, unit: 'g' }, { item_id: mystery.id, qty: 5, unit: 'g' },
  ] }))
  const m = await ok(owner.post('/api/menus', { name: 'Dinner', slug: 'dinner-kc' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [{ title: 'Rice', items: [
    { name: 'Fried rice', price_pence: 900, calories: 500, is_orderable: true, dietary: [], variant_groups: [], variants: [] },
    { name: 'Seasoned rice', price_pence: 400, calories: 100, is_orderable: true, dietary: [], variant_groups: [], variants: [] },
  ] }] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  fried = menu.sections[0].items.find(i => i.name === 'Fried rice').id
  plainDish = menu.sections[0].items.find(i => i.name === 'Seasoned rice').id
  await ok(owner.put(`/api/recipe-links/dishes/${fried}/cell`, { recipe_id: friedR.id, portions: 1 }))
  await ok(owner.put(`/api/recipe-links/dishes/${plainDish}/cell`, { recipe_id: plainR.id, portions: 1 }))
  await ok(owner.post(`/api/menus/${m.id}/publish`, {}))
  const bm = await ok(bOwner.post('/api/menus', { name: 'Theirs', slug: 'theirs-kc' }))
  const bFull = await ok(bOwner.get('/api/menus/' + bm.id))
  await ok(bOwner.patch('/api/menus/' + bm.id, { ...bFull, sections: [{ title: 'S', items: [{ name: 'Their dish', price_pence: 100, is_orderable: true, variant_groups: [], variants: [] }] }] }))
  bDish = (await ok(bOwner.get('/api/menus/' + bm.id))).sections[0].items[0].id
})
test.after(async () => { await closeApp() })

test('an item\'s energy: saved for its kind of unit, the other kind refused, shown on the item', async () => {
  const r = await ok(owner.get('/api/inventory/items/' + rice.id))
  assert.deepEqual([r.kcal_per_100g, r.kcal_each, r.kcal_source], [130, null, 'Label'])
  const e = await owner.patch('/api/inventory/items/' + egg.id, { kcal_per_100g: 150 })
  assert.equal(e.status, 422)
  assert.match(e.json.error, /counted in each/)
  assert.equal((await owner.patch('/api/inventory/items/' + rice.id, { kcal_per_100g: 1200 })).status, 400, 'over 900 a 100 g')
  assert.equal((await owner.patch('/api/inventory/items/' + rice.id, { kcal_each: 5 })).status, 422)
  // Another group's item, and someone without Purchasing setup manage.
  assert.equal((await bOwner.patch('/api/inventory/items/' + rice.id, { kcal_per_100g: 1 })).status, 404)
  await asRole({ purchasing_setup: 'view', recipes: 'manage', menus: 'manage' }, async () => {
    assert.equal((await viewer.patch('/api/inventory/items/' + rice.id, { kcal_per_100g: 1 })).status, 403)
  })
})

test('one serving rolled up through a nested prep recipe, against the declared figure', async () => {
  const c = (await check(fried)).calories
  assert.equal(c.complete, true, JSON.stringify(c.gaps))
  assert.equal(c.suggested, SERVING)
  assert.equal(c.declared, 500)
  assert.equal(c.state, 'open')
  assert.equal(c.difference.kind, 'differs')
  assert.equal(c.difference.text, 'The recipe comes to 640 kcal; the dish declares 500 kcal')
  const lines = c.groups[0].lines
  assert.equal(lines.find(l => l.item === 'Onion').qty_base, 100, 'the part used, not what is bought')
  const butterLine = lines.find(l => l.item === 'Butter')
  assert.deepEqual(butterLine.via, ['Fried rice', 'Rice glaze', 'Butter sauce'])
  assert.equal(butterLine.qty_base, 40)
  // Unknown is never a pass: the seasoning has no energy.
  const s = (await check(plainDish)).calories
  assert.equal(s.complete, false)
  assert.equal(s.suggested, null)
  assert.equal(s.lower, 260)
  assert.equal(s.difference.kind, 'under', 'what is known already comes to more than the 100 declared')
  assert.ok(s.gaps.some(g => g.reason === 'no_energy' && g.item === 'House seasoning'))
  const list = await ok(owner.get('/api/allergen-checks'))
  assert.equal(list.rows.find(r => r.dish_id === fried).calories.state, 'open')
  // The recipe editor: the recipe's own figure, and its dish's declared one.
  const ed = await ok(owner.get('/api/allergen-checks/recipes/' + friedR.id))
  assert.equal(ed.calories.kcal, SERVING)
  assert.equal(ed.calories.per, 'a portion')
  assert.deepEqual(ed.calories.dishes.map(d => [d.dish, d.declared, d.suggested, d.agrees]), [['Fried rice', 500, SERVING, false]])
  assert.equal((await ok(owner.get('/api/allergen-checks/recipes/' + glaze.id))).calories.kcal, 6700)
})

test('accepting writes the figure into the menu\'s draft only; Discard changes opens it again', async () => {
  const before = await check(fried)
  // Refused: a figure seen before it changed, one with gaps, nothing to accept.
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${fried}/calories/accept`, { fingerprint: 'differs:1:2:3' })).status, 409)
  const gaps = (await check(plainDish)).calories
  const inc = await owner.post(`/api/allergen-checks/dishes/${plainDish}/calories/accept`, { fingerprint: gaps.fingerprint })
  assert.equal(inc.status, 422)
  assert.equal(inc.json.code, 'incomplete')
  const after = await ok(owner.post(`/api/allergen-checks/dishes/${fried}/calories/accept`, { fingerprint: before.calories.fingerprint }))
  assert.equal(after.just_accepted_kcal, SERVING)
  assert.equal(after.calories.state, 'accepted')
  assert.equal(after.calories.declared, SERVING)
  assert.equal(after.calories.live_declared, 500, 'guests are still told 500 until it is published')
  assert.equal(after.calories.published, false)
  assert.equal(after.calories.decided_kcal, SERVING)
  const d = await draftDish(fried)
  assert.equal(d.calories, SERVING)
  // Every other field of the dish as it was (the whole save sent back every field).
  assert.equal(d.price_pence, 900)
  assert.equal(d.name, 'Fried rice')
  const status = await ok(owner.get(`/api/menus/${menu.id}/publish`))
  assert.ok(status.live?.release_id)
  // Discard changes: the draft is the live release again, and the check opens again.
  await discard()
  assert.equal((await draftDish(fried)).calories, 500)
  const again = (await check(fried)).calories
  assert.equal(again.state, 'open')
  assert.equal(again.history.at(-1).status, 'accepted')
})

test('a dismissal holds within the tolerance; an item\'s energy changed past it opens it again and puts it on Today', async () => {
  const c = (await check(fried)).calories
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${fried}/calories/dismiss`, { fingerprint: c.fingerprint, note: '' })).status, 400, 'a note is needed')
  const d = await ok(owner.post(`/api/allergen-checks/dishes/${fried}/calories/dismiss`, { fingerprint: c.fingerprint, note: 'Lab tested at 520' }))
  assert.equal(d.calories.state, 'dismissed')
  assert.equal(d.calories.decided_kcal, SERVING)
  // Rice a little richer: 640 becomes 643 (within 10%): the dismissal holds, nothing on Today.
  await ok(owner.patch('/api/inventory/items/' + rice.id, { kcal_per_100g: 131 }))
  assert.equal((await check(fried)).calories.state, 'dismissed')
  // (Seasoned rice's check is on Today since its recipe was linked; it moved by 2 kcal, inside the tolerance.)
  const held = await ok(owner.get('/api/allergen-checks/summary?venue_id=' + soho))
  assert.deepEqual(held.calories.dishes.map(d => d.dish), ['Seasoned rice'])
  assert.equal(held.calories.dishes[0].change, 'Which recipe Seasoned rice uses changed')
  // Rice twice as rich: past the tolerance: open again, said, on Today.
  await ok(owner.patch('/api/inventory/items/' + rice.id, { kcal_per_100g: 260 }))
  const open = (await check(fried)).calories
  assert.equal(open.state, 'open')
  assert.equal(open.change, 'Jasmine rice changed')
  assert.equal(open.history.at(-1).note, 'Lab tested at 520')
  const s = await ok(owner.get('/api/allergen-checks/summary?venue_id=' + soho))
  assert.deepEqual(s.calories.dishes.map(d => d.dish), ['Fried rice', 'Seasoned rice'], 'newest change first')
  const today = await ok(owner.get('/api/ops/today?venue_id=' + soho))
  const card = today.tasks.find(t => t.area === 'allergen_checks')
  assert.ok(card, 'on Today')
  assert.match(card.detail, /2 calorie figures to look at again/)
  assert.match(card.detail, /Jasmine rice changed/)
  // Dismissed again then taken back; and the rice put back.
  const now = (await check(fried)).calories
  await ok(owner.post(`/api/allergen-checks/dishes/${fried}/calories/dismiss`, { fingerprint: now.fingerprint, note: 'Checked' }))
  const re = await ok(owner.post(`/api/allergen-checks/dishes/${fried}/calories/reopen`, {}))
  assert.equal(re.calories.state, 'open')
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${fried}/calories/reopen`, {})).status, 409)
  await ok(owner.patch('/api/inventory/items/' + rice.id, { kcal_per_100g: 130 }))
  // A recipe line changed: worked out again where it is saved.
  await ok(owner.patch('/api/inventory/items/' + mystery.id, { kcal_per_100g: 0 }))
  const known = (await check(plainDish)).calories
  assert.equal(known.complete, true)
  assert.equal(known.suggested, 260)
})

test('reports: calorie checks and items with no energy figure', async () => {
  const r1 = await ok(owner.post('/api/reports/starter:dishes_with_calorie_differences/run', {}), 'starter')
  const t1 = JSON.stringify(r1)
  assert.match(t1, /Fried rice/)
  assert.match(t1, /The recipe comes to 640 kcal; the dish declares 500 kcal/)
  const r2 = await ok(owner.post('/api/reports/starter:items_with_no_energy/run', {}), 'starter')
  assert.ok(!JSON.stringify(r2).includes('House seasoning'), JSON.stringify(r2).slice(-900))
  await ok(owner.patch('/api/inventory/items/' + mystery.id, { kcal_per_100g: null }))
  const r3 = await ok(owner.post('/api/reports/starter:items_with_no_energy/run', { fresh: true }), 'starter')
  assert.ok(JSON.stringify(r3).includes('House seasoning'), JSON.stringify(r3).slice(-900))
  assert.equal((await viewer.post('/api/reports/starter:dishes_with_calorie_differences/run', {})).status, 403, 'Recipes view')
})

test('another group\'s dishes are refused, and deciding needs Recipes manage and Menus manage', async () => {
  const c = (await check(fried)).calories
  assert.equal((await bOwner.post(`/api/allergen-checks/dishes/${fried}/calories/accept`, { fingerprint: c.fingerprint })).status, 404)
  assert.equal((await bOwner.post(`/api/allergen-checks/dishes/${fried}/calories/dismiss`, { fingerprint: c.fingerprint, note: 'x' })).status, 404)
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${bDish}/calories/accept`, { fingerprint: '' })).status, 404)
  assert.equal((await owner.post(`/api/allergen-checks/dishes/${randomUUID()}/calories/reopen`, {})).status, 404)
  assert.equal((await viewer.post(`/api/allergen-checks/dishes/${fried}/calories/accept`, { fingerprint: c.fingerprint })).status, 403)
  await asRole({ recipes: 'manage', menus: 'view' }, async () => {
    const r = await viewer.post(`/api/allergen-checks/dishes/${fried}/calories/accept`, { fingerprint: c.fingerprint })
    assert.equal(r.status, 403)
    assert.match(r.json.error, /Menus manage/)
    assert.equal((await viewer.post(`/api/allergen-checks/dishes/${fried}/calories/dismiss`, { fingerprint: c.fingerprint, note: 'x' })).status, 403)
  })
  await asRole({ recipes: 'view', menus: 'view' }, async () => {
    const v = await ok(viewer.get('/api/allergen-checks/dishes/' + fried))
    assert.equal(v.can_decide, false)
    assert.equal(v.calories.suggested, SERVING, 'Recipes view reads the figures')
  })
  assert.equal((await draftDish(fried)).calories, 500, 'nothing refused changed the draft')
})
