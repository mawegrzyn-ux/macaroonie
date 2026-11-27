// Stock phase 4b, waste (inventory, migration 308, 27 Nov 2026): waste of an
// item, a prep batch and a dish broken into items through the variation
// matrix (a takeaway recipe of its own), a draft Pepper read in and a dish
// with no recipe saying so on the line; each item valued at the average paid
// then; on hand and the ledger taking it off; undo on its trading day (whoever
// logged it, or Manage) and a reversing entry after it, dated with what it
// reverses (a count between keeps its figure); a till void marked wasted shown
// once, read only, broken into items, with test till sales and voids not
// wasted left out; the reasons (seeded, added, dragged, switched off, never
// deleted once used); the summary; a photo; cross-tenant ids refused (venue,
// item, recipe, dish, reason, waste); View / Use / Manage.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { as, ok, sql, closeApp, getApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')

let ids, owner, admin, operator, viewer, bOwner, soho, leeds, VB
let chicken, onion, spiced, burgerRecipe, takeRecipe, menu, burger, wings, chips, takeOut, reasons, bReason, bItem, bRecipe, bDish
const dishIn = (m, name) => m.sections.flatMap(s => s.items).find(i => i.name === name)
const byName = rows => Object.fromEntries(rows.map(r => [r.name, r]))
const reason = name => reasons.find(r => r.name === name).id
const itemQty = (entry, name) => entry.items.find(i => i.name === name)?.qty_base

async function onHand(api, venueId) {
  return byName((await ok(api.get('/api/stock/venues/' + venueId))).items)
}

/**
 * A till check at a venue with lines [{ id, item_id, name, qty, status, waste, reason, modifiers }], on a
 * trading day of its own dated the venue's trading day today (`today`, from the API: between midnight and
 * the day's start it is still yesterday there), closed so a second one can be made.
 */
