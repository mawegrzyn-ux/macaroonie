// Kitchen printers and who prints (migration 191): a printer box in the
// kitchen flow prints the dishes that reach it (shared/pos/kitchenPrint.js);
// a network printer's tickets are collected by the venue hub (hub/), a
// printer plugged into a till or kitchen screen by that device; the hub
// reports its printers; a ticket collected and never reported on is
// collected again; a failed one can be printed again; orders for later print
// when their time comes (the minute sweep); refusals.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { sequencer } from '../src/services/posSvc.js'
import { kitchenPrintsDue } from '../src/services/kitchenSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, dish, flow, wok, net, plugged, box, plugBox, hub, till, screen, kiosk

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

function orderIn(n, { fireAt = null } = {}) {
  const orderId = crypto.randomUUID()
  return {
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: {
      id: 'web-' + orderId, order_id: orderId, number: String(n), guest: 'Sam', fire_at: fireAt,
      items: [{ id: 'i' + n, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 2 }],
    } },
  }
}
const jobsFor = (orderNo, extra = sql``) => sql`
  SELECT j.* FROM pos_print_jobs j
   WHERE j.tenant_id = ${ids.a} AND j.venue_id = ${V} AND j.kitchen_order_id IN (
     SELECT id FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = ${String(orderNo)}) ${extra}
   ORDER BY j.created_at`

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[1], section_id: menu.sections[0].id }
  hub = await linkDevice(owner, V, { kind: 'hub', name: 'Back office hub' })
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Bar till' })
  screen = await linkDevice(owner, V, { kind: 'kds', name: 'Grill screen' })
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Kiosk 1' })
  net = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Grill printer', host: '10.0.0.20', port: 9100, columns: 42 }))
  plugged = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Bar printer', connection: 'device', device_id: till.id }))
  box = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Grill tickets', kind: 'printer', settings: { printer_id: net.id } }))
  plugBox = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Bar tickets', kind: 'printer', settings: { printer_id: plugged.id } }))
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  wok = setup.kds_stations.find(s => s.kind === 'prep')
  flow = setup.kds_flows.find(f => f.id === setup.kds_active_flow_id)
  await ok(owner.put(`/api/pos/kds-flows/${flow.id}`, { links: [
    { from: null, to: wok.id, targets: [] },
    { from: null, to: box.id, targets: [] },
    { from: wok.id, to: plugBox.id, targets: [] },
  ], layout: {} }))
})
after(closeApp)

