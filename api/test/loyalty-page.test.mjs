// The built-in Loyalty page (migration 214) and the Loyalty card block: the
// page is listed in Website, Pages & modals, lives at /loyalty, can't be
// deleted, unpublished, moved or made a modal; its title and blocks change
// and publish; /p/<slug> sends to /loyalty; the block (on that page or any
// other) hands its options to /loyalty-api/app.js and shows nothing while
// loyalty or its web app is off; another tenant can't change the page.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { env } from '../src/config/env.js'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

let ids, owner, page

async function pub(method, url, { body, headers = {} } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}
const site = { host: 'zqx-site.' + env.PUBLIC_ROOT_DOMAIN }
/** The JSON the block hands to mountLoyalty() on the page. */
function mountOptions(body) {
  const m = /mountLoyalty\(document\.getElementById\('mloy-[^']+'\), (\{.*?\})\)\n/.exec(body)
  return m ? JSON.parse(m[1]) : null
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  await ok(owner.patch('/api/website/tenant-site', { is_published: true }))
})
after(closeApp)

test('the Loyalty page is listed and keeps its address; only its title and blocks change', async () => {
  const pages = await ok(owner.get('/api/website/pages?venue_id=tenant'))
  page = pages.find(p => p.system_key === 'loyalty')
  assert.ok(page, 'seeded for the tenant')
  assert.equal(page.slug, 'loyalty')
  assert.equal(page.is_published, true)
  assert.equal(page.kind, 'page')
  assert.equal(page.blocks[0].type, 'loyalty_card')
  assert.ok(pages.some(p => p.system_key === 'order'), 'the ordering page is still there')

  const del = await owner.delete('/api/website/pages/' + page.id)
  assert.equal(del.status, 422)
  assert.match(del.json.error, /loyalty page can't be deleted/)
  const unpub = await owner.patch('/api/website/pages/' + page.id, { is_published: false })
  assert.equal(unpub.status, 422)
  assert.match(unpub.json.error, /always published/)
  const modal = await owner.patch('/api/website/pages/' + page.id, { kind: 'modal' })
  assert.equal(modal.status, 422)
  const moved = await ok(owner.patch('/api/website/pages/' + page.id, { slug: 'elsewhere', title: 'Rewards club' }))
  assert.equal(moved.slug, 'loyalty', 'the slug stays')
  assert.equal(moved.title, 'Rewards club')

  const blocks = [
    { id: 'hello', type: 'heading', data: { heading: 'Hello members' } },
    { id: 'card1', type: 'loyalty_card', data: { heading: 'Your card', intro: 'Sign in to see it.', show_history: false, show_wallet: false, container: 'wide' } },
  ]
  await ok(owner.patch('/api/website/pages/' + page.id, { blocks }))
  await ok(owner.post('/api/website/tenant-site/publish', {}))

  const res = await pub('GET', '/loyalty', { headers: site })
  assert.equal(res.status, 200, res.body.slice(0, 300))
  assert.match(res.body, /<title>Rewards club/)
  assert.match(res.body, /Hello members/)
  assert.match(res.body, /max-width:1100px/, 'the block is wide')
  const opts = mountOptions(res.body)
  assert.ok(opts, 'the block mounts the card')
  assert.equal(opts.slug, 'zqx-site')
  assert.equal(opts.title, 'Your card')
  assert.equal(opts.alwaysTitle, true)
  assert.equal(opts.intro, 'Sign in to see it.')
  assert.equal(opts.parts.history, false)
  assert.equal(opts.parts.wallet, false)
  assert.equal(opts.parts.settings, true)
  assert.match(res.body, /--mloy-card-bg:#/, 'the programme\'s card colour')

  const p = await pub('GET', '/p/loyalty', { headers: site })
  assert.equal(p.status, 302)
  assert.equal(p.headers.location, '/loyalty')
  const sitemap = await pub('GET', '/sitemap.xml', { headers: site })
  assert.doesNotMatch(sitemap.body, /\/loyalty</, 'members\' page left out of the sitemap')
  assert.match(sitemap.body, /\/order</)
})

test('the Loyalty card block on another page; nothing while the web app is off', async () => {
  const ts = await ok(owner.get('/api/website/tenant-site'))
  await ok(owner.patch('/api/website/tenant-site', { home_blocks: [{ id: 'home-card', type: 'loyalty_card', data: { card_bg: '#ffeeaa' } }, ...(ts.home_blocks || [])] }))
  await ok(owner.post('/api/website/tenant-site/publish', {}))
  const home = await pub('GET', '/', { headers: site })
  assert.match(home.body, /data-loyalty-card/)
  const opts = mountOptions(home.body)
  assert.equal(opts.title, '', 'blank heading: the programme\'s name, signed out only')
  assert.equal(opts.alwaysTitle, false)
  assert.match(home.body, /--mloy-card-bg:#ffeeaa;--mloy-card-text:#111111/, 'dark words on a light card')

  const prog = (await ok(owner.get('/api/loyalty/programme'))).programme
  await ok(owner.put('/api/loyalty/programme', { enabled: true, settings: { ...prog.settings, features: { ...prog.settings.features, web_app: false } } }))
  const off = await pub('GET', '/', { headers: site })
  assert.equal(off.status, 200)
  assert.doesNotMatch(off.body, /data-loyalty-card/, 'the block shows nothing')
  assert.equal((await pub('GET', '/loyalty', { headers: site })).status, 404)
  await ok(owner.put('/api/loyalty/programme', { enabled: true, settings: prog.settings }))
  assert.equal((await pub('GET', '/loyalty', { headers: site })).status, 200)
})

test('another tenant can\'t see or change the page', async () => {
  const other = as(B.owner, ids.b)
  const theirs = await ok(other.get('/api/website/pages?venue_id=tenant'))
  assert.ok(!theirs.some(p => p.id === page.id))
  const res = await other.patch('/api/website/pages/' + page.id, { title: 'Hijacked', blocks: [] })
  assert.equal(res.status, 404)
  const del = await other.delete('/api/website/pages/' + page.id)
  assert.equal(del.status, 404)
  const viewer = as(A.viewer, ids.a)
  assert.equal((await viewer.patch('/api/website/pages/' + page.id, { title: 'x' })).status, 403)
})
