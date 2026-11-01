// Tidying the purchasing catalogue (1 Nov 2026, step 3 of the purchasing
// improvements, second half). Checked here:
//   - a supplier's product code names one product: a new price, a changed
//     code, another supplier, switching a price or an item on, the
//     spreadsheet import and the invoice price list all refuse a code a
//     live price of that supplier already has (409 duplicate_code, or a
//     row error); switched-off prices and items may keep one; prices that
//     already share a code can still have their price changed;
//   - the catalogue check lists one code on two products, two items with
//     one name, items nobody sells and prices without a code;
//   - several items switched off or on at once, with a dry run naming
//     items on open orders and codes that clash;
//   - one supplier's prices updated by product code from a file, pasted
//     lines or rows: changes, unchanged, unknown, switched off, on two
//     products, unreadable rows, big changes marked, collection prices
//     left out, history written, venue prices left alone; the file of
//     their prices now; other groups and viewers refused;
//   - Pepper: the code checks on its cards, check_catalogue, switch_items
//     and update_prices_by_code.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, viewer, otherOwner, V
let brakes, bidfood, thigh, thighBrakes, wings, wingsBrakes, napkins, oldSauce, oldQuote

const newItem = body => ok(owner.post('/api/inventory/items', { base_unit: 'g', ...body }), body.name)
const addQuote = (it, body) => owner.post(`/api/inventory/items/${it.id}/quotes`, body)
const quoteOf = (item, supplierId, code) => item.quotes.find(q => q.supplier_id === supplierId && (code === undefined || q.supplier_code === code))
const itemNow = id => ok(owner.get(`/api/inventory/items/${id}`))
const failed = async (p, status) => {
  const r = await p
  assert.equal(r.status, status, r.body)
  return r.json
}
const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const bulk = (body, who = owner) => who.post('/api/inventory/items/bulk', body)
const priceUpdate = (body, who = owner) => who.post('/api/inventory/price-update', body)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)

  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print', lead_days: 1 }), 'brakes')
  bidfood = await ok(owner.post('/api/suppliers', { name: 'Bidfood', send_method: 'print', lead_days: 1 }), 'bidfood')
  thigh = await newItem({ name: 'Chicken thigh' })
  thigh = await ok(addQuote(thigh, { supplier_id: brakes.id, supplier_code: 'MEA161', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 30 }), 'thigh price')
  thighBrakes = quoteOf(thigh, brakes.id)
  wings = await newItem({ name: 'Chicken wings' })
  wings = await ok(addQuote(wings, { supplier_id: brakes.id, supplier_code: 'POR106', pack_name: 'Case', pack_qty: 10, pack_unit: 'kg', price: 40 }), 'wings price')
  wingsBrakes = quoteOf(wings, brakes.id)
  napkins = await newItem({ name: 'Napkins', base_unit: 'each' })
  napkins = await ok(addQuote(napkins, { supplier_id: brakes.id, pack_name: 'Box', pack_qty: 500, pack_unit: 'each', price: 9 }), 'napkins price')
  // A switched-off item with a code: another item may take the code while it's off.
  oldSauce = await newItem({ name: 'Old sauce' })
  oldSauce = await ok(addQuote(oldSauce, { supplier_id: brakes.id, supplier_code: 'SAU-01', pack_name: 'Tub', pack_qty: 1, pack_unit: 'kg', price: 5 }), 'old sauce price')
  oldQuote = quoteOf(oldSauce, brakes.id)
  await ok(owner.patch(`/api/inventory/items/${oldSauce.id}`, { is_active: false }), 'switch the old sauce off')
})
after(closeApp)

