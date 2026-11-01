// Purchasing orders that change only when someone changes them (1 Nov
// 2026). Checked here:
//   - a line with a quantity stays on the supplier price it was filled in on
//     (supply_order_lines.quote_id): a new usual supplier doesn't move it;
//     a price, supplier or item switched off shows on the order (gone) and
//     stops it being placed or sent for approval, never quietly another
//     supplier's price;
//   - prices and suppliers on open orders can't be deleted (switched off
//     instead), an item on one is switched off rather than deleted;
//   - a new pack size (edited, or by import) keeps the amount ordered;
//   - the import takes the minimum order and steps;
//   - delivery days are checked wherever one is picked (placing, a request
//     placed later, splitting a request or a purchase order, moving a
//     purchase order): a past day never, a day the supplier doesn't deliver
//     or one past its order deadline only when agreed with the supplier;
//   - minimums and steps hold when a purchase order's quantities change or
//     it is split;
//   - Pepper's tools follow the same rules;
//   - migration 232 pins lines saved before.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays, weekdayOf, nowAt, poNumberLabel } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, operator, viewer, otherOwner, V
let farm, mill, jay, weekly, rice, farmBag, farmSack, millSack, lentils, lentilSack, beef, beefBox, cod, codBox, chicken, chickenCase

const today = () => nowAt('Europe/London').date
const day = n => addDays(today(), n)
const quotesOf = async (it, body) => (await ok(owner.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price')).quotes
const newItem = (name, base = 'g') => ok(owner.post('/api/inventory/items', { name, base_unit: base }), name)
const listOf = (name, items) => ok(owner.post('/api/purchasing/lists', { name, venue_ids: [V], item_ids: items.map(i => i.id) }), name)
const draftFor = list => ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft order')
const setLines = (order, lines) => ok(owner.put(`/api/purchasing/orders/${order.id}/lines`, { lines }), 'order lines')
const getOrder = id => ok(owner.get(`/api/purchasing/orders/${id}`), 'order')
const itemOf = (order, item) => order.items.find(i => i.item_id === item.id)
const stored = async (orderId, itemId) => (await sql`
  SELECT quote_id, qty::float8 AS qty FROM supply_order_lines WHERE order_id = ${orderId} AND item_id = ${itemId}
`)[0]
const quoteRow = async id => (await sql`
  SELECT pack_base_qty::float8 AS pack_base_qty, min_qty::float8 AS min_qty, order_multiple::float8 AS order_multiple
    FROM inv_quotes WHERE id = ${id}
`)[0]
const csv = text => Buffer.from(text).toString('base64')

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)

  // Any day from tomorrow (no delivery days listed, no cutoff, a day's notice).
  farm = await ok(owner.post('/api/suppliers', { name: 'Pin Farm', send_method: 'print', lead_days: 1 }), 'farm')
  mill = await ok(owner.post('/api/suppliers', { name: 'Pin Mill', send_method: 'print', lead_days: 1 }), 'mill')
  // Three days' notice: tomorrow and the day after are always too late.
  jay = await ok(owner.post('/api/suppliers', { name: 'Jay Meats', send_method: 'print', lead_days: 3 }), 'jay')
  // One delivery day a week: the weekday five days from now.
  weekly = await ok(owner.post('/api/suppliers', { name: 'Weekly Fish', send_method: 'print', lead_days: 1, delivery_days: [weekdayOf(day(5))] }), 'weekly')

  rice = await newItem('Long grain rice')
  ;[farmBag] = await quotesOf(rice, { supplier_id: farm.id, pack_name: 'Bag', pack_qty: 5, pack_unit: 'kg', price: 10 })
  farmSack = (await quotesOf(rice, { supplier_id: farm.id, pack_name: 'Sack', pack_qty: 10, pack_unit: 'kg', price: 18 })).find(q => q.id !== farmBag.id)
  millSack = (await quotesOf(rice, { supplier_id: mill.id, pack_name: 'Sack', pack_qty: 10, pack_unit: 'kg', price: 15 })).find(q => q.supplier_id === mill.id)
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: V, quote_id: farmBag.id }), 'rice: the bag here')

  lentils = await newItem('Red lentils')
  ;[lentilSack] = await quotesOf(lentils, { supplier_id: farm.id, supplier_code: 'LEN-5', pack_name: 'Sack', pack_qty: 5, pack_unit: 'kg', price: 7 })
  beef = await newItem('Beef mince')
  ;[beefBox] = await quotesOf(beef, { supplier_id: jay.id, pack_name: 'Box', pack_qty: 1, pack_unit: 'kg', price: 8 })
  cod = await newItem('Cod loin')
  ;[codBox] = await quotesOf(cod, { supplier_id: weekly.id, pack_name: 'Box', pack_qty: 2, pack_unit: 'kg', price: 20 })
  chicken = await newItem('Chicken thighs')
  ;[chickenCase] = await quotesOf(chicken, { supplier_id: farm.id, pack_name: 'Case', pack_qty: 1, pack_unit: 'kg', price: 5, min_qty: 20, order_multiple: 2 })
})
after(closeApp)

