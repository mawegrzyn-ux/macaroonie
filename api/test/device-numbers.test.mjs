// Per-device numbers (migration 217, shared/pos/numbers.js): every till and
// kiosk numbers its own checks (T2-47) and counter orders (from its own
// range), so two devices can give out numbers at the same time and never the
// same one. Checked here: ranges given out when devices are linked, refused
// when they overlap, kept when settings are saved without them, and on a
// device brought back; the sequencer stamping the device's code whatever the
// event says; each device's numbers coming back in /sync and /config; and the
// devices with changes not sent yet listed for closing the day.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'
import { rangesOverlap } from '../../shared/pos/numbers.js'

let ids, owner, viewer, V, staffId
const dev = {}

async function device(d, method, url, body, headers = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: `Device ${d.device_id}.${d.secret}`,
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}

const opened = (d, payload, staff = staffId) => ({
  id: ulid(), venue_id: V, device_id: d.id, staff_id: staff, check_id: ulid(), type: 'check.opened', payload, client_at: new Date().toISOString(),
})

async function until(fn, ms = 3000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v || Date.now() > end) return v
    await new Promise(r => setTimeout(r, 50))
  }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  staffId = filled.ids.staff
  const role = await ok(owner.post('/api/pos/roles', { name: 'Zqn Server', permissions: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '2580' }))
  dev.t1 = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqn Front till', settings: { mode: 'counter' } })
  dev.k1 = await linkDevice(owner, V, { kind: 'kiosk', name: 'Zqn Kiosk' })
  dev.t2 = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqn Bar till', settings: { mode: 'counter' } })
  dev.kds = await linkDevice(owner, V, { kind: 'kds', name: 'Zqn Kitchen' })
})
after(closeApp)

test('linked tills and kiosks each get their own block of order numbers; kitchen screens none', async () => {
  const ranges = [dev.t1, dev.k1, dev.t2].map(d => d.device.settings.order_numbers)
  for (const r of ranges) assert.ok(r && r.to - r.from === 98 || r.to - r.from === 99, JSON.stringify(r))
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) assert.ok(!rangesOverlap(ranges[i], ranges[j]), 'no two overlap')
  }
  assert.equal(dev.kds.device.settings.order_numbers, undefined)
  // Every other till or kiosk at the location too (the fixtures' ones).
  const others = await sql`SELECT settings FROM pos_devices WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind IN ('terminal', 'kiosk') AND revoked_at IS NULL`
  const all = others.map(r => r.settings.order_numbers)
  assert.ok(all.every(Boolean))
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!rangesOverlap(all[i], all[j]))
})

test('ranges: an overlap is refused naming the device; saved without them, a device keeps its own', async () => {
  const t1 = dev.t1.device.settings.order_numbers
  const clash = await owner.patch(`/api/pos/devices/${dev.t2.id}`, { settings: { mode: 'counter', order_numbers: { from: t1.from + 5, to: t1.to + 50 } } })
  assert.equal(clash.status, 422)
  assert.equal(clash.json.code, 'order_numbers')
  assert.match(clash.json.error, /Zqn Front till uses order numbers/)
  const bad = await owner.patch(`/api/pos/devices/${dev.t2.id}`, { settings: { order_numbers: { from: 30, to: 20 } } })
  assert.equal(bad.status, 400)
  assert.equal((await viewer.patch(`/api/pos/devices/${dev.t2.id}`, { settings: { order_numbers: { from: 900, to: 950 } } })).status, 403)
  const set = await ok(owner.patch(`/api/pos/devices/${dev.t2.id}`, { settings: { mode: 'counter', order_numbers: { from: 900, to: 920 } } }))
  assert.deepEqual(set.settings.order_numbers, { from: 900, to: 920 })
  const kept = await ok(owner.patch(`/api/pos/devices/${dev.t2.id}`, { settings: { mode: 'counter', receipt_printer_id: null } }))
  assert.deepEqual(kept.settings.order_numbers, { from: 900, to: 920 }, 'left out: kept')
})

