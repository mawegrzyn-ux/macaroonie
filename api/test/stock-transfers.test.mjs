// Stock phase 4b, transfers (inventory, migration 309, 27 Nov 2026): stock
// sent between two venues of the group in two steps, sent (out of the sender)
// and received (in at the receiver, quantities that can differ: what didn't
// arrive stays as lost in transit at the sender), or cancelled (back at the
// sender, after a count there in between too); valued at the sender's
// average then; on hand and the ledger at both venues; Today's transfer to
// receive; the venue a person is held to on a shared device; cross-tenant ids
// refused (venue, item, transfer, line); View / Use / Manage.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, ok, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')

let ids, owner, admin, operator, viewer, bOwner, soho, leeds, VB, chicken, onion, bItem
const byName = rows => Object.fromEntries(rows.map(r => [r.name, r]))
const onHand = async (venueId, api = owner) => byName((await ok(api.get('/api/stock/venues/' + venueId))).items)
const lineOf = (t, name) => t.lines.find(l => l.name === name)

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  bOwner = as(B.owner, ids.b)
  soho = (await ok(owner.post('/api/venues', { name: 'Soho', slug: 'soho-tr', timezone: 'Europe/London', currency: 'GBP' }))).id
  leeds = (await ok(owner.post('/api/venues', { name: 'Leeds', slug: 'leeds-tr', timezone: 'Europe/London', currency: 'GBP' }))).id
  VB = (await ok(bOwner.post('/api/venues', { name: 'Away', slug: 'away-tr', timezone: 'Europe/London' }))).id
  await ok(owner.put('/api/purchasing/settings', { receive_without_order: 'anyone' }))
  const sup = await ok(owner.post('/api/suppliers', { name: 'Poultry Co', send_method: 'print' }))
  chicken = await ok(owner.post('/api/inventory/items', { name: 'Chicken thighs', base_unit: 'g' }))
  await ok(owner.post(`/api/inventory/items/${chicken.id}/units`, { name: 'tray', base_qty: 2500 }))
  const cq = (await ok(owner.post(`/api/inventory/items/${chicken.id}/quotes`, { supplier_id: sup.id, pack_name: 'Case', pack_count: 4, pack_qty: 2.5, pack_unit: 'kg', price: 40 }))).quotes[0]
  onion = await ok(owner.post('/api/inventory/items', { name: 'Onions', base_unit: 'g' }))
  // Soho paid £40 a case of chicken (£0.004 a gram); Leeds bought none.
  await ok(owner.post(`/api/purchasing/venues/${soho}/deliveries`, {
    supplier_id: sup.id, lines: [{ item_id: chicken.id, quote_id: cq.id, received_qty: 2 }],
    check: { packaging_ok: true, damage_ok: true, quality_ok: true, accepted: true },
  }))
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, { lines: [{ item_id: chicken.id, qty: 20, unit: 'kg' }, { item_id: onion.id, qty: 10, unit: 'kg' }] }))
  await ok(owner.post(`/api/stock/venues/${leeds}/counts`, { lines: [{ item_id: chicken.id, qty: 5, unit: 'kg' }, { item_id: onion.id, qty: 1, unit: 'kg' }] }))
  bItem = await ok(bOwner.post('/api/inventory/items', { name: 'B flour', base_unit: 'g' }))
})
test.after(async () => { await closeApp() })

test('the shared rule: a line\'s moves when sent, received with a difference, and cancelled', async () => {
  const { transferLineMoves, lostInTransit, stockOnHand } = await import('../../shared/stock.js')
  const t = { id: 't', number: 3, from_venue_id: 'S', to_venue_id: 'L', sent_at: '2026-11-20T10:00:00Z', received_at: '2026-11-20T15:00:00Z', cancelled_at: '2026-11-21T09:00:00Z', to_name: 'Leeds', from_name: 'Soho' }
  const line = { item_id: 'i', qty_base: 1000, received_base: 900, cost_per_base: 0.004 }
  assert.deepEqual(transferLineMoves({ ...t, status: 'sent' }, line).map(m => [m.venue_id, m.kind, m.qty_base]), [['S', 'transfer_out', -1000]])
  const got = transferLineMoves({ ...t, status: 'received' }, line)
  assert.deepEqual(got.map(m => [m.venue_id, m.kind, m.qty_base, m.at]), [
    ['S', 'transfer_out', -900, t.sent_at], ['S', 'lost_in_transit', -100, t.sent_at], ['L', 'transfer_in', 900, t.received_at],
  ])
  assert.deepEqual(transferLineMoves({ ...t, status: 'cancelled' }, line).map(m => [m.kind, m.qty_base, m.at]), [['transfer_out', -1000, t.sent_at], ['transfer_in', 1000, t.cancelled_at]])
  assert.equal(lostInTransit(1000, 1200), 0, 'more arriving is the receiver\'s gain, not a negative loss')
  // A count at the sender between sending and receiving keeps its figure once it is received.
  const count = { kind: 'count', qty_base: 4000, at: '2026-11-20T12:00:00Z' }
  assert.equal(stockOnHand({ moves: [{ kind: 'count', qty_base: 5000, at: '2026-11-19T10:00:00Z' }, ...got.filter(m => m.venue_id === 'S'), count] }).on_hand, 4000)
})

