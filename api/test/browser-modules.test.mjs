// The pages that load ES modules straight from the server, with no bundler:
// the menu screen player (screen/index.html -> /player.js -> /lib/...), the
// online ordering page (/order-api/...) and the loyalty card (/loyalty-api/...).
// A browser follows every import; one file it can't load stops the whole page
// (from #431 orderPricing.js imported pos/orderFlows.js and pos/charges.js,
// the player's list didn't serve them, and every menu screen stopped
// starting). Each tree is followed here the same way, and the player's
// service worker must keep exactly the files the player loads.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getApp, closeApp } from './support/app.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { env } from '../src/config/env.js'

after(closeApp)

const SCREENS = 'screens.' + env.PUBLIC_ROOT_DOMAIN.toLowerCase()
const SPEC_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm
const specsOf = src => [...src.matchAll(SPEC_RE)].map(m => m[1] || m[2] || m[3])
const views = rel => fs.readFileSync(new URL('../src/views/site/' + rel, import.meta.url), 'utf8')

async function get(url, host = 'localhost') {
  const app = await getApp()
  return app.inject({ method: 'GET', url, headers: { host, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
}

/** Every module the entries load, followed as a browser does: Map(path -> status, 'not javascript' if not). */
async function moduleTree(entries, host) {
  const seen = new Map()
  const todo = [...entries]
  while (todo.length) {
    const url = todo.pop()
    if (seen.has(url)) continue
    const res = await get(url, host)
    const js = /javascript/.test(String(res.headers['content-type']))
    seen.set(url, res.statusCode === 200 && !js ? 'not javascript' : res.statusCode)
    if (res.statusCode !== 200 || !js) continue
    for (const spec of specsOf(res.body)) {
      assert.ok(/^\.{0,2}\//.test(spec), url + ' imports ' + spec + ', which a browser can\'t load without a bundler')
      todo.push(new URL(spec, 'http://x' + url).pathname)
    }
  }
  return seen
}
const broken = tree => [...tree].filter(([, status]) => status !== 200)

test('the menu screen player loads every file it imports', async () => {
  const page = await get('/', SCREENS)
  assert.equal(page.statusCode, 200)
  const entries = [...page.body.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(entries, ['/player.js'], 'the page\'s module')
  const tree = await moduleTree(entries, SCREENS)
  assert.deepEqual(broken(tree), [], 'every file the player loads is served')
  for (const f of ['/lib/screenLayout.js', '/lib/orderPricing.js', '/lib/pos/orderFlows.js', '/lib/pos/charges.js', '/lib/pos/ids.js', '/lib/tax.js', '/lib/qr.js']) {
    assert.ok(tree.has(f), f + ' is one of them')
  }
  // Nothing else of shared/ is served there.
  assert.equal((await get('/lib/pos/kitchen.js', SCREENS)).statusCode, 404)
  assert.equal((await get('/lib/../api/src/config/env.js', SCREENS)).statusCode, 404)
  // The page starts again by itself if the player never starts.
  assert.match(page.body, /window\.__screenRetry\(60000\)/)
  assert.match(page.body, /onerror="window\.__screenRetry/)
})

test('the player\'s service worker keeps exactly the files the player loads, and they are all there', async () => {
  const tree = await moduleTree(['/player.js'], SCREENS)
  const sw = await get('/sw.js', SCREENS)
  assert.equal(sw.statusCode, 200)
  assert.ok(!sw.body.includes('__PLAYER_VERSION__') && !sw.body.includes('__PLAYER_LIBS__'), 'both filled in')
  const listed = /\.\.\.'([^']*)'\.split\(','\)/.exec(sw.body)?.[1]
  assert.ok(listed, 'the list of shared files')
  const libs = listed.split(',').filter(Boolean).map(f => '/lib/' + f).sort()
  assert.deepEqual(libs, [...tree.keys()].filter(u => u.startsWith('/lib/')).sort(), 'the same files')
  // The rest of the offline copy (Cache.addAll fails as a whole on one missing file).
  for (const f of ['/', '/player.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']) {
    assert.ok(sw.body.includes("'" + f + "'"), f + ' is kept')
    assert.equal((await get(f, SCREENS)).statusCode, 200, f)
  }
})

test('the online ordering page loads every file it imports', async () => {
  const entries = [...new Set(specsOf(views('shared/ordering.eta')).filter(s => s.startsWith('/order-api/')))]
  assert.ok(entries.includes('/order-api/pricing.js') && entries.includes('/order-api/pos/orderFlows.js'), 'the page\'s modules: ' + entries.join(', '))
  const tree = await moduleTree(entries)
  assert.deepEqual(broken(tree), [], 'every file the page loads is served')
  assert.ok(tree.has('/order-api/pos/charges.js') && tree.has('/order-api/tax.js'), 'through pricing.js')
})

test('the loyalty card loads every file it imports', async () => {
  const entries = [...new Set([views('loyalty.eta'), views('blocks/loyalty_card.eta')].flatMap(specsOf).filter(s => s.startsWith('/loyalty-api/')))]
  assert.ok(entries.includes('/loyalty-api/app.js'), 'the card\'s module')
  const tree = await moduleTree(entries)
  assert.deepEqual(broken(tree), [], 'every file the card loads is served')
  assert.ok(tree.has('/loyalty-api/qr.js'))
})