test('a line stays on the price it was filled in on', async () => {
  const list = await listOf('Pinning', [rice])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: rice.id, qty: 3 }])
  assert.equal((await stored(o.id, rice.id)).quote_id, farmBag.id, 'no price given: pinned to the usual one')

  // A new usual supplier here: the line doesn't follow it.
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: V, quote_id: millSack.id }), 'now the mill')
  let got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.quote.id, farmBag.id, 'still the bag')
  assert.equal(got.default_quote_id, millSack.id, 'the usual one is the mill now')
  assert.equal(got.qty, 3)
  assert.equal(got.gone, undefined)

  // A new quantity without a price keeps the one it has.
  await setLines(o, [{ item_id: rice.id, qty: 4 }])
  assert.deepEqual(await stored(o.id, rice.id), { quote_id: farmBag.id, qty: 4 })
  // Taken to 0 it keeps the pick too; back up, still the bag.
  await setLines(o, [{ item_id: rice.id, qty: 0 }])
  await setLines(o, [{ item_id: rice.id, qty: 2 }])
  assert.equal((await stored(o.id, rice.id)).quote_id, farmBag.id)

  // A line saved on a price is placed on it: the farm's bag, not the mill.
  const placed = await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, {}), 'place')
  assert.deepEqual(placed.purchase_orders.map(p => p.supplier_id), [farm.id])
  const po = await ok(owner.get(`/api/purchasing/pos/${placed.purchase_orders[0].id}`))
  assert.equal(po.lines[0].quote_id, farmBag.id)
  assert.equal(po.lines[0].qty, 2)
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: V, quote_id: farmBag.id }), 'back to the bag')
})

test('a switched-off price, supplier or item shows on the order and stops it being placed', async () => {
  const list = await listOf('Gone', [rice])
  let o = await draftFor(list)
  await setLines(o, [{ item_id: rice.id, quote_id: farmBag.id, qty: 3 }])

  // The bag is switched off: the line says so instead of moving to a sack.
  await ok(owner.patch(`/api/inventory/quotes/${farmBag.id}`, { is_active: false }), 'bag off')
  let got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.gone.why, 'price_off')
  assert.equal(got.gone.quote.id, farmBag.id)
  assert.equal(got.gone.quote.supplier_name, 'Pin Farm')
  assert.equal(got.quote, null, 'no price is shown as the one it will go on')
  assert.equal(got.qty, 3)
  assert.equal((await stored(o.id, rice.id)).quote_id, farmBag.id, 'nothing changed in the order')

  let r = await owner.post(`/api/purchasing/orders/${o.id}/submit`, {})
  assert.equal(r.status, 422)
  assert.equal(r.json.code, 'order_lines')
  assert.deepEqual(r.json.gone_items, ['Long grain rice'])
  assert.match(r.json.error, /The price picked for Long grain rice is no longer offered/)
  r = await owner.post(`/api/purchasing/orders/${o.id}/request`, {})
  assert.equal(r.status, 422, 'nor sent for approval')
  assert.equal(r.json.code, 'order_lines')
  assert.equal((await getOrder(o.id)).status, 'draft')

  // Picking another price puts it right (the screen converts the amount).
  await setLines(o, [{ item_id: rice.id, quote_id: farmSack.id, qty: 2 }])
  got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.gone, undefined)
  assert.equal(got.quote.id, farmSack.id)
  const placed = await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, {}), 'place on the sack')
  const po = await ok(owner.get(`/api/purchasing/pos/${placed.purchase_orders[0].id}`))
  assert.deepEqual([po.lines[0].quote_id, po.lines[0].qty], [farmSack.id, 2])
  await ok(owner.patch(`/api/inventory/quotes/${farmBag.id}`, { is_active: true }), 'bag back')

  // The supplier switched off.
  o = await draftFor(list)
  await setLines(o, [{ item_id: rice.id, quote_id: millSack.id, qty: 1 }])
  await ok(owner.patch(`/api/suppliers/${mill.id}`, { is_active: false }), 'mill off')
  got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.gone.why, 'supplier_off')
  assert.equal(got.gone.quote.supplier_name, 'Pin Mill')
  r = await owner.post(`/api/purchasing/orders/${o.id}/submit`, {})
  assert.equal(r.status, 422)
  assert.deepEqual(r.json.gone_items, ['Long grain rice'])
  await ok(owner.patch(`/api/suppliers/${mill.id}`, { is_active: true }), 'mill back')
  got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.gone, undefined, 'back on: the line is fine again')
  assert.equal(got.quote.id, millSack.id)

  // The item switched off.
  await ok(owner.patch(`/api/inventory/items/${rice.id}`, { is_active: false }), 'rice off')
  got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.gone.why, 'item_off')
  r = await owner.post(`/api/purchasing/orders/${o.id}/submit`, {})
  assert.equal(r.status, 422)
  assert.deepEqual(r.json.off_items, ['Long grain rice'])
  assert.match(r.json.error, /Long grain rice is switched off in the inventory: take it off the order/)
  await setLines(o, [{ item_id: rice.id, qty: 0 }])
  got = itemOf(await getOrder(o.id), rice)
  assert.equal(got.gone, undefined, 'taken off: nothing to say')
  await ok(owner.patch(`/api/inventory/items/${rice.id}`, { is_active: true }), 'rice back')
  await ok(owner.delete(`/api/purchasing/orders/${o.id}`), 'drop the draft')
})

