// Hub first (docs/POS.md section 11): the hub's copy of its venue
// (src/venue.js) and the venue network it serves (src/lan.js), against a
// stand-in cloud that runs the real sequencer over memory and answers
// /pos-api/hub/context, /hub/sync and /hub/events like the API. Devices are
// plain HTTP calls with their LAN keys. Checked:
//   - only devices with a key the cloud gave; CORS and Private Network Access
//   - a till's events decided at once, other devices see them, they go up in
//     order and the copy follows the cloud
//   - tickets: the hub's own printer at once, a till's own printer collected
//     by that till from the hub
//   - the internet down: the venue keeps trading, everything goes up later
//   - a restart: events a device was told it had survive (venue.log)
//   - hub first switched off: devices are sent to the cloud
//   - order ready boards read their numbers from the hub
//   - moving the computer to another venue (src/link.js unlink): what waits
//     goes up first, the cloud hears, the venue's files go; refused while sales
//     wait and the cloud doesn't answer; another hub's log lines never replayed
// Run: cd hub && npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { startVenue } from '../src/venue.js'
import { startLan } from '../src/lan.js'
import { cloudClient } from '../src/cloud.js'
import { unlink, linkInfo, writeLink, VENUE_FILES } from '../src/link.js'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createSequencer } from '../../shared/pos/sequencer.js'
import { ulid } from '../../shared/pos/ids.js'

const uuid = () => crypto.randomUUID()
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const VENUE = uuid()
const HUB = uuid()
const T1 = uuid(), T2 = uuid(), KDS = uuid()
const SCREEN = uuid()
const ANNA = uuid()
const P1 = uuid(), P2 = uuid()
const KEYS = { [T1]: 'k'.repeat(43), [T2]: 'm'.repeat(43), [KDS]: 'n'.repeat(43), [SCREEN]: 'p'.repeat(43) }

const context = {
  staffById: { [ANNA]: { id: ANNA, name: 'Anna', permissions: { close_day: true, open_drawer: true } } },
  print: {
    venue: { name: 'Ware' }, settings: {}, tables: {}, staff: { [ANNA]: { name: 'Anna' } }, courses: {}, order_types: {},
    printers: {
      [P1]: { id: P1, name: 'Front printer', kind: 'receipt', connection: 'hub', device_id: null, columns: 42 },
      [P2]: { id: P2, name: 'Bar printer', kind: 'receipt', connection: 'device', device_id: T2, columns: 42 },
    },
    devices: { [T1]: { receipt_printer_id: P1, kiosk: false }, [T2]: { receipt_printer_id: P2, kiosk: false } },
    layouts: {}, timezone: 'Europe/London',
  },
  settings: { day_starts_at: '04:00' }, timezone: 'Europe/London',
  devices: { [T1]: { short_code: 'T1', kind: 'terminal' }, [T2]: { short_code: 'T2', kind: 'terminal' }, [KDS]: { short_code: 'K1', kind: 'kds' } },
}

