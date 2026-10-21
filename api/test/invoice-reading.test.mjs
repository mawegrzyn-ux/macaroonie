// Invoices read on receiving and receipts read for petty cash (migration
// 197) against a stand-in Claude (support/fake-claude.mjs). Invoices: what
// reaches Claude (the order's lines as L refs and the supplier's other
// products as C refs), what comes back matched (by ref, by code), the
// reading kept with its files, prices hidden from people without price
// access, booking the delivery in with it (invoice prices on the lines,
// lines added for what wasn't ordered, the order's totals unchanged, the
// supplier's copy without the added lines), the price list rows that follow
// and updating the price list from them (company / venue price, a new
// supplier price with its product name, made the usual one), and the
// refusals (permissions, another tenant, Pepper off). Supplier product names
// on quotes reach order lines and the supplier's copy. Receipts: the fields
// back for the expense form, the venue's category matched by name.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { addDays } = await import('../../shared/procurement.js')
const { systemSql } = await import('../src/config/db.js')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64')
const today = new Date().toISOString().slice(0, 10)

let ids, owner, operator, viewer, otherOwner, V, VB, sup, items = {}, quotes = {}, po

const reply = obj => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 6000, output_tokens: 900 } })
const lastBody = () => claude.requests[claude.requests.length - 1].body
const L = (o = {}) => ({
  description: '', product_code: '', pack: '', pack_count: '', pack_size: '', pack_unit: '', qty: '', unit_price: '', vat_rate: '',
  line_total: '', is_charge: false, order_line: '', catalogue: '', substitute: false, qty_in_packs: '', price_per_pack: '', ...o,
})
const INVOICE = {
  supplier_name: 'Fresh Fields Ltd', invoice_number: 'INV-20931', invoice_date: today, prices_include_vat: false,
  lines: [
    L({ description: 'Heinz Tomato Ketchup 2x4.5L', product_code: 'HZ-45', pack: '2 x 4.5L', pack_count: '2', pack_size: '4.5', pack_unit: 'l', qty: '2', unit_price: '19.50', vat_rate: '20', line_total: '39.00', order_line: 'L1', qty_in_packs: '2', price_per_pack: '19.50' }),
    L({ description: 'Long grain rice 20kg', product_code: 'RC-20', pack: '20kg', pack_count: '1', pack_size: '20', pack_unit: 'kg', qty: '2', unit_price: '30.00', vat_rate: '0', line_total: '60.00' }),
    L({ description: 'Chicken thigh fillets 5kg', product_code: 'CHX-9', pack: '5kg', pack_count: '1', pack_size: '5', pack_unit: 'kg', qty: '1', unit_price: '27.00', vat_rate: '0', line_total: '27.00', order_line: 'L3', substitute: true, qty_in_packs: '1', price_per_pack: '27.00' }),
    L({ description: 'Napkins white 500', product_code: 'NP-500', pack: '500', qty: '1', unit_price: '6.00', vat_rate: '20', line_total: '6.00', catalogue: 'C1', qty_in_packs: '1', price_per_pack: '6.00' }),
    L({ description: 'Lemons unwaxed 5kg', product_code: 'LM-5', pack: '5kg', pack_count: '1', pack_size: '5', pack_unit: 'kg', qty: '1', unit_price: '8.00', vat_rate: '0', line_total: '8.00' }),
    L({ description: 'Delivery charge', line_total: '5.00', is_charge: true }),
    L({ description: 'L9 nonsense ref', qty: '1', unit_price: '1', order_line: 'L9' }),
  ],
  subtotal: '145.00', vat: '9.00', delivery_charge: '5.00', total: '159.00', notes: 'The second page was a little blurred.',
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(otherOwner.post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))).id
  sup = await ok(owner.post('/api/suppliers', { name: 'Fresh Fields', send_method: 'print', lead_days: 1 }), 'supplier')
  const item = async (key, body, quote) => {
    items[key] = await ok(owner.post('/api/inventory/items', body), key)
    if (quote) {
      const it = await ok(owner.post(`/api/inventory/items/${items[key].id}/quotes`, { supplier_id: sup.id, ...quote }), key + ' price')
      quotes[key] = it.quotes.find(q => q.supplier_code === quote.supplier_code)
    }
  }
  await item('ketchup', { name: 'Ketchup', base_unit: 'ml' }, { supplier_code: 'HZ-45', product_name: 'Heinz Tomato Ketchup', pack_name: 'Case', pack_count: 2, pack_qty: 4.5, pack_unit: 'l', price: 18, vat_rate: 20 })
  await item('rice', { name: 'Rice', base_unit: 'g' }, { supplier_code: 'RC-20', pack_name: 'Sack', pack_qty: 20, pack_unit: 'kg', price: 30 })
  await item('chicken', { name: 'Chicken thighs', base_unit: 'g', storage: 'chilled' }, { supplier_code: 'CH-5', pack_name: 'Box', pack_qty: 5, pack_unit: 'kg', price: 25 })
  await item('napkins', { name: 'Napkins', base_unit: 'each' }, { supplier_code: 'NP-500', pack_name: 'Pack', pack_qty: 500, pack_unit: 'each', price: 6, vat_rate: 20 })
  await item('lemons', { name: 'Lemons', base_unit: 'g', storage: 'chilled' })

  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Weekly', venue_ids: [V], item_ids: [items.ketchup.id, items.rice.id, items.chicken.id] }))
  const order = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }))
  await ok(owner.put(`/api/purchasing/orders/${order.id}/lines`, { lines: [{ item_id: items.ketchup.id, qty: 2 }, { item_id: items.rice.id, qty: 3 }, { item_id: items.chicken.id, qty: 1 }] }))
  await ok(owner.post(`/api/purchasing/orders/${order.id}/submit`, { suppliers: { [sup.id]: { delivery_date: addDays(today, 2) } } }), 'submit')
  const [p] = await ok(owner.get(`/api/purchasing/pos?venue_id=${V}`))
  po = await ok(owner.get(`/api/purchasing/pos/${p.id}`))
})
test.after(async () => { await claude.close(); await closeApp() })