test('each device numbers its own checks; the sequencer stamps its code; the numbers come back', async () => {
  const r1 = dev.t1.device.settings.order_numbers
  // Two tills open their first counter check at the same moment: both are
  // number 1, told apart by their codes, with order numbers from their ranges.
  const a = opened(dev.t1, { mode: 'counter', number: 1, order_no: r1.from, number_code: 'KS9' })
  const b = opened(dev.t2, { mode: 'counter', number: 1, order_no: 900 })
  const ra = await device(dev.t1, 'POST', '/pos-api/events', { events: [a] })
  const rb = await device(dev.t2, 'POST', '/pos-api/events', { events: [b] })
  assert.equal(ra.status, 200, ra.body)
  assert.ok(ra.json.results[0].ok, ra.json.results[0].error)
  assert.ok(rb.json.results[0].ok, rb.json.results[0].error)
  assert.equal(ra.json.results[0].assigned.number_code, dev.t1.device.short_code, 'the device\'s own code, not what the event said')
  const rows = await sql`SELECT id, number, number_code, order_no FROM pos_checks WHERE tenant_id = ${ids.a} AND id IN ${sql([a.check_id, b.check_id])}`
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.deepEqual([byId[a.check_id].number, byId[a.check_id].number_code, byId[a.check_id].order_no], [1, dev.t1.device.short_code, r1.from])
  assert.deepEqual([byId[b.check_id].number, byId[b.check_id].number_code, byId[b.check_id].order_no], [1, dev.t2.device.short_code, 900])
  assert.notEqual(dev.t1.device.short_code, dev.t2.device.short_code)

  // A table check: a check number only.
  const t = opened(dev.t1, { mode: 'table', number: 2 })
  assert.ok((await device(dev.t1, 'POST', '/pos-api/events', { events: [t] })).json.results[0].ok)
  // A bad number is refused like any bad event.
  const bad = await device(dev.t1, 'POST', '/pos-api/events', { events: [opened(dev.t1, { mode: 'counter', number: 3, order_no: 10000 })] })
  assert.equal(bad.json.results[0].code, 'invalid')

  // A till that lost its storage carries on from what the server saw.
  const sync = (await device(dev.t1, 'GET', '/pos-api/sync?since=0')).json
  const date = sync.day.business_date
  assert.deepEqual(sync.numbers, { date, check: 2, order: r1.from })
  const cfg = (await device(dev.t1, 'GET', '/pos-api/config')).json
  assert.deepEqual(cfg.numbers, { date, check: 2, order: r1.from })
  assert.equal(cfg.trading_day, date, 'and the open trading day the device counts under')
  const again = (await device(dev.t1, 'GET', '/pos-api/config?version=' + encodeURIComponent(cfg.version))).json
  assert.equal(again.unchanged, true)
  assert.deepEqual(again.numbers, { date, check: 2, order: r1.from }, 'an unchanged config carries them too')
  assert.equal(again.trading_day, date)
  assert.equal((await device(dev.t2, 'GET', '/pos-api/sync?since=0')).json.numbers.order, 900, 'each device its own')
  assert.equal((await device(dev.kds, 'GET', '/pos-api/config')).json.numbers, undefined, 'a kitchen screen gives out no numbers')
  assert.deepEqual((await device(dev.k1, 'GET', '/pos-api/config')).json.numbers, null, 'a kiosk that hasn\'t opened an order yet')
})

test('closing the day: devices with changes not sent yet are listed', async () => {
  const r = await device(dev.t2, 'GET', '/pos-api/me', undefined, { 'x-pos-pending': '3' })
  assert.equal(r.status, 200)
  const pending = await until(async () => (await sql`SELECT pending_changes FROM pos_devices WHERE id = ${dev.t2.id}`)[0].pending_changes === 3)
  assert.ok(pending, 'written')
  const report = (await device(dev.t1, 'GET', '/pos-api/reports/day')).json
  const w = report.waiting.find(x => x.id === dev.t2.id)
  assert.ok(w, JSON.stringify(report.waiting))
  assert.equal(w.pending, 3)
  assert.equal(w.name, 'Zqn Bar till')
  assert.ok(!report.waiting.some(x => x.id === dev.t1.id), 'not the till asking')
  // Sent: off the list.
  await device(dev.t2, 'GET', '/pos-api/me', undefined, { 'x-pos-pending': '0' })
  await until(async () => (await sql`SELECT pending_changes FROM pos_devices WHERE id = ${dev.t2.id}`)[0].pending_changes === 0)
  assert.ok(!(await device(dev.t1, 'GET', '/pos-api/reports/day')).json.waiting.some(x => x.id === dev.t2.id))
  // One not heard from for a while (but today) may have changes made offline.
  await sql`UPDATE pos_devices SET last_seen_at = now() - interval '25 minutes' WHERE id = ${dev.k1.id}`
  assert.ok((await device(dev.t1, 'GET', '/pos-api/reports/day')).json.waiting.some(x => x.id === dev.k1.id))
})

test('a device brought back keeps its numbers unless another took them', async () => {
  await ok(owner.delete(`/api/pos/devices/${dev.t2.id}`))
  // While it is removed another till may take its numbers.
  await ok(owner.patch(`/api/pos/devices/${dev.t1.id}`, { settings: { mode: 'counter', order_numbers: { from: 905, to: 999 } } }))
  const back = await linkDevice(owner, V, { kind: 'terminal', deviceId: dev.t2.id })
  const r = back.device.settings.order_numbers
  assert.ok(!rangesOverlap(r, { from: 905, to: 999 }), 'given a free block instead: ' + JSON.stringify(r))
  // Freed again: a device brought back keeps its own.
  await ok(owner.patch(`/api/pos/devices/${dev.t1.id}`, { settings: { mode: 'counter', order_numbers: { from: 800, to: 820 } } }))
  await ok(owner.patch(`/api/pos/devices/${dev.t2.id}`, { settings: { mode: 'counter', order_numbers: { from: 950, to: 960 } } }))
  await ok(owner.delete(`/api/pos/devices/${dev.t2.id}`))
  const again = await linkDevice(owner, V, { kind: 'terminal', deviceId: dev.t2.id })
  assert.deepEqual(again.device.settings.order_numbers, { from: 950, to: 960 })
})
