// Prices and sold out pulled by tills and kiosks (lib/livePull.js in pos/):
// GET /pos-api/live sends the dishes sold out now and a stamp of what sets
// prices; neither is in the config's version, and every config reply
// carries them, an unchanged one too. So a dish sold out never makes a
// device download its config again, and a new stamp (a menu published, a
// scheduled one gone live, an option group or a promotion changed) tells it
// to fetch the config.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { systemSql } from '../src/config/db.js'

let ids, owner, mine, theirs, other, till, kiosk, screen, otherTill, M, V

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      ...(d ? { authorization: `Device ${d.device_id}.${d.secret}` } : {}),
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json }
}
const live = async d => {
  const r = await device(d, 'GET', '/pos-api/live')
  assert.equal(r.status, 200, JSON.stringify(r.json))
  return r.json
}
const config = async (d, version) => {
  const r = await device(d, 'GET', '/pos-api/config' + (version ? '?version=' + encodeURIComponent(version) : ''))
  assert.equal(r.status, 200, JSON.stringify(r.json))
  return r.json
}
const soldIds = list => list.map(x => x.item_id).sort()

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures A')
  theirs = await fillTenant(B.owner, ids.b, { mark: 'Bravo', slug: 'bravo' })
  assert.deepEqual(theirs.failed, [], 'fixtures B')
  owner = as(A.owner, ids.a)
  other = as(B.owner, ids.b)
  M = mine.ids.menu
  V = mine.ids.venue
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Live till' })
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Live kiosk' })
  screen = await linkDevice(owner, V, { kind: 'kds', name: 'Live kitchen' })
  otherTill = await linkDevice(other, theirs.ids.venue, { kind: 'terminal', name: 'Their till' })
})
after(closeApp)

test('every till and kiosk config carries sold out and the prices stamp; /live sends the same', async () => {
  for (const d of [till, kiosk]) {
    const c = await config(d)
    assert.ok(Array.isArray(c.sold_out), 'sold_out in the config')
    assert.match(c.prices, /^[0-9a-f]{16}$/, 'a prices stamp')
    const l = await live(d)
    assert.deepEqual(Object.keys(l).sort(), ['prices', 'sold_out'], 'only the live fields')
    assert.deepEqual(l.sold_out, c.sold_out)
    assert.equal(l.prices, c.prices)
    // An unchanged reply still carries them.
    const same = await config(d, c.version)
    assert.equal(same.unchanged, true)
    assert.deepEqual(same.sold_out, c.sold_out)
    assert.equal(same.prices, c.prices)
  }
})

test('only tills and kiosks ask; a kitchen screen is refused, no pairing is 401', async () => {
  const k = await device(screen, 'GET', '/pos-api/live')
  assert.equal(k.status, 403)
  assert.equal(k.json.code, 'kind')
  assert.equal((await device(null, 'GET', '/pos-api/live')).status, 401)
  const kc = await config(screen)
  assert.equal(kc.prices, undefined, 'a kitchen screen\'s config has no live fields')
  assert.equal((await config(screen, kc.version)).unchanged, true)
})

test('a dish sold out: /live has it at once, the config\'s version stays the same', async () => {
  const before = await config(till)
  const dish = (await ok(owner.get(`/api/menus/${M}`))).sections[0].items.find(it => !before.sold_out.some(s => s.item_id === it.id))
  assert.ok(dish, 'a dish that isn\'t sold out yet')
  await ok(owner.put(`/api/orders/availability/${V}/${dish.id}`, { sold_out: 'indefinite' }))

  for (const d of [till, kiosk]) {
    const l = await live(d)
    assert.ok(l.sold_out.some(s => s.item_id === dish.id && s.until === null), 'sold out until put back')
    assert.equal(l.prices, before.prices, 'sold out isn\'t a price change')
  }
  const again = await config(till, before.version)
  assert.equal(again.unchanged, true, 'no new download for a dish sold out')
  assert.deepEqual(soldIds(again.sold_out), soldIds((await live(till)).sold_out))

  await ok(owner.put(`/api/orders/availability/${V}/${dish.id}`, { sold_out: false }))
  assert.ok(!(await live(kiosk)).sold_out.some(s => s.item_id === dish.id), 'back on')
  // Another group's sold out list is theirs alone.
  const theirDish = (await ok(other.get(`/api/menus/${theirs.ids.menu}`))).sections[0].items[0]
  await ok(other.put(`/api/orders/availability/${theirs.ids.venue}/${theirDish.id}`, { sold_out: 'indefinite' }))
  assert.ok(!(await live(till)).sold_out.some(s => s.item_id === theirDish.id))
  assert.ok((await live(otherTill)).sold_out.some(s => s.item_id === theirDish.id))
})

test('a published price: a new stamp, and the config brings the price with the same stamp', async () => {
  const c = await config(till)
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  const dish = body.sections[0].items.find(it => it.price_pence != null)
  dish.price_pence += 50
  await ok(owner.patch(`/api/menus/${M}`, body))
  assert.equal((await live(till)).prices, c.prices, 'saving the draft changes nothing on the till')
  // Another group publishing doesn't change this group's stamp.
  const theirBody = menuSaveBody(await ok(other.get(`/api/menus/${theirs.ids.menu}`)))
  theirBody.sections[0].items[0].price_pence = (theirBody.sections[0].items[0].price_pence || 0) + 10
  await ok(other.patch(`/api/menus/${theirs.ids.menu}`, theirBody))
  await ok(other.post(`/api/menus/${theirs.ids.menu}/publish`, {}))
  assert.equal((await live(till)).prices, c.prices, 'another group\'s menu')

  await ok(owner.post(`/api/menus/${M}/publish`, {}))
  const l = await live(till)
  assert.notEqual(l.prices, c.prices, 'published: a new stamp')
  assert.equal((await live(kiosk)).prices, l.prices, 'the kiosk\'s too')
  const fresh = await config(till, c.version)
  assert.notEqual(fresh.unchanged, true, 'the config changed')
  assert.equal(fresh.items[dish.id].price_pence, dish.price_pence, 'with the new price')
  assert.equal(fresh.prices, l.prices, 'and the same stamp, so the till stops asking')
})