const lineOf = (detail, name) => detail.lines.find(l => l.item_name === name)

test('a supplier product name goes onto the order line and the supplier\'s copy', async () => {
  const k = lineOf(po, 'Ketchup')
  assert.equal(k.product_name, 'Heinz Tomato Ketchup')
  const html = await owner.get(`/api/purchasing/pos/${po.id}/file?format=html`)
  assert.equal(html.status, 200)
  assert.match(html.body, /Heinz Tomato Ketchup/)
  const form = await ok(owner.get(`/api/inventory/items/${items.ketchup.id}`))
  assert.equal(form.quotes[0].product_name, 'Heinz Tomato Ketchup')
  // Cleared with an empty value.
  await ok(owner.patch(`/api/inventory/quotes/${quotes.ketchup.id}`, { product_name: '' }))
  assert.equal((await ok(owner.get(`/api/inventory/items/${items.ketchup.id}`))).quotes[0].product_name, null)
  await ok(owner.patch(`/api/inventory/quotes/${quotes.ketchup.id}`, { product_name: 'Heinz Tomato Ketchup' }))
})

let invoice
test('reading an invoice: the order and the supplier\'s other products reach Claude; lines come back matched', async () => {
  claude.script.push(reply(INVOICE))
  const res = await owner.post('/api/ai/invoices/read', { po_id: po.id, files: [{ name: 'inv.png', data: PNG }, { name: 'p2.pdf', data: PDF }] })
  assert.equal(res.status, 200, res.body)
  const content = lastBody().messages[0].content
  assert.equal(content[0].type, 'image')
  assert.equal(content[1].type, 'document')
  const sent = JSON.parse(content[2].text.slice(content[2].text.indexOf('{')))
  assert.equal(sent.supplier, 'Fresh Fields')
  assert.deepEqual(sent.order.map(o => o.ref), ['L1', 'L2', 'L3'])
  assert.equal(sent.order[0].product, 'Heinz Tomato Ketchup')
  assert.equal(sent.order[0].code, 'HZ-45')
  assert.deepEqual(sent.catalogue.map(c => [c.ref, c.item]), [['C1', 'Napkins']], 'only the supplier\'s products not on the order; no item without a price')
  assert.equal(lastBody().output_config.format.type, 'json_schema')

  invoice = res.json.invoice
  assert.equal(invoice.invoice_number, 'INV-20931')
  assert.equal(invoice.invoice_date, today)
  assert.equal(invoice.total, 159)
  assert.equal(invoice.files.length, 2)
  assert.match(invoice.files[0].url, /^\/uploads\/.*\/invoices\//)
  const [k, r, c, n, lem, del, bad] = invoice.lines
  const kl = lineOf(po, 'Ketchup'), rl = lineOf(po, 'Rice'), cl = lineOf(po, 'Chicken thighs')
  assert.deepEqual([k.match.kind, k.match.line_id, k.match.how], ['line', kl.id, 'pepper'])
  assert.equal(k.price_pack, 19.5)
  assert.deepEqual([r.match.kind, r.match.line_id, r.match.how], ['line', rl.id, 'code'], 'left unmatched by Claude, matched by its code')
  assert.equal(c.match.substitute, true)
  assert.equal(c.match.line_id, cl.id)
  assert.deepEqual([n.match.kind, n.match.quote_id], ['quote', quotes.napkins.id])
  assert.equal(lem.match, null)
  assert.deepEqual(lem.pack, { count: 1, qty: 5, unit: 'kg' })
  assert.equal(del.is_charge, true)
  assert.equal(del.line_total, 5)
  assert.equal(bad.match, null, 'a ref that isn\'t on the list is ignored')
  assert.deepEqual(res.json.catalogue.map(q => q.item_name), ['Napkins'])
  assert.equal(res.json.catalogue[0].price, 6)

  const [row] = await systemSql`SELECT tenant_id, applied_at, jsonb_array_length(lines) AS n FROM purchase_invoices WHERE id = ${invoice.id}`
  assert.equal(row.tenant_id, ids.a)
  assert.equal(row.applied_at, null)
  assert.equal(row.n, 7)
})

test('no prices for people without price access; refusals', async () => {
  claude.script.push(reply(INVOICE))
  const res = await operator.post('/api/ai/invoices/read', { po_id: po.id, files: [{ data: PNG }] })
  assert.equal(res.status, 200, res.body)
  const l = res.json.invoice.lines[0]
  assert.equal(l.price_pack, undefined)
  assert.equal(l.unit_price, undefined)
  assert.equal(res.json.invoice.total, undefined)
  assert.equal(res.json.catalogue[0].price, undefined)
  assert.equal(l.qty, 2, 'quantities still come')

  assert.equal((await viewer.post('/api/ai/invoices/read', { po_id: po.id, files: [{ data: PNG }] })).status, 403)
  assert.equal((await otherOwner.post('/api/ai/invoices/read', { po_id: po.id, files: [{ data: PNG }] })).status, 404, 'another tenant\'s order')
  assert.equal((await owner.post('/api/ai/invoices/read', { po_id: po.id, files: [{ data: Buffer.from('hello there').toString('base64') }] })).status, 422, 'not a photo or a PDF')
  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    assert.equal((await owner.post('/api/ai/invoices/read', { po_id: po.id, files: [{ data: PNG }] })).status, 403, 'Pepper off')
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }
})

