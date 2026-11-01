// Suppliers' product codes everywhere, and the quick order (1 Nov 2026).
// Checked here:
//   - the catalogue search finds suppliers' codes (exactly or in part) and
//     their product names, our item codes from their start, an exact code
//     first, and names the price a code was typed for (matched_quote_id);
//     a supplier filter and switched-off prices are respected; another
//     group finds nothing of this one's;
//   - purchase orders are found by a product code on their lines;
//   - a purchase order's quick order comes as a CSV file (code, name, qty;
//     no prices; lines without a code left out);
//   - Pepper finds items by a supplier's code, orders a line on the price a
//     code names, finds purchase order lines and products to add by code,
//     gives the quick order with an order and a purchase order, and changes
//     one venue's supplier settings without losing another venue's
//     delivery details.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays, nowAt, poNumberLabel } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, viewer, otherOwner, V, V2
let brakes, bidfood, thigh, thighBrakes, thighBidfood, napkins, napkinsBrakes, rice, riceBid, tray, oldOne

const today = () => nowAt('Europe/London').date
const day = n => addDays(today(), n)
const newItem = body => ok(owner.post('/api/inventory/items', { base_unit: 'g', ...body }), body.name)
const quotesOf = async (it, body) => (await ok(owner.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price')).quotes
const catalog = (who, venue, q) => who.get(`/api/purchasing/venues/${venue}/catalog?${new URLSearchParams(q)}`)
const failed = async (p, status) => {
  const r = await p
  assert.equal(r.status, status, r.body)
  return r.json
}

/** A placed order: [item, qty, quote] lines, all for one delivery day. */
async function placed(lines, date = day(9)) {
  const list = await ok(owner.post('/api/purchasing/lists', {
    name: 'Codes ' + Math.random().toString(36).slice(2, 8), venue_ids: [V], item_ids: lines.map(([it]) => it.id),
  }), 'list')
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft')
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, {
    lines: lines.map(([it, qty, q]) => ({ item_id: it.id, qty, quote_id: q.id })),
  }), 'lines')
  const sups = [...new Set(lines.map(([, , q]) => q.supplier_id))]
  return ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, {
    suppliers: Object.fromEntries(sups.map(s => [s, { delivery_date: date }])),
  }), 'placed')
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  V2 = filled.ids.venue2
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)

  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print', lead_days: 1 }), 'brakes')
  bidfood = await ok(owner.post('/api/suppliers', { name: 'Bidfood', send_method: 'print', lead_days: 1 }), 'bidfood')
  // Chicken thigh: Bidfood is cheaper, so the venue's usual price; Brakes'
  // code names theirs.
  thigh = await newItem({ name: 'Chicken thigh' })
  ;[thighBrakes] = await quotesOf(thigh, {
    supplier_id: brakes.id, supplier_code: 'MEA161', product_name: 'Chicken thigh boneless skin-on',
    pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 30,
  })
  thighBidfood = (await quotesOf(thigh, { supplier_id: bidfood.id, supplier_code: 'BF-2201', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 28 }))
    .find(q => q.supplier_id === bidfood.id)
  napkins = await newItem({ name: 'Napkins', base_unit: 'each' })
  ;[napkinsBrakes] = await quotesOf(napkins, { supplier_id: brakes.id, pack_name: 'Box', pack_qty: 500, pack_unit: 'each', price: 9 })
  rice = await newItem({ name: 'Basmati rice', code: 'RICE01' })
  ;[riceBid] = await quotesOf(rice, { supplier_id: bidfood.id, supplier_code: 'BF-RICE', pack_name: 'Bag', pack_qty: 10, pack_unit: 'kg', price: 15 })
  // A name that sorts first and mentions a code: the exact code still wins.
  tray = await newItem({ name: 'Aluminium tray for BF-2201 portions', base_unit: 'each' })
  await quotesOf(tray, { supplier_id: brakes.id, pack_name: 'Box', pack_qty: 100, pack_unit: 'each', price: 12 })
  // A switched-off price: its code finds nothing.
  oldOne = await newItem({ name: 'Old sauce' })
  const [oldQ] = await quotesOf(oldOne, { supplier_id: brakes.id, supplier_code: 'OLD-99', pack_name: 'Tub', pack_qty: 1, pack_unit: 'kg', price: 5 })
  await ok(owner.patch(`/api/inventory/quotes/${oldQ.id}`, { is_active: false }), 'switch the old price off')
})
after(closeApp)