async function tillCheck(tenantId, venueId, today, lines, { generated = false } = {}) {
  const [d] = await sql`
    INSERT INTO pos_days (tenant_id, venue_id, business_date, opened_at, closed_at, is_generated)
    VALUES (${tenantId}, ${venueId}, ${today}::date, now() - interval '2 hours', now(), ${generated}) RETURNING id`
  const id = 'c-' + randomUUID()
  const state = { id, lines: lines.map(l => ({ id: l.id, item_id: l.item_id, name: l.name, qty: l.qty, modifiers: l.modifiers || [], combo: l.combo || null })) }
  await sql`
    INSERT INTO pos_checks (id, tenant_id, venue_id, day_id, mode, status, opened_at, subtotal, total, state, last_seq, is_generated)
    VALUES (${id}, ${tenantId}, ${venueId}, ${d.id}, 'counter', 'open', now() - interval '1 hour', 0, 0, ${sql.json(state)}, 1, ${generated})`
  for (const l of lines) {
    await sql`
      INSERT INTO pos_check_lines (id, tenant_id, venue_id, check_id, day_id, item_id, name, qty, gross, net, status, void_reason, void_waste, voided_at, void_day_id)
      VALUES (${l.id}, ${tenantId}, ${venueId}, ${id}, ${d.id}, ${l.item_id}, ${l.name}, ${l.qty}, 1200, 1000, ${l.status || 'voided'},
              ${l.reason ?? 'Wrong order'}, ${l.waste ?? true}, now(), ${d.id})`
  }
  return id
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-waste', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-waste', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-waste', timezone: 'Europe/London' }))).id
  takeOut = (await ok(owner.get('/api/tax-rates'))).order_types.find(t => t.name === 'Take out').id
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const sup = await ok(owner.post('/api/suppliers', { name: 'Poultry Co', send_method: 'print' }))
  // Chicken: a case of 4 x 2.5 kg at £40 (£0.004 a gram); a tray is 2.5 kg.
  chicken = await ok(owner.post('/api/inventory/items', { name: 'Chicken thighs', base_unit: 'g' }))
  await ok(owner.post(`/api/inventory/items/${chicken.id}/units`, { name: 'tray', base_qty: 2500 }))
  const cq = (await ok(owner.post(`/api/inventory/items/${chicken.id}/quotes`, { supplier_id: sup.id, pack_name: 'Case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', price: 40 }))).quotes[0]
  // Onions: 80% usable, a 10 kg sack at £8 (£0.0008 a gram).
  onion = await ok(owner.post('/api/inventory/items', { name: 'Onions', base_unit: 'g', yield_pct: 80 }))
  const oq = (await ok(owner.post(`/api/inventory/items/${onion.id}/quotes`, { supplier_id: sup.id, pack_name: 'Sack', pack_qty: 10, pack_unit: 'kg', price: 8 }))).quotes[0]
  await ok(owner.post(`/api/purchasing/venues/${soho}/deliveries`, { supplier_id: sup.id, lines: [{ item_id: chicken.id, quote_id: cq.id, received_qty: 2 }, { item_id: onion.id, quote_id: oq.id, received_qty: 1 }], check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true } }))
  // Spiced onions: a prep recipe making 1 kg from 1 kg of usable onion (1.25 kg bought).
  spiced = await ok(owner.post('/api/recipes', { name: 'Spiced onions', kind: 'prep', status: 'live', yield_qty: 1, yield_unit: 'kg', lines: [{ item_id: onion.id, qty: 1000, unit: 'g' }] }))
  burgerRecipe = await ok(owner.post('/api/recipes', { name: 'Chicken burger', kind: 'dish', status: 'live', lines: [{ item_id: chicken.id, qty: 150, unit: 'g' }, { sub_recipe_id: spiced.id, qty: 50, unit: 'g' }] }))
  takeRecipe = await ok(owner.post('/api/recipes', { name: 'Chicken burger to go', kind: 'dish', status: 'live', lines: [{ item_id: chicken.id, qty: 200, unit: 'g' }] }))
  const m = await ok(owner.post('/api/menus', { name: 'Lunch', slug: 'lunch-waste' }))
  const full = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.patch('/api/menus/' + m.id, { ...full, sections: [{ title: 'Mains', items: [
    { name: 'Chicken burger', price_pence: 1000, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Wings', price_pence: 700, is_orderable: true, variant_groups: [], variants: [] },
    { name: 'Chips', price_pence: 300, is_orderable: true, variant_groups: [], variants: [] },
  ] }] }))
  menu = await ok(owner.get('/api/menus/' + m.id))
  await ok(owner.post(`/api/menus/${m.id}/publish`, {}))
  burger = dishIn(menu, 'Chicken burger').id
  wings = dishIn(menu, 'Wings').id
  chips = dishIn(menu, 'Chips').id
  await ok(owner.put(`/api/recipe-links/dishes/${burger}/cell`, { recipe_id: burgerRecipe.id }))
  await ok(owner.put(`/api/recipe-links/dishes/${burger}/cell`, { recipe_id: takeRecipe.id, order_type_id: takeOut }))
  // Wings are costed by a draft Pepper read in (not checked yet).
  const [draft] = await sql`INSERT INTO recipes (tenant_id, name, kind, status, source, portions) VALUES (${ids.a}, 'Wings read in', 'dish', 'draft', 'reader', 1) RETURNING id`
  await sql`INSERT INTO recipe_lines (tenant_id, recipe_id, sort_order, item_id, qty, unit) VALUES (${ids.a}, ${draft.id}, 0, ${chicken.id}, 120, 'g')`
  await ok(owner.put(`/api/recipe-links/dishes/${wings}/cell`, { recipe_id: draft.id }))
  // A count: 20 kg of chicken and 10 kg of onions at Soho, now.
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, { lines: [{ item_id: chicken.id, qty: 20, unit: 'kg' }, { item_id: onion.id, qty: 10, unit: 'kg' }] }))
  reasons = await ok(owner.get('/api/stock/waste-reasons'))
  // The other group's things.
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'B flour', base_unit: 'g' }))
  bRecipe = await ok(bOwner.post('/api/recipes', { name: 'B batch', kind: 'prep', status: 'live', yield_qty: 1, yield_unit: 'l', lines: [{ item_id: bItem.id, qty: 100, unit: 'g' }] }))
  bReason = (await ok(bOwner.get('/api/stock/waste-reasons')))[0]
  const bm = await ok(bOwner.post('/api/menus', { name: 'B menu', slug: 'b-menu-waste' }))
  const bfull = await ok(bOwner.get('/api/menus/' + bm.id))
  await ok(bOwner.patch('/api/menus/' + bm.id, { ...bfull, sections: [{ title: 'B', items: [{ name: 'B dish', price_pence: 500, is_orderable: true, variant_groups: [], variants: [] }] }] }))
  bDish = dishIn(await ok(bOwner.get('/api/menus/' + bm.id)), 'B dish').id
})
test.after(async () => { await closeApp() })

