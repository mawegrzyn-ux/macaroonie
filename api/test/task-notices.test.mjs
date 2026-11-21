// Push notices for the Today tasks (migration 262, OUTSTANDING 44 item 13):
// each person's settings and devices, the rules (due soon, late, quiet
// hours, who can act), the sweep sending each notice once to the people who
// want it and can do it, a gone device removed, and the internal act-as
// sign-in refused from outside the process.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, getApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import {
  noticeKind, inQuietHours, wants, sweepNotices, pushSenders, DEFAULT_SETTINGS,
} from '../src/services/notices.js'
import { INTERNAL_AS_PREFIX } from '../src/middleware/auth.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
let ids, owner, viewer, other, V, sent
const sub = (n, extra = {}) => ({
  endpoint: 'https://push.example.invalid/' + n,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  ...extra,
})

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  // The fixtures' own device and settings: start clean for these tests.
  await sql`DELETE FROM push_devices WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM user_notify WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM task_notices WHERE tenant_id = ${ids.a}`
  sent = []
  pushSenders.web = async (token, payload) => {
    const t = JSON.parse(token)
    sent.push({ endpoint: t.endpoint, ...payload })
    return t.endpoint.endsWith('/gone') ? { ok: false, gone: true, error: 'Gone' } : { ok: true }
  }
  pushSenders.app = async (token, payload) => { sent.push({ app: token, ...payload }); return { ok: true } }
})
after(closeApp)

test('the rules: due soon within half an hour, late, quiet hours across midnight', () => {
  assert.equal(noticeKind({ group: 'now', due: '09:00' }, '08:40'), 'due_soon')
  assert.equal(noticeKind({ group: 'next', due: '09:00' }, '08:20'), null, 'more than half an hour ahead')
  assert.equal(noticeKind({ group: 'now', due: '09:00' }, '09:10'), null, 'past its time, not late yet')
  assert.equal(noticeKind({ group: 'late', due: '09:00' }, '10:00'), 'late')
  assert.equal(noticeKind({ group: 'late', due: null }, '10:00'), 'late', 'yesterday\'s cash-up')
  assert.equal(noticeKind({ group: 'now', due: null }, '10:00'), null)
  assert.equal(inQuietHours('23:30', '22:00', '07:00'), true)
  assert.equal(inQuietHours('06:59', '22:00', '07:00'), true)
  assert.equal(inQuietHours('07:00', '22:00', '07:00'), false)
  assert.equal(inQuietHours('13:00', '12:00', '14:00'), true)
  assert.equal(inQuietHours('13:00', null, null), false)
  const person = { settings: { ...DEFAULT_SETTINGS }, levels: { food_safety: 'use', cash_recon: 'view' } }
  const temps = { area: 'food_safety', kind: 'temps', key: 'temps:1' }
  assert.equal(wants(person, { venueId: V, task: temps, kind: 'late', time: '10:00' }), true)
  assert.equal(wants(person, { venueId: V, task: { area: 'cash', kind: 'cash_up' }, kind: 'late', time: '10:00' }), false, 'View can\'t do the cash-up')
  assert.equal(wants({ ...person, settings: { ...person.settings, areas: ['cash'] } }, { venueId: V, task: temps, kind: 'late', time: '10:00' }), false)
  assert.equal(wants({ ...person, settings: { ...person.settings, late: false } }, { venueId: V, task: temps, kind: 'late', time: '10:00' }), false)
  assert.equal(wants({ ...person, settings: { ...person.settings, venue_ids: ['00000000-0000-4000-8000-000000000000'] } }, { venueId: V, task: temps, kind: 'late', time: '10:00' }), false)
})

test('settings: defaults, a whole save, venues checked, quiet hours both ends', async () => {
  const first = await ok(owner.get('/api/notices/settings'))
  assert.deepEqual(first.settings, DEFAULT_SETTINGS)
  assert.deepEqual(first.devices, [])
  assert.ok(first.vapid_public_key?.length > 40, 'a VAPID key made on first use')
  assert.ok(first.areas.some(a => a.key === 'food_safety'))
  const body = { ...DEFAULT_SETTINGS, venue_ids: [V], areas: ['food_safety'], quiet_from: '23:00', quiet_to: '06:00' }
  const saved = await ok(owner.put('/api/notices/settings', body))
  assert.deepEqual(saved.settings, body)
  assert.equal((await owner.put('/api/notices/settings', { ...body, quiet_to: null })).status, 400)
  const foreign = await ok(other.post('/api/venues', { name: 'B Venue', slug: 'b-venue-notices', timezone: 'Europe/London' }))
  assert.equal((await owner.put('/api/notices/settings', { ...body, venue_ids: [foreign.id] })).status, 404, 'another group\'s venue')
  assert.equal((await ok(as(B.owner, ids.b).get('/api/notices/settings'))).settings.areas.length, 0, 'each group its own')
  await ok(owner.put('/api/notices/settings', { ...DEFAULT_SETTINGS }))
})

