// Adding products to a purchase order that hasn't been sent: PUT
// /api/purchasing/pos/:id/lines with `add` (the supplier's own active
// prices, quantities rounded up to the minimum and steps, at the venue's
// price), and the catalogue limited to one supplier (?supplier_id=) for the
// purchase order page's picker. Checked here: what a new line copies, that a
// product already on the order tops its line up instead of making a second
// line, the refusals (another supplier, another tenant, a switched-off item
// or price, a sent order, people without approval) and prices kept from
// people who don't see them; and Pepper's change_purchase_order doing the
// same through the routes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { orderTotals, poNumberLabel } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, operator, viewer, otherOwner, V, list, opRole
let farm, other, theirFarm, rice, oil, chilli, riceSack, oilTin, oilBottle, chilliBox, flourBag, theirQuote, poId

/** Places an order for rice from the list: the farm's purchase order, waiting in To send. */
async function placeRice(qty) {
  const draft = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'order')
  await ok(owner.put(`/api/purchasing/orders/${draft.id}/lines`, { lines: [{ item_id: rice.id, qty }] }), 'order lines')
  // Its own purchase order each time (the venue already has one for the day).
  const placed = await ok(owner.post(`/api/purchasing/orders/${draft.id}/submit`, { suppliers: { [farm.id]: { existing: 'separate' } } }), 'place')
  return placed.purchase_orders.find(p => p.supplier_id === farm.id).id
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)
  opRole = (await ok(owner.get('/api/access/roles'))).find(r => r.key === 'operator')

  farm = await ok(owner.post('/api/suppliers', { name: 'Adding Farm', send_method: 'print', lead_days: 1 }), 'supplier')
  other = await ok(owner.post('/api/suppliers', { name: 'Other Mill', send_method: 'print', lead_days: 1 }), 'other supplier')
  const item = (who, name, base) => ok(who.post('/api/inventory/items', { name, base_unit: base }), name)
  const quotes = async (who, it, body) => (await ok(who.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price')).quotes
  rice = await item(owner, 'Basmati rice', 'g')
  oil = await item(owner, 'Rapeseed oil', 'ml')
  chilli = await item(owner, 'Dried chilli', 'g')
  const flour = await item(owner, 'Strong flour', 'g')
  ;[riceSack] = await quotes(owner, rice, { supplier_id: farm.id, pack_name: 'Sack', pack_qty: 20, pack_unit: 'kg', price: 30 })
  ;[oilTin] = await quotes(owner, oil, {
    supplier_id: farm.id, supplier_code: 'OIL-5', product_name: 'Golden rapeseed 5l', pack_name: 'Tin', pack_qty: 5, pack_unit: 'l',
    price: 12, vat_rate: 20, min_qty: 2, order_multiple: 2,
  })
  oilBottle = (await quotes(owner, oil, { supplier_id: farm.id, pack_name: 'Bottle', pack_qty: 1, pack_unit: 'l', price: 3 })).find(q => q.id !== oilTin.id)
  ;[chilliBox] = await quotes(owner, chilli, { supplier_id: farm.id, pack_name: 'Box', pack_qty: 1, pack_unit: 'kg', price: 9 })
  ;[flourBag] = await quotes(owner, flour, { supplier_id: other.id, pack_name: 'Bag', pack_qty: 16, pack_unit: 'kg', price: 14 })
  // The tin costs this venue less than the company price.
  await ok(owner.put(`/api/inventory/quotes/${oilTin.id}/venue-prices`, { prices: [{ venue_id: V, price: 11 }] }), 'venue price')

  // The other tenant's supplier and product.
  theirFarm = await ok(otherOwner.post('/api/suppliers', { name: 'B Farm', send_method: 'print' }), 'b supplier')
  const theirOil = await item(otherOwner, 'B oil', 'ml')
  ;[theirQuote] = await quotes(otherOwner, theirOil, { supplier_id: theirFarm.id, pack_name: 'Tin', pack_qty: 5, pack_unit: 'l', price: 10 })

  list = await ok(owner.post('/api/purchasing/lists', { name: 'Adding list', venue_ids: [V], item_ids: [rice.id] }), 'list')
  poId = await placeRice(4)
})
after(closeApp)

