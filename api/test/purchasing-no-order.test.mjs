// Deliveries booked in without a purchase order (migration 238): the
// Purchasing setting that allows them (off, anyone who books deliveries in,
// only people with Purchasing approval), booking one in (a purchase order
// made received at once, its lines what arrived, its totals what arrived,
// the H&S delivery check), correcting it later (quantities follow, a line at
// 0 comes off, lines added), reading its invoice before it has an order
// (against a stand-in Claude) and the refusals: settings, another tenant,
// switched-off suppliers, days out of range, statuses that need an order,
// the order documents. Orders the venue places still show their last order
// without counting these.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { addDays, nowAt } = await import('../../shared/procurement.js')
const { systemSql } = await import('../src/config/db.js')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const today = nowAt('Europe/London').date
const CHECK = { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true }

let ids, owner, operator, viewer, otherOwner, V, VB, sup, offSup, otherSup, supB, items = {}, quotes = {}

const reply = obj => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 5000, output_tokens: 700 } })
const L = (o = {}) => ({
  description: '', product_code: '', pack: '', pack_count: '', pack_size: '', pack_unit: '', qty: '', unit_price: '', vat_rate: '',
  line_total: '', is_charge: false, order_line: '', catalogue: '', substitute: false, qty_in_packs: '', price_per_pack: '', ...o,
})

const deliver = (who, body, venue = V) => who.post(`/api/purchasing/venues/${venue}/deliveries`, body)
const setting = v => ok(owner.put('/api/purchasing/settings', { receive_without_order: v }), 'setting ' + v)

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(otherOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))).id
  sup = await ok(owner.post('/api/suppliers', { name: 'Dairy Direct', send_method: 'print', lead_days: 1 }))
  otherSup = await ok(owner.post('/api/suppliers', { name: 'Bread Co', send_method: 'print' }))
  offSup = await ok(owner.post('/api/suppliers', { name: 'Old Supplier', send_method: 'print' }))
  await ok(owner.patch(`/api/suppliers/${offSup.id}`, { is_active: false }))
  supB = await ok(otherOwner.post('/api/suppliers', { name: 'Their Supplier', send_method: 'print' }))
  const item = async (key, body, quote, supplier = sup) => {
    items[key] = await ok(owner.post('/api/inventory/items', body), key)
    if (quote) {
      const it = await ok(owner.post(`/api/inventory/items/${items[key].id}/quotes`, { supplier_id: supplier.id, ...quote }), key + ' price')
      quotes[key] = it.quotes.find(q => q.supplier_code === quote.supplier_code)
    }
  }
  await item('milk', { name: 'Milk', base_unit: 'ml', storage: 'chilled' }, { supplier_code: 'MK-12', pack_name: 'Crate', pack_count: 6, pack_qty: 2, pack_unit: 'l', price: 9, vat_rate: 0 })
  await item('cream', { name: 'Cream', base_unit: 'ml', storage: 'chilled' }, { supplier_code: 'CR-1', pack_name: 'Tub', pack_qty: 1, pack_unit: 'l', price: 4.5, vat_rate: 0 })
  await item('cups', { name: 'Cups', base_unit: 'each' }, { supplier_code: 'CP-50', pack_name: 'Sleeve', pack_qty: 50, pack_unit: 'each', price: 3, vat_rate: 20 })
  await item('bread', { name: 'Bread', base_unit: 'each' }, { supplier_code: 'BR-1', pack_name: 'Loaf', pack_qty: 1, pack_unit: 'each', price: 2 }, otherSup)
  await item('butter', { name: 'Butter', base_unit: 'g', storage: 'chilled' })
})
test.after(async () => { await claude.close(); await closeApp() })

