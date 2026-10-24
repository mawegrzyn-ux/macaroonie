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
import { linkDevice } from './support/devices.mjs'
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

/** A device showing a code, linked from Store tech (support/devices.mjs). */
const pairDevice = (kind, name, settings = {}) => linkDevice(owner, V, { kind, name, settings })

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
  assert.deepEqual(setup.kds_flows.filter(f => !f.shared).map(f => f.name), ['Zqx Busy night', 'Main flow'], 'in their order')
  assert.deepEqual(setup.kds_flows.filter(f => f.shared).map(f => f.name), ['Zqx Every site'], 'then the shared ones (migration 192)')
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
  assert.deepEqual(config.json.flows.map(f => f.name), ['Zqx Busy night', 'Main flow', 'Zqx Every site'])
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
  assert.match(off.json.error, /Store tech/)
  await ok(owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: {} }))
  const hertford = (await sql`SELECT f.id FROM kds_flows f JOIN venues v ON v.id = f.venue_id WHERE v.slug = 'zqx-hertford' AND f.tenant_id = ${ids.a}`)[0]
  const otherVenue = await device(screen, 'PUT', '/pos-api/kitchen/flow', { flow_id: hertford.id })
  assert.equal(otherVenue.status, 404)
  const viewer = await as(A.viewer, ids.a).put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id })
  assert.equal(viewer.status, 403, 'putting a flow in use needs Store tech manage')

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

test('a station taken out of a flow: no links to it, no dishes, its warning gone; kept by a copy', async () => {
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  // Busy night never used the wok: before, the designer warned about it.
  const before = await ok(owner.put(`/api/pos/kds-flows/${busy.id}`, { links: [{ from: null, to: grill.id, targets: [] }, { from: grill.id, to: pass.id, targets: [] }], layout: {} }))
  assert.ok(before.warnings.some(w => w.startsWith(wok.name)), 'warned while in the flow')
  const out = await ok(owner.put(`/api/pos/kds-flows/${busy.id}`, {
    links: [{ from: null, to: grill.id, targets: [] }, { from: grill.id, to: pass.id, targets: [] }], layout: {}, off_station_ids: [wok.id],
  }))
  assert.deepEqual(out.off_station_ids, [wok.id])
  assert.ok(!out.warnings.some(w => w.startsWith(wok.name)), 'no warning for a station out of the flow')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.kds_flows.find(f => f.id === busy.id).off_station_ids, [wok.id])
  assert.deepEqual(setup.kds_flows.find(f => f.id === main.id).off_station_ids, [], 'other flows keep it')
  assert.ok(setup.kds_stations.some(s => s.id === wok.id), 'the station itself stays')

  const linked = await owner.put(`/api/pos/kds-flows/${busy.id}`, {
    links: [{ from: null, to: wok.id, targets: [] }], layout: {}, off_station_ids: [wok.id],
  })
  assert.equal(linked.status, 422)
  assert.match(linked.json.error, /out of this flow/)
  const unknown = await owner.put(`/api/pos/kds-flows/${busy.id}`, { links: [], layout: {}, off_station_ids: [crypto.randomUUID()] })
  assert.equal(unknown.status, 422, 'only this venue\'s stations')
  const hertford = (await sql`SELECT s.id FROM kds_stations s JOIN venues v ON v.id = s.venue_id WHERE v.slug = 'zqx-hertford' AND s.tenant_id = ${ids.a} LIMIT 1`)[0]
  if (hertford) {
    const cross = await owner.put(`/api/pos/kds-flows/${busy.id}`, { links: [], layout: {}, off_station_ids: [hertford.id] })
    assert.equal(cross.status, 422, 'not another venue\'s station')
  }
  const viewer = await as(A.viewer, ids.a).put(`/api/pos/kds-flows/${busy.id}`, { links: [], layout: {}, off_station_ids: [] })
  assert.equal(viewer.status, 403)
  assert.equal((await as(B.owner, ids.b).put(`/api/pos/kds-flows/${busy.id}`, { links: [], layout: {}, off_station_ids: [] })).status, 404)
  const [kept] = await sql`SELECT off_station_ids FROM kds_flows WHERE id = ${busy.id}`
  assert.deepEqual(kept.off_station_ids, [wok.id], 'refused saves changed nothing')

  const copy = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Busy copy', copy_from: busy.id }))
  assert.deepEqual(copy.off_station_ids, [wok.id], 'a copy leaves the same stations out')
  await ok(owner.delete(`/api/pos/kds-flows/${copy.id}`))

  // The wok out of the flow in use: dishes sent from now skip it.
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: pass.id, targets: [] }], layout: {}, off_station_ids: [wok.id] }))
  assert.ok((await sequencer(ids.a, V).submit(orderIn(301))).ok)
  assert.deepEqual(await wayOf(301), [pass.id])
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.ok(!config.json.flows.find(f => f.id === main.id).station_ids.includes(wok.id), 'the flow button doesn\'t list it')

  // Put back: linked again, dishes go there again.
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: wok.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] }], layout: {} }))
  assert.deepEqual((await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_flows.find(f => f.id === main.id).off_station_ids, [], 'no list = none out')
  assert.ok((await sequencer(ids.a, V).submit(orderIn(302))).ok)
  assert.deepEqual(await wayOf(302), sorted([wok.id, pass.id]))
})

