// Deleting a menu takes it out of the settings that pick menus by id:
// online ordering, revenue streams and the Deliveroo file; its menu times
// (migration 230) go with it. Before Oct 2026 the id stayed behind,
// Ordering setup sent it back unseen and every save failed with "A chosen
// menu wasn't found".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'

let ids, owner, V, keep, gone, stream

const LUNCH = { from: null, until: null, times: [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }] }

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  keep = await ok(owner.post('/api/menus', { name: 'Dinner Menu', slug: 'dinner' }))
  gone = await ok(owner.post('/api/menus', { name: 'Old Lunch', slug: 'old-lunch' }))
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: [
    { menu_id: keep.id, web: { use: 'menu' } },
    { menu_id: gone.id, times: LUNCH, web: { use: 'menu' }, till: { use: 'always' } },
  ] }), 'both menus online, the old lunch with times')
  stream = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Bar', menu_ids: [keep.id, gone.id] }))
  await ok(owner.put(`/api/deliveroo/venues/${V}/settings`, { menu_ids: [keep.id, gone.id] }), 'Deliveroo menus')
})
after(closeApp)

const pick = async () => {
  const [o] = await sql`SELECT menu_ids FROM ordering_settings WHERE venue_id = ${V}`
  const times = await sql`SELECT menu_id FROM menu_times WHERE venue_id = ${V} ORDER BY menu_id`
  const [r] = await sql`SELECT menu_ids FROM pos_revenue_streams WHERE id = ${stream.id}`
  const [d] = await sql`SELECT menu_ids FROM deliveroo_settings WHERE venue_id = ${V}`
  return { ordering: o.menu_ids, times: times.map(t => t.menu_id), stream: r.menu_ids, deliveroo: d.menu_ids }
}

test('deleting a menu takes it out of ordering, streams and Deliveroo, its times go, and the settings still save', async () => {
  assert.deepEqual(await pick(), { ordering: [keep.id, gone.id], times: [gone.id], stream: [keep.id, gone.id], deliveroo: [keep.id, gone.id] })
  await ok(owner.delete(`/api/menus/${gone.id}`))
  assert.deepEqual(await pick(), { ordering: [keep.id], times: [], stream: [keep.id], deliveroo: [keep.id] })

  // What the pages load saves again unchanged.
  const { settings, online_menus } = await ok(owner.get(`/api/orders/settings/${V}`))
  assert.deepEqual(online_menus.map(m => m.id), [keep.id])
  await ok(owner.put(`/api/orders/settings/${V}`, settings), 'Ordering setup saves after the delete')
  const times = await ok(owner.get(`/api/menu-times/venues/${V}`))
  assert.deepEqual(times.rows.map(r => r.menu_id), [keep.id])
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: times.rows }), 'Menu times saves after the delete')
})

test('ids left behind before the fix never reach the pages, and the next save clears them', async () => {
  // A deleted menu's id written straight in, as older deletes left them.
  const stale = u()
  await sql`UPDATE ordering_settings SET menu_ids = menu_ids || ${[stale]}::uuid[] WHERE venue_id = ${V}`
  await sql`UPDATE deliveroo_settings SET menu_ids = menu_ids || ${[stale]}::uuid[] WHERE venue_id = ${V}`

  const { settings, online_menus } = await ok(owner.get(`/api/orders/settings/${V}`))
  assert.deepEqual(online_menus.map(m => m.id), [keep.id])
  assert.equal(settings.menu_ids, undefined, 'Ordering setup no longer sends the menus back')
  await ok(owner.put(`/api/orders/settings/${V}`, settings), 'Ordering setup saves with the stale id in the database')

  const times = await ok(owner.get(`/api/menu-times/venues/${V}`))
  assert.deepEqual(times.rows.map(r => r.menu_id), [keep.id], 'Menu times lists real menus only')
  await ok(owner.put(`/api/menu-times/venues/${V}`, { rows: times.rows }))
  const [o] = await sql`SELECT menu_ids FROM ordering_settings WHERE venue_id = ${V}`
  assert.deepEqual(o.menu_ids, [keep.id], 'the next Menu times save drops it')

  // Deliveroo: same, its page gets only menus it lists.
  const d = await ok(owner.get(`/api/deliveroo/venues/${V}`))
  assert.deepEqual(d.settings.menu_ids, [keep.id])

  // A save naming a menu that isn't there is refused.
  const res = await owner.put(`/api/menu-times/venues/${V}`, { rows: [{ menu_id: stale, web: { use: 'menu' } }] })
  assert.equal(res.status, 422)
})

test('another group\'s menu delete never touches this group\'s settings', async () => {
  const other = as('b-owner', ids.b)
  const theirs = await ok(other.post('/api/menus', { name: 'Theirs', slug: 'theirs' }))
  await ok(other.delete(`/api/menus/${theirs.id}`))
  // Deleting this group's menu by id as the other group: 404, nothing changes.
  const res = await other.delete(`/api/menus/${keep.id}`)
  assert.equal(res.status, 404)
  assert.deepEqual((await pick()).ordering, [keep.id])
})
