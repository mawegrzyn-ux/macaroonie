// The paths that find their tenant themselves (system mode, migration 176):
// public pages and APIs reached by an id, slug or token, devices, webhooks,
// MCP, access tokens, memberships, the platform pages and the background
// jobs. With RLS forced on every tenant table, a query here that forgot
// system mode sees nothing, so each of these must still work. Run as a
// role that isn't a superuser (superusers skip RLS): CI does.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B, PLATFORM } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { sql as appSql } from '../src/config/db.js'
import { env } from '../src/config/env.js'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { expireStaleOrders } from '../src/services/orderSvc.js'
import { announceDueReleases, backfillFirstReleases } from '../src/services/menuReleases.js'
import { cleanUpAi } from '../src/ai/erase.js'
import { pollAll } from '../src/services/gloriafoodSvc.js'

let ids, filled, owner, V, dish, superuser

/** A request with no login (internal header only, to stay out of the rate limit). */
async function pub(method, url, { body, headers = {} } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}

const day = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const host = sub => sub + '.' + env.PUBLIC_ROOT_DOMAIN

before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = menu.sections[0].items[1]   // the first is sold out today (fixtures)
  ;[{ superuser }] = await sql`SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`
})
after(closeApp)

test('RLS holds for the app\'s own role: the bare pool sees no tenant rows', t => {
  if (superuser) {
    if (process.env.CI) assert.fail('CI must run the API tests as a role that isn\'t a superuser (superusers skip RLS)')
    t.skip('connected as a superuser, which skips RLS')
    return
  }
  return (async () => {
    const [{ n }] = await appSql`SELECT count(*)::int AS n FROM venues`
    assert.equal(n, 0, 'a query outside withTenant / system mode saw venues')
    await assert.rejects(appSql`INSERT INTO venues (tenant_id, name, slug, timezone) VALUES (${ids.a}, 'x', 'x', 'Europe/London')`,
      /row-level security/, 'a write outside withTenant / system mode was allowed')
    const [{ m }] = await sql`SELECT count(*)::int AS m FROM venues WHERE tenant_id = ${ids.a}`
    assert.ok(m >= 2, 'system mode sees every tenant\'s rows')
  })()
})

test('booking widget: venue, slots, a booking, then the guest\'s manage page', async () => {
  const v = await pub('GET', `/widget-api/venues/${V}`)
  assert.equal(v.status, 200, v.body)
  const slots = await pub('GET', `/api/venues/${V}/slots?date=${day(3)}&covers=2`)
  assert.equal(slots.status, 200, slots.body)
  const book = await pub('POST', `/widget-api/venues/${V}/book`, { body: { date: day(3), time: '13:00', covers: 2, guest_name: 'Wid Get', guest_email: 'widget@zqx.test' } })
  assert.ok(book.status < 300, book.body)
  const [b] = await sql`SELECT manage_token FROM bookings WHERE tenant_id = ${ids.a} AND guest_email = 'widget@zqx.test'`
  assert.ok(b, 'booking made')
  const page = await pub('GET', '/manage/' + b.manage_token)
  assert.equal(page.status, 200)
  assert.match(page.body, /Wid Get|13:00/)
  const look = await pub('GET', '/widget-api/venues/lookup?slug=zqx-site')
  assert.equal(look.status, 200, look.body)
})

test('online ordering: menu, slots, an order and its status page', async () => {
  const menu = await pub('GET', `/order-api/venues/${V}`)
  assert.equal(menu.status, 200, menu.body)
  const s = await pub('GET', `/order-api/venues/${V}/slots?date=${day(1)}`)
  assert.equal(s.status, 200, s.body)
  const slot = (s.json.slots || []).find(x => x.available)
  assert.ok(slot, 'an open slot tomorrow')
  // The dish as the guest page gets it: its required choices, first option each.
  const find = node => !node || typeof node !== 'object' ? null
    : node.id === dish.id && Array.isArray(node.choices) ? node
    : Object.values(node).reduce((hit, v) => hit || find(v), null)
  const item = find(menu.json)
  assert.ok(item, 'the dish is on the ordering menu')
  const choices = Object.fromEntries(item.choices.filter(c => c.min > 0).map(c => [c.key, [c.options[0].id]]))
  const order = await pub('POST', `/order-api/venues/${V}/orders`, { body: {
    lines: [{ item_id: dish.id, qty: 1, choices }], when: slot.at, data_consent: true, payment_method: 'pay_at_venue',
    customer: { name: 'Or Der', email: 'order@zqx.test', phone: '07700900333' },
  } })
  assert.equal(order.status, 201, order.body)
  const st = await pub('GET', '/order-api/orders/' + order.json.token)
  assert.equal(st.status, 200, st.body)
})