test('a Splitter: each order to the wingman with fewer pieces to cook, taking turns on a tie', async () => {
  const pieces = [{ kind: 'dish', id: dish.id, label: dish.name, qty: 10 }]
  const bad = await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wings', kind: 'balance', settings: { pieces: [{ ...pieces[0], id: crypto.randomUUID() }] } })
  assert.equal(bad.status, 422, 'pieces name the tenant\'s own dishes')
  const box = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wings', kind: 'balance', settings: { pieces } }))
  assert.deepEqual(box.settings.pieces.map(p => p.qty), [10])
  const w1 = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wingman 1', kind: 'prep' }))
  const w2 = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wingman 2', kind: 'prep' }))
  const flow = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Wings night' }))
  const links = [
    { from: null, to: box.id, targets: [{ kind: 'item', id: dish.id }] }, { from: null, to: wok.id, targets: [] },
    { from: box.id, to: w1.id, targets: [] }, { from: box.id, to: w2.id, targets: [] },
    { from: w1.id, to: pass.id, targets: [] }, { from: w2.id, to: pass.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] },
  ]
  const filtered = await owner.put(`/api/pos/kds-flows/${flow.id}`, { links: links.map(l => (l.from === box.id && l.to === w2.id ? { ...l, targets: [{ kind: 'item', id: dish.id }] } : l)), layout: {} })
  assert.equal(filtered.status, 422)
  assert.match(filtered.json.error, /remove their filters/)
  const saved = await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} }))
  assert.ok(!saved.warnings.some(w => w.startsWith('Wings')), 'two wingmen to share with: no warning')
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: flow.id }))

  const seqr = sequencer(ids.a, V)
  assert.ok((await seqr.submit(orderIn(401))).ok)
  assert.deepEqual(await wayOf(401), sorted([w1.id, pass.id]), 'both empty: the first')
  assert.ok((await seqr.submit(orderIn(402))).ok)
  assert.deepEqual(await wayOf(402), sorted([w2.id, pass.id]), '10 pieces at Wingman 1')
  assert.ok((await seqr.submit(orderIn(403))).ok)
  assert.deepEqual(await wayOf(403), sorted([w1.id, pass.id]), '10 each: the next after Wingman 2')
  const [turn] = await sql`SELECT last_station_id FROM kds_balance_turns WHERE station_id = ${box.id}`
  assert.equal(turn.last_station_id, w1.id, 'the last pick is kept')

  // Share big tickets: more than 15 pieces go out dish line by dish line.
  const tooLow = await owner.patch(`/api/pos/kds-stations/${box.id}`, { name: 'Wings', kind: 'balance', settings: { pieces, split_above: -1 } })
  assert.equal(tooLow.status, 400)
  const sharing = await ok(owner.patch(`/api/pos/kds-stations/${box.id}`, { name: 'Wings', kind: 'balance', settings: { pieces, split_above: 15 } }))
  assert.equal(sharing.settings.split_above, 15)
  const big = orderIn(404)
  big.payload.order.items = [1, 2, 3].map(n => ({ id: 'b' + n, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1 }))
  assert.ok((await sequencer(ids.a, V).submit(big)).ok)
  const [bigRow] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = '404'`
  // Wingman 1 has 20, Wingman 2 has 10: the first 10 to Wingman 2, then level
  // (20 each) so the next after Wingman 2, then Wingman 2 again (20 against 30).
  assert.deepEqual(bigRow.state.items.map(i => Object.keys(i.route).sort()), [sorted([w2.id, pass.id]), sorted([w1.id, pass.id]), sorted([w2.id, pass.id])], 'shared out')
  const [turn2] = await sql`SELECT last_station_id FROM kds_balance_turns WHERE station_id = ${box.id}`
  assert.equal(turn2.last_station_id, w2.id, 'the last pick is the last line\'s')
  const keep = await ok(owner.patch(`/api/pos/kds-stations/${box.id}`, { name: 'Wings', kind: 'balance', settings: { pieces } }))
  assert.equal(keep.settings.split_above, null, 'no number: each ticket on one station')

  // The box has no screen and nothing to bump.
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.ok(config.json.stations.some(s => s.id === box.id && s.kind === 'balance'))
  const kid = (await sql`SELECT id FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = '401'`)[0].id
  const bump = await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), venue_id: V, type: 'kitchen.bumped', client_at: new Date().toISOString(), payload: { order_id: kid, station_id: box.id } }] })
  assert.equal(bump.json.results[0].ok, false)
  assert.match(bump.json.results[0].error, /nothing to bump/)
  const onScreen = await owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { station_ids: [box.id] } })
  assert.equal(onScreen.status, 422, 'a Splitter isn\'t shown on a kitchen screen')

  // A station turned into a Splitter loses its links' filters; links out
  // to a station that stops bumping go.
  const extra = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Sauces', kind: 'prep' }))
  await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [...links, { from: null, to: extra.id, targets: [] }, { from: extra.id, to: pass.id, targets: [{ kind: 'item', id: dish.id }] }], layout: {} }))
  await ok(owner.patch(`/api/pos/kds-stations/${extra.id}`, { name: 'Sauces', kind: 'balance', settings: {} }))
  const after = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_flows.find(f => f.id === flow.id)
  assert.deepEqual(after.links.find(l => l.from === extra.id).targets, [], 'filters gone')
  await ok(owner.patch(`/api/pos/kds-stations/${w2.id}`, { name: 'Wingman 2', kind: 'board', settings: {} }))
  const after2 = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_flows.find(f => f.id === flow.id)
  assert.ok(!after2.links.some(l => l.from === box.id && l.to === w2.id), 'a board can\'t take a Splitter\'s dishes')

  const viewer = await as(A.viewer, ids.a).post(`/api/pos/venues/${V}/kds-stations`, { name: 'Nope', kind: 'balance' })
  assert.equal(viewer.status, 403)
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  await ok(owner.delete(`/api/pos/kds-flows/${flow.id}`))
  for (const s of [box, w1, w2, extra]) await ok(owner.delete(`/api/pos/kds-stations/${s.id}`))
  assert.equal((await sql`SELECT count(*)::int AS n FROM kds_balance_turns WHERE station_id = ${box.id}`)[0].n, 0, 'its turns go with it')
})

test('a Splitter\'s modes: Smart by each station\'s pace, and a busy order type to its own station', async () => {
  const pieces = [{ kind: 'dish', id: dish.id, label: dish.name, qty: 10 }]
  const setup0 = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const DEL = setup0.order_types.find(t => t.name === 'Delivery')
  assert.ok(DEL, 'the tenant has a Delivery order type')
  const w1 = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wingman A', kind: 'prep' }))
  const w2 = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wingman B', kind: 'prep' }))
  const orb = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'ORB 8', kind: 'board' }))
  const box = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wings 2', kind: 'balance', settings: { pieces, share_mode: 'speed' } }))
  assert.equal(box.settings.share_mode, 'speed')
  assert.equal(box.settings.rush_type_id, null)

  // What the settings take.
  const save = settings => owner.patch(`/api/pos/kds-stations/${box.id}`, { name: 'Wings 2', kind: 'balance', settings: { pieces, ...settings } })
  assert.equal((await save({ share_mode: 'fastest' })).status, 400, 'an unknown way to share')
  assert.equal((await save({ rush_type_id: DEL.id })).status, 400, 'a type without its station')
  assert.equal((await save({ rush_station_id: w1.id })).status, 400, 'a station without its type')
  for (const rush_count of [0, 100]) assert.equal((await save({ rush_type_id: DEL.id, rush_station_id: w1.id, rush_count })).status, 400, 'count ' + rush_count)
  const [otherType] = await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.b} LIMIT 1`
  const foreignType = await save({ rush_type_id: otherType.id, rush_station_id: w1.id })
  assert.equal(foreignType.status, 422)
  assert.match(foreignType.json.error, /Order type not found/)
  const [otherStation] = await sql`SELECT id FROM kds_stations WHERE tenant_id = ${ids.b} LIMIT 1`
  if (otherStation) assert.match((await save({ rush_type_id: DEL.id, rush_station_id: otherStation.id })).json.error, /Station not found/)
  assert.match((await save({ rush_type_id: DEL.id, rush_station_id: orb.id })).json.error, /makes or checks dishes/, 'not a board')
  assert.match((await save({ rush_type_id: DEL.id, rush_station_id: box.id })).json.error, /one of the stations it shares with/, 'not itself')
  const prep = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Sides 2', kind: 'prep', settings: { share_mode: 'speed', rush_type_id: DEL.id, rush_station_id: w1.id } }))
  assert.equal(prep.settings.share_mode, 'pieces', 'only a Splitter keeps them')
  assert.equal(prep.settings.rush_type_id, null)

  const flow = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Wings smart' }))
  const links = [
    { from: null, to: box.id, targets: [{ kind: 'item', id: dish.id }] }, { from: null, to: wok.id, targets: [] },
    { from: box.id, to: w1.id, targets: [] }, { from: box.id, to: w2.id, targets: [] },
    { from: w1.id, to: pass.id, targets: [] }, { from: w2.id, to: pass.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] },
  ]
  await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: flow.id }))

  // Wingman A has been doing 10 wings a minute, Wingman B a ticket every three
  // minutes: past orders, bumped a while ago, as the kitchen keeps them.
  const now = Date.now()
  const past = async (station, reached, bumped) => {
    const orderId = crypto.randomUUID()
    const id = 'web-' + orderId
    const iso = s => new Date(now - s * 1000).toISOString()
    const state = {
      id, source: 'online', order_id: orderId, number: 'past', status: 'collected', created_at: iso(reached + 60),
      items: [{ id: 'p', item_id: dish.id, name: dish.name, qty: 1, mods: [], route: { [station]: ['start'] }, done: { [station]: iso(bumped) } }],
      bumps: [{ id: ulid(), station_id: station, kind: 'prep', at: iso(bumped), started_at: iso(reached), set: [['p', station]], items: 1, recalled_at: null }],
    }
    await sql`
      INSERT INTO kds_orders (id, tenant_id, venue_id, source, order_id, status, created_at, collected_at, state, last_seq, updated_at)
      VALUES (${id}, ${ids.a}, ${V}, 'online', ${orderId}, 'collected', ${state.created_at}, ${iso(bumped)}, ${sql.json(state)}, 0, now())`
  }
  await past(w1.id, 900, 840)
  await past(w1.id, 700, 640)
  await past(w2.id, 900, 720)
  await past(w2.id, 700, 520)
  const seqr = () => sequencer(ids.a, V)
  const sideOf = async n => ((await wayOf(n)).includes(w1.id) ? 'A' : 'B')
  const smart = []
  for (const n of [801, 802, 803, 804]) {
    assert.ok((await seqr().submit(orderIn(n))).ok)
    smart.push(await sideOf(n))
  }
  // 10 x 6 s beats 10 x 18 s; 20 x 6 still does; 30 x 6 = 10 x 18 (turns); 30 x 6 beats 20 x 18.
  assert.deepEqual(smart, ['A', 'A', 'B', 'A'], 'three of four to the faster wingman')

  // Clear the wingmen (bumped on a kitchen screen), then a busy order type
  // rule, sharing by pieces: from 2 waiting deliveries, deliveries go to Wingman B.
  for (const n of [801, 802, 803, 804]) {
    const [row] = await sql`SELECT id, state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = ${String(n)}`
    const at = Object.keys(row.state.items[0].route).find(s => s === w1.id || s === w2.id)
    const r = await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), venue_id: V, type: 'kitchen.bumped', client_at: new Date().toISOString(), payload: { order_id: row.id, station_id: at } }] })
    assert.ok(r.json.results[0].ok, r.json.results[0].error)
  }
  const rule = await ok(save({ rush_type_id: DEL.id, rush_count: 2, rush_station_id: w2.id }))
  assert.deepEqual([rule.settings.share_mode, rule.settings.rush_count, rule.settings.rush_station_id], ['pieces', 2, w2.id])
  const send = async (n, { type = null, qty = 1 } = {}) => {
    const e = orderIn(n)
    e.payload.order.type = type
    e.payload.order.items[0].qty = qty
    assert.ok((await seqr().submit(e)).ok)
    return sideOf(n)
  }
  assert.equal(await send(811, { qty: 3 }), 'B', 'level: the next after Wingman A (30 pieces at B now)')
  assert.equal(await send(812, { type: DEL.id }), 'A', 'one delivery: by pieces (0 against 30)')
  assert.equal(await send(813, { type: DEL.id }), 'B', 'two deliveries: busy, so Wingman B (by pieces: A, 10 against 30)')
  assert.equal(await send(814), 'A', 'another order while it\'s busy: the other wingman')
  for (const [n, s] of [[812, w1.id], [813, w2.id]]) {
    const [row] = await sql`SELECT id FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = ${String(n)}`
    const r = await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), venue_id: V, type: 'kitchen.bumped', client_at: new Date().toISOString(), payload: { order_id: row.id, station_id: s } }] })
    assert.ok(r.json.results[0].ok, r.json.results[0].error)
  }
  assert.equal(await send(815, { type: DEL.id }), 'A', 'the deliveries left the wingmen: by pieces again (10 against 30)')
  assert.equal(await send(816, { type: DEL.id }), 'B', 'busy again: Wingman B (by pieces: A, 20 against 30)')

  // The flow warns when the box doesn't link to the busy orders' station.
  await ok(save({ rush_type_id: DEL.id, rush_count: 2, rush_station_id: wok.id }))
  const warned = await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} }))
  assert.ok(warned.warnings.some(w => /Wings 2 sends busy orders to .* but doesn't link to it/.test(w)), warned.warnings.join('; '))
  // The station going (or no longer bumping) switches the rule off.
  await ok(save({ rush_type_id: DEL.id, rush_count: 2, rush_station_id: w2.id }))
  await ok(owner.patch(`/api/pos/kds-stations/${w2.id}`, { name: 'Wingman B', kind: 'board', settings: {} }))
  let st = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_stations.find(s => s.id === box.id)
  assert.deepEqual([st.settings.rush_type_id, st.settings.rush_station_id], [null, null], 'turned into a board')
  await ok(save({ rush_type_id: DEL.id, rush_count: 2, rush_station_id: w1.id }))
  await ok(owner.delete(`/api/pos/kds-stations/${w1.id}`))
  st = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_stations.find(s => s.id === box.id)
  assert.deepEqual([st.settings.rush_type_id, st.settings.rush_station_id], [null, null], 'deleted')

  assert.equal((await as(A.viewer, ids.a).patch(`/api/pos/kds-stations/${box.id}`, { name: 'Wings 2', kind: 'balance', settings: { share_mode: 'speed' } })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch(`/api/pos/kds-stations/${box.id}`, { name: 'Wings 2', kind: 'balance', settings: { share_mode: 'speed' } })).status, 404)
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  await ok(owner.delete(`/api/pos/kds-flows/${flow.id}`))
  for (const s of [box, w2, orb, prep]) await ok(owner.delete(`/api/pos/kds-stations/${s.id}`))
})