const lineOf = (po, name) => po.lines.filter(l => l.item_name === name)
const addTo = (who, id, quoteId, qty = 1) => who.put(`/api/purchasing/pos/${id}/lines`, { add: [{ quote_id: quoteId, qty }] })

test('the catalogue lists only what one supplier sells', async () => {
  const mine = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?supplier_id=${farm.id}`))
  assert.deepEqual(mine.map(i => i.name), ['Basmati rice', 'Dried chilli', 'Rapeseed oil'], 'another supplier\'s item is left out')
  const oils = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?supplier_id=${farm.id}&search=rapeseed`))
  assert.deepEqual(oils.map(i => i.name), ['Rapeseed oil'])
  assert.deepEqual(oils[0].quotes.map(q => q.id).sort(), [oilTin.id, oilBottle.id].sort(), 'both packs')
  assert.equal(oils[0].quotes.find(q => q.id === oilTin.id).price, 11, 'the venue\'s price')

  const theirs = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?supplier_id=${other.id}`))
  assert.deepEqual(theirs.map(i => i.name), ['Strong flour'])
  // ?all=1 doesn't widen one supplier's list to items nobody sells.
  const all = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?supplier_id=${other.id}&all=1`))
  assert.deepEqual(all.map(i => i.name), ['Strong flour'])
  const everyone = await ok(owner.get(`/api/purchasing/venues/${V}/catalog?search=strong`))
  assert.deepEqual(everyone.map(i => i.name), ['Strong flour'], 'without a supplier: what anyone sells')

  assert.equal((await owner.get(`/api/purchasing/venues/${V}/catalog?supplier_id=nope`)).status, 400)
  assert.deepEqual(await ok(owner.get(`/api/purchasing/venues/${V}/catalog?supplier_id=${theirFarm.id}`)), [], 'another tenant\'s supplier sells nothing here')
})

test('an approver adds products to an order waiting in To send', async () => {
  const first = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  assert.equal(first.status, 'to_send')
  assert.equal(first.lines.length, 1)

  const d = await ok(owner.put(`/api/purchasing/pos/${poId}/lines`, { add: [{ quote_id: oilTin.id, qty: 3 }, { quote_id: oilBottle.id, qty: 1 }] }), 'add')
  assert.deepEqual(d.lines.map(l => l.item_name), ['Basmati rice', 'Rapeseed oil', 'Rapeseed oil'], 'after the lines already there')
  const tin = d.lines.find(l => l.quote_id === oilTin.id)
  assert.equal(tin.qty, 4, 'rounded up to the minimum and steps (3 to 4)')
  assert.equal(tin.price, 11, 'the venue\'s price')
  assert.equal(tin.vat_rate, 20)
  assert.equal(tin.pack_label, 'Tin · 5 l')
  assert.equal(tin.product_name, 'Golden rapeseed 5l')
  assert.equal(tin.supplier_code, 'OIL-5')
  assert.equal(tin.item_id, oil.id)
  assert.equal(tin.added_on_receipt, false)
  const bottle = d.lines.find(l => l.quote_id === oilBottle.id)
  assert.equal(bottle.qty, 1)
  assert.equal(bottle.price, 3)
  const t = orderTotals(d.lines, d.delivery_charge)
  assert.equal(d.subtotal, 4 * 30 + 4 * 11 + 3)
  assert.equal(d.subtotal, t.subtotal)
  assert.equal(d.vat, t.vat)
  assert.equal(d.total, t.total)
  assert.equal(d.status, 'to_send')
  assert.equal(d.amended_at, null, 'nothing went to the supplier, so nothing is amended')
})