test('the website: published home and location pages, the menu JSON and print, the staging password', async () => {
  await ok(owner.patch('/api/website/tenant-site', { is_published: true }))
  await ok(owner.post('/api/website/tenant-site/publish', {}))
  const home = await pub('GET', '/', { headers: { host: host('zqx-site') } })
  assert.equal(home.status, 200, home.body.slice(0, 200))
  const loc = await pub('GET', '/locations/zqx-ware', { headers: { host: host('zqx-site') } })
  assert.equal(loc.status, 200, loc.body.slice(0, 200))
  assert.match(loc.body, /Zqx Ware/)
  const json = await pub('GET', '/api/menus/public/' + filled.ids.menu)
  assert.equal(json.status, 200, json.body)
  const print = await pub('GET', `/api/menus/${filled.ids.menu}/print`)
  assert.equal(print.status, 200)
  const staging = await pub('GET', '/', { headers: { host: host('staging-zqx-site') } })
  assert.equal(staging.status, 401, 'the staging password is asked for')
})

test('a till linked by its code loads its config; its move hand-over code pairs it at the new address', async () => {
  const till = await linkDevice(owner, V, { kind: 'terminal', name: 'Till 2' })
  const auth = { authorization: `Device ${till.device_id}.${till.secret}` }
  const me = await pub('GET', '/pos-api/me', { headers: auth })
  assert.equal(me.status, 200, me.body)
  const config = await pub('GET', '/pos-api/config', { headers: auth })
  assert.equal(config.status, 200, config.body.slice(0, 200))
  // POST /pos-api/pair finds its device by the hand-over code alone (system mode).
  const move = await pub('POST', '/pos-api/move', { headers: auth, body: {} })
  assert.equal(move.status, 200, move.body)
  const pair = await pub('POST', '/pos-api/pair', { body: { code: move.json.code, app: 'terminal' } })
  assert.equal(pair.status, 200, pair.body)
  assert.equal(pair.json.device_id, till.device_id)
  assert.equal((await pub('GET', '/pos-api/me', { headers: { authorization: `Device ${pair.json.device_id}.${pair.json.secret}` } })).status, 200)
})

test('a menu screen pairs by code, is claimed, and loads its config', async () => {
  const p = await pub('POST', '/screen-api/pairings', { body: { device: { width: 1920, height: 1080 } } })
  assert.equal(p.status, 200, p.body)
  const c = await owner.post('/api/screens/screens/claim', { code: p.json.code, name: 'Board 1', venue_id: V })
  assert.ok(c.status < 300, c.body)
  const st = await pub('GET', '/screen-api/pairings/' + p.json.id, { headers: { authorization: 'Pairing ' + p.json.secret } })
  assert.equal(st.json?.status, 'paired', st.body)
  const config = await pub('GET', '/screen-api/config', { headers: { authorization: `Screen ${st.json.screen_id}.${p.json.secret}` } })
  assert.equal(config.status, 200, config.body.slice(0, 200))
})

