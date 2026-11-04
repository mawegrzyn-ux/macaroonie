// The live kitchen view's signed link (Store tech > Kitchen screens > Live
// view): who may make one, what its setup holds (the venue's real kitchen
// screens), that its sync gives the venue's real kitchen orders as a kitchen
// screen gets them, that a link opens only its own kind of page and venue,
// and that its socket joins the venue's till room (and nothing else).
// Its order ready boards: the venue's menu screens that show an Order status
// block and its board stations, each read by the screen player in live mode
// (/screen-api/live/*, its own socket) by the same link, framed by the live view.
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
import { env } from '../src/config/env.js'

const ROOT = env.PUBLIC_ROOT_DOMAIN.toLowerCase()

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


// ── Order ready boards ───────────────────────────────────────────

const enc = encodeURIComponent
const liveConfig = (token, q) => pub('/screen-api/live/config?token=' + enc(token) + q)
const liveOrders = token => pub('/screen-api/live/orders?token=' + enc(token))
const ORDER_BLOCK = { id: 'o', type: 'order_status', x: 0, y: 0, w: 1920, h: 1080, opts: { board: 'Collect here' } }

async function pairScreen(by, venueId, name) {
  const app = await getApp()
  const p = (await app.inject({ method: 'POST', url: '/screen-api/pairings', payload: { device: { width: 1920, height: 1080 } } })).json()
  const scr = await ok(by.post('/api/screens/screens/claim', { code: p.code, name, venue_id: venueId }))
  return { ...scr, secret: p.secret }
}
async function board(by, name, blocks) {
  const d = await ok(by.post('/api/screens/designs', { name }))
  await ok(by.put('/api/screens/designs/' + d.id, { name, width: 1920, height: 1080, layout: { blocks } }))
  return d
}

let orb, plainScreen, listScreen, theirScreen, collect, theirBoard
async function boardsSetUp() {
  if (orb) return
  collect = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Collect here', kind: 'board' }))
  const withOrders = await board(owner, 'Pick up', [ORDER_BLOCK])
  const menuOnly = await board(owner, 'Menu only', [{ id: 'h', type: 'heading', x: 0, y: 0, w: 800, h: 200, opts: { text: 'Hello' } }])
  orb = await pairScreen(owner, V, 'Pick up screen')
  await ok(owner.patch('/api/screens/screens/' + orb.id, { design_id: withOrders.id, width: 1080, height: 1920, rotation: 90 }))
  plainScreen = await pairScreen(owner, V, 'Menu screen')
  await ok(owner.patch('/api/screens/screens/' + plainScreen.id, { design_id: menuOnly.id }))
  // A playlist of a menu board and the order board: it shows order numbers too.
  const list = await ok(owner.post('/api/screens/playlists', { name: 'Day and pick up' }))
  await ok(owner.put('/api/screens/playlists/' + list.id, { name: 'Day and pick up', items: [{ design_id: menuOnly.id, duration_secs: 10 }, { design_id: withOrders.id, duration_secs: 10 }] }))
  listScreen = await pairScreen(owner, V, 'Playlist screen')
  await ok(owner.patch('/api/screens/screens/' + listScreen.id, { playlist_id: list.id }))
  // The other tenant's board screen and board station.
  const B_ = as(B.owner, ids.b)
  const theirs = await board(B_, 'Their pick up', [ORDER_BLOCK])
  theirScreen = await pairScreen(B_, other.ids.venue, 'Their screen')
  await ok(B_.patch('/api/screens/screens/' + theirScreen.id, { design_id: theirs.id }))
  theirBoard = await ok(B_.post(`/api/pos/venues/${other.ids.venue}/kds-stations`, { name: 'Their board', kind: 'board' }))
}

test('the live view lists the venue\'s order ready boards: menu screens with order numbers, and board stations', async () => {
  await boardsSetUp()
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
  const d = (await live(link.token)).json
  assert.ok(d.boards, 'boards')
  const shown = d.boards.screens.map(s => s.id)
  assert.ok(shown.includes(orb.id), 'a screen showing an Order status block')
  assert.ok(shown.includes(listScreen.id), 'a screen whose playlist has one')
  assert.ok(!shown.includes(plainScreen.id), 'not a screen showing menus only')
  assert.ok(!shown.includes(theirScreen.id), 'not the other tenant\'s')
  const o = d.boards.screens.find(s => s.id === orb.id)
  assert.deepEqual([o.name, o.width, o.height, o.rotation, o.linked], ['Pick up screen', 1080, 1920, 90, true], 'its size as people see it, and its device')
  assert.ok(d.boards.stations.some(st => st.id === collect.id && st.name === 'Collect here'), 'board stations')
  assert.ok(!d.boards.stations.some(st => st.id === theirBoard.id))
  assert.equal(d.boards.stations.every(st => d.config.stations.find(x => x.id === st.id)?.kind === 'board'), true, 'board stations only')
  assert.equal(d.boards.address, env.PUBLIC_SITE_SCHEME + '://screens.' + ROOT, 'the players\' address')
  assert.equal(JSON.stringify(d.boards).includes('secret'), false, 'no secrets')
})

