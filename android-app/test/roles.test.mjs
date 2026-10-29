// What the device can be (roles.js): four kinds, their addresses, and which
// kind a page of ours belongs to (the app remembers it when the web app moves).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, KIND_OF_SUB, roleOf, urlFor, kindOfUrl, ours, staysPut } from '../roles.js'

const ROOT = 'macaroonie.com'

test('a till, kitchen screen, kiosk and menu screen, each on its address', () => {
  assert.deepEqual(ROLES.map(r => r.kind), ['terminal', 'kds', 'kiosk', 'screen'])
  assert.equal(urlFor('terminal', ROOT), 'https://pos.macaroonie.com/')
  assert.equal(urlFor('kds', ROOT), 'https://kitchen.macaroonie.com/')
  assert.equal(urlFor('kiosk', ROOT), 'https://kiosk.macaroonie.com/')
  assert.equal(urlFor('screen', ROOT), 'https://screens.macaroonie.com/')
  assert.equal(roleOf('screen').title, 'Menu screen')
  assert.equal(roleOf('nope'), null)
  for (const r of ROLES) assert.equal(KIND_OF_SUB[r.sub], r.kind, r.sub + ' maps back to ' + r.kind)
})

test('which kind a page of ours is', () => {
  assert.equal(kindOfUrl('https://screens.macaroonie.com/?x=1', ROOT), 'screen')
  assert.equal(kindOfUrl('https://kds.macaroonie.com/', ROOT), 'kds', 'kds. forwards to kitchen.')
  assert.equal(kindOfUrl('https://KIOSK.macaroonie.com/#pair=AB', ROOT), 'kiosk')
  assert.equal(kindOfUrl('https://office.macaroonie.com/', ROOT), null, 'ours, but not a device address')
  assert.equal(kindOfUrl('https://macaroonie.com/', ROOT), null)
  assert.equal(kindOfUrl('https://screens.macaroonie.com.evil.example/', ROOT), null)
  assert.equal(kindOfUrl('https://evilmacaroonie.com/', ROOT), null)
  assert.ok(ours('installer.macaroonie.com', ROOT))
  assert.ok(!ours('macaroonie.com.evil.example', ROOT))
})

test('guest-facing devices never leave for another site', () => {
  assert.ok(staysPut('kiosk'))
  assert.ok(staysPut('screen'))
  assert.ok(!staysPut('terminal'))
  assert.ok(!staysPut('kds'))
})
