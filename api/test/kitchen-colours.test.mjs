// Kitchen screen colours and the pass's packing check (migration 207).
// Checked here: Ticket colours saved for a venue (cleaned, refused when
// wrong, only by Store tech manage, never another tenant's venue) and sent to
// the venue's kitchen screens with section colours by section id; dishes
// keeping their menu section; the pass ticking dishes off through the
// sequencer without sending the order on, prep stations refused, and with
// the station's Bump when every dish is ticked the last tick bumping it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sequencer } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'
import { menuSaveBody } from '../src/routes/menus.js'

let ids, owner, V, dish, section, grill, pass, screen, main, menuId

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

/** An online order of the fixtures' dish reaching the kitchen. */
async function orderIn(n) {
  const orderId = crypto.randomUUID()
  const r = await sequencer(ids.a, V).submit({
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: { id: 'web-' + orderId, order_id: orderId, number: String(n), items: [{ id: 'i' + n, item_id: dish.id, section_id: section.id, name: dish.name, qty: 1 }] } },
  })
  assert.ok(r.ok, r.error)
  return 'web-' + orderId
}

/** A kitchen tap from the pass screen. */
async function tap(type, payload) {
  const res = await device(screen, 'POST', '/pos-api/events', {
    events: [{ id: ulid(), type, payload, client_at: new Date().toISOString() }],
  })
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
  menuId = filled.ids.menu
  const menu = await ok(owner.get('/api/menus/' + menuId))
  section = menu.sections[0]
  dish = section.items[1]
  grill = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Zqx Grill', kind: 'prep' }))
  pass = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Zqx Pass', kind: 'expo' }))
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  main = setup.kds_flows.find(f => f.name === 'Main flow')
  await ok(owner.put(`/api/pos/kds-flows/${main.id}`, { links: [{ from: null, to: grill.id, targets: [] }, { from: grill.id, to: pass.id, targets: [] }], layout: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  screen = await linkDevice(owner, V, { kind: 'kds', name: 'Zqx Pass screen', settings: { station_ids: [grill.id, pass.id] } })
})
after(closeApp)

test('ticket colours: saved for the venue, cleaned, and sent to its kitchen screens by section', async () => {
  const before = await device(screen, 'GET', '/pos-api/config')
  assert.equal(before.status, 200, before.body)
  assert.deepEqual(before.json.colours, { states: {}, sections: {} }, 'nothing set: the standard look')

  const saved = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_colours: {
    states: { todo: '#ABCDEF', head_checked: '#123456' },
    sections: [{ name: '  ' + section.title.toUpperCase() + ' ', colour: '#FFCC00' }, { name: 'Zqx nothing like it', colour: '#00aaff' }, { name: section.title, colour: '#000000' }],
  } }))
  assert.deepEqual(saved.kds_colours, {
    states: { todo: '#abcdef', head_checked: '#123456' },
    sections: [{ name: section.title.toUpperCase(), colour: '#ffcc00' }, { name: 'Zqx nothing like it', colour: '#00aaff' }],
  }, 'lower case, trimmed, each section name once')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.settings.kds_colours, saved.kds_colours)
  const [row] = await sql`SELECT kds_colours FROM pos_settings WHERE venue_id = ${V} AND tenant_id = ${ids.a}`
  assert.deepEqual(row.kds_colours, saved.kds_colours, 'stored cleaned, not as sent')

  const config = await device(screen, 'GET', '/pos-api/config?version=' + encodeURIComponent(before.json.version))
  assert.notEqual(config.json.unchanged, true, 'a colour change is a new config')
  assert.deepEqual(config.json.colours.states, { todo: '#abcdef', head_checked: '#123456' })
  // Every section of the venue's menus with that name, by id; names with no section aren't sent.
  const named = await sql`
    SELECT s.id FROM menu_sections s JOIN menus m ON m.id = s.menu_id
     WHERE s.tenant_id = ${ids.a} AND lower(trim(s.title)) = lower(${section.title}) AND (m.venue_id IS NULL OR m.venue_id = ${V})`
  assert.ok(named.length >= 1)
  assert.deepEqual(Object.keys(config.json.colours.sections).sort(), named.map(r => r.id).sort())
  assert.ok(Object.values(config.json.colours.sections).every(c => c === '#ffcc00'))

  // A section renamed in the draft (not published yet) keeps its colour by its
  // published name: that is what the tills still send.
  const draft = menuSaveBody(await ok(owner.get('/api/menus/' + menuId)))
  draft.sections.find(s => s.id === section.id).title = 'Zqx renamed in the draft'
  await ok(owner.patch('/api/menus/' + menuId, draft))
  const renamed = await device(screen, 'GET', '/pos-api/config')
  assert.equal(renamed.json.colours.sections[section.id], '#ffcc00', 'the published name still has the colour')
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_colours: { states: {}, sections: [{ name: 'Zqx renamed in the draft', colour: '#123123' }] } }))
  const byDraft = await device(screen, 'GET', '/pos-api/config')
  assert.equal(byDraft.json.colours.sections[section.id], '#123123', 'and the draft name (a section renamed before publishing)')
  draft.sections.find(s => s.id === section.id).title = section.title
  await ok(owner.patch('/api/menus/' + menuId, draft))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_colours: saved.kds_colours }))

  // Wrong colours, unknown states and empty names are refused; nothing changes.
  for (const bad of [{ states: { todo: 'red' } }, { states: { nope: '#000000' } }, { sections: [{ name: '', colour: '#000000' }] }, { sections: [{ name: 'X', colour: '#00' }] }]) {
    const res = await owner.patch(`/api/pos/venues/${V}/settings`, { kds_colours: bad })
    assert.equal(res.status, 400, JSON.stringify(bad))
  }
  assert.deepEqual((await ok(owner.get(`/api/pos/venues/${V}/setup`))).settings.kds_colours, saved.kds_colours)
  // Store tech view can't change them; another tenant can't touch this venue.
  assert.equal((await as(A.viewer, ids.a).patch(`/api/pos/venues/${V}/settings`, { kds_colours: { states: {} } })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch(`/api/pos/venues/${V}/settings`, { kds_colours: { states: {} } })).status, 404)

  // Cleared: back to the standard look.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_colours: { states: {}, sections: [] } }))
  const cleared = await device(screen, 'GET', '/pos-api/config')
  assert.deepEqual(cleared.json.colours, { states: {}, sections: {} })
})