test('the player reads a board by the live view\'s link: a menu screen, a plain board, the numbers', async () => {
  await boardsSetUp()
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
  // A menu screen of the venue, as it shows now (no venue hub: the frame reads the cloud).
  const sc = await liveConfig(link.token, '&screen=' + orb.id)
  assert.equal(sc.status, 200, JSON.stringify(sc.json))
  assert.equal(sc.json.screen.id, orb.id)
  assert.equal(sc.json.needs_orders, true)
  assert.equal(sc.json.venue.id, V)
  assert.ok(Object.values(sc.json.designs).some(dd => dd.layout.blocks.some(b => b.type === 'order_status')))
  assert.equal('hub' in sc.json, false, 'no venue hub key')
  assert.ok(sc.json.version)
  const same = await liveConfig(link.token, '&screen=' + orb.id + '&version=' + sc.json.version)
  assert.deepEqual([same.json.unchanged, same.json.version], [true, sc.json.version], 'unchanged')
  // The same config a paired screen gets.
  const app = await getApp()
  const paired = (await app.inject({ method: 'GET', url: '/screen-api/config', headers: { authorization: `Screen ${orb.id}.${orb.secret}` } })).json()
  assert.equal(paired.version, sc.json.version, 'the screen\'s own config')
  // Any menu screen of the venue; never another tenant's.
  assert.equal((await liveConfig(link.token, '&screen=' + plainScreen.id)).status, 200)
  assert.equal((await liveConfig(link.token, '&screen=' + theirScreen.id)).status, 404, 'another tenant\'s screen')

  // A plain board of a board station's numbers, and of every order.
  const pb = await liveConfig(link.token, '&board=' + collect.id)
  assert.equal(pb.status, 200, JSON.stringify(pb.json))
  const blocks = Object.values(pb.json.designs)[0].layout.blocks
  assert.deepEqual(blocks.map(b => [b.type, b.opts.board]), [['order_status', 'Collect here']], 'one Order status block naming the board')
  assert.deepEqual([pb.json.needs_orders, pb.json.screen.rotation, pb.json.venue.id, pb.json.design_id], [true, 0, V, 'live-board-' + collect.id])
  const all = await liveConfig(link.token, '&board=all')
  assert.equal(Object.values(all.json.designs)[0].layout.blocks[0].opts.board, '', 'no board picked: every counter and online order')
  assert.equal((await liveConfig(link.token, '&board=' + theirBoard.id)).status, 404, 'another tenant\'s board station')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const prep = setup.kds_stations.find(st => st.kind === 'prep')
  assert.equal((await liveConfig(link.token, '&board=' + prep.id)).status, 404, 'a prep station isn\'t a board')

  // The numbers, as the paired screen gets them.
  const r = await sequencer(ids.a, V).submit(orderIn(801))
  assert.ok(r.ok, r.error)
  const lo = await liveOrders(link.token)
  assert.equal(lo.status, 200)
  const theirsToo = (await app.inject({ method: 'GET', url: '/screen-api/orders', headers: { authorization: `Screen ${orb.id}.${orb.secret}` } })).json()
  const nums = o => [...(o.preparing || []), ...(o.ready || [])].map(x => x.number).sort()
  assert.deepEqual(nums(lo.json.orders), nums(theirsToo.orders), 'the same numbers')
  assert.ok(nums(lo.json.orders).includes('801'))
  assert.ok(lo.json.orders.boards && 'collect here' in lo.json.orders.boards, 'per board')

  // Refused: no screen or board, both, a link of another kind, run out, nonsense.
  assert.equal((await liveConfig(link.token, '')).status, 400)
  assert.equal((await liveConfig(link.token, '&screen=' + orb.id + '&board=all')).status, 400)
  const testLink = await ok(owner.post(`/api/pos/venues/${V}/kitchen-test`, {}))
  const expired = await makeLink('kitchen_live', { t: ids.a, v: V }, -1)
  for (const bad of [testLink.token, expired, 'nonsense-token-x']) {
    assert.equal((await liveConfig(bad, '&board=all')).status, 401, 'config ' + bad.slice(0, 8))
    assert.equal((await liveOrders(bad)).status, 401, 'orders ' + bad.slice(0, 8))
  }
  // A link naming another tenant's venue reads nothing of it.
  const crossed = await makeLink('kitchen_live', { t: ids.a, v: other.ids.venue }, 1)
  assert.equal((await liveConfig(crossed, '&board=all')).status, 404)
  assert.equal((await liveConfig(crossed, '&screen=' + theirScreen.id)).status, 404)
})

