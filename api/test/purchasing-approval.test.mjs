// Purchasing approval and splitting (migration 180). Someone who can order
// but has no Purchasing approval sends an order for approval (status
// requested, with the days wanted); a second person with approval changes
// it, places it, splits it into a second request for another day or sends
// it back. A placed purchase order can be split into a second order for
// another day; one the supplier already had goes back to To send as
// amended. Checked here: who may do what, what each step writes, the
// refusals (same day, the whole order, another tenant), and the amended /
// split wording on the purchase order the supplier gets; and Pepper's
// purchasing tools doing the same through the routes.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { addDays, poNumberLabel } from '../../shared/procurement.js'
import { makeContext } from '../src/ai/context.js'
import { audienceTools, parseInput } from '../src/ai/tools/index.js'
import { longDate } from '../src/ai/tools/util.js'

let ids, owner, operator, viewer, otherOwner, V, rice, oil, supplier, list
const today = new Date().toISOString().slice(0, 10)
const day = n => addDays(today, n)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  otherOwner = as(B.owner, ids.b)

  // Operators may order but not approve: they send orders for approval.
  const roles = await ok(owner.get('/api/access/roles'))
  const op = roles.find(r => r.key === 'operator')
  await ok(owner.patch(`/api/access/roles/${op.id}`, { permissions: { purchasing_approve: 'none' } }), 'operator role')

  supplier = await ok(owner.post('/api/suppliers', { name: 'Approval Farm', send_method: 'print', lead_days: 1 }), 'supplier')
  rice = await ok(owner.post('/api/inventory/items', { name: 'Jasmine rice', base_unit: 'g' }), 'rice')
  oil = await ok(owner.post('/api/inventory/items', { name: 'Peanut oil', base_unit: 'ml' }), 'oil')
  await ok(owner.post(`/api/inventory/items/${rice.id}/quotes`, { supplier_id: supplier.id, pack_name: 'Sack', pack_qty: 20, pack_unit: 'kg', price: 30 }), 'rice price')
  await ok(owner.post(`/api/inventory/items/${oil.id}/quotes`, { supplier_id: supplier.id, pack_name: 'Tin', pack_qty: 5, pack_unit: 'l', price: 12 }), 'oil price')
  list = await ok(owner.post('/api/purchasing/lists', { name: 'Approval list', venue_ids: [V], item_ids: [rice.id, oil.id] }), 'list')
})
after(closeApp)

let requestId, splitId, poId

test('who may approve: operators order, owners also approve, viewers neither', async () => {
  const opMeta = await ok(operator.get('/api/purchasing/meta'))
  assert.equal(opMeta.can_order, true)
  assert.equal(opMeta.can_approve, false)
  const ownMeta = await ok(owner.get('/api/purchasing/meta'))
  assert.equal(ownMeta.can_approve, true)
  const viewMeta = await ok(viewer.get('/api/purchasing/meta'))
  assert.equal(viewMeta.can_order, false)
  assert.equal(viewMeta.can_approve, false)
})

