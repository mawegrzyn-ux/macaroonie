// The installer app (installer.{root}, migration 184): a till, kitchen
// screen or kiosk shows a code of its own (POST /pos-api/pairings, with a QR
// code to /link/<code>) and polls it; someone signed in looks the code up
// (POST /api/installer/lookup) and links it (POST /api/pos/venues/:id/link),
// as a new device or a new device for one already there. Menu screens keep
// their own codes (screen_pairings) and a code is never live in both tables.
// GET /api/installer/venues/:id lists what a venue has; routes/installerSite.js
// serves the admin build on the installer address.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { as, getApp, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { env } from '../src/config/env.js'

const ROOT = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
const ORIGIN = sub => `${env.PUBLIC_SITE_SCHEME}://${sub}.${ROOT}`
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin', 'dist')
const CODE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/

let ids, owner, operator, viewer, other, V, VB

async function call(method, url, { body, headers = {} } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body, headers: res.headers }
}
const asDevice = (id, secret) => ({ authorization: `Device ${id}.${secret}` })

/** A device asking for a code to show, as the till app does on its address. */
async function showCode(app, device = { width: 1280, height: 800, dpr: 1.5, ua: 'Test tablet', app_version: '1.2.3' }) {
  const res = await call('POST', '/pos-api/pairings', { body: { ...(app ? { app } : {}), device } })
  assert.equal(res.status, 200, res.body)
  return res.json
}
const poll = p => call('GET', `/pos-api/pairings/${p.id}`, { headers: { authorization: 'Pairing ' + p.secret } })

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  VB = (await ok(other.post('/api/venues', { name: 'Other Hertford', slug: 'other-hertford', timezone: 'Europe/London' }))).id
})
after(closeApp)

test('a kitchen screen shows a code, someone links it from the installer, the screen signs in', async () => {
  const p = await showCode('kds')
  assert.match(p.code, CODE)
  assert.equal(p.link_url, ORIGIN('installer') + '/link/' + p.code)
  assert.equal((await poll(p)).json.status, 'waiting')
  // A wrong secret learns nothing.
  const wrong = await call('GET', `/pos-api/pairings/${p.id}`, { headers: { authorization: 'Pairing ' + 'x'.repeat(40) } })
  assert.equal(wrong.status, 404)

  const look = await ok(owner.post('/api/installer/lookup', { code: p.code.toLowerCase().replace('-', ' ') }))
  assert.equal(look.kind, 'kds')
  assert.equal(look.status, 'waiting')
  assert.deepEqual(look.device, { width: 1920, height: 1200, ua: 'Test tablet' })
  assert.equal(look.can_link, true)

  const asTill = await owner.post(`/api/pos/venues/${V}/link`, { code: p.code, kind: 'terminal', name: 'Wrong kind' })
  assert.equal(asTill.status, 422, 'the address it was shown on decides the kind')
  assert.match(asTill.json.error, /kitchen screen/)
  const noName = await owner.post(`/api/pos/venues/${V}/link`, { code: p.code })
  assert.equal(noName.status, 422)

  const linked = await owner.post(`/api/pos/venues/${V}/link`, { code: p.code, name: 'Grill screen' })
  assert.equal(linked.status, 201, linked.body)
  const dev = linked.json.device
  assert.equal(dev.kind, 'kds')
  assert.equal(dev.name, 'Grill screen')

  const paired = (await poll(p)).json
  assert.equal(paired.status, 'paired')
  assert.equal(paired.device_id, dev.id)
  assert.equal(paired.kind, 'kds')
  assert.equal(paired.venue_id, V)
  const me = await call('GET', '/pos-api/me', { headers: asDevice(dev.id, p.secret) })
  assert.equal(me.status, 200, me.body)

  const again = await owner.post(`/api/pos/venues/${V}/link`, { code: p.code, name: 'Twice' })
  assert.equal(again.status, 422, 'a code links once')
  assert.equal((await ok(owner.post('/api/installer/lookup', { code: p.code }))).status, 'linked')

  const overview = await ok(owner.get(`/api/installer/venues/${V}`))
  const listed = overview.devices.find(d => d.id === dev.id)
  assert.ok(listed, 'the overview lists it')
  assert.equal(listed.paired, true)
  assert.equal(listed.app_version, '1.2.3')
  assert.deepEqual(overview.addresses, { terminal: ORIGIN('pos'), kds: ORIGIN('kitchen'), kiosk: ORIGIN('kiosk'), screen: ORIGIN('screens') })
  assert.ok(Array.isArray(overview.stations) && overview.stations.every(s => s.id && s.name))
  assert.equal(overview.can.devices, 'manage')
  // Till setup names the installer's address.
  assert.equal((await ok(owner.get(`/api/pos/venues/${V}/setup`))).installer_url, ORIGIN('installer'))
})

