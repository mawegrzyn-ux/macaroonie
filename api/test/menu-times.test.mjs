// Menu times (migration 230, routes/menuTimes.js, shared/menuTimes.js): one
// table per venue of when each menu is on for the website, the kiosks and
// the tills. Saved by Menus manage; the website's cells write which menus
// are online (ordering_settings.menu_ids); online ordering, the till config
// and the kiosk config read their channel's times.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, mine, theirs, V, M, lunch, dinner, own, till, kiosk

const LUNCH = { from: null, until: null, times: [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }] }
const DINNER = { from: null, until: null, times: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '17:00', end: '22:00' }] }

async function device(d, url) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url,
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}
const rowOf = (view, id) => view.rows.find(r => r.menu_id === id)
const online = async () => (await sql`SELECT menu_ids FROM ordering_settings WHERE venue_id = ${V}`)[0]?.menu_ids || []
const stored = async id => (await sql`SELECT times, web, kiosk, till FROM menu_times WHERE venue_id = ${V} AND menu_id = ${id}`)[0] || null

before(async () => {
  ids = await resetAndSeed()
  mine = await fillTenant(A.owner, ids.a)
  assert.deepEqual(mine.failed, [], 'fixtures A')
  theirs = await fillTenant(B.owner, ids.b, { mark: 'Bravo', slug: 'bravo' })
  assert.deepEqual(theirs.failed, [], 'fixtures B')
  owner = as(A.owner, ids.a)
  V = mine.ids.venue
  M = mine.ids.menu
  // Two more shared menus with a dish each, published, and one for another venue only.
  const made = async (name, slug, venue_id = null) => {
    const m = await ok(owner.post('/api/menus', { name, slug, ...(venue_id ? { venue_id } : {}) }))
    const full = await ok(owner.get(`/api/menus/${m.id}`))
    await ok(owner.patch(`/api/menus/${m.id}`, {
      ...full, sections: [{ title: name + ' dishes', items: [{ name: name + ' dish', price_pence: 900, is_orderable: true }] }],
    }), 'dishes on ' + name)
    await ok(owner.post(`/api/menus/${m.id}/publish`, {}), 'publish ' + name)
    return m
  }
  lunch = await made('Lunch', 'lunch-times')
  dinner = await made('Dinner', 'dinner-times')
  const other = await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford-times', timezone: 'Europe/London' }))
  own = await made('Hertford only', 'hertford-only', other.id)
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Times till' })
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Times kiosk' })
})
after(closeApp)

test('the table lists the menus the venue can use, with the usual cells', async () => {
  const view = await ok(owner.get(`/api/menu-times/venues/${V}`))
  const listed = view.menus.map(m => m.id)
  assert.ok(listed.includes(M) && listed.includes(lunch.id) && listed.includes(dinner.id))
  assert.ok(!listed.includes(own.id), 'another venue\'s own menu isn\'t listed')
  // The fixtures put their menu online with times (on since 2026).
  assert.deepEqual(rowOf(view, M).times, { from: '2026-01-01', until: null, times: [] })
  assert.equal(rowOf(view, M).web.use, 'menu')
  assert.equal(rowOf(view, M).kiosk.use, 'always')
  assert.deepEqual(rowOf(view, lunch.id), {
    menu_id: lunch.id, times: null, web: { use: 'off', times: null }, kiosk: { use: 'menu', times: null }, till: { use: 'menu', times: null },
    updated_at: null, updated_by: null,
  }, 'no row: off online, any time on kiosks and tills')
  assert.equal(view.devices.till, 2, 'the fixtures\' till and this test\'s')
  assert.ok(view.devices.kiosk >= 1)
  assert.ok(view.menus.find(m => m.id === lunch.id).live, 'published')
  // Operators view menus: they can read the table, not save it.
  await ok(as(A.operator, ids.a).get(`/api/menu-times/venues/${V}`))
  assert.equal((await as(A.operator, ids.a).put(`/api/menu-times/venues/${V}`, { rows: [] })).status, 403)
  assert.equal((await as(A.viewer, ids.a).put(`/api/menu-times/venues/${V}`, { rows: [] })).status, 403)
})

test('saving: times per channel, the website on and off, rows that say nothing go', async () => {
  const before = await online()
  const view = await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [
    { menu_id: lunch.id, times: LUNCH, web: { use: 'menu' }, kiosk: { use: 'own', times: { times: [{ days: [6], start: '10:00', end: '14:00' }] } }, till: { use: 'always' } },
    { menu_id: dinner.id, times: DINNER, web: { use: 'own', times: { times: [{ days: [5, 6], start: '17:00', end: '21:00' }] } }, kiosk: { use: 'off' }, till: { use: 'menu' } },
  ] }))
  assert.deepEqual(await online(), [...before, lunch.id, dinner.id], 'online after the menus already there, in the order sent')
  assert.deepEqual((await stored(lunch.id)).kiosk, { use: 'own', times: { from: null, until: null, times: [{ days: [6], start: '10:00', end: '14:00' }] } })
  assert.deepEqual((await stored(lunch.id)).till, { use: 'always', times: null })
  assert.equal(rowOf(view, dinner.id).kiosk.use, 'off')
  assert.equal(rowOf(view, lunch.id).updated_by, 'a-owner@test.local')
  assert.deepEqual(view.warnings.map(w => [w.channel, w.menu_ids.length]), [], 'lunch and dinner never meet')

  // The website switched off: out of menu_ids, its own times kept for later.
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ ...rowOf(view, dinner.id), web: { use: 'off' } }] }))
  assert.ok(!(await online()).includes(dinner.id))
  assert.deepEqual((await stored(dinner.id)).web, { use: 'own', times: { from: null, until: null, times: [{ days: [5, 6], start: '17:00', end: '21:00' }] } })
  const back = await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ ...rowOf(view, dinner.id) }] }))
  assert.ok((await online()).includes(dinner.id), 'back online')
  assert.equal(rowOf(back, dinner.id).web.use, 'own')

  // A row back to the usual is removed: online or not is menu_ids, not the row.
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: dinner.id, web: { use: 'menu' }, kiosk: { use: 'menu' }, till: { use: 'menu' } }] }))
  assert.equal(await stored(dinner.id), null)
  assert.ok((await online()).includes(dinner.id))
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: dinner.id, web: { use: 'off' } }] }))
  assert.equal(await stored(dinner.id), null, 'off online with nothing else: still no row')
  assert.ok(!(await online()).includes(dinner.id))
  // Rows not sent are left alone.
  assert.ok(await stored(lunch.id))
})

