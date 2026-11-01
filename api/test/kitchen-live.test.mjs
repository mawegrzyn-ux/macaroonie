// The live kitchen view's signed link (Store tech > Kitchen screens > Live
// view): who may make one, what its setup holds (the venue's real kitchen
// screens), that its sync gives the venue's real kitchen orders as a kitchen
// screen gets them, that a link opens only its own kind of page and venue,
// and that its socket joins the venue's till room (and nothing else).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import WebSocket from 'ws'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { makeLink } from '../src/services/previewLinks.js'
import { sequencer } from '../src/services/posSvc.js'
import { attachWss, broadcast } from '../src/config/ws.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, other, dish, grill, spare

async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json }
}
const live = token => pub('/pos-api/kitchen-live?token=' + encodeURIComponent(token))
const liveSync = (token, since = 0) => pub('/pos-api/kitchen-live/sync?token=' + encodeURIComponent(token) + '&since=' + since)

function orderIn(n) {
  const orderId = crypto.randomUUID()
  return {
    id: ulid(), venue_id: V, device_id: null, staff_id: null, type: 'kitchen.order_in', client_at: new Date().toISOString(),
    payload: { order: {
      id: 'web-' + orderId, order_id: orderId, number: String(n), guest: 'Sam',
      items: [{ id: 'i' + n, item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 2 }],
    } },
  }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  other = await fillTenant(B.owner, ids.b, { mark: 'Yyb', slug: 'yyb' })
  assert.deepEqual(other.failed, [], 'fixtures B')
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[1], section_id: menu.sections[0].id }
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const wok = setup.kds_stations.find(s => s.kind === 'prep')
  grill = await linkDevice(owner, V, { kind: 'kds', name: 'Grill screen', settings: { station_ids: [wok.id], columns: 4, text_size: 'large' } })
  // Set up in Store tech with its device disconnected.
  spare = await linkDevice(owner, V, { kind: 'kds', name: 'Spare screen' })
  const app = await getApp()
  const off = await app.inject({
    method: 'POST', url: '/pos-api/disconnect',
    headers: { authorization: `Device ${spare.device_id}.${spare.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, 'content-type': 'application/json' },
    payload: '{}',
  })
  assert.equal(off.statusCode, 200, 'disconnected')
})
after(closeApp)

test('the owner gets a link that opens the venue\'s real kitchen screens', async () => {
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
  assert.match(link.url, /\/\?kitchen_live=/)
  const hours = (Date.parse(link.expires_at) - Date.now()) / 3600_000
  assert.ok(hours > 11.9 && hours <= 12, 'works for 12 hours')
  const res = await live(link.token)
  assert.equal(res.status, 200)
  const d = res.json
  assert.equal(d.venue.id, V)
  assert.ok(d.config.stations.length > 0, 'stations')
  assert.ok(d.config.flows.length > 0, 'flows')
  assert.ok(d.config.version, 'a config version')
  assert.equal(d.config.printers, undefined, 'printers stay on the screens')
  assert.equal(d.config.device, undefined, 'no device of its own')
  const g = d.screens.find(s => s.id === grill.id)
  assert.ok(g, 'the kitchen screens as set up')
  assert.equal(g.linked, true)
  assert.deepEqual(g.settings.station_ids?.length, 1, 'each with its own settings')
  assert.equal(g.settings.text_size, 'large')
  const sp = d.screens.find(s => s.id === spare.id)
  assert.equal(sp?.linked, false, 'a screen with no device linked is listed too')
  assert.equal(JSON.stringify(d).includes('secret'), false, 'no secrets')
  assert.equal(JSON.stringify(d).includes('Yyb'), false, 'nothing of the other tenant')
  assert.ok(Date.parse(d.expires_at) > Date.now())

  // A screen removed in Store tech leaves the live view.
  const gone = await linkDevice(owner, V, { kind: 'kds', name: 'Old screen' })
  assert.ok((await live(link.token)).json.screens.some(s => s.id === gone.id))
  await ok(owner.delete('/api/pos/devices/' + gone.id))
  assert.equal((await live(link.token)).json.screens.some(s => s.id === gone.id), false, 'a removed screen isn\'t shown')
})

test('its sync gives the venue\'s real kitchen orders, then what changed', async () => {
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
  const first = await liveSync(link.token, 0)
  assert.equal(first.status, 200)
  assert.equal(first.json.reset, true)
  assert.equal(first.json.source, 'cloud')
  assert.ok(first.json.server_time)
  const r0 = await sequencer(ids.a, V).submit(orderIn(700))
  assert.ok(r0.ok, r0.error)
  const all = await liveSync(link.token, 0)
  assert.equal(all.json.reset, true, 'from the start: everything')
  assert.ok(all.json.orders.some(x => x.number === '700'))
  const before = all.json.seq
  assert.ok(before > 0)
  const r = await sequencer(ids.a, V).submit(orderIn(701))
  assert.ok(r.ok, r.error)
  const next = await liveSync(link.token, before)
  assert.equal(next.status, 200)
  assert.ok(!next.json.reset, 'only what changed')
  assert.ok(next.json.seq > before)
  const o = next.json.orders.find(x => x.number === '701')
  assert.ok(o, 'the new order')
  assert.equal(o.guest, 'Sam')
  assert.equal(next.json.orders.some(x => x.number === '700'), false, 'not what was already there')
  // Nothing new: nothing sent.
  const same = await liveSync(link.token, next.json.seq)
  assert.deepEqual(same.json.orders, [])
  // A screen paired at the venue gets the same order through its own sync.
  const app = await getApp()
  const asScreen = await app.inject({
    method: 'GET', url: '/pos-api/kitchen/sync?since=0',
    headers: { authorization: `Device ${grill.device_id}.${grill.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.ok(asScreen.json().orders.some(x => x.number === '701'), 'the same as a kitchen screen')
  // The other tenant's kitchen never shows.
  const otherLink = await ok(as(B.owner, ids.b).post(`/api/pos/venues/${other.ids.venue}/kitchen-live`, {}))
  const theirs = await liveSync(otherLink.token, 0)
  assert.equal(theirs.json.orders.some(x => x.number === '701'), false)
})

test('who may make a link', async () => {
  const viewer = await as(A.viewer, ids.a).post(`/api/pos/venues/${V}/kitchen-live`, {})
  assert.equal(viewer.status, 403, 'Store tech is none for viewers by default')
  const otherVenue = await as(B.owner, ids.b).post(`/api/pos/venues/${V}/kitchen-live`, {})
  assert.equal(otherVenue.status, 404, 'another tenant\'s venue')
})

test('a link opens only its own kind of page, its own venue, and not after it runs out', async () => {
  const testLink = await ok(owner.post(`/api/pos/venues/${V}/kitchen-test`, {}))
  assert.equal((await live(testLink.token)).status, 401, 'a test bench link isn\'t a live view link')
  assert.equal((await liveSync(testLink.token)).status, 401)
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
  assert.equal((await pub('/pos-api/kitchen-test?token=' + encodeURIComponent(link.token))).status, 401, 'a live view link isn\'t a test bench link')
  assert.equal((await pub('/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token))).status, 401, 'nor a kiosk preview')

  const expired = await makeLink('kitchen_live', { t: ids.a, v: V }, -1)
  assert.equal((await live(expired)).status, 401, 'run out')
  assert.equal((await liveSync(expired)).status, 401, 'run out')
  const [body, sig] = link.token.split('.')
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), v: other.ids.venue })).toString('base64url') + '.' + sig
  assert.equal((await live(tampered)).status, 401, 'a changed link')
  assert.equal((await live('nonsense')).status, 401)
  assert.equal((await liveSync('')).status, 401)

  // A signed link naming another tenant's venue (it can't be made through the
  // admin, but the reads must still stay inside the link's tenant).
  const crossed = await makeLink('kitchen_live', { t: ids.a, v: other.ids.venue }, 1)
  assert.equal((await live(crossed)).status, 404)
  assert.equal((await liveSync(crossed)).status, 404)
})

test('its socket joins the venue\'s till room only', async () => {
  const server = http.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const wss = attachWss(server, async () => { throw new Error('no logins here') })
  const port = server.address().port
  const opened = []
  const open = token => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?kitchen_live=${encodeURIComponent(token)}`)
    opened.push(ws)
    const got = []
    ws.on('message', m => got.push(JSON.parse(String(m))))
    ws.on('close', code => resolve({ ws, got, closed: code }))
    ws.on('open', () => setTimeout(() => resolve({ ws, got, closed: null }), 150))
    ws.on('error', () => {})
  })
  try {
    const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
    const a = await open(link.token)
    assert.equal(a.closed, null, 'stays open')
    assert.equal(a.got[0]?.type, 'connected')
    assert.equal(a.got[0]?.venueId, V)
    broadcast('pos:' + V, { type: 'pos.seq', seq: 9, kinds: ['kitchen'] })
    broadcast('pos:' + other.ids.venue, { type: 'pos.seq', seq: 10, kinds: ['kitchen'] })
    broadcast(V, { type: 'booking.created' })
    await new Promise(r => setTimeout(r, 150))
    assert.deepEqual(a.got.slice(1).map(m => m.type + ':' + (m.seq ?? '')), ['pos.seq:9'], 'its venue\'s till room, nothing else')
    a.ws.send('{"type":"ping"}')
    await new Promise(r => setTimeout(r, 150))
    assert.equal(a.got.at(-1)?.type, 'pong', 'answers its heartbeat')
    a.ws.close()

    for (const bad of [
      await makeLink('kitchen_live', { t: ids.a, v: V }, -1),
      await makeLink('kitchen_test', { t: ids.a, v: V }, 1),
      await makeLink('kitchen_live', { t: ids.a, v: other.ids.venue }, 1),
      'nonsense',
    ]) {
      const b = await open(bad)
      assert.equal(b.closed, 4003, 'refused')
    }
  } finally {
    // A socket a failed check left open would keep the server (and the test) waiting.
    for (const ws of opened) ws.terminate()
    for (const c of wss.clients) c.terminate()
    await new Promise(r => wss.close(() => r()))
    await new Promise(r => server.close(() => r()))
  }
})