test('a product already on the order tops its line up', async () => {
  let d = await ok(addTo(owner, poId, riceSack.id, 2))
  assert.equal(lineOf(d, 'Basmati rice').length, 1, 'no second rice line')
  assert.equal(lineOf(d, 'Basmati rice')[0].qty, 6)

  // A quantity change and an add of the same product in one save: the add goes on top.
  const rl = lineOf(d, 'Basmati rice')[0]
  d = await ok(owner.put(`/api/purchasing/pos/${poId}/lines`, { lines: [{ id: rl.id, qty: 1 }], add: [{ quote_id: riceSack.id, qty: 2 }] }))
  assert.equal(lineOf(d, 'Basmati rice')[0].qty, 3)

  // The same product twice in one add; the tin topped up past its steps.
  d = await ok(owner.put(`/api/purchasing/pos/${poId}/lines`, {
    add: [{ quote_id: chilliBox.id, qty: 1 }, { quote_id: chilliBox.id, qty: 2 }, { quote_id: oilTin.id, qty: 1 }],
  }))
  assert.equal(lineOf(d, 'Dried chilli').length, 1)
  assert.equal(lineOf(d, 'Dried chilli')[0].qty, 3)
  assert.equal(d.lines.find(l => l.quote_id === oilTin.id).qty, 6, '4 + 1 rounds up to 6')

  // A line taken off and added again in the same save comes back as a new line.
  const chilliLine = lineOf(d, 'Dried chilli')[0]
  d = await ok(owner.put(`/api/purchasing/pos/${poId}/lines`, { lines: [{ id: chilliLine.id, qty: 0 }], add: [{ quote_id: chilliBox.id, qty: 5 }] }))
  assert.equal(lineOf(d, 'Dried chilli').length, 1)
  assert.equal(lineOf(d, 'Dried chilli')[0].qty, 5)
  assert.notEqual(lineOf(d, 'Dried chilli')[0].id, chilliLine.id)
  assert.equal(d.subtotal, orderTotals(d.lines, d.delivery_charge).subtotal)
})

test('refusals: another supplier, another tenant, switched off, sent, no approval', async () => {
  const count = async () => (await ok(owner.get(`/api/purchasing/pos/${poId}`))).lines.length
  const n = await count()

  let r = await addTo(owner, poId, flourBag.id)
  assert.equal(r.status, 422, 'another supplier\'s product')
  assert.match(r.json.error, /not from this supplier/)
  assert.equal((await addTo(owner, poId, theirQuote.id)).status, 422, 'another tenant\'s product')
  assert.equal((await addTo(owner, poId, '00000000-0000-4000-8000-000000000000')).status, 422, 'no such product')
  assert.equal((await addTo(owner, poId, oilBottle.id, 0)).status, 400, 'nothing to add')

  await ok(owner.patch(`/api/inventory/items/${chilli.id}`, { is_active: false }), 'chilli off')
  r = await addTo(owner, poId, chilliBox.id)
  assert.equal(r.status, 422)
  assert.match(r.json.error, /Dried chilli is switched off/)
  await ok(owner.patch(`/api/inventory/items/${chilli.id}`, { is_active: true }), 'chilli on')
  await ok(owner.patch(`/api/inventory/quotes/${oilBottle.id}`, { is_active: false }), 'bottle price off')
  assert.equal((await addTo(owner, poId, oilBottle.id)).status, 422, 'a switched-off price')
  await ok(owner.patch(`/api/inventory/quotes/${oilBottle.id}`, { is_active: true }), 'bottle price on')

  assert.equal((await addTo(viewer, poId, oilBottle.id)).status, 403, 'a viewer')
  await ok(owner.patch(`/api/access/roles/${opRole.id}`, { permissions: { purchasing: 'manage', purchasing_approve: 'none' } }), 'no approval')
  assert.equal((await addTo(operator, poId, oilBottle.id)).status, 403, 'ordering without approval')
  assert.equal((await addTo(otherOwner, poId, theirQuote.id)).status, 404, 'another tenant\'s order')
  assert.equal(await count(), n, 'nothing was added')

  // Once it has gone to the supplier it can't change.
  const sent = await placeRice(1)
  await ok(owner.post(`/api/purchasing/pos/${sent}/mark-sent`, { via: 'phone' }), 'mark sent')
  r = await addTo(owner, sent, chilliBox.id)
  assert.equal(r.status, 409)
  assert.equal((await ok(owner.get(`/api/purchasing/pos/${sent}`))).lines.length, 1)
})