test('sent, then received with a difference: on hand and the ledger at both venues; valued at the sender\'s average', async () => {
  const t = await ok(operator.post(`/api/stock/venues/${soho}/transfers`, {
    to_venue_id: leeds, note: 'For the weekend', lines: [{ item_id: chicken.id, qty: 3, unit: 'tray' }, { item_id: onion.id, qty: 2, unit: 'kg' }],
  }))
  assert.deepEqual([t.status, t.from_name, t.to_name, t.label.startsWith('Transfer '), t.sent_by], ['sent', 'Soho', 'Leeds', true, 'a-operator@test.local'])
  assert.equal(lineOf(t, 'Chicken thighs').qty_base, 7500)
  assert.equal('value' in t, false, 'an operator has no Costing view')
  const seen = await ok(owner.get('/api/stock/transfers/' + t.id))
  assert.equal(lineOf(seen, 'Chicken thighs').value, 30, '7.5 kg at Soho\'s £0.004 a gram')
  assert.ok(lineOf(seen, 'Chicken thighs').units.some(u => u.key === 'tray'), 'the units to receive it in')
  // In transit: gone from Soho, not yet at Leeds.
  assert.equal((await onHand(soho))['Chicken thighs'].on_hand, 12500)
  assert.equal((await onHand(leeds))['Chicken thighs'].on_hand, 5000)
  const lists = await ok(owner.get(`/api/stock/venues/${leeds}/transfers`))
  assert.deepEqual(lists.incoming.map(x => x.id), [t.id])
  assert.equal(lists.incoming[0].can_receive, true)
  assert.deepEqual((await ok(owner.get(`/api/stock/venues/${soho}/transfers`))).outgoing.map(x => x.id), [t.id])
  // Today at Leeds: a transfer to receive.
  const { today } = await ok(owner.get(`/api/stock/venues/${leeds}/waste/pickers`))
  const tasks = await ok(owner.get(`/api/stock/venues/${leeds}/today?date=${today}`))
  assert.deepEqual(tasks.incoming.map(x => [x.id, x.from_name, x.lines]), [[t.id, 'Soho', 2]])
  // Received: 7 kg of the chicken arrived, all the onions. Every line once.
  assert.equal((await operator.post(`/api/stock/transfers/${t.id}/receive`, { lines: [{ line_id: lineOf(t, 'Chicken thighs').id, qty: 7, unit: 'kg' }] })).status, 422)
  assert.equal((await viewer.post(`/api/stock/transfers/${t.id}/receive`, { lines: [] })).status, 403)
  const got = await ok(operator.post(`/api/stock/transfers/${t.id}/receive`, {
    lines: [{ line_id: lineOf(t, 'Chicken thighs').id, qty: 7, unit: 'kg' }, { line_id: lineOf(t, 'Onions').id, qty: 2000, unit: 'g' }],
    note: 'One tray short',
  }))
  assert.deepEqual([got.status, got.lost, lineOf(got, 'Chicken thighs').received_base, lineOf(got, 'Chicken thighs').lost_base, lineOf(got, 'Onions').lost_base], ['received', true, 7000, 500, 0])
  assert.equal((await operator.post(`/api/stock/transfers/${t.id}/receive`, { lines: [{ line_id: lineOf(t, 'Onions').id, qty: 1 }] })).status, 409, 'once')
  assert.equal((await operator.post(`/api/stock/transfers/${t.id}/cancel`, {})).status, 409, 'a received one isn\'t cancelled')
  // Soho lost all 7.5 kg (7 kg sent on, 500 g lost in transit); Leeds gained what arrived.
  assert.equal((await onHand(soho))['Chicken thighs'].on_hand, 12500)
  assert.equal((await onHand(leeds))['Chicken thighs'].on_hand, 12000)
  assert.equal((await onHand(leeds)).Onions.on_hand, 3000)
  const sLed = await ok(owner.get(`/api/stock/venues/${soho}/items/${chicken.id}/moves`))
  const kinds = sLed.moves.filter(m => m.source.type === 'transfer').map(m => [m.kind, m.change, m.value])
  assert.deepEqual(kinds.sort(), [['lost_in_transit', -500, -2], ['transfer_out', -7000, -28]].sort())
  const lLed = await ok(owner.get(`/api/stock/venues/${leeds}/items/${chicken.id}/moves`))
  assert.deepEqual(lLed.moves.filter(m => m.source.type === 'transfer').map(m => [m.kind, m.change, m.value]), [['transfer_in', 7000, 28]], 'valued at the sender\'s cost')
  const owned = await ok(owner.get('/api/stock/transfers/' + t.id))
  assert.equal(owned.lost_value, 2)
  // Today at Leeds is clear.
  assert.deepEqual((await ok(owner.get(`/api/stock/venues/${leeds}/today?date=${today}`))).incoming, [])
})

