// Deleting a menu takes it out of the settings that pick menus by id:
// online ordering (and its menu times), revenue streams and the Deliveroo
// file. Before Oct 2026 the id stayed behind, Ordering setup sent it back
// unseen and every save failed with "A chosen menu wasn't found".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as u } from 'node:crypto'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'

let ids, owner, V, keep, gone, stream

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  keep = await ok(owner.post('/api/menus', { name: 'Dinner Menu', slug: 'dinner' }))
  gone = await ok(owner.post('/api/menus', { name: 'Old Lunch', slug: 'old-lunch' }))
  const { settings } = await ok(owner.get(`/api/orders/settings/${V}`))
  await ok(owner.put(`/api/orders/settings/${V}`, {
    ...settings, payment_methods: ['pay_at_venue'], menu_ids: [keep.id, gone.id],
    menu_schedules: { [gone.id]: { from: null, until: null, times: [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }] } },
  }), 'choose both menus')
  stream = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Bar', menu_ids: [keep.id, gone.id] }))
  await ok(owner.put(`/api/deliveroo/venues/${V}/settings`, { menu_ids: [keep.id, gone.id] }), 'Deliveroo menus')
})
after(closeApp)

const pick = async () => {
  const [o] = await sql`SELECT menu_ids, menu_schedules FROM ordering_settings WHERE venue_id = ${V}`
  const [r] = await sql`SELECT menu_ids FROM pos_revenue_streams WHERE id = ${stream.id}`
  const [d] = await sql`SELECT menu_ids FROM deliveroo_settings WHERE venue_id = ${V}`
  return { ordering: o.menu_ids, schedules: Object.keys(o.menu_schedules), stream: r.menu_ids, deliveroo: d.menu_ids }
}

test('deleting a menu takes it out of ordering, streams and Deliveroo, and the settings still save', async () => {
  assert.deepEqual(await pick(), { ordering: [keep.id, gone.id], schedules: [gone.id], stream: [keep.id, gone.id], deliveroo: [keep.id, gone.id] })
  await ok(owner.delete(`/api/menus/${gone.id}`))
  assert.deepEqual(await pick(), { ordering: [keep.id], schedules: [], stream: [keep.id], deliveroo: [keep.id] })

  // What the page loads saves again unchanged.
  const { settings } = await ok(owner.get(`/api/orders/settings/${V}`))
  assert.deepEqual(settings.menu_ids, [keep.id])
  await ok(owner.put(`/api/orders/settings/${V}`, settings), 'save after the delete')
})

test('ids left behind before the fix never reach the page, so its save works', async () => {
  // A deleted menu's id written straight in, as older deletes left them.
  const stale = u()
  await sql`UPDATE ordering_settings SET menu_ids = menu_ids || ${[stale]}::uuid[],
              menu_schedules = menu_schedules || ${sql.json({ [stale]: { from: '2026-01-01', until: null, times: [] } })} WHERE venue_id = ${V}`
  await sql`UPDATE deliveroo_settings SET menu_ids = menu_ids || ${[stale]}::uuid[] WHERE venue_id = ${V}`

  const { settings } = await ok(owner.get(`/api/orders/settings/${V}`))
  assert.deepEqual(settings.menu_ids, [keep.id])
  assert.deepEqual(Object.keys(settings.menu_schedules), [])
  await ok(owner.put(`/api/orders/settings/${V}`, settings), 'save with the stale id in the database')
  const [o] = await sql`SELECT menu_ids FROM ordering_settings WHERE venue_id = ${V}`
  assert.deepEqual(o.menu_ids, [keep.id])

  // Deliveroo: same, its page gets only menus it lists.
  const d = await ok(owner.get(`/api/deliveroo/venues/${V}`))
  assert.deepEqual(d.settings.menu_ids, [keep.id])

  // A save naming a menu that isn't there is still refused.
  const res = await owner.put(`/api/orders/settings/${V}`, { ...settings, menu_ids: [keep.id, stale] })
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
