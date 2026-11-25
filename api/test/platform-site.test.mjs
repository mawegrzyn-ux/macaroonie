// The platform site on the apex (routes/platformSite.js, services/platformSite/):
// every page answers on macaroonie.com with its own title, the files it links
// to load with cache headers, the placeholders stay out of the sitemap, other
// GETs still go to office, the register-interest form still works, and tenant
// and office addresses are left alone.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { getApp, closeApp, sql } from './support/app.mjs'
import { PAGES } from '../src/services/platformSite/pages.js'
import { FEATURE_GROUPS } from '../src/services/platformSite/features.js'
import { ARCH_LAYERS } from '../src/services/platformSite/architecture.js'
import { SHOTS, GALLERY } from '../src/services/platformSite/screenshots.js'
import { sharedFiles, sharedBase, ENTRIES } from '../src/services/platformSite/sharedModules.js'
import { setDemoRoots, DEMO_PAGES } from '../src/services/platformSite/demoBuilds.js'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

// The kiosk designer demo's two builds (admin/ and pos/ dist-demo, made by
// npm run build): stand-ins in a folder of the test's own, so the test
// doesn't depend on a build having run.
const DEMO = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kiosk-demo-'))
const demoFile = (rel, body) => {
  fs.mkdirSync(nodePath.dirname(nodePath.join(DEMO, rel)), { recursive: true })
  fs.writeFileSync(nodePath.join(DEMO, rel), body)
}
demoFile('designer/demo-kiosk.html', '<!DOCTYPE html><title>Kiosk designer demo</title><script type="module" src="/site/demo/kiosk-designer/assets/demo-kiosk-abc123.js"></script>')
demoFile('designer/assets/demo-kiosk-abc123.js', 'console.log("designer");'.repeat(40))
demoFile('designer/assets/burger-abc123.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
demoFile('designer/notes.txt', 'not a type the demo serves')
demoFile('kiosk/demo-kiosk.html', '<!DOCTYPE html><title>Kiosk demo</title>')
demoFile('kiosk/assets/demo-kiosk-def456.css', '.k-root{color:red}')
fs.writeFileSync(nodePath.join(DEMO, 'secret.json'), '{"dependencies":{}}')
setDemoRoots({ 'kiosk-designer': nodePath.join(DEMO, 'designer'), 'kiosk-app': nodePath.join(DEMO, 'kiosk') })

after(async () => {
  setDemoRoots(null)
  fs.rmSync(DEMO, { recursive: true, force: true })
  await closeApp()
})

const APEX = 'macaroonie.com'
async function get(url, host = APEX, method = 'GET') {
  const app = await getApp()
  return app.inject({ method, url, headers: { host } })
}
async function getWith(url, headers) {
  const app = await getApp()
  return app.inject({ method: 'GET', url, headers: { host: APEX, ...headers } })
}
const unescape = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&quot;/g, '"')

test('every page answers on the apex with its title, description and canonical address', async () => {
  for (const p of PAGES) {
    const r = await get(p.path)
    assert.equal(r.statusCode, 200, p.path)
    assert.match(r.headers['content-type'], /text\/html/, p.path)
    const html = unescape(r.body)
    assert.ok(html.includes('<title>' + p.title + '</title>'), p.path + ' title')
    assert.ok(html.includes('content="' + p.description + '"'), p.path + ' description')
    assert.ok(html.includes('<link rel="canonical" href="https://macaroonie.com' + p.path + '">'), p.path + ' canonical')
    assert.equal(html.includes('name="robots" content="noindex"'), !!p.soon, p.path + ' noindex only on placeholders')
    if (p.shot) assert.ok(html.includes('og:image" content="https://macaroonie.com/site/img/' + SHOTS[p.shot].name + '-1200.jpg"'), p.path + ' og:image')
  }
  const slash = await get('/features/')
  assert.equal(slash.statusCode, 200, 'a trailing slash is the same page')
  const head = await get('/architecture', APEX, 'HEAD')
  assert.equal(head.statusCode, 200)
})

