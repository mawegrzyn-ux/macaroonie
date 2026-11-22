// Deleting a customer for good (22 Nov 2026, test and demo data): owners
// only, the group's own customers only, and their bookings stay without the
// link. Also the Open-Meteo key on the Platform page: platform admins only,
// never sent back, and the weather captures' addresses with it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B, PLATFORM } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { meteoUrl } from '../src/services/weatherKey.js'

let ids
before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
})
after(closeApp)

test('delete a customer: owners only, their bookings stay without the link', async () => {
  const [c] = await sql`
    SELECT c.id, (SELECT count(*)::int FROM bookings b WHERE b.customer_id = c.id) AS n
      FROM customers c WHERE c.tenant_id = ${ids.a}
     ORDER BY (SELECT count(*) FROM bookings b WHERE b.customer_id = c.id) DESC LIMIT 1`
  assert.ok(c, 'a customer to delete')
  const booked = await sql`SELECT id FROM bookings WHERE customer_id = ${c.id}`

  assert.equal((await as(A.admin, ids.a).delete('/api/customers/' + c.id)).status, 403, 'an admin can\'t')
  assert.equal((await as(A.operator, ids.a).delete('/api/customers/' + c.id)).status, 403)
  assert.equal((await as(B.owner, ids.b).delete('/api/customers/' + c.id)).status, 404, 'another group\'s customer')
  assert.equal((await as(A.owner, ids.a).delete('/api/customers/not-an-id')).status, 404)

  const res = await ok(as(A.owner, ids.a).delete('/api/customers/' + c.id))
  assert.deepEqual([res.deleted, res.bookings_kept], [c.id, c.n])
  assert.equal((await sql`SELECT 1 FROM customers WHERE id = ${c.id}`).length, 0, 'gone')
  if (booked.length) {
    const left = await sql`SELECT customer_id FROM bookings WHERE id = ANY(${booked.map(b => b.id)}::uuid[])`
    assert.equal(left.length, booked.length, 'the bookings stay')
    assert.ok(left.every(b => b.customer_id === null), 'without the link')
  }
  assert.equal((await as(A.owner, ids.a).delete('/api/customers/' + c.id)).status, 404, 'already gone')
})

test('the Open-Meteo key: platform admins only, never sent back', async () => {
  assert.equal((await as(A.owner, ids.a).get('/api/platform/weather-key')).status, 403)
  const info = await ok(as(PLATFORM, null).get('/api/platform/weather-key'))
  assert.equal(info.saved, null)
  assert.equal((await as(PLATFORM, null).put('/api/platform/weather-key', { api_key: 'has spaces in it' })).status, 422)
  assert.equal((await as(A.owner, ids.a).put('/api/platform/weather-key', { api_key: 'abcdefgh1234' })).status, 403)
  // Saved straight in (checking needs Open-Meteo itself), then read back as its last four only.
  const { saveWeatherKey, weatherKey } = await import('../src/services/weatherKey.js')
  await saveWeatherKey('secret-key-9876', 'test')
  const saved = await ok(as(PLATFORM, null).get('/api/platform/weather-key'))
  assert.equal(saved.saved.hint, '9876')
  assert.ok(!JSON.stringify(saved).includes('secret-key'), 'the key never goes back')
  assert.equal(await weatherKey(), 'secret-key-9876')
  const [row] = await sql`SELECT value FROM platform_secrets WHERE name = 'open_meteo_key'`
  assert.ok(!String(row.value).includes('secret-key'), 'stored sealed')
  const removed = await ok(as(PLATFORM, null).delete('/api/platform/weather-key'))
  assert.equal(removed.saved, null)
})

test('with a key the captures use Open-Meteo\'s paid hosts; a stand-in host is kept', () => {
  assert.equal(meteoUrl('https://api.open-meteo.com/', '/v1/forecast', 'a=1'), 'https://api.open-meteo.com/v1/forecast?a=1')
  assert.equal(meteoUrl('https://api.open-meteo.com', '/v1/forecast', 'a=1', 'k y'), 'https://customer-api.open-meteo.com/v1/forecast?a=1&apikey=k%20y')
  assert.equal(meteoUrl('https://geocoding-api.open-meteo.com', '/v1/search', 'n=x', 'k'), 'https://customer-geocoding-api.open-meteo.com/v1/search?n=x&apikey=k')
  assert.equal(meteoUrl('http://127.0.0.1:9', '/v1/forecast', 'a=1', 'k'), 'http://127.0.0.1:9/v1/forecast?a=1&apikey=k')
})
