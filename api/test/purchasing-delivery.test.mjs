// Delivery details per venue and sent orders (migration 233, 1 Nov 2026).
// Checked here:
//   - a supplier's settings at a venue take its own lead days, delivery
//     phone, driver instructions and delivery slot; days follow the venue's
//     lead days; the order form, the purchase order and its documents show
//     them; another group can't set them;
//   - an order's note for a supplier defaults to the venue's driver
//     instructions, and a note cleared on purpose stays empty (requests
//     keep the difference);
//   - placing an order when the venue already has an open purchase order
//     from that supplier for the same day asks first (409 po_exists) and
//     then adds to it (only while not sent) or places a separate one;
//   - marking sent takes the supplier's order reference (required for
//     suppliers set to need it) and an earlier send time, within limits; the
//     reference can be set later and searched for;
//   - Today flags orders still to send after their deadline and deliveries
//     sent but not booked in after their day;
//   - Pepper follows the same rules.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays, nowAt, poNumberLabel, checkoutText, slotText } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'

let ids, owner, operator, viewer, otherOwner, V, otherV
let jj, farm, oil, oilCase, rice, riceBag

const today = () => nowAt('Europe/London').date
const day = n => addDays(today(), n)
const newItem = name => ok(owner.post('/api/inventory/items', { name, base_unit: 'g' }), name)
const quotesOf = async (it, body) => (await ok(owner.post(`/api/inventory/items/${it.id}/quotes`, body), it.name + ' price')).quotes
const listOf = (name, items) => ok(owner.post('/api/purchasing/lists', { name, venue_ids: [V], item_ids: items.map(i => i.id) }), name)
const draft = (who, list) => ok(who.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }), 'draft order')
const setLines = (who, order, lines) => ok(who.put(`/api/purchasing/orders/${order.id}/lines`, { lines }), 'order lines')
const place = (order, suppliers = {}) => owner.post(`/api/purchasing/orders/${order.id}/submit`, { suppliers })
const poRow = async id => (await sql`
  SELECT status, notes, supplier_ref, sent_at, sent_via, delivery_date::text AS delivery_date, subtotal::float8 AS subtotal
    FROM purchase_orders WHERE id = ${id}
`)[0]
const poLines = async id => sql`
  SELECT item_name, qty::float8 AS qty FROM purchase_order_lines WHERE po_id = ${id} ORDER BY sort_order
`
const failed = async (p, status, code) => {
  const r = await p
  assert.equal(r.status, status, r.body)
  if (code) assert.equal(r.json?.code, code, r.body)
  return r.json
}

/** An order for one list item, placed (or not) for a day. */
async function orderOf(items, { who = owner, date, suppliers } = {}) {
  const list = await listOf('List ' + Math.random().toString(36).slice(2, 8), items.map(([it]) => it))
  const o = await draft(who, list)
  await setLines(who, o, items.map(([it, qty]) => ({ item_id: it.id, qty })))
  return { o, list, suppliers: suppliers ?? (date ? Object.fromEntries([...new Set(items.map(([, , s]) => s))].map(s => [s, { delivery_date: date }])) : {}) }
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
  otherV = (await ok(otherOwner.get('/api/venues')))[0]?.id

  // JJ: a day's notice, but two at this venue; needs their order reference.
  jj = await ok(owner.post('/api/suppliers', { name: 'JJ Foodservice', send_method: 'print', lead_days: 1, ref_required: true }), 'jj')
  farm = await ok(owner.post('/api/suppliers', { name: 'Ref Farm', send_method: 'print', lead_days: 1 }), 'farm')
  oil = await newItem('Rapeseed oil')
  ;[oilCase] = await quotesOf(oil, { supplier_id: jj.id, pack_name: 'Case', pack_qty: 1, pack_unit: 'kg', price: 20 })
  rice = await newItem('Basmati rice')
  ;[riceBag] = await quotesOf(rice, { supplier_id: farm.id, pack_name: 'Bag', pack_qty: 5, pack_unit: 'kg', price: 10 })
  // Operators fill orders in and ask for approval; approvers place them.
  const op = (await ok(owner.get('/api/access/roles'))).find(r => r.key === 'operator')
  await ok(owner.patch(`/api/access/roles/${op.id}`, { permissions: { ...op.permissions, purchasing_approve: 'view' } }), 'operator asks only')
})
after(closeApp)