test('the catalogue finds suppliers\' codes and product names and names the price a code was typed for', async () => {
  const exact = await ok(catalog(owner, V, { search: 'MEA161' }))
  assert.deepEqual(exact.map(i => i.id), [thigh.id])
  assert.equal(exact[0].matched_quote_id, thighBrakes.id, 'Brakes\' code names their price')
  assert.equal(exact[0].quote.id, thighBidfood.id, 'the usual price is still Bidfood\'s (cheaper)')
  assert.equal(exact[0].quotes.find(q => q.id === thighBrakes.id).supplier_code, 'MEA161')
  assert.equal((await ok(catalog(owner, V, { search: 'mea161' })))[0].matched_quote_id, thighBrakes.id, 'any case')

  // Part of a code, a product name, our code from its start: found, no named price.
  const part = await ok(catalog(owner, V, { search: 'MEA16' }))
  assert.deepEqual(part.map(i => i.id), [thigh.id])
  assert.equal(part[0].matched_quote_id, undefined)
  assert.deepEqual((await ok(catalog(owner, V, { search: 'skin-on' }))).map(i => i.id), [thigh.id], 'the supplier\'s product name')
  assert.deepEqual((await ok(catalog(owner, V, { search: 'RICE0' }))).map(i => i.id), [rice.id], 'our code from its start')
  assert.deepEqual((await ok(catalog(owner, V, { search: 'ICE01' }))).map(i => i.id), [], 'our code isn\'t searched inside')

  // An exact code first, before a name that only mentions it.
  const both = await ok(catalog(owner, V, { search: 'BF-2201' }))
  assert.deepEqual(both.map(i => i.id), [thigh.id, tray.id])
  assert.equal(both[0].matched_quote_id, thighBidfood.id)
  assert.equal(both[1].matched_quote_id, undefined)

  // With a supplier: only that supplier's codes count.
  assert.deepEqual(await ok(catalog(owner, V, { search: 'MEA161', supplier_id: bidfood.id })), [], 'MEA161 isn\'t Bidfood\'s')
  const theirs = await ok(catalog(owner, V, { search: 'MEA161', supplier_id: brakes.id }))
  assert.equal(theirs[0].matched_quote_id, thighBrakes.id)

  // A switched-off price's code finds nothing; nor does another group.
  assert.deepEqual(await ok(catalog(owner, V, { search: 'OLD-99' })), [])
  const otherV = (await ok(otherOwner.get('/api/venues')))[0]?.id
  if (otherV) assert.deepEqual(await ok(catalog(otherOwner, otherV, { search: 'MEA161' })), [], 'another group\'s catalogue')
  await failed(catalog(otherOwner, V, { search: 'MEA161' }), 404)
})

