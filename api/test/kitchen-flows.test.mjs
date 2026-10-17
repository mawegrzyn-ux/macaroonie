// Kitchen flows (migration 177): several named flows per venue, one in use.
// Dishes follow the flow in use when they reach the kitchen and keep that
// way; a kitchen screen's flow button (PUT /pos-api/kitchen/flow) or Till
// setup puts another flow in use. Checked here: the setup routes and their
// refusals, the switch from a screen and who may make it, routing by the
// flow in use (dishes already sent keep theirs), and a switch landing
// between two events of one sequencer batch.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sequencer } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, dish, wok, grill, pass, main, busy, screen, till

/** A paired device's request. */
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

async function pairDevice(kind, name, settings = {}) {
  const made = await ok(owner.post(`/api/pos/venues/${V}/devices`, { name, kind, settings }), 'add ' + name)
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/pos-api/pair',
    headers: { 'content-type': 'application/json', [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
    payload: JSON.stringify({ code: made.pairing_code }),
  })
  assert.equal(res.statusCode, 200, res.body)
  return { ...res.json(), id: made.device.id }
}

/** An online order reaching the kitchen (as kitchenOnOnlineOrder sends it). */
function orderIn(n) {
  const orderId = crypto.randomUUID()
  return {
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: { id: 'web-' + orderId, order_id: orderId, number: String(n), items: [{ id: 'i' + n, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1 }] } },
  }
}

async function wayOf(orderNo) {
  const [row] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = ${String(orderNo)}`
  assert.ok(row, 'order ' + orderNo + ' reached the kitchen')
  return Object.keys(row.state.items[0].route).sort()
}

const sorted = list => [...list].sort()

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[1], section_id: menu.sections[0].id }
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  wok = setup.kds_stations.find(s => s.kind === 'prep')
  grill = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Grill', kind: 'prep' }))
  pass = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Pass', kind: 'expo' }))
  main = setup.kds_flows.find(f => f.name === 'Main flow')
  busy = setup.kds_flows.find(f => f.name !== 'Main flow')
  assert.ok(main && busy, 'the fixtures made two flows')
  // Main: Wok then the pass. Busy night: Grill then the pass.
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: wok.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] }], layout: {} }))
  await ok(owner.put(`/api/pos/kds-flows/${busy.id}`, { links: [{ from: null, to: grill.id, targets: [] }, { from: grill.id, to: pass.id, targets: [] }], layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  screen = await pairDevice('kds', 'Pass screen')
  till = await pairDevice('terminal', 'Till 9')
})
after(closeApp)

test('the setup page lists the flows, their links and the one in use', async () => {
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.kds_flows.map(f => f.name), ['Zqx Busy night', 'Main flow'], 'in their order')
  assert.equal(setup.kds_active_flow_id, main.id)
  const b = setup.kds_flows.find(f => f.id === busy.id)
  assert.deepEqual(sorted(b.links.map(l => l.to)), sorted([grill.id, pass.id]))
  assert.equal(setup.kds_flow, undefined, 'the single flow is gone')
})

test('new flows: a copy, names, another venue\'s flow refused', async () => {
  const copy = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Quiet', copy_from: main.id }))
  assert.deepEqual(sorted(copy.links.map(l => l.to)), sorted([wok.id, pass.id]), 'the copy has the links')
  const empty = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Empty one' }))
  assert.deepEqual(empty.links, [])
  const same = await owner.post(`/api/pos/venues/${V}/kds-flows`, { name: '  quiet ' })
  assert.equal(same.status, 422, 'names are unique per venue, whatever the case')
  const rename = await owner.patch(`/api/pos/kds-flows/${empty.id}`, { name: 'QUIET' })
  assert.equal(rename.status, 422)
  const renamed = await ok(owner.patch(`/api/pos/kds-flows/${empty.id}`, { name: 'Grill down' }))
  assert.equal(renamed.name, 'Grill down')
  // Hertford's flow names Hertford's stations: no copying it to Ware.
  const other = await ok(owner.get(`/api/pos/venues/${(await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND slug = 'zqx-hertford'`)[0].id}/setup`))
  const cross = await owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'From Hertford', copy_from: other.kds_flows[0].id })
  assert.equal(cross.status, 404)
  const badLink = await owner.put(`/api/pos/kds-flows/${empty.id}`, { links: [{ from: null, to: other.kds_flows[0].id, targets: [] }], layout: {} })
  assert.equal(badLink.status, 422, 'links name this venue\'s stations')
  await ok(owner.delete(`/api/pos/kds-flows/${copy.id}`))
  await ok(owner.delete(`/api/pos/kds-flows/${empty.id}`))
})

test('the flow in use can\'t be deleted', async () => {
  const del = await owner.delete(`/api/pos/kds-flows/${main.id}`)
  assert.equal(del.status, 422)
  assert.match(del.json.error, /in use/)
})