test('cancelled: the stock comes back to the sender, after a count there in between too', async () => {
  const t = await ok(operator.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: chicken.id, qty: 1, unit: 'kg' }))
  assert.equal((await onHand(soho))['Chicken thighs'].on_hand, 11500)
  // Soho counts while it is in transit: 11.5 kg on the shelf.
  await ok(owner.post(`/api/stock/venues/${soho}/counts`, { lines: [{ item_id: chicken.id, qty: 11.5, unit: 'kg' }] }))
  assert.equal((await viewer.post(`/api/stock/transfers/${t.id}/cancel`, {})).status, 403)
  const back = await ok(operator.post(`/api/stock/transfers/${t.id}/cancel`, {}))
  assert.equal(back.status, 'cancelled')
  assert.equal((await operator.post(`/api/stock/transfers/${t.id}/cancel`, {})).status, 409, 'once')
  assert.equal((await operator.post(`/api/stock/transfers/${t.id}/receive`, { lines: [{ line_id: t.lines[0].id, qty: 1, unit: 'kg' }] })).status, 409)
  assert.equal((await onHand(soho))['Chicken thighs'].on_hand, 12500, 'back on top of the count')
  assert.equal((await onHand(leeds))['Chicken thighs'].on_hand, 12000, 'Leeds never had it')
  const led = await ok(owner.get(`/api/stock/venues/${soho}/items/${chicken.id}/moves`))
  const mine = led.moves.filter(m => m.source.id === t.id)
  assert.deepEqual(mine.map(m => m.kind).sort(), ['transfer_in', 'transfer_out'])
  assert.equal((await ok(owner.get(`/api/stock/venues/${soho}/transfers`))).history.find(x => x.id === t.id).status, 'cancelled')
})

test('refused: to the same venue, nothing sent, an item twice, a unit with no size', async () => {
  const send = body => operator.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, ...body })
  assert.equal((await operator.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: soho, item_id: chicken.id, qty: 1, unit: 'kg' })).status, 422)
  assert.equal((await send({})).status, 422)
  assert.equal((await send({ lines: [{ item_id: chicken.id, qty: 1, unit: 'kg' }, { item_id: chicken.id, qty: 2, unit: 'kg' }] })).status, 422)
  const bad = await send({ item_id: chicken.id, qty: 1, unit: 'slice' })
  assert.equal(bad.status, 422)
  assert.match(bad.body, /no size for a slice/)
  assert.equal((await viewer.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: chicken.id, qty: 1, unit: 'kg' })).status, 403, 'View can\'t send')
  assert.equal((await ok(viewer.get(`/api/stock/venues/${soho}/transfers`))).can_send, false)
})