let received
test('booking the delivery in with the invoice: invoice prices on the lines, what wasn\'t ordered added', async () => {
  const kl = lineOf(po, 'Ketchup'), rl = lineOf(po, 'Rice'), cl = lineOf(po, 'Chicken thighs')
  const check = { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true, chilled_temp_c: 3 }
  // Another tenant can't use this invoice on their own order, nor add our items.
  const noPack = await owner.post(`/api/purchasing/pos/${po.id}/receive`, {
    invoice_id: invoice.id, lines: [], add: [{ item_id: items.lemons.id, received_qty: 1 }], check,
  })
  assert.equal(noPack.status, 422, 'an added line needs its pack (from the invoice or given)')

  received = await ok(operator.post(`/api/purchasing/pos/${po.id}/receive`, {
    invoice_id: invoice.id,
    lines: [
      { id: kl.id, received_qty: 2, invoice_idx: 0, invoice_price: 1 },
      { id: rl.id, received_qty: 2, invoice_idx: 1 },
      { id: cl.id, received_qty: 1, status: 'substituted', note: 'Thigh fillets instead', invoice_idx: 2 },
    ],
    add: [
      { item_id: items.napkins.id, quote_id: quotes.napkins.id, received_qty: 1, invoice_idx: 3 },
      { item_id: items.lemons.id, received_qty: 1, invoice_idx: 4 },
    ],
    check,
  }), 'receive')
  assert.equal(received.status, 'received')
  assert.equal(received.lines.length, 5)
  assert.equal(lineOf(received, 'Ketchup').invoice_price, undefined, 'the operator doesn\'t see prices')

  const d = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  const k = lineOf(d, 'Ketchup')
  assert.equal(k.invoice_price, 19.5, 'the invoice\'s price: an operator\'s own price is ignored')
  assert.equal(k.invoice_code, 'HZ-45')
  assert.equal(k.price, 18, 'the ordered price stays')
  const r = lineOf(d, 'Rice')
  assert.deepEqual([r.received_qty, r.receive_status], [2, 'short'])
  const c = lineOf(d, 'Chicken thighs')
  assert.equal(c.receive_status, 'substituted')
  assert.equal(c.invoice_name, 'Chicken thigh fillets 5kg')
  const n = lineOf(d, 'Napkins')
  assert.deepEqual([n.added_on_receipt, n.qty, n.received_qty, n.quote_id], [true, 0, 1, quotes.napkins.id])
  const lem = lineOf(d, 'Lemons')
  assert.deepEqual([lem.added_on_receipt, lem.quote_id, lem.pack_spec], [true, null, { name: 'pack', count: 1, qty: 5, unit: 'kg' }])
  assert.equal(lem.invoice_price, 8)
  assert.equal(d.subtotal, po.subtotal, 'the order\'s totals don\'t change')
  assert.equal(d.invoices.length, 1)
  assert.equal(d.invoices[0].invoice_number, 'INV-20931')
  assert.equal(d.invoices[0].lines, undefined)
  assert.ok(d.delivery_check.items.some(i => i.name === 'Lemons' && i.added), 'the H&S delivery check lists it')

  const html = await owner.get(`/api/purchasing/pos/${po.id}/file?format=html`)
  assert.doesNotMatch(html.body, /Lemons|Napkins/, 'the supplier\'s copy shows what was ordered')

  const kinds = Object.fromEntries(d.price_list.map(p => [p.item_name, p.kind]))
  assert.deepEqual(kinds, { Ketchup: 'price', 'Chicken thighs': 'product', Lemons: 'new' }, 'rice and napkins already match the price list')
  assert.equal(d.price_list.find(p => p.item_name === 'Ketchup').quote.price, 18)

  // Booked in again: an added line with 0 is taken off.
  const again = await ok(owner.post(`/api/purchasing/pos/${po.id}/receive`, {
    lines: d.lines.map(l => ({ id: l.id, received_qty: l.id === n.id ? 0 : l.received_qty, status: l.receive_status, note: l.receive_note })),
    check,
  }))
  assert.equal(again.lines.length, 4)
  assert.equal(lineOf(again, 'Ketchup').invoice_price, 19.5, 'invoice prices stay when booked in again without the invoice')
})

