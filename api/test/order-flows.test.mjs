// Order flows (migration 235, shared/pos/orderFlows.js) through the real
// routes and the cloud's sequencer: Store tech saves flows naming only the
// company's own dishes, sections, order types, charges, locations and tills;
// the ones switched on reach the tills of the locations they run at (and the
// sequencer and the venue hub, in the venue's settings); and the sequencer
// judges what a flow put on a check as the till does.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { withTenant } from '../src/config/db.js'
import { sequencerContext } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'
import { chargeFromList } from '../../shared/pos/charges.js'
import { addKey, FLOWS_MAX } from '../../shared/pos/orderFlows.js'

let ids, owner, viewer, other, V, V2, till, till2, dish, dish2, section, eatIn, theirs, serverId, bossId, stream

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: `Device ${d.device_id}.${d.secret}`,
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: serverId, ...extra })
async function send(events) {
  const r = await device(till, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  return r.json.results
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const theirsFilled = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  section = menu.sections[0]
  dish = { ...section.items[0], section_id: section.id }
  dish2 = { ...(section.items[1] || menu.sections[1].items[0]) }
  const theirMenu = await ok(other.get('/api/menus/' + theirsFilled.ids.menu))
  const theirTypes = await ok(other.get('/api/order-types'))
  const theirCharges = await ok(other.get('/api/pos/charges'))
  const theirTill = await linkDevice(other, theirsFilled.ids.venue, { kind: 'terminal', name: 'Yyc Till' })
  theirs = {
    venue: theirsFilled.ids.venue, item: theirMenu.sections[0].items[0].id, section: theirMenu.sections[0].id,
    type: theirTypes[0].id, charge: theirCharges[0].id, till: theirTill.device_id,
  }
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqc Front till' })
  till2 = await linkDevice(owner, V2, { kind: 'terminal', name: 'Zqc Hertford till' })
  eatIn = (await ok(owner.get('/api/order-types'))).find(t => t.name === 'Eat in')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  stream = setup.revenue_streams.find(r => r.is_active)
  // A server, and a manager to approve.
  const server = await ok(owner.post('/api/pos/roles', { name: 'Zqc Server', permissions: {} }))
  const boss = await ok(owner.post('/api/pos/roles', { name: 'Zqc Boss', permissions: { manager: true } }))
  serverId = filled.ids.staff
  bossId = filled.ids.staff2
  await ok(owner.put(`/api/pos/venues/${V}/staff/${serverId}/pos`, { pos_role_id: server.id, pin: '2468' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${bossId}/pos`, { pos_role_id: boss.id, pin: '1357' }))
})
after(closeApp)

const flowBody = (f, changes = {}) => ({
  name: f.name, on: f.on, kind: f.kind, trigger: f.trigger, venue_ids: f.venue_ids, device_ids: f.device_ids, apps: f.apps,
  match: f.match, ask: f.ask, adds: f.adds, ...changes,
})

test('a flow is made switched off, saved with only the company\'s own ids, and switched on once it can run', async () => {
  const made = await ok(owner.post('/api/pos/order-flows', { name: ' Zqc Add a drink ', kind: 'ask' }))
  assert.equal(made.name, 'Zqc Add a drink')
  assert.deepEqual([made.kind, made.trigger, made.on, made.venue_ids, made.device_ids], ['ask', 'dish_added', false, null, null])
  assert.equal(made.ask.title, '')
  assert.deepEqual(made.problems.map(p => p.code), ['ask_title', 'ask_choices'])
  // Switched on while it can't run: refused with its problems.
  const cant = await owner.put('/api/pos/order-flows/' + made.id, flowBody(made, { on: true }))
  assert.equal(cant.status, 422)
  assert.equal(cant.json.code, 'flow')
  assert.deepEqual(cant.json.problems.map(p => p.code), ['ask_title', 'ask_choices'])
  assert.equal((await owner.patch('/api/pos/order-flows/' + made.id, { on: true })).status, 422)
  // Switched off, a half-done flow saves.
  const half = await ok(owner.put('/api/pos/order-flows/' + made.id, flowBody(made, { trigger: 'checkout', match: { ...made.match, type_ids: [eatIn.id] } })))
  assert.deepEqual([half.trigger, half.on, half.match.type_ids], ['checkout', false, [eatIn.id]])
  // Another group's dishes, sections, order types, charges and tills are dropped.
  const saved = await ok(owner.put('/api/pos/order-flows/' + made.id, flowBody(half, {
    on: true, trigger: 'dish_added',
    device_ids: [till.device_id, theirs.till],
    match: {
      stream_names: ['  zqc   bar  ', 'Zqc Bar', 'Delivery'], type_ids: [eatIn.id, theirs.type],
      item_ids: [dish.id, theirs.item, dish.id], section_ids: [section.id, theirs.section],
      not_item_ids: [theirs.item], not_section_ids: [],
    },
    ask: { title: 'Add a drink?', message: 'Our lemonade is made here', item_ids: [dish2.id, theirs.item], pick: 'several', every_time: true, skip_if_has: false },
  })))
  assert.equal(saved.on, true)
  assert.deepEqual(saved.device_ids, [till.device_id])
  assert.deepEqual(saved.match, {
    stream_names: ['zqc bar', 'Delivery'], type_ids: [eatIn.id], item_ids: [dish.id], section_ids: [section.id],
    not_item_ids: [], not_section_ids: [],
  })
  assert.deepEqual(saved.ask, { title: 'Add a drink?', message: 'Our lemonade is made here', item_ids: [dish2.id], pick: 'several', every_time: true, skip_if_has: false })
  assert.deepEqual(saved.problems, [])
  // In words, with the names.
  assert.match(saved.summary, /^When a dish is added, if the channel is zqc bar or Delivery and the order type is Eat in and the dish added is /)
  assert.match(saved.where, /^Every location · Zqc Front till$/)
  // A channel no location has, and stored as it was saved.
  assert.ok(saved.warnings.some(w => w.code === 'no_channel' && /Delivery/.test(w.message)), JSON.stringify(saved.warnings))
  const [row] = await sql`SELECT name, is_active, flow FROM pos_order_flows WHERE id = ${made.id}`
  assert.equal(row.is_active, true)
  assert.equal(row.flow.ask.item_ids.length, 1)
  assert.equal(row.flow.id, undefined, 'the id, name and on switch are columns')
  // Another group's location: refused outright (every route refuses another tenant's venue ids).
  assert.equal((await owner.put('/api/pos/order-flows/' + made.id, flowBody(saved, { venue_ids: [theirs.venue] }))).status, 404)
  // A till at a location it doesn't run at: a warning.
  const placed = await ok(owner.put('/api/pos/order-flows/' + made.id, flowBody(saved, { venue_ids: [V], device_ids: [till.device_id, till2.device_id] })))
  assert.ok(placed.warnings.some(w => w.code === 'tills_elsewhere'), JSON.stringify(placed.warnings))
  assert.equal(placed.where, 'Zqx Ware · Zqc Front till and Zqc Hertford till')
  // Switched off and on.
  assert.equal((await ok(owner.patch('/api/pos/order-flows/' + made.id, { on: false }))).on, false)
  assert.equal((await ok(owner.patch('/api/pos/order-flows/' + made.id, { on: true }))).on, true)
  // Bad bodies.
  assert.equal((await owner.put('/api/pos/order-flows/' + made.id, flowBody(saved, { name: '' }))).status, 400)
  assert.equal((await owner.post('/api/pos/order-flows', { name: 'x', kind: 'maybe' })).status, 400)
  assert.equal((await owner.put('/api/pos/order-flows/not-an-id', flowBody(saved))).status, 400)
})

test('copies, the list\'s order, deleting; who may', async () => {
  const add = await ok(owner.post('/api/pos/order-flows', { name: 'Zqc Bag charge', kind: 'add' }))
  assert.deepEqual([add.kind, add.trigger, add.adds, add.ask], ['add', 'match', [], null])
  assert.deepEqual(add.problems.map(p => p.code), ['adds'])
  const charges = await ok(owner.get('/api/pos/charges'))
  const set = await ok(owner.put('/api/pos/order-flows/' + add.id, flowBody(add, {
    on: true,
    adds: [
      { kind: 'dish', item_id: dish.id, qty: 50, removable: false }, { kind: 'dish', item_id: theirs.item, qty: 1 },
      { kind: 'charge', charge_id: charges[0].id }, { kind: 'charge', charge_id: theirs.charge }, { kind: 'dish', item_id: dish.id, qty: 2 },
    ],
  })))
  assert.deepEqual(set.adds, [
    { kind: 'dish', item_id: dish.id, qty: 20, removable: false },
    { kind: 'charge', charge_id: charges[0].id, removable: true },
  ])
  assert.ok(set.warnings.some(w => w.code === 'every_order'))
  // A copy has the same settings, its own id, and starts switched off.
  const copy = await ok(owner.post('/api/pos/order-flows', { name: 'Zqc Bag charge (copy)', copy_from: add.id }))
  assert.notEqual(copy.id, add.id)
  assert.deepEqual([copy.on, copy.adds], [false, set.adds])
  assert.equal((await owner.post('/api/pos/order-flows', { name: 'Theirs', copy_from: (await ok(other.post('/api/pos/order-flows', { name: 'Yyc flow' }))).id })).status, 404)
  // The list's order is the order flows act in.
  const all = await ok(owner.get('/api/pos/order-flows'))
  assert.equal(all.max, FLOWS_MAX)
  const order = [copy.id, ...all.flows.map(f => f.id).filter(id => id !== copy.id)]
  await ok(owner.put('/api/pos/order-flows/order', { ids: order }))
  assert.deepEqual((await ok(owner.get('/api/pos/order-flows'))).flows.map(f => f.id), order)
  // Another group neither sees nor changes them; View can't, nor Store tech none.
  assert.ok(!(await ok(other.get('/api/pos/order-flows'))).flows.some(f => f.id === add.id))
  for (const r of [
    other.get('/api/pos/order-flows/' + add.id), other.put('/api/pos/order-flows/' + add.id, flowBody(set)),
    other.patch('/api/pos/order-flows/' + add.id, { on: false }), other.delete('/api/pos/order-flows/' + add.id),
  ]) assert.equal((await r).status, 404)
  await ok(other.put('/api/pos/order-flows/order', { ids: [add.id] }))
  assert.equal((await ok(owner.get('/api/pos/order-flows/' + add.id))).sort_order, order.indexOf(add.id), 'another group\'s order leaves it')
  assert.equal((await viewer.get('/api/pos/order-flows')).status, 403)
  assert.equal((await viewer.post('/api/pos/order-flows', { name: 'View' })).status, 403)
  // Deleted.
  await ok(owner.delete('/api/pos/order-flows/' + copy.id))
  assert.equal((await owner.get('/api/pos/order-flows/' + copy.id)).status, 404)
})

test('the catalogue: dishes by menu and section, channels by name across locations, order types, charges, places', async () => {
  await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqc Delivery' }))
  await ok(owner.post(`/api/pos/venues/${V2}/revenue-streams`, { name: ' zqc delivery' }))
  const cat = await ok(owner.get('/api/pos/order-flows/catalog'))
  const items = cat.menus.flatMap(m => m.sections.flatMap(s => s.items))
  assert.ok(items.some(i => i.id === dish.id && 'price_pence' in i && i.kind))
  assert.ok(!items.some(i => i.id === theirs.item))
  const delivery = cat.channels.find(c => c.name.toLowerCase().trim() === 'zqc delivery')
  assert.deepEqual(delivery.venues.map(v => v.id).sort(), [V, V2].sort(), 'one channel for both locations')
  assert.ok(cat.order_types.some(t => t.id === eatIn.id))
  assert.ok(cat.charges.length && cat.charges.every(c => c.name && c.kind))
  assert.deepEqual(cat.venues.map(v => v.id).sort(), [V, V2].sort())
  assert.ok(cat.tills.some(t => t.id === till.device_id && t.venue_id === V))
  assert.ok(!cat.tills.some(t => t.id === theirs.till))
  assert.equal((await viewer.get('/api/pos/order-flows/catalog')).status, 403)
  // The channel now there: the earlier flow's warning about it goes.
  const f = (await ok(owner.get('/api/pos/order-flows'))).flows.find(x => x.name === 'Zqc Add a drink')
  const saved = await ok(owner.put('/api/pos/order-flows/' + f.id, flowBody(f, { venue_ids: null, device_ids: null, match: { ...f.match, stream_names: ['ZQC DELIVERY'] } })))
  assert.ok(!saved.warnings.some(w => w.code === 'no_channel'), JSON.stringify(saved.warnings))
  const there = await ok(owner.put('/api/pos/order-flows/' + f.id, flowBody(saved, { venue_ids: [V2] })))
  assert.ok(!there.warnings.some(w => w.code === 'no_channel'))
})

test('the flows switched on reach the tills of their locations, the sequencer and the venue hub', async () => {
  const all = (await ok(owner.get('/api/pos/order-flows'))).flows
  const atWare = all.filter(f => f.on && (f.venue_ids == null || f.venue_ids.includes(V))).map(f => f.id)
  const atHertford = all.filter(f => f.on && (f.venue_ids == null || f.venue_ids.includes(V2))).map(f => f.id)
  assert.ok(atWare.length && atHertford.length)
  const cfg = (await device(till, 'GET', '/pos-api/config')).json
  assert.deepEqual(cfg.settings.flows.map(f => f.id), atWare, 'in the list\'s order')
  assert.ok(cfg.settings.flows.every(f => f.on && f.match && Array.isArray(f.adds)))
  const cfg2 = (await device(till2, 'GET', '/pos-api/config')).json
  assert.deepEqual(cfg2.settings.flows.map(f => f.id), atHertford)
  // The sequencer's settings (and so the venue hub's, which are the same).
  const ctx = await withTenant(ids.a, tx => sequencerContext(tx, ids.a, V))
  assert.deepEqual(ctx.settings.flows.map(f => f.id), atWare)
  // Switching one off changes what the till gets (and the config's version).
  const one = all.find(f => f.on && atWare.includes(f.id))
  await ok(owner.patch('/api/pos/order-flows/' + one.id, { on: false }))
  const after = (await device(till, 'GET', '/pos-api/config')).json
  assert.ok(!after.settings.flows.some(f => f.id === one.id))
  assert.notEqual(after.version, cfg.version)
  await ok(owner.patch('/api/pos/order-flows/' + one.id, { on: true }))
})

test('the sequencer judges what a flow put on a check: its dishes, its charges, its prompts', async () => {
  const bag = await ok(owner.post('/api/pos/charges', { name: 'Zqc Bag fee', kind: 'amount', value: 10, optional: true }))
  const flow = await ok(owner.post('/api/pos/order-flows', { name: 'Zqc Bags', kind: 'add' }))
  const on = await ok(owner.put('/api/pos/order-flows/' + flow.id, flowBody(flow, {
    on: true, venue_ids: [V], match: { ...flow.match, type_ids: [eatIn.id] },
    adds: [{ kind: 'dish', item_id: dish.id, qty: 1, removable: false }, { kind: 'charge', charge_id: bag.id, removable: false }],
  })))
  const cfg = (await device(till, 'GET', '/pos-api/config')).json
  const listed = cfg.settings.charges.find(x => x.id === bag.id)
  const dishKey = addKey(on.id, on.adds[0])
  const chargeKey = addKey(on.id, on.adds[1])
  const check = ulid()
  const lineId = ulid()
  const charge = { ...chargeFromList(listed, V, cfg.tax_rates), list: true, optional: false, flow: { id: on.id, key: chargeKey } }
  const opened = await send([
    ev('check.opened', { mode: 'counter', revenue_stream_id: stream.id, order_type_id: eatIn.id, number: Math.floor(Math.random() * 9000) + 1, charges: [] }, { check_id: check }),
    ev('line.added', { line: { id: lineId, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20, flow: { id: on.id, key: dishKey, removable: false } } }, { check_id: check }),
    // Not optional, as the flow says, though the list has it optional.
    ev('charge.added', { charge }, { check_id: check }),
    ev('check.flow_asked', { flow_id: on.id, answer: 'declined' }, { check_id: check }),
  ])
  assert.ok(opened.every(r => r.ok), JSON.stringify(opened))
  let [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check}`
  assert.deepEqual(row.state.lines[0].flow, { id: on.id, key: dishKey, removable: false })
  const onCheck = row.state.charges.find(x => x.id === bag.id)
  assert.deepEqual([onCheck.optional, onCheck.flow], [false, { id: on.id, key: chargeKey }])
  assert.equal(row.state.flows_asked[on.id].answer, 'declined')
  // Staff can't take them off without a manager; the flow can.
  assert.equal((await send([ev('line.deleted', { line_id: lineId }, { check_id: check })]))[0].code, 'manager')
  assert.equal((await send([ev('charge.removed', { charge_id: bag.id, reason: 'Own bag' }, { check_id: check })]))[0].code, 'manager')
  assert.ok((await send([ev('charge.removed', { charge_id: bag.id, by_flow: true }, { check_id: check })]))[0].ok)
  assert.ok((await send([ev('line.deleted', { line_id: lineId, by_flow: true }, { check_id: check })]))[0].ok);
  [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check}`
  assert.deepEqual([row.state.lines.length, row.state.charges.length, row.state.flows_off], [0, 0, undefined])
  // A dish no flow put on can't be taken off by a flow.
  const plain = ulid()
  await send([ev('line.added', { line: { id: plain, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20 } }, { check_id: check })])
  assert.equal((await send([ev('line.deleted', { line_id: plain, by_flow: true }, { check_id: check })]))[0].code, 'flow')
  // With the flow switched off, its charge is judged as the list has it: optional.
  await ok(owner.patch('/api/pos/order-flows/' + on.id, { on: false }))
  assert.equal((await send([ev('charge.added', { charge }, { check_id: check })]))[0].code, 'charge')
  assert.ok((await send([ev('charge.added', { charge: { ...charge, optional: true } }, { check_id: check })]))[0].ok)
  // A manager can take off a dish staff can't, and it isn't put back.
  await ok(owner.patch('/api/pos/order-flows/' + on.id, { on: true }))
  const again = ulid()
  await send([ev('line.added', { line: { id: again, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20, flow: { id: on.id, key: dishKey, removable: false } } }, { check_id: check })])
  assert.ok((await send([ev('line.deleted', { line_id: again }, { check_id: check, approved_by: bossId })]))[0].ok);
  [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check}`
  assert.deepEqual(row.state.flows_off, { [dishKey]: true })
  // Malformed marks are refused.
  assert.equal((await send([ev('line.added', { line: { id: ulid(), item_id: dish.id, name: dish.name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20, flow: { id: on.id, key: 'nope', removable: true } } }, { check_id: check })]))[0].code, 'invalid')
  assert.equal((await send([ev('check.flow_asked', { flow_id: on.id, answer: 'maybe' }, { check_id: check })]))[0].code, 'invalid')
})