test('prices and suppliers on open orders are switched off, not deleted', async () => {
  const spare = await ok(owner.post('/api/suppliers', { name: 'Spare Co', send_method: 'print' }), 'spare')
  const saffron = await newItem('Saffron')
  const [tub] = await quotesOf(saffron, { supplier_id: spare.id, pack_name: 'Tub', pack_qty: 10, pack_unit: 'g', price: 12 })
  const list = await listOf('Deleting', [rice, saffron])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: rice.id, quote_id: farmBag.id, qty: 2 }, { item_id: saffron.id, quote_id: tub.id, qty: 1 }])

  let r = await owner.delete(`/api/inventory/quotes/${farmBag.id}`)
  assert.equal(r.status, 409)
  assert.equal(r.json.code, 'on_open_order')
  assert.match(r.json.error, /on an open order at .*Switch it off instead/)
  r = await owner.delete(`/api/suppliers/${spare.id}`)
  assert.equal(r.status, 409)
  assert.equal(r.json.code, 'on_open_order')
  assert.match(r.json.error, /Switch the supplier off instead/)
  assert.ok((await sql`SELECT 1 FROM inv_quotes WHERE id = ${tub.id}`).length, 'its price is still there')

  // A request waiting for approval counts as open too.
  await ok(owner.post(`/api/purchasing/orders/${o.id}/request`, {}), 'request')
  assert.equal((await owner.delete(`/api/inventory/quotes/${tub.id}`)).status, 409)

  // Once no open order has a quantity on them, they go.
  await ok(owner.post(`/api/purchasing/orders/${o.id}/withdraw`, {}), 'withdraw')
  await setLines(o, [{ item_id: saffron.id, qty: 0 }])
  await ok(owner.delete(`/api/inventory/quotes/${tub.id}`), 'the tub goes')
  await ok(owner.delete(`/api/suppliers/${spare.id}`), 'the supplier goes')

  // An item on an open order is switched off, not deleted (the order then
  // says so); one on no order, or at 0, goes.
  const anise = await newItem('Star anise')
  await quotesOf(anise, { supplier_id: farm.id, pack_name: 'Jar', pack_qty: 100, pack_unit: 'g', price: 4 })
  await setLines(o, [{ item_id: anise.id, qty: 1 }])
  assert.deepEqual(await ok(owner.delete(`/api/inventory/items/${anise.id}`), 'anise'), { archived: true })
  assert.equal((await sql`SELECT is_active FROM inv_items WHERE id = ${anise.id}`)[0].is_active, false)
  assert.equal(itemOf(await getOrder(o.id), anise).gone.why, 'item_off', 'and the order says so')
  assert.deepEqual(await ok(owner.delete(`/api/inventory/items/${saffron.id}`), 'saffron'), { deleted: true }, 'at 0 on the order: it goes')

  // Viewers and the other tenant can't delete anything here.
  assert.equal((await viewer.delete(`/api/inventory/quotes/${farmBag.id}`)).status, 403)
  assert.equal((await otherOwner.delete(`/api/inventory/quotes/${farmBag.id}`)).status, 404)
  await ok(owner.delete(`/api/purchasing/orders/${o.id}`), 'drop the draft')
})

