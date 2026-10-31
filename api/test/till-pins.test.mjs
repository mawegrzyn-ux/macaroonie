// Staff PINs (Store tech, Staff and PINs; shared/pos/pin.js): a PIN starting
// with 0 keeps its 0, a PIN can't start with another person's at the venue
// or be the start of theirs (the till signs in as soon as the digits match
// someone), and the till's config carries the hash a typed PIN finds.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { hashPin } from '../../shared/pos/pin.js'

let ids, owner, viewer, V, till, jo, sam, third

async function config(d) {
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/pos-api/config',
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}
const setPin = (who, pin, by = owner) => by.put(`/api/pos/venues/${V}/staff/${who}/pos`, { pin })
const staffOf = async (cfg, pin) => {
  const hash = await hashPin(pin, cfg.pin_salt)
  return cfg.staff.find(s => s.pin_hash === hash)?.id || null
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  jo = filled.ids.staff
  sam = filled.ids.staff2
  third = (await ok(owner.post(`/api/rota/venues/${V}/staff`, { name: 'Zqp Ann Lee', pay_type: 'hourly', default_rate: 11 }))).id
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqp Till' })
})
after(closeApp)

test('a PIN starting with 0 keeps its 0, and the till finds the person by it', async () => {
  await ok(setPin(jo, '0482'))
  const cfg = await config(till)
  assert.equal(await staffOf(cfg, '0482'), jo)
  // Without its 0 it is someone else's PIN (or nobody's).
  assert.equal((await setPin(sam, '482')).status, 400)
})

test('a PIN can\'t start with another person\'s PIN or be the start of theirs', async () => {
  await ok(setPin(jo, '0482'))
  // Longer, starting with Jo's.
  let r = await setPin(sam, '048217')
  assert.equal(r.status, 422)
  assert.match(r.json.error, /starts the same way/)
  r = await setPin(sam, '04825')
  assert.equal(r.status, 422)
  // Shorter: the start of a longer PIN.
  await ok(setPin(jo, '573912'))
  r = await setPin(sam, '5739')
  assert.equal(r.status, 422)
  r = await setPin(sam, '57391')
  assert.equal(r.status, 422)
  // The same PIN: its own message.
  r = await setPin(sam, '573912')
  assert.equal(r.status, 422)
  assert.match(r.json.error, /has that PIN/)
  // Different from the fourth digit on: fine.
  await ok(setPin(sam, '5740'))
  // A third person: clear of both.
  assert.equal((await setPin(third, '57391')).status, 422)
  await ok(setPin(third, '5741'))
  const cfg = await config(till)
  assert.equal(await staffOf(cfg, '573912'), jo)
  assert.equal(await staffOf(cfg, '5740'), sam)
})

test('a person\'s own old PIN never blocks their new one', async () => {
  await ok(setPin(jo, '6153'))
  await ok(setPin(jo, '615390'))
  await ok(setPin(jo, '6153'))
  const cfg = await config(till)
  assert.equal(await staffOf(cfg, '6153'), jo)
  assert.equal(await staffOf(cfg, '615390'), null)
})

test('weak PINs, viewers and another group are refused', async () => {
  assert.equal((await setPin(sam, '1111')).status, 422)
  assert.equal((await setPin(sam, '4321')).status, 422)
  assert.equal((await setPin(sam, '8264', viewer)).status, 403)
  assert.equal((await setPin(sam, '8264', as(B.owner, ids.b))).status, 404)
})