test('a Sleeper: holds the dishes its links send it for its minutes, then the wok can bump them', async () => {
  for (const delay_mins of [0, 241]) {
    const bad = await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wait', kind: 'sleeper', settings: { delay_mins } })
    assert.equal(bad.status, 400, 'from 1 to 240 minutes')
  }
  const sleeper = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wings wait', kind: 'sleeper', settings: { delay_mins: 10 } }))
  assert.equal(sleeper.settings.delay_mins, 10)
  const box = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Splitter', kind: 'balance', settings: {} }))
  const flow = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Slow wings' }))
  const links = [
    { from: null, to: sleeper.id, targets: [{ kind: 'item', id: dish.id }] }, { from: null, to: wok.id, targets: [] },
    { from: sleeper.id, to: wok.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] },
  ]
  const fromBox = await owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [...links, { from: null, to: box.id, targets: [] }, { from: box.id, to: sleeper.id, targets: [] }], layout: {} })
  assert.equal(fromBox.status, 422, 'a Splitter shares only between stations that bump')
  const saved = await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} }))
  assert.ok(!saved.warnings.some(w => /Wings wait/.test(w)))
  const loose = await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links: links.filter(l => l.from !== sleeper.id), layout: {} }))
  assert.ok(loose.warnings.some(w => /Wings wait holds dishes but sends them nowhere/.test(w)))
  await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: flow.id }))

  assert.ok((await sequencer(ids.a, V).submit(orderIn(501))).ok)
  assert.deepEqual(await wayOf(501), sorted([sleeper.id, wok.id, pass.id]))
  const [row] = await sql`SELECT id, state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = '501'`
  assert.deepEqual(row.state.items[0].route[wok.id], [sleeper.id], 'the wok gets it from the Sleeper')
  const bumpAt = async station => (await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), venue_id: V, type: 'kitchen.bumped', client_at: new Date().toISOString(), payload: { order_id: row.id, station_id: station } }] })).json.results[0]
  const early = await bumpAt(wok.id)
  assert.equal(early.ok, false)
  assert.match(early.error, /Still at Wings wait/)
  assert.match((await bumpAt(sleeper.id)).error, /passes dishes on by itself/)
  // Eleven minutes on: awake, at the wok.
  const back = t => new Date(Date.parse(t) - 11 * 60_000).toISOString()
  const item = row.state.items[0]
  const moved = { ...row.state, items: [{ ...item, sent_at: back(item.sent_at), fired_at: back(item.fired_at), since: back(item.since) }] }
  await sql`UPDATE kds_orders SET state = ${sql.json(moved)} WHERE id = ${row.id}`
  assert.equal((await bumpAt(wok.id)).ok, true, 'awake: the wok bumps it')

  // No kitchen screen shows a Sleeper; a station made a Sleeper leaves its screens.
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.ok(config.json.stations.some(s => s.id === sleeper.id && s.settings.delay_mins === 10), 'screens know its time')
  assert.equal((await owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { station_ids: [sleeper.id] } })).status, 422)
  const prep = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Sauces 2', kind: 'prep' }))
  await ok(owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { station_ids: [grill.id, prep.id], can_switch_flow: true } }))
  await ok(owner.patch(`/api/pos/kds-stations/${prep.id}`, { name: 'Sauces 2', kind: 'sleeper', settings: { delay_mins: 3 } }))
  const [dev] = await sql`SELECT settings FROM pos_devices WHERE id = ${screen.id}`
  assert.ok(!dev.settings.station_ids.includes(prep.id), 'off the kitchen screen')

  const viewer = await as(A.viewer, ids.a).post(`/api/pos/venues/${V}/kds-stations`, { name: 'Nope', kind: 'sleeper' })
  assert.equal(viewer.status, 403)
  const other = await as(B.owner, ids.b).patch(`/api/pos/kds-stations/${sleeper.id}`, { name: 'Mine', kind: 'sleeper', settings: { delay_mins: 1 } })
  assert.equal(other.status, 404)
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  await ok(owner.delete(`/api/pos/kds-flows/${flow.id}`))
  for (const st of [sleeper, box, prep]) await ok(owner.delete(`/api/pos/kds-stations/${st.id}`))
})

