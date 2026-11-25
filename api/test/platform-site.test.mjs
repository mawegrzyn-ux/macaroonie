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

after(closeApp)

const APEX = 'macaroonie.com'
async function get(url, host = APEX, method = 'GET') {
  const app = await getApp()
  return app.inject({ method, url, headers: { host } })
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
    assert.match(r.headers['cache-control'], url.includes('?v=') ? /max-age=31536000, immutable/ : /max-age=3600/, url)
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
