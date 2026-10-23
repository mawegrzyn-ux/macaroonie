// The hub's print loop (src/service.js) against a stand-in cloud and a fake
// network printer: jobs collected, printed in ESC/POS, reported printed or
// failed, a printer added since the last config, printer status reports, and
// linking (src/cloud.js) with a code. Run: cd hub && npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { startHub, newState, VERSION } from '../src/service.js'
import { cloudClient, requestCode, codeStatus } from '../src/cloud.js'
import { kitchenTicket } from '../../shared/pos/tickets.js'

function fakePrinter() {
  const jobs = []
  const server = net.createServer(socket => {
    const chunks = []
    socket.on('data', c => chunks.push(c))
    socket.on('end', () => { jobs.push(Buffer.concat(chunks)); socket.end() })
    socket.on('error', () => {})
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, jobs, port: server.address().port })))
}

/** A stand-in cloud: GET /pos-api/config, claim, status, hub status, pairings. */
function fakeCloud(state) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null
      const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
      state.calls.push(req.method + ' ' + req.url)
      if (req.url.startsWith('/pos-api/pairings') && req.method === 'POST') return send(200, { id: 'p1', code: 'ABC-DEF', secret: 's'.repeat(32) })
      if (req.url === '/pos-api/pairings/p1') {
        if (req.headers.authorization !== 'Pairing ' + 's'.repeat(32)) return send(404, { error: 'Not found' })
        return send(200, state.paired ? { status: 'paired', device_id: 'd1', name: 'Hub', venue_name: 'Ware' } : { status: 'waiting' })
      }
      if (req.headers.authorization !== 'Device d1.secret' || state.unlinked) return send(401, { error: 'Not linked' })
      if (req.url === '/pos-api/config') return send(200, { kind: 'hub', version: String(state.printers.length), printers: state.printers, release: state.release || null, update: state.update || {} })
      if (req.url === '/pos-api/print-jobs/claim') { const jobs = state.queue.splice(0); return send(200, jobs) }
      const m = /^\/pos-api\/print-jobs\/([^/]+)\/status$/.exec(req.url)
      if (m) { state.done.push({ id: m[1], ...json }); return send(200, { id: m[1], status: json.status }) }
      if (req.url === '/pos-api/hub/status') { state.reports.push(json); return send(200, { ok: true }) }
      send(404, { error: 'Not found' })
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, api: 'http://127.0.0.1:' + server.address().port })))
}

const noUsb = { find: async () => [], print: async () => { throw new Error('no USB') }, status: async () => null, sys: {} }

const ticket = kitchenTicket({ station: 'Grill', table: '4', sentAt: new Date(), courses: [{ name: '', lines: [{ qty: 1, name: 'Pad Thai' }] }] })

test('jobs are collected, printed in ESC/POS and reported; unknown and offline printers fail with a reason', async () => {
  const printer = await fakePrinter()
  const state = {
    calls: [], done: [], reports: [],
    printers: [{ id: 'pr1', name: 'Grill', host: '127.0.0.1', port: printer.port, columns: 42 }],
    queue: [
      { id: 'j1', printer_id: 'pr1', kind: 'kitchen', title: 'Order 12', ops: ticket },
      { id: 'j2', printer_id: 'nope', kind: 'kitchen', title: 'Order 13', ops: ticket },
    ],
  }
  const cloud = await fakeCloud(state)
  const lines = []
  const hub = startHub({ cloud: cloudClient({ api: cloud.api, deviceId: 'd1', secret: 'secret' }), log: l => lines.push(l), pollMs: 60000, statusMs: 60000, local: noUsb })
  await new Promise(r => setTimeout(r, 400))
  await hub.tick()
  assert.equal(printer.jobs.length, 1, 'printed once')
  assert.ok(printer.jobs[0].includes(Buffer.from('Pad Thai')), 'the ticket text')
  assert.deepEqual(state.done.find(d => d.id === 'j1'), { id: 'j1', status: 'printed', error: null })
  const unknown = state.done.find(d => d.id === 'j2')
  assert.equal(unknown.status, 'failed')
  assert.match(unknown.error, /know this printer/)
  assert.ok(state.calls.filter(c => c === 'GET /pos-api/config').length >= 2, 'a job for an unknown printer loads the config again')

  // A printer that's off: the job fails with its reason, after the retries.
  state.printers.push({ id: 'pr2', name: 'Bar', host: '127.0.0.1', port: 1, columns: 42 })
  await hub.forceConfig()
  state.queue.push({ id: 'j3', printer_id: 'pr2', kind: 'kitchen', title: 'Order 14', ops: ticket })
  await hub.tick()
  const off = state.done.find(d => d.id === 'j3')
  assert.equal(off.status, 'failed')
  assert.match(off.error, /ECONNREFUSED|Printer/)

  // A printer with a backup: printed there when it doesn't answer.
  state.printers.push({ id: 'pr3', name: 'Grill 2', host: '127.0.0.1', port: 1, columns: 42, backup_printer_id: 'pr1' })
  await hub.forceConfig()
  state.queue.push({ id: 'j4', printer_id: 'pr3', kind: 'kitchen', title: 'Order 15', ops: ticket })
  await hub.tick()
  assert.equal(state.done.find(d => d.id === 'j4').status, 'printed')
  assert.match(state.done.find(d => d.id === 'j4').error, /printed on Grill/)
  assert.equal(printer.jobs.filter(j => j.includes(Buffer.from('Pad Thai'))).length, 2, 'the backup printed it')
  state.printers.pop()
  await hub.forceConfig()

  await hub.report()
  const last = state.reports.at(-1)
  assert.equal(last.app_version, VERSION)
  assert.deepEqual(last.printers.map(p => [p.id, p.online]), [['pr1', true], ['pr2', false]])
  assert.ok(lines.some(l => l.startsWith('Printed Order 12 on Grill')))
  hub.stop()
  cloud.server.close()
  printer.server.close()
})