test('the content: six tiles, every part and every screenshot', async () => {
  assert.equal(FEATURE_GROUPS.length, 6)
  const home = (await get('/')).body
  for (const g of FEATURE_GROUPS) {
    assert.ok(home.includes('aria-controls="drill-' + g.slug + '"'), g.slug + ' tile is a button for its drill-down')
    assert.ok(g.points.length >= 3 && g.points.length <= 5, g.slug + ' has three to five points')
    assert.ok(SHOTS[g.shot], g.slug + ' screenshot exists')
    assert.ok(ARCH_LAYERS.some(l => l.parts.some(p => p.id === g.arch)), g.slug + ' fits a part of the picture')
    const page = (await get('/features/' + g.slug)).body
    for (const part of g.parts) assert.ok(page.includes('id="part-' + part.id + '"'), g.slug + ' ' + part.id)
  }
  assert.ok(home.includes('id="interest-form"'), 'the home page keeps the form')
  const arch = (await get('/architecture')).body
  const ids = ARCH_LAYERS.flatMap(l => l.parts.map(p => p.id))
  assert.equal(new Set(ids).size, ids.length, 'part ids are unique anchors')
  for (const id of ids) {
    assert.ok(arch.includes('id="btn-' + id + '"') && arch.includes('aria-controls="detail-' + id + '"'), id + ' button')
    assert.ok(arch.includes('id="detail-' + id + '"'), id + ' detail')
  }
  const shots = (await get('/screenshots')).body
  for (const key of GALLERY) assert.ok(shots.includes('/site/img/' + SHOTS[key].name + '-1200.jpg'), key)
  const all = PAGES.map(p => p.path).concat(['/'])
  for (const p of all) {
    const html = (await get(p)).body
    assert.ok(!/[\u2018\u2019\u201c\u201d\u00a0\ufeff]/.test(html), p + ' has no typographic quotes or invisible characters')
    for (const m of html.matchAll(/<img [^>]*>/g)) if (!m[0].includes('lightbox-img')) assert.match(m[0], / alt="[^"]+"/, p + ' every picture has alt text')
  }
})

test('the files the pages link to load, with cache headers', async () => {
  const seen = new Set()
  for (const p of PAGES) {
    for (const m of (await get(p.path)).body.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
      for (const part of m[1].split(',')) {
        const url = part.trim().split(' ')[0]
        if (url.startsWith('/site/')) seen.add(url)
      }
    }
  }
  assert.ok(seen.size > 20, 'the pages link their CSS, JS and screenshots')
  for (const url of seen) {
    const r = await get(url)
    assert.equal(r.statusCode, 200, url)
    assert.ok(r.rawPayload.length > 0, url)
    if (url.endsWith('.webp') || url.endsWith('.jpg')) assert.ok(r.rawPayload.length < 260 * 1024, url + ' stays small')
    const cache = url.startsWith('/site/demo/') ? /max-age=0, must-revalidate/ : url.includes('?v=') || url.startsWith('/site/shared/') ? /max-age=31536000, immutable/ : /max-age=3600/
    assert.match(r.headers['cache-control'], cache, url)
  }
  const css = await get('/site/site.css')
  assert.match(css.headers['content-type'], /text\/css/)
  assert.equal(css.headers['cache-control'], 'public, max-age=3600', 'no version: an hour')
  for (const bad of ['/site/nope.css', '/site/..%2fpackage.json', '/site/', '/site/site.exe', '/site/img/x/y/z.png']) {
    assert.equal((await get(bad)).statusCode, 404, bad)
  }
  // A path with dot segments is resolved before it reaches the hook: never a file outside the folder.
  for (const up of ['/site/../package.json', '/site/img/%2e%2e/%2e%2e/package.json']) {
    const r = await get(up)
    assert.notEqual(r.statusCode, 200, up)
    assert.ok(!r.body.includes('"dependencies"'), up)
  }
})