test('a supplier\'s code names one product: new prices, changed codes and switching on are refused when it is taken', async () => {
  const sauce = await newItem({ name: 'Sweet chilli sauce' })
  const base = { pack_name: 'Tub', pack_qty: 2, pack_unit: 'kg', price: 7 }

  // Brakes' MEA161 is the thigh's: refused, any case and with spaces.
  const refused = await failed(addQuote(sauce, { ...base, supplier_id: brakes.id, supplier_code: ' mea161 ' }), 409)
  assert.equal(refused.code, 'duplicate_code')
  assert.equal(refused.quote_id, thighBrakes.id)
  assert.equal(refused.item_id, thigh.id)
  assert.match(refused.error, /Brakes already has code MEA161 on Chicken thigh/)
  // Another supplier's own MEA161 is a different product: fine.
  const atBidfood = await ok(addQuote(sauce, { ...base, supplier_id: bidfood.id, supplier_code: 'MEA161' }), 'same code at another supplier')
  // A switched-off price may have it; switching it on is then refused.
  let withOff = await ok(addQuote(sauce, { ...base, supplier_id: brakes.id, supplier_code: 'MEA161', is_active: false }), 'switched-off price')
  const offQ = quoteOf(withOff, brakes.id, 'MEA161')
  assert.equal(offQ.is_active, false)
  assert.equal((await failed(owner.patch(`/api/inventory/quotes/${offQ.id}`, { is_active: true }), 409)).code, 'duplicate_code')
  // The old sauce is switched off, so its SAU-01 is free for a live price...
  withOff = await ok(addQuote(sauce, { ...base, pack_qty: 1, supplier_id: brakes.id, supplier_code: 'SAU-01' }), 'a code only an item switched off has')
  const sau = quoteOf(withOff, brakes.id, 'SAU-01')
  // ...and switching the old sauce back on is then refused.
  const clash = await failed(owner.patch(`/api/inventory/items/${oldSauce.id}`, { is_active: true }), 409)
  assert.equal(clash.code, 'duplicate_code')
  assert.equal(clash.conflicts[0].other_item_name, 'Sweet chilli sauce')
  assert.equal((await itemNow(oldSauce.id)).is_active, false, 'still off')

  // Changing a code to a taken one, or to another supplier that has it: refused.
  assert.equal((await failed(owner.patch(`/api/inventory/quotes/${sau.id}`, { supplier_code: 'POR106' }), 409)).code, 'duplicate_code')
  const bf = quoteOf(atBidfood, bidfood.id)
  assert.equal((await failed(owner.patch(`/api/inventory/quotes/${bf.id}`, { supplier_id: brakes.id }), 409)).code, 'duplicate_code')
  // Its own code again, with a new price: fine.
  await ok(owner.patch(`/api/inventory/quotes/${sau.id}`, { supplier_code: 'SAU-01 ', price: 7.5 }), 'own code, new price')

  // Prices that already shared a code (saved before this check) keep working.
  await sql`UPDATE inv_quotes SET supplier_code = 'POR106' WHERE id = ${bf.id}`
  await sql`UPDATE inv_quotes SET supplier_id = ${brakes.id} WHERE id = ${bf.id}`
  await ok(owner.patch(`/api/inventory/quotes/${bf.id}`, { price: 8 }), 'a price change on a shared code')
  assert.equal((await failed(owner.patch(`/api/inventory/quotes/${bf.id}`, { supplier_code: 'MEA161' }), 409)).code, 'duplicate_code')
  // Put it back for the tests after this one.
  await sql`UPDATE inv_quotes SET supplier_id = ${bidfood.id}, supplier_code = 'MEA161' WHERE id = ${bf.id}`

  // A switched-off item may take a code; switching it on is then refused.
  const spare = await newItem({ name: 'Spare thighs' })
  await ok(owner.patch(`/api/inventory/items/${spare.id}`, { is_active: false }), 'off')
  await ok(addQuote(spare, { ...base, pack_qty: 5, supplier_id: brakes.id, supplier_code: 'MEA161' }), 'off item, taken code')
  assert.equal((await failed(owner.patch(`/api/inventory/items/${spare.id}`, { is_active: true }), 409)).code, 'duplicate_code')

  // Another group: its own MEA161 at its own supplier is no clash.
  const theirSup = await ok(otherOwner.post('/api/suppliers', { name: 'Brakes', send_method: 'print' }), 'their brakes')
  const theirItem = await ok(otherOwner.post('/api/inventory/items', { name: 'Chicken thigh', base_unit: 'g' }), 'their thigh')
  await ok(otherOwner.post(`/api/inventory/items/${theirItem.id}/quotes`, { supplier_id: theirSup.id, supplier_code: 'MEA161', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 31 }), 'their MEA161')
})

