// Returns to the supplier and their credit notes (inventory phase 9b,
// migration 321; docs/INVENTORY.md 6.4). Checked here:
//   - a damaged line starts a return filled in; the stock goes out as a return
//     move on the ledger at once (on hand and the item's history), never more
//     than arrived, and correcting the delivery can't book in fewer than went back;
//   - emailing it to the supplier (SendGrid stood in: nothing leaves the
//     process) with its PDF, a failed email kept on it, marking one sent;
//   - the credit note (its number, its amount only from someone who sees
//     prices), refused (the stock stays out) and cancelled (it comes back);
//   - variance's returns term reads the same moves: a closing count that finds
//     what the ledger expected leaves nothing unexplained;
//   - Today's credit note to chase once 14 days have passed (the moment pinned
//     by moving the return back, and by the route's `at`), for an approver to act on;
//   - Pepper's start_return, confirmed first, by names;
//   - who may do what: Purchasing Use starts and cancels an open return, Purchasing
//     approval sends and credits it, View reads; and another group's ids refused.
//   - the report subject and the starter Credits still owed.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { addDays, nowAt } = await import('../../shared/procurement.js')

const CHECK = { packaging_ok: true, damage_ok: false, quality_ok: true, accepted: true, corrective_action: 'Driver took the damaged cases back' }
const PORTER = 'a-porter'
const realFetch = globalThis.fetch

let ids, owner, operator, viewer, porter, bOwner, V, VB, sup, supB, chicken, cups, po, poB
let failMail = false
const mails = []

const byName = list => Object.fromEntries(list.map(i => [i.name, i]))
const onHand = async (api = owner) => byName((await ok(api.get(`/api/stock/venues/${V}`))).items)
const returnsOf = (api, poId) => ok(api.get(`/api/purchasing/pos/${poId}/returns`))
const lineOf = (d, name) => d.lines.find(l => l.item_name === name)

