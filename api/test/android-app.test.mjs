// The Android app's download (migration 213, services/androidAppSvc.js,
// routes/androidApp.js): a platform admin gives a link (the APK, or a page
// that links it, like the build's page on expo.dev); the server keeps its
// own copy; GET /pos-api/android-app tells the setup screens; /android on
// pos., kitchen. and kiosk. sends the file. Expo is stood in for by a local
// server.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { as, getApp, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, PLATFORM } from './support/seed.mjs'
import { env } from '../src/config/env.js'
import { apkLinkIn, apkProblem, saveAndroidApp } from '../src/services/androidAppSvc.js'

const ROOT = env.PUBLIC_ROOT_DOMAIN.toLowerCase()

// A zip whose entry list names AndroidManifest.xml is what the check needs.
const zip = (...names) => Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26),
  ...names.map(n => Buffer.from(n)), Buffer.from('x'.repeat(2000)),
])
const APK1 = zip('AndroidManifest.xml', 'classes.dex', 'first build')
const APK2 = zip('AndroidManifest.xml', 'classes.dex', 'second build')
const AAB = zip('base/manifest/AndroidManifest.xml', 'BundleConfig.pb')

let server, base, ids, platform, owner

before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body) }
    if (req.url === '/one.apk') return send(200, 'application/vnd.android.package-archive', APK1)
    if (req.url === '/artifacts/two.apk?x=1') return send(200, 'application/octet-stream', APK2)
    if (req.url === '/moved') { res.writeHead(302, { location: '/one.apk' }); return res.end() }
    // A build page like expo.dev's: the file's address only inside escaped JSON.
    if (req.url === '/build-page') {
      const escaped = JSON.stringify({ artifacts: { buildUrl: base + '/artifacts/two.apk?x=1' } }).replace(/\//g, '\\u002F')
      return send(200, 'text/html; charset=utf-8', `<!doctype html><html><body><div id="app"></div><script id="__NEXT_DATA__">${escaped}</script></body></html>`)
    }
    if (req.url === '/no-app-page') return send(200, 'text/html', '<html><body>Sign in to see this build</body></html>')
    if (req.url === '/bundle.aab') return send(200, 'application/octet-stream', AAB)
    if (req.url === '/text') return send(200, 'text/plain', 'not an app')
    if (req.url === '/slow.apk') return setTimeout(() => send(200, 'application/octet-stream', APK1), 60_000)
    return send(404, 'text/plain', 'gone')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + server.address().port
  ids = await resetAndSeed()
  platform = as(PLATFORM, null)
  owner = as(A.owner, ids.a)
})
after(async () => {
  server.closeAllConnections?.()
  server.close()
  await closeApp()
})

async function onHost(sub, url) {
  const app = await getApp()
  return app.inject({ method: 'GET', url, headers: { host: `${sub}.${ROOT}`, 'x-forwarded-proto': 'https' } })
}

const storedFile = url => path.join(env.UPLOAD_DIR, url.slice('/uploads/'.length))