test('the import and the invoice price list refuse a taken code; codes in a CSV stay as typed', async () => {
  const csv = [
    'Item,Supplier,Supplier code,Pack,Pack size,Pack unit,Price',
    'Garlic paste,Brakes,MEA161,Tub,1,kg,6',          // the thigh's: refused
    'Ginger paste,Brakes,GIN-7,Tub,1,kg,6',
    'Lemongrass paste,Brakes,GIN-7,Tub,1,kg,6',       // the row above's: refused
    'Chicken thigh,Brakes,MEA161,Case,5,kg,31',       // the thigh's own price: updated
    'Curry paste,Brakes,12-04,Tub,1,kg,6',            // not a date
    'Tamarind,Brakes,00123,Tub,1,kg,6',               // keeps its zeros
    'Crème fraîche,Brakes,CF-1,Tub,1,kg,"£4.50"',     // UTF-8 without a byte-order mark
  ].join('\n')
  const r = await ok(owner.post('/api/inventory/import', { file: b64(csv) }), 'import')
  assert.deepEqual(r.errors.map(e => [e.row, e.item]), [[2, 'Garlic paste'], [4, 'Lemongrass paste']])
  assert.match(r.errors[0].error, /Brakes already has code MEA161 on Chicken thigh/)
  assert.match(r.errors[1].error, /GIN-7 on Ginger paste/)
  assert.equal(r.quotes_updated, 1)
  const items = await ok(owner.get('/api/inventory/items'))
  const codes = items.flatMap(i => i.quotes.map(q => q.supplier_code)).filter(Boolean)
  assert.ok(codes.includes('12-04') && codes.includes('00123'), codes.join(' '))
  assert.equal(items.find(i => i.name === 'Garlic paste')?.quotes.length ?? 0, 0, 'the refused row added no price')
  assert.equal(quoteOf(items.find(i => i.name === 'Chicken thigh'), brakes.id).price, 31)
  assert.equal(quoteOf(items.find(i => i.name === 'Crème fraîche'), brakes.id)?.price, 4.5, 'accents and £ read as UTF-8')
  await ok(owner.patch(`/api/inventory/quotes/${thighBrakes.id}`, { price: 30 }), 'back to 30')
  // An old Windows CSV (not UTF-8) still reads.
  const latin = Buffer.from('Item,Supplier,Supplier code,Pack,Pack size,Pack unit,Price\nCafé crème,Brakes,CAF-1,Tub,1,kg,£3.00\n', 'latin1')
  await ok(owner.post('/api/inventory/import', { file: latin.toString('base64') }), 'latin-1 import')
  const cafe = (await ok(owner.get('/api/inventory/items'))).find(i => i.name === 'Café crème')
  assert.equal(quoteOf(cafe, brakes.id)?.price, 3)

  // The invoice price list: adding a price whose code another live product has.
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Paste list', venue_ids: [V], item_ids: [napkins.id] }), 'list')
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft')
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, { lines: [{ item_id: napkins.id, qty: 1 }] }), 'lines')
  const placed = await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, {}), 'placed')
  const po = await ok(owner.get(`/api/purchasing/pos/${placed.purchase_orders[0].id}`))
  const line = po.lines[0]
  await sql`UPDATE purchase_order_lines SET invoice_price = 8, invoice_code = 'POR106' WHERE id = ${line.id}`
  const add = await failed(owner.post(`/api/purchasing/pos/${po.id}/price-list`, {
    changes: [{ line_id: line.id, action: 'add', pack: { name: 'Box', count: 1, qty: 250, unit: 'each' } }],
  }), 409)
  assert.equal(add.code, 'duplicate_code')
  assert.match(add.error, /POR106 on Chicken wings/)
  await ok(owner.post(`/api/purchasing/pos/${po.id}/price-list`, {
    changes: [{ line_id: line.id, action: 'add', supplier_code: 'NAP-250', pack: { name: 'Box', count: 1, qty: 250, unit: 'each' } }],
  }), 'a free code')
})

