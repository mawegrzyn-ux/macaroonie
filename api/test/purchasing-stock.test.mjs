// A supplier price out of stock until a date (migration 234, 1 Nov 2026).
// Checked here:
//   - marking it (date, note, who and when) and back in stock (all four
//     cleared); the date comes back as YYYY-MM-DD everywhere: the
//     Inventory page's item, the order (its line's price and the other
//     prices), the catalogue pickers and a purchase order's lines;
//   - nothing moves: a line on the price stays on it, the usual price
//     stays the usual one, and placing still makes the purchase order on
//     it;
//   - who may: ordering staff (no catalogue access) yes, viewers no,
//     another group's price 404; meta.can_mark_stock says so;
//   - refusals: today or earlier, more than a year ahead, a day that
//     doesn't exist, a long note;
//   - Pepper: set_out_of_stock by the supplier's code and by name with the
//     supplier, its card and audit, back in stock, its refusals; order_form
//     says a line is out of stock for the next delivery; place_order's card
//     warns for a day before the date and not after it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays, nowAt } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, operator, viewer, otherOwner, V
let brakes, bidfood, thigh, thighBrakes, thighBid, rice, riceBrakes, list

const today = () => nowAt('Europe/London').date
const day = n => addDays(today(), n)
const newItem = body => ok(owner.post('/api/inventory/items', { base_unit: 'g', ...body }), body.name)
const quotesOf = async (it, body) => (await ok(owner.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price')).quotes
const stock = (who, quoteId, body) => who.put(`/api/purchasing/quotes/${quoteId}/stock`, body)
const failed = async (p, status) => {
  const r = await p
  assert.equal(r.status, status, r.body)
  return r.json
}
const lineOf = (order, item) => order.items.find(i => i.item_id === item.id)

/** A new draft on the list with these [item, qty, quote] lines. */
async function draft(lines) {
  const drafts = await ok(owner.get(`/api/purchasing/orders?venue_id=${V}&status=draft`))
  for (const d of drafts.filter(d => d.list_id === list.id)) await ok(owner.delete(`/api/purchasing/orders/${d.id}`), 'old draft')
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft')
  if (lines.length) {
    await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, {
      lines: lines.map(([it, qty, q]) => ({ item_id: it.id, qty, quote_id: q.id })),
    }), 'lines')
  }
  return o
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
  // Operators order but neither approve nor see the catalogue.
  const roles = await ok(owner.get('/api/access/roles'))
  await ok(owner.patch(`/api/access/roles/${roles.find(r => r.key === 'operator').id}`, {
    permissions: { purchasing: 'manage', purchasing_approve: 'none', purchasing_setup: 'none' },
  }), 'operator role')

  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print', lead_days: 1 }), 'brakes')
  bidfood = await ok(owner.post('/api/suppliers', { name: 'Bidfood', send_method: 'print', lead_days: 1 }), 'bidfood')
  thigh = await newItem({ name: 'Chicken thigh' })
  ;[thighBrakes] = await quotesOf(thigh, { supplier_id: brakes.id, supplier_code: 'MEA161', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 30 })
  thighBid = (await quotesOf(thigh, { supplier_id: bidfood.id, supplier_code: 'BF-2201', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 32 }))
    .find(q => q.supplier_id === bidfood.id)
  rice = await newItem({ name: 'Basmati rice' })
  ;[riceBrakes] = await quotesOf(rice, { supplier_id: brakes.id, supplier_code: 'RICE1', pack_name: 'Bag', pack_qty: 10, pack_unit: 'kg', price: 16 })
  list = await ok(owner.post('/api/purchasing/lists', { name: 'Stock list', venue_ids: [V], item_ids: [thigh.id, rice.id] }), 'list')
})
after(closeApp)

test('marking a price out of stock, and back in stock', async () => {
  const back = day(6)
  const r = await ok(stock(owner, thighBrakes.id, { until: back, note: '  Depot short  ' }), 'mark')
  assert.equal(r.id, thighBrakes.id)
  assert.equal(r.out_of_stock_until, back)
  assert.equal(r.out_of_stock_note, 'Depot short', 'trimmed')
  assert.equal(r.out_of_stock_by, A.owner + '@test.local')
  assert.ok(r.out_of_stock_at)
  const [row] = await sql`SELECT out_of_stock_until::text AS until, out_of_stock_note AS note, updated_at FROM inv_quotes WHERE id = ${thighBrakes.id}`
  assert.deepEqual([row.until, row.note], [back, 'Depot short'])

  // On the Inventory page's item, as a date.
  const item = await ok(owner.get(`/api/inventory/items/${thigh.id}`))
  const q = item.quotes.find(x => x.id === thighBrakes.id)
  assert.deepEqual([q.out_of_stock_until, q.out_of_stock_note, q.out_of_stock_by], [back, 'Depot short', A.owner + '@test.local'])
  assert.equal(item.quotes.find(x => x.id === thighBid.id).out_of_stock_until, null)

  // Changing it keeps one date; a note left out is cleared.
  await ok(stock(owner, thighBrakes.id, { until: day(8) }), 'change')
  const [again] = await sql`SELECT out_of_stock_until::text AS until, out_of_stock_note AS note FROM inv_quotes WHERE id = ${thighBrakes.id}`
  assert.deepEqual([again.until, again.note], [day(8), null])

  // Back in stock clears all four.
  const cleared = await ok(stock(owner, thighBrakes.id, { until: null, note: 'ignored' }), 'back')
  assert.deepEqual([cleared.out_of_stock_until, cleared.out_of_stock_note, cleared.out_of_stock_by, cleared.out_of_stock_at], [null, null, null, null])
})