test('the pass ticks dishes off without sending the order on; Bump when every dish is ticked bumps on the last tick', async () => {
  const first = await orderIn(701)
  let o = await stateOf(first)
  assert.equal(o.state.items[0].section_id, section.id, 'the dish keeps its menu section')
  assert.equal((await tap('kitchen.bumped', { order_id: first, station_id: grill.id })).ok, true)
  // A prep station can't tick dishes off: it marks them done.
  const atGrill = await tap('kitchen.item_checked', { order_id: first, station_id: grill.id, item_id: 'i701', checked: true })
  assert.equal(atGrill.ok, false)
  assert.equal(atGrill.code, 'station')

  const ticked = await tap('kitchen.item_checked', { order_id: first, station_id: pass.id, item_id: 'i701', checked: true })
  assert.equal(ticked.ok, true, ticked.error)
  o = await stateOf(first)
  assert.equal(o.status, 'active', 'every dish ticked off: still waiting for READY')
  assert.ok(o.state.items[0].checked[pass.id])
  assert.equal(o.state.items[0].done[pass.id], undefined)
  assert.equal(o.state.bumps.filter(b => b.station_id === pass.id).length, 0)
  assert.equal((await sql`SELECT count(*)::int AS n FROM kds_log WHERE tenant_id = ${ids.a} AND station_id = ${pass.id}`)[0].n, 0)
  // READY sends it on.
  assert.equal((await tap('kitchen.bumped', { order_id: first, station_id: pass.id })).ok, true)
  assert.equal((await stateOf(first)).status, 'ready')

  // The pass set to bump when every dish is ticked: the last tick is the bump.
  const st = pass.settings || {}
  assert.equal((await owner.patch(`/api/pos/kds-stations/${pass.id}`, { name: pass.name, kind: 'expo', settings: { ...st, bump_when_checked: 'yes' } })).status, 400)
  await ok(owner.patch(`/api/pos/kds-stations/${pass.id}`, { name: pass.name, kind: 'expo', settings: { ...st, bump_when_checked: true } }))
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(setup.kds_stations.find(s => s.id === pass.id).settings.bump_when_checked, true)
  const config = await device(screen, 'GET', '/pos-api/config')
  assert.equal(config.json.stations.find(s => s.id === pass.id).settings.bump_when_checked, true)

  const second = await orderIn(702)
  assert.equal((await tap('kitchen.bumped', { order_id: second, station_id: grill.id })).ok, true)
  const last = await tap('kitchen.item_checked', { order_id: second, station_id: pass.id, item_id: 'i702', checked: true })
  assert.equal(last.ok, true, last.error)
  o = await stateOf(second)
  assert.equal(o.status, 'ready')
  assert.ok(o.state.items[0].done[pass.id])
  assert.equal(o.state.bumps.find(b => b.station_id === pass.id).by_items, true)
  const logged = await sql`SELECT kind, items FROM kds_log WHERE tenant_id = ${ids.a} AND station_id = ${pass.id} AND kitchen_order_id = ${second}`
  assert.deepEqual(logged.map(r => [r.kind, r.items]), [['bump', 1]])
})