test('the catalogue check: one code on two products, items with one name, items nobody sells, prices without a code', async () => {
  // A pre-existing clash (from before the check), an item twice, an item with no price.
  const twin = await newItem({ name: 'chicken wings ' })
  const q = (await ok(addQuote(twin, { supplier_id: bidfood.id, pack_name: 'Case', pack_qty: 10, pack_unit: 'kg', price: 38 }), 'twin price'))
  const twinQ = quoteOf(q, bidfood.id)
  await sql`UPDATE inv_quotes SET supplier_id = ${brakes.id}, supplier_code = 'por106 ' WHERE id = ${twinQ.id}`
  const lonely = await newItem({ name: 'Saffron' })

  const r = await ok(owner.get('/api/inventory/check'))
  const codes = r.duplicate_codes.find(g => g.supplier_id === brakes.id && g.code.toLowerCase() === 'por106')
  assert.ok(codes, JSON.stringify(r.duplicate_codes))
  assert.equal(codes.supplier_name, 'Brakes')
  assert.deepEqual(codes.quotes.map(x => x.item_id).sort(), [wings.id, twin.id].sort())
  assert.match(codes.quotes[0].pack_label, /Case · 10 kg/)
  const names = r.duplicate_names.find(g => g.name.toLowerCase() === 'chicken wings')
  assert.deepEqual(names.items.map(i => i.item_id), [wings.id, twin.id], 'oldest first')
  assert.equal(names.items[0].prices, 1)
  assert.ok(r.no_price.some(i => i.item_id === lonely.id), 'Saffron has no price')
  assert.ok(!r.no_price.some(i => i.item_id === oldSauce.id), 'items switched off aren\'t listed')
  const noCode = r.no_code.find(s => s.supplier_id === brakes.id)
  assert.ok(noCode.items.includes('Napkins'), JSON.stringify(r.no_code))

  // Purchasing setup view needed; another group sees its own.
  await failed(viewer.get('/api/inventory/check'), 403)
  const theirs = await ok(otherOwner.get('/api/inventory/check'))
  assert.ok(!JSON.stringify(theirs).includes(wings.id), 'another group sees none of this group\'s')

  // Tidy the twin away for the tests after this one: switched off, neither it nor its code counts any more.
  await ok(owner.patch(`/api/inventory/items/${twin.id}`, { is_active: false }), 'twin off')
  const after = await ok(owner.get('/api/inventory/check'))
  assert.ok(!after.duplicate_names.some(g => g.name.toLowerCase() === 'chicken wings'), 'a switched-off twin isn\'t a pair')
  assert.ok(!after.duplicate_codes.some(g => g.supplier_id === brakes.id && g.code.toLowerCase() === 'por106'), 'nor is its code')
})

test('several items switched off and on: the dry run names open orders and clashing codes', async () => {
  // Wings on an open order (a draft with a quantity).
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Wings list', venue_ids: [V], item_ids: [wings.id] }), 'list')
  const draft = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft')
  await ok(owner.put(`/api/purchasing/orders/${draft.id}/lines`, { lines: [{ item_id: wings.id, qty: 2 }] }), 'lines')

  const ids2 = [wings.id, napkins.id, oldSauce.id]
  const dry = await ok(bulk({ ids: ids2, is_active: false, dry_run: true }))
  assert.equal(dry.updated, 2)
  assert.equal(dry.unchanged, 1, 'the old sauce is off already')
  assert.deepEqual(dry.on_open_orders.map(o => o.item_name), ['Chicken wings'])
  assert.ok(dry.on_open_orders[0].venues.length >= 1)
  assert.equal((await itemNow(wings.id)).is_active, true, 'a dry run changes nothing')

  const done = await ok(bulk({ ids: ids2, is_active: false }))
  assert.equal(done.updated, 2)
  assert.equal((await itemNow(wings.id)).is_active, false)
  // The draft's line now asks to be taken off.
  const order = await ok(owner.get(`/api/purchasing/orders/${draft.id}`))
  assert.ok(order.items.find(l => l.item_id === wings.id)?.gone, 'the line asks to be taken off (item switched off)')

  // Switching on: the old sauce's SAU-01 is the sweet chilli's now, so it is refused.
  const dryOn = await ok(bulk({ ids: [wings.id, oldSauce.id], is_active: true, dry_run: true }))
  assert.equal(dryOn.updated, 2)
  assert.deepEqual(dryOn.code_conflicts.map(c => [c.item_name, c.code, c.other_item_name]), [['Old sauce', 'SAU-01', 'Sweet chilli sauce']])
  const refused = await failed(bulk({ ids: [wings.id, oldSauce.id], is_active: true }), 409)
  assert.equal(refused.code, 'duplicate_code')
  assert.equal((await itemNow(wings.id)).is_active, false, 'nothing switched on')
  // Two items switched on together that share a code clash with each other.
  const a = await newItem({ name: 'Paprika A' }), b = await newItem({ name: 'Paprika B' })
  await ok(bulk({ ids: [a.id, b.id], is_active: false }), 'off')
  await ok(addQuote(a, { supplier_id: bidfood.id, supplier_code: 'PAP-1', pack_name: 'Tub', pack_qty: 1, pack_unit: 'kg', price: 4 }), 'a')
  await ok(addQuote(b, { supplier_id: bidfood.id, supplier_code: 'pap-1', pack_name: 'Tub', pack_qty: 1, pack_unit: 'kg', price: 4 }), 'b')
  const pair = await ok(bulk({ ids: [a.id, b.id], is_active: true, dry_run: true }))
  assert.equal(pair.code_conflicts.length, 1, 'one entry per code')
  // Without the clashing ones it goes through.
  assert.equal((await ok(bulk({ ids: [wings.id, napkins.id], is_active: true }))).updated, 2)
  assert.equal((await itemNow(wings.id)).is_active, true)

  // A viewer can't; another group's ids change nothing.
  await failed(bulk({ ids: [wings.id], is_active: false }, viewer), 403)
  const theirs = await ok(bulk({ ids: [wings.id], is_active: false }, otherOwner))
  assert.equal(theirs.updated, 0)
  assert.equal((await itemNow(wings.id)).is_active, true)
})