test('a kitchen screen\'s ticket title: saved with its settings, sent to the screen, nonsense refused', async () => {
  const keep = { station_ids: [grill.id], can_switch_flow: true }
  ok(await owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { ...keep, ticket_main: 'tent' } }), 'ticket title')
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.equal(config.status, 200, config.body)
  assert.equal(config.json.device.settings.ticket_main, 'tent')
  const bad = await owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { ...keep, ticket_main: 'chair' } })
  assert.equal(bad.status, 400)
  ok(await owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: keep }), 'back to auto')
})

test('an order ready board sends a menu screen each order\'s name, table and type, not only its number', async () => {
  const board = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Pick up here', kind: 'board' }))
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [
    { from: null, to: wok.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] }, { from: pass.id, to: board.id, targets: [] },
  ], layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  const types = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).order_types
  const ev = orderIn(301)
  Object.assign(ev.payload.order, { guest: 'Ali', table: '7', type: types[0].id, type_name: types[0].name })
  const sent = await sequencer(ids.a, V).submit(ev)
  assert.ok(sent.ok, sent.error)

  const app = await getApp()
  const call = (method, url, body, headers = {}) => app.inject({
    method, url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body ? JSON.stringify(body) : undefined,
  })
  const p = (await call('POST', '/screen-api/pairings', { device: { width: 1920, height: 1080 } })).json()
  const scr = await ok(owner.post('/api/screens/screens/claim', { code: p.code, name: 'Pick up screen', venue_id: V }))
  const res = await call('GET', '/screen-api/orders', null, { authorization: `Screen ${scr.id}.${p.secret}` })
  assert.equal(res.statusCode, 200, res.body)
  const tile = res.json().orders.boards['pick up here'].preparing.find(t => t.number === '301')
  assert.ok(tile, 'the order is on its board')
  assert.equal(tile.name, 'Ali')
  assert.equal(tile.table, '7')
  assert.equal(tile.type_name, types[0].name)
  assert.equal(tile.tent, null)
  assert.equal(tile.source, 'online')

  await ok(owner.delete(`/api/screens/screens/${scr.id}`))
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: wok.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] }], layout: {} }))
  await ok(owner.delete(`/api/pos/kds-stations/${board.id}`))
})