test('on a shared device a person acts only at its venue: sends from it, receives at it', async () => {
  const { DEVICE_HEADER, ACT_HEADER } = await import('../src/middleware/sharedDevice.js')
  await ok(admin.put('/api/shared-devices/my-pin', { pin: '5928' }))
  const device = await ok(owner.post('/api/shared-devices', { venue_id: leeds, name: 'Leeds kitchen tablet' }))
  const [adminRow] = await sql`SELECT id, email FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  const on = act => ({ [DEVICE_HEADER]: device.token, ...(act ? { [ACT_HEADER]: act } : {}) })
  const asAdmin = on((await ok(owner.post('/api/shared-devices/act', { person: 'user:' + adminRow.id, pin: '5928' }, on()))).token)
  try {
    const out = await owner.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: onion.id, qty: 1, unit: 'kg' }, asAdmin)
    assert.equal(out.status, 403, 'the Leeds tablet doesn\'t send from Soho')
    assert.match(out.body, /Leeds/)
    // Soho sends (signed in as themselves); the Leeds tablet receives it, as the admin.
    const t = await ok(operator.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: onion.id, qty: 1, unit: 'kg' }))
    assert.equal((await owner.post(`/api/stock/transfers/${t.id}/cancel`, {}, asAdmin)).status, 403, 'nor cancels Soho\'s transfer')
    const got = await ok(owner.post(`/api/stock/transfers/${t.id}/receive`, { lines: [{ line_id: t.lines[0].id, qty: 1, unit: 'kg' }] }, asAdmin))
    assert.equal(got.received_by, adminRow.email, 'the person who switched in')
    // From Leeds' tablet, sending from Leeds is fine.
    const back = await ok(owner.post(`/api/stock/venues/${leeds}/transfers`, { to_venue_id: soho, item_id: onion.id, qty: 500, unit: 'g' }, asAdmin))
    assert.equal(back.sent_by, adminRow.email)
    await ok(operator.post(`/api/stock/transfers/${back.id}/receive`, { lines: [{ line_id: back.lines[0].id, qty: 500, unit: 'g' }] }))
  } finally {
    await ok(owner.delete('/api/shared-devices/' + device.device.id))
  }
})

test('another group\'s venue, item, transfer and line are refused', async () => {
  assert.equal((await owner.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: VB, item_id: chicken.id, qty: 1, unit: 'kg' })).status, 404, 'to their venue')
  assert.equal((await owner.post(`/api/stock/venues/${VB}/transfers`, { to_venue_id: soho, item_id: chicken.id, qty: 1, unit: 'kg' })).status, 404, 'from their venue')
  assert.equal((await owner.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: bItem.id, qty: 1, unit: 'kg' })).status, 404, 'their item')
  const bLeeds = (await ok(bOwner.post('/api/venues', { name: 'Away 2', slug: 'away-tr-2', timezone: 'Europe/London' }))).id
  const theirs = await ok(bOwner.post(`/api/stock/venues/${VB}/transfers`, { to_venue_id: bLeeds, item_id: bItem.id, qty: 100, unit: 'g' }))
  assert.equal((await owner.get('/api/stock/transfers/' + theirs.id)).status, 404)
  assert.equal((await owner.post(`/api/stock/transfers/${theirs.id}/receive`, { lines: [{ line_id: theirs.lines[0].id, qty: 1 }] })).status, 404)
  assert.equal((await owner.post(`/api/stock/transfers/${theirs.id}/cancel`, {})).status, 404)
  // Their line on our transfer is no line of it.
  const mine = await ok(owner.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: chicken.id, qty: 1, unit: 'kg' }))
  assert.equal((await owner.post(`/api/stock/transfers/${mine.id}/receive`, { lines: [{ line_id: theirs.lines[0].id, qty: 1, unit: 'kg' }] })).status, 422)
  await ok(owner.post(`/api/stock/transfers/${mine.id}/cancel`, {}))
  assert.equal((await owner.get(`/api/stock/venues/${VB}/transfers`)).status, 404)
  assert.equal(JSON.stringify(await ok(owner.get(`/api/stock/venues/${soho}/transfers`))).includes('B flour'), false)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM stock_transfer_lines WHERE tenant_id = ${ids.b}`
  assert.equal(n, 1, 'their transfer untouched')
})

// ── Pepper, Today and reports ──

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
async function pepper(sub, name, input, { run = true } = {}) {
  const { getApp } = await import('./support/app.mjs')
  const { makeContext } = await import('../src/ai/context.js')
  const { audienceTools, parseInput } = await import('../src/ai/tools/index.js')
  const app = await getApp()
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId: ids.a, log: quiet,
    auth: { authorization: 'Bearer test:' + sub }, principal: { sub, email: sub + '@test.local' }, actor: sub + '@test.local',
  })
  const tool = audienceTools('staff').find(t => t.name === name)
  assert.ok(tool, name)
  const parsed = parseInput(tool, input)
  const card = tool.describe ? await tool.describe(ctx, parsed) : null
  return { tool, card, out: run ? await tool.run(ctx, parsed) : null }
}

