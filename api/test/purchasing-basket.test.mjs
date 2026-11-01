// A supplier's basket brought into an order (1 Nov 2026). Checked here:
//   - the suppliers someone ordering can pick (switched on, with a live
//     price) and how many of their prices have a code;
//   - a dry run says what would change and writes nothing: lines added,
//     quantities changed (up to the price's minimum and steps, as placing
//     does), a line moved onto this supplier's price from another, this
//     supplier's lines the basket doesn't have taken off, codes not found,
//     switched off, on two products and lines that can't be read;
//   - applying writes exactly that (each line pinned to the basket's price)
//     and a second time changes nothing; keeping missing lines;
//   - a CSV with headings, a text file and an Excel file;
//   - refusals: no basket, two at once, nothing in it, a layout without a
//     code and a quantity column, a supplier switched off, unknown or
//     another group's, a viewer, a placed order, a request for someone
//     without approval, another group's order;
//   - Pepper, from rows and from a CSV attached in the chat, with the card
//     showing every change first.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays, nowAt } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, operator, viewer, otherOwner, V
let brakes, bidfood, closed, thigh, pork, rice, oil, napkins, salt, seaSalt
let thighBrakes, porkBrakes, riceBrakes, riceBid, oilBrakes, napkinsBrakes, list

const day = n => addDays(nowAt('Europe/London').date, n)
const newItem = body => ok(owner.post('/api/inventory/items', { base_unit: 'g', ...body }), body.name)
const priceOf = async (it, body) => (await ok(owner.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price'))
  .quotes.find(q => q.supplier_id === body.supplier_id && (q.supplier_code ?? null) === (body.supplier_code ?? null))
const failed = async (p, status) => {
  const r = await p
  assert.equal(r.status, status, r.body)
  return r.json
}
const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const reconcile = (who, orderId, body) => who.post(`/api/purchasing/orders/${orderId}/reconcile`, body)
const qtyOf = (order, item) => order.items.find(i => i.item_id === item.id)?.qty ?? 0
const quoteOfLine = (order, item) => order.items.find(i => i.item_id === item.id)?.quote?.id ?? null

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
  // Operators order but don't approve.
  const roles = await ok(owner.get('/api/access/roles'))
  await ok(owner.patch(`/api/access/roles/${roles.find(r => r.key === 'operator').id}`, { permissions: { purchasing_approve: 'none' } }), 'operator role')

  brakes = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'print', lead_days: 1 }), 'brakes')
  bidfood = await ok(owner.post('/api/suppliers', { name: 'Bidfood', send_method: 'print', lead_days: 1 }), 'bidfood')
  closed = await ok(owner.post('/api/suppliers', { name: 'Closed Foods', send_method: 'print', lead_days: 1 }), 'closed')

  thigh = await newItem({ name: 'Chicken thigh' })
  thighBrakes = await priceOf(thigh, { supplier_id: brakes.id, supplier_code: 'MEA161', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 30 })
  pork = await newItem({ name: 'Pork belly' })
  porkBrakes = await priceOf(pork, { supplier_id: brakes.id, supplier_code: 'POR106', pack_name: 'Case', pack_qty: 4, pack_unit: 'kg', price: 22, min_qty: 2 })
  rice = await newItem({ name: 'Basmati rice' })
  riceBrakes = await priceOf(rice, { supplier_id: brakes.id, supplier_code: 'RICE1', pack_name: 'Bag', pack_qty: 10, pack_unit: 'kg', price: 16, order_multiple: 2 })
  riceBid = await priceOf(rice, { supplier_id: bidfood.id, supplier_code: 'BF-RICE', pack_name: 'Bag', pack_qty: 10, pack_unit: 'kg', price: 15 })
  oil = await newItem({ name: 'Rapeseed oil', base_unit: 'ml' })
  oilBrakes = await priceOf(oil, { supplier_id: brakes.id, supplier_code: 'OIL9', pack_name: 'Tin', pack_qty: 20, pack_unit: 'l', price: 25 })
  await ok(owner.patch(`/api/inventory/quotes/${oilBrakes.id}`, { is_active: false }), 'oil price off')
  napkins = await newItem({ name: 'Napkins', base_unit: 'each' })
  napkinsBrakes = await priceOf(napkins, { supplier_id: brakes.id, pack_name: 'Box', pack_qty: 500, pack_unit: 'each', price: 9 })
  // One code on two products (from before codes were checked), so set by hand.
  salt = await newItem({ name: 'Salt' })
  await priceOf(salt, { supplier_id: brakes.id, supplier_code: 'DUP1', pack_name: 'Bag', pack_qty: 1, pack_unit: 'kg', price: 1 })
  seaSalt = await newItem({ name: 'Sea salt' })
  const seaQ = await priceOf(seaSalt, { supplier_id: brakes.id, supplier_code: 'DUP-X', pack_name: 'Bag', pack_qty: 1, pack_unit: 'kg', price: 2 })
  await sql`UPDATE inv_quotes SET supplier_code = 'dup1' WHERE id = ${seaQ.id}`
  // A supplier switched off after its prices were made.
  const ghost = await newItem({ name: 'Ghost item' })
  await priceOf(ghost, { supplier_id: closed.id, supplier_code: 'GH1', pack_name: 'Box', pack_qty: 1, pack_unit: 'kg', price: 3 })
  await ok(owner.patch(`/api/suppliers/${closed.id}`, { is_active: false }), 'closed off')

  list = await ok(owner.post('/api/purchasing/lists', {
    name: 'Basket list', venue_ids: [V], item_ids: [thigh.id, pork.id, rice.id, napkins.id],
  }), 'list')
})
after(closeApp)