test('a new device for a till already here: the new one signs in, the old one stops', async () => {
  const made = await ok(owner.post(`/api/pos/venues/${V}/devices`, { name: 'Bar till', kind: 'terminal', settings: {} }))
  const first = await call('POST', '/pos-api/pair', { body: { code: made.pairing_code } })
  assert.equal(first.status, 200, first.body)
  const tillId = first.json.device_id
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(tillId, first.json.secret) })).status, 200)

  // A kitchen screen's code can't become the till.
  const kds = await showCode('kds')
  const mismatch = await owner.post(`/api/pos/venues/${V}/link`, { code: kds.code, device_id: tillId })
  assert.equal(mismatch.status, 422)
  // Another tenant's device id isn't found.
  const theirs = await ok(other.post(`/api/pos/venues/${VB}/devices`, { name: 'Their till', kind: 'terminal', settings: {} }))
  const p0 = await showCode()
  const notOurs = await owner.post(`/api/pos/venues/${V}/link`, { code: p0.code, device_id: theirs.device.id })
  assert.equal(notOurs.status, 404)

  const p = await showCode('terminal')
  const res = await owner.post(`/api/pos/venues/${V}/link`, { code: p.code, device_id: tillId, name: 'ignored' })
  assert.equal(res.status, 200, res.body)
  assert.equal(res.json.device.id, tillId)
  assert.equal(res.json.device.name, 'Bar till', 'the till keeps its name and settings')
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(tillId, p.secret) })).status, 200)
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(tillId, first.json.secret) })).status, 401, 'the old device stops')

  // A code shown on a test address (no app) takes the kind it is linked as.
  const any = await showCode()
  const kiosk = await owner.post(`/api/pos/venues/${V}/link`, { code: any.code, kind: 'kiosk', name: 'Door kiosk' })
  assert.equal(kiosk.status, 201, kiosk.body)
  assert.equal(kiosk.json.device.kind, 'kiosk')
})

test('refusals: view only, another tenant, run-out codes; menu screens keep their own route', async () => {
  const p = await showCode('terminal')
  assert.equal((await viewer.get(`/api/installer/venues/${V}`)).status, 403, 'no Till setup or Menu screens access')
  // An operator sees the menu screens (Menu screens view) but not the tills, and links nothing.
  const op = await ok(operator.get(`/api/installer/venues/${V}`))
  assert.deepEqual(op.can, { devices: 'none', screens: 'view' })
  assert.equal(op.devices, null)
  assert.ok(Array.isArray(op.screens))
  assert.equal((await operator.post('/api/installer/lookup', { code: p.code })).status, 403)
  assert.equal((await operator.post(`/api/pos/venues/${V}/link`, { code: p.code, name: 'No' })).status, 403)

  // Another tenant can't link into this venue, and can't see the code once it is linked.
  assert.equal((await other.post(`/api/pos/venues/${V}/link`, { code: p.code, name: 'Theirs' })).status, 404)
  assert.equal((await other.get(`/api/installer/venues/${V}`)).status, 404)
  assert.equal((await other.post('/api/installer/lookup', { code: p.code })).status, 200, 'an unlinked code is anyone\'s to find')
  await ok(owner.post(`/api/pos/venues/${V}/link`, { code: p.code, name: 'Counter till' }))
  assert.equal((await other.post('/api/installer/lookup', { code: p.code })).status, 404)
  assert.equal((await owner.post('/api/installer/lookup', { code: 'ZZZ-ZZZ' })).status, 404)

  // A code that ran out.
  const old = await showCode('kiosk')
  await sql`UPDATE pos_pairings SET expires_at = now() - interval '1 minute' WHERE id = ${old.id}`
  assert.equal((await owner.post(`/api/pos/venues/${V}/link`, { code: old.code, name: 'Late' })).status, 422)
  assert.equal((await ok(owner.post('/api/installer/lookup', { code: old.code }))).status, 'expired')
  assert.equal((await poll(old)).json.status, 'expired')

  // A menu screen's code: the installer knows it, the till route doesn't take it, the screens route does.
  const sp = await call('POST', '/screen-api/pairings', { body: { device: { width: 1920, height: 1080 } } })
  assert.equal(sp.status, 200, sp.body)
  assert.equal(sp.json.link_url, ORIGIN('installer') + '/link/' + sp.json.code)
  const look = await ok(owner.post('/api/installer/lookup', { code: sp.json.code }))
  assert.equal(look.kind, 'screen')
  assert.deepEqual(look.device, { width: 1920, height: 1080, ua: null })
  assert.equal((await owner.post(`/api/pos/venues/${V}/link`, { code: sp.json.code, name: 'No' })).status, 422)
  const claimed = await owner.post('/api/screens/screens/claim', { code: sp.json.code, name: 'Window screen', venue_id: V })
  assert.equal(claimed.status, 200, claimed.body)
  const overview = await ok(owner.get(`/api/installer/venues/${V}`))
  assert.ok(overview.screens.some(s => s.id === claimed.json.id && s.paired))
})

test('the installer address serves the admin app with its own manifest', { skip: !fs.existsSync(path.join(DIST, 'index.html')) && 'admin/dist not built' }, async () => {
  const host = { host: 'installer.' + ROOT }
  const page = await call('GET', '/install', { headers: host })
  assert.equal(page.status, 200)
  assert.match(page.headers['content-type'], /text\/html/)
  assert.match(page.body, /<div id="root">/)
  const link = await call('GET', '/link/ABC-DEF', { headers: host })
  assert.equal(link.status, 200, 'a QR code\'s link opens the app')
  const manifest = await call('GET', '/manifest.webmanifest', { headers: host })
  assert.equal(manifest.status, 200)
  assert.equal(manifest.json.name, 'Macaroonie Installer')
  assert.equal(manifest.json.start_url, '/install')
  const health = await call('GET', '/api/health', { headers: host })
  assert.equal(health.status, 200, 'API paths pass through')
  const http = await call('GET', '/install', { headers: { ...host, 'x-forwarded-proto': 'http' } })
  assert.equal(http.status, 301)
  assert.equal(http.headers.location, 'https://installer.' + ROOT + '/install')
})