test('purchase orders are found by a product code on their lines, and give their quick order as a CSV', async () => {
  const res = await placed([[thigh, 2, thighBrakes], [napkins, 3, napkinsBrakes]])
  assert.equal(res.purchase_orders.length, 1)
  const po = res.purchase_orders[0]
  const found = q => ok(owner.get('/api/purchasing/pos?' + new URLSearchParams({ q, venue_id: V })))
  assert.ok((await found('MEA161')).some(p => p.id === po.id), 'by the code')
  assert.ok((await found('mea161')).some(p => p.id === po.id), 'any case')
  assert.ok(!(await found('MEA16')).some(p => p.id === po.id), 'a code is matched whole')
  assert.ok(!(await found('BF-2201')).some(p => p.id === po.id), 'a code not on it')
  assert.ok((await found(poNumberLabel(po.number))).some(p => p.id === po.id), 'the PO number still works')

  const r = await owner.get(`/api/purchasing/pos/${po.id}/file?format=csv`)
  assert.equal(r.status, 200, r.body)
  assert.match(r.headers['content-type'], /^text\/csv/)
  assert.match(r.headers['content-disposition'] || '', /\.csv/)
  assert.equal(r.body, 'code,name,qty\r\nMEA161,Chicken thigh boneless skin-on,2\r\n', 'no prices, Napkins (no code) left out')
  // Anyone who can read purchase orders; not another group.
  assert.equal((await viewer.get(`/api/purchasing/pos/${po.id}/file?format=csv`)).status, 200)
  await failed(otherOwner.get(`/api/purchasing/pos/${po.id}/file?format=csv`), 404)
  assert.match((await owner.get(`/api/purchasing/pos/${po.id}/file?format=docx`)).headers['content-type'], /pdf/, 'anything else is the PDF, as before')
  await sql`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ${po.id}`
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

test('Pepper: items, order lines, purchase order lines and products by a supplier\'s code; the quick order', async () => {
  // Finding by code: the exact one first.
  const finds = (await pepper(A.owner, 'find_inventory_items', { search: 'BF-2201' })).out
  assert.deepEqual(finds.items.map(i => i.name), ['Chicken thigh', 'Aluminium tray for BF-2201 portions'])
  assert.deepEqual((await pepper(A.owner, 'find_inventory_items', { search: 'mea161' })).out.items.map(i => i.name), ['Chicken thigh'])

  // An order line by Brakes' code goes on Brakes' price (not the usual Bidfood one).
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Pepper codes', venue_ids: [V], item_ids: [thigh.id, rice.id] }), 'list')
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft')
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, { lines: [{ item_id: thigh.id, qty: 2 }] }), 'on the usual price')
  const line = async itemId => (await sql`SELECT qty::float8 AS qty, quote_id FROM supply_order_lines WHERE order_id = ${o.id} AND item_id = ${itemId}`)[0]
  assert.equal((await line(thigh.id)).quote_id, thighBidfood.id)
  const upd = await pepper(A.owner, 'update_order', { order_id: o.id, lines: [{ item: 'MEA161', quantity: 3 }] })
  assert.ok(upd.card.lines.some(l => /Chicken thigh/.test(l) && /Brakes/.test(l)), upd.card.lines.join(' | '))
  assert.deepEqual(await line(thigh.id), { qty: 3, quote_id: thighBrakes.id })
  // Our item code and Bidfood's rice code both name the rice.
  await pepper(A.owner, 'update_order', { order_id: o.id, lines: [{ item: 'BF-RICE', quantity: 1 }] })
  assert.deepEqual(await line(rice.id), { qty: 1, quote_id: riceBid.id })

  // The order form gives each supplier's quick order.
  const form = (await pepper(A.owner, 'order_form', { order_id: o.id })).out
  assert.equal(form.suppliers.find(s => s.supplier === 'Brakes').quick_order, 'MEA161:3')
  assert.equal(form.suppliers.find(s => s.supplier === 'Bidfood').quick_order, 'BF-RICE:1')
  assert.equal(form.items.find(i => i.item === 'Chicken thigh').supplier_code, 'MEA161')

  // A purchase order: its quick order, lines without a code named; found by code.
  const res = await placed([[thigh, 2, thighBrakes], [napkins, 1, napkinsBrakes]])
  const po = res.purchase_orders[0]
  const label = poNumberLabel(po.number)
  const detail = (await pepper(A.owner, 'purchase_orders', { po: label })).out
  const one = detail.purchase_order || detail
  assert.equal(one.quick_order, 'MEA161:2')
  assert.deepEqual(one.not_in_quick_order, ['1 x Napkins (no supplier code)'])
  assert.equal(one.lines.find(l => l.item === 'Chicken thigh').supplier_code, 'MEA161')
  const byCode = (await pepper(A.owner, 'purchase_orders', { product_code: 'MEA161' })).out
  assert.ok(byCode.purchase_orders.some(p => p.po_id === po.id), JSON.stringify(byCode))

  // Changing a line by its code; adding a product by Brakes' code.
  const ch = await pepper(A.owner, 'change_purchase_order', { po: label, lines: [{ item: 'mea161', quantity: 4 }] })
  assert.ok(ch.card.lines.some(l => l === 'Chicken thigh: 2 to 4'), ch.card.lines.join(' | '))
  const poQty = async itemId => (await sql`SELECT qty::float8 AS qty FROM purchase_order_lines WHERE po_id = ${po.id} AND item_id = ${itemId}`)
    .map(r => r.qty)
  assert.deepEqual(await poQty(thigh.id), [4])
  const add = await pepper(A.owner, 'change_purchase_order', { po: label, add: [{ item: 'MEA161', quantity: 1 }] })
  assert.ok(add.card.lines.some(l => /Chicken thigh .*4 to 5, already on the order/.test(l)), add.card.lines.join(' | '))
  assert.deepEqual(await poQty(thigh.id), [5], 'topped up, not a second line')
  await assert.rejects(pepper(A.owner, 'change_purchase_order', { po: label, add: [{ item: 'BF-RICE', quantity: 1 }] }, { run: false }),
    /Brakes has no price for "BF-RICE"/, 'Bidfood\'s code isn\'t a Brakes product')
  await sql`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ${po.id}`
})