test('printers: plugged into a till or kitchen screen of this venue, printer boxes print on this venue\'s printers', async () => {
  const noDevice = await owner.post(`/api/pos/venues/${V}/printers`, { name: 'X', connection: 'device' })
  assert.equal(noDevice.status, 422)
  assert.match(noDevice.json.error, /plugged into/)
  // A kiosk's printer prints its own receipts, never a printer box's tickets.
  const onKiosk = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Kiosk printer', kind: 'receipt', connection: 'device', device_id: kiosk.id }))
  const kioskBox = await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Kiosk tickets', kind: 'printer', settings: { printer_id: onKiosk.id } })
  assert.equal(kioskBox.status, 422)
  assert.match(kioskBox.json.error, /kiosk/)
  await ok(owner.delete(`/api/pos/printers/${onKiosk.id}`))
  assert.equal((await owner.post(`/api/pos/venues/${V}/printers`, { name: 'X', connection: 'device', device_id: hub.id })).status, 422, 'not a hub')
  const onScreen = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Pass printer', connection: 'device', device_id: screen.id }))
  assert.equal(onScreen.device_id, screen.id)
  await ok(owner.delete(`/api/pos/printers/${onScreen.id}`))
  // Another venue's printer can't be a printer box's.
  const [other] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${V} LIMIT 1`
  const otherPrinter = await ok(owner.post(`/api/pos/venues/${other.id}/printers`, { name: 'Elsewhere', host: '10.0.0.9' }))
  const bad = await owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Wrong', kind: 'printer', settings: { printer_id: otherPrinter.id } })
  assert.equal(bad.status, 422)
  // The other tenant can't use these at all.
  const b = as(B.owner, ids.b)
  assert.equal((await b.patch(`/api/pos/printers/${net.id}`, { name: 'Mine' })).status, 404)
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const p = setup.printers.find(x => x.id === plugged.id)
  assert.equal(p.connection, 'device')
  assert.deepEqual(p.jobs, { waiting: 0, failed: 0 })
  assert.equal(setup.routes, undefined, 'printer routing is gone: the kitchen flow decides')
})

test('the venue hub: its own config, printing and reporting only', async () => {
  const cfg = await device(hub, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, cfg.body)
  assert.equal(cfg.json.kind, 'hub')
  const names = cfg.json.printers.map(p => p.name)
  assert.ok(names.includes('Grill printer'))
  assert.ok(!names.includes('Bar printer'), 'a printer plugged into a till isn\'t the hub\'s')
  assert.equal(cfg.json.printers.find(p => p.id === net.id).host, '10.0.0.20')
  assert.equal((await device(hub, 'GET', '/pos-api/kitchen/sync')).status, 403)
  assert.equal((await device(hub, 'POST', '/pos-api/events', { events: [] })).status, 403)
  const st = await device(hub, 'POST', '/pos-api/hub/status', { app_version: '1.0.0', printers: [
    { id: net.id, online: true, paper_low: true },
    { id: plugged.id, online: false },
  ] })
  assert.equal(st.status, 200, st.body)
  const [grill] = await sql`SELECT status, status_at FROM pos_printers WHERE id = ${net.id}`
  assert.deepEqual(grill.status, { online: true, paper_low: true, paper_out: false, cover_open: false, error: null })
  assert.ok(grill.status_at)
  const [bar] = await sql`SELECT status FROM pos_printers WHERE id = ${plugged.id}`
  assert.equal(bar.status, null, 'the hub reports only its own printers')
  const [d] = await sql`SELECT app_version FROM pos_devices WHERE id = ${hub.id}`
  assert.equal(d.app_version, '1.0.0')
  assert.equal((await device(till, 'POST', '/pos-api/hub/status', { printers: [] })).status, 403)
})

test('a dish prints at the printer boxes it reaches; the hub and the till each collect their own', async () => {
  const r = await sequencer(ids.a, V).submit(orderIn(501))
  assert.ok(r.ok, r.error)
  let jobs = await jobsFor(501)
  assert.deepEqual(jobs.map(j => [j.printer_id, j.station_id, j.kind]), [[net.id, box.id, 'kitchen']], 'the grill printer straight away; the bar printer waits for the wok')
  // The till can't take the hub's ticket; the hub can.
  assert.deepEqual((await device(till, 'POST', '/pos-api/print-jobs/claim', {})).json, [])
  assert.equal((await device(kiosk, 'POST', '/pos-api/print-jobs/claim', {})).status, 403)
  const got = await device(hub, 'POST', '/pos-api/print-jobs/claim', { limit: 10 })
  assert.deepEqual(got.json.map(j => j.id), [jobs[0].id])
  assert.ok(got.json[0].ops.some(o => /2 x/.test(o.text || '')), 'the ticket itself')
  assert.equal((await device(till, 'POST', `/pos-api/print-jobs/${jobs[0].id}/status`, { status: 'printed' })).status, 404, 'only who collected it reports on it')
  assert.equal((await device(hub, 'POST', `/pos-api/print-jobs/${jobs[0].id}/status`, { status: 'printed' })).status, 200)

  // The wok bumps: the dish reaches the bar printer, plugged into the till.
  const [o] = await sql`SELECT id FROM kds_orders WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = '501'`
  const bump = await device(screen, 'POST', '/pos-api/events', { events: [{ id: ulid(), type: 'kitchen.bumped', payload: { order_id: o.id, station_id: wok.id }, client_at: new Date().toISOString() }] })
  assert.equal(bump.status, 200, bump.body)
  assert.ok(bump.json.results[0].ok, JSON.stringify(bump.json.results[0]))
  jobs = await jobsFor(501, sql`AND j.printer_id = ${plugged.id}`)
  assert.equal(jobs.length, 1)
  assert.deepEqual((await device(hub, 'POST', '/pos-api/print-jobs/claim', {})).json, [], 'not the hub\'s')
  const mine = await device(till, 'POST', '/pos-api/print-jobs/claim', {})
  assert.deepEqual(mine.json.map(j => j.id), [jobs[0].id])
  // Collected but never reported (the till went off): collected again after two minutes.
  assert.deepEqual((await device(till, 'POST', '/pos-api/print-jobs/claim', {})).json, [])
  await sql`UPDATE pos_print_jobs SET claimed_at = now() - interval '3 minutes' WHERE id = ${jobs[0].id}`
  const again = await device(till, 'POST', '/pos-api/print-jobs/claim', {})
  assert.deepEqual(again.json.map(j => j.id), [jobs[0].id])
  const [row] = await sql`SELECT attempts FROM pos_print_jobs WHERE id = ${jobs[0].id}`
  assert.equal(row.attempts, 2)
  assert.equal((await device(till, 'POST', `/pos-api/print-jobs/${jobs[0].id}/status`, { status: 'failed', error: 'Out of paper' })).status, 200)
})

test('a failed ticket prints again; moving a printer hands its waiting tickets over', async () => {
  const [failed] = await sql`SELECT id FROM pos_print_jobs WHERE tenant_id = ${ids.a} AND status = 'failed' LIMIT 1`
  assert.equal((await as(A.viewer, ids.a).post(`/api/pos/print-jobs/${failed.id}/again`, {})).status, 403)
  assert.equal((await as(B.owner, ids.b).post(`/api/pos/print-jobs/${failed.id}/again`, {})).status, 404)
  const again = await ok(owner.post(`/api/pos/print-jobs/${failed.id}/again`, {}))
  assert.equal(again.status, 'queued')
  assert.equal((await owner.post(`/api/pos/print-jobs/${failed.id}/again`, {})).status, 422, 'already waiting')
  // Take it, then plug the printer into the kitchen screen instead: it waits for the screen.
  await device(till, 'POST', '/pos-api/print-jobs/claim', {})
  await ok(owner.patch(`/api/pos/printers/${plugged.id}`, { name: 'Bar printer', connection: 'device', device_id: screen.id }))
  const [j] = await sql`SELECT status, claimed_by FROM pos_print_jobs WHERE id = ${failed.id}`
  assert.deepEqual([j.status, j.claimed_by], ['queued', null])
  assert.deepEqual((await device(screen, 'POST', '/pos-api/print-jobs/claim', {})).json.map(x => x.id), [failed.id])
})

test('an order for later prints when its time comes (the minute sweep), once', async () => {
  const later = new Date(Date.now() + 30 * 60000).toISOString()
  const r = await sequencer(ids.a, V).submit(orderIn(502, { fireAt: later }))
  assert.ok(r.ok, r.error)
  assert.equal((await jobsFor(502)).length, 0, 'not yet')
  assert.equal(await kitchenPrintsDue(), 0)
  // Its time comes.
  await sql`
    UPDATE kds_orders SET state = jsonb_set(state, '{items,0,fire_at}', to_jsonb((now() - interval '1 minute')::text))
     WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND state->>'number' = '502'`
  assert.equal(await kitchenPrintsDue(), 1)
  const jobs = await jobsFor(502)
  assert.deepEqual(jobs.map(j => [j.printer_id, j.kind]), [[net.id, 'kitchen']])
  assert.equal(await kitchenPrintsDue(), 0, 'printed once')
})

test('a printer that goes is taken off its printer box and the device using it for receipts', async () => {
  const spare = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Spare', host: '10.0.0.30', kind: 'receipt' }))
  const sbox = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Spare tickets', kind: 'printer', settings: { printer_id: spare.id } }))
  await ok(owner.patch(`/api/pos/devices/${till.id}`, { settings: { mode: 'counter', receipt_printer_id: spare.id } }))
  await ok(owner.delete(`/api/pos/printers/${spare.id}`))
  const [s] = await sql`SELECT settings FROM kds_stations WHERE id = ${sbox.id}`
  assert.equal(s.settings.printer_id, undefined)
  const [d] = await sql`SELECT settings FROM pos_devices WHERE id = ${till.id}`
  assert.equal(d.settings.receipt_printer_id, undefined)
  assert.equal(d.settings.mode, 'counter')
})