test('a new pack size keeps the amount ordered', async () => {
  const draft = await draftFor(await listOf('Packs draft', [lentils]))
  await setLines(draft, [{ item_id: lentils.id, qty: 3 }])
  const asked = await draftFor(await listOf('Packs request', [lentils]))
  await setLines(asked, [{ item_id: lentils.id, qty: 4 }])
  await ok(owner.post(`/api/purchasing/orders/${asked.id}/request`, {}), 'request')
  const askedQty = async () => (await sql`SELECT requested_lines FROM supply_orders WHERE id = ${asked.id}`)[0].requested_lines[lentils.id].qty

  // 3 x 5 kg is 15 kg: 2 x 10 kg (never 3 x 10 kg); 4 x 5 kg is 2 x 10 kg.
  await ok(owner.patch(`/api/inventory/quotes/${lentilSack.id}`, { pack_qty: 10 }), 'a 10 kg sack')
  assert.equal((await stored(draft.id, lentils.id)).qty, 2)
  assert.equal((await stored(asked.id, lentils.id)).qty, 2)
  assert.equal(await askedQty(), 2, 'what the request asked for, in the new packs')
  // Only the price changing: nothing moves.
  await ok(owner.patch(`/api/inventory/quotes/${lentilSack.id}`, { price: 13 }), 'a new price')
  assert.equal((await stored(draft.id, lentils.id)).qty, 2)

  // By import (matched by the supplier code): back to 5 kg, 20 kg is 4 sacks.
  const file = csv('Item,Supplier,Supplier code,Pack,Pack size,Pack unit,Price\nRed lentils,Pin Farm,LEN-5,Sack,5,kg,7\n')
  const res = await ok(owner.post('/api/inventory/import', { file }), 'import')
  assert.equal(res.quotes_updated, 1)
  assert.equal(res.order_lines_converted, 2)
  assert.equal((await stored(draft.id, lentils.id)).qty, 4)
  assert.equal((await stored(asked.id, lentils.id)).qty, 4)
  assert.equal(await askedQty(), 4)
  // A dry run converts nothing.
  const dry = await ok(owner.post('/api/inventory/import', { file: csv('Item,Supplier,Supplier code,Pack,Pack size,Pack unit,Price\nRed lentils,Pin Farm,LEN-5,Sack,20,kg,25\n'), dry_run: true }))
  assert.equal(dry.order_lines_converted, 1 + 1)
  assert.equal((await stored(draft.id, lentils.id)).qty, 4, 'rolled back')

  // The new pack's minimum counts: 4 x 5 kg = 20 kg is 1 x 25 kg, then at least 2.
  await ok(owner.patch(`/api/inventory/quotes/${lentilSack.id}`, { pack_qty: 25, min_qty: 2 }), 'a 25 kg sack, two at least')
  assert.equal((await stored(draft.id, lentils.id)).qty, 2)
  await ok(owner.patch(`/api/inventory/quotes/${lentilSack.id}`, { pack_qty: 5, min_qty: null }), 'back to 5 kg')
  await ok(owner.post(`/api/purchasing/orders/${asked.id}/withdraw`, {}), 'withdraw')
  await ok(owner.delete(`/api/purchasing/orders/${asked.id}`), 'drop')
  await ok(owner.delete(`/api/purchasing/orders/${draft.id}`), 'drop')
})