/** The cloud: a sequencer over memory, served like the API's hub routes. */
async function standInCloud() {
  const s = {
    events: [], byId: new Map(), rejections: new Map(), checks: new Map(), checkSeq: new Map(),
    state: { last_seq: 0, numbers: {}, day: null }, down: false, hubFirst: true, uploads: [], calls: [],
    removed: false, disconnected: false,
  }
  let queue = Promise.resolve()
  const store = {
    run: (_v, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.byId.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => context,
    venueState: () => ({ ...s.state }),
    openDay: ({ business_date }) => { const d = { id: uuid(), business_date }; s.state.day = d; return d },
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, structuredClone(s.checks.get(id))])),
    openCheckCount: () => [...s.checks.values()].filter(c => c.status === 'open').length,
    saveEvent: e => { s.events.push(e); s.byId.set(e.id, e) },
    saveChecks: (changed, e) => { for (const [id, c] of Object.entries(changed)) { s.checks.set(id, structuredClone(c)); s.checkSeq.set(id, e.seq) } },
    saveJobs: () => {},
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code }) },
    saveVenueState: v => { s.state.last_seq = v.last_seq; if (v.numbers) s.state.numbers = v.numbers },
    closeDay: () => { s.state.day = null },
  }
  const seq = createSequencer(store)
  const devices = [[T1, 'terminal', 'Front till'], [T2, 'terminal', 'Bar till'], [KDS, 'kds', 'Kitchen']]
  const ctxBody = () => {
    const body = {
      venue_id: VENUE, hub_id: HUB, hub_first: s.hubFirst, primary: true, context,
      devices: devices.map(([id, kind, name]) => ({ id, kind, name, short_code: context.devices[id].short_code, key_hash: sha256(KEYS[id]) })),
      screens: [{ id: SCREEN, name: 'Collection board', key_hash: sha256(KEYS[SCREEN]) }],
      board_clear_mins: 120,
    }
    return { ...body, version: sha256(JSON.stringify(body)).slice(0, 16) }
  }
  const server = http.createServer((req, res) => {
    if (s.down) return req.socket.destroy()
    let text = ''
    req.on('data', c => { text += c })
    req.on('end', async () => {
      const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
      if (s.removed || req.headers.authorization !== 'Device ' + HUB + '.hubsecret') return send(401, { error: 'Not linked' })
      const url = new URL(req.url, 'http://cloud')
      s.calls.push(req.method + ' ' + url.pathname)
      if (url.pathname === '/pos-api/me') {
        return send(200, { device_id: HUB, name: 'Venue hub', kind: 'hub', venue_id: VENUE, venue_name: 'Ware', tenant_name: 'WingVibes' })
      }
      if (url.pathname === '/pos-api/disconnect' && req.method === 'POST') {
        s.disconnected = true
        return send(200, { ok: true })
      }
      if (url.pathname === '/pos-api/hub/context') {
        const b = ctxBody()
        return send(200, url.searchParams.get('version') === b.version ? { unchanged: true, version: b.version } : b)
      }
      if (url.pathname === '/pos-api/hub/sync') {
        const since = Number(url.searchParams.get('since')) || 0
        const reset = !since || since > s.state.last_seq
        return send(200, {
          reset, seq: s.state.last_seq,
          events: reset ? [] : s.events.filter(e => e.seq > since).map(e => ({ id: e.id, seq: e.seq })),
          event_ids: reset ? s.events.map(e => e.id) : undefined,
          checks: [...s.checks.values()].filter(c => reset || s.checkSeq.get(c.id) > since),
          kitchen: [], day: s.state.day, numbers: s.state.numbers, turns: {}, presence: [],
        })
      }
      if (url.pathname === '/pos-api/hub/events' && req.method === 'POST') {
        const body = JSON.parse(text)
        s.uploads.push(body)
        const results = []
        for (const e of body.events || []) {
          const { hub_printed, hub_at, ...raw } = e
          const r = await seq.submit(raw, { now: new Date(hub_at || Date.now()) })
          results.push({ id: e.id, ok: r.ok, seq: r.seq, duplicate: !!r.duplicate, error: r.error, code: r.code })
        }
        for (const x of body.rejections || []) s.rejections.set(x.event.id, { error: x.error, code: x.code, from: 'hub' })
        return send(200, { results })
      }
      send(404, { error: 'Not found' })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return {
    s, seq, server, devices, api: 'http://127.0.0.1:' + server.address().port,
    /** A till straight to the cloud (4G). */
    direct: e => seq.submit(structuredClone(e), { now: new Date() }),
  }
}

async function call(port, method, url, { key, id = T1, body, headers = {} } = {}) {
  const res = await fetch('http://127.0.0.1:' + port + url, {
    method,
    headers: { ...(key !== null ? { authorization: 'Lan ' + id + '.' + (key ?? KEYS[id]) } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json, headers: res.headers }
}

const ev = (device, type, payload, check_id = null) => ({ id: ulid(), venue_id: VENUE, device_id: device, staff_id: ANNA, check_id, type, payload, client_at: new Date().toISOString() })
const line = (name, price) => ({ id: ulid(), item_id: uuid(), section_id: null, name, qty: 1, unit_price: price, modifiers: [], vat_rate: 20 })
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v || Date.now() > end) return v
    await new Promise(r => setTimeout(r, 40))
  }
}

async function hubOn(cloud, dir, { printed = [], contextMs = 200 } = {}) {
  let venue = null
  venue = startVenue({
    cloud: cloudClient({ api: cloud.api, deviceId: HUB, secret: 'hubsecret' }), hubId: HUB, dir,
    idleMs: 120, busyMs: 60, contextMs, snapshotMs: 150,
    onJobs: jobs => {
      for (const j of jobs) {
        const p = venue.printerOf(j.printer_id)
        if (p?.connection === 'device' && p.device_id !== HUB) venue.queueForDevice(j, p.device_id)
        else printed.push(j)
      }
    },
  })
  await venue.started
  const lan = await startLan({ venue, port: 0, host: '127.0.0.1' })
  return { venue, lan, port: lan.port, printed, async stop() { await venue.stop(); await lan.close() } }
}

test('only devices with a key the cloud gave; browsers on the device addresses may call it', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  const hub = await hubOn(cloud, dir)
  try {
    assert.equal((await call(hub.port, 'GET', '/lan/ping', { key: null })).status, 401)
    assert.equal((await call(hub.port, 'GET', '/lan/ping', { key: 'x'.repeat(43) })).status, 401)
    assert.equal((await call(hub.port, 'GET', '/lan/ping', { id: T2, key: KEYS[T1] })).status, 401, 'another device\'s key')
    const ping = await call(hub.port, 'GET', '/lan/ping')
    assert.equal(ping.status, 200)
    assert.equal(ping.json.on, true)
    assert.equal(ping.json.hub_id, HUB)
    assert.equal(ping.headers.get('access-control-allow-origin'), '*')
    const pre = await fetch('http://127.0.0.1:' + hub.port + '/pos-api/events', {
      method: 'OPTIONS',
      headers: { origin: 'https://pos.example.test', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true', 'access-control-request-headers': 'authorization, content-type' },
    })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true')
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/)
    // A menu screen's key opens its numbers only.
    assert.equal((await call(hub.port, 'GET', '/pos-api/sync', { id: SCREEN })).status, 404)
    assert.equal((await call(hub.port, 'GET', '/screen-api/orders', { id: SCREEN })).status, 200)
  } finally {
    await hub.stop()
    cloud.server.close()
  }
})

test('a device linked after the hub loaded the set-up: its first call loads the set-up again, then it is known', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  const hub = await hubOn(cloud, dir, { contextMs: 600_000 })
  try {
    const T3 = uuid()
    KEYS[T3] = 'q'.repeat(43)
    context.devices[T3] = { short_code: 'T3', kind: 'terminal' }
    cloud.devices.push([T3, 'terminal', 'New till'])
    assert.equal((await call(hub.port, 'GET', '/lan/ping', { id: T3 })).status, 401, 'not known yet')
    const known = await until(async () => (await call(hub.port, 'GET', '/lan/ping', { id: T3 })).status === 200, 3000)
    assert.ok(known, 'known a moment later, without waiting for the half-minute reload')
    // A wrong key doesn't make it load the set-up again and again.
    const before = cloud.s.calls.filter(c => c.endsWith('/hub/context')).length
    for (let i = 0; i < 5; i++) await call(hub.port, 'GET', '/lan/ping', { key: 'z'.repeat(43) })
    await new Promise(r => setTimeout(r, 200))
    assert.ok(cloud.s.calls.filter(c => c.endsWith('/hub/context')).length <= before + 1, 'at most once every 10 s')
  } finally {
    await hub.stop()
    cloud.server.close()
    delete context.devices[Object.keys(context.devices).find(k => context.devices[k].short_code === 'T3')]
  }
})

test('a till\'s events: decided at once, seen by the others, sent up in order; tickets printed here or collected by their till', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  const hub = await hubOn(cloud, dir)
  try {
    const c1 = ulid()
    const l1 = line('Pad Thai', 1250)
    const r = await call(hub.port, 'POST', '/pos-api/events', { body: { events: [
      ev(T1, 'check.opened', { mode: 'counter', number: 1, order_no: 100 }, c1),
      ev(T1, 'line.added', { line: l1 }, c1),
      ev(T1, 'payment.added', { payment: { id: ulid(), tender: 'cash', amount: 1250, tendered: 2000 } }, c1),
      ev(T1, 'bill.printed', { printer_id: P2 }, c1),
    ] } })
    assert.equal(r.status, 200)
    assert.ok(r.json.results.every(x => x.ok), JSON.stringify(r.json.results))
    assert.equal(r.json.source, 'hub:' + HUB)
    assert.equal(r.json.results[0].assigned.number_code, 'T1')
    // The bar till sees it straight away.
    const t2 = await call(hub.port, 'GET', '/pos-api/sync?since=0', { id: T2 })
    assert.equal(t2.json.source, 'hub:' + HUB)
    assert.equal(t2.json.checks.find(c => c.id === c1).lines.length, 1)
    // The cash drawer on the hub's printer, at once; the bill for the bar till's own printer waits for it.
    assert.deepEqual(hub.printed.map(j => j.kind), ['drawer'])
    assert.equal((await call(hub.port, 'POST', '/pos-api/print-jobs/claim', { body: {} })).json.length, 0, 'not the front till\'s')
    const jobs = (await call(hub.port, 'POST', '/pos-api/print-jobs/claim', { id: T2, body: {} })).json
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].printer_id, P2)
    assert.match(jobs[0].id, /^hub-/)
    assert.equal((await call(hub.port, 'POST', `/pos-api/print-jobs/${jobs[0].id}/status`, { id: T2, body: { status: 'printed' } })).json.status, 'printed')
    assert.equal((await call(hub.port, 'POST', '/pos-api/print-jobs/claim', { id: T2, body: {} })).json.length, 0)

    // Up to the cloud in the till's order, marked printed by the hub.
    await until(() => cloud.s.events.length === 4)
    assert.deepEqual(cloud.s.events.map(e => e.type), ['check.opened', 'line.added', 'payment.added', 'bill.printed'])
    const sent = cloud.s.uploads.flatMap(u => u.events)
    assert.ok(sent.every(e => e.device_id === T1 && e.hub_at))
    assert.equal(sent.find(e => e.type === 'payment.added').hub_printed, true)
    await until(() => hub.venue.status().pending === 0)
    assert.equal(hub.venue.status().pending, 0, 'the copy follows the cloud back')

    // A till straight to the cloud: the copy has it within a round.
    const c2 = ulid()
    assert.ok((await cloud.direct(ev(T2, 'check.opened', { mode: 'counter', number: 1, order_no: 500 }, c2))).ok)
    const seen = await until(async () => (await call(hub.port, 'GET', '/pos-api/sync?since=0')).json.checks.some(c => c.id === c2))
    assert.ok(seen)
    // Its cursor: changes since, from the hub's own counter.
    const before = (await call(hub.port, 'GET', '/pos-api/sync?since=0&source=' + encodeURIComponent('hub:' + HUB))).json
    const l2 = line('Spring rolls', 450)
    await call(hub.port, 'POST', '/pos-api/events', { body: { events: [ev(T1, 'line.added', { line: l2 }, c2)] } })
    const after = (await call(hub.port, 'GET', `/pos-api/sync?since=${before.seq}&source=${encodeURIComponent('hub:' + HUB)}`)).json
    assert.equal(after.reset, false)
    assert.deepEqual(after.checks.map(c => c.id), [c2])
    // A cursor from the cloud starts again.
    assert.equal((await call(hub.port, 'GET', `/pos-api/sync?since=${before.seq}&source=cloud`)).json.reset, true)
    // The day's figures and the closed checks, from the hub.
    const x = (await call(hub.port, 'GET', '/pos-api/reports/day')).json
    assert.ok(x.day)
    const closed = (await call(hub.port, 'GET', '/pos-api/checks?status=open')).json
    assert.ok(closed.some(c => c.id === c2 && c.total === 450))
    assert.equal((await call(hub.port, 'GET', '/pos-api/checks/' + c1)).json.id, c1)
  } finally {
    await hub.stop()
    cloud.server.close()
  }
})