test('the shared rules: an item, a batch and a dish into items; undo and reverse; totals', async () => {
  const { itemsOf } = await import('../../shared/stockItems.js')
  const { wasteUndo, wasteTotals, voidReason } = await import('../../shared/stock.js')
  const items = new Map([['onion', { id: 'onion', name: 'Onion', base_unit: 'g', yield_pct: 80, units: [] }], ['beef', { id: 'beef', name: 'Beef', base_unit: 'each', yield_pct: 100, units: [] }]])
  const sauce = { id: 'sauce', name: 'Sauce', kind: 'prep', yield_qty: 2, yield_unit: 'l', loss_pct: 50, status: 'live', lines: [{ id: 's0', sort_order: 0, item_id: 'onion', qty: 400, unit: 'g' }] }
  const dish = { id: 'r1', name: 'Burger', kind: 'dish', portions: 1, status: 'live', lines: [{ id: 'd0', sort_order: 0, item_id: 'beef', qty: 1, unit: 'each' }, { id: 'd1', sort_order: 1, sub_recipe_id: 'sauce', qty: 100, unit: 'ml' }] }
  const ctx = { items, recipes: new Map([['sauce', sauce], ['r1', dish]]), links: [{ id: 'l1', dish_id: 'b', recipe_id: 'r1', portions: 1 }], dishes: new Map([['b', { id: 'b', name: 'Burger', item_type: 'food' }]]), rules: [], options: new Map() }
  // The batch makes 1 l (2 l less half): 1 l of it is 400 g of usable onion, 500 g bought.
  assert.deepEqual(itemsOf({ recipe_id: 'sauce', qty: 1, unit: 'l' }, ctx).items, [{ item_id: 'onion', qty_base: 500 }])
  // Three burgers: 3 patties and 300 ml of sauce (150 g bought onion).
  assert.deepEqual(itemsOf({ dish_id: 'b', qty: 3, scope: {} }, ctx).items, [{ item_id: 'beef', qty_base: 3 }, { item_id: 'onion', qty_base: 150 }])
  assert.match(itemsOf({ dish_id: 'nope', qty: 1 }, ctx).gaps[0], /no menu/)
  const e = { day: '2026-11-27', wasted_by: 'cook@x' }
  assert.deepEqual(wasteUndo(e, { today: '2026-11-27', me: ['cook@x'], canUse: true }), { undo: true, reverse: false, why: null })
  assert.equal(wasteUndo(e, { today: '2026-11-27', me: 'other@x', canUse: true }).undo, false, 'another person with Use')
  assert.equal(wasteUndo(e, { today: '2026-11-28', me: 'cook@x', canUse: true }).reverse, false, 'a day later the cook can\'t')
  assert.equal(wasteUndo(e, { today: '2026-11-28', me: 'boss@x', canUse: true, canManage: true }).reverse, true)
  const t = wasteTotals([{ reason: 'Dropped', reason_kind: 'preparation', qty: 2, unit: 'each', value: 3 }, { reason: 'dropped', reason_kind: 'preparation', qty: 1, unit: 'each', value: 1.5 }, { reason: 'Out of date', reason_kind: 'spoilage', qty: 1, unit: 'kg', value: null }])
  assert.deepEqual(t.map(r => [r.label, r.entries, r.qty, r.value]), [['Dropped', 2, 3, 4.5], ['Out of date', 1, 1, null]])
  assert.deepEqual(voidReason('wrong ORDER', [{ id: 'x', name: 'Wrong order', kind: 'plate' }]), { reason_id: 'x', reason: 'Wrong order', kind: 'plate' })
  assert.equal(voidReason('Typed in', []).kind, 'preparation')
})