test('a Setter: sets the order status for the boards, one per name, styled by its settings', async () => {
  const look = { status_look: 'light', status_colour: '#FF0000', status_lamp: 1, status_anim: 'pulse' }
  const setIn = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'In the kitchen', kind: 'setter', settings: look }))
  assert.equal(setIn.settings.status_look, 'light')
  const bag = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Bagging', kind: 'setter', settings: { status_look: 'flag', status_text: 'Nearly there' } }))
  // One Setter per name at a venue (any case, spaces round it); other kinds may share it.
  const twice = await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: ' in the KITCHEN ', kind: 'setter' })
  assert.equal(twice.status, 409)
  assert.match(twice.json.error, /already called/)
  ok(await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Bagging', kind: 'prep' }).then(r => { assert.equal(r.status, 201); return r.json }))
  const renamed = await owner.patch(`/api/pos/kds-stations/${bag.id}`, { name: 'In the kitchen', kind: 'setter', settings: {} })
  assert.equal(renamed.status, 409, 'renaming onto another Setter is refused')
  // Bad looks refused; the viewer and the other tenant can't add one.
  assert.equal((await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Odd', kind: 'setter', settings: { status_look: 'spiral' } })).status, 400)
  assert.equal((await as(A.viewer, ids.a).post(`/api/pos/venues/${V}/kds-stations`, { name: 'Nope', kind: 'setter' })).status, 403)
  assert.equal((await as(B.owner, ids.b).post(`/api/pos/venues/${V}/kds-stations`, { name: 'Nope', kind: 'setter' })).status, 404)
  // Nothing to bump at a Setter.
  const board = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Collect', kind: 'board' }))
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [
    { from: null, to: setIn.id, targets: [] }, { from: setIn.id, to: wok.id, targets: [] },
    { from: wok.id, to: bag.id, targets: [] }, { from: bag.id, to: pass.id, targets: [] }, { from: pass.id, to: board.id, targets: [] },
  ], layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  const ev = orderIn(601)
  assert.ok((await sequencer(ids.a, V).submit(ev)).ok)
  const orderId = ev.payload.order.id
  const refused = await sequencer(ids.a, V).submit({ ...ev, id: ulid(), type: 'kitchen.bumped', payload: { order_id: orderId, station_id: setIn.id } })
  assert.equal(refused.ok, false)

  const app = await getApp()
  const call = (method, url, body, headers = {}) => app.inject({
    method, url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body ? JSON.stringify(body) : undefined,
  })
  const p = (await call('POST', '/screen-api/pairings', { device: { width: 1920, height: 1080 } })).json()
  const scr = await ok(owner.post('/api/screens/screens/claim', { code: p.code, name: 'Status screen', venue_id: V }))
  const feed = async () => (await call('GET', '/screen-api/orders', null, { authorization: `Screen ${scr.id}.${p.secret}` })).json().orders
  let tile = (await feed()).boards.collect.preparing.find(t => t.number === '601')
  assert.deepEqual(tile.status, { name: 'In the kitchen', text: 'In the kitchen', look: 'light', colour: '#ff0000', anim: 'pulse', lamp: 1 })
  // The all-orders feed carries it too.
  assert.equal((await feed()).preparing.find(t => t.number === '601')?.status?.name, 'In the kitchen')
  // The wok bumps: the order passes Bagging.
  assert.ok((await sequencer(ids.a, V).submit({ ...ev, id: ulid(), type: 'kitchen.bumped', client_at: new Date(Date.now() + 1000).toISOString(), payload: { order_id: orderId, station_id: wok.id } })).ok)
  tile = (await feed()).boards.collect.preparing.find(t => t.number === '601')
  assert.equal(tile.status.text, 'Nearly there')
  assert.equal(tile.status.look, 'flag')
  // The screen designer lists the statuses (one per name).
  const data = await ok(owner.get('/api/screens/menu-data'))
  assert.deepEqual(data.order_statuses.map(s => s.name), ['Bagging', 'In the kitchen'])
  // Setters aren't on kitchen screens.
  const bad = await owner.patch(`/api/pos/devices/${screen.id}`, { name: 'Pass screen', settings: { station_ids: [setIn.id] } })
  assert.notEqual(bad.status, 200)

  await ok(owner.delete(`/api/screens/screens/${scr.id}`))
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: wok.id, targets: [] }, { from: wok.id, to: pass.id, targets: [] }], layout: {} }))
})