test('an operator sends an order for approval and can no longer change it', async () => {
  const draft = await ok(operator.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }))
  assert.equal(draft.can_request, true)
  assert.equal(draft.can_place, false)
  requestId = draft.id
  await ok(operator.put(`/api/purchasing/orders/${draft.id}/lines`, { lines: [{ item_id: rice.id, qty: 6 }, { item_id: oil.id, qty: 4 }] }))

  const place = await operator.post(`/api/purchasing/orders/${draft.id}/submit`, {})
  assert.equal(place.status, 403, 'an operator cannot place it')
  assert.equal((await viewer.post(`/api/purchasing/orders/${draft.id}/request`, {})).status, 403, 'a viewer cannot send it')
  assert.equal((await operator.post(`/api/purchasing/orders/${draft.id}/request`, { suppliers: { [supplier.id]: { delivery_date: day(-1) } } })).status, 422, 'a past day is refused')

  const asked = await ok(operator.post(`/api/purchasing/orders/${draft.id}/request`, {
    suppliers: { [supplier.id]: { delivery_date: day(3), notes: 'Back door' } }, note: 'Busy weekend',
  }))
  assert.equal(asked.status, 'requested')
  assert.equal(asked.requested_by, A.operator + '@test.local')
  assert.equal(asked.notes, 'Busy weekend')
  assert.deepEqual(asked.supplier_options, { [supplier.id]: { delivery_date: day(3), notes: 'Back door' } })
  assert.equal(asked.can_edit, false)
  assert.equal(asked.can_withdraw, true, 'the person who asked can take it back')
  assert.equal(asked.items.find(i => i.item_id === rice.id).requested_qty, 6)

  const edit = await operator.put(`/api/purchasing/orders/${draft.id}/lines`, { lines: [{ item_id: rice.id, qty: 9 }] })
  assert.equal(edit.status, 403, 'only an approver changes a request')
  assert.equal((await operator.delete(`/api/purchasing/orders/${draft.id}`)).status, 403)
  assert.equal((await operator.post(`/api/purchasing/orders/${draft.id}/split`, { lines: [{ item_id: rice.id, qty: 1 }], suppliers: {} })).status, 403)

  const waiting = (await ok(owner.get(`/api/purchasing/orders?venue_id=${V}&status=requested`))).filter(o => o.list_id === list.id)
  assert.deepEqual(waiting.map(o => o.id), [draft.id])
  assert.equal(waiting[0].line_count, 2)
})

test('the approver changes the request and splits it into a second order for another day', async () => {
  await ok(owner.put(`/api/purchasing/orders/${requestId}/lines`, { lines: [{ item_id: rice.id, qty: 5 }] }), 'amend')
  const seen = await ok(owner.get(`/api/purchasing/orders/${requestId}`))
  const riceLine = seen.items.find(i => i.item_id === rice.id)
  assert.equal(riceLine.qty, 5)
  assert.equal(riceLine.requested_qty, 6, 'what was asked for still shows')
  assert.equal(seen.can_split, true)

  const sameDay = await owner.post(`/api/purchasing/orders/${requestId}/split`, {
    lines: [{ item_id: rice.id, qty: 2 }], suppliers: { [supplier.id]: { delivery_date: day(3) } },
  })
  assert.equal(sameDay.status, 422, 'the second order must be for another day')
  const whole = await owner.post(`/api/purchasing/orders/${requestId}/split`, {
    lines: [{ item_id: rice.id, qty: 5 }, { item_id: oil.id, qty: 4 }], suppliers: { [supplier.id]: { delivery_date: day(6) } },
  })
  assert.equal(whole.status, 422, 'moving everything is a change of day, not a split')
  const tooMany = await owner.post(`/api/purchasing/orders/${requestId}/split`, {
    lines: [{ item_id: rice.id, qty: 7 }], suppliers: { [supplier.id]: { delivery_date: day(6) } },
  })
  assert.equal(tooMany.status, 422)
  const noDay = await owner.post(`/api/purchasing/orders/${requestId}/split`, { lines: [{ item_id: rice.id, qty: 2 }], suppliers: {} })
  assert.equal(noDay.status, 422)

  const res = await ok(owner.post(`/api/purchasing/orders/${requestId}/split`, {
    lines: [{ item_id: rice.id, qty: 2 }, { item_id: oil.id, qty: 4 }], suppliers: { [supplier.id]: { delivery_date: day(6) } },
  }), 'split')
  splitId = res.new_order_id
  assert.equal(res.order.items.find(i => i.item_id === rice.id).qty, 3)
  assert.equal(res.order.items.find(i => i.item_id === oil.id).qty, 0)

  const second = await ok(owner.get(`/api/purchasing/orders/${splitId}`))
  assert.equal(second.status, 'requested')
  assert.equal(second.split_from, requestId)
  assert.equal(second.requested_by, A.operator + '@test.local')
  assert.equal(second.supplier_options[supplier.id].delivery_date, day(6))
  assert.equal(second.supplier_options[supplier.id].notes, 'Back door', 'the supplier note goes with it')
  assert.deepEqual(second.items.filter(i => i.qty > 0).map(i => [i.item_id, i.qty]).sort(), [[rice.id, 2], [oil.id, 4]].sort())
  assert.equal(second.items.find(i => i.item_id === oil.id).requested_qty, 4)
})

