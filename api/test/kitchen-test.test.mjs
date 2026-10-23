// The kitchen test bench's signed link (Store tech > Kitchen screens > Test
// the kitchen): who may make one, what it reads, and that a link opens only
// its own kind of page (a kiosk preview link never opens the kitchen bench,
// and back) and only its own venue's setup.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { makeLink } from '../src/services/previewLinks.js'
import { previewToken } from '../src/services/kioskSvc.js'

let ids, owner, V, other

async function bench(token) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/kitchen-test?token=' + encodeURIComponent(token),
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json }
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  other = await fillTenant(B.owner, ids.b, { mark: 'Yyb', slug: 'yyb' })
  assert.deepEqual(other.failed, [], 'fixtures B')
  await linkDevice(owner, V, { kind: 'kds', name: 'Grill screen' })
})
after(closeApp)

test('the owner gets a link that opens the venue\'s kitchen setup', async () => {
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-test`, {}))
  assert.match(link.url, /\/\?kitchen_test=/)
  const res = await bench(link.token)
  assert.equal(res.status, 200)
  const d = res.json
  assert.equal(d.venue.id, V)
  assert.ok(d.stations.length > 0, 'stations')
  assert.ok(d.flows.length > 0 && d.flows.every(f => Array.isArray(f.links)), 'every flow with its links')
  assert.ok(d.flows.some(f => f.id === d.active_flow_id), 'the flow in use')
  assert.ok(d.screens.some(s => s.name === 'Grill screen'), 'the kitchen screens')
  assert.ok(Object.keys(d.items).length > 0, 'dishes from the live menus')
  const dish = Object.values(d.items)[0]
  assert.equal(dish.price_pence, undefined, 'no prices')
  assert.ok(d.expires_at && Date.parse(d.expires_at) > Date.now())
  assert.equal(JSON.stringify(d).includes('Yyb'), false, 'nothing of the other tenant')
})

test('who may make a link', async () => {
  const viewer = await as(A.viewer, ids.a).post(`/api/pos/venues/${V}/kitchen-test`, {})
  assert.equal(viewer.status, 403, 'Store tech is none for viewers by default')
  const otherVenue = await as(B.owner, ids.b).post(`/api/pos/venues/${V}/kitchen-test`, {})
  assert.equal(otherVenue.status, 404, 'another tenant\'s venue')
})

test('a link opens only its own kind of page, its own venue, and not after it runs out', async () => {
  const [design] = await sql`SELECT id FROM kiosk_designs WHERE tenant_id = ${ids.a} LIMIT 1`
  if (design) {
    const kioskToken = await previewToken({ tenantId: ids.a, venueId: V, designId: design.id })
    assert.equal((await bench(kioskToken)).status, 401, 'a kiosk preview link isn\'t a kitchen link')
  }
  const app = await getApp()
  const link = await ok(owner.post(`/api/pos/venues/${V}/kitchen-test`, {}))
  const asKiosk = await app.inject({ method: 'GET', url: '/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token), headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  assert.equal(asKiosk.statusCode, 401, 'a kitchen link isn\'t a kiosk preview link')

  const expired = await makeLink('kitchen_test', { t: ids.a, v: V }, -1)
  assert.equal((await bench(expired)).status, 401, 'run out')
  const [body, sig] = link.token.split('.')
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), v: other.ids.venue })).toString('base64url') + '.' + sig
  assert.equal((await bench(tampered)).status, 401, 'a changed link')
  assert.equal((await bench('nonsense')).status, 401)

  // A signed link naming another tenant's venue (it can't be made through the
  // admin, but the read must still stay inside the link's tenant).
  const crossed = await makeLink('kitchen_test', { t: ids.a, v: other.ids.venue }, 1)
  assert.equal((await bench(crossed)).status, 404)
})