test('the player\'s page may be framed by the platform\'s hosts in live mode only', async () => {
  const app = await getApp()
  const page = url => app.inject({ method: 'GET', url, headers: { host: 'screens.' + ROOT } })
  const liveRes = await page('/?board_live=abc&board=all')
  assert.equal(liveRes.statusCode, 200)
  assert.equal(liveRes.headers['x-frame-options'], undefined, 'no SAMEORIGIN')
  assert.match(String(liveRes.headers['content-security-policy']), new RegExp("frame-ancestors 'self' \\S+://" + ROOT.replace(/\./g, '\\.') + ' \\S+://\\*\\.' + ROOT.replace(/\./g, '\\.')))
  const plain = await page('/')
  assert.equal(plain.headers['x-frame-options'], 'SAMEORIGIN', 'a screen\'s own page stays unframed')
  assert.equal(plain.headers['content-security-policy'], undefined)
})

test('a board\'s socket joins its screen\'s rooms, or the venue\'s screens room for a plain board', async () => {
  await boardsSetUp()
  const server = http.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const wss = attachWss(server, async () => { throw new Error('no logins here') })
  const port = server.address().port
  const opened = []
  const open = query => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`)
    opened.push(ws)
    const got = []
    ws.on('message', m => got.push(JSON.parse(String(m))))
    ws.on('close', code => resolve({ ws, got, closed: code }))
    ws.on('open', () => setTimeout(() => resolve({ ws, got, closed: null }), 150))
    ws.on('error', () => {})
  })
  try {
    const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-live`, {}))
    const s = await open('board_live=' + enc(link.token) + '&screen=' + orb.id)
    const b = await open('board_live=' + enc(link.token))
    assert.deepEqual([s.closed, b.closed], [null, null], 'both stay open')
    assert.equal(s.got[0]?.type, 'connected')
    broadcast('screens:' + V, { type: 'kitchen.board' })
    broadcast('screen:' + orb.id, { type: 'screen.identify', seconds: 5 })
    broadcast('screens-t:' + ids.a, { type: 'screens.changed' })
    broadcast('menus:' + ids.a, { type: 'menus.live' })
    broadcast('screens:' + other.ids.venue, { type: 'kitchen.board', other: true })
    broadcast('screen:' + theirScreen.id, { type: 'screen.reload' })
    broadcast('pos:' + V, { type: 'pos.seq', seq: 1 })
    await new Promise(r => setTimeout(r, 200))
    assert.deepEqual(s.got.slice(1).map(m => m.type), ['kitchen.board', 'screen.identify', 'screens.changed', 'menus.live'], 'its screen\'s rooms')
    assert.deepEqual(b.got.slice(1).map(m => m.type), ['kitchen.board'], 'the venue\'s screens room only')
    s.ws.send('{"type":"ping"}')
    await new Promise(r => setTimeout(r, 150))
    assert.equal(s.got.at(-1)?.type, 'pong', 'answers its heartbeat')

    for (const bad of [
      'board_live=' + enc(link.token) + '&screen=' + theirScreen.id,
      'board_live=' + enc(link.token) + '&screen=not-a-screen',
      'board_live=' + enc(await makeLink('kitchen_live', { t: ids.a, v: V }, -1)),
      'board_live=' + enc(await makeLink('kitchen_test', { t: ids.a, v: V }, 1)),
      'board_live=nonsense',
    ]) {
      const x = await open(bad)
      assert.equal(x.closed, 4003, 'refused: ' + bad.slice(0, 40))
    }
  } finally {
    for (const ws of opened) ws.terminate()
    for (const c of wss.clients) c.terminate()
    await new Promise(r => wss.close(() => r()))
    await new Promise(r => server.close(() => r()))
  }
})