test('problems are refused; menus on at once are notes', async () => {
  const bad = await owner.put(`/api/menu-times/venues/${V}`, { rows: [
    { menu_id: lunch.id, times: { times: [{ days: [1], start: '15:00', end: '11:00' }] } },
  ] })
  assert.equal(bad.status, 422)
  assert.equal(bad.json.error, 'Lunch: each time must end after it starts (15:00–11:00).')
  assert.equal(bad.json.code, 'menu_times')
  const own2 = await owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: lunch.id, till: { use: 'own', times: { times: [{ days: [], start: '11:00', end: '12:00' }] } } }] })
  assert.equal(own2.json.error, 'Lunch on tills: pick at least one day for each time.')
  assert.equal((await owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: own.id }] })).status, 422, 'another venue\'s own menu')
  assert.equal((await owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: theirs.ids.menu }] })).status, 422, 'another group\'s menu')
  assert.equal((await owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: lunch.id }, { menu_id: lunch.id }] })).status, 400)
  assert.equal((await owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: lunch.id, web: { use: 'sometimes' } }] })).status, 400)
  assert.equal((await as(B.owner, ids.b).get(`/api/menu-times/venues/${V}`)).status, 404, 'another group can\'t read this venue')
  assert.equal((await as(B.owner, ids.b).put(`/api/menu-times/venues/${V}`, { rows: [] })).status, 404)
  // Lunch and a brunch on Mondays: both on the website at once, a note.
  const brunch = { times: [{ days: [1], start: '10:00', end: '12:00' }] }
  const view = await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [
    { menu_id: lunch.id, times: LUNCH, web: { use: 'menu' }, kiosk: { use: 'off' }, till: { use: 'off' } },
    { menu_id: dinner.id, times: brunch, web: { use: 'menu' }, kiosk: { use: 'menu' }, till: { use: 'menu' } },
  ] }))
  assert.deepEqual(view.warnings.map(w => w.channel), ['web'])
  assert.match(view.warnings[0].message, /^(Lunch and Dinner|Dinner and Lunch) are on at the same time on website: both show then\.$/)
})

test('online ordering, the till and the kiosk read their channel\'s times', async () => {
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [
    { menu_id: lunch.id, times: LUNCH, web: { use: 'menu' }, kiosk: { use: 'own', times: DINNER }, till: { use: 'always' } },
    { menu_id: dinner.id, times: DINNER, web: { use: 'always' }, kiosk: { use: 'menu' }, till: { use: 'off' } },
  ] }))
  // Online: the schedule label from the menu's times; any time, none.
  const site = await (await getApp()).inject({ method: 'GET', url: `/order-api/venues/${V}` })
  assert.equal(site.statusCode, 200, site.body)
  const menus = site.json().menus
  assert.equal(menus.find(m => m.id === lunch.id).schedule, 'Mon–Fri 11:00–15:00')
  assert.equal(menus.find(m => m.id === dinner.id).schedule, null, 'any time online')
  // Ordering setup shows the menus online with their times, and never saves them.
  const setup = await ok(owner.get(`/api/orders/settings/${V}`))
  assert.deepEqual(setup.online_menus.find(m => m.id === lunch.id), { id: lunch.id, name: 'Lunch', times: 'Mon–Fri 11:00–15:00' })
  await ok(owner.put(`/api/orders/settings/${V}`, { ...setup.settings, menu_ids: [] }), 'menu_ids sent to Ordering setup is ignored')
  assert.ok((await online()).includes(lunch.id))

  // The till: lunch any time, dinner left out (off on tills).
  const tc = await device(till, '/pos-api/config')
  assert.equal(tc.menus.find(m => m.id === lunch.id).times, null)
  assert.ok(!tc.menus.some(m => m.id === dinner.id), 'off on tills: not in the till\'s config')
  assert.deepEqual(tc.menus.find(m => m.id === M).times, { from: '2026-01-01', until: null, times: [] }, 'the fixture menu follows its own times')
  // The kiosk: lunch on the kiosk's own times, dinner on the menu's.
  const kc = await device(kiosk, '/pos-api/config')
  assert.deepEqual(kc.menus.find(m => m.id === lunch.id).times.times, DINNER.times)
  assert.deepEqual(kc.menus.find(m => m.id === dinner.id).times.times, DINNER.times)
  assert.equal(kc.menus.find(m => m.id === M).times, null, 'the fixture menu: any time on kiosks')
  // A change reaches the till's config version.
  const v1 = tc.version
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: lunch.id, times: LUNCH, web: { use: 'menu' }, kiosk: { use: 'menu' }, till: { use: 'menu' } }] }))
  const tc2 = await device(till, '/pos-api/config')
  assert.notEqual(tc2.version, v1)
  assert.deepEqual(tc2.menus.find(m => m.id === lunch.id).times, LUNCH)
})
