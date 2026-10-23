// Each device app on its own address, and devices disconnecting themselves:
// pos.{root} tills, kitchen.{root} kitchen screens (kds.{root} forwards),
// kiosk.{root} kiosks (routes/posSite.js); the code a device shows can only
// become its address's kind (POST /api/pos/venues/:id/link); devices are only
// set up that way (Store tech no longer makes codes to type);
// POST /pos-api/disconnect and /screen-api/disconnect (a device's settings);
// POST /pos-api/move (a device on another address moves to its own with a
// one-time hand-over code, POST /pos-api/pair, refused on another kind's address).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { showCode, linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { env } from '../src/config/env.js'

const ROOT = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
const ORIGIN = sub => `${env.PUBLIC_SITE_SCHEME}://${sub}.${ROOT}`
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pos', 'dist')

let ids, owner, V

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
const asDevice = d => ({ authorization: `Device ${d.device_id}.${d.secret}` })

async function pair(code, app) {
  return call('POST', '/pos-api/pair', { body: { code, ...(app ? { app } : {}) } })
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
})
after(closeApp)

test('Store tech names each kind\'s own address', async () => {
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.device_urls, { terminal: ORIGIN('pos'), kds: ORIGIN('kitchen'), kiosk: ORIGIN('kiosk') })
  const preview = await ok(owner.post(`/api/pos/venues/${V}/kitchen-test`, {}))
  assert.ok(preview.url.startsWith(ORIGIN('kitchen') + '/?kitchen_test='), preview.url)
})

test('a code shown on an address only becomes that kind; Store tech no longer makes codes', async () => {
  const shown = await showCode('kds')
  const asTill = await owner.post(`/api/pos/venues/${V}/link`, { code: shown.code, kind: 'terminal', name: 'Bar till' })
  assert.equal(asTill.status, 422)
  assert.match(asTill.json.error, /kitchen screen/)
  const linked = await owner.post(`/api/pos/venues/${V}/link`, { code: shown.code, name: 'Grill screen' })
  assert.equal(linked.status, 201, linked.body)
  assert.equal(linked.json.device.kind, 'kds')
  assert.equal(linked.json.device.paired, true)
  const again = await owner.post(`/api/pos/venues/${V}/link`, { code: shown.code, name: 'Grill screen 2' })
  assert.equal(again.status, 422, 'a code works once')

  // The old way (Store tech making a code to type on the device) is gone.
  assert.equal((await owner.post(`/api/pos/venues/${V}/devices`, { name: 'Old way', kind: 'terminal', settings: {} })).status, 404)
  assert.equal((await owner.post(`/api/pos/devices/${linked.json.device.id}/pairing-code`, {})).status, 404)
  // A hand-over code that isn't right is refused the same way on every address.
  const bad = await pair('ZZZZ-ZZZZ', 'kds')
  assert.equal(bad.status, 422)
  assert.notEqual(bad.json.code, 'wrong_address')
})

test('a device disconnects itself: its pairing stops, Store tech shows it not linked, linking a new code sets it up again', async () => {
  const d = await linkDevice(owner, V, { kind: 'kds', name: 'Pass screen' })
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(d) })).status, 200)
  const off = await call('POST', '/pos-api/disconnect', { headers: asDevice(d), body: {} })
  assert.equal(off.status, 200, off.body)
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(d) })).status, 401, 'the old pairing no longer works')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const row = setup.devices.find(x => x.id === d.id)
  assert.equal(row.paired, false)
  assert.equal(row.revoked_at, null, 'it is still there with its settings')
  const back = await linkDevice(owner, V, { kind: 'kds', deviceId: d.id })
  assert.equal(back.device_id, d.id)
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(back) })).status, 200)
  // Disconnecting needs the device's own pairing.
  assert.equal((await call('POST', '/pos-api/disconnect', { body: {} })).status, 401)

  // A kiosk may disconnect itself too (its routes are otherwise limited).
  const kd = await linkDevice(owner, V, { kind: 'kiosk', name: 'Door kiosk' })
  assert.equal((await call('POST', '/pos-api/disconnect', { headers: asDevice(kd), body: {} })).status, 200)
  assert.equal((await call('GET', '/pos-api/config', { headers: asDevice(kd) })).status, 401)
})

