// The page builder's live block previews (services/blockPreview.js): a
// signed link for a live-data block as the builder has it, rendered by the
// site (GET /_preview/block) with the draft site, framed only by the admin,
// without analytics or the site's banners; refused for other tenants'
// venues, changed or run-out links, other block kinds and, in production,
// any address but the site's own.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { env } from '../src/config/env.js'
import { makeLink } from '../src/services/previewLinks.js'
import { officeOrigin } from '../src/services/platformHost.js'

let ids, owner, viewer, other, W, W2, WB

const open = async (url, host) => {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: host ? { host } : {} })
  return { status: res.statusCode, headers: res.headers, body: res.body }
}
const preview = (who, block, extra = {}) => who.post('/api/website/block-preview', { block, ...extra })
const urlOf = async (who, block, extra) => (await ok(preview(who, block, extra), 'block preview')).url

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const fb = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  W = filled.ids.venue
  W2 = filled.ids.venue2
  WB = fb.ids.venue
})
after(closeApp)

test('a link renders the block from the draft site, framed only by the admin, without analytics or banners', async () => {
  // Draft changes nobody published: a colour, analytics, the cookie and
  // emergency banners.
  const site = await ok(owner.get('/api/website/tenant-site'))
  await ok(owner.patch('/api/website/tenant-site', {
    theme: { ...(site.theme || {}), colors: { ...(site.theme?.colors || {}), primary: '#123456' } },
    ga4_measurement_id: 'G-PREVIEWTEST', cookies_banner_enabled: true,
    banner_enabled: true, banner_text: 'Zqx closed on Monday',
  }))

  const url = await urlOf(owner, { id: 'b1', type: 'online_ordering', data: { heading: 'Zqx order here' } })
  assert.match(url, /^\/_preview\/block\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  const res = await open(url)
  assert.equal(res.status, 200, res.body.slice(0, 300))
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.match(res.headers['x-robots-tag'], /noindex/)
  assert.equal(res.headers['content-security-policy'], `frame-ancestors 'self' ${officeOrigin()}`)
  assert.equal(res.headers['x-frame-options'], undefined, 'no X-Frame-Options (CSP decides)')
  assert.match(res.body, /data-block-type="online_ordering"/)
  assert.match(res.body, /Zqx order here/)
  assert.match(res.body, /block-online-ordering/)
  assert.match(res.body, /#123456/, 'the draft theme')
  assert.match(res.body, /name="robots" content="noindex/)
  assert.doesNotMatch(res.body, /G-PREVIEWTEST/, 'no analytics')
  assert.doesNotMatch(res.body, /mc-cookie-banner/, 'no cookie banner')
  assert.doesNotMatch(res.body, /Zqx closed on Monday/, 'no emergency banner')
  assert.match(res.body, /mcrn:block-preview/, 'sends its height')

  // The live site keeps them.
  const live = await open('/', `staging-zqx-site.${env.PUBLIC_ROOT_DOMAIN}`)
  assert.notEqual(live.status, 200, 'staging has a password')

  // Unsaved changes: the block as the builder has it now.
  const again = await open(await urlOf(owner, { id: 'b1', type: 'online_ordering', data: { heading: 'Zqx changed' } }))
  assert.match(again.body, /Zqx changed/)
  assert.doesNotMatch(again.body, /Zqx order here/)

  // No Website access: refused. Website View: the builder is open to it, so
  // is the preview.
  assert.equal((await preview(viewer, { type: 'online_ordering', data: {} })).status, 403)
  const roles = await ok(owner.get('/api/access/roles'))
  const role = roles.find(r => r.key === 'viewer')
  await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { ...role.permissions, website: 'view' } }))
  assert.equal((await preview(viewer, { type: 'online_ordering', data: {} })).status, 200)
})

test('the page\'s location: its venue is the one the block uses', async () => {
  // Both locations take online orders: the block on a location's page shows
  // that location's ordering app, on the group's pages a location picker.
  await ok(owner.put('/api/orders/settings/' + W2, {
    is_enabled: true, hours: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, windows: [{ open: '11:00', close: '22:00' }] })),
    lead_time_mins: 15, slot_interval_mins: 15, max_orders_per_slot: 10, max_days_ahead: 2,
    min_order_pence: 0, payment_methods: ['pay_at_venue'],
  }))
  const at = async venueId => {
    const res = await open(await urlOf(owner, { id: 'b2', type: 'online_ordering', data: {} }, venueId ? { venue_id: venueId } : {}))
    assert.equal(res.status, 200)
    return res.body
  }
  assert.match(await at(W2), new RegExp('"view":"order","venueId":"' + W2 + '"'))
  assert.match(await at(W), new RegExp('"view":"order","venueId":"' + W + '"'))
  const pick = await at(null)
  assert.match(pick, /Choose where you'd like to collect from/)
  assert.match(pick, /href="\/locations\/zqx-ware\/order"/)
  assert.match(pick, /href="\/locations\/zqx-hertford\/order"/)
  assert.doesNotMatch(pick, /"venueId":/)
})

