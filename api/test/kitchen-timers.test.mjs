// Kitchen flow timers (migration 265, OUTSTANDING 44.9): saved on a venue's
// own flow and on a shared one, refused when they don't end at a box someone
// taps, carried by copies, and worked out in the kitchen report from the
// kitchen orders of the period (a shared flow's timer at a box the venue
// lacks is listed as missing).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sequencer } from '../src/services/posSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, dish, wok, pass, board, main, screen

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
  return { status: res.statusCode, json: res.json() }
}

function orderIn(n) {
  const orderId = crypto.randomUUID()
  return {
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: { id: 'web-' + orderId, order_id: orderId, number: String(n), items: [{ id: 'i' + n, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1 }] } },
  }
}

async function bump(n, station) {
  const [row] = await sql`SELECT id FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = ${String(n)}`
  const r = await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), venue_id: V, type: 'kitchen.bumped', client_at: new Date().toISOString(), payload: { order_id: row.id, station_id: station.id } }] })
  assert.equal(r.json.results[0].ok, true, r.json.results[0].error)
}

const today = () => new Date().toISOString().slice(0, 10)

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
  pass = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Timer pass', kind: 'expo' }))
  board = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Timer board', kind: 'board' }))
  main = setup.kds_flows.find(f => f.name === 'Main flow')
  await ok(owner.put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: main.id }))
  screen = await linkDevice(owner, V, { kind: 'kds', name: 'Timer screen', settings: {} })
})
after(closeApp)

const links = () => [
  { from: null, to: wok.id, targets: [] },
  { from: wok.id, to: pass.id, targets: [] },
  { from: pass.id, to: board.id, targets: [] },
]

test('a venue\'s flow keeps its timers; ones that don\'t end on a tap are refused', async () => {
  const saved = await ok(owner.put(`/api/pos/kds-flows/${main.id}`, {
    links: links(), layout: {},
    timers: [
      { id: 'ticket', name: 'Ticket time', from: 'start', to: pass.id, per: 'ticket', target_mins: 8 },
      { from: wok.id, from_when: 'done', to: pass.id, target_mins: 3 },
    ],
  }))
  assert.equal(saved.timers.length, 2)
  assert.equal(saved.timers[0].id, 'ticket')
  assert.match(saved.timers[1].id, /^tm-/)
  assert.deepEqual([saved.timers[1].per, saved.timers[1].from_when, saved.timers[1].name], ['dish', 'done', ''])

  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.kds_flows.find(f => f.id === main.id).timers.map(t => t.id), saved.timers.map(t => t.id))

  const toBoard = await owner.put(`/api/pos/kds-flows/${main.id}`, { links: links(), layout: {}, timers: [{ from: 'start', to: board.id, target_mins: 5 }] })
  assert.equal(toBoard.status, 422)
  assert.match(toBoard.json.error, /must end at a box someone taps/)
  const stranger = await owner.put(`/api/pos/kds-flows/${main.id}`, { links: links(), layout: {}, timers: [{ from: crypto.randomUUID(), to: pass.id, target_mins: 5 }] })
  assert.equal(stranger.status, 422)
  assert.match(stranger.json.error, /isn't in this flow/)
  const offFlow = await owner.put(`/api/pos/kds-flows/${main.id}`, { links: links().slice(0, 1), layout: {}, off_station_ids: [pass.id], timers: [{ from: 'start', to: pass.id, target_mins: 5 }] })
  assert.equal(offFlow.status, 422, 'a station left out of the flow can\'t end a timer')
  // A save without timers clears them (whole-flow save).
  const kept = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(kept.kds_flows.find(f => f.id === main.id).timers.length, 2, 'refused saves changed nothing')
})

test('the kitchen report works the timers out from the period\'s kitchen orders', async () => {
  const seqr = sequencer(ids.a, V)
  assert.ok((await seqr.submit(orderIn(701))).ok)
  assert.ok((await seqr.submit(orderIn(702))).ok)
  await bump(701, wok)
  await bump(701, pass)
  await bump(702, wok)
  const report = await ok(owner.get(`/api/pos/venues/${V}/kitchen-report?from=${today()}&to=${today()}`))
  assert.equal(report.timers_capped, false)
  const ticket = report.timers.find(t => t.id === 'ticket')
  assert.equal(ticket.name, 'Ticket time')
  assert.equal(ticket.flow_name, 'Main flow')
  assert.equal(ticket.flow_in_use, true)
  assert.equal(ticket.missing, false)
  assert.equal(ticket.count, 1, 'order 702 is still on its way to the pass')
  assert.equal(ticket.on_time, 1)
  assert.equal(ticket.slowest[0].number, '701')
  const wokToPass = report.timers.find(t => t.id !== 'ticket')
  assert.equal(wokToPass.name, wok.name + ' to Timer pass')
  assert.equal(wokToPass.from_name, wok.name)
  assert.equal(wokToPass.count, 1)
  // Another period has none.
  const empty = await ok(owner.get(`/api/pos/venues/${V}/kitchen-report?from=2020-01-01&to=2020-01-02`))
  assert.equal(empty.timers.find(t => t.id === 'ticket').count, 0)
})

test('copies and shared flows carry timers; a box the venue lacks is listed as missing', async () => {
  const shared = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Timers for all', copy_from: main.id, shared: true }))
  assert.equal(shared.shared, true)
  assert.deepEqual(shared.timers.map(t => t.id).sort(), ['ticket', shared.timers.find(t => t.id !== 'ticket').id].sort())
  // Box ids are the station ids they came from.
  assert.equal(shared.timers.find(t => t.id === 'ticket').to, pass.id)

  // A box no location has, with a timer to it.
  const ghost = crypto.randomUUID()
  const boxes = [...shared.boxes, { id: ghost, name: 'Nowhere expo', kind: 'expo' }]
  const res = await ok(owner.put(`/api/pos/kds-flows/${shared.id}`, {
    boxes, links: shared.links, layout: {},
    timers: [...shared.timers, { id: 'ghost', from: 'start', to: ghost, target_mins: 4 }],
  }))
  assert.equal(res.timers.length, 3)
  const tapless = await owner.put(`/api/pos/kds-flows/${shared.id}`, { boxes, links: shared.links, layout: {}, timers: [{ from: 'start', to: shared.boxes.find(b => b.kind === 'board').id, target_mins: 4 }] })
  assert.equal(tapless.status, 422)

  const report = await ok(owner.get(`/api/pos/venues/${V}/kitchen-report?from=${today()}&to=${today()}`))
  const mine = report.timers.filter(t => t.flow_id === shared.id)
  assert.equal(mine.length, 3)
  assert.equal(mine.find(t => t.id === 'ghost').missing, true)
  assert.equal(mine.find(t => t.id === 'ghost').to_name, 'Nowhere expo')
  assert.equal(mine.find(t => t.id === 'ticket').count, 1, 'a shared flow\'s timer counts the venue\'s dishes')

  // Back to a venue's own flow: boxes become the venue's stations; the missing box's timer goes.
  const own = await ok(owner.post(`/api/pos/venues/${V}/kds-flows`, { name: 'Timers here', copy_from: shared.id }))
  assert.deepEqual(own.timers.map(t => t.id).sort(), mine.filter(t => !t.missing).map(t => t.id).sort())
  assert.equal(own.timers.find(t => t.id === 'ticket').to, pass.id)
})
