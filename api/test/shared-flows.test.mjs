// Kitchen flows shared by every location (migration 192). A shared flow's
// boxes are each location's stations of the same names, and its revenue
// stream and "sent from" (till / kiosk) filters are names too, so one flow
// sends each location's dishes to its own stations. Checked here: making,
// naming and ordering shared flows; saving one and its refusals; the setup
// page and the kitchen screen; orders at two locations following one shared
// flow to their own stations (the bar's kiosk to the bar); copies both ways;
// deleting one in use; a viewer and another tenant.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sequencer } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, W, H, wings, fries, eatIn
const st = { W: {}, H: {} }
const dev = { W: {}, H: {} }
let shared
const box = (name, kind = 'prep') => ({ id: crypto.randomUUID(), name, kind })
const B1 = { grill: box('Zqx Grill'), fryer: box('Zqx Fryer'), bar: box('Zqx Bar'), pass: box('Zqx Pass', 'expo') }
const sorted = list => [...list].sort()

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

/** A kiosk's order of wings and fries reaching the kitchen at venue V (as the kiosk sends it). */
async function kioskOrder(V, kiosk) {
  const seq = sequencer(ids.a, V)
  const check = ulid()
  const at = () => new Date().toISOString()
  const ev = (type, payload) => ({ id: ulid(), venue_id: V, device_id: kiosk.id, staff_id: kiosk.id, check_id: check, type, payload, client_at: at() })
  const lines = [wings, fries].map(d => ({ id: ulid(), item_id: d.id, section_id: d.section_id, name: d.name, qty: 1, unit_price: 500, modifiers: [], vat_rate: 20 }))
  for (const e of [
    ev('check.opened', { mode: 'counter', order_type_id: eatIn }),
    ...lines.map(l => ev('line.added', { line: l })),
    ev('lines.sent', { send_id: ulid(), line_ids: lines.map(l => l.id), held_course_ids: [] }),
  ]) {
    const r = await seq.submit(e)
    assert.ok(r.ok, e.type + ': ' + r.error)
  }
  const [row] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND check_id = ${check}`
  assert.ok(row, 'the order reached the kitchen')
  const way = itemId => sorted(Object.keys(row.state.items.find(i => i.item_id === itemId).route))
  return { wings: way(wings.id), fries: way(fries.id) }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  W = filled.ids.venue
  H = filled.ids.venue2
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  const sec = menu.sections[0]
  wings = { ...sec.items[1], section_id: sec.id }
  fries = { ...sec.items[0], section_id: sec.id }
  const setup = await ok(owner.get(`/api/pos/venues/${W}/setup`))
  eatIn = setup.order_types.find(t => t.is_active).id
  // Ware has a grill, fryer, bar and pass; Hertford a grill and pass, named
  // with other cases and spaces, and no fryer or bar.
  for (const [key, name, kind] of [['grill', 'Zqx Grill', 'prep'], ['fryer', 'ZQX FRYER', 'prep'], ['bar', 'Zqx Bar', 'prep'], ['pass', 'Zqx Pass', 'expo']]) {
    st.W[key] = await ok(owner.post(`/api/pos/venues/${W}/kds-stations`, { name, kind }))
  }
  for (const [key, name, kind] of [['grill', 'zqx  grill', 'prep'], ['pass', ' Zqx Pass', 'expo']]) {
    st.H[key] = await ok(owner.post(`/api/pos/venues/${H}/kds-stations`, { name, kind }))
  }
  dev.W.bar = await linkDevice(owner, W, { kind: 'kiosk', name: 'Bar kiosk' })
  dev.W.front = await linkDevice(owner, W, { kind: 'kiosk', name: 'Front kiosk' })
  dev.H.front = await linkDevice(owner, H, { kind: 'kiosk', name: 'Front kiosk' })
  dev.H.screen = await linkDevice(owner, H, { kind: 'kds', name: 'Hertford pass screen' })
})
after(closeApp)

test('a shared flow: made at one location, listed at every location after its own flows; names', async () => {
  shared = await ok(owner.post(`/api/pos/venues/${W}/kds-flows`, { name: 'Zqx All sites', shared: true }))
  assert.equal(shared.shared, true)
  assert.deepEqual(shared.boxes, [])
  for (const V of [W, H]) {
    const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
    const last = setup.kds_flows[setup.kds_flows.length - 1]
    assert.equal(last.id, shared.id, 'the newest shared flow last')
    const firstShared = setup.kds_flows.findIndex(f => f.shared)
    assert.ok(setup.kds_flows.slice(firstShared).every(f => f.shared), 'after the location\'s own flows')
    assert.ok(firstShared > 0, 'each location has its own too')
    assert.deepEqual(sorted(setup.kds_locations.map(v => v.id)), sorted([W, H]))
    assert.ok(setup.kds_shared_names.device.includes('Front kiosk'))
    assert.equal(setup.kds_shared_names.device.filter(n => n === 'Front kiosk').length, 1, 'each name once')
    assert.ok(setup.kds_locations.every(v => v.active_flow_id), 'every location has a flow in use')
  }
  // A location's own flow can't take a shared flow's name, nor a shared one an own flow's anywhere.
  assert.equal((await owner.post(`/api/pos/venues/${H}/kds-flows`, { name: ' zqx all SITES' })).status, 422)
  assert.equal((await owner.post(`/api/pos/venues/${H}/kds-flows`, { name: 'Main flow', shared: true })).status, 422)
  const wOwn = (await ok(owner.get(`/api/pos/venues/${W}/setup`))).kds_flows.find(f => !f.shared)
  assert.equal((await owner.patch(`/api/pos/kds-flows/${wOwn.id}`, { name: 'Zqx all sites' })).status, 422)
  // A new location lists the shared flows only (no Main flow is made for it while there are any).
  const york = await ok(owner.post('/api/venues', { name: 'Zqx York', slug: 'zqx-york-flows', timezone: 'Europe/London' }))
  const yFlows = (await ok(owner.get(`/api/pos/venues/${york.id}/setup`))).kds_flows
  assert.ok(yFlows.length && yFlows.every(f => f.shared))
  // The shared flows' order.
  const second = await ok(owner.post(`/api/pos/venues/${H}/kds-flows`, { name: 'Zqx All sites 2', shared: true }))
  const before = (await ok(owner.get(`/api/pos/venues/${W}/setup`))).kds_flows.filter(f => f.shared).map(f => f.id)
  const order = [second.id, ...before.filter(id => id !== second.id)]
  await ok(owner.put('/api/pos/kds-flows/shared/order', { ids: order }))
  const listed = (await ok(owner.get(`/api/pos/venues/${W}/setup`))).kds_flows.filter(f => f.shared).map(f => f.id)
  assert.deepEqual(listed, order)
  assert.equal((await ok(owner.get(`/api/pos/venues/${H}/setup`))).kds_flows.filter(f => f.shared)[0].id, second.id, 'the same order at every location')
  await ok(owner.delete(`/api/pos/kds-flows/${second.id}`))
})

test('saving a shared flow: boxes by name, filters by name; what each location lacks; refusals', async () => {
  const links = [
    { from: null, to: B1.grill.id, targets: [] },
    { from: null, to: B1.fryer.id, targets: [{ kind: 'item', id: fries.id }] },
    { from: null, to: B1.bar.id, targets: [{ kind: 'device', name: 'Bar kiosk' }] },
    { from: B1.grill.id, to: B1.pass.id, targets: [] },
    { from: B1.fryer.id, to: B1.pass.id, targets: [] },
  ]
  const body = { boxes: Object.values(B1), links, layout: { start: { x: 10, y: 10 }, [B1.grill.id]: { x: 300, y: 10 }, nope: { x: 1, y: 1 } } }
  const saved = await ok(owner.put(`/api/pos/kds-flows/${shared.id}`, body))
  assert.equal(saved.links.length, 5)
  assert.deepEqual(saved.links[2].targets, [{ kind: 'device', name: 'Bar kiosk' }])
  assert.deepEqual(Object.keys(saved.layout).sort(), sorted(['start', B1.grill.id]), 'only boxes keep a place')
  const lacks = saved.warnings.find(w => /Hertford has no/.test(w))
  assert.match(lacks, /Zqx Fryer/)
  assert.match(lacks, /Zqx Bar/)

  const put = b => owner.put(`/api/pos/kds-flows/${shared.id}`, b)
  assert.equal((await put({ ...body, boxes: [...body.boxes, box(' zqx grill ')] })).status, 422, 'two boxes of one name')
  assert.equal((await put({ ...body, links: [...links, { from: null, to: crypto.randomUUID(), targets: [] }] })).status, 422, 'a link to no box')
  const byId = await put({ ...body, links: [...links, { from: null, to: B1.bar.id, targets: [{ kind: 'device', id: dev.W.bar.id }] }] })
  assert.equal(byId.status, 422, 'a shared flow names tills, not their ids')
  assert.match(byId.json.error, /till or kiosk name/)
  const otherDish = (await sql`SELECT id FROM menu_items WHERE tenant_id = ${ids.b} LIMIT 1`)[0]
  if (otherDish) {
    assert.equal((await put({ ...body, links: [...links, { from: null, to: B1.bar.id, targets: [{ kind: 'item', id: otherDish.id }] }] })).status, 422, 'another tenant\'s dish')
  }
  assert.equal((await put({ ...body, links: [...links, { from: B1.pass.id, to: B1.grill.id, targets: [] }] })).status, 422, 'a circle')
  // A viewer looks; another tenant doesn't find it.
  assert.equal((await as(A.viewer, ids.a).put(`/api/pos/kds-flows/${shared.id}`, body)).status, 403)
  assert.equal((await as(B.owner, ids.b).put(`/api/pos/kds-flows/${shared.id}`, body)).status, 404)
  assert.equal((await as(B.owner, ids.b).delete(`/api/pos/kds-flows/${shared.id}`)).status, 404)
  const bVenue = (await sql`SELECT id FROM venues WHERE tenant_id = ${ids.b} LIMIT 1`)[0]
  if (bVenue) {
    assert.equal((await as(B.owner, ids.b).post(`/api/pos/venues/${bVenue.id}/kds-flows`, { name: 'Theirs', copy_from: shared.id })).status, 404)
  }
  const setup = await ok(owner.get(`/api/pos/venues/${H}/setup`))
  const listed = setup.kds_flows.find(f => f.id === shared.id)
  assert.deepEqual(listed.boxes.map(b => b.name), Object.values(B1).map(b => b.name))
  assert.equal(listed.links.length, 5)
})

test('orders at two locations follow the shared flow to their own stations; the bar kiosk to the bar', async () => {
  for (const V of [W, H]) await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: shared.id }))

  // Ware: wings to its grill and pass, fries to its fryer (the dish link wins); from the bar kiosk wings go to the bar.
  const front = await kioskOrder(W, dev.W.front)
  assert.deepEqual(front.wings, sorted([st.W.grill.id, st.W.pass.id]))
  assert.deepEqual(front.fries, sorted([st.W.fryer.id, st.W.pass.id]))
  const bar = await kioskOrder(W, dev.W.bar)
  assert.deepEqual(bar.wings, [st.W.bar.id], 'sent from the bar kiosk: closer than the link for every dish')
  assert.deepEqual(bar.fries, sorted([st.W.fryer.id, st.W.pass.id]), 'the dish link is closer still')

  // Hertford has no fryer or bar: those links are left out, everything goes to its grill and pass.
  const h = await kioskOrder(H, dev.H.front)
  assert.deepEqual(h.wings, sorted([st.H.grill.id, st.H.pass.id]))
  assert.deepEqual(h.fries, sorted([st.H.grill.id, st.H.pass.id]))

  // Hertford's kitchen screen gets the flow at Hertford: its own stations.
  const config = await device(dev.H.screen, 'GET', '/pos-api/config')
  assert.equal(config.status, 200, config.body)
  assert.equal(config.json.active_flow_id, shared.id)
  const listed = config.json.flows.find(f => f.id === shared.id)
  assert.equal(listed.shared, true)
  assert.deepEqual(sorted(listed.station_ids), sorted([st.H.grill.id, st.H.pass.id]))
  assert.ok(config.json.flow.every(l => [st.H.grill.id, st.H.pass.id].includes(l.to)), 'never another location\'s station')
  // Setup lists where it's in use.
  const setup = await ok(owner.get(`/api/pos/venues/${W}/setup`))
  assert.ok(setup.kds_locations.filter(v => v.id === W || v.id === H).every(v => v.active_flow_id === shared.id))
})

test('a shared flow in use somewhere can\'t be deleted; switching away frees it', async () => {
  const del = await owner.delete(`/api/pos/kds-flows/${shared.id}`)
  assert.equal(del.status, 422)
  assert.match(del.json.error, /in use at/)
  const setupW = await ok(owner.get(`/api/pos/venues/${W}/setup`))
  const own = setupW.kds_flows.find(f => !f.shared)
  await ok(owner.put(`/api/pos/venues/${W}/kds-flows/active`, { flow_id: own.id }))
  const still = await owner.delete(`/api/pos/kds-flows/${shared.id}`)
  assert.equal(still.status, 422, 'still in use at Hertford')
  assert.doesNotMatch(still.json.error, new RegExp(setupW.venue.name), 'Ware no longer named')
})

test('copies both ways: a location\'s flow shared, a shared flow as a location\'s own', async () => {
  // Ware's own flow with a sent-from link becomes a shared one: stations become boxes by name, the kiosk a name.
  const own = await ok(owner.post(`/api/pos/venues/${W}/kds-flows`, { name: 'Zqx Ware only' }))
  await ok(owner.put(`/api/pos/kds-flows/${own.id}`, {
    links: [
      { from: null, to: st.W.grill.id, targets: [] },
      { from: null, to: st.W.bar.id, targets: [{ kind: 'device', id: dev.W.bar.id }] },
      { from: st.W.grill.id, to: st.W.pass.id, targets: [] },
    ],
    layout: { [st.W.grill.id]: { x: 400, y: 40 } },
  }))
  const viaDevice = await owner.put(`/api/pos/kds-flows/${own.id}`, { links: [{ from: null, to: st.W.bar.id, targets: [{ kind: 'device', id: dev.H.front.id }] }], layout: {} })
  assert.equal(viaDevice.status, 422, 'a location\'s own flow names its own tills only')
  const sh = await ok(owner.post(`/api/pos/venues/${W}/kds-flows`, { name: 'Zqx Shared copy', copy_from: own.id, shared: true }))
  assert.equal(sh.shared, true)
  const wStations = (await ok(owner.get(`/api/pos/venues/${W}/setup`))).kds_stations
  assert.deepEqual(sorted(sh.boxes.map(b => b.name)), sorted(wStations.map(s => s.name)), 'every station in the flow becomes a box')
  const barLink = sh.links.find(l => l.to === st.W.bar.id)
  assert.deepEqual(barLink.targets, [{ kind: 'device', name: 'Bar kiosk' }])
  assert.deepEqual(sh.layout[st.W.grill.id], { x: 400, y: 40 }, 'the boxes keep their places')

  // The shared flow as Hertford's own: Hertford's stations of those names, the bar left out.
  const back = await ok(owner.post(`/api/pos/venues/${H}/kds-flows`, { name: 'Zqx Hertford copy', copy_from: shared.id }))
  assert.equal(back.shared, false)
  assert.ok(back.links.every(l => [st.H.grill.id, st.H.pass.id].includes(l.to)))
  assert.equal(back.links.length, 2, 'grill and grill to pass; the fryer and bar links had no station here')
  const hStations = (await ok(owner.get(`/api/pos/venues/${H}/setup`))).kds_stations
  const offIds = hStations.filter(s => ![st.H.grill.id, st.H.pass.id].includes(s.id)).map(s => s.id)
  assert.deepEqual(sorted(back.off_station_ids), sorted(offIds), 'stations it has no box for are left out')
  await ok(owner.delete(`/api/pos/kds-flows/${sh.id}`))
  await ok(owner.delete(`/api/pos/kds-flows/${own.id}`))
  await ok(owner.delete(`/api/pos/kds-flows/${back.id}`))
})