test('devices: a browser subscription or an app token, sealed; only your own can be removed', async () => {
  const web = await ok(owner.post('/api/notices/devices', { kind: 'web', token: sub('owner'), label: 'Laptop' }))
  assert.equal(web.kind, 'web')
  const [row] = await sql`SELECT token FROM push_devices WHERE id = ${web.id}`
  assert.match(row.token, /^v1:/, 'sealed')
  const again = await ok(owner.post('/api/notices/devices', { kind: 'web', token: sub('owner') }))
  assert.equal(again.id, web.id, 'the same browser once')
  assert.equal((await owner.post('/api/notices/devices', { kind: 'web', token: sub('x', { endpoint: 'http://insecure.invalid/x' }) })).status, 400)
  assert.equal((await owner.post('/api/notices/devices', { kind: 'app', token: 'not a token' })).status, 400)
  const app = await ok(owner.post('/api/notices/devices', { kind: 'app', token: 'ExponentPushToken[abcdefghijklmnop]' }))
  assert.equal((await viewer.delete('/api/notices/devices/' + app.id)).status, 404, 'not theirs')
  await ok(owner.delete('/api/notices/devices/' + app.id))
  const mine = await ok(owner.get('/api/notices/settings'))
  assert.deepEqual(mine.devices.map(d => d.id), [web.id])
  const t = await ok(owner.post('/api/notices/test', {}))
  assert.equal(t.sent, 1)
  assert.equal(sent.pop().title, 'Notices are working')
})

test('the sweep: due soon then late, each once, only to people who can do it and want it', async () => {
  // The viewer (food safety View) has a device too: no fridge checks for them.
  await ok(viewer.post('/api/notices/devices', { kind: 'web', token: sub('viewer') }))
  sent.length = 0
  const app = await getApp()
  // The fixtures' fridge check is at 09:00.
  await sweepNotices(app, quiet, { time: '08:45' })
  const soon = sent.filter(s => /Due at 09:00/.test(s.body))
  assert.ok(soon.length >= 1, 'a due-soon notice')
  assert.ok(soon.every(s => s.endpoint.endsWith('/owner')), 'only to the owner')
  assert.equal(soon[0].url, '/today')
  const before = sent.length
  await sweepNotices(app, quiet, { time: '08:50' })
  assert.equal(sent.filter(s => /Due at 09:00/.test(s.body)).length, soon.length, 'each once')
  assert.ok(sent.length >= before)
  await sweepNotices(app, quiet, { time: '10:45' })
  const late = sent.filter(s => /· Late/.test(s.body))
  assert.ok(late.length >= 1, 'a late notice')
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM task_notices WHERE tenant_id = ${ids.a}`
  assert.ok(n >= 2)
})

test('quiet hours and a gone device', async () => {
  await sql`DELETE FROM task_notices WHERE tenant_id = ${ids.a}`
  await ok(owner.put('/api/notices/settings', { ...DEFAULT_SETTINGS, quiet_from: '10:00', quiet_to: '11:00' }))
  sent.length = 0
  await sweepNotices(await getApp(), quiet, { time: '10:45' })
  assert.equal(sent.filter(s => s.endpoint?.endsWith('/owner')).length, 0, 'nothing in quiet hours')
  await ok(owner.put('/api/notices/settings', { ...DEFAULT_SETTINGS }))
  const gone = await ok(owner.post('/api/notices/devices', { kind: 'web', token: sub('gone') }))
  await sql`DELETE FROM task_notices WHERE tenant_id = ${ids.a}`
  await sweepNotices(await getApp(), quiet, { time: '10:45' })
  const [still] = await sql`SELECT id FROM push_devices WHERE id = ${gone.id}`
  assert.equal(still, undefined, 'a device the push service says is gone is removed')
})

test('the internal act-as sign-in only works inside the process', async () => {
  const [u] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.a} AND role = 'owner' LIMIT 1`
  const app = await getApp()
  const res = await app.inject({
    method: 'GET', url: '/api/venues',
    headers: { authorization: 'Bearer ' + INTERNAL_AS_PREFIX + u.id, 'x-tenant-id': ids.a },
  })
  assert.equal(res.statusCode, 401, 'no internal header: refused')
})