test('the internet down: the venue keeps trading on the hub; when it is back everything goes up; a restart loses nothing', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  let hub = await hubOn(cloud, dir)
  cloud.s.down = true
  const c1 = ulid()
  try {
    const r = await call(hub.port, 'POST', '/pos-api/events', { body: { events: [
      ev(T1, 'check.opened', { mode: 'counter', number: 1, order_no: 100 }, c1),
      ev(T1, 'line.added', { line: line('Green curry', 1100) }, c1),
    ] } })
    assert.ok(r.json.results.every(x => x.ok), 'answered with the internet down')
    await until(() => hub.venue.status().cloud_ok === false)
    assert.equal(hub.venue.status().cloud_ok, false)
    assert.equal(hub.venue.status().to_send, 2)
    // A card machine payment needs the internet: refused, said why.
    const card = await call(hub.port, 'POST', '/pos-api/events', { body: { events: [
      ev(T1, 'payment.added', { payment: { id: ulid(), tender: 'card_integrated', amount: 1100, card_payment_id: uuid() } }, c1),
    ] } })
    assert.equal(card.json.results[0].ok, false)
    assert.equal(card.json.results[0].code, 'card')
    // The hub stops (power cut) right after a till was told yes.
    const c2 = ulid()
    assert.ok((await call(hub.port, 'POST', '/pos-api/events', { body: { events: [ev(T2, 'check.opened', { mode: 'counter', number: 1, order_no: 500 }, c2)] } })).json.results[0].ok)
    hub.venue.halt()   // the power goes: no snapshot after that event
    await hub.lan.close()
    hub = await hubOn(cloud, dir)
    const back = (await call(hub.port, 'GET', '/pos-api/sync?since=0', { id: T2 })).json
    assert.ok(back.checks.some(c => c.id === c2), 'the restart kept what the till was told')
    assert.equal(hub.venue.status().to_send, 3)
    // The line comes back: everything goes up in order.
    cloud.s.down = false
    await until(() => cloud.s.events.length === 3)
    assert.deepEqual(cloud.s.events.map(e => e.check_id), [c1, c1, c2])
    await until(() => hub.venue.status().pending === 0)
    assert.equal(hub.venue.status().cloud_ok, true)
  } finally {
    await hub.stop()
    cloud.server.close()
  }
})