test('updating the price list from the invoice', async () => {
  const d = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  const rowOf = name => d.price_list.find(p => p.item_name === name)
  assert.equal((await operator.post(`/api/purchasing/pos/${po.id}/price-list`, { changes: [{ line_id: rowOf('Ketchup').line_id, action: 'company' }] })).status, 403)
  assert.equal((await otherOwner.post(`/api/purchasing/pos/${po.id}/price-list`, { changes: [{ line_id: rowOf('Ketchup').line_id, action: 'company' }] })).status, 404)
  const noQuote = await owner.post(`/api/purchasing/pos/${po.id}/price-list`, { changes: [{ line_id: rowOf('Lemons').line_id, action: 'company' }] })
  assert.equal(noQuote.status, 422, 'a line without a supplier price is added, not updated')

  const after = await ok(owner.post(`/api/purchasing/pos/${po.id}/price-list`, {
    changes: [
      { line_id: rowOf('Ketchup').line_id, action: 'venue' },
      { line_id: rowOf('Chicken thighs').line_id, action: 'add', usual: 'venue' },
      { line_id: rowOf('Lemons').line_id, action: 'add', pack: { name: 'Bag', qty: 5, unit: 'kg' }, product_name: 'Unwaxed lemons' },
    ],
  }))
  assert.deepEqual(after.price_list, [], 'nothing left to update')

  const ketchup = await ok(owner.get(`/api/inventory/items/${items.ketchup.id}`))
  assert.equal(ketchup.quotes[0].price, 18, 'the company price stays')
  assert.equal(ketchup.quotes[0].venue_prices[V], 19.5, 'this venue pays the invoice price')
  const hist = await ok(owner.get(`/api/inventory/quotes/${quotes.ketchup.id}/history`))
  assert.equal(hist[0].source, 'invoice')
  const [h] = await systemSql`SELECT po_id FROM inv_price_history WHERE quote_id = ${quotes.ketchup.id} AND source = 'invoice'`
  assert.equal(h.po_id, po.id)

  const chicken = await ok(owner.get(`/api/inventory/items/${items.chicken.id}`))
  const sub = chicken.quotes.find(q => q.supplier_code === 'CHX-9')
  assert.equal(sub.product_name, 'Chicken thigh fillets 5kg')
  assert.equal(sub.price, 27)
  assert.equal(sub.pack_base_qty, 5000, 'the substitute\'s pack from the ordered price\'s pack spec or the invoice')
  assert.equal(chicken.preferred.venues[V], sub.id, 'now the one ordered at this venue')
  const lemons = await ok(owner.get(`/api/inventory/items/${items.lemons.id}`))
  assert.equal(lemons.quotes.length, 1)
  assert.deepEqual([lemons.quotes[0].pack_name, lemons.quotes[0].product_name, lemons.quotes[0].price, lemons.quotes[0].supplier_code], ['Bag', 'Unwaxed lemons', 8, 'LM-5'])
  assert.equal(lineOf(after, 'Lemons').quote_id, lemons.quotes[0].id)

  const dupe = await owner.post(`/api/purchasing/pos/${po.id}/price-list`, { changes: [{ line_id: lineOf(after, 'Lemons').id, action: 'add', pack: { name: 'Bag', qty: 5, unit: 'kg' } }] })
  assert.equal(dupe.status, 409, 'not added twice')
})