test('someone who approves but doesn\'t see prices adds without seeing them', async () => {
  await ok(owner.patch(`/api/access/roles/${opRole.id}`, {
    permissions: { purchasing: 'manage', purchasing_approve: 'manage', purchasing_setup: 'none' },
  }), 'approval without prices')
  const meta = await ok(operator.get('/api/purchasing/meta'))
  assert.equal(meta.can_approve, true)
  assert.equal(meta.show_prices, false)

  const cat = await ok(operator.get(`/api/purchasing/venues/${V}/catalog?supplier_id=${farm.id}&search=rapeseed`))
  assert.ok(cat[0].quotes.every(q => q.price === undefined), 'no prices in the picker')
  const d = await ok(operator.put(`/api/purchasing/pos/${poId}/lines`, { add: [{ quote_id: oilBottle.id, qty: 2 }] }))
  const bottle = d.lines.find(l => l.quote_id === oilBottle.id)
  assert.equal(bottle.qty, 3, 'topped up from 1 to 3')
  assert.equal(bottle.price, undefined)
  assert.equal(d.total, undefined)
  const seen = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  assert.equal(seen.lines.find(l => l.quote_id === oilBottle.id).price, 3, 'the price is still stored')
  await ok(owner.patch(`/api/access/roles/${opRole.id}`, { permissions: {} }), 'operator back to the defaults')
})

// ── Pepper ──────────────────────────────────────────────

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

/** A staff tool as the person, the way the staff connector runs it: the card first, then the change. */
async function pepper(sub, name, input) {
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_mcp', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { card, out: await tool.run(ctx, parsed) }
}

test('Pepper adds a product, and tops up one already on the order', async () => {
  const start = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  const po = poNumberLabel(start.number)
  assert.equal(lineOf(start, 'Basmati rice')[0].qty, 3)
  const { card, out } = await pepper(A.owner, 'change_purchase_order', { po, add: [{ item: 'basmati', quantity: 2 }] })
  assert.ok(card.lines.includes('Basmati rice (Sack · 20 kg): 3 to 5, already on the order'), card.lines.join(' | '))
  assert.match(out.message, /Saved/)
  const topped = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  assert.equal(lineOf(topped, 'Basmati rice').length, 1)
  assert.equal(lineOf(topped, 'Basmati rice')[0].qty, 5)

  // The search is this supplier's products only: another supplier's isn't found.
  await assert.rejects(pepper(A.owner, 'change_purchase_order', { po, add: [{ item: 'strong flour', quantity: 1 }] }),
    err => err.status === 404 && /has no price for "strong flour"/.test(err.message))

  // A product not on the order: a new line, the quantity rounded up and said so.
  const tinLine = topped.lines.find(l => l.quote_id === oilTin.id)
  await ok(owner.put(`/api/purchasing/pos/${poId}/lines`, { lines: [{ id: tinLine.id, qty: 0 }] }), 'tin off')
  const res = await pepper(A.owner, 'change_purchase_order', { po, add: [{ item: 'rapeseed', quantity: 3, pack: 'tin' }] })
  assert.ok(res.card.lines.includes('Add 4 x Rapeseed oil (Tin · 5 l)'), res.card.lines.join(' | '))
  assert.ok(res.card.warnings.some(w => /3 becomes 4/.test(w)), res.card.warnings.join(' | '))
  const last = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  assert.equal(last.lines.filter(l => l.quote_id === oilTin.id).length, 1)
  assert.equal(last.lines.find(l => l.quote_id === oilTin.id).qty, 4)
})