test('reasons: seeded once, added, dragged, switched off; a reason in use is never deleted', async () => {
  assert.equal(reasons.length, 9, 'every group starts with the list')
  assert.deepEqual([...new Set(reasons.map(r => r.kind))].sort(), ['plate', 'preparation', 'spoilage'])
  const r = await ok(owner.post('/api/stock/waste-reasons', { name: 'Fridge failed', kind: 'spoilage' }))
  assert.equal((await owner.post('/api/stock/waste-reasons', { name: 'fridge failed', kind: 'plate' })).status, 409)
  assert.equal((await operator.post('/api/stock/waste-reasons', { name: 'Mine', kind: 'plate' })).status, 403, 'Use logs, Manage sets up')
  const all = await ok(owner.get('/api/stock/waste-reasons'))
  const moved = await ok(owner.put('/api/stock/waste-reasons/order', { ids: [r.id, ...all.filter(x => x.id !== r.id).map(x => x.id)] }))
  assert.equal(moved[0].name, 'Fridge failed', 'dragged to the top')
  assert.equal((await owner.put('/api/stock/waste-reasons/order', { ids: [r.id] })).status, 422, 'every reason, in order')
  await ok(owner.put('/api/stock/waste-reasons/' + r.id, { name: 'Fridge failed', kind: 'spoilage', is_active: false }))
  const off = await owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: onion.id, qty: 1, unit: 'kg', reason_id: r.id })
  assert.equal(off.status, 422, 'a switched off reason isn\'t offered')
  await ok(owner.put('/api/stock/waste-reasons/' + r.id, { name: 'Fridge failed', kind: 'spoilage', is_active: true }))
  const used = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: onion.id, qty: 100, unit: 'g', reason_id: r.id }))
  const del = await owner.delete('/api/stock/waste-reasons/' + r.id)
  assert.equal(del.status, 409)
  assert.match(del.body, /switch it off/)
  await ok(owner.post(`/api/stock/waste/${used.id}/undo`, {}))
  const spare = await ok(owner.post('/api/stock/waste-reasons', { name: 'Spare', kind: 'plate' }))
  assert.deepEqual(await ok(owner.delete('/api/stock/waste-reasons/' + spare.id)), { deleted: true })
  reasons = await ok(owner.get('/api/stock/waste-reasons'))
})

test('waste of an item, a prep batch and a dish through the matrix, valued at the average paid; on hand and the ledger', async () => {
  const before = await onHand(owner, soho)
  assert.equal(before['Chicken thighs'].on_hand, 20000)
  // A tray of chicken dropped: 2.5 kg at £0.004 a gram is £10.
  const tray = await ok(operator.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 1, unit: 'tray', reason_id: reason('Dropped or spilt'), note: 'Off the pass' }))
  assert.deepEqual([tray.name, tray.qty, tray.unit, tray.reason_kind, tray.by], ['Chicken thighs', 1, 'tray (2.5 kg)', 'preparation', 'a-operator@test.local'])
  assert.equal(itemQty(tray, 'Chicken thighs'), 2500)
  assert.equal('value' in tray, false, 'an operator has no Costing view')
  // Half a kilo of spiced onions: 500 g of usable onion, 625 g bought.
  const batch = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'recipe', recipe_id: spiced.id, qty: 0.5, unit: 'kg', reason_id: reason('Made too much') }))
  assert.equal(itemQty(batch, 'Onions'), 625)
  assert.equal(batch.value, 0.5, '625 g at £0.0008')
  // Two burgers eaten in: 300 g chicken and 100 g of spiced onions (125 g bought).
  const eatIn = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'dish', dish_id: burger, qty: 2, reason_id: reason('Burnt or cooked wrong') }))
  assert.deepEqual([itemQty(eatIn, 'Chicken thighs'), itemQty(eatIn, 'Onions')], [300, 125])
  assert.equal(eatIn.value, 1.3, '300 g x £0.004 + 125 g x £0.0008')
  assert.deepEqual(eatIn.gaps, [])
  // Taken away the matrix picks the takeaway recipe: 200 g of chicken each.
  const toGo = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'dish', dish_id: burger, qty: 1, order_type_id: takeOut, reason_id: reason('Sent back by a guest') }))
  assert.deepEqual(toGo.items.map(i => [i.name, i.qty_base]), [['Chicken thighs', 200]])
  assert.equal(toGo.reason_kind, 'plate')
  // A draft Pepper read in says so on the line; a dish with no recipe takes nothing off and says why.
  const w = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'dish', dish_id: wings, qty: 1, reason_id: reason('Left on the plate') }))
  assert.equal(itemQty(w, 'Chicken thighs'), 120)
  assert.match(w.gaps.join(' '), /not checked yet/)
  const c = await ok(owner.post(`/api/stock/venues/${soho}/waste`, { what: 'dish', dish_id: chips, qty: 3, reason_id: reason('Left on the plate') }))
  assert.deepEqual(c.items, [])
  assert.match(c.gaps.join(' '), /no recipe/)
  // The preview says the same without saving.
  const pv = await ok(owner.post(`/api/stock/venues/${soho}/waste/preview`, { what: 'dish', dish_id: burger, qty: 1, reason_id: reason('Dropped or spilt') }))
  assert.deepEqual(pv.items.map(i => [i.name, i.qty_base]), [['Chicken thighs', 150], ['Onions', 62.5]])
  // On hand: 20 kg - 2.5 kg - 300 g - 200 g - 120 g; onions 10 kg - 625 g - 125 g.
  const after = await onHand(owner, soho)
  assert.equal(after['Chicken thighs'].on_hand, 20000 - 2500 - 300 - 200 - 120)
  assert.equal(after.Onions.on_hand, 10000 - 625 - 125)
  // The ledger: each a waste move, with its value at the cost then.
  const led = await ok(owner.get(`/api/stock/venues/${soho}/items/${chicken.id}/moves`))
  const waste = led.moves.filter(m => m.kind === 'waste')
  assert.equal(waste.length, 4)
  assert.ok(waste.some(m => /Chicken thighs \(Dropped or spilt\)/.test(m.source.label) && m.change === -2500 && m.value === -10))
  // Leeds is untouched.
  assert.equal((await onHand(owner, leeds))['Chicken thighs'].on_hand, null)
  // Logged in a unit the item has no size for: refused by name.
  const bad = await owner.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 1, unit: 'slice', reason_id: reason('Dropped or spilt') })
  assert.equal(bad.status, 422)
  assert.match(bad.body, /no size for a slice/)
})