/** An order placed and booked in at venue V: chicken cases (3 came, damaged) and cups (as ordered). */
async function delivered() {
  const list = await ok(owner.post('/api/purchasing/lists', { name: 'Returns list ' + Math.random().toString(36).slice(2, 7), venue_ids: [V], item_ids: [chicken.id, cups.id] }))
  const o = await ok(owner.post('/api/purchasing/orders', { venue_id: V, list_id: list.id }))
  await ok(owner.put(`/api/purchasing/orders/${o.id}/lines`, { lines: [{ item_id: chicken.id, qty: 3 }, { item_id: cups.id, qty: 4 }] }))
  const placed = (await ok(owner.post(`/api/purchasing/orders/${o.id}/submit`, {}))).purchase_orders[0]
  const d = await ok(owner.get(`/api/purchasing/pos/${placed.id}`))
  await ok(owner.post(`/api/purchasing/pos/${placed.id}/receive`, {
    lines: [{ id: lineOf(d, 'Chicken thighs').id, received_qty: 3, status: 'damaged', note: 'two cases crushed' }],
    check: CHECK,
  }), 'booked in')
  return ok(owner.get(`/api/purchasing/pos/${placed.id}`))
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  // A porter: Purchasing Use only (starts returns), no approval, no prices.
  const role = await ok(owner.post('/api/access/roles', { key: 'porter', label: 'Porter', permissions: { purchasing: 'use', stock: 'view' } }), 'porter role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id) VALUES (${ids.a}, ${PORTER + '@test.local'}, 'viewer', ${PORTER}, ${role.id})`
  porter = as(PORTER, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware-returns', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-returns', timezone: 'Europe/London' }))).id
  sup = await ok(owner.post('/api/suppliers', { name: 'Brakes', send_method: 'email', email: 'returns@brakes.example', lead_days: 1, delivery_days: [0, 1, 2, 3, 4, 5, 6] }))
  supB = await ok(bOwner.post('/api/suppliers', { name: 'Their Supplier', send_method: 'print' }))
  chicken = await ok(owner.post('/api/inventory/items', { name: 'Chicken thighs', base_unit: 'g', storage: 'ambient' }))
  await ok(owner.post(`/api/inventory/items/${chicken.id}/quotes`, { supplier_id: sup.id, supplier_code: 'CH-5', pack_name: 'Case', pack_qty: 5, pack_unit: 'kg', price: 20, vat_rate: 0 }))
  cups = await ok(owner.post('/api/inventory/items', { name: 'Cups', base_unit: 'each' }))
  await ok(owner.post(`/api/inventory/items/${cups.id}/quotes`, { supplier_id: sup.id, supplier_code: 'CP-50', pack_name: 'Sleeve', pack_qty: 50, pack_unit: 'each', price: 3, vat_rate: 20 }))
  // The venue emails through SendGrid (a stand-in: nothing leaves this process).
  await ok(owner.post(`/api/email-templates/settings/${V}`, { email_provider: 'sendgrid', provider_api_key: 'SG.returns-test', from_name: 'Ware', from_email: 'orders@ware.example' }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      if (failMail) return new Response('{"errors":[{"message":"Mail is down"}]}', { status: 400 })
      mails.push(JSON.parse(opts.body))
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + mails.length } })
    }
    return realFetch(url, opts)
  }
  // The opening count, before the delivery: no chicken, no cups.
  await ok(owner.post(`/api/stock/venues/${V}/counts`, { lines: [{ item_id: chicken.id, qty: 0, unit: 'kg' }, { item_id: cups.id, qty: 0, unit: 'each' }] }), 'opening count')
  po = await delivered()
  // Another group's delivery, for the cross-tenant checks.
  await ok(bOwner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const bItem = await ok(bOwner.post('/api/inventory/items', { name: 'Their flour', base_unit: 'g' }))
  const bQuote = (await ok(bOwner.post(`/api/inventory/items/${bItem.id}/quotes`, { supplier_id: supB.id, pack_name: 'Sack', pack_qty: 16, pack_unit: 'kg', price: 14 }))).quotes[0]
  poB = await ok(bOwner.post(`/api/purchasing/venues/${VB}/deliveries`, {
    supplier_id: supB.id, lines: [{ item_id: bItem.id, quote_id: bQuote.id, received_qty: 2 }], check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
})
test.after(async () => { globalThis.fetch = realFetch; await closeApp() })

let r1, r2

test('a damaged line starts a return filled in; the stock goes out on the ledger at once, never more than arrived', async () => {
  const d = await returnsOf(porter, po.id)
  assert.equal(d.can_start, true, 'Purchasing Use starts a return')
  assert.equal(d.can_approve, false)
  assert.equal(d.show_prices, false)
  const ch = lineOf(d, 'Chicken thighs')
  assert.deepEqual(ch.prefill, { po_line_id: ch.id, qty: 3, reason: 'damaged', note: 'two cases crushed' }, 'the damaged line, filled in')
  assert.equal(lineOf(d, 'Cups').prefill, null)
  assert.equal(ch.price, undefined, 'no prices without Purchasing setup')
  assert.equal(lineOf(await returnsOf(owner, po.id), 'Chicken thighs').price, 20, 'the price paid, for someone who sees prices')

  const before = await onHand()
  assert.equal(before['Chicken thighs'].on_hand, 15000)
  const res = await porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: ch.id, qty: 2, reason: 'damaged', note: 'crushed' }], note: 'The driver took them' })
  assert.equal(res.status, 201)
  r1 = res.json
  assert.equal(r1.label, 'RT-00001')
  assert.equal(r1.status, 'open')
  assert.equal(r1.supplier_name, 'Brakes')
  assert.equal(r1.credit_expected, undefined, 'no money for the porter')
  assert.equal(r1.lines[0].qty_base, 10000)
  assert.deepEqual([r1.can_cancel, r1.can_email, r1.can_credit], [true, false, false])
  const seen = await ok(owner.get(`/api/purchasing/returns/${r1.id}`))
  assert.deepEqual([seen.credit_expected, seen.credit_vat, seen.credit_total], [40, 0, 40], 'two cases at £20 paid')
  assert.equal(seen.created_by, PORTER + '@test.local', 'who did it, as the stock documents keep them')

  const after = await onHand()
  assert.equal(after['Chicken thighs'].on_hand, 5000, 'off stock at once')
  assert.equal(after['Chicken thighs'].returned_since, -10000)
  const moves = (await ok(owner.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`))).moves
  const m = moves.find(x => x.kind === 'return')
  assert.ok(m, 'a return move on the ledger')
  assert.equal(m.change, -10000)
  assert.equal(m.kind_label, 'Returned to the supplier')
  assert.equal(m.source.label, 'RT-00001 to Brakes (damaged)')
  assert.equal(m.value, -40, 'at the price paid')
  const opMove = (await ok(operator.get(`/api/stock/venues/${V}/items/${chicken.id}/moves`))).moves.find(x => x.kind === 'return')
  assert.equal(opMove.value ?? null, null, 'a return\'s value is a supplier price: hidden without purchasing prices')

  // What is left: 1 case. More than that is refused, and the prefill is down to it.
  assert.equal(lineOf(await returnsOf(porter, po.id), 'Chicken thighs').left, 1)
  const over = await porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: ch.id, qty: 2, reason: 'damaged' }] })
  assert.equal(over.status, 422)
  assert.equal(over.json.code, 'lines')
  assert.match(over.json.error, /Only 1 of Chicken thighs can go back \(3 arrived, 2 already going back\)/)
  const other = await porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: lineOf(d, 'Cups').id, qty: 1, reason: 'other' }] })
  assert.equal(other.status, 422, 'Other needs a note')
  const early = await porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: lineOf(d, 'Cups').id, qty: 1, reason: 'quality' }], returned_at: new Date(Date.now() - 20 * 86400000).toISOString() })
  assert.equal(early.json.code, 'returned_at')

  // Correcting the delivery can't book in fewer chicken than went back.
  const fewer = await owner.post(`/api/purchasing/pos/${po.id}/receive`, { lines: [{ id: ch.id, received_qty: 1, status: 'damaged' }], check: CHECK })
  assert.equal(fewer.status, 422)
  assert.equal(fewer.json.code, 'returned')
  // Nothing can go back from an order not booked in yet.
  const notYet = await owner.get(`/api/purchasing/pos?venue_id=${V}&status=to_send,sent`)
  if (notYet.json[0]) assert.equal((await porter.post(`/api/purchasing/pos/${notYet.json[0].id}/returns`, { lines: [{ po_line_id: ch.id, qty: 1, reason: 'damaged' }] })).json.code, 'not_received')
})

test('emailing the return with its PDF (the mail stood in), a failed email kept on it, marking one sent', async () => {
  assert.equal((await porter.post(`/api/purchasing/returns/${r1.id}/send`)).status, 403, 'sending needs Purchasing approval')
  assert.equal((await viewer.post(`/api/purchasing/returns/${r1.id}/send`)).status, 403)
  failMail = true
  const failed = await operator.post(`/api/purchasing/returns/${r1.id}/send`)
  failMail = false
  assert.equal(failed.status, 422)
  assert.equal(failed.json.code, 'email_failed')
  const kept = await ok(owner.get(`/api/purchasing/returns/${r1.id}`))
  assert.equal(kept.status, 'open', 'not sent')
  assert.match(kept.send_error, /Mail is down|400/)

  const sent = await ok(operator.post(`/api/purchasing/returns/${r1.id}/send`), 'emailed')
  assert.deepEqual([sent.status, sent.sent_via, sent.sent_to, sent.send_error], ['sent', 'email', 'returns@brakes.example', null])
  const mail = mails.at(-1)
  assert.equal(mail.personalizations[0].to[0].email, 'returns@brakes.example')
  assert.match(mail.subject, /^Return RT-00001 from Ware: credit note please$/)
  const pdf = mail.attachments?.find(a => a.type === 'application/pdf')
  assert.ok(pdf, 'the PDF attached')
  assert.equal(Buffer.from(pdf.content, 'base64').subarray(0, 5).toString(), '%PDF-')
  assert.match(mail.content[0].value, /quoting RT-00001/)
  // The PDF and the printable page, as the supplier gets them (always with the prices).
  const file = await porter.get(`/api/purchasing/returns/${r1.id}/file?format=html`)
  assert.equal(file.status, 200)
  assert.match(file.body, /Return RT-00001/)

  // A second return, of the cups, marked sent by hand: handed to the driver.
  const d = await returnsOf(porter, po.id)
  r2 = await ok(porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: lineOf(d, 'Cups').id, qty: 1, reason: 'short_dated' }] }))
  assert.equal((await porter.post(`/api/purchasing/returns/${r2.id}/mark-sent`, { via: 'driver' })).status, 403)
  const marked = await ok(operator.post(`/api/purchasing/returns/${r2.id}/mark-sent`, { via: 'driver' }))
  assert.deepEqual([marked.status, marked.sent_via, marked.sent_via_label], ['sent', 'driver', 'Handed to the driver'])
  assert.equal((await operator.post(`/api/purchasing/returns/${r2.id}/mark-sent`, { via: 'phone' })).status, 409, 'already sent')
  assert.equal((await porter.post(`/api/purchasing/returns/${r2.id}/cancel`, {})).status, 403, 'a sent return is an approver\'s to cancel')
})

test('the credit note: its number; its amount only from someone who sees prices; corrected later', async () => {
  const noPrices = await operator.post(`/api/purchasing/returns/${r1.id}/credit`, { credit_note_number: 'CN-881', credit_amount: 39.5 })
  assert.equal(noPrices.status, 403, 'the operator doesn\'t see purchasing prices')
  assert.equal(noPrices.json.code, 'prices')
  assert.equal((await porter.post(`/api/purchasing/returns/${r1.id}/credit`, { credit_note_number: 'CN-881' })).status, 403)
  const credited = await ok(operator.post(`/api/purchasing/returns/${r1.id}/credit`, { credit_note_number: 'CN-881', credit_note_date: nowAt('Europe/London').date }))
  assert.deepEqual([credited.status, credited.credit_note_number, credited.credit_amount], ['credited', 'CN-881', undefined])
  const fixed = await ok(owner.post(`/api/purchasing/returns/${r1.id}/credit`, { credit_note_number: 'CN-881', credit_amount: 39.5 }))
  assert.deepEqual([fixed.credit_amount, fixed.credit_difference], [39.5, -0.5], 'credited 50p short')
  assert.deepEqual(fixed.history.map(h => h.action), ['emailed', 'credited', 'credit_changed'])
  assert.equal((await owner.post(`/api/purchasing/returns/${r1.id}/cancel`, {})).status, 409, 'a credited return is never cancelled')
  assert.equal((await owner.post(`/api/purchasing/returns/${r1.id}/refuse`, { note: 'x' })).status, 409)
  const tomorrow = addDays(nowAt('Europe/London').date, 2)
  assert.equal((await owner.post(`/api/purchasing/returns/${r1.id}/credit`, { credit_note_number: 'CN-881', credit_note_date: tomorrow })).json.code, 'credit_note_date')
  // Credited leaves the stock out: the goods went back.
  assert.equal((await onHand())['Chicken thighs'].on_hand, 5000)
})

test('refused keeps the stock out; cancelled puts it back as it was', async () => {
  const cupsBefore = (await onHand())['Cups'].on_hand
  assert.equal((await owner.post(`/api/purchasing/returns/${r2.id}/refuse`, {})).status, 400, 'a refusal needs a note')
  const refused = await ok(operator.post(`/api/purchasing/returns/${r2.id}/refuse`, { note: 'They say the dates were fine' }))
  assert.deepEqual([refused.status, refused.refuse_note, refused.owed], ['refused', 'They say the dates were fine', false])
  assert.equal((await onHand())['Cups'].on_hand, cupsBefore, 'still out: the sleeve went back')

  const d = await returnsOf(porter, po.id)
  const r3 = await ok(porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: lineOf(d, 'Cups').id, qty: 2, reason: 'quality' }] }))
  assert.equal((await onHand())['Cups'].on_hand, cupsBefore - 100)
  const cancelled = await ok(porter.post(`/api/purchasing/returns/${r3.id}/cancel`, { note: 'Kept them after all' }))
  assert.deepEqual([cancelled.status, cancelled.cancel_note], ['cancelled', 'Kept them after all'])
  assert.equal((await onHand())['Cups'].on_hand, cupsBefore, 'back as it was')
  assert.ok(!(await ok(owner.get(`/api/stock/venues/${V}/items/${cups.id}/moves`))).moves.some(m => m.source?.id === r3.id), 'no move left')
  assert.equal(lineOf(await returnsOf(porter, po.id), 'Cups').left, 3, 'a cancelled return takes nothing back')
  assert.equal((await porter.post(`/api/purchasing/returns/${r3.id}/cancel`, {})).status, 409, 'once')
})

test('variance: the returns term reads the return moves; a count that matches the ledger leaves nothing unexplained', async () => {
  // A full count opening the period, then a return, then the closing full count finding what the ledger expects.
  const full = async lines => {
    const c = await ok(owner.post(`/api/stock/venues/${V}/counts`, { kind: 'full' }))
    for (const l of lines) await ok(owner.put(`/api/stock/counts/${c.id}/lines`, { item_id: l.item.id, area_id: null, entries: [{ qty: l.qty, unit: l.unit }] }))
    await ok(owner.post(`/api/stock/counts/${c.id}/submit`, { all_zero: true }))
    return ok(owner.post(`/api/stock/counts/${c.id}/approve`, {}))
  }
  await full([{ item: chicken, qty: 5, unit: 'kg' }, { item: cups, qty: 150, unit: 'each' }])
  const d = await returnsOf(porter, po.id)
  const r4 = await ok(porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: lineOf(d, 'Chicken thighs').id, qty: 1, reason: 'quality' }] }))
  const cur = await ok(owner.get(`/api/stock/venues/${V}/variance`))
  const open = cur.rows.find(r => r.item_id === chicken.id)
  assert.equal(open.returns, 5000, 'the period running since the full count: 5 kg went back')
  const closing = await full([{ item: chicken, qty: 0, unit: 'kg' }, { item: cups, qty: 150, unit: 'each' }])
  assert.equal(closing.periods_made.length, 1)
  const v = await ok(owner.get(`/api/stock/venues/${V}/variance?period=${closing.periods_made[0]}`))
  const c = v.rows.find(r => r.item_id === chicken.id)
  assert.deepEqual([c.opening, c.received, c.returns, c.closing], [5000, 0, 5000, 0])
  assert.equal(c.actual, 0, 'opening 5 kg - 5 kg returned - 0 counted: nothing was used')
  assert.equal(c.unexplained, 0, 'not loss: it went back')
  const ev = await ok(owner.get(`/api/stock/venues/${V}/variance/items/${chicken.id}?period=${closing.periods_made[0]}`))
  assert.ok(ev.evidence.some(e => e.kind === 'returned' && /went back to the supplier \(1 return\)/.test(e.text)), 'the evidence names the return')
  const stockOnly = await ok(viewer.get(`/api/stock/venues/${V}/variance?period=${closing.periods_made[0]}`))
  assert.equal(stockOnly.rows.find(r => r.item_id === chicken.id).returns_value, undefined, 'pounds need Costing view')
  // Cancelling it now (it is open) puts the 5 kg back after the closing count.
  await ok(porter.post(`/api/purchasing/returns/${r4.id}/cancel`, {}))
  assert.equal((await onHand())['Chicken thighs'].on_hand, 0, 'the closing count stands; the return\'s move is gone with it')
})

test('Today: a credit still owed 14 days after the goods went back, for an approver to chase (the time pinned)', async () => {
  const d = await returnsOf(porter, po.id)
  const r5 = await ok(porter.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: lineOf(d, 'Cups').id, qty: 1, reason: 'damaged' }] }))
  const none = await ok(operator.get(`/api/purchasing/returns?venue_id=${V}&overdue=1`))
  assert.equal(none.returns.length, 0, 'made just now: not overdue')
  // The goods went back (and the supplier was told) 15 days ago.
  await sql`UPDATE purchase_returns SET returned_at = now() - interval '15 days', created_at = now() - interval '15 days' WHERE id = ${r5.id}`
  await ok(operator.post(`/api/purchasing/returns/${r5.id}/mark-sent`, { via: 'phone', sent_at: new Date(Date.now() - 13 * 86400000).toISOString() }))
  const late = await ok(operator.get(`/api/purchasing/returns?venue_id=${V}&overdue=1`))
  assert.deepEqual(late.returns.map(r => r.id), [r5.id])
  assert.equal(late.returns[0].overdue, true)
  assert.equal(late.returns[0].days_waiting, 15)
  // As at a moment a day after it went back (the `at` pinned): not overdue then.
  const then = new Date(Date.now() - 14 * 86400000).toISOString()
  assert.equal((await ok(operator.get(`/api/purchasing/returns?venue_id=${V}&overdue=1&at=${encodeURIComponent(then)}`))).returns.length, 0)
  // A credited return isn't owed (r1, sent and credited).
  assert.ok(!(await ok(operator.get(`/api/purchasing/returns?venue_id=${V}&owed=1`))).returns.some(r => r.id === r1.id))

  const feed = await ok(operator.get(`/api/ops/today?venue_id=${V}`))
  const task = feed.tasks.find(t => t.key === 'credit:' + r5.id)
  assert.ok(task, 'on Today')
  assert.equal(task.kind, 'credit_overdue')
  assert.equal(task.group, 'late')
  assert.equal(task.title, 'Chase the credit note from Brakes')
  assert.match(task.detail, /^RT-\d{5} · returned .+ · waiting 15 days$/)
  assert.equal(task.can_act, true, 'recording the credit note is an approver\'s')
  assert.equal(task.action.path, '/purchasing?tab=returns&return=' + r5.id)
  const ownerTask = (await ok(owner.get(`/api/ops/today?venue_id=${V}`))).tasks.find(t => t.key === 'credit:' + r5.id)
  assert.match(ownerTask.detail, / · £3\.00 expected$/, 'the credit expected for someone who sees prices')
  const porterFeed = await ok(porter.get(`/api/ops/today?venue_id=${V}`))
  const porterTask = porterFeed.tasks.find(t => t.key === 'credit:' + r5.id)
  assert.ok(porterTask, 'the porter sees it')
  assert.equal(porterTask.can_act, false, 'but can\'t record a credit note')
  // Purchasing Use doesn't send orders or book deliveries in: those tasks stay Manage.
  for (const t of porterFeed.tasks.filter(x => ['po_to_send', 'delivery_due', 'delivery_not_booked'].includes(x.kind))) {
    assert.equal(t.can_act, false, t.kind)
    assert.equal(t.can_change, false, t.kind)
  }
  assert.ok(!(await ok(owner.get(`/api/ops/today?venue_id=${V}`))).tasks.some(t => t.key === 'credit:' + r1.id), 'a credited return isn\'t chased')
})

test('Pepper: start_return, confirmed first, by names; the damaged lines when none are named', async () => {
  const { getApp } = await import('./support/app.mjs')
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput, toolAllowed } = await import('../src/ai/tools/index.js')
  const { ACTION_LABELS } = await import('../../shared/pepperActions.js')
  const { objectsOfAction } = await import('../../shared/registry/index.js')
  const app = await getApp()
  const quiet = { info() {}, warn() {}, error() {}, debug() {} }
  const pepper = async (sub, input, { run = true } = {}) => {
    const ctx = makeContext({
      app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
      auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
    })
    const tool = audienceTools('staff').find(t => t.name === 'start_return')
    const parsed = parseInput(tool, input)
    const card = await tool.describe(ctx, parsed)
    return { tool, card, out: run ? await tool.run(ctx, parsed) : null }
  }
  // A new delivery with a damaged line.
  const po2 = await delivered()
  const { tool, card } = await pepper(PORTER, { supplier: 'brakes', venue: 'Ware' }, { run: false })
  assert.deepEqual([tool.class, tool.needs, tool.confirm], ['consequential', 'use', true])
  assert.equal(ACTION_LABELS.start_return, 'Returned goods to a supplier')
  assert.deepEqual(objectsOfAction('start_return').map(o => o.key), ['purchasing.returns'])
  assert.equal(toolAllowed(tool, { purchasing: 'use' }), true, 'listed for Purchasing Use')
  assert.equal(toolAllowed(tool, { purchasing: 'view' }), false)
  assert.equal(card.title, 'Return to Brakes?')
  assert.ok(card.lines.some(l => /^Chicken thighs: 3 x Case · 5 kg \(damaged, two cases crushed\)$/.test(l)), card.lines.join(' | '))
  assert.ok(!card.lines.some(l => /£/.test(l)), 'no money for the porter')
  assert.equal(JSON.stringify(card).includes(po2.id), false, 'no ids on the card')

  const named = await pepper(A.owner, { po: 'PO-' + String(po2.number).padStart(5, '0'), lines: [{ item: 'CP-50', packs: 1, reason: 'wrong_item', note: 'tall cups came' }], with_delivery: true })
  assert.ok(named.card.lines.includes('Credit expected £3.00 + VAT £0.60'), named.card.lines.join(' | '))
  assert.match(named.out.return, /^RT-\d{5}$/)
  assert.equal(named.out.page, '/purchasing?tab=returns')
  assert.equal(JSON.stringify(named.out).match(/[0-9a-f]{8}-[0-9a-f]{4}-/), null, 'names, never ids')
  const made = (await ok(owner.get(`/api/purchasing/returns?po_id=${po2.id}`))).returns[0]
  assert.equal(new Date(made.returned_at).getTime(), new Date(po2.received_at).getTime(), 'went back with the delivery')
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'start_return'`
  assert.equal(n, 1, 'audited')
  // View can't; a delivery not booked in can't.
  await assert.rejects(pepper(A.viewer, { supplier: 'Brakes', venue: 'Ware' }, { run: false }), /permission/)
})