test('a device set up on another address moves to its own with a one-time code', async () => {
  // Set up from an address that isn't a kiosk address (no app, as a test or
  // local address sends), linked as a kiosk.
  const shown = await showCode(null)
  const made = await ok(owner.post(`/api/pos/venues/${V}/link`, { code: shown.code, kind: 'kiosk', name: 'Window kiosk' }))
  const d = { device_id: made.device.id, secret: shown.secret }
  const moved = await call('POST', '/pos-api/move', { headers: asDevice(d), body: {} })
  assert.equal(moved.status, 200, moved.body)
  assert.equal(moved.json.kind, 'kiosk')
  assert.equal(moved.json.url, ORIGIN('kiosk') + '/#pair=' + encodeURIComponent(moved.json.code))
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(d) })).status, 200, 'the old copy works until the move arrives')
  const wrong = await pair(moved.json.code, 'terminal')
  assert.equal(wrong.status, 422, 'the code is for the kiosk address only')
  assert.equal(wrong.json.code, 'wrong_address')
  assert.deepEqual(wrong.json.errors, [{ device_kind: 'kiosk', url: ORIGIN('kiosk') }])
  const there = await pair(moved.json.code, 'kiosk')
  assert.equal(there.status, 200, there.body)
  assert.equal(there.json.device_id, made.device.id, 'the same kiosk, with its settings')
  assert.equal((await pair(moved.json.code, 'kiosk')).status, 422, 'a hand-over code works once')
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(d) })).status, 401, 'the old copy stops')
  assert.equal((await call('GET', '/pos-api/me', { headers: asDevice(there.json) })).status, 200)
})

test('a menu screen disconnects itself and can be paired again as the same screen', async () => {
  const p = (await call('POST', '/screen-api/pairings', { body: { device: { width: 1920, height: 1080 } } })).json
  const screen = await ok(owner.post('/api/screens/screens/claim', { code: p.code, name: 'Window board', venue_id: V }))
  const sid = screen.id
  const auth = { authorization: `Screen ${sid}.${p.secret}` }
  assert.equal((await call('GET', '/screen-api/config', { headers: auth })).status, 200)
  assert.equal((await call('POST', '/screen-api/disconnect', { headers: auth, body: {} })).status, 200)
  assert.equal((await call('GET', '/screen-api/config', { headers: auth })).status, 401, 'its pairing no longer works')
  const list = await ok(owner.get('/api/screens/screens'))
  const row = list.screens.find(s => s.id === sid)
  assert.equal(row.paired, false)
  assert.equal(row.name, 'Window board', 'it keeps its name and boards')
  const p2 = (await call('POST', '/screen-api/pairings', { body: {} })).json
  await ok(owner.post('/api/screens/screens/claim', { code: p2.code, screen_id: sid }))
  assert.equal((await call('GET', '/screen-api/config', { headers: { authorization: `Screen ${sid}.${p2.secret}` } })).status, 200)
  assert.equal((await call('POST', '/screen-api/disconnect', { body: {} })).status, 401, 'needs the screen\'s own pairing')
})

test('the device app is served on each address, named for it; kds. forwards to kitchen.', async t => {
  const fwd = await call('GET', '/?x=1', { headers: { host: 'kds.' + ROOT } })
  assert.equal(fwd.status, 301)
  assert.equal(fwd.headers.location, 'https://kitchen.' + ROOT + '/?x=1')
  // The API itself still answers on every address.
  assert.equal((await call('POST', '/pos-api/pair', { headers: { host: 'kitchen.' + ROOT }, body: { code: 'ZZZZ-ZZZZ' } })).status, 422)
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { t.skip('pos/dist not built'); return }
  for (const [host, name] of [['pos', 'Macaroonie Till'], ['kitchen', 'Macaroonie Kitchen'], ['kiosk', 'Macaroonie Kiosk']]) {
    const page = await call('GET', '/', { headers: { host: host + '.' + ROOT } })
    assert.equal(page.status, 200, host)
    assert.match(page.headers['content-type'], /text\/html/)
    const m = await call('GET', '/manifest.webmanifest', { headers: { host: host + '.' + ROOT } })
    assert.equal(m.status, 200, host + ' manifest')
    assert.equal(JSON.parse(m.body).name, name)
  }
})