test('the import takes the minimum order and steps', async () => {
  const template = await owner.get('/api/inventory/import-template')
  assert.match(template.body.split('\n')[0], /,Minimum order,Order in steps of$/)

  const head = 'Item,Supplier,Supplier code,Pack,Pack size,Pack unit,Price,Minimum order,Order in steps of\n'
  let res = await ok(owner.post('/api/inventory/import', { file: csv(head + 'Red lentils,Pin Farm,LEN-5,Sack,5,kg,7,4,2\n') }), 'import')
  assert.deepEqual(res.errors, [])
  let q = await quoteRow(lentilSack.id)
  assert.deepEqual([q.min_qty, q.order_multiple], [4, 2])
  // Left blank: as they were.
  res = await ok(owner.post('/api/inventory/import', { file: csv(head + 'Red lentils,Pin Farm,LEN-5,Sack,5,kg,7,,\n') }), 'blank')
  q = await quoteRow(lentilSack.id)
  assert.deepEqual([q.min_qty, q.order_multiple], [4, 2])
  // Other headings for the same columns.
  res = await ok(owner.post('/api/inventory/import', { file: csv('Item,Supplier,Supplier code,Pack,Pack size,Pack unit,Price,Min qty,Step\nRed lentils,Pin Farm,LEN-5,Sack,5,kg,7,6,3\n') }))
  q = await quoteRow(lentilSack.id)
  assert.deepEqual([q.min_qty, q.order_multiple], [6, 3])
  // Not numbers above 0: the row is refused, nothing changes.
  res = await ok(owner.post('/api/inventory/import', { file: csv(head + 'Red lentils,Pin Farm,LEN-5,Sack,5,kg,7,0,2\nRed lentils,Pin Farm,LEN-5,Sack,5,kg,7,4,lots\n') }))
  assert.deepEqual(res.errors.map(e => e.error), ['Minimum order not a number of packs above 0', 'Order in steps of not a number of packs above 0'])
  q = await quoteRow(lentilSack.id)
  assert.deepEqual([q.min_qty, q.order_multiple], [6, 3])
  // A new price from the import gets them too.
  const peas = await newItem('Split peas')
  res = await ok(owner.post('/api/inventory/import', { file: csv(head + 'Split peas,Pin Farm,PEA-1,Bag,1,kg,3,10,5\n') }))
  assert.equal(res.quotes_created, 1)
  const [made] = await sql`SELECT min_qty::float8 AS min_qty, order_multiple::float8 AS order_multiple FROM inv_quotes WHERE item_id = ${peas.id}`
  assert.deepEqual([made.min_qty, made.order_multiple], [10, 5])
  await ok(owner.patch(`/api/inventory/quotes/${lentilSack.id}`, { min_qty: null, order_multiple: null }), 'tidy')
})

test('placing: a past day never, a day the supplier can\'t make only when agreed', async () => {
  const list = await listOf('Days', [beef, cod])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: beef.id, qty: 2 }, { item_id: cod.id, qty: 1 }])
  const place = body => owner.post(`/api/purchasing/orders/${o.id}/submit`, body)

  let r = await place({ suppliers: { [jay.id]: { delivery_date: day(1) } } })
  assert.equal(r.status, 422)
  assert.equal(r.json.code, 'delivery_day')
  assert.equal(r.json.problem, 'late')
  assert.equal(r.json.supplier_id, jay.id)
  assert.equal(r.json.delivery_date, day(1))
  assert.match(r.json.error, /^Too late for .*: it had to be ordered by the end of .*\. Pick another day, or say it was agreed with Jay Meats\.$/)
  r = await place({ suppliers: { [jay.id]: { delivery_date: day(2) } } })
  assert.equal(r.json.problem, 'late', 'the day after too')

  r = await place({ suppliers: { [jay.id]: { delivery_date: day(-1), agreed: true } } })
  assert.equal(r.status, 422)
  assert.equal(r.json.problem, 'past', 'agreed or not')
  assert.match(r.json.error, / is in the past$/)

  r = await place({ suppliers: { [jay.id]: { delivery_date: day(1), agreed: true }, [weekly.id]: { delivery_date: day(6) } } })
  assert.equal(r.status, 422)
  assert.equal(r.json.problem, 'not_delivery_day')
  assert.equal(r.json.supplier_id, weekly.id)
  assert.match(r.json.error, /^Weekly Fish doesn't deliver on \w+days \(they deliver \w{3}\)\. Pick another day/)
  assert.equal((await getOrder(o.id)).status, 'draft', 'nothing was placed')
  assert.equal((await sql`SELECT count(*)::int AS n FROM purchase_orders WHERE supply_order_id = ${o.id}`)[0].n, 0)

  const placed = await ok(place({ suppliers: { [jay.id]: { delivery_date: day(1), agreed: true }, [weekly.id]: { delivery_date: day(5) } } }), 'agreed with Jay')
  const days = Object.fromEntries(placed.purchase_orders.map(p => [p.supplier_id, p.delivery_date]))
  assert.deepEqual(days, { [jay.id]: day(1), [weekly.id]: day(5) })
})