test('delivery details per venue: saved, refused when wrong, used for days, the form and the documents', async () => {
  const saved = await ok(owner.put(`/api/suppliers/${jj.id}/venues`, { venues: [{
    venue_id: V, lead_days: 2, delivery_phone: '07700 900123', driver_instructions: 'Ring the back bell',
    slot_from: '07:00', slot_to: '10:00', account_ref: 'JJ-4471',
  }] }), 'venue settings')
  const v = saved.venues.find(x => x.venue_id === V)
  assert.equal(v.lead_days, 2)
  assert.equal(v.delivery_phone, '07700 900123')
  assert.equal(v.driver_instructions, 'Ring the back bell')
  assert.equal(String(v.slot_from).slice(0, 5), '07:00')
  assert.equal(String(v.slot_to).slice(0, 5), '10:00')
  const listed = (await ok(owner.get('/api/suppliers'))).find(s => s.id === jj.id)
  assert.equal(listed.ref_required, true)
  assert.equal(listed.venues[0].driver_instructions, 'Ring the back bell')

  // A slot that ends before it starts, lead days out of range.
  await failed(owner.put(`/api/suppliers/${jj.id}/venues`, { venues: [{ venue_id: V, slot_from: '10:00', slot_to: '09:00' }] }), 400)
  await failed(owner.put(`/api/suppliers/${jj.id}/venues`, { venues: [{ venue_id: V, lead_days: 31 }] }), 400)
  // Another group: not its supplier, and not its venue.
  await failed(otherOwner.put(`/api/suppliers/${jj.id}/venues`, { venues: [] }), 404)
  if (otherV) await failed(owner.put(`/api/suppliers/${jj.id}/venues`, { venues: [{ venue_id: otherV, lead_days: 1 }] }), 404)
  // Viewers and ordering staff can't change setup.
  await failed(viewer.put(`/api/suppliers/${jj.id}/venues`, { venues: [] }), 403)
  assert.equal((await ok(owner.get(`/api/suppliers/${jj.id}`))).venues[0].lead_days, 2, 'unchanged by the refusals')

  // The order form: the venue's two days, the phone, the slot, the instructions.
  const { o } = await orderOf([[oil, 1, jj.id]])
  const form = await ok(owner.get(`/api/purchasing/orders/${o.id}`))
  const s = form.suppliers[jj.id]
  assert.equal(s.lead_days, 2)
  assert.equal(s.next_delivery, day(2), 'two days\' notice here (no cutoff)')
  assert.equal(s.delivery_phone, '07700 900123')
  assert.equal(s.driver_instructions, 'Ring the back bell')
  assert.equal(slotText(s), '07:00-10:00')
  assert.equal(s.account_ref, 'JJ-4471')
  // Tomorrow is now too late for JJ here.
  const late = await failed(place(o, { [jj.id]: { delivery_date: day(1) } }), 422, 'delivery_day')
  assert.equal(late.problem, 'late')

  const res = await ok(place(o, { [jj.id]: { delivery_date: day(2) } }), 'placed')
  const po = res.purchase_orders[0]
  assert.equal(po.lead_days, 2, 'the list carries the venue\'s days')
  const detail = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  assert.equal(detail.delivery_phone, '07700 900123')
  assert.equal(String(detail.slot_from).slice(0, 5), '07:00')
  assert.equal(detail.notes, 'Ring the back bell', 'the note defaults to the driver instructions')
  const html = (await owner.get(`/api/purchasing/pos/${po.id}/file?format=html`)).body
  assert.match(html, /07:00-10:00/, 'the slot on the supplier\'s copy')
  assert.match(html, /07700 900123/, 'the delivery phone')
  assert.match(html, /Ring the back bell/)
  const text = checkoutText(detail, { name: 'Ware', address_line1: '1 High St', phone: '01920 000000' })
  assert.match(text, /^Account: JJ-4471$/m)
  assert.match(text, /^Phone: 07700 900123$/m, 'the venue\'s delivery phone beats the venue phone')
  assert.match(text, /^Instructions: Ring the back bell$/m)
  assert.match(text, new RegExp('^Our order: ' + poNumberLabel(detail.number) + '$', 'm'))
  for (const f of ['pdf', 'xlsx']) assert.equal((await owner.get(`/api/purchasing/pos/${po.id}/file?format=${f}`)).status, 200, f)
})

