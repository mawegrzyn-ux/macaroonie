// The usage record (migration 270): pages opened and menu searches, sent in
// batches to POST /api/usage/events, each person's own in the report
// builder (usage.mine reads {me}), the group's with no person
// (usage.pages, usage.searches), kept 90 days.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { runner, rowsOf, totalsRow, refused } from './support/reports.mjs'
import { usagePath, cleanUpUsage } from '../src/services/usageRecord.js'
import { CATALOGUE, catalogueView } from '../src/reports/catalogue/index.js'

let ids
const UUID = '2f6c1d1e-5b7a-4c3e-9a51-0c8e8f2b9d10'

test.before(async () => { ids = await resetAndSeed() })
test.after(closeApp)

test('a page is kept by its path only: no query string, ids as :id', () => {
  assert.equal(usagePath('/rota?week=2026-10-19&venue=' + UUID), '/rota')
  assert.equal(usagePath('/reports/' + UUID + '#top'), '/reports/:id')
  assert.equal(usagePath('/new-location/42/'), '/new-location/:id')
  assert.equal(usagePath('/reports/starter:till_sales_by_day'), '/reports/starter:till_sales_by_day')
  assert.equal(usagePath('/x/abcDEF1234567890abcdef12'), '/x/:id', 'a long key')
  assert.equal(usagePath('https://evil.example/rota'), null)
  assert.equal(usagePath('//evil.example'), null)
  assert.equal(usagePath(42), null)
  assert.equal(usagePath('/' + 'a'.repeat(400)).length, 200)
})

test('a batch is kept for the person who sent it; empty and odd events are dropped, never refused', async () => {
  const r = await as(A.owner, ids.a).post('/api/usage/events', { events: [
    { kind: 'page', path: '/rota?week=2026-10-19' },
    { kind: 'page', path: '/food-safety', at: '1999-01-01T00:00:00Z' },
    { kind: 'search', query: '  change  staff pay ', results: 3, pepper: true, picked: 'pepper', path: '/rota/pay?x=1' },
    { kind: 'search', query: 'fridge', results: 0, pepper: false, picked: null, path: '/secret' },
    { kind: 'search', query: '   ' },
    { kind: 'nonsense', path: '/x' },
    { kind: 'page', path: 'not a path' },
  ] })
  assert.equal(r.status, 204)
  const rows = await sql`SELECT * FROM usage_events WHERE tenant_id = ${ids.a} ORDER BY kind, path NULLS LAST`
  assert.equal(rows.length, 4)
  assert.ok(rows.every(x => x.user_sub === A.owner))
  const [pageA, pageB, s1, s2] = rows
  assert.deepEqual([pageA.path, pageB.path], ['/food-safety', '/rota'])
  assert.ok(Date.now() - pageA.at.getTime() < 60_000, 'a date too far back is taken as now')
  assert.equal(s1.query, 'change staff pay')
  assert.equal(s1.path, '/rota/pay')
  assert.equal(s1.pepper, true)
  assert.equal(s2.path, null, 'nothing opened: no page kept')
  // Another person's batch, and the operator's.
  await ok(as(A.operator, ids.a).post('/api/usage/events', { events: [{ kind: 'page', path: '/bookings' }, { kind: 'search', query: 'Jan Smith booking', results: 1, picked: 'menu', path: '/bookings' }] }))
  await ok(as(B.owner, ids.b).post('/api/usage/events', { events: [{ kind: 'page', path: '/bookings' }] }))
})

test('the shape is checked: more than 50 events, or no list, is refused', async () => {
  const owner = as(A.owner, ids.a)
  assert.equal((await owner.post('/api/usage/events', { events: Array.from({ length: 51 }, () => ({ kind: 'page', path: '/' })) })).status, 400)
  assert.equal((await owner.post('/api/usage/events', { nope: 1 })).status, 400)
  assert.equal((await as(null, null).post('/api/usage/events', { events: [] })).status, 401)
})