test('undo on the trading day by whoever logged it or Manage; a reversing entry after it, dated with what it reverses', async () => {
  const e = await ok(operator.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: onion.id, qty: 1, unit: 'kg', reason_id: reason('Gone off') }))
  assert.equal(e.can_undo, true)
  assert.equal((await viewer.post(`/api/stock/waste/${e.id}/undo`, {})).status, 403, 'View can\'t')
  // Someone else with Use can't; the owner (Manage) or the person who logged it can.
  const role = await ok(owner.post('/api/access/roles', { key: 'wastecook', label: 'Cook', permissions: { stock: 'use' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, 'cook-w@test.local', 'operator', 'a-waste-cook', ${role.id})`
  const cook = as('a-waste-cook', ids.a)
  assert.equal((await cook.post(`/api/stock/waste/${e.id}/undo`, {})).status, 403)
  const undone = await ok(operator.post(`/api/stock/waste/${e.id}/undo`, {}))
  assert.ok(undone.undone_at)
  assert.equal((await operator.post(`/api/stock/waste/${e.id}/undo`, {})).status, 403, 'once')
  // The day's list keeps it, marked undone; on hand no longer counts it.
  const day = await ok(owner.get(`/api/stock/venues/${soho}/waste`))
  assert.ok(day.entries.find(x => x.id === e.id).undone_at)
  // Yesterday's entry: undo is over; a reversing entry is Manage's, dated with it.
  const old = await ok(operator.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: chicken.id, qty: 1, unit: 'kg', reason_id: reason('Out of date') }))
  await sql`UPDATE stock_waste SET wasted_at = now() - interval '1 day', day = day - 1 WHERE id = ${old.id}`
  // A count since found what was really there (17 kg): the reversal must not add on top of it.
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, { lines: [{ item_id: chicken.id, qty: 17, unit: 'kg' }] }))
  const late = await operator.post(`/api/stock/waste/${old.id}/undo`, {})
  assert.equal(late.status, 403)
  assert.equal((await owner.post(`/api/stock/waste/${old.id}/undo`, {})).status, 409, 'Manage reverses it instead')
  assert.equal((await operator.post(`/api/stock/waste/${old.id}/reverse`, {})).status, 403)
  const rev = await ok(owner.post(`/api/stock/waste/${old.id}/reverse`, {}))
  assert.equal(rev.reverses_id, old.id)
  assert.equal(new Date(rev.at).getTime(), new Date((await sql`SELECT wasted_at FROM stock_waste WHERE id = ${old.id}`)[0].wasted_at).getTime(), 'dated with the entry it reverses')
  assert.equal(itemQty(rev, 'Chicken thighs'), -1000)
  assert.equal((await owner.post(`/api/stock/waste/${old.id}/reverse`, {})).status, 409, 'once')
  assert.equal((await onHand(owner, soho))['Chicken thighs'].on_hand, 17000, 'the count keeps its figure')
})

test('a till void marked wasted is waste by itself: listed once, read only, broken into items; test sales and plain voids left out', async () => {
  const before = (await onHand(owner, soho))['Chicken thighs'].on_hand
  const { today } = await ok(owner.get(`/api/stock/venues/${soho}/waste/pickers`))
  const line = 'l-' + randomUUID()
  await tillCheck(ids.a, soho, today, [
    { id: line, item_id: burger, name: 'Chicken burger', qty: 2, reason: 'Dropped or spilt' },
    { id: 'l-' + randomUUID(), item_id: burger, name: 'Chicken burger', qty: 5, waste: false, reason: 'Never made' },
  ])
  await tillCheck(ids.a, soho, today, [{ id: 'l-' + randomUUID(), item_id: burger, name: 'Chicken burger', qty: 9, reason: 'Test' }], { generated: true })
  const day = await ok(owner.get(`/api/stock/venues/${soho}/waste`))
  const voids = day.entries.filter(e => e.kind === 'till_void')
  assert.equal(voids.length, 1, 'only the void marked wasted, and no test sales')
  const v = voids[0]
  assert.deepEqual([v.id, v.name, v.qty, v.read_only, v.can_undo, v.reason, v.reason_kind], [line, 'Chicken burger', 2, true, false, 'Dropped or spilt', 'preparation'])
  assert.deepEqual(v.items.map(i => [i.name, i.qty_base]), [['Chicken thighs', 300], ['Onions', 125]])
  assert.equal(v.value, 1.3)
  assert.equal((await onHand(owner, soho))['Chicken thighs'].on_hand, before - 300, 'on hand takes it off')
  const led = await ok(owner.get(`/api/stock/venues/${soho}/items/${chicken.id}/moves`))
  assert.equal(led.moves.filter(m => m.source.type === 'till_void').length, 1)
  // Never logged again: the list has no undo for it, and there is no waste row for it.
  assert.equal((await sql`SELECT count(*)::int AS n FROM stock_waste WHERE tenant_id = ${ids.a} AND name = 'Chicken burger' AND reason = 'Dropped or spilt'`)[0].n, 0)
  // The summary counts it with the logged entries.
  const sum = await ok(owner.get(`/api/stock/venues/${soho}/waste/summary?by=kind`))
  assert.ok(sum.till_voids >= 1)
  assert.ok(sum.rows.some(r => r.key === 'preparation'))
  const byItem = await ok(owner.get(`/api/stock/venues/${soho}/waste/summary?by=item`))
  assert.ok(byItem.rows.find(r => r.label === 'Chicken thighs').qty > 0)
})

test('the list and summary for View without values; a photo; Use logs, View can\'t', async () => {
  const day = await ok(viewer.get(`/api/stock/venues/${soho}/waste`))
  assert.ok(day.entries.length > 0)
  assert.equal(JSON.stringify(day).includes('"value":'), false, 'no values without Costing view')
  assert.equal((await viewer.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: onion.id, qty: 1, unit: 'kg', reason_id: reason('Gone off') })).status, 403)
  const pick = await ok(operator.get(`/api/stock/venues/${soho}/waste/pickers`))
  assert.ok(pick.items.some(i => i.name === 'Chicken thighs'))
  assert.deepEqual(pick.recipes.map(r => r.name), ['Spiced onions'], 'prep recipes only')
  assert.ok(pick.dishes.some(d => d.name === 'Chicken burger'))
  // A photo of it, by whoever logged it.
  const e = await ok(operator.post(`/api/stock/venues/${soho}/waste`, { what: 'item', item_id: onion.id, qty: 200, unit: 'g', reason_id: reason('Trim and peelings') }))
  const app = await getApp()
  const boundary = '----waste' + Date.now()
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bin.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const up = await app.inject({
    method: 'POST', url: `/api/stock/waste/${e.id}/photo`, payload,
    headers: { authorization: 'Bearer test:' + A.operator, 'x-tenant-id': ids.a, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, 'content-type': 'multipart/form-data; boundary=' + boundary },
  })
  assert.equal(up.statusCode, 200, up.body)
  assert.match(up.json().photo_url, /waste/)
  const listed = (await ok(operator.get(`/api/stock/venues/${soho}/waste`))).entries.find(x => x.id === e.id)
  assert.ok(listed.photo_url)
})

test('another group\'s venue, item, recipe, dish, reason and waste are refused', async () => {
  const body = { what: 'item', item_id: chicken.id, qty: 1, unit: 'kg', reason_id: reason('Gone off') }
  assert.equal((await owner.post(`/api/stock/venues/${VB}/waste`, body)).status, 404, 'their venue')
  assert.equal((await owner.post(`/api/stock/venues/${soho}/waste`, { ...body, item_id: bItem.id })).status, 404, 'their item')
  assert.equal((await owner.post(`/api/stock/venues/${soho}/waste`, { what: 'recipe', recipe_id: bRecipe.id, qty: 1, unit: 'l', reason_id: reason('Gone off') })).status, 404, 'their recipe')
  assert.equal((await owner.post(`/api/stock/venues/${soho}/waste`, { what: 'dish', dish_id: bDish, qty: 1, reason_id: reason('Gone off') })).status, 404, 'their dish')
  assert.equal((await owner.post(`/api/stock/venues/${soho}/waste`, { ...body, reason_id: bReason.id })).status, 404, 'their reason')
  assert.equal((await owner.put('/api/stock/waste-reasons/' + bReason.id, { name: 'Mine', kind: 'plate', is_active: true })).status, 404)
  assert.equal((await owner.delete('/api/stock/waste-reasons/' + bReason.id)).status, 404)
  const theirs = await ok(bOwner.post(`/api/stock/venues/${VB}/waste`, { what: 'item', item_id: bItem.id, qty: 5, unit: 'g', reason_id: bReason.id }))
  assert.equal((await owner.post(`/api/stock/waste/${theirs.id}/undo`, {})).status, 404, 'their waste')
  assert.equal((await owner.post(`/api/stock/waste/${theirs.id}/reverse`, {})).status, 404)
  assert.equal((await owner.get(`/api/stock/venues/${VB}/waste`)).status, 404)
  const mine = await ok(owner.get(`/api/stock/venues/${soho}/waste`))
  assert.equal(JSON.stringify(mine).includes('B flour'), false)
  assert.equal((await owner.post(`/api/stock/venues/${soho}/waste`, { what: 'dish', dish_id: burger, qty: 1, revenue_stream_id: randomUUID(), reason_id: reason('Gone off') })).status, 404, 'a stream that isn\'t at this venue')
})

// ── Pepper and reports ──

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function pepper(sub, name, input, { run = true } = {}) {
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
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { tool, ctx, card, out: run ? await tool.run(ctx, parsed) : null }
}

test('Pepper: "we dropped a tray of chicken thighs" is logged with its reason, the card first; Undo takes it back', async () => {
  const before = (await onHand(owner, soho))['Chicken thighs'].on_hand
  const { tool, card } = await pepper(A.operator, 'log_waste', { venue: 'Soho', thing: 'chicken thighs', qty: 1, unit: 'tray', reason: 'dropped' }, { run: false })
  assert.equal(tool.class, 'reversible')
  assert.equal(tool.needs, 'use')
  assert.match(card.lines[0], /tray/)
  assert.match(card.lines[0], /Dropped or spilt \(preparation\)/)
  assert.match(card.lines[1], /^Takes off: Chicken thighs 2\.5 kg/)
  const { out, ctx } = await pepper(A.operator, 'log_waste', { venue: 'Soho', thing: 'chicken thighs', qty: 1, unit: 'tray', reason: 'dropped' })
  assert.match(out.message, /taken off stock/)
  assert.doesNotMatch(JSON.stringify({ ...out, _undo: undefined }), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'names, never ids')
  assert.equal((await onHand(owner, soho))['Chicken thighs'].on_hand, before - 2500)
  const back = await tool.inverse(ctx, out._undo)
  assert.match(back.message, /Undone/)
  assert.equal((await onHand(owner, soho))['Chicken thighs'].on_hand, before)
  // A dish by name, taken away (its own recipe); a draft recipe says so on the card.
  const dish = await pepper(A.owner, 'log_waste', { venue: 'Soho', thing: 'Chicken burger', qty: 2, reason: 'Sent back by a guest', order_type: 'take out' }, { run: false })
  assert.match(dish.card.lines[1], /Chicken thighs 400 g/)
  const w = await pepper(A.owner, 'log_waste', { venue: 'Soho', thing: 'wings', what: 'dish', qty: 1, reason: 'Left on the plate' }, { run: false })
  assert.match(w.card.warnings.join(' '), /not checked yet/)
  const batch = await pepper(A.owner, 'log_waste', { venue: 'Soho', thing: 'spiced onions', qty: 0.5, unit: 'kg', reason: 'Made too much' }, { run: false })
  assert.match(batch.card.lines[1], /Onions 625 g/)
  await assert.rejects(pepper(A.viewer, 'log_waste', { venue: 'Soho', thing: 'chicken thighs', qty: 1, reason: 'dropped' }), /permission/)
  await assert.rejects(pepper(A.owner, 'log_waste', { venue: 'Soho', thing: 'chicken thighs', qty: 1, unit: 'slice', reason: 'dropped' }), /no size for slice/)
  await assert.rejects(pepper(A.owner, 'log_waste', { venue: 'Soho', thing: 'chicken thighs', qty: 1, reason: 'stolen by a fox' }), /waste reason/)
})

test('Pepper: waste_summary by reason and item, values only with Costing view', async () => {
  const own = await pepper(A.owner, 'waste_summary', { venue: 'Soho', by: 'reason' })
  assert.equal(own.tool.class, 'read')
  assert.ok(own.out.rows.length > 0)
  assert.ok(own.out.value, 'the owner sees the value')
  const op = await pepper(A.operator, 'waste_summary', { venue: 'Soho', by: 'item', days: 3 })
  assert.ok(op.out.rows.some(r => r.item === 'Chicken thighs'))
  assert.equal(JSON.stringify(op.out).includes('£'), false, 'no values without Costing view')
})

test('the report subject Waste: logged entries and till voids by item, test sales left out; the starter', async () => {
  const run = spec => ok(owner.post('/api/reports/preview', { spec }))
  const period = { params: [{ key: 'period', type: 'period', default: { relative: 'this_year' } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
  const rows = await run({ kind: 'list', subject: 'stock.waste', rows: ['source', 'name', 'item_name', 'qty', 'reason', 'kind', 'value'], ...period })
  const voids = rows.rows.filter(r => /till/i.test(r.cells[0]))
  assert.deepEqual(voids.map(r => [r.cells[2], r.cells[3]]).sort(), [['Chicken thighs', 300], ['Onions', 125]], 'the void marked wasted once, broken into items; no test sales')
  assert.ok(rows.rows.some(r => /logged/i.test(r.cells[0]) && r.cells[1] === 'Chips' && r.cells[2] == null), 'a dish with no recipe is a row with no item')
  const byKind = await run({ subject: 'stock.waste', rows: ['kind'], values: [{ measure: 'entries' }, { measure: 'waste_value' }], ...period })
  assert.ok(byKind.rows.length >= 2)
  const st = await ok(owner.post('/api/reports/starter:stock_waste_by_reason_week/run', {}))
  assert.ok(st.rows.length >= 1, 'this week\'s waste by reason')
  // Without Costing view the value is refused or left out.
  const v = await viewer.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.waste', rows: ['name', 'value'], ...period } })
  assert.ok(v.status >= 400 || !JSON.stringify(v.json.columns || []).includes('"value"'), v.body.slice(0, 200))
  // The ledger subject has waste moves with their value.
  const moves = await run({ kind: 'list', subject: 'stock.moves', rows: ['item_name', 'kind', 'change', 'value'], ...period })
  assert.ok(moves.rows.some(r => (r.cells[1] === 'Waste' || r.cells[1] === 'waste') && r.cells[2] < 0))
})

test('the plain forms Log waste and Send stock: the routes\' own schemas, the item, batch or dish drawn by what was wasted', async () => {
  const { plainFields } = await import('../src/forms/index.js')
  const waste = plainFields('stock_waste')
  assert.deepEqual(waste.map(f => f.key), ['what', 'item_id', 'recipe_id', 'dish_id', 'qty', 'unit', 'order_type_id', 'reason_id', 'note'])
  assert.deepEqual(waste.find(f => f.key === 'recipe_id').when, { what: 'recipe' })
  assert.equal(waste.find(f => f.key === 'reason_id').options.list, 'reasons')
  const send = plainFields('stock_transfer')
  assert.deepEqual(send.map(f => f.key), ['to_venue_id', 'item_id', 'qty', 'unit', 'note'])
  // The form's save is the route: one item sent with item_id, qty and unit.
  const t = await ok(owner.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: onion.id, qty: 100, unit: 'g' }))
  assert.equal(t.lines.length, 1)
  await ok(owner.post(`/api/stock/transfers/${t.id}/cancel`, {}))
})