test('Pepper: send_transfer and receive_transfer, each confirmed first; what isn\'t said arrived as sent; Today\'s task', async () => {
  const send = await pepper(A.operator, 'send_transfer', { from: 'Soho', to: 'Leeds', items: [{ item: 'chicken thighs', qty: 2, unit: 'tray' }, { item: 'onions', qty: 1, unit: 'kg' }] }, { run: false })
  assert.deepEqual([send.tool.class, send.tool.needs], ['consequential', 'use'])
  assert.equal(send.card.title, 'Send 2 items from Soho to Leeds?')
  assert.match(send.card.lines[0], /^Chicken thighs: 2 tray \(2\.5 kg\) = 5 kg/)
  const sent = await pepper(A.operator, 'send_transfer', { from: 'Soho', to: 'Leeds', items: [{ item: 'chicken thighs', qty: 2, unit: 'tray' }, { item: 'onions', qty: 1, unit: 'kg' }] })
  assert.match(sent.out.message, /on its way to Leeds/)
  // Today at Leeds: a transfer to receive, for whoever may.
  const feed = await ok(operator.get('/api/ops/today?venue_id=' + leeds))
  const task = feed.tasks.find(t => t.kind === 'stock_transfer_to_receive')
  assert.ok(task, JSON.stringify(feed.tasks.map(t => t.kind)))
  assert.match(task.title, /from Soho/)
  assert.match(task.action.path, /tab=transfers/)
  assert.equal((await ok(viewer.get('/api/ops/today?venue_id=' + leeds))).tasks.some(t => t.kind === 'stock_transfer_to_receive'), false, 'View can\'t receive')
  // Received: the chicken a little short, the onions not said (as sent).
  const card = await pepper(A.operator, 'receive_transfer', { venue: 'Leeds', items: [{ item: 'chicken', qty: 4.8, unit: 'kg' }] }, { run: false })
  assert.match(card.card.title, /^Receive Transfer \d+ from Soho at Leeds\?$/)
  assert.ok(card.card.lines.some(l => /Onions: sent 1 kg, arrived 1 kg \(as sent\)/.test(l)), card.card.lines.join(' | '))
  assert.match(card.card.warnings[0], /Chicken thighs: 200 g short/)
  const got = await pepper(A.operator, 'receive_transfer', { venue: 'Leeds', items: [{ item: 'chicken', qty: 4.8, unit: 'kg' }] })
  assert.match(got.out.message, /lost in transit/)
  assert.doesNotMatch(JSON.stringify(got.out), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'names, never ids')
  await assert.rejects(pepper(A.operator, 'receive_transfer', { venue: 'Leeds' }), /Nothing is on its way/)
  await assert.rejects(pepper(A.viewer, 'send_transfer', { from: 'Soho', to: 'Leeds', items: [{ item: 'onions', qty: 1 }] }), /permission/)
  await assert.rejects(pepper(A.owner, 'send_transfer', { from: 'Soho', to: 'Soho', items: [{ item: 'onions', qty: 1 }] }), /another venue/)
})

test('the report subject Stock transfers: each end of each line, lost in transit; the starter Transfers in transit', async () => {
  const open = await ok(operator.post(`/api/stock/venues/${soho}/transfers`, { to_venue_id: leeds, item_id: onion.id, qty: 750, unit: 'g' }))
  const period = { params: [{ key: 'period', type: 'period', default: { relative: 'this_year' } }], filters: [{ field: 'date', op: 'in_period', param: 'period' }] }
  const rows = await ok(owner.post('/api/reports/preview', { spec: { kind: 'list', subject: 'stock.transfers', rows: ['number', 'direction', 'venue.name', 'other_venue.name', 'item_name', 'sent', 'received', 'lost', 'status', 'lost_value'], ...period } }))
  const chicken = rows.rows.filter(r => r.cells[4] === 'Chicken thighs' && r.cells[7] === 500)
  assert.equal(chicken.length, 2, 'the first transfer\'s chicken at each end, 500 g lost')
  assert.ok(chicken.some(r => r.cells[2] === 'Soho' && r.cells[3] === 'Leeds' && r.cells[9] === 2))
  const lost = await ok(owner.post('/api/reports/preview', { spec: { subject: 'stock.transfers', rows: ['item_name'], values: [{ measure: 'lost_qty' }, { measure: 'transfers' }], ...period } }))
  assert.ok(lost.rows.some(r => r.cells[0] === 'Chicken thighs' && r.cells[1] >= 500))
  const transit = await ok(owner.post('/api/reports/starter:stock_transfers_in_transit/run', {}))
  assert.deepEqual(transit.rows.map(r => r.cells[0]), [open.number], 'only the one on its way, once')
  await ok(operator.post(`/api/stock/transfers/${open.id}/cancel`, {}))
})