test('the suppliers someone ordering can bring a basket in from', async () => {
  const sups = await ok(operator.get(`/api/purchasing/venues/${V}/suppliers`))
  const names = sups.map(s => s.name)
  assert.ok(names.includes('Brakes') && names.includes('Bidfood'))
  assert.ok(!names.includes('Closed Foods'), 'switched off')
  // Brakes' live coded prices: MEA161, POR106, RICE1, DUP1, dup1 (the oil is off, napkins have no code).
  assert.equal(sups.find(s => s.name === 'Brakes').codes, 5)
  assert.equal(sups.find(s => s.name === 'Bidfood').codes, 1)
  assert.equal((await viewer.get(`/api/purchasing/venues/${V}/suppliers`)).status, 200, 'reading is open to viewers')
  await failed(otherOwner.get(`/api/purchasing/venues/${V}/suppliers`), 404)
})

test('a dry run says what changes; applying writes exactly that, once', async () => {
  const o = await draft([[pork, 1, porkBrakes], [rice, 2, riceBid], [napkins, 3, napkinsBrakes]])
  const text = 'MEA161:20,POR106:1.5\nRICE1 x 3\nOIL9:1\nNEW1:4\nDUP1:2\nnope\n'
  const dry = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, text, dry_run: true }))
  assert.equal(dry.dry_run, true)
  assert.equal(dry.supplier.name, 'Brakes')
  assert.deepEqual(dry.added.map(a => [a.code, a.item_id, a.quote_id, a.qty]), [['MEA161', thigh.id, thighBrakes.id, 20]])
  assert.deepEqual(dry.changed.map(c => [c.code, c.item_id, c.from_qty, c.qty, c.basket_qty, c.quote_id]), [
    ['POR106', pork.id, 1, 2, 1.5, porkBrakes.id],     // up to the minimum of 2
    ['RICE1', rice.id, 2, 4, 3, riceBrakes.id],        // in steps of 2, moved from Bidfood
  ])
  assert.equal(dry.changed[1].from.supplier_name, 'Bidfood')
  assert.equal(dry.changed[1].from.code, 'BF-RICE')
  assert.deepEqual(dry.removed.map(r => [r.item_id, r.qty]), [[napkins.id, 3]], 'a Brakes line the basket doesn\'t have')
  assert.deepEqual(dry.unknown.map(u => u.code), ['NEW1'])
  assert.deepEqual(dry.switched_off.map(u => [u.code, u.item_name]), [['OIL9', 'Rapeseed oil']])
  assert.deepEqual(dry.ambiguous.map(u => [u.code, u.items.sort()]), [['DUP1', ['Salt', 'Sea salt']]])
  assert.deepEqual(dry.errors.map(e => [e.row, e.error]), [[6, "Couldn't read a code and a quantity"]])
  // Nothing written.
  let now = await ok(owner.get(`/api/purchasing/orders/${o.id}`))
  assert.equal(qtyOf(now, thigh), 0)
  assert.equal(qtyOf(now, pork), 1)
  assert.equal(quoteOfLine(now, rice), riceBid.id)

  const done = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, text }))
  assert.equal(done.dry_run, false)
  for (const [it, qty, q] of [[thigh, 20, thighBrakes], [pork, 2, porkBrakes], [rice, 4, riceBrakes]]) {
    assert.equal(qtyOf(done.order, it), qty, it.name)
    assert.equal(quoteOfLine(done.order, it), q.id, it.name + ' on the basket\'s price')
  }
  assert.equal(qtyOf(done.order, napkins), 0, 'taken off')
  const [row] = await sql`SELECT quote_id FROM supply_order_lines WHERE order_id = ${o.id} AND item_id = ${thigh.id}`
  assert.equal(row.quote_id, thighBrakes.id, 'pinned in the table')
  now = await ok(owner.get(`/api/purchasing/orders/${o.id}`))
  assert.equal(qtyOf(now, rice), 4)

  // The same basket again changes nothing.
  const again = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, text }))
  assert.deepEqual([again.added.length, again.changed.length, again.removed.length, again.unchanged], [0, 0, 0, 3])

  // Keeping lines the basket doesn't have; a 0 in the basket still takes one off.
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, { lines: [{ item_id: napkins.id, qty: 3, quote_id: napkinsBrakes.id }] }), 'napkins back')
  const kept = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, text: 'MEA161:20\nPOR106:0', remove_missing: false }))
  assert.deepEqual(kept.removed.map(r => r.item_id), [pork.id])
  assert.equal(kept.remove_missing, false)
  assert.equal(qtyOf(kept.order, napkins), 3)
  assert.equal(qtyOf(kept.order, rice), 4, 'Brakes rice not in this basket, kept')
  assert.equal(qtyOf(kept.order, pork), 0)

  // Bidfood's basket never touches Brakes' lines.
  const bid = await ok(reconcile(owner, o.id, { supplier_id: bidfood.id, text: 'BF-RICE:5' }))
  assert.deepEqual(bid.changed.map(c => [c.code, c.from_qty, c.qty, c.from?.supplier_name]), [['BF-RICE', 4, 5, 'Brakes']])
  assert.equal(qtyOf(bid.order, thigh), 20, 'a Brakes line, left alone by Bidfood\'s basket')
  assert.equal(qtyOf(bid.order, napkins), 3)
})