test('a scheduled publish changes the stamp only when it goes live', async () => {
  const c = await config(kiosk)
  const body = menuSaveBody(await ok(owner.get(`/api/menus/${M}`)))
  body.sections[0].items.find(it => it.price_pence != null).price_pence += 25
  await ok(owner.patch(`/api/menus/${M}`, body))
  const at = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const { release } = await ok(owner.post(`/api/menus/${M}/publish`, { at }))
  assert.equal((await live(kiosk)).prices, c.prices, 'not live yet')
  // Its time comes (no write to anything a till reads). now(): still after
  // the earlier publishes, so it is the newest live release.
  await systemSql`UPDATE menu_releases SET goes_live_at = now() WHERE id = ${release.id}`
  const l = await live(kiosk)
  assert.notEqual(l.prices, c.prices, 'gone live: a new stamp')
  assert.equal((await config(kiosk, c.version)).prices, l.prices)
})

test('an option group or a promotion changes the stamp', async () => {
  let stamp = (await live(till)).prices
  await ok(owner.post('/api/menus/variant-groups', { name: 'Live sauce', price_mode: 'extra', options: [{ label: 'Hot', price_pence: 40 }] }))
  let l = await live(till)
  assert.notEqual(l.prices, stamp, 'a new option group')
  stamp = l.prices
  await ok(owner.post('/api/promotions', { name: 'Live 5% off', kind: 'basket', discount_type: 'percent', discount_value: 5, apply_mode: 'auto', channels: ['pos'] }))
  l = await live(till)
  assert.notEqual(l.prices, stamp, 'a new promotion')
  assert.equal((await config(till)).prices, l.prices)
})

// How often devices ask (migration 216, Store tech → Device updates): per
// location, in every config as `pull`, within limits, copied to every
// location on request; a viewer and another group can't change them.
test('pull times are set per location and reach every device kind', async () => {
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.deepEqual(setup.settings.pull, { content: 180, live: 30, screen: 60, board: 15 }, 'the standard times')
  for (const d of [till, kiosk]) assert.deepEqual((await config(d)).pull, { content: 180, live: 30, screen: 60, board: 15 })
  const before = await config(till)

  const saved = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { pull: { content: 600, live: 0, board: 30 } }))
  assert.deepEqual(saved.pull, { content: 600, live: 0, screen: 60, board: 30 }, 'only what was sent changes; live can be off')
  const c = await config(till, before.version)
  assert.ok(!c.unchanged, 'the till config changes, so tills restart their timers')
  assert.deepEqual(c.pull, saved.pull)
  assert.deepEqual((await config(kiosk)).pull, saved.pull)
  assert.equal((await config(screen)).pull.content, 600, 'the kitchen screen gets its time')

  // A menu screen of the location reads its two times.
  const app = await getApp()
  const p = (await app.inject({ method: 'POST', url: '/screen-api/pairings', payload: {} })).json()
  const ms = await ok(owner.post('/api/screens/screens/claim', { code: p.code, name: 'Pull board', venue_id: V }))
  const sc = (await app.inject({ method: 'GET', url: '/screen-api/config', headers: { authorization: `Screen ${ms.id}.${p.secret}` } })).json()
  assert.deepEqual(sc.pull, { screen: 60, board: 30 })

  // Out of range, or off where it can't be: refused, nothing saved.
  for (const bad of [{ content: 30 }, { content: 7200 }, { live: 5 }, { screen: 0 }, { board: 301 }, { content: 90.5 }]) {
    const r = await owner.patch(`/api/pos/venues/${V}/settings`, { pull: bad })
    assert.equal(r.status, 400, JSON.stringify(bad))
  }
  assert.deepEqual((await ok(owner.get(`/api/pos/venues/${V}/setup`))).settings.pull, saved.pull)

  // Another group can't change this location's, nor a viewer.
  assert.equal((await other.patch(`/api/pos/venues/${V}/settings`, { pull: { content: 60 } })).status, 404)
  assert.equal((await as(A.viewer, ids.a).patch(`/api/pos/venues/${V}/settings`, { pull: { content: 60 } })).status, 403)
  assert.equal((await as(A.viewer, ids.a).post('/api/pos/pull-times/everywhere', { pull: { content: 60 } })).status, 403)

  // Every location of the group, and only this group's.
  const two = await ok(owner.post('/api/venues', { name: 'Pull second', slug: 'pull-second' }))
  assert.equal((await owner.post('/api/pos/pull-times/everywhere', { pull: {} })).status, 400, 'nothing to copy')
  const all = await ok(owner.post('/api/pos/pull-times/everywhere', { pull: { content: 900, live: 120, screen: 300, board: 60 } }))
  assert.ok(all.venues >= 2)
  for (const v of [V, two.id]) {
    assert.deepEqual((await ok(owner.get(`/api/pos/venues/${v}/setup`))).settings.pull, { content: 900, live: 120, screen: 300, board: 60 })
  }
  assert.deepEqual((await config(otherTill)).pull, { content: 180, live: 30, screen: 60, board: 15 }, "the other group's tills keep theirs")
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { pull: { content: 180, live: 30, screen: 60, board: 15 } }))
})