test('a note never written takes the driver instructions; one cleared stays empty, through approval too', async () => {
  // Placed with a note cleared on purpose.
  const a = await orderOf([[oil, 1, jj.id]])
  const cleared = (await ok(place(a.o, { [jj.id]: { delivery_date: day(4), notes: '' } }))).purchase_orders[0]
  assert.equal((await poRow(cleared.id)).notes, null)
  // Another note given wins.
  const b = await orderOf([[oil, 1, jj.id]])
  const own = (await ok(place(b.o, { [jj.id]: { delivery_date: day(5), notes: 'Leave with the bar' } }))).purchase_orders[0]
  assert.equal((await poRow(own.id)).notes, 'Leave with the bar')

  // Asked for by the operator without a note: the approver places it and
  // it takes the instructions.
  const c = await orderOf([[oil, 1, jj.id]], { who: operator })
  await ok(operator.post(`/api/purchasing/orders/${c.o.id}/request`, { suppliers: { [jj.id]: { delivery_date: day(6) } } }), 'asked')
  const [{ supplier_options: askedNone }] = await sql`SELECT supplier_options FROM supply_orders WHERE id = ${c.o.id}`
  assert.deepEqual(askedNone[jj.id], { delivery_date: day(6) }, 'no notes key when none was written')
  const placedC = (await ok(place(c.o))).purchase_orders[0]
  assert.equal((await poRow(placedC.id)).notes, 'Ring the back bell')
  assert.equal(placedC.delivery_date, day(6), 'the day asked for')

  // Asked for with the note cleared: placed empty.
  const d = await orderOf([[oil, 1, jj.id]], { who: operator })
  await ok(operator.post(`/api/purchasing/orders/${d.o.id}/request`, { suppliers: { [jj.id]: { delivery_date: day(7), notes: '' } } }), 'asked')
  const [{ supplier_options: askedCleared }] = await sql`SELECT supplier_options FROM supply_orders WHERE id = ${d.o.id}`
  assert.deepEqual(askedCleared[jj.id], { delivery_date: day(7), notes: null })
  const placedD = (await ok(place(d.o))).purchase_orders[0]
  assert.equal((await poRow(placedD.id)).notes, null)
})