test('Pepper: one venue\'s supplier settings change without losing another venue\'s delivery details', async () => {
  await ok(owner.put(`/api/suppliers/${brakes.id}/venues`, { venues: [{
    venue_id: V2, account_ref: 'BR-HERT', lead_days: 3, delivery_phone: '01992 000111', driver_instructions: 'Side gate',
    slot_from: '06:00', slot_to: '08:00', delivery_days: [2, 5], cutoff_time: '15:00',
  }] }), 'Hertford settings')
  const [{ name: venueName }] = await sql`SELECT name FROM venues WHERE id = ${V}`
  const set = await pepper(A.owner, 'update_supplier', {
    supplier: 'Brakes', needs_their_reference: true,
    venue: { venue_id: V, delivery_phone: '01920 000222', days_notice: 2, delivery_slot_from: '07:00', delivery_slot_to: '09:30' },
  })
  assert.ok(set.card.lines.some(l => /Marking sent needs their reference: no to yes/i.test(l)), set.card.lines.join(' | '))
  assert.ok(set.card.lines.some(l => l.startsWith(venueName + ':') && /notice 2 days/.test(l) && /07:00-09:30/.test(l) && /01920 000222/.test(l)),
    set.card.lines.join(' | '))
  const detail = await ok(owner.get(`/api/suppliers/${brakes.id}`))
  assert.equal(detail.ref_required, true)
  const hert = detail.venues.find(v => v.venue_id === V2)
  assert.deepEqual({
    account_ref: hert.account_ref, lead_days: hert.lead_days, delivery_phone: hert.delivery_phone,
    driver_instructions: hert.driver_instructions, slot: [hert.slot_from.slice(0, 5), hert.slot_to.slice(0, 5)],
    days: hert.delivery_days, cutoff: hert.cutoff_time.slice(0, 5),
  }, {
    account_ref: 'BR-HERT', lead_days: 3, delivery_phone: '01992 000111', driver_instructions: 'Side gate',
    slot: ['06:00', '08:00'], days: [2, 5], cutoff: '15:00',
  }, 'Hertford kept whole')
  const ware = detail.venues.find(v => v.venue_id === V)
  assert.equal(ware.delivery_phone, '01920 000222')
  assert.equal(ware.lead_days, 2)
  assert.equal(ware.slot_from.slice(0, 5), '07:00')

  // A second change keeps what the first set at this venue too.
  await pepper(A.owner, 'update_supplier', { supplier: 'Brakes', venue: { venue_id: V, driver_instructions: 'Ring twice' } })
  const after1 = (await ok(owner.get(`/api/suppliers/${brakes.id}`))).venues.find(v => v.venue_id === V)
  assert.equal(after1.delivery_phone, '01920 000222')
  assert.equal(after1.driver_instructions, 'Ring twice')
  assert.equal(after1.slot_to.slice(0, 5), '09:30')

  // A slot that ends before it starts; list_suppliers shows the settings.
  await assert.rejects(pepper(A.owner, 'update_supplier', { supplier: 'Brakes', venue: { venue_id: V, delivery_slot_to: '06:00' } }, { run: false }),
    /must end after it starts/)
  const b = (await pepper(A.owner, 'list_suppliers', { supplier: 'Brakes' })).out
  assert.match(b.needs_their_reference || '', /order reference/)
  const vs = b.venue_settings.find(v => v.venue === venueName)
  assert.equal(vs.delivery_slot, '07:00-09:30')
  assert.equal(vs.delivery_phone, '01920 000222')
  assert.equal(vs.driver_instructions, 'Ring twice')
  assert.equal(vs.days_notice, 2)
})