test('requests, splits and moving a purchase order check the day too', async () => {
  const list = await listOf('Asked days', [beef])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: beef.id, qty: 4 }])
  // Asking for a day too soon is allowed (the approver sorts it out) ...
  await ok(owner.post(`/api/purchasing/orders/${o.id}/request`, { suppliers: { [jay.id]: { delivery_date: day(1) } } }), 'request')
  // ... but not a past one.
  const o2 = await draftFor(list)
  await setLines(o2, [{ item_id: beef.id, qty: 1 }])
  let r = await owner.post(`/api/purchasing/orders/${o2.id}/request`, { suppliers: { [jay.id]: { delivery_date: day(-1) } } })
  assert.equal(r.status, 422)
  assert.match(r.json.error, /in the past/)
  await ok(owner.delete(`/api/purchasing/orders/${o2.id}`), 'drop')

  // Splitting the request: the second day is checked.
  r = await owner.post(`/api/purchasing/orders/${o.id}/split`, { lines: [{ item_id: beef.id, qty: 1 }], suppliers: { [jay.id]: { delivery_date: day(2) } } })
  assert.equal(r.status, 422)
  assert.equal(r.json.code, 'delivery_day')
  assert.equal(r.json.problem, 'late')
  const split = await ok(owner.post(`/api/purchasing/orders/${o.id}/split`, { lines: [{ item_id: beef.id, qty: 1 }], suppliers: { [jay.id]: { delivery_date: day(2), agreed: true } } }), 'split, agreed')
  assert.equal((await getOrder(split.new_order_id)).supplier_options[jay.id].delivery_date, day(2))

  // Placing the request on the day it asked for: too late now, so agreed.
  r = await owner.post(`/api/purchasing/orders/${o.id}/submit`, {})
  assert.equal(r.status, 422)
  assert.equal(r.json.problem, 'late')
  assert.equal(r.json.delivery_date, day(1), 'the day the request asked for')
  const placed = await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, { suppliers: { [jay.id]: { agreed: true } } }), 'placed')
  const poId = placed.purchase_orders[0].id
  assert.equal(placed.purchase_orders[0].delivery_date, day(1))

  // Moving the purchase order.
  const move = body => owner.patch(`/api/purchasing/pos/${poId}`, body)
  r = await move({ delivery_date: day(2) })
  assert.equal(r.status, 422)
  assert.equal(r.json.problem, 'late')
  r = await move({ delivery_date: day(-2), agreed: true })
  assert.equal(r.json.problem, 'past')
  let d = await ok(move({ delivery_date: day(1), notes: 'Back door' }), 'the same day: not checked again')
  assert.equal(d.notes, 'Back door')
  d = await ok(move({ delivery_date: day(4) }), 'far enough out')
  assert.equal(d.delivery_date, day(4))
  d = await ok(move({ delivery_date: day(2), agreed: true }), 'agreed')
  assert.equal(d.delivery_date, day(2))
  assert.equal(d.lead_days, 3)
  assert.deepEqual(d.delivery_days, [])

  // Splitting the purchase order.
  r = await owner.post(`/api/purchasing/pos/${poId}/split`, { lines: [{ id: d.lines[0].id, qty: 1 }], delivery_date: day(1) })
  assert.equal(r.status, 422)
  assert.equal(r.json.problem, 'late')
  r = await owner.post(`/api/purchasing/pos/${poId}/split`, { lines: [{ id: d.lines[0].id, qty: 1 }], delivery_date: day(-1), agreed: true })
  assert.equal(r.json.problem, 'past')
  const parts = await ok(owner.post(`/api/purchasing/pos/${poId}/split`, { lines: [{ id: d.lines[0].id, qty: 1 }], delivery_date: day(6) }), 'split')
  assert.equal(parts.new_po.delivery_date, day(6))
  assert.equal(parts.po.lines[0].qty, 2, '3 asked for, 1 split off to a request, 1 more here')
})