test('placing with an open order already going to that supplier that day: ask, add to it, or a separate one', async () => {
  const first = await orderOf([[oil, 3, jj.id]])
  const po1 = (await ok(place(first.o, { [jj.id]: { delivery_date: day(8) } }))).purchase_orders[0]

  // A second order with oil (JJ) and rice (farm) for the same day.
  const second = await orderOf([[oil, 2, jj.id], [rice, 1, farm.id]])
  const form = await ok(owner.get(`/api/purchasing/orders/${second.o.id}`))
  assert.ok(form.open_pos.some(p => p.id === po1.id && p.delivery_date === day(8) && p.status === 'to_send'), 'the form lists it')
  const asked = await failed(place(second.o, { [jj.id]: { delivery_date: day(8) }, [farm.id]: { delivery_date: day(8) } }), 409, 'po_exists')
  assert.deepEqual(asked.conflicts, [{ supplier_id: jj.id, po_id: po1.id, po_number: po1.number, po_status: 'to_send', delivery_date: day(8) }])
  assert.match(asked.error, /JJ Foodservice already has PO-\d+ for that day \(not sent yet\)/)
  const [{ n: none }] = await sql`SELECT count(*)::int AS n FROM purchase_orders WHERE supply_order_id = ${second.o.id}`
  assert.equal(none, 0, 'nothing placed, not even the farm\'s')
  assert.equal((await ok(owner.get(`/api/purchasing/orders/${second.o.id}`))).status, 'draft')

  // Add to it: the oil tops PO1's line up, the farm gets its own order.
  const added = await ok(place(second.o, { [jj.id]: { delivery_date: day(8), existing: 'add' }, [farm.id]: { delivery_date: day(8) } }), 'added')
  assert.deepEqual(added.added_to, [po1.id])
  assert.equal(added.purchase_orders.length, 2, 'PO1 and the farm\'s order are both this order\'s')
  assert.deepEqual((await poLines(po1.id)).map(l => [l.item_name, l.qty]), [['Rapeseed oil', 5]])
  assert.equal((await poRow(po1.id)).subtotal, 100, 'totals worked out again')
  const [{ added_to_po_ids: linked }] = await sql`SELECT added_to_po_ids FROM supply_orders WHERE id = ${second.o.id}`
  assert.deepEqual(linked, [po1.id])
  const orders = await ok(owner.get(`/api/purchasing/orders?venue_id=${V}&status=submitted`))
  assert.equal(orders.find(x => x.id === second.o.id)?.po_count, 2, 'counted with the order it went into')

  // Separate: a second order for the day.
  const third = await orderOf([[oil, 1, jj.id]])
  const sep = await ok(place(third.o, { [jj.id]: { delivery_date: day(8), existing: 'separate' } }), 'separate')
  assert.notEqual(sep.purchase_orders[0].id, po1.id)
  assert.deepEqual(sep.added_to, [])

  // Once sent, nothing can be added; a separate order still can.
  const sentDay = day(9)
  const fourth = await orderOf([[oil, 1, jj.id]])
  const po2 = (await ok(place(fourth.o, { [jj.id]: { delivery_date: sentDay } }))).purchase_orders[0]
  await ok(owner.post(`/api/purchasing/pos/${po2.id}/mark-sent`, { via: 'phone', supplier_ref: 'S0001' }), 'sent')
  const fifth = await orderOf([[oil, 1, jj.id]])
  const sentConflict = await failed(place(fifth.o, { [jj.id]: { delivery_date: sentDay } }), 409, 'po_exists')
  assert.equal(sentConflict.conflicts[0].po_status, 'sent')
  await failed(place(fifth.o, { [jj.id]: { delivery_date: sentDay, existing: 'add' } }), 422, 'po_sent')
  await ok(place(fifth.o, { [jj.id]: { delivery_date: sentDay, existing: 'separate' } }), 'a second order for the day')

  // A cancelled order doesn't count.
  const cancelDay = day(10)
  const sixth = await orderOf([[oil, 1, jj.id]])
  const po3 = (await ok(place(sixth.o, { [jj.id]: { delivery_date: cancelDay } }))).purchase_orders[0]
  await ok(owner.post(`/api/purchasing/pos/${po3.id}/cancel`), 'cancelled')
  const seventh = await orderOf([[oil, 1, jj.id]])
  await ok(place(seventh.o, { [jj.id]: { delivery_date: cancelDay } }), 'no question after a cancel')
})