test('the approver sends one back with a note; the operator changes it and sends it again', async () => {
  assert.equal((await owner.post(`/api/purchasing/orders/${splitId}/return`, { note: '' })).status, 400, 'a reason is needed')
  const back = await ok(owner.post(`/api/purchasing/orders/${splitId}/return`, { note: 'Oil is still in stock' }))
  assert.equal(back.status, 'draft')
  assert.equal(back.return_note, 'Oil is still in stock')
  assert.equal(back.returned_by, A.owner + '@test.local')
  const drafts = await ok(operator.get(`/api/purchasing/orders?venue_id=${V}&status=draft`))
  assert.ok(drafts.some(d => d.id === splitId && d.return_note === 'Oil is still in stock'))

  await ok(operator.put(`/api/purchasing/orders/${splitId}/lines`, { lines: [{ item_id: oil.id, qty: 0 }] }))
  const again = await ok(operator.post(`/api/purchasing/orders/${splitId}/request`, { suppliers: { [supplier.id]: { delivery_date: day(6) } } }))
  assert.equal(again.status, 'requested')
  assert.equal(again.return_note, null)

  // Taken back by the person who asked, then sent again.
  const mine = await ok(operator.post(`/api/purchasing/orders/${splitId}/withdraw`, {}))
  assert.equal(mine.status, 'draft')
  await ok(operator.post(`/api/purchasing/orders/${splitId}/request`, { suppliers: { [supplier.id]: { delivery_date: day(6) } } }))
})

test('the approver places the request for the day asked for, and the purchase order records who asked', async () => {
  const placed = await ok(owner.post(`/api/purchasing/orders/${requestId}/submit`, {}), 'place')
  assert.equal(placed.purchase_orders.length, 1)
  const po = placed.purchase_orders[0]
  poId = po.id
  assert.equal(po.delivery_date, day(3), 'the day the request asked for')
  assert.equal(po.requested_by, A.operator + '@test.local')
  const detail = await ok(owner.get(`/api/purchasing/pos/${po.id}`))
  assert.equal(detail.created_by, A.owner + '@test.local')
  assert.equal(detail.notes, 'Back door')
  assert.deepEqual(detail.lines.map(l => [l.item_name, l.qty]), [['Jasmine rice', 3]])
  assert.ok(Array.isArray(detail.delivery_choices) && detail.delivery_choices.length > 1)
  assert.equal((await owner.post(`/api/purchasing/orders/${requestId}/split`, { lines: [{ item_id: rice.id, qty: 1 }], suppliers: { [supplier.id]: { delivery_date: day(8) } } })).status, 409, 'a placed order splits from its purchase order')
})