test('another group\'s ids are refused: its delivery, its return, its lines and its supplier', async () => {
  const d = await returnsOf(owner, po.id)
  const ch = lineOf(d, 'Chicken thighs')
  // B can't see or act on A's delivery or returns.
  assert.equal((await bOwner.get(`/api/purchasing/pos/${po.id}/returns`)).status, 404)
  assert.equal((await bOwner.post(`/api/purchasing/pos/${po.id}/returns`, { lines: [{ po_line_id: ch.id, qty: 1, reason: 'damaged' }] })).status, 404)
  for (const path of ['', '/file']) assert.equal((await bOwner.get(`/api/purchasing/returns/${r1.id}${path}`)).status, 404, path || 'one')
  for (const [path, body] of [['send', {}], ['mark-sent', { via: 'driver' }], ['credit', { credit_note_number: 'X' }], ['refuse', { note: 'x' }], ['cancel', {}]]) {
    assert.equal((await bOwner.post(`/api/purchasing/returns/${r2.id}/${path}`, body)).status, 404, path)
  }
  // B's own delivery with A's line: not on that delivery.
  const mixed = await bOwner.post(`/api/purchasing/pos/${poB.id}/returns`, { lines: [{ po_line_id: ch.id, qty: 1, reason: 'damaged' }] })
  assert.equal(mixed.status, 422)
  assert.equal(mixed.json.code, 'lines')
  // A's venue as a filter is refused (another group's venue); its supplier or delivery finds nothing of A's.
  assert.equal((await bOwner.get(`/api/purchasing/returns?venue_id=${V}`)).status, 404)
  for (const q of [`supplier_id=${sup.id}`, `po_id=${po.id}`]) {
    assert.deepEqual((await ok(bOwner.get(`/api/purchasing/returns?${q}`))).returns, [], q)
  }
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM purchase_returns WHERE tenant_id = ${ids.b}`
  assert.equal(n, 0, 'B made nothing')
  // B's own return works on B's own delivery.
  const bd = await returnsOf(bOwner, poB.id)
  const mine = await ok(bOwner.post(`/api/purchasing/pos/${poB.id}/returns`, { lines: [{ po_line_id: bd.lines[0].id, qty: 1, reason: 'quality' }] }))
  assert.equal(mine.label, 'RT-00001', 'each group numbers its own')
  assert.equal((await owner.get(`/api/purchasing/returns/${mine.id}`)).status, 404, 'and A can\'t see it')
})

test('the report subject Returns to suppliers and the starter Credits still owed', async () => {
  const { STARTERS } = await import('../src/reports/starters/index.js')
  const { runner, rowsOf } = await import('./support/reports.mjs')
  const run = runner(ids.a)
  const starter = STARTERS.find(s => s.key === 'purchasing_credits_owed')
  assert.ok(starter)
  assert.equal(starter.spec.params.some(x => x.type === 'period'), false, 'owed whenever the goods went back')
  const res = await run(starter.spec, {})
  const brakes = rowsOf(res).find(r => r['supplier.name'] === 'Brakes')
  assert.ok(brakes, JSON.stringify(rowsOf(res)))
  const owed = (await ok(owner.get('/api/purchasing/returns?owed=1'))).returns.filter(r => r.supplier_name === 'Brakes')
  assert.equal(brakes.owed_count, owed.length, 'the returns still owed')
  assert.equal(brakes.overdue_count, owed.filter(r => r.overdue).length)
  assert.equal(Math.round(Number(brakes.credit_owed) * 100), Math.round(owed.reduce((s, r) => s + r.credit_expected, 0) * 100), 'the credit expected on them')
  // A role with Purchasing only runs it: the counts, the money left out and said.
  const counts = await run(starter.spec, {}, { levels: { purchasing: 'view' } })
  assert.deepEqual(counts.columns.filter(c => c.role === 'value').map(c => c.key), ['owed_count', 'overdue_count'])
  assert.deepEqual(counts.meta.notes, ['Credit still owed is left out: your role can\'t see it'])
  // The lines: what went back and why, cancelled returns left out of the figures.
  const lines = rowsOf(await run({ version: 1, subject: 'purchasing.return_lines', rows: ['reason'], values: [{ measure: 'lines' }, { measure: 'packs' }] }, {}))
  const damaged = lines.find(r => r.reason === 'damaged')
  assert.ok(damaged && damaged.lines >= 2, JSON.stringify(lines))
  // Another group sees none of it.
  const theirs = await runner(ids.b)(starter.spec, {})
  assert.equal(rowsOf(theirs).some(r => r['supplier.name'] === 'Brakes'), false)
})
