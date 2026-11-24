// The venue's own words for speech (Pepper-first step 6c): fridge and hold
// station names, dishes, staff first names and suppliers, from the data
// (GET /api/ai/venue-words), each group only for someone who can see its
// module; another group's venue is not found. The snap itself is tested in
// shared/test/venueWords.test.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant, MARK } from './support/fixtures.mjs'
import { snapToWords } from '../../shared/venueWords.js'

let ids, owner, viewer, other, V

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  // A published menu for the dishes.
  await sql`UPDATE menus SET is_published = true WHERE tenant_id = ${ids.a}`
})
after(closeApp)

test('the venue\'s words: its fridges and hold stations, dishes, staff first names and suppliers', async () => {
  const { words, venue_id } = await ok(owner.get('/api/ai/venue-words?venue_id=' + V))
  assert.equal(venue_id, V)
  assert.ok(words.includes(MARK + ' Walk-in'), 'a fridge')
  assert.ok(words.includes(MARK + ' Pass'), 'a hold station')
  assert.ok(words.includes(MARK + ' Pad Thai'), 'a dish')
  assert.ok(words.includes(MARK + ' Fresh Co'), 'a supplier')
  assert.ok(words.includes(MARK), 'a staff first name ("Zqx Jo Bloggs")')
  assert.equal(new Set(words.map(w => w.toLowerCase())).size, words.length, 'each once')
  const all = await ok(owner.get('/api/ai/venue-words'))
  assert.ok(all.words.length >= words.length, 'every venue\'s without a venue')
  // What the words are for: a near miss of the fridge's name snaps to it.
  assert.equal(snapToWords('zqx walkin at 4', words).text, MARK + ' Walk-in at 4')
})

test('a group only for someone who can see its module', async () => {
  const [role] = await sql`SELECT id FROM tenant_roles WHERE tenant_id = ${ids.a} AND key = 'zqx-supervisor'`
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.viewer}`
  const { words } = await ok(viewer.get('/api/ai/venue-words?venue_id=' + V))
  assert.deepEqual(words, [], 'a role with bookings only gets no fridges, dishes, staff or suppliers')
  await sql`UPDATE users SET custom_role_id = NULL WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.viewer}`
})

test('another group\'s venue is not found, and its words never shown', async () => {
  assert.equal((await other.get('/api/ai/venue-words?venue_id=' + V)).status, 404)
  const theirs = await ok(other.get('/api/ai/venue-words'))
  assert.ok(!theirs.words.some(w => w.includes(MARK)))
  assert.equal((await owner.get('/api/ai/venue-words?venue_id=nope')).status, 422)
})