test('the sandboxes: live pages that load the shared rules they run', async () => {
  for (const [path, script, entry] of [['/try/kitchen-flow', 'try-kitchen.js', 'pos/kitchenBench.js']]) {
    const r = await get(path)
    assert.equal(r.statusCode, 200, path)
    assert.ok(r.body.includes('data-shared="' + sharedBase() + '"'), path + ' tells its script where the shared rules are')
    assert.match(r.body, new RegExp('<script type="module" src="/site/' + script.replace('.', '\\.') + '\\?v=[0-9a-f]+"'), path + ' script')
    assert.ok(r.body.includes('<link rel="modulepreload" href="' + sharedBase() + entry + '">'), path + ' preloads ' + entry)
    assert.ok(r.body.includes('Like what you see?'), path + ' ends with the register-interest band')
    assert.ok(!r.body.includes('Coming next'), path + ' is no longer a placeholder')
  }
  const tryPage = (await get('/try')).body
  assert.ok(tryPage.includes('href="/try/kitchen-flow"') && tryPage.includes('href="/try/kiosk"'), '/try links both')
  const home = (await get('/')).body
  assert.ok(home.includes('href="/try/kitchen-flow"') && !home.includes('coming next'), 'the home teaser links them')
})

test('the kiosk designer demo: the page frames the demo build, which is served from an allowlist only', async () => {
  const r = await get('/try/kiosk')
  assert.equal(r.statusCode, 200)
  assert.ok(r.body.includes('<iframe class="kd-demo-frame" src="' + DEMO_PAGES.designer + '"'), 'frames the designer demo')
  assert.ok(r.body.includes('Like what you see?') && r.body.includes('href="/#interest"'), 'ends with the register-interest band')
  assert.ok(!r.body.includes('<script type="module"') && !r.body.includes('data-shared='), 'no sandbox script of its own any more')
  assert.ok(!r.body.includes('/api/') && !r.body.includes('/pos-api'), 'no API address in the page')
  const tryPage = (await get('/try')).body
  assert.ok(tryPage.includes('Open the designer'), '/try says what it opens')

  const page = await getWith(DEMO_PAGES.designer, {})
  assert.equal(page.statusCode, 200)
  assert.match(page.headers['content-type'], /^text\/html/)
  assert.equal(page.headers['cache-control'], 'public, max-age=0, must-revalidate', 'the page is checked every time')
  const js = await getWith('/site/demo/kiosk-designer/assets/demo-kiosk-abc123.js', { 'accept-encoding': 'gzip' })
  assert.equal(js.statusCode, 200)
  assert.match(js.headers['content-type'], /^application\/javascript/)
  assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable', 'hashed files for a year')
  assert.equal(js.headers['content-encoding'], 'gzip')
  const svg = await getWith('/site/demo/kiosk-designer/assets/burger-abc123.svg', {})
  assert.equal(svg.headers['content-type'], 'image/svg+xml')
  assert.equal(svg.headers['x-content-type-options'], 'nosniff')
  assert.equal((await getWith(DEMO_PAGES.kiosk, {})).statusCode, 200, 'the kiosk app build')
  assert.equal((await getWith('/site/demo/kiosk-app/assets/demo-kiosk-def456.css', {})).headers['content-type'], 'text/css; charset=utf-8')

  for (const bad of [
    '/site/demo/', '/site/demo/kiosk-designer/', '/site/demo/kiosk-designer', '/site/demo/kiosk-designer/notes.txt',
    '/site/demo/kiosk-designer/../secret.json', '/site/demo/kiosk-designer/%2e%2e/secret.json', '/site/demo/kiosk-designer/..%2fsecret.json',
    '/site/demo/kiosk-designer/assets/../../secret.json', '/site/demo/secret.json', '/site/demo/other/demo-kiosk.html',
    '/site/demo/kiosk-designer/assets/nope.js',
    '/site/demo/kiosk-designer/ASSETS/demo-kiosk-abc123.js',
  ]) {
    const res = await get(bad)
    assert.notEqual(res.statusCode, 200, bad)
    assert.ok(!res.body.includes('"dependencies"') && !res.body.includes('not a type'), bad + ' serves nothing')
  }
  // Off the apex the demo isn't served (an office or tenant host).
  assert.notEqual((await get(DEMO_PAGES.designer, 'office.macaroonie.com')).body.includes('Kiosk designer demo'), true)
})

