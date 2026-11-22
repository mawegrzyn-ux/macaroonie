// Where Macaroonie Office opens and what stays inside it (links.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opsUrl, staysInApp, bridgeAllowed, noticeUrl, hostOf } from '../links.js'

const ROOT = 'macaroonie.com'

test('the phone pages on ops., and the office, stay in the app; nothing else does', () => {
  assert.equal(opsUrl(ROOT), 'https://ops.macaroonie.com/mobile')
  assert.equal(opsUrl(ROOT, '/mobile/today'), 'https://ops.macaroonie.com/mobile/today')
  assert.ok(staysInApp('https://ops.macaroonie.com/mobile/cash-up', ROOT))
  assert.ok(staysInApp('https://office.macaroonie.com/reports/1', ROOT))
  assert.ok(!staysInApp('http://ops.macaroonie.com/mobile', ROOT), 'https only')
  assert.ok(!staysInApp('https://pos.macaroonie.com/', ROOT), 'a device app is not the office')
  assert.ok(!staysInApp('https://ops.macaroonie.com.evil.example/', ROOT))
  assert.ok(!staysInApp('https://evil.example/?ops.macaroonie.com', ROOT))
  assert.ok(!staysInApp('javascript:alert(1)', ROOT))
  assert.equal(hostOf('https://OPS.macaroonie.com:443/x'), 'ops.macaroonie.com')
})

test('only our pages may use the bridge (the token above all)', () => {
  assert.ok(bridgeAllowed('https://ops.macaroonie.com/mobile', ROOT))
  assert.ok(!bridgeAllowed('about:blank', ROOT))
  assert.ok(!bridgeAllowed('https://accounts.google.com/', ROOT))
})

test('a tapped notice opens its page on the phone pages', () => {
  assert.equal(noticeUrl('/', ROOT), 'https://ops.macaroonie.com/mobile/today', 'Home: the phone\'s Today')
  assert.equal(noticeUrl('/mobile/cash-up', ROOT), 'https://ops.macaroonie.com/mobile/cash-up')
  assert.equal(noticeUrl('//evil.example/x', ROOT), 'https://ops.macaroonie.com/mobile', 'never another host')
  assert.equal(noticeUrl('https://evil.example/', ROOT), 'https://ops.macaroonie.com/mobile')
  assert.equal(noticeUrl(undefined, ROOT), 'https://ops.macaroonie.com/mobile')
})