test('the setting: off at first; only Purchasing setup changes it; meta says who may book in without an order', async () => {
  assert.deepEqual(await ok(owner.get('/api/purchasing/settings')), { receive_without_order: 'off' })
  let meta = await ok(operator.get('/api/purchasing/meta'))
  assert.equal(meta.receive_without_order, 'off')
  assert.equal(meta.can_receive_without_order, false)

  assert.equal((await operator.put('/api/purchasing/settings', { receive_without_order: 'anyone' })).status, 403, 'operators have no Purchasing setup')
  assert.equal((await viewer.put('/api/purchasing/settings', { receive_without_order: 'anyone' })).status, 403)
  assert.equal((await owner.put('/api/purchasing/settings', { receive_without_order: 'always' })).status, 400)

  const off = await deliver(operator, { supplier_id: sup.id, lines: [{ item_id: items.cups.id, quote_id: quotes.cups.id, received_qty: 1 }], check: CHECK })
  assert.equal(off.status, 403)
  assert.match(off.json.error, /switched off/)

  await setting('anyone')
  meta = await ok(operator.get('/api/purchasing/meta'))
  assert.equal(meta.can_receive_without_order, true)
  assert.equal((await ok(viewer.get('/api/purchasing/meta'))).can_receive_without_order, false, 'a viewer books nothing in')
  // Another group's setting is its own.
  assert.equal((await ok(otherOwner.get('/api/purchasing/settings'))).receive_without_order, 'off')
  const [row] = await systemSql`SELECT updated_by FROM purchasing_settings WHERE tenant_id = ${ids.a}`
  assert.ok(row.updated_by, 'who changed it is kept')
})

let po
test('booking a delivery in without an order: a purchase order received at once, its lines what arrived', async () => {
  const res = await deliver(operator, {
    supplier_id: sup.id, supplier_ref: 'DN-4471', notes: 'Driver brought extra',
    lines: [
      { item_id: items.milk.id, quote_id: quotes.milk.id, received_qty: 3, invoice_price: 1 },
      { item_id: items.cups.id, quote_id: quotes.cups.id, received_qty: 2, status: 'damaged', note: 'One sleeve crushed' },
    ],
    check: { ...CHECK, damage_ok: false, chilled_temp_c: 4, corrective_action: 'Kept, credit asked' },
  })
  assert.equal(res.status, 200, res.body)
  po = res.json
  assert.equal(po.no_order, true)
  assert.equal(po.status, 'received')
  assert.equal(po.delivery_date, today)
  assert.equal(po.supplier_ref, 'DN-4471')
  assert.equal(po.sent_at, null)
  assert.ok(po.received_at)
  assert.equal(po.show_prices, false, 'operators see no prices')
  assert.equal(po.total, undefined)
  const milk = po.lines.find(l => l.item_name === 'Milk')
  const cups = po.lines.find(l => l.item_name === 'Cups')
  assert.deepEqual([milk.qty, milk.received_qty, milk.receive_status, milk.added_on_receipt], [3, 3, 'ok', false])
  assert.deepEqual([cups.qty, cups.received_qty, cups.receive_status, cups.receive_note], [2, 2, 'damaged', 'One sleeve crushed'])
  assert.equal(milk.price, undefined)

  // The owner sees the prices: an operator's typed price was ignored; totals are what arrived.
  const full = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  const m = full.lines.find(l => l.item_name === 'Milk')
  assert.equal(m.price, 9)
  assert.equal(m.invoice_price, null, 'a price typed without price access is ignored')
  assert.deepEqual([full.subtotal, full.vat, full.total], [33, 1.2, 34.2])

  assert.equal(po.delivery_check.delivery_date, today)
  assert.equal(po.delivery_check.accepted, true)
  assert.equal(po.delivery_check.temp_ok, true)
  assert.equal(po.delivery_check.corrective_action, 'Kept, credit asked')
  assert.match(po.delivery_check.notes, /booked in without an order, 2 lines/)
  assert.match(po.delivery_check.notes, /Cups: Damaged \(One sleeve crushed\)/)
  assert.ok(po.delivery_check.items.every(i => i.ordered === undefined), 'nothing was ordered')
  assert.equal(po.delivery_check.items.find(i => i.name === 'Milk').temp_c, 4)

  // In the list, as received; the order documents are refused.
  const list = await ok(owner.get(`/api/purchasing/pos?venue_id=${V}&status=received`))
  assert.equal(list.find(p => p.id === po.id).no_order, true)
  const file = await owner.get(`/api/purchasing/pos/${po.id}/file?format=pdf`)
  assert.equal(file.status, 409)
  assert.equal((await owner.post(`/api/purchasing/pos/${po.id}/send`)).status, 409)
  assert.equal((await owner.post(`/api/purchasing/pos/${po.id}/cancel`)).status, 409)
})