test('an Except link: every dish but the ones it names; saved, shared, copied and routed', async () => {
  const flow = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Except test' }))
  // The dish's section skips the wok (Except), so it takes the grill's link for every dish.
  const links = [
    { from: null, to: wok.id, targets: [{ kind: 'section', id: dish.section_id }], exclude: true },
    { from: null, to: grill.id, targets: [] },
    { from: wok.id, to: pass.id, targets: [] },
    { from: grill.id, to: pass.id, targets: [] },
  ]
  const toWok = list => list.find(l => l.to === wok.id && !l.from)
  // Except with nothing listed is a link for every dish.
  const bare = await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [{ from: null, to: wok.id, targets: [], exclude: true }], layout: {} }))
  assert.equal(bare.links[0].exclude, false)
  const saved = await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} }))
  assert.equal(toWok(saved.links).exclude, true)
  assert.equal(saved.links.find(l => l.to === grill.id).exclude, false)
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(toWok(setup.kds_flows.find(f => f.id === flow.id).links).exclude, true, 'the setup page has it')

  // Refused: leaving out every dish, an Except link out of a Splitter, a viewer, another tenant.
  const all = await owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [{ from: null, to: wok.id, targets: [{ kind: 'default' }], exclude: true }], layout: {} })
  assert.equal(all.status, 422)
  assert.match(all.json.error, /can't leave out every dish/)
  const box = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Except box', kind: 'balance', settings: {} }))
  const fromBox = await owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [
    { from: null, to: box.id, targets: [] }, { from: box.id, to: grill.id, targets: [] },
    { from: box.id, to: wok.id, targets: [{ kind: 'section', id: dish.section_id }], exclude: true },
  ], layout: {} })
  assert.equal(fromBox.status, 422)
  assert.match(fromBox.json.error, /remove their filters/)
  assert.equal((await as(A.viewer, ids.a).put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} })).status, 403)
  assert.equal((await as(B.owner, ids.b).put(`/api/pos/kds-flows/${flow.id}`, { links, layout: {} })).status, 404)
  assert.equal(toWok((await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_flows.find(f => f.id === flow.id).links).exclude, true, 'unchanged')

  // In use: the kitchen screen gets it, and the sequencer routes by it.
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: flow.id }))
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.equal(toWok(config.json.flow).exclude, true)
  assert.ok((await sequencer(ids.a, V).submit(orderIn(701))).ok)
  assert.deepEqual(await wayOf(701), sorted([grill.id, pass.id]), 'its section is left out of the wok')
  const other = orderIn(702)
  other.payload.order.items[0] = { ...other.payload.order.items[0], item_id: crypto.randomUUID(), section_id: crypto.randomUUID(), name: 'Something else' }
  assert.ok((await sequencer(ids.a, V).submit(other)).ok)
  assert.deepEqual(await wayOf(702), sorted([wok.id, pass.id]), 'the Except link comes before the link for every dish')

  // Copies keep it: this venue's, shared with every location, and back.
  const copy = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Except copy', copy_from: flow.id }))
  assert.equal(toWok(copy.links).exclude, true)
  const everywhere = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Except everywhere', copy_from: flow.id, shared: true }))
  const sharedLink = everywhere.links.find(l => !l.from && l.to === wok.id)
  assert.deepEqual([sharedLink.exclude, sharedLink.targets], [true, [{ kind: 'section', id: dish.section_id }]])
  const back = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Except back', copy_from: everywhere.id }))
  assert.equal(toWok(back.links).exclude, true)
  // A shared flow saved with an Except link keeps it.
  const sharedSave = await ok(owner.put(`/api/pos/kds-flows/${everywhere.id}`, { boxes: everywhere.boxes, links: everywhere.links, layout: {} }))
  assert.equal(sharedSave.links.find(l => !l.from && l.to === wok.id).exclude, true)

  // A revenue stream that goes: an Except link left with nothing takes every
  // dish; a plain link that named only it goes.
  const rs = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Except stream' }))
  await ok(owner.put(`/api/pos/kds-flows/${copy.id}`, { links: [
    { from: null, to: wok.id, targets: [{ kind: 'revenue_stream', id: rs.id }], exclude: true },
    { from: null, to: grill.id, targets: [{ kind: 'revenue_stream', id: rs.id }] },
  ], layout: {} }))
  await ok(owner.delete(`/api/pos/revenue-streams/${rs.id}`))
  const left = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).kds_flows.find(f => f.id === copy.id).links
  assert.deepEqual(left.map(l => [l.to, l.targets, l.exclude]), [[wok.id, [], false]])

  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  for (const f of [copy, back, everywhere, flow]) await ok(owner.delete(`/api/pos/kds-flows/${f.id}`))
  await ok(owner.delete(`/api/pos/kds-stations/${box.id}`))
})