test('a CSV with headings, a text file and an Excel file', async () => {
  const o = await draft([])
  const csv = 'Description,Qty,Product code\n"Chicken, thigh",3,MEA161\nPork,2,POR106\n'
  const fromCsv = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, file: b64(csv), dry_run: true }))
  assert.deepEqual(fromCsv.added.map(a => [a.code, a.qty]), [['MEA161', 3], ['POR106', 2]])
  const fromTxt = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, file: b64('MEA161:4,POR106:2'), dry_run: true }))
  assert.deepEqual(fromTxt.added.map(a => [a.code, a.qty]), [['MEA161', 4], ['POR106', 2]], 'a text file of code:qty')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SKU', 'Units'], ['MEA161', 6], ['RICE1', 2]]), 'Basket')
  const xlsx = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
  const fromXlsx = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, file: xlsx, dry_run: true }))
  assert.deepEqual(fromXlsx.added.map(a => [a.code, a.qty]), [['MEA161', 6], ['RICE1', 2]])
  const bad = await failed(reconcile(owner, o.id, { supplier_id: brakes.id, file: b64('Supplier,Total\nBrakes,2\n') }), 422)
  assert.match(bad.error, /No code and quantity columns/)
})

test('refusals', async () => {
  const o = await draft([[thigh, 1, thighBrakes]])
  await failed(reconcile(owner, o.id, { supplier_id: brakes.id }), 400)
  await failed(reconcile(owner, o.id, { supplier_id: brakes.id, text: 'A:1', rows: [{ code: 'A', qty: 1 }] }), 400)
  assert.match((await failed(reconcile(owner, o.id, { supplier_id: brakes.id, text: '\n \n' }), 422)).error, /No codes found/)
  assert.match((await failed(reconcile(owner, o.id, { supplier_id: closed.id, text: 'GH1:1' }), 422)).error, /switched off/)
  await failed(reconcile(owner, o.id, { supplier_id: '00000000-0000-4000-8000-000000000001', text: 'A:1' }), 404)
  const theirSup = await ok(otherOwner.post('/api/suppliers', { name: 'Their supplier', send_method: 'print' }), 'their supplier')
  await failed(reconcile(owner, o.id, { supplier_id: theirSup.id, text: 'A:1' }), 404)
  await failed(reconcile(otherOwner, o.id, { supplier_id: theirSup.id, text: 'A:1' }), 404)
  await failed(reconcile(viewer, o.id, { supplier_id: brakes.id, text: 'MEA161:1' }), 403)
  // Rows (Pepper's way) are checked too.
  await failed(reconcile(owner, o.id, { supplier_id: brakes.id, rows: [{ code: 'MEA161', qty: -1 }] }), 400)
  const rows = await ok(reconcile(owner, o.id, { supplier_id: brakes.id, rows: [{ code: 'MEA161', qty: 7 }], dry_run: true }))
  assert.deepEqual(rows.changed.map(c => [c.code, c.from_qty, c.qty]), [['MEA161', 1, 7]])

  // A request waiting for approval: only an approver brings a basket in.
  const opDraft = await draft([[thigh, 2, thighBrakes]])
  await ok(operator.post(`/api/purchasing/orders/${opDraft.id}/request`, { suppliers: { [brakes.id]: { delivery_date: day(9) } } }), 'requested')
  assert.match((await failed(reconcile(operator, opDraft.id, { supplier_id: brakes.id, text: 'MEA161:3' }), 403)).error, /waiting for approval/)
  const approved = await ok(reconcile(owner, opDraft.id, { supplier_id: brakes.id, text: 'MEA161:3' }))
  assert.equal(qtyOf(approved.order, thigh), 3)
  // A placed order can't change.
  await ok(owner.post(`/api/purchasing/orders/${opDraft.id}/submit`, { suppliers: { [brakes.id]: { delivery_date: day(9) } } }), 'placed')
  await failed(reconcile(owner, opDraft.id, { supplier_id: brakes.id, text: 'MEA161:3' }), 409)
})