test('prices by product code: a file, pasted lines or rows; dry run first; history; venue prices left alone', async () => {
  // A venue's own price on the thigh stays.
  await ok(owner.put(`/api/inventory/quotes/${thighBrakes.id}/venue-prices`, { prices: [{ venue_id: V, price: 29 }] }), 'venue price')
  const csv = [
    'SKU,Description,Price delivery,Price collection',
    'MEA161,Thigh,31.50,30.00',          // changed
    'por106,Wings,"£40.00",',            // the same (any case, a £ sign)
    'NOPE-1,Unknown,9,',                 // not found
    'SAU-01,Sauce,8.25,',                // the sweet chilli's (live), not the old sauce's
    'MEA161,Again,32,',                  // already in row 2
    ',Nothing,5,',                       // no code
    'GIN-7,Ginger,abc,',                 // not a number
    '00123,Tamarind,12,',                // 6 to 12: +100%, marked
  ].join('\r\n')
  const dry = await ok(priceUpdate({ supplier_id: brakes.id, file: b64(csv), dry_run: true }))
  assert.equal(dry.supplier.name, 'Brakes')
  assert.equal(dry.dry_run, true)
  assert.deepEqual(dry.changes.map(c => [c.code, c.old_price, c.new_price]).sort(),
    [['00123', 6, 12], ['MEA161', 30, 31.5], ['SAU-01', 7.5, 8.25]])
  const tamarind = dry.changes.find(c => c.code === '00123')
  assert.equal(tamarind.pct, 100)
  assert.equal(tamarind.big, true)
  assert.equal(dry.changes.find(c => c.code === 'MEA161').big, false)
  assert.equal(dry.unchanged, 1, JSON.stringify(dry))
  assert.deepEqual(dry.unknown, [{ row: 4, code: 'NOPE-1' }])
  assert.deepEqual(dry.errors.map(e => [e.row, e.error]), [[6, 'Already in row 2'], [7, 'No code'], [8, 'Price missing, not a number or below 0']])
  assert.equal(dry.collection_ignored, true)
  assert.equal((await itemNow(thigh.id)).quotes.find(q => q.id === thighBrakes.id).price, 30, 'a dry run changes nothing')

  const done = await ok(priceUpdate({ supplier_id: brakes.id, file: b64(csv) }))
  assert.equal(done.changes.length, 3)
  const th = (await itemNow(thigh.id)).quotes.find(q => q.id === thighBrakes.id)
  assert.equal(th.price, 31.5)
  assert.equal(th.venue_prices[V], 29, 'the venue\'s own price stays')
  const hist = await ok(owner.get(`/api/inventory/quotes/${thighBrakes.id}/history`))
  assert.equal(hist[0].price, 31.5)
  assert.equal(hist[0].source, 'import')

  // Switched off and on two products.
  await ok(owner.patch(`/api/inventory/quotes/${wingsBrakes.id}`, { is_active: false }), 'wings price off')
  const off = await ok(priceUpdate({ supplier_id: brakes.id, text: 'POR106, 41', dry_run: true }))
  assert.deepEqual(off.switched_off.map(x => [x.code, x.item_name.toLowerCase()]), [['POR106', 'chicken wings']])
  await ok(owner.patch(`/api/inventory/quotes/${wingsBrakes.id}`, { is_active: true }), 'wings price on')
  const twin = await newItem({ name: 'Wings (second)' })
  const tq = quoteOf(await ok(addQuote(twin, { supplier_id: bidfood.id, pack_name: 'Case', pack_qty: 10, pack_unit: 'kg', price: 40 }), 'twin'), bidfood.id)
  await sql`UPDATE inv_quotes SET supplier_id = ${brakes.id}, supplier_code = 'POR106' WHERE id = ${tq.id}`
  const two = await ok(priceUpdate({ supplier_id: brakes.id, text: 'POR106, 41', dry_run: true }))
  assert.deepEqual(two.ambiguous.map(x => x.items.sort()), [['Chicken wings', 'Wings (second)']])
  await ok(owner.patch(`/api/inventory/items/${twin.id}`, { is_active: false }), 'twin off')

  // Pasted lines: a heading, commas, colons, spaces, codes with spaces, £.
  const text = 'Code, Price\nMEA161: 32\nBF 2201 12.50\nPOR106 £42.00\nnot a line at all\n'
  const t = await ok(priceUpdate({ supplier_id: brakes.id, text, dry_run: true }))
  assert.deepEqual(t.changes.map(c => [c.code, c.new_price]).sort(), [['MEA161', 32], ['POR106', 42]])
  assert.deepEqual(t.unknown.map(u => u.code), ['BF 2201'])
  assert.deepEqual(t.errors.map(e => e.row), [5])

  // Rows (Pepper) and a headerless file.
  const rows = await ok(priceUpdate({ supplier_id: brakes.id, rows: [{ code: 'MEA161', price: 33 }, { code: 'POR106', price: '43' }], dry_run: true }))
  assert.deepEqual(rows.changes.map(c => c.new_price).sort(), [33, 43])
  const bare = await ok(priceUpdate({ supplier_id: brakes.id, file: b64('MEA161,34\nPOR106,44\n'), dry_run: true }))
  assert.equal(bare.changes.length, 2)

  // Refusals: no columns, nothing given, two given, someone else's supplier, a viewer.
  await failed(priceUpdate({ supplier_id: brakes.id, file: b64('Name,Cost per kilo\nThigh,thing\n') }), 422)
  await failed(priceUpdate({ supplier_id: brakes.id }), 400)
  await failed(priceUpdate({ supplier_id: brakes.id, text: 'a,1', rows: [{ code: 'a', price: 1 }] }), 400)
  await failed(priceUpdate({ supplier_id: brakes.id, text: 'MEA161, 1' }, otherOwner), 404)
  await failed(priceUpdate({ supplier_id: brakes.id, text: 'MEA161, 1' }, viewer), 403)
  assert.equal((await itemNow(thigh.id)).quotes.find(q => q.id === thighBrakes.id).price, 31.5, 'refusals changed nothing')

  // Their prices now, as a CSV to edit: live prices with a code only.
  const res = await owner.get(`/api/inventory/price-update/template?supplier_id=${brakes.id}`)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/csv/)
  const lines = res.body.trim().split('\r\n')
  assert.equal(lines[0], 'Code,Price,Item,Product,Pack')
  assert.ok(lines.includes('MEA161,31.50,Chicken thigh,,Case · 5 kg'), lines.join(' | '))
  assert.ok(lines.some(l => l.startsWith('NAP-250,')), 'the napkins\' coded price (from the invoice)')
  assert.ok(!lines.some(l => l.includes('500 each')), 'the napkins\' price without a code isn\'t listed')
  assert.ok(!lines.some(l => l.includes('Old sauce')), 'switched off, not listed')
  assert.ok(!lines.some(l => l.includes('Wings (second)')), 'switched off, not listed')
  await failed(otherOwner.get(`/api/inventory/price-update/template?supplier_id=${brakes.id}`), 404)
  await failed(viewer.get(`/api/inventory/price-update/template?supplier_id=${brakes.id}`), 403)
})