test('refusals: other kinds, too big, other tenants\' venues, changed, run-out or wrong links', async () => {
  assert.equal((await preview(owner, { type: 'text', data: { html: '<p>x</p>' } })).status, 400)
  assert.equal((await preview(owner, { type: 'online_ordering', data: { heading: 'x'.repeat(5000) } })).status, 422)
  assert.equal((await preview(other, { type: 'online_ordering', data: {} }, { venue_id: W })).status, 404)
  assert.equal((await preview(other, { type: 'online_ordering', data: { venue_id: W } })).status, 404)
  assert.equal((await preview(other, { type: 'reviews_band', data: { source: 'db', venue_id: W } })).status, 404)

  const url = await urlOf(owner, { id: 'b4', type: 'reviews_band', data: { source: 'db' } })
  const token = url.split('t=')[1]
  const [payload, sig] = token.split('.')
  const flip = c => (c === 'A' ? 'B' : 'A')
  assert.equal((await open('/_preview/block?t=' + payload + '.' + flip(sig[0]) + sig.slice(1))).status, 404)
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const forged = Buffer.from(JSON.stringify({ ...body, b: { ...body.b, data: { heading: 'forged' } } })).toString('base64url')
  assert.equal((await open('/_preview/block?t=' + forged + '.' + sig)).status, 404)
  assert.equal((await open('/_preview/block')).status, 404)
  assert.equal((await open('/_preview/block?t=nonsense')).status, 404)

  const signed = data => makeLink('block_preview', data, 1)
  const base = { t: ids.a, s: 'zqx-site', v: null, b: { id: 'x', type: 'online_ordering', data: {} } }
  assert.equal((await open('/_preview/block?t=' + await signed(base))).status, 200, 'a good one opens')
  assert.equal((await open('/_preview/block?t=' + await makeLink('kiosk', base, 1))).status, 404, 'another kind of link')
  assert.equal((await open('/_preview/block?t=' + await makeLink('block_preview', base, -1))).status, 404, 'run out')
  assert.equal((await open('/_preview/block?t=' + await signed({ ...base, b: { ...base.b, type: 'text' } }))).status, 404, 'a text block')
  assert.equal((await open('/_preview/block?t=' + await signed({ ...base, s: 'yyc-site' }))).status, 404, 'another tenant\'s site')

  // No web address yet: nothing to preview on.
  await sql`UPDATE tenant_site SET subdomain_slug = NULL WHERE tenant_id = ${ids.b}`
  try {
    const res = await preview(other, { type: 'online_ordering', data: {} })
    assert.equal(res.status, 422)
    assert.match(res.json.error, /address/)
  } finally {
    await sql`UPDATE tenant_site SET subdomain_slug = 'yyc-site' WHERE tenant_id = ${ids.b}`
  }
})

test('production: the link is on the site\'s own address and only opens there', async () => {
  const was = env.NODE_ENV
  env.NODE_ENV = 'production'
  try {
    const url = await urlOf(owner, { id: 'b5', type: 'online_ordering', data: {} })
    const origin = `${env.PUBLIC_SITE_SCHEME}://zqx-site.${env.PUBLIC_ROOT_DOMAIN}`
    assert.ok(url.startsWith(origin + '/_preview/block?t='), url)
    const path = url.slice(origin.length)
    assert.equal((await open(path, `zqx-site.${env.PUBLIC_ROOT_DOMAIN}`)).status, 200)
    assert.equal((await open(path, `yyc-site.${env.PUBLIC_ROOT_DOMAIN}`)).status, 404, 'another tenant\'s site')
    assert.equal((await open(path, `office.${env.PUBLIC_ROOT_DOMAIN}`)).status, 404, 'the admin\'s address')
    assert.notEqual((await open(path, `staging-zqx-site.${env.PUBLIC_ROOT_DOMAIN}`)).status, 200, 'staging')
  } finally {
    env.NODE_ENV = was
  }
})

test('loyalty card: signed out, or signed in as a sample member', async () => {
  const out = await open(await urlOf(owner, { id: 'b6', type: 'loyalty_card', data: {} }))
  assert.equal(out.status, 200)
  assert.match(out.body, /mountLoyalty\(/)
  assert.match(out.body, /"sample":false/)
  const sample = await open(await urlOf(owner, { id: 'b6', type: 'loyalty_card', data: {} }, { sample: true }))
  assert.match(sample.body, /"sample":true/)
})

test('reviews from the reviews list: the tenant\'s own approved ones, by venue when picked', async () => {
  await ok(owner.post('/api/reviews', { venue_id: W, platform: 'google', reviewer_name: 'Zqx Ann', rating: 5, review_text: 'Zqx lovely pad thai', is_approved: true }))
  await ok(owner.post('/api/reviews', { venue_id: W2, platform: 'google', reviewer_name: 'Zqx Ben', rating: 5, review_text: 'Zqx great in Hertford', is_approved: true }))
  await ok(owner.post('/api/reviews', { venue_id: W, platform: 'google', reviewer_name: 'Zqx Cat', rating: 5, review_text: 'Zqx not approved yet' }))
  await ok(other.post('/api/reviews', { venue_id: WB, platform: 'google', reviewer_name: 'Yyc Dan', rating: 5, review_text: 'Yyc other place', is_approved: true }))

  const all = await open(await urlOf(owner, { id: 'b7', type: 'reviews_band', data: { source: 'db' } }))
  assert.equal(all.status, 200)
  assert.match(all.body, /Zqx lovely pad thai/)
  assert.match(all.body, /Zqx great in Hertford/)
  assert.doesNotMatch(all.body, /not approved yet/)
  assert.doesNotMatch(all.body, /Yyc other place/)

  const ware = await open(await urlOf(owner, { id: 'b8', type: 'reviews_band', data: { source: 'db', venue_id: W } }))
  assert.match(ware.body, /Zqx lovely pad thai/)
  assert.doesNotMatch(ware.body, /Hertford/)
})