test('marking sent: the supplier\'s reference (required for JJ) and an earlier send time, within limits', async () => {
  const one = await orderOf([[oil, 1, jj.id]])
  const po = (await ok(place(one.o, { [jj.id]: { delivery_date: day(11) } }))).purchase_orders[0]
  const noRef = await failed(owner.post(`/api/purchasing/pos/${po.id}/mark-sent`, { via: 'phone' }), 422, 'supplier_ref')
  assert.match(noRef.error, /JJ Foodservice needs their order reference/)
  // Made three days ago (so an earlier time is possible).
  await sql`UPDATE purchase_orders SET created_at = now() - interval '3 days' WHERE id = ${po.id}`
  const future = new Date(Date.now() + 60 * 60_000).toISOString()
  await failed(owner.post(`/api/purchasing/pos/${po.id}/mark-sent`, { via: 'phone', supplier_ref: 'S043172591', sent_at: future }), 422, 'sent_at')
  const beforeMade = new Date(Date.now() - 4 * 86_400_000).toISOString()
  await failed(owner.post(`/api/purchasing/pos/${po.id}/mark-sent`, { via: 'phone', supplier_ref: 'S043172591', sent_at: beforeMade }), 422, 'sent_at')
  await failed(owner.post(`/api/purchasing/pos/${po.id}/mark-sent`, { via: 'phone', supplier_ref: 'S043172591', sent_at: 'yesterday' }), 400)
  await failed(viewer.post(`/api/purchasing/pos/${po.id}/mark-sent`, { via: 'phone', supplier_ref: 'S043172591' }), 403)
  const went = new Date(Date.now() - 2 * 86_400_000)
  const sent = await ok(owner.post(`/api/purchasing/pos/${po.id}/mark-sent`, { via: 'phone', supplier_ref: 'S043172591', sent_at: went.toISOString() }), 'sent')
  assert.equal(sent.status, 'sent')
  assert.equal(sent.supplier_ref, 'S043172591')
  const row = await poRow(po.id)
  assert.ok(Math.abs(new Date(row.sent_at).getTime() - went.getTime()) < 1000, 'the time it went')
  assert.equal(row.sent_via, 'phone')
  assert.match((await owner.get(`/api/purchasing/pos/${po.id}/file?format=html`)).body, /Your ref S043172591/)

  // Too long ago (made 30 days back).
  const two = await orderOf([[oil, 1, jj.id]])
  const old = (await ok(place(two.o, { [jj.id]: { delivery_date: day(12) } }))).purchase_orders[0]
  await sql`UPDATE purchase_orders SET created_at = now() - interval '30 days' WHERE id = ${old.id}`
  await failed(owner.post(`/api/purchasing/pos/${old.id}/mark-sent`, {
    via: 'print', supplier_ref: 'S2', sent_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
  }), 422, 'sent_at')

  // Suppliers that don't need it: no reference, now.
  const three = await orderOf([[rice, 1, farm.id]])
  const farmPo = (await ok(place(three.o, { [farm.id]: { delivery_date: day(3) } }))).purchase_orders[0]
  const farmSent = await ok(owner.post(`/api/purchasing/pos/${farmPo.id}/mark-sent`, { via: 'print' }), 'farm sent')
  assert.equal(farmSent.supplier_ref, null)
  assert.ok(Date.now() - new Date((await poRow(farmPo.id)).sent_at).getTime() < 60_000, 'now')

  // The reference set later, on a received order too; never on a cancelled one.
  const later = await ok(owner.patch(`/api/purchasing/pos/${farmPo.id}`, { supplier_ref: 'RF-77' }), 'ref later')
  assert.equal(later.supplier_ref, 'RF-77')
  await sql`UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = ${farmPo.id}`
  assert.equal((await ok(owner.patch(`/api/purchasing/pos/${farmPo.id}`, { supplier_ref: 'RF-78' }))).supplier_ref, 'RF-78')
  await failed(owner.patch(`/api/purchasing/pos/${farmPo.id}`, { notes: 'x' }), 409)
  await sql`UPDATE purchase_orders SET status = 'cancelled' WHERE id = ${farmPo.id}`
  await failed(owner.patch(`/api/purchasing/pos/${farmPo.id}`, { supplier_ref: 'RF-79' }), 409)

  // Found by their reference or our number; not by another group.
  const byRef = await ok(owner.get('/api/purchasing/pos?q=s0431'))
  assert.deepEqual(byRef.map(p => p.id), [po.id])
  assert.equal(byRef[0].supplier_ref, 'S043172591')
  assert.deepEqual((await ok(owner.get('/api/purchasing/pos?q=' + poNumberLabel(po.number)))).map(p => p.id), [po.id])
  assert.deepEqual(await ok(otherOwner.get('/api/purchasing/pos?q=S043172591')), [])
})