test('hub first off: devices are sent to the cloud; boards read their numbers from the hub', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  const hub = await hubOn(cloud, dir)
  try {
    const board = await call(hub.port, 'GET', '/screen-api/orders', { id: SCREEN })
    assert.deepEqual(Object.keys(board.json.orders), ['preparing', 'ready', 'boards'])
    cloud.s.hubFirst = false
    await until(() => !hub.venue.taking())
    const off = await call(hub.port, 'POST', '/pos-api/events', { body: { events: [ev(T1, 'check.opened', { mode: 'counter', number: 1 }, ulid())] } })
    assert.equal(off.status, 409)
    assert.equal(off.json.code, 'hub_off')
    const ping = await call(hub.port, 'GET', '/lan/ping')
    assert.equal(ping.status, 200)
    assert.equal(ping.json.on, false)
    assert.equal(cloud.s.events.length, 0)
  } finally {
    await hub.stop()
    cloud.server.close()
  }
})

test('restarted with the internet down and no set-up saved: the log waits for the set-up, nothing is lost', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  let hub = await hubOn(cloud, dir)
  try {
    cloud.s.down = true
    const c1 = ulid()
    assert.ok((await call(hub.port, 'POST', '/pos-api/events', { body: { events: [ev(T1, 'check.opened', { mode: 'counter', number: 7, order_no: 107 }, c1)] } })).json.results[0].ok)
    hub.venue.halt()
    await hub.lan.close()
    fs.rmSync(path.join(dir, 'venue.json'))   // the set-up gone
    hub = await hubOn(cloud, dir)
    assert.equal(hub.venue.taking(), false, 'nothing to decide with yet')
    assert.ok(fs.readFileSync(path.join(dir, 'venue.log'), 'utf8').includes(c1), 'the log is kept')
    await hub.venue.writeSnapshot()
    assert.ok(fs.readFileSync(path.join(dir, 'venue.log'), 'utf8').includes(c1), 'still kept after a snapshot')
    cloud.s.down = false
    await until(() => cloud.s.events.some(e => e.check_id === c1))
    assert.ok(cloud.s.events.some(e => e.check_id === c1), 'decided again with the set-up and sent up')
    assert.equal(hub.venue.taking(), true)
  } finally {
    await hub.stop()
    cloud.server.close()
  }
})