test('a purchase order splits into a second order for another day; only approvers may', async () => {
  const body = { lines: [], delivery_date: day(5) }
  const d = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  const line = d.lines[0]
  body.lines = [{ id: line.id, qty: 1 }]
  assert.equal((await operator.post(`/api/purchasing/pos/${poId}/split`, body)).status, 403)
  assert.equal((await viewer.post(`/api/purchasing/pos/${poId}/split`, body)).status, 403)
  assert.equal((await operator.post(`/api/purchasing/pos/${poId}/cancel`, {})).status, 403, 'cancelling needs approval too')
  assert.equal((await operator.put(`/api/purchasing/pos/${poId}/lines`, { lines: [{ id: line.id, qty: 2 }] })).status, 403, 'and changing quantities')
  assert.equal((await owner.post(`/api/purchasing/pos/${poId}/split`, { ...body, delivery_date: day(3) })).status, 422, 'same day refused')
  assert.equal((await owner.post(`/api/purchasing/pos/${poId}/split`, { ...body, lines: [{ id: line.id, qty: 3 }] })).status, 422, 'whole order refused')
  assert.equal((await owner.post(`/api/purchasing/pos/${poId}/split`, { ...body, delivery_date: day(-2) })).status, 422, 'past day refused')
  assert.equal((await otherOwner.post(`/api/purchasing/pos/${poId}/split`, body)).status, 404, 'another tenant')

  const res = await ok(owner.post(`/api/purchasing/pos/${poId}/split`, body), 'split po')
  assert.equal(res.was_sent, false)
  assert.deepEqual(res.results, [], 'nothing is sent by itself before the order went out')
  assert.equal(res.po.status, 'to_send')
  assert.deepEqual(res.po.lines.map(l => l.qty), [2])
  assert.equal(res.po.subtotal, 60)
  assert.equal(res.new_po.status, 'to_send')
  assert.equal(res.new_po.delivery_date, day(5))
  assert.equal(res.new_po.split_from, poId)
  assert.equal(res.new_po.requested_by, A.operator + '@test.local')
  assert.deepEqual(res.new_po.lines.map(l => [l.item_name, l.qty, l.price]), [['Jasmine rice', 1, 30]])
  assert.equal(res.new_po.subtotal, 30)
  assert.equal(res.new_po.split_from_po.id, poId)
  assert.deepEqual(res.po.split_into.map(x => x.id), [res.new_po.id])
  const html = await owner.get(`/api/purchasing/pos/${res.new_po.id}/file?format=html`)
  assert.match(html.body, /Split off PO-\d{5} to come on another day/)
})

test('splitting an order the supplier already has sends it back to To send as amended', async () => {
  // Operators can still send an approved order and book deliveries in.
  await ok(operator.post(`/api/purchasing/pos/${poId}/mark-sent`, { via: 'phone' }), 'mark sent')
  const d = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  assert.equal(d.status, 'sent')
  const res = await ok(owner.post(`/api/purchasing/pos/${poId}/split`, { lines: [{ id: d.lines[0].id, qty: 1 }], delivery_date: day(7) }))
  assert.equal(res.was_sent, true)
  assert.equal(res.po.status, 'to_send', 'it goes back to To send')
  assert.ok(res.po.amended_at)
  assert.equal(res.po.amended_by, A.owner + '@test.local')
  assert.equal(res.results.length, 2, 'both copies are listed to send again')
  assert.ok(res.results.every(r => !r.emailed && !r.error), 'a supplier that takes printed orders is not emailed')
  const html = await owner.get(`/api/purchasing/pos/${poId}/file?format=html`)
  assert.match(html.body, /\(amended\)/)
  assert.match(html.body, /replaces any earlier copy/)
  const open = await ok(owner.get(`/api/purchasing/pos?venue_id=${V}&status=to_send`))
  assert.ok(open.find(p => p.id === poId)?.amended_at)
  await ok(operator.post(`/api/purchasing/pos/${poId}/mark-sent`, { via: 'phone' }), 'sent again')

  // A supplier that takes email gets both straight away.
  await ok(owner.patch(`/api/suppliers/${supplier.id}`, { send_method: 'email', email: 'orders@approval.test' }))
  const again = await ok(owner.get(`/api/purchasing/pos/${poId}`))
  const res2 = await ok(owner.post(`/api/purchasing/pos/${poId}/split`, { lines: [{ id: again.lines[0].id, qty: 0.5 }], delivery_date: day(9) }))
  assert.equal(res2.results.length, 2, 'both copies are emailed (or the failure is reported)')
  assert.deepEqual(res2.results.map(r => r.id).sort(), [poId, res2.new_po.id].sort())
})