test('nothing moves to another price: the line, the usual price and placing stay as they were', async () => {
  const back = day(6)
  const o = await draft([[thigh, 3, thighBrakes]])
  await ok(stock(owner, thighBrakes.id, { until: back, note: 'Depot short' }), 'mark')
  const order = await ok(owner.get(`/api/purchasing/orders/${o.id}`))
  const line = lineOf(order, thigh)
  assert.equal(line.quote.id, thighBrakes.id, 'still on the Brakes price')
  assert.equal(line.default_quote_id, thighBrakes.id, 'still the usual price (cheaper)')
  assert.deepEqual([line.quote.out_of_stock_until, line.quote.out_of_stock_note], [back, 'Depot short'])
  assert.equal(line.quotes.find(q => q.id === thighBrakes.id).out_of_stock_until, back)
  assert.equal(line.quotes.find(q => q.id === thighBid.id).out_of_stock_until, null)
  assert.ok(order.suppliers[brakes.id].next_delivery < back, 'the next delivery is before it')

  // The pickers say so too.
  const cat = await ok(operator.get(`/api/purchasing/venues/${V}/catalog?search=MEA161`))
  assert.equal(cat[0].quotes.find(q => q.id === thighBrakes.id).out_of_stock_until, back)

  // Placing for a day before it still works, on the same price; the PO's line says so.
  const placed = await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, { suppliers: { [brakes.id]: { delivery_date: day(2) } } }), 'placed')
  const po = await ok(owner.get(`/api/purchasing/pos/${placed.purchase_orders[0].id}`))
  assert.equal(po.lines[0].quote_id, thighBrakes.id)
  assert.equal(po.lines[0].qty, 3)
  assert.deepEqual([po.lines[0].out_of_stock_until, po.lines[0].out_of_stock_note], [back, 'Depot short'])
  await ok(stock(owner, thighBrakes.id, { until: null }), 'back')
  const po2 = await ok(owner.get(`/api/purchasing/pos/${placed.purchase_orders[0].id}`))
  assert.equal(po2.lines[0].out_of_stock_until, null)
})