test('my pages and searches: only ever the person running it, an owner included', async () => {
  const run = runner(ids.a)
  const spec = { subject: 'usage.mine', kind: 'list', rows: ['what', 'page', 'words', 'to_pepper', 'opened'] }
  const mine = rowsOf(await run(spec, {}, { userKey: A.operator }))
  assert.equal(mine.length, 2)
  assert.ok(mine.some(r => r.words === 'Jan Smith booking'))
  const owners = rowsOf(await run(spec, {}, { userKey: A.owner }))
  assert.equal(owners.length, 4)
  assert.ok(!owners.some(r => r.words === 'Jan Smith booking'), 'the owner never sees the operator\'s searches')
  assert.equal(rowsOf(await run(spec, {}, { userKey: '' })).length, 0, 'no person, no rows')
  // Through the API, as an admin (no Navigation by default: still their own).
  const admin = as(A.admin, ids.a)
  await ok(admin.post('/api/usage/events', { events: [{ kind: 'page', path: '/cash-recon' }] }))
  const res = await ok(admin.post('/api/reports/preview', { spec }))
  assert.equal(res.rows.length, 1)
  await sql`DELETE FROM usage_events WHERE user_sub = ${A.admin}`
})

test('the group\'s pages and searches carry no person and no words typed', async () => {
  for (const key of ['usage.pages', 'usage.searches']) {
    const s = CATALOGUE.subjects[key]
    const sqls = [...Object.values(s.fields), ...Object.values(s.measures)].map(x => x.sql || '').join(' ')
    assert.ok(!/user_sub|query/.test(sqls), key + ' reads no person and no words')
    assert.deepEqual(Object.keys(s.links), [], key + ' links to nothing (a person could be reached through it)')
    assert.equal(s.module, 'nav_designer')
  }
  const run = runner(ids.a)
  const pages = await run({ subject: 'usage.pages', kind: 'summary', rows: ['page'], values: [{ measure: 'opens' }] })
  const byPage = Object.fromEntries(rowsOf(pages).map(r => [r.page, r.opens]))
  assert.deepEqual(byPage, { '/bookings': 1, '/food-safety': 1, '/rota': 1 })
  const searches = totalsRow(await run({ subject: 'usage.searches', kind: 'summary', rows: ['to_pepper'], values: ['searches', 'handed', 'handed_share', 'no_match'].map(measure => ({ measure })) }))
  assert.equal(searches.searches, 3)
  assert.equal(searches.handed, 1)
  assert.ok(Math.abs(searches.handed_share - 1 / 3) < 1e-6)
  assert.equal(searches.no_match, 1)
})

test('the group\'s figures need View on Navigation; the person\'s own record needs nothing more', async () => {
  const view = catalogueView({ nav_designer: 'none' })
  assert.equal(view.subjects['usage.pages'].base, false)
  assert.equal(view.subjects['usage.mine'].base, true)
  const r = await refused(runner(ids.a)({ subject: 'usage.pages', kind: 'list', rows: ['page'] }, {}, { levels: { nav_designer: 'none' } }))
  assert.equal(r.status, 403)
})

test('{me} only goes in a subject\'s rule', async () => {
  const { subject, text } = await import('../src/reports/catalogue/define.js')
  const bad = subject({ key: 'zz.bad', label: 'Bad', from: 'usage_events', fields: { who: text({ sql: '{me}' }) } })
  assert.equal(bad.fields.who.sql, '{me}')
  // index.js refuses it when the catalogue is built (checked here through its own rule).
  const { templateRefs } = await import('../src/reports/catalogue/define.js')
  assert.deepEqual(templateRefs("{t}.user_sub = {me}"), ['t', 'me'])
})

test('a guest\'s erasure removes the menu searches that name them', async () => {
  const owner = as(A.owner, ids.a)
  const c = await ok(owner.post('/api/customers', { name: 'Jan Smith', email: 'jan@example.test', phone: '07700900999' }))
  const before = await sql`SELECT count(*)::int AS n FROM usage_events WHERE tenant_id = ${ids.a} AND query ILIKE '%smith%'`
  assert.equal(before[0].n, 1)
  await ok(owner.post(`/api/customers/${c.id}/anonymise`, {}))
  const after = await sql`SELECT count(*)::int AS n FROM usage_events WHERE tenant_id = ${ids.a} AND query ILIKE '%smith%'`
  assert.equal(after[0].n, 0)
})

test('the record is kept 90 days', async () => {
  await sql`UPDATE usage_events SET at = now() - interval '91 days' WHERE tenant_id = ${ids.b}`
  const { removed } = await cleanUpUsage()
  assert.equal(removed, 1)
  assert.equal((await sql`SELECT count(*)::int AS n FROM usage_events WHERE tenant_id = ${ids.a}`)[0].n, 5, 'six less the one erased')
})