test('a kiosk design\'s shared preview opens by its link alone (migration 187)', async () => {
  const design = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Shared look', settings: {} }))
  const share = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}/share`, { venue_id: V }))
  const token = new URL(share.url).searchParams.get('kiosk_share')
  const res = await pub('GET', '/pos-api/kiosk-share?token=' + token)
  assert.equal(res.status, 200, res.body.slice(0, 200))
  assert.equal(res.json.share.design, 'Shared look')
  assert.ok(res.json.items?.length || res.json.menus?.length, 'the venue\'s menu came along')
})

test('a kitchen screen shows its own code, is linked, and signs in (migration 184)', async () => {
  const p = await pub('POST', '/pos-api/pairings', { body: { app: 'kds', device: { width: 1280, height: 800 } } })
  assert.equal(p.status, 200, p.body)
  const look = await owner.post('/api/installer/lookup', { code: p.json.code })
  assert.equal(look.json?.status, 'waiting', look.body)
  const linked = await owner.post(`/api/pos/venues/${V}/link`, { code: p.json.code, name: 'Pass 2' })
  assert.equal(linked.status, 201, linked.body)
  const st = await pub('GET', '/pos-api/pairings/' + p.json.id, { headers: { authorization: 'Pairing ' + p.json.secret } })
  assert.equal(st.json?.status, 'paired', st.body)
  const config = await pub('GET', '/pos-api/config', { headers: { authorization: `Device ${st.json.device_id}.${p.json.secret}` } })
  assert.equal(config.status, 200, config.body.slice(0, 200))
})

test('MCP: the guest connector finds a restaurant; an access token opens the staff connector', async () => {
  const rpc = body => ({ body, headers: { accept: 'application/json, text/event-stream' } })
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }
  await pub('POST', '/mcp', rpc(init))
  const found = await pub('POST', '/mcp', rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find_restaurants', arguments: { query: 'Zqx' } } }))
  assert.equal(found.status, 200, found.body)
  assert.match(found.body, /Zqx Ware/)

  const made = await ok(owner.post('/api/ai/tokens', { name: 'Test token' }))
  const staff = await pub('POST', '/mcp/staff/thai-house', { ...rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    headers: { accept: 'application/json, text/event-stream', authorization: 'Bearer ' + made.token } })
  assert.equal(staff.status, 200, staff.body.slice(0, 200))
  assert.match(staff.body, /whos_working/)
})

test('website chat status, and memberships across tenants on /api/me', async () => {
  const st = await pub('GET', `/ai-api/tenants/${ids.a}/status`)
  assert.equal(st.status, 200, st.body)
  // Invited to B and not signed in there yet: matched by email.
  await sql`INSERT INTO users (tenant_id, email, role) VALUES (${ids.b}, ${A.owner + '@test.local'}, 'viewer')`
  const me = await ok(owner.get('/api/me'))
  const names = (me.available_tenants || []).map(t => t.name).sort()
  assert.deepEqual(names, ['Other Co', 'Thai House'])
})

test('a GloriaFood push reaches its venue by the address token', async () => {
  const token = 'tok_' + 'x'.repeat(30)
  await sql`INSERT INTO gloriafood_venue_links (tenant_id, venue_id, push_token) VALUES (${ids.a}, ${V}, ${token})
            ON CONFLICT (venue_id) DO UPDATE SET push_token = EXCLUDED.push_token`
  const res = await pub('POST', '/webhooks/gloriafood/' + token, { body: { count: 0, orders: [] } })
  assert.ok(res.status < 300, res.body)
  const unknown = await pub('POST', '/webhooks/gloriafood/' + 'y'.repeat(30), { body: { count: 0, orders: [] } })
  assert.equal(unknown.status, 404)
})

test('the feature request board is shared; platform pages see every tenant', async () => {
  const b = as(B.owner, ids.b)
  const list = await ok(b.get('/api/feature-requests'))
  const theirs = list.find(r => r.tenant_id === ids.a)
  assert.ok(theirs, 'B sees A\'s request')
  const vote = await ok(b.post(`/api/feature-requests/${theirs.id}/upvote`, {}))
  assert.equal(vote.upvoted, true)
  assert.equal(vote.upvotes, 1)

  const pa = as(PLATFORM, ids.a)
  const tenants = await ok(pa.get('/api/platform/tenants'))
  assert.ok((tenants.tenants || tenants).find(t => t.id === ids.a)?.venue_count >= 2, 'venue counts across tenants')
  const stats = await ok(pa.get(`/api/platform/tenants/${ids.a}/stats`))
  assert.ok(stats.stats.venues >= 2 && stats.stats.bookings >= 1, JSON.stringify(stats.stats))
  const ai = await ok(pa.get('/api/ai/platform/tenants'))
  assert.ok(ai.tenants.length >= 2)
  const all = await ok(pa.get('/api/issues?scope=all'))
  assert.ok(all.some(i => i.tenant_id === ids.a), 'every tenant\'s issues')
})

test('background jobs work across tenants', async () => {
  await sql`INSERT INTO booking_holds (tenant_id, venue_id, starts_at, ends_at, covers, guest_name, guest_email, expires_at)
            VALUES (${ids.a}, ${V}, now() + interval '2 days', now() + interval '2 days 90 minutes', 2, 'Old Hold', 'hold@zqx.test', now() - interval '1 minute')`
  await appSql`SELECT sweep_expired_holds()`
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM booking_holds WHERE guest_name = 'Old Hold'`
  assert.equal(n, 0, 'the sweep removes expired holds (as pg_cron runs it, with no tenant)')

  await sql`UPDATE orders SET status = 'pending_payment', created_at = now() - interval '2 hours' WHERE tenant_id = ${ids.a} AND guest_email = 'order@zqx.test'`
  await expireStaleOrders(null)
  const [o] = await sql`SELECT status FROM orders WHERE tenant_id = ${ids.a} AND guest_email = 'order@zqx.test'`
  assert.equal(o.status, 'expired')

  await sql`UPDATE menu_releases SET announced_at = NULL WHERE tenant_id = ${ids.a}`
  assert.ok(await announceDueReleases(null) >= 1, 'due releases are announced')
  await sql`UPDATE menus SET needs_first_release = true WHERE tenant_id = ${ids.b}`
  await backfillFirstReleases(null)
  const [{ left }] = await sql`SELECT count(*)::int AS left FROM menus WHERE needs_first_release`
  assert.equal(left, 0)
  await cleanUpAi(null)
  await pollAll(null)
})
