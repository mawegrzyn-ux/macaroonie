// A meal deal's parts ticked off one by one on the kitchen screens, through
// the real sequencer and Postgres: a prep station marks the parts made there,
// the last one done is the meal done (and, the ticket's last dish, the bump);
// the pass ticks parts off and the last part ticks the meal off; the parts are
// checked against the dish (a part made elsewhere, one the dish hasn't got,
// a malformed list), and the pass can't mark parts done.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sequencer } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, section, dishes, grill, pass, screen

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

/** An online meal deal: two dishes and a typed-in pot, all made at the grill. */
async function mealIn(n) {
  const orderId = crypto.randomUUID()
  const r = await sequencer(ids.a, V).submit({
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: { id: 'web-' + orderId, order_id: orderId, number: String(n), items: [{
      id: 'm' + n, item_id: null, section_id: section.id, name: 'Zqx meal', qty: 1,
      parts: [
        { item_id: dishes[0].id, section_id: section.id, name: 'Zqx burger' },
        { item_id: dishes[1].id, section_id: section.id, name: 'Zqx fries' },
        { item_id: null, name: 'Zqx pot' },
      ],
    }] } },
  })
  assert.ok(r.ok, r.error)
  return { id: 'web-' + orderId, item: 'm' + n }
}

async function tap(type, payload) {
  const res = await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), type, payload, client_at: new Date().toISOString() }] })
  assert.equal(res.status, 200, res.body)
  return res.json.results[0]
}
const stateOf = async id => (await sql`SELECT status, state FROM kds_orders WHERE id = ${id} AND tenant_id = ${ids.a}`)[0]

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  section = menu.sections[0]
  // Any two dishes: this flow sends every dish to the grill.
  dishes = menu.sections.flatMap(s => s.items).filter(i => i.kind !== 'combo').slice(0, 2)
  assert.equal(dishes.length, 2, 'two dishes in the fixtures\' menu')
  grill = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Zqx Grill', kind: 'prep' }))
  pass = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Zqx Pass', kind: 'expo' }))
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const main = setup.kds_flows.find(f => f.name === 'Main flow')
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: grill.id, targets: [] }, { from: grill.id, to: pass.id, targets: [] }], layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  screen = await linkDevice(owner, V, { kind: 'kds', name: 'Zqx screen', settings: { station_ids: [grill.id, pass.id] } })
})
after(closeApp)

test('prep: a meal\'s parts marked done one by one; the last one is the meal done and the bump', async () => {
  const o = await mealIn(901)
  const done = (parts, isDone = true) => tap('kitchen.item_done', { order_id: o.id, station_id: grill.id, item_id: o.item, done: isDone, ...(parts ? { parts } : {}) })
  let r = await done([0])
  assert.equal(r.ok, true, r.error)
  let st = await stateOf(o.id)
  const item = () => st.state.items[0]
  assert.deepEqual(Object.keys(item().part_ticks[grill.id]), ['0'], 'the burger done, stored')
  assert.equal(item().done[grill.id], undefined, 'the meal still at the grill')
  assert.equal(st.status, 'active')
  // Checked against the dish: a part it hasn't got, a malformed list, one ticked already.
  assert.equal((await done([5])).code, 'parts')
  for (const bad of [[], [-1], ['0'], 'all']) assert.equal((await done(bad)).ok, false, JSON.stringify(bad))
  assert.equal((await done([0])).code, 'nothing', 'already done')
  // A part undone, then done again.
  assert.equal((await done([0], false)).ok, true)
  st = await stateOf(o.id)
  assert.equal(item().part_ticks, undefined, 'none left')
  assert.equal((await done([0, 2])).ok, true)
  // The last part: the meal done at the grill, the ticket's last dish, so the bump.
  r = await done([1])
  assert.equal(r.ok, true, r.error)
  st = await stateOf(o.id)
  assert.ok(item().done[grill.id], 'the meal done')
  assert.equal(item().part_ticks, undefined, 'part ticks kept only until then')
  assert.equal(st.state.bumps.find(b => b.station_id === grill.id)?.by_items, true)
  const logged = await sql`SELECT kind FROM kds_log WHERE tenant_id = ${ids.a} AND station_id = ${grill.id} AND kitchen_order_id = ${o.id}`
  assert.deepEqual(logged.map(x => x.kind), ['bump'])
  // One part undone on the meal done: back at the grill, the other parts still done.
  assert.equal((await done([2], false)).ok, true)
  st = await stateOf(o.id)
  assert.equal(item().done[grill.id], undefined)
  assert.deepEqual(Object.keys(item().part_ticks[grill.id]).sort(), ['0', '1'])
})

test('pass: parts ticked off one by one; the last part ticks the meal off, the order waits for READY', async () => {
  const o = await mealIn(902)
  assert.equal((await tap('kitchen.bumped', { order_id: o.id, station_id: grill.id })).ok, true)
  const tick = (parts, checked = true) => tap('kitchen.item_checked', { order_id: o.id, station_id: pass.id, item_id: o.item, checked, ...(parts ? { parts } : {}) })
  assert.equal((await tick([0])).ok, true)
  let st = await stateOf(o.id)
  assert.deepEqual(Object.keys(st.state.items[0].part_ticks[pass.id]), ['0'])
  assert.equal(st.state.items[0].checked?.[pass.id], undefined, 'the meal not ticked off yet')
  // The pass ticks parts off; it doesn't mark them done.
  const asDone = await tap('kitchen.item_done', { order_id: o.id, station_id: pass.id, item_id: o.item, done: true, parts: [1] })
  assert.equal(asDone.code, 'station')
  assert.equal((await tick([1, 2])).ok, true)
  st = await stateOf(o.id)
  assert.ok(st.state.items[0].checked[pass.id], 'every part ticked: the meal is')
  assert.equal(st.state.items[0].part_ticks, undefined)
  assert.equal(st.status, 'active', 'still waiting for READY')
  // One part unticked: the meal isn't, the others still are.
  assert.equal((await tick([1], false)).ok, true)
  st = await stateOf(o.id)
  assert.equal(st.state.items[0].checked?.[pass.id], undefined)
  assert.deepEqual(Object.keys(st.state.items[0].part_ticks[pass.id]).sort(), ['0', '2'])
  // A dish that isn't a meal deal has no parts to tick.
  const orderId = crypto.randomUUID()
  const r = await sequencer(ids.a, V).submit({
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: { id: 'web-' + orderId, order_id: orderId, number: '903', items: [{ id: 'p903', item_id: dishes[1].id, section_id: section.id, name: 'Zqx plain', qty: 1 }] } },
  })
  assert.ok(r.ok, r.error)
  const plain = await tap('kitchen.item_done', { order_id: 'web-' + orderId, station_id: grill.id, item_id: 'p903', done: true, parts: [0] })
  assert.equal(plain.code, 'parts')
})