test('the other tenant can see none of it', async () => {
  assert.equal((await otherOwner.get(`/api/purchasing/orders/${splitId}`)).status, 404)
  assert.equal((await otherOwner.post(`/api/purchasing/orders/${splitId}/return`, { note: 'x' })).status, 404)
  assert.equal((await otherOwner.post(`/api/purchasing/orders/${splitId}/withdraw`, {})).status, 404)
  assert.equal((await otherOwner.post(`/api/purchasing/orders/${splitId}/split`, { lines: [{ item_id: rice.id, qty: 1 }], suppliers: { [supplier.id]: { delivery_date: day(10) } } })).status, 404)
  const theirs = await ok(otherOwner.get('/api/purchasing/orders?status=requested'))
  assert.equal(theirs.length, 0)
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

async function refused(sub, name, input, status, pattern) {
  await assert.rejects(pepper(sub, name, input), err => {
    assert.equal(err.status, status, err.message)
    if (pattern) assert.match(err.message, pattern)
    return true
  })
}

test('Pepper: an operator sends for approval; the approver splits, sends back and places', async () => {
  const target = { venue_id: V, list: 'Approval list' }
  await refused(A.operator, 'place_order', { ...target, lines: [{ item: 'Jasmine rice', quantity: 4 }] }, 403, /request_order/)

  const asked = await pepper(A.operator, 'request_order', {
    ...target, lines: [{ item: 'Jasmine rice', quantity: 4 }, { item: 'Peanut oil', quantity: 2 }],
    deliveries: [{ supplier: 'Approval Farm', date: day(4) }], note: 'From Pepper',
  })
  assert.equal(asked.card.title, 'Send this order for approval?')
  assert.ok(asked.card.lines.some(l => l.includes('wanted ' + longDate(day(4)))), asked.card.lines.join('\n'))
  assert.equal(asked.out.status, 'waiting for approval')
  const orderId = asked.out.order_id

  const seen = (await pepper(A.operator, 'order_requests', { venue_id: V })).out
  assert.equal(seen.you_can_approve, false)
  const mine = seen.waiting_for_approval.find(o => o.order_id === orderId)
  assert.equal(mine.asked_by, A.operator + '@test.local')
  assert.equal(mine.note, 'From Pepper')
  await refused(A.operator, 'update_order', { order_id: orderId, lines: [{ item: 'Jasmine rice', quantity: 9 }] }, 403, /waiting for approval/)
  await refused(A.operator, 'split_order', { order_id: orderId, lines: [{ item: 'rice', quantity: 1 }], delivery_date: day(6) }, 403)
  await refused(A.operator, 'send_back_order', { order_id: orderId, note: 'no' }, 403)

  const form = (await pepper(A.owner, 'order_form', { order_id: orderId })).out
  assert.equal(form.status, 'waiting for approval, not sent to suppliers')
  assert.ok(form.you_can.some(x => x.includes('place_order')))

  await refused(A.owner, 'split_order', { order_id: orderId, lines: [{ item: 'rice', quantity: 1 }], delivery_date: day(4) }, 422, /another day/)
  const split = await pepper(A.owner, 'split_order', { order_id: orderId, lines: [{ item: 'oil', quantity: 2 }], delivery_date: day(6) })
  assert.ok(split.card.lines.some(l => l.includes('second order ' + longDate(day(6)))), split.card.lines.join('\n'))
  const back = await pepper(A.owner, 'send_back_order', { order_id: split.out.new_order_id, note: 'Oil can wait' })
  assert.match(back.out.message, /Sent back/)

  const placed = await pepper(A.owner, 'place_order', { order_id: orderId })
  assert.ok(placed.card.lines.some(l => l.includes(longDate(day(4)) + ' (as asked)')), placed.card.lines.join('\n'))
  const po = placed.out.purchase_orders[0]
  assert.equal(po.delivery, longDate(day(4)))

  // A placed purchase order: approvers split it, operators can only send it.
  await refused(A.operator, 'split_order', { po: po.po, lines: [{ item: 'rice', quantity: 1 }], delivery_date: day(8) }, 403)
  await refused(A.operator, 'cancel_purchase_order', { po: po.po }, 403)
  const poSplit = await pepper(A.owner, 'split_order', { po: po.po, lines: [{ item: 'rice', quantity: 1 }], delivery_date: day(8) })
  assert.equal(poSplit.card.title, 'Split ' + po.po + '?')
  assert.match(poSplit.out.new_po, /^PO-\d{5}$/)
  const marked = await pepper(A.operator, 'send_purchase_order', { po: poSplit.out.new_po, how: 'phone' })
  assert.match(marked.out.message, /Marked as sent/)
  assert.equal(poNumberLabel(Number(po.po.slice(3))), po.po)
})