test('refusals: temperatures, suppliers, venues, days, statuses, products', async () => {
  const one = (o = {}) => ({ supplier_id: sup.id, lines: [{ item_id: items.cups.id, quote_id: quotes.cups.id, received_qty: 1 }], check: CHECK, ...o })
  const r = async (who, body, status, re, venue) => {
    const res = await deliver(who, body, venue)
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 120) + ' ' + res.body)
    if (re) assert.match(res.json.error, re)
  }
  await r(operator, one({ lines: [{ item_id: items.milk.id, quote_id: quotes.milk.id, received_qty: 1 }] }), 422, /temperature of the chilled/)
  await r(operator, one({ supplier_id: offSup.id }), 422, /switched off/)
  await r(operator, one({ supplier_id: supB.id }), 404)
  await r(operator, one(), 404, null, VB)
  await r(otherOwner, one(), 403, /switched off/, VB)
  await r(operator, one({ received_date: addDays(today, 1) }), 422, /after today/)
  await r(operator, one({ received_date: addDays(today, -32) }), 422, /last 31 days/)
  await r(operator, one({ lines: [{ item_id: items.cups.id, quote_id: quotes.cups.id, received_qty: 1, status: 'short' }] }), 422, /OK or damaged/)
  await r(operator, one({ lines: [{ item_id: items.bread.id, quote_id: quotes.bread.id, received_qty: 1 }] }), 422, /not from this supplier/)
  await r(operator, one({ lines: [{ item_id: items.butter.id, received_qty: 1 }] }), 422, /came packed/)
  await r(operator, one({ lines: [] }), 400)
  await r(viewer, one(), 403)
  // Nothing was made by any of these.
  const all = await systemSql`SELECT count(*)::int AS n FROM purchase_orders WHERE tenant_id = ${ids.a} AND no_order`
  assert.equal(all[0].n, 1)
})

test('a day in the last month; an item packed as it came; the venue\'s last order doesn\'t count it', async () => {
  const day = addDays(today, -3)
  const res = await deliver(owner, {
    supplier_id: sup.id, received_date: day,
    lines: [{ item_id: items.butter.id, pack: { name: 'Block', count: 4, qty: 250, unit: 'g' }, received_qty: 2, invoice_price: 7.2 }],
    check: { ...CHECK, chilled_temp_c: 3 },
  })
  assert.equal(res.status, 200, res.body)
  const b = res.json
  assert.equal(b.delivery_date, day)
  assert.equal(b.delivery_check.delivery_date, day)
  const l = b.lines[0]
  assert.deepEqual([l.item_name, l.pack_label, l.pack_base_qty, l.qty, l.quote_id], ['Butter', 'Block · 4 × 250 g', 1000, 2, null])
  assert.equal(l.invoice_price, 7.2, 'an owner\'s price paid is kept as the invoice price')
  assert.deepEqual([b.subtotal, b.total], [14.4, 14.4])
  assert.equal(b.price_list.find(x => x.line_id === l.id)?.kind, 'new', 'offered for the price list')

  // An order form for the venue: milk's last order isn't the delivery without an order.
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Dairy', venue_ids: [V], item_ids: [items.milk.id] }))
  const order = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }))
  const form = await ok(owner.get(`/api/purchasing/orders/${order.id}`))
  const milk = form.items.find(i => i.item_id === items.milk.id)
  assert.equal(milk.last, null, 'never ordered')
})