// ── Pepper ──────────────────────────────────────────────

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

async function pepper(sub, name, input, { run = true, chat = null } = {}) {
  const app = await getApp()
  const ctx = makeContext({
    app, channel: chat ? 'staff_chat' : 'staff_mcp', tenantId: ids.a, log: quiet, ...(chat ? { conversationId: chat } : {}),
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { card, out: run ? await tool.run(ctx, parsed) : null }
}

test('Pepper brings a basket in from rows and from a CSV attached in the chat', async () => {
  const o = await draft([[pork, 1, porkBrakes], [napkins, 2, napkinsBrakes]])
  const { card, out } = await pepper(A.owner, 'import_supplier_basket', {
    order_id: o.id, supplier: 'brakes', rows: [{ code: 'MEA161', quantity: 4 }, { code: 'POR106', quantity: 1 }, { code: 'ZZZ9', quantity: 1 }],
  })
  assert.match(card.title, /Bring Brakes's basket into the order/)
  const lines = card.lines.join('\n')
  assert.match(lines, /Add MEA161 Chicken thigh: 4 x Case/)
  assert.match(lines, /POR106 Pork belly: 1 to 2 x Case/)
  assert.match(lines, /Take off Napkins: was 2/)
  assert.ok(card.warnings.some(w => /1 in the basket, minimum 2 here, so 2/.test(w)), card.warnings.join(' | '))
  assert.ok(card.warnings.some(w => /Not found at Brakes: ZZZ9/.test(w)))
  assert.equal(card.pin.order_id, o.id)
  assert.deepEqual([out.added, out.changed, out.taken_off], [1, 1, 1])
  assert.deepEqual(out.not_found, ['ZZZ9'])
  const now = await ok(owner.get(`/api/purchasing/orders/${o.id}`))
  assert.equal(qtyOf(now, thigh), 4)
  assert.equal(qtyOf(now, napkins), 0)
  const [audit] = await sql`SELECT tool, ok FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'import_supplier_basket' ORDER BY created_at DESC LIMIT 1`
  assert.equal(audit.ok, true)

  // The same again: nothing to change, said with why.
  await assert.rejects(pepper(A.owner, 'import_supplier_basket', {
    order_id: o.id, supplier: 'Brakes', rows: [{ code: 'MEA161', quantity: 4 }, { code: 'POR106', quantity: 2 }],
  }), /Nothing on the order would change: 2 lines are the same already/)

  // A CSV attached in the chat; keeping the other lines.
  const [conv] = await sql`INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt)
    VALUES (${ids.a}, 'staff_chat', ${A.owner}, ${A.owner + '@test.local'}, 'test') RETURNING id`
  await sql`INSERT INTO ai_attachments (tenant_id, user_sub, conversation_id, kind, media_type, filename, bytes, data)
    VALUES (${ids.a}, ${A.owner}, ${conv.id}, 'text', 'text/csv', 'brakes-basket.csv', 30, ${Buffer.from('Code,Qty\nMEA161,6\n')})`
  const viaFile = await pepper(A.owner, 'import_supplier_basket', {
    order_id: o.id, supplier: 'Brakes', attached_file: 'brakes-basket.csv', keep_missing: true,
  }, { chat: conv.id })
  assert.match(viaFile.card.lines[0], /from brakes-basket\.csv \(1 row\)/)
  assert.equal(viaFile.out.changed, 1)
  assert.equal(viaFile.out.taken_off, 0, 'kept')
  const after = await ok(owner.get(`/api/purchasing/orders/${o.id}`))
  assert.equal(qtyOf(after, thigh), 6)
  assert.equal(qtyOf(after, pork), 2, 'kept: not in this basket')

  // Outside the chat a file can't be read; rows or a file, not both; viewers can't.
  await assert.rejects(pepper(A.owner, 'import_supplier_basket', { order_id: o.id, supplier: 'Brakes', attached_file: 'brakes-basket.csv' }),
    /Attached files can only be read in the chat/)
  await assert.rejects(pepper(A.owner, 'import_supplier_basket', { order_id: o.id, supplier: 'Brakes' }), /Give either rows/)
  await assert.rejects(pepper(A.viewer, 'import_supplier_basket', { order_id: o.id, supplier: 'Brakes', rows: [{ code: 'MEA161', quantity: 1 }] }),
    /permission/)
  await assert.rejects(pepper(A.owner, 'import_supplier_basket', { order_id: o.id, supplier: 'Closed Foods', rows: [{ code: 'GH1', quantity: 1 }] }),
    /supplier with prices/)
})