// ── Pepper ──────────────────────────────────────────────

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

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

test('Pepper: code clashes on its cards, check_catalogue, switch_items, update_prices_by_code', async () => {
  // The price tools say no before Confirm.
  await assert.rejects(pepper(A.owner, 'add_supplier_price', {
    item: 'Napkins', supplier: 'Brakes', supplier_code: 'mea161', pack_name: 'Box', pack_count: 1, pack_size: 100, pack_unit: 'each', price: 3,
  }), /Brakes already has code mea161 on Chicken thigh/)
  await assert.rejects(pepper(A.owner, 'update_supplier_price', { item: wings.id, supplier: 'Brakes', supplier_code: 'MEA161' }),
    /already has code MEA161 on Chicken thigh/)
  await assert.rejects(pepper(A.owner, 'update_inventory_item', { item: 'Old sauce', active: true }),
    /already has code SAU-01 on Sweet chilli sauce/)

  // The catalogue check.
  const check = (await pepper(A.owner, 'check_catalogue', {})).out
  assert.ok(check.items_nobody_sells.includes('Saffron'), JSON.stringify(check))
  assert.equal(check.all_clear, false)
  await assert.rejects(pepper(A.operator, 'check_catalogue', {}), /permission/i)

  // Switching items: the card, then the change; switching on a clash refused.
  const sw = await pepper(A.owner, 'switch_items', { items: ['Saffron', 'napkins'], on: false })
  assert.equal(sw.card.title, 'Switch off 2 items?')
  assert.deepEqual(sw.card.lines, ['Saffron', 'Napkins'])
  assert.equal(sw.card.pin.items.length, 2)
  assert.equal(sw.out.switched, 2)
  assert.equal((await ok(owner.get('/api/inventory/items'))).find(i => i.name === 'Saffron').is_active, false)
  await assert.rejects(pepper(A.owner, 'switch_items', { items: ['Old sauce'], on: true }), /SAU-01 at Brakes is Sweet chilli sauce's/)
  await assert.rejects(pepper(A.owner, 'switch_items', { items: ['Saffron'], on: false }), /switched off already/)
  await pepper(A.owner, 'switch_items', { items: ['Saffron', 'Napkins'], on: true })

  // Prices by code: the card lists the changes and what was left out.
  const up = await pepper(A.owner, 'update_prices_by_code', {
    supplier: 'brakes', rows: [{ code: 'MEA161', price: 45 }, { code: 'POR106', price: 42 }, { code: 'ZZZ-9', price: 1 }],
  })
  assert.equal(up.card.title, 'Update 2 prices from Brakes?')
  assert.ok(up.card.lines.some(l => /^MEA161 Chicken thigh: £31\.50 to £45\.00 \(\+43%\)$/.test(l)), up.card.lines.join(' | '))
  assert.ok(up.card.warnings.some(w => /Chicken thigh \(MEA161\) changes by 43%/.test(w)), up.card.warnings.join(' | '))
  assert.ok(up.card.warnings.some(w => /Not found at Brakes: ZZZ-9/.test(w)))
  assert.equal(up.card.pin.supplier, brakes.id)
  assert.equal(up.out.updated, 2)
  assert.equal((await itemNow(thigh.id)).quotes.find(q => q.id === thighBrakes.id).price, 45)
  await assert.rejects(pepper(A.owner, 'update_prices_by_code', { supplier: 'Brakes', rows: [{ code: 'MEA161', price: 45 }] }),
    /No price would change: 1 price is the same already/)
  await assert.rejects(pepper(A.owner, 'update_prices_by_code', { supplier: 'Brakes' }), /Give either attached_file/)
  await assert.rejects(pepper(A.operator, 'update_prices_by_code', { supplier: 'Brakes', rows: [{ code: 'MEA161', price: 46 }] }), /permission/i)
})
