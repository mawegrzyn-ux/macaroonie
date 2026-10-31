// How the till asks for a new order's order type, name and tent number
// (migration 226, pos/src/components/OrderPrompt.jsx): one screen or two
// steps, per venue (Receipts and payments) with a till's own choice, both in
// the till's config.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, viewer, V, till

async function config(d) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/config',
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqp Till' })
})
after(closeApp)

test('the venue\'s order prompt: one screen until changed, two steps saved, refused when wrong', async () => {
  const setup = await ok(owner.get('/api/pos/venues/' + V + '/setup'))
  assert.equal(setup.settings.order_prompt, 'one')
  assert.equal((await config(till)).settings.order_prompt, 'one')
  const saved = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { order_prompt: 'two' }))
  assert.equal(saved.order_prompt, 'two')
  // Left out of a later save, it stays.
  const again = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { tips_enabled: true }))
  assert.equal(again.order_prompt, 'two')
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { order_prompt: 'three' })).status, 400)
  assert.equal((await viewer.patch(`/api/pos/venues/${V}/settings`, { order_prompt: 'one' })).status, 403)
  assert.equal((await as(B.owner, ids.b).patch(`/api/pos/venues/${V}/settings`, { order_prompt: 'one' })).status, 404)
  const [row] = await sql`SELECT order_prompt FROM pos_settings WHERE venue_id = ${V}`
  assert.equal(row.order_prompt, 'two')
  assert.equal((await config(till)).settings.order_prompt, 'two')
})

test('a till has its own order prompt; the venue\'s and its own both reach it', async () => {
  const d = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', order_prompt: 'one' } }))
  assert.equal(d.settings.order_prompt, 'one')
  assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', order_prompt: 'both' } })).status, 400)
  let cfg = await config(till)
  assert.equal(cfg.device.settings.order_prompt, 'one')
  assert.equal(cfg.settings.order_prompt, 'two')
  // As the venue again.
  await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', order_prompt: 'venue' } }))
  cfg = await config(till)
  assert.equal(cfg.device.settings.order_prompt, 'venue')
  assert.equal(cfg.settings.order_prompt, 'two')
  assert.equal((await as(B.owner, ids.b).patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', order_prompt: 'two' } })).status, 404)
})