test('linking: a code, then waiting until Store tech links it', async () => {
  const state = { calls: [], done: [], reports: [], printers: [], queue: [], paired: false }
  const cloud = await fakeCloud(state)
  const pairing = await requestCode(cloud.api, { version: '1.0.0' })
  assert.equal(pairing.code, 'ABC-DEF')
  assert.equal((await codeStatus(cloud.api, pairing)).status, 'waiting')
  state.paired = true
  assert.deepEqual(await codeStatus(cloud.api, pairing), { status: 'paired', device_id: 'd1', name: 'Hub', venue_name: 'Ware' })
  assert.equal((await codeStatus(cloud.api, { id: 'p1', secret: 'wrong-secret-wrong-secret' })).status, 'expired')
  await assert.rejects(cloudClient({ api: cloud.api, deviceId: 'd1', secret: 'bad' }).config(), e => e.status === 401)
  cloud.server.close()
})

test('USB printers on the hub: printed through usb.js, checked, listed in the report; quiet moments update; unlinked stops', async () => {
  const state = {
    calls: [], done: [], reports: [],
    printers: [
      { id: 'u1', name: 'Receipts', interface: 'usb', local_id: 'usb:04b8:0e28:ABC', columns: 48 },
      { id: 'u2', name: 'Bar', interface: 'usb', local_id: null, columns: 42 },
    ],
    queue: [
      { id: 'j1', printer_id: 'u1', kind: 'receipt', title: 'Bill 4', ops: ticket },
      { id: 'j2', printer_id: 'u2', kind: 'kitchen', title: 'Order 9', ops: ticket },
    ],
    release: { version: '9.9.9+abc', sha256: 'x'.repeat(64), url: '/pos-api/hub/release.tgz' },
    update: { auto: true, requested: false },
  }
  const cloud = await fakeCloud(state)
  const printed = []
  const found = [{ id: 'usb:04b8:0e28:ABC', name: 'EPSON TM-T20III', make: 'EPSON', model: 'TM-T20III', escpos: true, path: '/dev/usb/lp0' }]
  const local = {
    sys: { platform: 'linux' },
    find: async () => found,
    print: async ({ id, data }) => { printed.push({ id, data }) },
    status: async ({ id }) => (id === found[0].id ? { online: true, paperNearEnd: true, paperOut: false, coverOpen: false } : null),
  }
  const checks = []
  const updater = { check: async (rel, upd) => { checks.push([rel.version, upd]); return false }, state: () => ({ updates: 'auto', available: '9.9.9+abc', state: 'idle' }) }
  let unlinked = 0
  const hubState = newState()
  const hub = startHub({
    cloud: cloudClient({ api: cloud.api, deviceId: 'd1', secret: 'secret' }), state: hubState, local, updater, statusPort: 9180,
    pollMs: 60000, statusMs: 60000, onUnlinked: () => { unlinked++ },
  })
  await new Promise(r => setTimeout(r, 400))
  await hub.tick()
  assert.equal(printed.length, 1, 'the USB printer printed')
  assert.equal(printed[0].id, 'usb:04b8:0e28:ABC')
  assert.ok(printed[0].data.includes(Buffer.from('Pad Thai')))
  assert.equal(state.done.find(d => d.id === 'j1').status, 'printed')
  const noPick = state.done.find(d => d.id === 'j2')
  assert.equal(noPick.status, 'failed')
  assert.match(noPick.error, /Pick the USB printer/)
  assert.deepEqual(hubState.recent.map(r => [r.kind, r.ok]), [['kitchen', false], ['receipt', true]], 'recent tickets, newest first, no titles kept')
  assert.ok(!JSON.stringify(hubState.recent).includes('Bill 4'), 'no ticket titles on the page')

  // Nothing to print: a quiet moment, the updater is asked.
  await hub.tick()
  assert.equal(checks.length, 1)
  assert.deepEqual(checks[0], ['9.9.9+abc', { auto: true, requested: false }])
  await hub.tick()
  assert.equal(checks.length, 1, 'not asked again within 30 s')

  await hub.report()
  const rep = state.reports.at(-1)
  assert.deepEqual(rep.printers.map(p => [p.id, p.online, p.paper_low]), [['u1', true, true]], 'only the printer with a pick is checked')
  assert.equal(rep.info.status_port, 9180)
  assert.equal(rep.info.local_printers[0].id, 'usb:04b8:0e28:ABC')
  assert.equal(rep.info.update.available, '9.9.9+abc')
  assert.ok(rep.info.hostname && rep.info.platform)
  assert.equal(hubState.printers.find(p => p.id === 'u1').state.paperNearEnd, true)

  // Removed in Store tech: the cloud answers 401, the hub hands back.
  state.unlinked = true
  await hub.tick()
  assert.equal(unlinked, 1)
  hub.stop()
  cloud.server.close()
})