test('who may mark it, and what is refused', async () => {
  // Ordering staff without the catalogue may; so meta says.
  const meta = await ok(operator.get('/api/purchasing/meta'))
  assert.equal(meta.can_mark_stock, true)
  assert.equal(meta.show_prices, false)
  assert.equal((await ok(viewer.get('/api/purchasing/meta'))).can_mark_stock, false)
  assert.equal((await ok(owner.get('/api/purchasing/meta'))).can_mark_stock, true)
  const byOperator = await ok(stock(operator, riceBrakes.id, { until: day(3), note: 'Said on the phone' }), 'operator')
  assert.equal(byOperator.out_of_stock_by, A.operator + '@test.local')
  await failed(stock(viewer, riceBrakes.id, { until: day(3) }), 403)
  await failed(stock(otherOwner, riceBrakes.id, { until: day(3) }), 404)
  await failed(stock(owner, '00000000-0000-4000-8000-000000000000', { until: day(3) }), 404)

  // Today or earlier, too far ahead, a day that doesn't exist, bad shapes.
  assert.equal((await failed(stock(owner, riceBrakes.id, { until: today() }), 422)).code, 'stock_until')
  assert.equal((await failed(stock(owner, riceBrakes.id, { until: day(-1) }), 422)).code, 'stock_until')
  assert.equal((await failed(stock(owner, riceBrakes.id, { until: day(367) }), 422)).code, 'stock_until')
  await ok(stock(owner, riceBrakes.id, { until: day(366) }), 'a year ahead is fine')
  await failed(stock(owner, riceBrakes.id, { until: '2026-02-30' }), 400)
  await failed(stock(owner, riceBrakes.id, { until: '10/11/2026' }), 400)
  await failed(stock(owner, riceBrakes.id, {}), 400)
  await failed(stock(owner, riceBrakes.id, { until: day(3), note: 'x'.repeat(501) }), 400)
  // Nothing refused changed the row.
  const [row] = await sql`SELECT out_of_stock_until::text AS until FROM inv_quotes WHERE id = ${riceBrakes.id}`
  assert.equal(row.until, day(366))
  await ok(stock(owner, riceBrakes.id, { until: null }), 'back')
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

test('Pepper marks a price out of stock and warns on orders for a day before it', async () => {
  // By the supplier's code: that price, whoever else sells the item.
  const back = day(5)
  const { card, out } = await pepper(A.operator, 'set_out_of_stock', { item: 'MEA161', until: back, note: 'Recall' })
  assert.equal(card.title, 'Mark it out of stock?')
  assert.match(card.lines[0], /Chicken thigh from Brakes \(Case.*\[MEA161\]\)/)
  assert.ok(card.lines.some(l => /Out of stock until .* \(the first day it can be delivered again\)/.test(l)))
  assert.ok(card.lines.some(l => /What they said: Recall/.test(l)))
  assert.equal(card.pin.quote_id, thighBrakes.id)
  assert.match(out.out_of_stock_until, /\d{4}/)
  const [row] = await sql`SELECT out_of_stock_until::text AS until, out_of_stock_note AS note, out_of_stock_by AS who FROM inv_quotes WHERE id = ${thighBrakes.id}`
  assert.deepEqual([row.until, row.note, row.who], [back, 'Recall', A.operator + '@test.local'])
  const [audit] = await sql`SELECT ok FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'set_out_of_stock' ORDER BY created_at DESC LIMIT 1`
  assert.equal(audit.ok, true)

  // By name: two suppliers sell it, so it asks which; with the supplier it's that one.
  await assert.rejects(pepper(A.owner, 'set_out_of_stock', { item: 'chicken thigh', until: day(4) }, { run: false }), /several prices/)
  const bid = await pepper(A.owner, 'set_out_of_stock', { item: 'chicken thigh', supplier: 'bidfood', until: day(4) }, { run: false })
  assert.equal(bid.card.pin.quote_id, thighBid.id)
  // Marked already: the card says this replaces it.
  const again = await pepper(A.owner, 'set_out_of_stock', { item: 'MEA161', until: day(7) }, { run: false })
  assert.ok(again.card.warnings.some(w => /already marked out of stock until/.test(w)))

  // order_form: the line says so for the next delivery; another supplier's price is offered as it is.
  const o = await draft([[thigh, 2, thighBrakes]])
  const form = (await pepper(A.owner, 'order_form', { order_id: o.id })).out
  const line = form.items.find(i => i.item === 'Chicken thigh')
  assert.match(line.out_of_stock, /Brakes said it's out of stock until .* \(the first day it can be delivered again\): Recall/)
  assert.ok(line.other_choices.some(c => /^Bidfood/.test(c) && !/out of stock/.test(c)))

  // place_order's card: a warning for a day before the date, none from the date on.
  // (The earlier test left a purchase order for day 2: a separate one.)
  const early = await pepper(A.owner, 'place_order', {
    order_id: o.id, deliveries: [{ supplier: 'Brakes', date: day(2), existing_order: 'separate' }],
  }, { run: false })
  assert.ok(early.card.warnings.some(w => /Brakes said Chicken thigh is out of stock until .*may not come on/.test(w)), early.card.warnings?.join(' | '))
  const later = await pepper(A.owner, 'place_order', { order_id: o.id, deliveries: [{ supplier: 'Brakes', date: back }] }, { run: false })
  assert.ok(!(later.card.warnings || []).some(w => /out of stock/.test(w)))

  // find_inventory_items (catalogue people) shows it on the price.
  const found = (await pepper(A.owner, 'find_inventory_items', { search: 'MEA161' })).out
  assert.match(found.items[0].prices.find(p => p.quote_id === thighBrakes.id).out_of_stock, /until .*: Recall/)

  // Back in stock; then again is refused, as are both or neither, today, and viewers.
  const cleared = await pepper(A.owner, 'set_out_of_stock', { item: 'MEA161', back_in_stock: true })
  assert.equal(cleared.card.title, 'Mark it back in stock?')
  assert.equal(cleared.out.back_in_stock, true)
  await assert.rejects(pepper(A.owner, 'set_out_of_stock', { item: 'MEA161', back_in_stock: true }), /isn't marked out of stock/)
  await assert.rejects(pepper(A.owner, 'set_out_of_stock', { item: 'MEA161' }), /Give until/)
  await assert.rejects(pepper(A.owner, 'set_out_of_stock', { item: 'MEA161', until: day(3), back_in_stock: true }), /Give until/)
  // Today is refused before a card is shown, not only when it runs.
  await assert.rejects(pepper(A.owner, 'set_out_of_stock', { item: 'MEA161', until: today() }, { run: false }), /a day after today/)
  await assert.rejects(pepper(A.viewer, 'set_out_of_stock', { item: 'MEA161', until: day(3) }), /permission/)
  await assert.rejects(pepper(A.owner, 'set_out_of_stock', { item: 'Unicorn steaks', until: day(3) }), /No product called/)
})