test('correcting it: quantities follow, a line at 0 comes off, lines can be added, the day can move', async () => {
  const milk = po.lines.find(l => l.item_name === 'Milk')
  const cups = po.lines.find(l => l.item_name === 'Cups')
  const fix = (body, who = operator) => who.post(`/api/purchasing/pos/${po.id}/receive`, { check: { ...CHECK, chilled_temp_c: 5 }, ...body })
  let res = await fix({ lines: [{ id: milk.id, received_qty: 4 }, { id: cups.id, received_qty: 0 }] })
  assert.equal(res.status, 200, res.body)
  assert.deepEqual(res.json.lines.map(l => [l.item_name, l.qty, l.received_qty]), [['Milk', 4, 4]], 'cups came off')
  res = await fix({ lines: [{ id: milk.id, received_qty: 0 }] })
  assert.equal(res.status, 422)
  assert.match(res.json.error, /at least one line/)
  res = await fix({ lines: [{ id: milk.id, received_qty: 4, status: 'missing' }] })
  assert.equal(res.status, 422)
  res = await fix({
    received_date: addDays(today, -1),
    lines: [{ id: milk.id, received_qty: 4 }],
    add: [{ item_id: items.cream.id, quote_id: quotes.cream.id, received_qty: 2 }],
  })
  assert.equal(res.status, 200, res.body)
  const cream = res.json.lines.find(l => l.item_name === 'Cream')
  assert.deepEqual([cream.qty, cream.received_qty, cream.added_on_receipt], [2, 2, false])
  assert.equal(res.json.delivery_date, addDays(today, -1))
  assert.equal(res.json.delivery_check.delivery_date, addDays(today, -1))
  const full = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  assert.deepEqual([full.subtotal, full.total], [45, 45], '4 x 9 + 2 x 4.50')
  // Moving it outside the last month is refused; keeping its day isn't checked.
  res = await fix({ received_date: addDays(today, -40), lines: [{ id: milk.id, received_qty: 4 }] })
  assert.equal(res.status, 422)
})

test('only people with Purchasing approval, when the setting says so', async () => {
  await setting('approvers')
  const roles = await ok(owner.get('/api/access/roles'))
  const op = roles.find(r => r.key === 'operator')
  await ok(owner.patch(`/api/access/roles/${op.id}`, { permissions: { purchasing_approve: 'none' } }), 'operator role')
  try {
    assert.equal((await ok(operator.get('/api/purchasing/meta'))).can_receive_without_order, false)
    const res = await deliver(operator, { supplier_id: sup.id, lines: [{ item_id: items.cups.id, quote_id: quotes.cups.id, received_qty: 1 }], check: CHECK })
    assert.equal(res.status, 403)
    assert.match(res.json.error, /Purchasing approval/)
    assert.equal((await ok(owner.get('/api/purchasing/meta'))).can_receive_without_order, true)
  } finally {
    await ok(owner.patch(`/api/access/roles/${op.id}`, { permissions: { purchasing_approve: 'manage' } }))
    await setting('anyone')
  }
})