test('a kitchen screen gets the flows and switches them; dishes follow the flow in use', async () => {
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.equal(config.status, 200, config.body)
  assert.deepEqual(config.json.flows.map(f => f.name), ['Zqx Busy night', 'Main flow'])
  assert.equal(config.json.active_flow_id, main.id)
  assert.deepEqual(config.json.flows.find(f => f.id === busy.id).station_ids, [grill.id, pass.id].sort((a, b) =>
    config.json.stations.findIndex(s => s.id === a) - config.json.stations.findIndex(s => s.id === b)))
  assert.deepEqual(sorted(config.json.flow.map(l => l.to)), sorted([wok.id, pass.id]), 'flow = the links of the one in use')

  const first = await sequencer(ids.a, V).submit(orderIn(101))
  assert.ok(first.ok, first.error)
  assert.deepEqual(await wayOf(101), sorted([wok.id, pass.id]))

  const sw = await device(screen, 'PUT', '/pos-api/kitchen/flow', { flow_id: busy.id })
  assert.equal(sw.status, 200, sw.body)
  assert.equal(sw.json.changed, true)
  assert.equal(sw.json.switched_by, 'Pass screen')
  const again = await device(screen, 'PUT', '/pos-api/kitchen/flow', { flow_id: busy.id })
  assert.equal(again.json.changed, false, 'already in use')

  const second = await sequencer(ids.a, V).submit(orderIn(102))
  assert.ok(second.ok, second.error)
  assert.deepEqual(await wayOf(102), sorted([grill.id, pass.id]), 'sent after the switch: the new flow')
  assert.deepEqual(await wayOf(101), sorted([wok.id, pass.id]), 'sent before: keeps its way')

  const after = await device(screen, 'GET', '/pos-api/config?version=' + encodeURIComponent(config.json.version))
  assert.notEqual(after.json.unchanged, true, 'the config changed')
  assert.equal(after.json.active_flow_id, busy.id)
  assert.equal(after.json.flow_switched_by, 'Pass screen')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(setup.kds_active_flow_id, busy.id)
})

test('a switch between two events of one batch counts from the next event', async () => {
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  const seqr = sequencer(ids.a, V)
  assert.ok((await seqr.submit(orderIn(201))).ok)
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: busy.id }))
  assert.ok((await seqr.submit(orderIn(202))).ok)
  assert.deepEqual(await wayOf(201), sorted([wok.id, pass.id]))
  assert.deepEqual(await wayOf(202), sorted([grill.id, pass.id]), 'the batch noticed the switch')
})

test('who may switch: not a till, not a screen it is turned off for, not another venue\'s or tenant\'s flow', async () => {
  const fromTill = await device(till, 'PUT', '/pos-api/kitchen/flow', { flow_id: main.id })
  assert.equal(fromTill.status, 403)
  await ok(owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { can_switch_flow: false } }))
  const off = await device(screen, 'PUT', '/pos-api/kitchen/flow', { flow_id: main.id })
  assert.equal(off.status, 403)
  assert.match(off.json.error, /Till setup/)
  await ok(owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: {} }))
  const hertford = (await sql`SELECT f.id FROM kds_flows f JOIN venues v ON v.id = f.venue_id WHERE v.slug = 'zqx-hertford' AND f.tenant_id = ${ids.a}`)[0]
  const otherVenue = await device(screen, 'PUT', '/pos-api/kitchen/flow', { flow_id: hertford.id })
  assert.equal(otherVenue.status, 404)
  const viewer = await as(A.viewer, ids.a).put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id })
  assert.equal(viewer.status, 403, 'putting a flow in use needs Till setup manage')

  const b = as(B.owner, ids.b)
  const bVenue = await ok(b.post('/api/venues', { name: 'Wvb Ware', slug: 'wvb-ware', timezone: 'Europe/London' }))
  const bSetup = await ok(b.get(`/api/pos/venues/${bVenue.id}/setup`))
  assert.equal(bSetup.kds_flows.length, 1, 'a venue gets its first flow with the setup page')
  assert.equal((await b.put(`/api/pos/venues/${bVenue.id}/kds-flows/active`, { flow_id: main.id })).status, 404)
  assert.equal((await b.patch(`/api/pos/kds-flows/${main.id}`, { name: 'Mine now' })).status, 404)
  assert.equal((await b.delete(`/api/pos/kds-flows/${busy.id}`)).status, 404)
  assert.equal((await device(screen, 'PUT', '/pos-api/kitchen/flow', { flow_id: bSetup.kds_flows[0].id })).status, 404)
  const [{ name }] = await sql`SELECT name FROM kds_flows WHERE id = ${main.id}`
  assert.equal(name, 'Main flow')
})
