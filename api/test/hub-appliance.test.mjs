// The venue hub on a mini PC (migration 195): the hub's code and installers
// served by the cloud (services/hubRelease.js), USB printers plugged into the
// hub (connection 'device', device_id = the hub, local_id = which printer),
// what the hub says about itself, and updates (automatic, or Update now).
//
//   - /pos-api/hub/release, release.tgz (the files a hub needs, its sha256,
//     a copy that unpacks and passes its own self test), install.sh / .ps1
//     with this cloud's address
//   - Store tech: a USB printer on the hub needs which printer; only a hub of
//     this venue; the hub's config holds its USB printers and not other
//     devices'; it collects their tickets and reports their state
//   - the hub's report (info) shown in Store tech and the installer; Update now
//     sets requested in its config until it runs the latest version
//   - refusals: a till isn't updated this way, viewers, another tenant
//   - the installer people download on the mini PC: pos.<domain>/hub, the
//     page, the Windows setup file and the Linux file (runs itself with sudo)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { hubRelease } from '../src/services/hubRelease.js'
import { deviceOrigin } from '../src/services/platformHost.js'
import { env } from '../src/config/env.js'

let ids, owner, V, hub, till, other

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

async function plain(url, headers = {}) {
  const app = await getApp()
  return app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...headers } })
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  hub = await linkDevice(owner, V, { kind: 'hub', name: 'Back office hub' })
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Bar till' })
  const [o] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${V} LIMIT 1`
  other = await linkDevice(owner, o.id, { kind: 'hub', name: 'Other venue hub' })
})
after(closeApp)

test('the hub\'s code: release, a tar.gz that unpacks and passes its own check, installers with this cloud\'s address', async () => {
  const r = hubRelease()
  const meta = await plain('/pos-api/hub/release')
  assert.equal(meta.statusCode, 200)
  assert.deepEqual(meta.json(), { version: r.version, sha256: r.sha256, size: r.size, url: '/pos-api/hub/release.tgz' })
  assert.match(r.version, /^\d+\.\d+\.\d+\+[0-9a-f]{8}$/)
  for (const f of ['hub/bin/hub.js', 'hub/bin/launcher.js', 'hub/src/usb.js', 'hub/src/update.js', 'hub/src/statusPage.js', 'shared/pos/tickets.js', 'shared/qr.js', 'shared/package.json', 'release.json']) {
    assert.ok(r.files.includes(f), 'the release has ' + f)
  }
  assert.ok(!r.files.some(f => f.startsWith('api/') || f.includes('test/') || f.endsWith('hub.json')), 'nothing else')

  const tgz = await plain('/pos-api/hub/release.tgz')
  assert.equal(tgz.statusCode, 200)
  assert.equal(tgz.headers['content-type'], 'application/gzip')
  assert.equal(tgz.headers['x-hub-version'], r.version)
  assert.equal(createHash('sha256').update(tgz.rawPayload).digest('hex'), r.sha256)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-release-'))
  fs.writeFileSync(path.join(dir, 'hub.tgz'), tgz.rawPayload)
  execFileSync('tar', ['-xzf', 'hub.tgz'], { cwd: dir })
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'release.json'), 'utf8')).version, r.version)
  assert.equal(execFileSync(process.execPath, [path.join(dir, 'hub', 'bin', 'hub.js'), '--self-test']).toString().trim(), 'ok ' + r.version)
  assert.equal(hubRelease({ fresh: true }).sha256, r.sha256, 'every API process makes the same file')
  fs.rmSync(dir, { recursive: true, force: true })

  // Installers: this cloud's till address, or the local address on a test server.
  const sh = await plain('/pos-api/hub/install.sh', { host: 'pos.example.test' })
  assert.equal(sh.statusCode, 200)
  assert.ok(!sh.body.includes('__MACAROONIE_API__'))
  assert.ok(sh.body.includes(`API="\${MACAROONIE_API:-${deviceOrigin('terminal')}}"`))
  const local = await plain('/pos-api/hub/install.sh', { host: '127.0.0.1:3000' })
  assert.ok(local.body.includes('API="${MACAROONIE_API:-http://127.0.0.1:3000}"'))
  const ps1 = await plain('/pos-api/hub/install.ps1', { host: 'pos.example.test' })
  assert.equal(ps1.statusCode, 200)
  assert.ok(ps1.body.includes(`irm ${deviceOrigin('terminal')}/pos-api/hub/install.ps1 | iex`))
  assert.ok(!ps1.body.includes('__MACAROONIE_API__'))
})

test('USB printers on the hub: which printer needed, only a hub of this venue, in the hub\'s config only', async () => {
  const noPick = await owner.post(`/api/pos/venues/${V}/printers`, { name: 'Receipts', kind: 'receipt', connection: 'device', device_id: hub.id })
  assert.equal(noPick.status, 422)
  assert.match(noPick.json.error, /which printer plugged into the hub/)
  const wrongVenue = await owner.post(`/api/pos/venues/${V}/printers`, { name: 'R', connection: 'device', device_id: other.id, local_id: 'usb:04b8:0e28:X' })
  assert.equal(wrongVenue.status, 422, 'another venue\'s hub')
  const usb = await ok(owner.post(`/api/pos/venues/${V}/printers`, {
    name: 'Receipts', kind: 'receipt', connection: 'device', device_id: hub.id, local_id: 'usb:04b8:0e28:X5ZF012345', host: '10.0.0.99', columns: 48,
  }))
  assert.equal(usb.local_id, 'usb:04b8:0e28:X5ZF012345')
  assert.equal(usb.host, null, 'no address for a USB printer')
  const net = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Grill', host: '10.0.0.20', backup_printer_id: usb.id }))
  const onTill = await ok(owner.post(`/api/pos/venues/${V}/printers`, { name: 'Bar', connection: 'device', device_id: till.id, local_id: 'usb:1:2:3' }))
  assert.equal(onTill.local_id, null, 'a till\'s printer has no hub printer id')

  const cfg = (await device(hub, 'GET', '/pos-api/config')).json
  const byName = Object.fromEntries(cfg.printers.map(p => [p.name, p]))
  assert.ok(byName.Receipts && byName.Grill)
  assert.ok(!byName.Bar, 'a printer plugged into a till isn\'t the hub\'s')
  assert.deepEqual([byName.Receipts.interface, byName.Receipts.local_id, byName.Receipts.host, byName.Receipts.columns], ['usb', 'usb:04b8:0e28:X5ZF012345', null, 48])
  assert.deepEqual([byName.Grill.interface, byName.Grill.host, byName.Grill.local_id, byName.Grill.backup_printer_id], ['network', '10.0.0.20', null, usb.id])
  assert.equal(cfg.release.version, hubRelease().version)
  assert.equal(cfg.release.url, '/pos-api/hub/release.tgz')
  assert.deepEqual(cfg.update, { auto: true, requested: false })
  const otherCfg = (await device(other, 'GET', '/pos-api/config')).json
  assert.ok(!otherCfg.printers.some(p => p.id === usb.id), 'not another venue\'s hub')

  // Its tickets: the hub collects them, the till doesn't.
  const [job] = await sql`
    INSERT INTO pos_print_jobs (tenant_id, venue_id, printer_id, kind, title, ops)
    VALUES (${ids.a}, ${V}, ${usb.id}, 'receipt', 'Bill 1', ${sql.json([{ t: 'text', text: 'Thanks' }])}) RETURNING id`
  assert.deepEqual((await device(till, 'POST', '/pos-api/print-jobs/claim', {})).json, [])
  const claimed = (await device(hub, 'POST', '/pos-api/print-jobs/claim', {})).json
  assert.deepEqual(claimed.map(j => j.id), [job.id])
  assert.equal((await device(hub, 'POST', `/pos-api/print-jobs/${job.id}/status`, { status: 'printed' })).status, 200)

  // Moving it to another printer on the hub: tickets waiting go back in the queue, its state is cleared.
  await sql`UPDATE pos_printers SET status = ${sql.json({ online: true })}, status_at = now() WHERE id = ${usb.id}`
  const moved = await ok(owner.patch(`/api/pos/printers/${usb.id}`, { name: 'Receipts', kind: 'receipt', connection: 'device', device_id: hub.id, local_id: 'usb:04b8:0e28:OTHER' }))
  assert.deepEqual([moved.local_id, moved.status], ['usb:04b8:0e28:OTHER', null])
  // Made a network printer: no hub printer id kept.
  const back = await ok(owner.patch(`/api/pos/printers/${usb.id}`, { name: 'Receipts', kind: 'receipt', connection: 'hub', host: '10.0.0.30', local_id: 'usb:x' }))
  assert.deepEqual([back.connection, back.device_id, back.local_id, back.host], ['hub', null, null, '10.0.0.30'])
  await ok(owner.patch(`/api/pos/printers/${usb.id}`, { name: 'Receipts', kind: 'receipt', connection: 'device', device_id: hub.id, local_id: 'usb:04b8:0e28:X5ZF012345' }))
  await ok(owner.delete(`/api/pos/printers/${onTill.id}`))
  await ok(owner.delete(`/api/pos/printers/${net.id}`))
})

test('the hub\'s report: its computer and USB printers in Store tech and the installer, its USB printers\' state', async () => {
  const [usb] = await sql`SELECT id FROM pos_printers WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND device_id = ${hub.id}`
  const info = {
    hostname: 'hub-ware', os: 'Linux 6.8.0', platform: 'linux', arch: 'x64', node: 'v22.12.0',
    addresses: ['192.168.1.20'], status_port: 9180,
    local_printers: [{ id: 'usb:04b8:0e28:X5ZF012345', name: 'EPSON TM-T20III', model: 'TM-T20III', escpos: true, path: '/dev/usb/lp0' }],
    update: { updates: 'auto', available: null, state: 'idle', error: null, at: null },
  }
  const st = await device(hub, 'POST', '/pos-api/hub/status', {
    app_version: '1.0.0+00000000', info,
    printers: [{ id: usb.id, online: true, paper_low: true, paper_out: false, cover_open: false }],
  })
  assert.equal(st.status, 200)
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const h = setup.devices.find(d => d.id === hub.id)
  assert.deepEqual(h.info, info)
  assert.ok(h.info_at)
  assert.equal(h.app_version, '1.0.0+00000000')
  assert.deepEqual(setup.hub_release, { version: hubRelease().version })
  const p = setup.printers.find(x => x.id === usb.id)
  assert.deepEqual([p.local_id, p.status.paper_low], ['usb:04b8:0e28:X5ZF012345', true])
  assert.equal(setup.devices.find(d => d.id === till.id).info, undefined, 'only hubs carry info')

  // The other venue's hub can't report this venue's printer.
  await device(other, 'POST', '/pos-api/hub/status', { printers: [{ id: usb.id, online: false }] })
  const [after] = await sql`SELECT status FROM pos_printers WHERE id = ${usb.id}`
  assert.equal(after.status.online, true)

  // Too much in a report is refused.
  const big = await device(hub, 'POST', '/pos-api/hub/status', { info: { ...info, local_printers: Array.from({ length: 21 }, (_, i) => ({ id: 'p' + i, name: 'P' })) } })
  assert.equal(big.status, 400)

  // The installer lists the hub with what it said.
  const inst = await ok(owner.get(`/api/installer/venues/${V}`))
  const ih = inst.devices.find(d => d.id === hub.id)
  assert.equal(ih.kind, 'hub')
  assert.equal(ih.info.hostname, 'hub-ware')
  assert.equal(ih.online, true)
})

test('updates: automatic by default, off in settings, Update now until it runs the latest; refusals', async () => {
  const latest = hubRelease().version
  await ok(owner.patch(`/api/pos/devices/${hub.id}`, { name: 'Back office hub', settings: { auto_update: false } }))
  let cfg = (await device(hub, 'GET', '/pos-api/config')).json
  assert.deepEqual(cfg.update, { auto: false, requested: false })

  const asked = await ok(owner.post(`/api/pos/devices/${hub.id}/update`, {}))
  assert.ok(asked.update_requested_at)
  cfg = (await device(hub, 'GET', '/pos-api/config')).json
  assert.deepEqual(cfg.update, { auto: false, requested: true })

  // Still on the old version: still asked. On the latest: cleared.
  await device(hub, 'POST', '/pos-api/hub/status', { app_version: '1.0.0+00000000' })
  assert.equal((await device(hub, 'GET', '/pos-api/config')).json.update.requested, true)
  await device(hub, 'POST', '/pos-api/hub/status', { app_version: latest })
  assert.equal((await device(hub, 'GET', '/pos-api/config')).json.update.requested, false)
  const [d] = await sql`SELECT app_version, update_requested_at, info FROM pos_devices WHERE id = ${hub.id}`
  assert.deepEqual([d.app_version, d.update_requested_at], [latest, null])
  assert.equal(d.info.hostname, 'hub-ware', 'a report without info keeps what it said before')

  const notHub = await owner.post(`/api/pos/devices/${till.id}/update`, {})
  assert.equal(notHub.status, 422)
  const viewer = as(A.viewer, ids.a)
  assert.equal((await viewer.post(`/api/pos/devices/${hub.id}/update`, {})).status, 403)
  const b = as(B.owner, ids.b)
  assert.equal((await b.post(`/api/pos/devices/${hub.id}/update`, {})).status, 404)
  assert.equal((await b.post(`/api/pos/venues/${V}/printers`, { name: 'X', connection: 'device', device_id: hub.id, local_id: 'usb:1' })).status, 404)
  // A hub can't ask for another hub's things or act as a till.
  assert.equal((await device(hub, 'POST', '/pos-api/events', { events: [] })).status, 403)
  await ok(owner.patch(`/api/pos/devices/${hub.id}`, { name: 'Back office hub', settings: { auto_update: true } }))
})

test('the installer to download on the mini PC: pos.<domain>/hub, the page, the Windows and Linux files', async () => {
  const api = deviceOrigin('terminal')
  const pos = 'pos.' + env.PUBLIC_ROOT_DOMAIN.toLowerCase()

  // The short address on the till host goes to the page; other hosts don't have it.
  const short = await plain('/hub', { host: pos })
  assert.equal(short.statusCode, 302)
  assert.equal(short.headers.location, '/pos-api/hub/setup')
  assert.equal((await plain('/hub/', { host: pos })).headers.location, '/pos-api/hub/setup')
  assert.notEqual((await plain('/hub', { host: 'kiosk.' + env.PUBLIC_ROOT_DOMAIN.toLowerCase() })).statusCode, 302)

  // The page: the download for the computer's own system first, no scripts.
  const win = await plain('/pos-api/hub/setup', { host: pos, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' })
  assert.equal(win.statusCode, 200)
  assert.match(win.headers['content-type'], /^text\/html/)
  assert.match(win.headers['content-security-policy'], /default-src 'none'/)
  assert.ok(!/<script/i.test(win.body))
  assert.ok(win.body.indexOf('id="windows"') < win.body.indexOf('id="linux"'), 'Windows first on Windows')
  assert.ok(win.body.includes('href="/pos-api/hub/setup.cmd"') && win.body.includes('href="/pos-api/hub/setup.sh"'))
  assert.ok(win.body.includes(`curl -fsSL ${api}/pos-api/hub/install.sh | sudo sh`))
  const lin = await plain('/pos-api/hub/setup', { host: pos, 'user-agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Firefox/131' })
  assert.ok(lin.body.indexOf('id="linux"') < lin.body.indexOf('id="windows"'), 'Linux first on Linux')

  // The Windows file: a download, Windows line endings, plain ASCII, this
  // cloud's installer, asks to run as administrator, opens the hub's page.
  const cmd = await plain('/pos-api/hub/setup.cmd', { host: pos })
  assert.equal(cmd.statusCode, 200)
  assert.equal(cmd.headers['content-disposition'], 'attachment; filename="macaroonie-hub-setup.cmd"')
  assert.equal(cmd.headers['content-type'], 'application/octet-stream')
  assert.ok(!/[^\r]\n/.test(cmd.body) && cmd.body.endsWith('\r\n'), 'every line ends \\r\\n')
  assert.ok(/^[\x00-\x7f]*$/.test(cmd.body), 'plain ASCII')
  assert.ok(!cmd.body.includes('__MACAROONIE_API__'))
  assert.ok(cmd.body.includes(`-Uri '${api}/pos-api/hub/install.ps1'`))
  assert.ok(cmd.body.includes('-Verb RunAs') && cmd.body.includes('fltmc'))
  assert.ok(cmd.body.includes('$global:MacaroonieHubFailed'))
  assert.ok(cmd.body.includes('start "" "http://localhost:9180/"'))
  // install.ps1 tells it whether the install worked.
  const ps1 = (await plain('/pos-api/hub/install.ps1', { host: pos })).body
  assert.ok(ps1.includes('$global:MacaroonieHubFailed = $true'))
  assert.ok(/^[\x00-\x7f]*$/.test(ps1), 'install.ps1 is plain ASCII (Windows PowerShell reads a file with no BOM as ANSI)')

  // The Linux file is the installer, as a download.
  const sh = await plain('/pos-api/hub/setup.sh', { host: pos })
  assert.equal(sh.headers['content-disposition'], 'attachment; filename="macaroonie-hub-setup.sh"')
  assert.equal(sh.body, (await plain('/pos-api/hub/install.sh', { host: pos })).body)

  // Run from the file without root, it runs itself again with sudo: a stand-in
  // `id` says "not root" and a stand-in `sudo` writes down what it was asked.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-setup-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\necho 1000\n', { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/sudo-args"\n`, { mode: 0o755 })
  const file = path.join(dir, 'macaroonie-hub-setup.sh')
  fs.writeFileSync(file, sh.body)
  const out = execFileSync('sh', [file, '--uninstall'], { cwd: dir, env: { ...process.env, PATH: bin + ':' + process.env.PATH } }).toString()
  assert.match(out, /password/)
  assert.deepEqual(fs.readFileSync(path.join(dir, 'sudo-args'), 'utf8').trim().split('\n'), ['sh', file, '--uninstall'])
  // Piped into sh (no file), it doesn't: it says to put sudo before sh.
  fs.rmSync(path.join(dir, 'sudo-args'))
  let piped = ''
  try {
    execFileSync('sh', ['-s'], { input: sh.body, cwd: dir, env: { ...process.env, PATH: bin + ':' + process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) { piped = String(e.stderr) }
  assert.match(piped, /put sudo before sh/)
  assert.ok(!fs.existsSync(path.join(dir, 'sudo-args')), 'piped, it never calls sudo')
  fs.rmSync(dir, { recursive: true, force: true })
})