test('minimums and steps hold when a purchase order changes or is split', async () => {
  const list = await listOf('Minimums', [chicken])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: chicken.id, qty: 20 }])
  const placed = await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, {}), 'place')
  const poId = placed.purchase_orders[0].id
  let d = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  const line = () => d.lines[0]
  assert.deepEqual([line().min_qty, line().order_multiple], [20, 2], 'the line carries the price\'s minimum and steps')

  const setQty = async qty => (d = await ok(owner.put(`/api/purchasing/pos/${poId}/lines`, { lines: [{ id: line().id, qty }] }), 'qty ' + qty))
  await setQty(10)
  assert.equal(line().qty, 20, 'up to the minimum')
  await setQty(23)
  assert.equal(line().qty, 24, 'up to the next step')

  const split = qty => owner.post(`/api/purchasing/pos/${poId}/split`, { lines: [{ id: line().id, qty }], delivery_date: day(5) })
  let r = await split(10)
  assert.equal(r.status, 422)
  assert.equal(r.json.code, 'split_qty')
  assert.equal(r.json.error, 'Chicken thighs: 14 left and 10 moved would both be below the minimum of 20. Move all of it, none of it, or another amount.')
  r = await split(4)
  assert.equal(r.json.error, 'Chicken thighs: 4 moved would be below the minimum of 20. Move all of it, none of it, or another amount.')
  await setQty(44)
  r = await split(21)
  assert.equal(r.json.error, 'Chicken thighs: 23 left and 21 moved wouldn\'t be in steps of 2. Move all of it, none of it, or another amount.')
  const parts = await ok(split(20), '24 and 20')
  assert.deepEqual([parts.po.lines[0].qty, parts.new_po.lines[0].qty], [24, 20])

  // The supplier's pack changed since: the line is for a pack the price no
  // longer sells, so its minimum and steps no longer apply to it.
  await ok(owner.patch(`/api/inventory/quotes/${chickenCase.id}`, { pack_qty: 2 }), 'a 2 kg case')
  d = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  assert.equal(line().min_qty, null)
  await setQty(5)
  assert.equal(line().qty, 5)
  await ok(owner.patch(`/api/inventory/quotes/${chickenCase.id}`, { pack_qty: 1 }), 'back to 1 kg')

  // A request waiting for approval splits the same way.
  const asked = await draftFor(list)
  await setLines(asked, [{ item_id: chicken.id, qty: 20 }])
  await ok(owner.post(`/api/purchasing/orders/${asked.id}/request`, {}), 'request')
  r = await owner.post(`/api/purchasing/orders/${asked.id}/split`, { lines: [{ item_id: chicken.id, qty: 10 }], suppliers: { [farm.id]: { delivery_date: day(5) } } })
  assert.equal(r.status, 422)
  assert.equal(r.json.code, 'split_qty')
  assert.match(r.json.error, /10 left and 10 moved would both be below the minimum of 20/)
  await ok(owner.delete(`/api/purchasing/orders/${asked.id}`), 'declined')
})

// ── Pepper ──────────────────────────────────────────────

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

/** A staff tool as the person, the way the staff connector runs it: the card first, then the change. */
async function pepper(sub, name, input, { run = true } = {}) {
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_mcp', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { card, out: run ? await tool.run(ctx, parsed) : null }
}

test('Pepper keeps the amount when switching supplier, and asks about days the supplier can\'t make', async () => {
  const list = await listOf('Pepper days', [rice, beef])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: rice.id, quote_id: farmBag.id, qty: 3 }, { item_id: beef.id, qty: 2 }])

  // Another supplier without a quantity: 3 x 5 kg becomes 2 x 10 kg.
  const { card } = await pepper(A.owner, 'update_order', { order_id: o.id, lines: [{ item: 'long grain rice', supplier: 'Pin Mill' }] })
  assert.ok(card.lines.some(l => /Long grain rice: 3 to 2 \(Pin Mill, Sack · 10 kg\), new supplier \(15 kg before, 20 kg now\)/.test(l)), card.lines.join(' | '))
  assert.deepEqual(await stored(o.id, rice.id), { quote_id: millSack.id, qty: 2 })

  // A price switched off: order_form says so, and placing is refused.
  await ok(owner.patch(`/api/inventory/quotes/${millSack.id}`, { is_active: false }), 'mill sack off')
  const form = (await pepper(A.owner, 'order_form', { order_id: o.id }, { run: true })).out
  const row = form.items.find(i => i.item === 'Long grain rice')
  assert.equal(row.supplier, 'Pin Mill (no longer offered)')
  assert.match(row.problem, /Pin Mill's price for Sack · 10 kg was switched off/)
  await assert.rejects(pepper(A.owner, 'place_order', { order_id: o.id }, { run: false }),
    err => err.status === 422 && /no longer offered/.test(err.message))
  await ok(owner.patch(`/api/inventory/quotes/${millSack.id}`, { is_active: true }), 'mill sack back')

  // Jay's day: too soon without agreement; agreed, it is placed and the card says so.
  await assert.rejects(pepper(A.owner, 'place_order', { order_id: o.id, deliveries: [{ supplier: 'Jay', date: day(1) }] }, { run: false }),
    err => err.status === 422 && /Too late for .*set agreed_with_supplier if Jay Meats agreed to it/.test(err.message))
  const done = await pepper(A.owner, 'place_order', { order_id: o.id, deliveries: [{ supplier: 'Jay', date: day(1), agreed_with_supplier: true }] })
  assert.ok(done.card.warnings.some(w => /^Agreed with Jay Meats: Too late for /.test(w)), done.card.warnings.join(' | '))
  assert.match(done.out.message, /Order placed/)
  const jayPo = done.out.purchase_orders.find(p => p.supplier === 'Jay Meats')
  assert.equal((await ok(owner.get(`/api/purchasing/pos/${jayPo.po_id}`))).delivery_date, day(1))

  // Moving it: the same rule.
  await assert.rejects(pepper(A.owner, 'change_purchase_order', { po: jayPo.po, delivery_date: day(2) }, { run: false }),
    err => err.status === 422 && /agreed_with_supplier/.test(err.message))
  await assert.rejects(pepper(A.owner, 'change_purchase_order', { po: jayPo.po, delivery_date: day(-1), agreed_with_supplier: true }, { run: false }),
    err => err.status === 422 && /in the past/.test(err.message))
  const moved = await pepper(A.owner, 'change_purchase_order', { po: jayPo.po, delivery_date: day(2), agreed_with_supplier: true })
  assert.ok(moved.card.warnings.some(w => /^Agreed with Jay Meats/.test(w)))
  assert.equal((await ok(owner.get(`/api/purchasing/pos/${jayPo.po_id}`))).delivery_date, day(2))
  assert.equal(jayPo.po, poNumberLabel((await ok(owner.get(`/api/purchasing/pos/${jayPo.po_id}`))).number))

  // Splitting below the minimum: refused before anything is shown.
  const chickenList = await listOf('Pepper chicken', [chicken])
  const co = await draftFor(chickenList)
  await setLines(co, [{ item_id: chicken.id, qty: 20 }])
  const cp = await ok(owner.post(`/api/purchasing/orders/${co.id}/submit`, {}), 'place')
  const cpo = poNumberLabel(cp.purchase_orders[0].number)
  await assert.rejects(pepper(A.owner, 'split_order', { po: cpo, lines: [{ item: 'chicken', quantity: 10 }], delivery_date: day(5) }, { run: false }),
    err => err.status === 422 && /both be below the minimum of 20/.test(err.message))
})

