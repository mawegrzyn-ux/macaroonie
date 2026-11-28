// The menu screen Store status block's data (28 Nov 2026): GET
// /screen-api/tech gives a paired screen its own venue's kit as the words
// the block draws (shared/techBoard.js screenTiles()), only when one of its
// boards has the block; never another venue's kit, never ids, addresses,
// serials, errors or secrets. The Tech board's own route is unchanged.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { techModel } from '../../shared/techBoard.js'

let ids, owner, V, V2, techBoard, plainBoard, scr, scr2, plain

async function call(method, url, body, headers = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}

/** A menu screen paired at a venue, showing a board: { id, secret, auth }. */
async function pairScreen(name, venueId, designId) {
  const p = (await call('POST', '/screen-api/pairings', { device: { width: 1920, height: 1080 } })).json
  const s = await ok(owner.post('/api/screens/screens/claim', { code: p.code, name, venue_id: venueId, design_id: designId }))
  return { id: s.id, secret: p.secret, auth: { authorization: `Screen ${s.id}.${p.secret}` } }
}
const tech = s => call('GET', '/screen-api/tech', undefined, s.auth)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  V2 = (await ok(owner.post('/api/venues', { name: 'Zqt Second', slug: 'zqt-second', timezone: 'Europe/London' }))).id
  await linkDevice(owner, V2, { kind: 'terminal', name: 'Zqt Other till' })
  // A till whose name would be markup if it weren't text.
  await linkDevice(owner, V, { kind: 'terminal', name: '<b>Zqt Bar</b> till' })
  techBoard = await ok(owner.post('/api/screens/designs', {
    name: 'Zqt Back office', layout: { blocks: [{ id: 't', type: 'tech_status', x: 0, y: 0, w: 1600, h: 900, opts: {} }] },
  }))
  plainBoard = await ok(owner.post('/api/screens/designs', {
    name: 'Zqt Menu', layout: { blocks: [{ id: 'h', type: 'heading', x: 0, y: 0, w: 600, h: 100, opts: { text: 'Lunch' } }] },
  }))
  scr = await pairScreen('Zqt Office screen', V, techBoard.id)
  scr2 = await pairScreen('Zqt Second office', V2, techBoard.id)
  plain = await pairScreen('Zqt Guest menu', V, plainBoard.id)
})
after(closeApp)

test('a paired screen with the block gets its own venue\'s kit, as the words the block draws', async () => {
  const cfg = (await call('GET', '/screen-api/config', undefined, scr.auth)).json
  assert.equal(cfg.needs_tech, true, 'the config says to fetch it')
  assert.equal((await call('GET', '/screen-api/config', undefined, plain.auth)).json.needs_tech, false)

  const r = await tech(scr)
  assert.equal(r.status, 200, r.body)
  assert.ok(['up', 'degraded', 'down', null].includes(r.json.light))
  const names = r.json.tiles.map(t => t.name)
  assert.ok(names.includes('<b>Zqt Bar</b> till'), 'the venue\'s tills')
  assert.ok(!names.includes('Zqt Other till'), 'never another venue\'s kit')
  assert.ok(r.json.tiles.some(t => t.kind === 'printer') && r.json.tiles.some(t => t.kind === 'screen' && t.name.startsWith('Zqt Office screen')))
  for (const t of r.json.tiles) {
    assert.deepEqual(Object.keys(t).sort(), ['count', 'kind', 'name', 'ring', 'seen_at', 'tone', 'word'])
    assert.ok(['ok', 'warn', 'bad', 'muted'].includes(t.tone))
  }
  // The other venue's screen: that venue's kit only.
  const r2 = await tech(scr2)
  assert.equal(r2.status, 200)
  assert.ok(r2.json.tiles.some(t => t.name === 'Zqt Other till'))
  assert.ok(!r2.json.tiles.some(t => t.name === '<b>Zqt Bar</b> till'))

  // The same tones as the Tech board, worked out by the same model.
  const b = await ok(owner.get('/api/tech-board/venues/' + V))
  assert.equal(r.json.tiles.length, b.devices.length + b.printers.filter(p => p.is_active).length + b.card_readers.length + b.screens.length)
  const m = techModel(r.json.tiles)
  assert.equal(m.health.total, r.json.tiles.length)
})

test('nothing secret in the payload: no ids, addresses, serials, errors or versions', async () => {
  const b = await ok(owner.get('/api/tech-board/venues/' + V))
  const text = (await tech(scr)).body
  const secrets = [
    ...b.devices.map(d => d.id), ...b.printers.map(p => p.id), ...b.card_readers.map(c => c.id), ...b.screens.map(s => s.id),
    ...b.printers.map(p => p.host).filter(Boolean), ...b.card_readers.map(c => c.serial).filter(Boolean),
    ...b.devices.map(d => d.app_version).filter(Boolean), scr.secret, V, ids.a,
  ]
  assert.ok(secrets.length > 5)
  for (const s of secrets) assert.ok(!text.includes(String(s)), 'the payload names ' + s)
  const [{ secret_hash: hash }] = await sql`SELECT secret_hash FROM screens WHERE id = ${scr.id}`
  assert.ok(!text.includes(hash))
})

test('refused: no pairing, a wrong secret, a screen without the block, a disconnected screen', async () => {
  assert.equal((await call('GET', '/screen-api/tech')).status, 401)
  assert.equal((await call('GET', '/screen-api/tech', undefined, { authorization: `Screen ${scr.id}.${'x'.repeat(40)}` })).status, 401)
  const p = await tech(plain)
  assert.deepEqual([p.status, p.json.code], [404, 'no_block'], 'a guest menu screen never reads the kit')
  // A board taken off the screen: refused from then on.
  const temp = await pairScreen('Zqt Temp', V, techBoard.id)
  assert.equal((await tech(temp)).status, 200)
  await ok(owner.patch('/api/screens/screens/' + temp.id, { design_id: plainBoard.id }))
  assert.equal((await tech(temp)).status, 404)
  assert.equal((await call('POST', '/screen-api/disconnect', undefined, temp.auth)).status, 200)
  assert.equal((await tech(temp)).status, 401, 'disconnected: its secret no longer works')
  // On a wall: the wall's board decides.
  const wall = await ok(owner.post('/api/screens/walls', { venue_id: V, name: 'Zqt Wall', cols: 2, rows: 1 }))
  await ok(owner.put('/api/screens/walls/' + wall.id, { venue_id: V, name: 'Zqt Wall', cols: 2, rows: 1, design_id: techBoard.id, places: [{ screen_id: plain.id, col: 0, row: 0 }] }))
  const onWall = await tech(plain)
  assert.equal(onWall.status, 200, 'its wall shows the block: ' + onWall.body)
})

test('the Tech board route answers as before, with the venue\'s name and time zone', async () => {
  const b = await ok(owner.get('/api/tech-board/venues/' + V))
  assert.deepEqual(b.can, { kit: true, screens: true })
  for (const k of ['devices', 'printers', 'card_readers', 'screens']) assert.ok(Array.isArray(b[k]), k)
  assert.equal(typeof b.venue_name, 'string')
  assert.equal(b.timezone, 'Europe/London')
  const hub = b.devices.find(d => d.kind === 'hub')
  if (hub) assert.ok('copy_on' in hub && 'copy_at' in hub, 'a hub says how current its copy for trading offline is')
})
