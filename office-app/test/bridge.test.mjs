// The bridge between the phone pages and the app (bridge.js): the page's
// side run in a stand-in window, the app's side routing each call, and the
// two talking to each other as they do in the web view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { bridgeScript, makeHandler, CALLS, cleanHints, MAX_HINTS } from '../bridge.js'

/** A page with the bridge on it, wired to an app handler. */
function wire(services, { allowed = () => true, url = 'https://ops.macaroonie.com/mobile' } = {}) {
  const ran = []
  let handle
  const window = { ReactNativeWebView: { postMessage: data => setTimeout(() => handle(data, url), 0) } }
  const page = vm.createContext({ window, Promise, setTimeout, JSON, Error })
  vm.runInContext(bridgeScript('9'), page)
  handle = makeHandler({ services, allowed, run: script => { ran.push(script); vm.runInContext(script, page) } })
  return { window, ran }
}

const services = {
  auth: { token: async () => 'tok-1', user: async () => ({ sub: 's', email: 'e@x.test' }), signIn: async () => null, signOut: async () => true },
  push: { token: async () => 'ExponentPushToken[abc]' },
  speech: {
    listen({ onText, onEnd }) { setTimeout(() => { onText('hello', false); onText('hello there', true); onEnd() }, 5); return () => {} },
    speak: async () => true, stopSpeaking: async () => true,
  },
  scanner: { scan: async () => '5012345678900' },
  camera: { permission: async () => true },
}

test('the page gets the token, the person, the push token and a scan', async () => {
  const { window } = wire(services)
  const app = window.MacaroonieOffice
  assert.equal(app.version, '9')
  assert.equal(await app.auth.token(), 'tok-1')
  assert.equal((await app.auth.user()).email, 'e@x.test')
  assert.equal(await app.push.token(), 'ExponentPushToken[abc]')
  assert.equal(await app.scanner.scan(), '5012345678900')
  assert.equal(await app.camera.permission(), true, 'the page asks for the camera before a photo input opens it')
})

test('speech: words as they come, then the end; stop() reaches the app', async () => {
  const { window } = wire(services)
  const heard = []
  await new Promise(resolve => {
    window.MacaroonieOffice.speech.listen({ lang: 'en-GB', onText: (t, f) => heard.push([t, f]), onEnd: resolve })
  })
  assert.deepEqual(heard, [['hello', false], ['hello there', true]])
})

test('speech: continuous listening is asked for through the bridge, and stop() reaches that listening', async () => {
  const asked = []
  let stopped = 0
  const { window } = wire({ ...services, speech: { ...services.speech, listen(o) { asked.push(o.continuous); return () => { stopped++; o.onEnd() } } } })
  await new Promise(resolve => {
    const stop = window.MacaroonieOffice.speech.listen({ continuous: true, onEnd: resolve })
    setTimeout(stop, 5)
  })
  await new Promise(resolve => window.MacaroonieOffice.speech.listen({ onEnd: resolve }).call())
  assert.deepEqual(asked, [true, false])
  assert.equal(stopped, 2)
})

test('speech: the venue\'s words go to the recogniser as hints, cleaned and capped (step 6c)', async () => {
  const asked = []
  const { window } = wire({ ...services, speech: { ...services.speech, listen(o) { asked.push(o.hints); setTimeout(o.onEnd, 1); return () => {} } } })
  await new Promise(resolve => window.MacaroonieOffice.speech.listen({ hints: ['Walk-in fridge', ' Fresh Co ', 7, '', 'x'.repeat(61)], onEnd: resolve }))
  await new Promise(resolve => window.MacaroonieOffice.speech.listen({ onEnd: resolve }))
  assert.deepEqual(asked, [['Walk-in fridge', 'Fresh Co'], undefined])
  assert.equal(cleanHints(Array.from({ length: 400 }, (_, i) => 'w' + i)).length, MAX_HINTS)
  assert.equal(cleanHints('nope'), undefined)
})

test('a failure comes back as the page\'s error; an unknown call is refused', async () => {
  const { window } = wire({ ...services, scanner: { scan: async () => { throw new Error('No camera') } } })
  await assert.rejects(window.MacaroonieOffice.scanner.scan(), /No camera/)
  assert.ok(!CALLS['auth.steal'])
})

test('a page that isn\'t ours gets nothing', async () => {
  const { window } = wire(services, { allowed: () => false, url: 'https://evil.example/' })
  await assert.rejects(window.MacaroonieOffice.auth.token(), /Not on a Macaroonie page/)
})

test('the bridge is put on once, and says what the admin\'s pages look for', () => {
  const s = bridgeScript('1')
  for (const part of ['auth', 'token', 'push', 'speech', 'listen', 'speak', 'scanner', 'scan']) assert.ok(s.includes(part), part)
  assert.match(s, /if \(window\.MacaroonieOffice\) return;/)
})