// ── Moving the computer to another venue or restaurant group (src/link.js) ──

const HUB_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hub.js')

/** A hub's folder as the installer leaves it: hub.json beside the venue's files. */
function linkedDir(cloud) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-link-'))
  writeLink(path.join(dir, 'hub.json'), { api: cloud.api, device_id: HUB, secret: 'hubsecret', name: 'Venue hub', venue_name: 'Ware (old name)', tenant_name: null })
  fs.writeFileSync(path.join(dir, 'printers.json'), '{"printers":[]}')
  fs.writeFileSync(path.join(dir, 'state.json'), '{"phase":"running"}')
  return dir
}
const left = dir => VENUE_FILES.concat('hub.json').filter(f => fs.existsSync(path.join(dir, f)))

test('moving to another venue: refused while sales wait and the cloud doesn\'t answer; then they go up first, the cloud hears, the files go', async () => {
  const cloud = await standInCloud()
  const dir = linkedDir(cloud)
  const configPath = path.join(dir, 'hub.json')
  const hub = await hubOn(cloud, dir)
  const c1 = ulid()
  try {
    cloud.s.down = true
    const r = await call(hub.port, 'POST', '/pos-api/events', { body: { events: [
      ev(T1, 'check.opened', { mode: 'counter', number: 1, order_no: 100 }, c1),
      ev(T1, 'line.added', { line: line('Wings', 900) }, c1),
    ] } })
    assert.ok(r.json.results.every(x => x.ok))
    hub.venue.halt()   // the installer stops the hub (no goodbye)
    await hub.lan.close()

    const offline = await linkInfo({ configPath, api: cloud.api })
    assert.equal(offline.status, 'offline')
    assert.equal(offline.venue_name, 'Ware (old name)', 'the names saved when it was linked')
    const refused = await unlink({ configPath })
    assert.equal(refused.ok, false)
    assert.equal(refused.unsent, 2, 'two events the cloud never had')
    assert.ok(refused.error, 'says why')
    assert.deepEqual(left(dir).filter(f => f !== 'venue.log').sort(), ['hub.json', 'printers.json', 'state.json', 'venue.json'].sort(), 'nothing deleted')
    assert.equal(cloud.s.disconnected, false)

    cloud.s.down = false
    const info = await linkInfo({ configPath, api: cloud.api })
    assert.deepEqual([info.linked, info.same_api, info.status, info.tenant_name, info.venue_name], [true, true, 'linked', 'WingVibes', 'Ware'])
    assert.equal((await linkInfo({ configPath, api: 'https://elsewhere.test' })).status, 'other_api')

    const done = await unlink({ configPath })
    assert.equal(done.ok, true)
    assert.equal(done.unsent, 0)
    assert.equal(done.disconnected, true)
    assert.deepEqual(cloud.s.events.map(e => e.check_id), [c1, c1], 'the sales went up before it left')
    assert.ok(cloud.s.calls.indexOf('POST /pos-api/disconnect') > cloud.s.calls.lastIndexOf('POST /pos-api/hub/events'), 'it left after sending them')
    assert.deepEqual(left(dir), [], 'every file of that venue is gone')
    assert.deepEqual(await linkInfo({ configPath, api: cloud.api }), { linked: false })
  } finally {
    cloud.server.close()
  }
})