test('the shared rules are served from an allowlist only', async () => {
  const files = sharedFiles()
  for (const e of ENTRIES) assert.ok(files.includes(e), e)
  assert.ok(files.every(f => /^[a-zA-Z0-9/]+\.js$/.test(f) && !f.startsWith('test/')), 'plain module files under shared/')
  for (const f of files) {
    const plain = await getWith(sharedBase() + f, {})
    assert.equal(plain.statusCode, 200, f)
    assert.match(plain.headers['content-type'], /^application\/javascript/, f)
    assert.equal(plain.headers['cache-control'], 'public, max-age=31536000, immutable', f)
    assert.ok(!/\bfrom\s+['"](node:|[a-z@])/.test(plain.body), f + ' imports no packages or Node modules')
    const gz = await getWith(sharedBase() + f, { 'accept-encoding': 'gzip, br' })
    assert.equal(gz.headers['content-encoding'], 'gzip', f + ' gzipped')
    assert.ok(gz.rawPayload.length < plain.rawPayload.length, f + ' smaller gzipped')
  }
  const v = sharedBase()
  assert.ok(!files.includes('pos/sequencer.js'), 'a shared file the sandboxes do not import')
  for (const bad of [
    v + 'pos/sequencer.js', v + 'test/kiosk.test.mjs', v + '../package.json', v + 'pos/../../../api/package.json',
    v + '%2e%2e/api/package.json', v + 'pos%2fkitchen.js', '/site/shared/000000000000/kiosk.js', '/site/shared/kiosk.js',
    '/site/shared/', v,
  ]) {
    const r = await get(bad)
    assert.notEqual(r.statusCode, 200, bad)
    assert.ok(!r.body.includes('"dependencies"') && !r.body.includes('export '), bad + ' serves nothing')
  }
})

test('sitemap and robots', async () => {
  const map = await get('/sitemap.xml')
  assert.equal(map.statusCode, 200)
  assert.match(map.headers['content-type'], /xml/)
  for (const p of PAGES) {
    assert.equal(map.body.includes('<loc>https://macaroonie.com' + p.path + '</loc>'), !p.soon, p.path)
  }
  const robots = await get('/robots.txt')
  assert.match(robots.body, /Sitemap: https:\/\/macaroonie\.com\/sitemap\.xml/)
})

test('any other GET on the apex still goes to office; unknown site pages are 404', async () => {
  for (const path of ['/timeline', '/pos/kitchen-flow', '/reports/abc?x=1', '/featuresx']) {
    const r = await get(path)
    assert.equal(r.statusCode, 301, path)
    assert.equal(r.headers.location, 'https://office.macaroonie.com' + path, path)
  }
  assert.equal((await get('/features/nope')).statusCode, 404)
  assert.equal((await get('/try/nope')).statusCode, 404)
  assert.equal((await get('/sw.js')).statusCode, 200, 'the self-removing service worker stays')
})

test('the register-interest form still works', async () => {
  const app = await getApp()
  const email = 'site-test-' + Date.now() + '@example.com'
  const post = (payload) => app.inject({ method: 'POST', url: '/api/platform-interest', headers: { host: APEX, 'content-type': 'application/json' }, payload: JSON.stringify(payload) })
  const r = await post({ name: 'Site test', email, consent: true, website: '' })
  assert.equal(r.statusCode, 201, r.body)
  const [row] = await sql`SELECT name FROM platform_interest WHERE email = ${email}`
  assert.equal(row?.name, 'Site test')
  const bot = await post({ name: 'Bot', email: 'bot-' + email, consent: true, website: 'spam' })
  assert.equal(bot.statusCode, 204, 'the honeypot')
  await sql`DELETE FROM platform_interest WHERE email = ${email}`
})

test('tenant sites and office are left alone', async () => {
  for (const host of ['harbour.macaroonie.com', 'office.macaroonie.com']) {
    for (const path of ['/features', '/architecture', '/site/site.css', '/sitemap.xml']) {
      const r = await get(path, host)
      assert.ok(!r.body.includes('What Macaroonie does') && !r.body.includes('How it works</h1>') && !r.body.includes('.tile-title'), host + path + ' is not the platform site')
    }
  }
})