test('migration 232 pins lines saved before', async () => {
  const list = await listOf('Old lines', [rice, lentils])
  const o = await draftFor(list)
  await setLines(o, [{ item_id: rice.id, qty: 2 }, { item_id: lentils.id, qty: 0 }])
  // As a line was saved before: no price.
  await sql`UPDATE supply_order_lines SET quote_id = NULL WHERE order_id = ${o.id}`
  // The company's star on the mill, the venue's own pick on the farm's bag:
  // the venue's wins.
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: null, quote_id: millSack.id }), 'company: mill')
  await sql.unsafe(fs.readFileSync(new URL('../../migrations/232_pin_open_order_lines.sql', import.meta.url), 'utf8'))
  assert.equal((await stored(o.id, rice.id)).quote_id, farmBag.id, 'the venue\'s pick')
  assert.equal((await stored(o.id, lentils.id)).quote_id, null, 'no quantity: left as it was')

  // Without the venue's pick: the company's.
  await sql`UPDATE supply_order_lines SET quote_id = NULL WHERE order_id = ${o.id}`
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: V, quote_id: null }), 'no venue pick')
  await sql.unsafe(fs.readFileSync(new URL('../../migrations/232_pin_open_order_lines.sql', import.meta.url), 'utf8'))
  assert.equal((await stored(o.id, rice.id)).quote_id, millSack.id)

  // Without either: the cheapest per kilo (the mill's sack, £1.50 a kilo).
  await sql`UPDATE supply_order_lines SET quote_id = NULL WHERE order_id = ${o.id}`
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: null, quote_id: null }), 'no star')
  await sql.unsafe(fs.readFileSync(new URL('../../migrations/232_pin_open_order_lines.sql', import.meta.url), 'utf8'))
  assert.equal((await stored(o.id, rice.id)).quote_id, millSack.id)
  // A placed order's lines are left alone.
  const before = await sql`SELECT count(*)::int AS n FROM supply_order_lines l JOIN supply_orders s ON s.id = l.order_id WHERE s.status = 'submitted' AND l.quote_id IS NULL`
  await sql.unsafe(fs.readFileSync(new URL('../../migrations/232_pin_open_order_lines.sql', import.meta.url), 'utf8'))
  const after = await sql`SELECT count(*)::int AS n FROM supply_order_lines l JOIN supply_orders s ON s.id = l.order_id WHERE s.status = 'submitted' AND l.quote_id IS NULL`
  assert.equal(after[0].n, before[0].n)
  await ok(owner.put(`/api/inventory/items/${rice.id}/preferred`, { venue_id: V, quote_id: farmBag.id }), 'back')
})