test('the link check: finds an .apk in a page, refuses what isn\'t an app', () => {
  assert.equal(apkLinkIn('<a href="https://expo.dev/artifacts/eas/abc.apk">Install</a>'), 'https://expo.dev/artifacts/eas/abc.apk')
  assert.equal(apkLinkIn('{"u":"https:\\u002F\\u002Fexpo.dev\\u002Fartifacts\\u002Feas\\u002Fx.apk"}'), 'https://expo.dev/artifacts/eas/x.apk')
  assert.equal(apkLinkIn('{"u":"https:\\/\\/expo.dev\\/a\\/b.apk?t=1&amp;s=2"}'), 'https://expo.dev/a/b.apk?t=1&s=2')
  assert.equal(apkLinkIn('<p>nothing here</p>'), null)
  assert.equal(apkProblem(APK1), null)
  assert.match(apkProblem(AAB), /app bundle/)
  assert.match(apkProblem(Buffer.from('hello world')), /isn't an Android app/)
  assert.match(apkProblem(zip('word/document.xml')), /isn't an Android app/)
})

test('nothing offered: the setup screens are told so and /android says so', async () => {
  const pub = await getApp().then(a => a.inject({ method: 'GET', url: '/pos-api/android-app' }))
  assert.equal(pub.statusCode, 200)
  assert.deepEqual(pub.json(), { available: false })
  const dl = await onHost('pos', '/android')
  assert.equal(dl.statusCode, 404)
  assert.match(dl.body, /isn't available here yet/)
  const view = await ok(platform.get('/api/platform/android-app'))
  assert.equal(view.app, null)
  assert.deepEqual(view.addresses, ['pos', 'kitchen', 'kiosk'].map(s => `${env.PUBLIC_SITE_SCHEME}://${s}.${ROOT}/android`))
})

test('only platform admins see or change it', async () => {
  for (const [method, body] of [['get'], ['put', { link: base + '/one.apk' }], ['delete']]) {
    const res = await owner[method]('/api/platform/android-app', body)
    assert.equal(res.status, 403, method)
  }
  const anon = await getApp().then(a => a.inject({ method: 'PUT', url: '/api/platform/android-app', payload: { link: base + '/one.apk' } }))
  assert.equal(anon.statusCode, 401)
  const [row] = await sql`SELECT count(*)::int AS n FROM platform_settings`
  assert.equal(row.n, 0)
})

test('an APK link is copied and downloaded from every device address', async () => {
  const view = await ok(platform.put('/api/platform/android-app', { link: base + '/moved' }))
  assert.equal(view.app.bytes, APK1.length)
  assert.equal(view.app.source_url, base + '/moved')
  assert.match(view.app.updated_by, /@test\.local$/)
  const [row] = await sql`SELECT value FROM platform_settings WHERE name = 'android_app'`
  assert.ok(row.value.url.startsWith('/uploads/platform/android/') && row.value.url.endsWith('.apk'), row.value.url)
  assert.deepEqual(fs.readFileSync(storedFile(row.value.url)), APK1)

  const pub = (await getApp().then(a => a.inject({ method: 'GET', url: '/pos-api/android-app' }))).json()
  assert.equal(pub.available, true)
  assert.equal(pub.path, '/android')
  assert.equal(pub.bytes, APK1.length)
  assert.equal(pub.source_url, undefined, 'the link is only for platform admins')

  for (const sub of ['pos', 'kitchen', 'kiosk']) {
    const dl = await onHost(sub, '/android')
    assert.equal(dl.statusCode, 200, sub)
    assert.equal(dl.headers['content-type'], 'application/vnd.android.package-archive')
    assert.equal(dl.headers['content-disposition'], 'attachment; filename="macaroonie.apk"')
    assert.match(dl.headers['cache-control'], /no-store/)
    assert.deepEqual(dl.rawPayload, APK1, sub)
  }
  assert.equal((await onHost('pos', '/android/')).statusCode, 200)
  const kds = await onHost('kds', '/android')
  assert.equal(kds.statusCode, 301)
  assert.equal(kds.headers.location, `https://kitchen.${ROOT}/android`)
  const plain = await getApp().then(a => a.inject({ method: 'GET', url: '/android', headers: { host: `pos.${ROOT}`, 'x-forwarded-proto': 'http' } }))
  assert.equal(plain.statusCode, 301, 'http goes to https first')
})

test('a build page is read for its file; the old copy goes', async () => {
  const [before] = await sql`SELECT value FROM platform_settings WHERE name = 'android_app'`
  const view = await ok(platform.put('/api/platform/android-app', { link: base + '/build-page' }))
  assert.equal(view.app.bytes, APK2.length)
  assert.equal(view.app.file_url, base + '/artifacts/two.apk?x=1')
  const dl = await onHost('kiosk', '/android')
  assert.deepEqual(dl.rawPayload, APK2)
  assert.equal(fs.existsSync(storedFile(before.value.url)), false, 'the first copy is removed')
})

test('links that aren\'t an app are refused and the download stays', async () => {
  const cases = [
    [base + '/no-app-page', /web page with no app file/],
    [base + '/bundle.aab', /app bundle/],
    [base + '/text', /isn't an Android app/],
    [base + '/missing.apk', /answered 404/],
    ['http://127.0.0.1:9/nothing.apk', /Couldn't reach that link/],
    ['ftp://example.com/app.apk', /https:\/\/ link/],
    ['javascript:alert(1)', /https:\/\/ link/],
    ['not a link', /https:\/\/ link/],
  ]
  for (const [link, message] of cases) {
    const res = await platform.put('/api/platform/android-app', { link })
    assert.equal(res.status, 422, link)
    assert.match(res.json.error, message, link)
  }
  assert.equal((await platform.put('/api/platform/android-app', {})).status, 400)
  await assert.rejects(saveAndroidApp(base + '/slow.apk', { timeoutMs: 300 }), /took too long/)
  const dl = await onHost('pos', '/android')
  assert.deepEqual(dl.rawPayload, APK2, 'the last good copy is still offered')
})

test('a copy whose file went missing says so instead of failing', async () => {
  const [row] = await sql`SELECT value FROM platform_settings WHERE name = 'android_app'`
  const file = storedFile(row.value.url)
  const keep = fs.readFileSync(file)
  fs.rmSync(file)
  const dl = await onHost('pos', '/android')
  assert.equal(dl.statusCode, 404)
  assert.match(dl.body, /missing on the server/)
  fs.writeFileSync(file, keep)
})

test('stop offering it: the copy is removed and the setup screens hide the button', async () => {
  const [row] = await sql`SELECT value FROM platform_settings WHERE name = 'android_app'`
  const view = await ok(platform.delete('/api/platform/android-app'))
  assert.equal(view.app, null)
  assert.equal(fs.existsSync(storedFile(row.value.url)), false)
  const pub = (await getApp().then(a => a.inject({ method: 'GET', url: '/pos-api/android-app' }))).json()
  assert.deepEqual(pub, { available: false })
  assert.equal((await onHost('pos', '/android')).statusCode, 404)
})