test('a receipt for petty cash: the expense form\'s fields, the venue\'s category matched', async () => {
  const cat = await ok(owner.post(`/api/venues/${V}/cash-recon/config/expense-categories`, { name: 'Cleaning' }))
  await ok(owner.post(`/api/venues/${V}/cash-recon/config/expense-categories`, { name: 'Food' }))
  claude.script.push(reply({ merchant: 'Tesco Express', description: 'Bin bags and bleach', date: '2026-10-19', total: '£14.30', vat: '2.38', paid_by: 'card', category: 'cleaning', notes: '' }))
  const res = await ok(operator.post('/api/ai/receipts/read', { venue_id: V, file: { name: 'r.jpg', data: PNG } }))
  assert.deepEqual(res, {
    merchant: 'Tesco Express', description: 'Tesco Express: Bin bags and bleach', date: '2026-10-19',
    amount: 14.3, vat_amount: 2.38, paid_by_card: true, category_id: cat.id, notes: null,
  })
  const sent = JSON.parse(lastBody().messages[0].content[1].text.slice(lastBody().messages[0].content[1].text.indexOf('{')))
  assert.deepEqual(sent.categories, ['Cleaning', 'Food'])

  claude.script.push(reply({ merchant: '', description: 'Milk', date: 'yesterday', total: '3.10', vat: '9.99', paid_by: 'unknown', category: 'Petrol', notes: 'Faded.' }))
  const odd = await ok(owner.post('/api/ai/receipts/read', { venue_id: V, file: { data: PDF } }))
  assert.deepEqual([odd.description, odd.date, odd.amount, odd.vat_amount, odd.paid_by_card, odd.category_id, odd.notes],
    ['Milk', null, 3.1, null, null, null, 'Faded.'], 'a VAT above the total and an unknown category are dropped')

  assert.equal((await viewer.post('/api/ai/receipts/read', { venue_id: V, file: { data: PNG } })).status, 403)
  assert.equal((await owner.post('/api/ai/receipts/read', { venue_id: VB, file: { data: PNG } })).status, 404, 'another tenant\'s venue')
})