test('moving anyway: --force loses what waits; a hub removed in Store tech just forgets; the command line', async () => {
  const cloud = await standInCloud()
  try {
    // Forced with the cloud down: done, the count lost said, the cloud not told.
    const dir = linkedDir(cloud)
    const hub = await hubOn(cloud, dir)
    cloud.s.down = true
    assert.ok((await call(hub.port, 'POST', '/pos-api/events', { body: { events: [ev(T1, 'check.opened', { mode: 'counter', number: 2, order_no: 101 }, ulid())] } })).json.results[0].ok)
    hub.venue.halt()
    await hub.lan.close()
    const forced = await unlink({ configPath: path.join(dir, 'hub.json'), force: true })
    assert.deepEqual([forced.ok, forced.unsent, forced.disconnected], [true, 1, false])
    assert.deepEqual(left(dir), [])

    // Removed in Store tech: the cloud refuses it, so it just forgets.
    cloud.s.down = false
    const dir2 = linkedDir(cloud)
    cloud.s.removed = true
    assert.equal((await linkInfo({ configPath: path.join(dir2, 'hub.json'), api: cloud.api })).status, 'removed')
    const gone = await unlink({ configPath: path.join(dir2, 'hub.json') })
    assert.deepEqual([gone.ok, gone.removed, gone.disconnected], [true, true, false])
    assert.deepEqual(left(dir2), [])
    cloud.s.removed = false

    // The commands the installers run (in another process: this one serves the cloud).
    const dir3 = linkedDir(cloud)
    const run = (...a) => new Promise(resolve => execFile(process.execPath, [HUB_JS, ...a, '--config', path.join(dir3, 'hub.json')], { encoding: 'utf8', timeout: 30000 },
      (err, stdout, stderr) => resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr })))
    const info = await run('link-info', '--api', cloud.api + '/')
    assert.equal(info.status, 0, info.stderr)
    const parsed = JSON.parse(info.stdout.trim().split('\n').pop())
    assert.deepEqual([parsed.linked, parsed.same_api, parsed.status, parsed.tenant_name], [true, true, 'linked', 'WingVibes'])
    const out = await run('unlink')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.stdout.trim().split('\n').length, 1, 'one line of JSON, nothing else')
    assert.equal(JSON.parse(out.stdout).disconnected, true)
    assert.deepEqual(left(dir3), [])
    const none = await run('unlink')
    assert.equal(JSON.parse(none.stdout).linked, false, 'nothing to leave: fine')
  } finally {
    cloud.server.close()
  }
})

test('a venue log left by another hub on this computer is never decided here', async () => {
  const cloud = await standInCloud()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-venue-'))
  const theirs = ulid(), oldFormat = ulid()
  fs.writeFileSync(path.join(dir, 'venue.log'), [
    { hub: uuid(), event: ev(T1, 'check.opened', { mode: 'counter', number: 9, order_no: 109 }, theirs), at: new Date().toISOString(), printed: false },
    { event: ev(T1, 'check.opened', { mode: 'counter', number: 8, order_no: 108 }, oldFormat), at: new Date().toISOString(), printed: false },
  ].map(x => JSON.stringify(x)).join('\n') + '\n')
  const hub = await hubOn(cloud, dir)
  try {
    await until(() => hub.venue.taking())
    await hub.venue.round()
    const sync = (await call(hub.port, 'GET', '/pos-api/sync?since=0')).json
    assert.equal(sync.checks.some(c => c.id === theirs || c.id === oldFormat), false, 'neither replayed')
    assert.equal(hub.venue.status().to_send, 0)
    assert.equal(cloud.s.events.length, 0, 'nothing of theirs sent to this hub\'s cloud')
  } finally {
    await hub.stop()
    cloud.server.close()
  }
})