test('Today: orders still to send after their deadline, deliveries not booked in after their day', async () => {
  // Today shows the ten soonest orders to send: start with none.
  await sql`UPDATE purchase_orders SET status = 'cancelled' WHERE tenant_id = ${ids.a} AND status IN ('to_send', 'sent')`
  const one = await orderOf([[rice, 1, farm.id]])
  const toSend = (await ok(place(one.o, { [farm.id]: { delivery_date: day(13) } }))).purchase_orders[0]
  const two = await orderOf([[rice, 1, farm.id]])
  const overdue = (await ok(place(two.o, { [farm.id]: { delivery_date: day(14) } }))).purchase_orders[0]
  await ok(owner.post(`/api/purchasing/pos/${overdue.id}/mark-sent`, { via: 'print' }), 'sent')
  const feed = async () => ok(owner.get(`/api/ops/today?venue_id=${V}&time=10:00`))
  const card = (d, id) => d.tasks.find(t => t.action?.path === '/purchasing?po=' + id)

  let d = await feed()
  assert.equal(card(d, toSend.id)?.group, 'now', 'in good time')
  assert.equal(card(d, overdue.id), undefined, 'not due yet')

  // The farm needs a day's notice: for today the deadline was yesterday.
  await sql`UPDATE purchase_orders SET delivery_date = ${today()}::date WHERE id = ${toSend.id}`
  await sql`UPDATE purchase_orders SET delivery_date = ${day(-2)}::date WHERE id = ${overdue.id}`
  d = await feed()
  const late = card(d, toSend.id)
  assert.equal(late.kind, 'po_to_send')
  assert.equal(late.group, 'late')
  assert.match(late.detail, /past the order deadline/)
  const notBooked = card(d, overdue.id)
  assert.equal(notBooked.kind, 'delivery_not_booked')
  assert.equal(notBooked.group, 'late')
  assert.match(notBooked.detail, /not booked in/)
  // Its delivery day gone too.
  await sql`UPDATE purchase_orders SET delivery_date = ${day(-1)}::date WHERE id = ${toSend.id}`
  assert.match(card(await feed(), toSend.id).detail, /the delivery day has passed/)
  // Booked in (received): gone from Today.
  await sql`UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = ${overdue.id}`
  assert.equal(card(await feed(), overdue.id), undefined)
  await sql`UPDATE purchase_orders SET status = 'cancelled' WHERE id IN (${toSend.id}, ${overdue.id})`
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

const refused = async (p, re) => {
  await assert.rejects(p, err => { assert.match(err.message, re); return true })
}

test('Pepper: the venue\'s delivery details, the open-order question, the supplier\'s reference, late orders', async () => {
  const list = await listOf('Pepper JJ', [oil])
  const o = await draft(owner, list)
  await setLines(owner, o, [{ item_id: oil.id, qty: 2 }])
  const form = (await pepper(A.owner, 'order_form', { order_id: o.id })).out
  const s = form.suppliers.find(x => x.supplier === 'JJ Foodservice')
  assert.equal(s.delivery_time, '07:00-10:00')
  assert.equal(s.delivery_phone, '07700 900123')
  assert.match(s.driver_instructions, /^Ring the back bell/)
  assert.match(s.needs_their_reference, /order reference/)

  // An open order for that day: Pepper must ask first.
  const prior = await orderOf([[oil, 1, jj.id]])
  const po1 = (await ok(place(prior.o, { [jj.id]: { delivery_date: day(15) } }))).purchase_orders[0]
  const deliveries = [{ supplier: 'JJ', date: day(15) }]
  await refused(pepper(A.owner, 'place_order', { order_id: o.id, deliveries }, { run: false }), /already has PO-\d+ for .* \(not sent yet\)\. Ask the person/)
  const { card, out } = await pepper(A.owner, 'place_order', { order_id: o.id, deliveries: [{ ...deliveries[0], existing_order: 'add_to_it' }] })
  assert.ok(card.lines.some(l => /07:00-10:00, added to PO-\d+ \(not sent yet\)/.test(l)), card.lines.join(' | '))
  assert.ok(card.lines.some(l => l === '  Note: Ring the back bell'), 'the default note on the card')
  assert.equal(out.purchase_orders[0].po_id, po1.id)
  assert.equal(out.purchase_orders[0].added_to_it, true)
  assert.deepEqual((await poLines(po1.id)).map(l => l.qty), [3])

  // Marking sent needs JJ's reference; with it, and when it went.
  await refused(pepper(A.owner, 'send_purchase_order', { po: poNumberLabel(po1.number), how: 'phone' }, { run: false }), /needs their own order reference/)
  const now = nowAt('Europe/London')
  const earlier = (() => { const [h, m] = now.time.split(':').map(Number); const t = Math.max(0, h * 60 + m - 90); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') })()
  await sql`UPDATE purchase_orders SET created_at = now() - interval '1 day' WHERE id = ${po1.id}`
  const sent = await pepper(A.owner, 'send_purchase_order', { po: poNumberLabel(po1.number), how: 'phone', supplier_ref: 'S099', sent_time: earlier })
  assert.ok(sent.card.lines.some(l => l === "JJ Foodservice's reference: S099"), sent.card.lines.join(' | '))
  assert.ok(sent.card.lines.some(l => l.includes('went today at ' + earlier)), sent.card.lines.join(' | '))
  assert.equal(sent.out.supplier_ref, 'S099')
  assert.equal((await poRow(po1.id)).supplier_ref, 'S099')
  await refused(pepper(A.owner, 'send_purchase_order', { po: poNumberLabel(po1.number), how: 'email', sent_on: day(-1) }, { run: false }), /no order email address|only for marking it sent/)

  // Found by the reference; corrected later.
  const found = (await pepper(A.owner, 'purchase_orders', { supplier_ref: 'S09' })).out
  assert.deepEqual(found.purchase_orders.map(p => p.po_id), [po1.id])
  assert.equal(found.purchase_orders[0].supplier_ref, 'S099')
  const fix = await pepper(A.owner, 'change_purchase_order', { po: poNumberLabel(po1.number), supplier_ref: 'S0999' })
  assert.ok(fix.card.lines.some(l => /reference: S099 to S0999/.test(l)), fix.card.lines.join(' | '))
  assert.equal((await poRow(po1.id)).supplier_ref, 'S0999')

  // Late: sent for a day gone and not booked in; Pepper's list and the briefing.
  await sql`UPDATE purchase_orders SET delivery_date = ${day(-3)}::date WHERE id = ${po1.id}`
  const late = (await pepper(A.owner, 'purchase_orders', { late: true })).out.purchase_orders
  const mine = late.find(p => p.po_id === po1.id)
  assert.match(mine?.late || '', /sent, not booked in since/)
  const [{ name: venueName }] = await sql`SELECT name FROM venues WHERE id = ${V}`
  const brief = (await pepper(A.owner, 'day_briefing', { venue: venueName })).out
  assert.ok(brief.orders_running_late?.late >= 1, JSON.stringify(brief.orders_running_late))
  assert.ok(brief.orders_running_late.purchase_orders.some(p => p.po_id === po1.id))
})