test('reading the invoice before there is an order, then booking the delivery in with it', async () => {
  claude.script.push(reply({
    supplier_name: 'Dairy Direct', invoice_number: 'D-881', invoice_date: today, prices_include_vat: false,
    lines: [
      L({ description: 'Whole milk 6x2L', product_code: 'MK-12', pack: '6 x 2L', qty: '2', unit_price: '9.60', vat_rate: '0', line_total: '19.20', catalogue: 'C3', qty_in_packs: '2', price_per_pack: '9.60' }),
      L({ description: 'Salted butter 40x10g', product_code: 'BT-40', pack: '40 x 10g', pack_count: '40', pack_size: '10', pack_unit: 'g', qty: '1', unit_price: '6.00', vat_rate: '0', line_total: '6.00' }),
      L({ description: 'Delivery', line_total: '3.00', is_charge: true }),
    ],
    subtotal: '25.20', vat: '0', delivery_charge: '3.00', total: '28.20', notes: '',
  }))
  const read = await owner.post('/api/ai/invoices/read', { venue_id: V, supplier_id: sup.id, files: [{ name: 'note.png', data: PNG }] })
  assert.equal(read.status, 200, read.body)
  const content = claude.requests[claude.requests.length - 1].body.messages[0].content
  const sent = JSON.parse(content[1].text.slice(content[1].text.indexOf('{')))
  assert.deepEqual(sent.order, [], 'no order lines')
  assert.deepEqual(sent.catalogue.map(c => c.item), ['Cream', 'Cups', 'Milk'], 'every product of the supplier')
  const invoice = read.json.invoice
  const [milkLine, butterLine] = invoice.lines
  assert.deepEqual([milkLine.match.kind, milkLine.match.quote_id, milkLine.match.item_id], ['quote', quotes.milk.id, items.milk.id])
  const [stored] = await systemSql`SELECT po_id, venue_id, supplier_id, applied_at FROM purchase_invoices WHERE id = ${invoice.id}`
  assert.deepEqual([stored.po_id, stored.venue_id, stored.supplier_id, stored.applied_at], [null, V, sup.id, null])

  // Not for another supplier's delivery.
  const wrong = await deliver(owner, {
    supplier_id: otherSup.id, invoice_id: invoice.id, check: CHECK,
    lines: [{ item_id: items.bread.id, quote_id: quotes.bread.id, received_qty: 1 }],
  })
  assert.equal(wrong.status, 404)

  const res = await deliver(owner, {
    supplier_id: sup.id, invoice_id: invoice.id, supplier_ref: 'D-881', check: { ...CHECK, chilled_temp_c: 4 },
    lines: [
      { item_id: items.milk.id, quote_id: quotes.milk.id, received_qty: 2, invoice_idx: milkLine.idx },
      { item_id: items.butter.id, pack: { name: 'Pack', count: 40, qty: 10, unit: 'g' }, received_qty: 1, invoice_idx: butterLine.idx, note: 'Invoiced as Salted butter 40x10g' },
    ],
  })
  assert.equal(res.status, 200, res.body)
  const d = res.json
  const milk = d.lines.find(l => l.item_name === 'Milk')
  assert.deepEqual([milk.qty, milk.invoice_price, milk.invoice_name, milk.invoice_code], [2, 9.6, 'Whole milk 6x2L', 'MK-12'])
  const butter = d.lines.find(l => l.item_name === 'Butter')
  assert.deepEqual([butter.qty, butter.price, butter.invoice_price], [1, 6, 6])
  assert.deepEqual([d.subtotal, d.total], [25.2, 25.2], 'at the invoice\'s prices')
  assert.equal(d.invoices.length, 1)
  assert.equal(d.invoices[0].invoice_number, 'D-881')
  const [after] = await systemSql`SELECT po_id, applied_at FROM purchase_invoices WHERE id = ${invoice.id}`
  assert.equal(after.po_id, d.id)
  assert.ok(after.applied_at)
  assert.deepEqual(d.price_list.map(r => [r.item_name, r.kind]).sort(), [['Butter', 'new'], ['Milk', 'price']])

  // The same reading can't be used twice.
  const again = await deliver(owner, {
    supplier_id: sup.id, invoice_id: invoice.id, check: CHECK,
    lines: [{ item_id: items.cups.id, quote_id: quotes.cups.id, received_qty: 1 }],
  })
  assert.equal(again.status, 404)

  // Reading without an order follows the setting, and another group's venue or supplier is refused.
  await setting('off')
  try {
    const refused = await owner.post('/api/ai/invoices/read', { venue_id: V, supplier_id: sup.id, files: [{ name: 'n.png', data: PNG }] })
    assert.equal(refused.status, 403)
  } finally { await setting('anyone') }
  assert.equal((await owner.post('/api/ai/invoices/read', { venue_id: VB, supplier_id: sup.id, files: [{ name: 'n.png', data: PNG }] })).status, 404)
  assert.equal((await owner.post('/api/ai/invoices/read', { venue_id: V, supplier_id: supB.id, files: [{ name: 'n.png', data: PNG }] })).status, 404)
  assert.equal((await owner.post('/api/ai/invoices/read', { venue_id: V, files: [{ name: 'n.png', data: PNG }] })).status, 400)
})

test('the supplier list for a delivery without an order includes suppliers with no prices', async () => {
  const usual = await ok(operator.get(`/api/purchasing/venues/${V}/suppliers`))
  const every = await ok(operator.get(`/api/purchasing/venues/${V}/suppliers?all=1`))
  const noPrices = await ok(owner.post('/api/suppliers', { name: 'Cash and Carry', send_method: 'print' }))
  const every2 = await ok(operator.get(`/api/purchasing/venues/${V}/suppliers?all=1`))
  assert.ok(!usual.some(s => s.id === noPrices.id))
  assert.ok(every2.some(s => s.id === noPrices.id && s.prices === 0))
  assert.ok(!every.some(s => s.id === offSup.id), 'not switched-off ones')
  assert.equal(every2.find(s => s.id === sup.id).prices, 3)
})
