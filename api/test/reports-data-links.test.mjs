// Data links and push (docs/REPORTS.md 15; migration 256): a report read by
// its own address and key (src/reports/dataLinks.js), and a schedule that
// posts its figures to a web address, signed (src/services/webPush.js). The
// key is shown once and only its hash kept; a link runs as the owner or
// admin who made it, checked at every call; people's details stay out unless
// an owner lets them in; calls an hour are counted; every call is a report
// run. Pushes go through a stand-in transport: nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const { as, sql, ok, closeApp, getApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { sweepSchedules } = await import('../src/reports/schedules.js')
const { pushHooks, isPrivateAddress, pushUrlProblem } = await import('../src/services/webPush.js')

let ids, filled, owner, admin, operator, viewer, other
const log = { info() {}, warn() {}, error() {} }

// A read without a login, as Google Sheets or Power BI would.
async function read(url, headers = {}) {
  const app = await getApp()
  forgetReportResults()
  const res = await app.inject({ method: 'GET', url, headers })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}
const pathOf = link => new URL(link.url).pathname
const bearer = key => ({ authorization: 'Bearer ' + key })

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
})
test.after(async () => { pushHooks.send = realSend; await closeApp() })
const realSend = pushHooks.send

test('a link is made by an owner or admin, its key shown once, and the report read by it as JSON or CSV', async () => {
  for (const who of [operator, viewer]) {
    const r = await who.post('/api/reports/starter:till_sales_by_day/data-links', { name: 'Sheet' })
    assert.equal(r.status, 403)
  }
  const made = await ok(admin.post('/api/reports/starter:till_sales_by_day/data-links', {
    name: 'Accountant sheet', params: { period: { relative: 'today' } },
  }), 'make')
  assert.match(made.key, /^mrd_/)
  assert.match(made.link.url, /\/api\/report-data\/[0-9a-f-]{36}$/)
  assert.equal(made.link.key_hint, made.key.slice(-4))
  const [row] = await sql`SELECT * FROM report_data_links WHERE id = ${made.link.id}`
  assert.ok(!JSON.stringify(row).includes(made.key), 'the key itself is never kept')
  // Listed, never with the key.
  const listed = await ok(admin.get('/api/reports/data-links?report=starter:till_sales_by_day'))
  assert.equal(listed.links.length, 1)
  assert.ok(!JSON.stringify(listed).includes(made.key))
  assert.equal((await other.get('/api/reports/data-links')).json.links.length, 0, 'another group sees none')
  assert.equal((await other.patch('/api/reports/data-links/' + made.link.id, { enabled: false })).status, 404)

  // Read by its key: a header, X-Report-Key, or ?key=.
  const j = await read(pathOf(made.link), bearer(made.key))
  assert.equal(j.status, 200, j.body)
  assert.equal(j.json.report.name, 'Sales by day')
  assert.ok(j.json.columns.some(c => /^Net sales/.test(c.heading)))
  assert.ok(j.json.rows.length > 0)
  assert.equal(j.json.next_cursor, null)
  assert.equal(j.headers['x-robots-tag'], 'noindex')
  assert.equal((await read(pathOf(made.link), { 'x-report-key': made.key })).status, 200)
  const csv = await read(pathOf(made.link) + '?format=csv&key=' + encodeURIComponent(made.key))
  assert.equal(csv.status, 200)
  assert.match(csv.headers['content-type'], /text\/csv/)
  assert.match(csv.body, /Net sales/)
  // The same figures again: 304.
  assert.equal((await read(pathOf(made.link), { ...bearer(made.key), 'if-none-match': j.headers.etag })).status, 304)

  assert.equal((await read(pathOf(made.link), bearer('mrd_wrong'))).status, 401)
  assert.equal((await read(pathOf(made.link))).status, 401)
  assert.equal((await read('/api/report-data/' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12), bearer(made.key))).status, 404)

  // Every call is a run, as the person who made the link.
  const runs = await sql`SELECT * FROM report_runs WHERE link_id = ${made.link.id}`
  assert.ok(runs.length >= 4)
  assert.ok(runs.every(r => r.kind === 'link' && r.user_sub === A.admin))
  assert.equal(runs.find(r => r.format === 'csv')?.params?.via, 'link')
  const after = (await sql`SELECT uses FROM report_data_links WHERE id = ${made.link.id}`)[0]
  assert.ok(after.uses >= 4)
})

test('open choices are set in the address, the rest stay fixed, and JSON comes in pages', async () => {
  const made = await ok(owner.post('/api/reports/starter:till_sales_by_dish/data-links', {
    name: 'Dishes', params: { period: { relative: 'today' } }, open_params: ['period', 'not_a_choice'],
  }))
  assert.deepEqual(made.link.open_params, ['period'])
  const base = pathOf(made.link)
  const all = await read(base, bearer(made.key))
  assert.equal(all.status, 200, all.body)
  assert.ok(all.json.rows.length >= 2, 'two dishes or more sold today')
  assert.equal((await read(base + '?period=last_n_days:30', bearer(made.key))).status, 200)
  assert.equal((await read(base + '?period=2026-01-01..2026-01-31', bearer(made.key))).status, 200)
  assert.equal((await read(base + '?period=whenever', bearer(made.key))).status, 400)
  const p1 = await read(base + '?limit=1', bearer(made.key))
  assert.equal(p1.json.rows.length, 1)
  assert.ok(p1.json.next_cursor)
  const p2 = await read(base + '?limit=1&cursor=' + p1.json.next_cursor, bearer(made.key))
  assert.equal(p2.status, 200)
  assert.notDeepEqual(p2.json.rows[0], p1.json.rows[0])
  assert.equal((await read(base + '?limit=1&cursor=nonsense', bearer(made.key))).status, 400)
})

test('calls an hour, off, run out, a new key and delete', async () => {
  const made = await ok(owner.post('/api/reports/starter:till_sales_by_day/data-links', { name: 'Two an hour', rate_per_hour: 2 }))
  const url = pathOf(made.link)
  assert.equal((await read(url, bearer(made.key))).status, 200)
  assert.equal((await read(url, bearer(made.key))).status, 200)
  const third = await read(url, bearer(made.key))
  assert.equal(third.status, 429)
  assert.ok(Number(third.headers['retry-after']) > 0)
  await sql`UPDATE report_data_links SET window_uses = 0, window_start = NULL WHERE id = ${made.link.id}`

  await ok(owner.patch('/api/reports/data-links/' + made.link.id, { enabled: false }))
  assert.equal((await read(url, bearer(made.key))).status, 410)
  await ok(owner.patch('/api/reports/data-links/' + made.link.id, { enabled: true, rate_per_hour: 60 }))
  assert.equal((await owner.patch('/api/reports/data-links/' + made.link.id, { expires_on: '2020-01-01' })).status, 422)
  await sql`UPDATE report_data_links SET expires_at = now() - interval '1 minute' WHERE id = ${made.link.id}`
  assert.equal((await read(url, bearer(made.key))).status, 410)
  await ok(owner.patch('/api/reports/data-links/' + made.link.id, { expires_on: null }))

  const fresh = await ok(owner.post('/api/reports/data-links/' + made.link.id + '/new-key'))
  assert.notEqual(fresh.key, made.key)
  assert.equal((await read(url, bearer(made.key))).status, 401)
  assert.equal((await read(url, bearer(fresh.key))).status, 200)
  await ok(owner.delete('/api/reports/data-links/' + made.link.id))
  assert.equal((await read(url, bearer(fresh.key))).status, 404)
})

test('people\'s details stay out unless an owner lets them in, and a link stops with the person who made it', async () => {
  const saved = await ok(owner.post('/api/reports', {
    name: 'Guests', spec: { subject: 'bookings.bookings', kind: 'list', rows: ['guest_name', 'covers'] },
  }))
  const onlyNames = await ok(owner.post('/api/reports', {
    name: 'Names', spec: { subject: 'bookings.bookings', kind: 'list', rows: ['guest_name'] },
  }))
  const plain = await ok(admin.post('/api/reports/' + saved.report.id + '/data-links', { name: 'No names' }))
  const r1 = await read(pathOf(plain.link), bearer(plain.key))
  assert.equal(r1.status, 200, r1.body)
  assert.ok(!r1.json.columns.some(c => c.heading === 'Guest name'), 'names left out')
  assert.equal(r1.json.columns.length, 1, 'the other column stays')
  const names = await ok(admin.post('/api/reports/' + onlyNames.report.id + '/data-links', { name: 'Only names' }))
  assert.equal((await read(pathOf(names.link), bearer(names.key))).status, 422)

  assert.equal((await admin.post('/api/reports/' + saved.report.id + '/data-links', { name: 'Names', personal: true })).status, 403)
  const withNames = await ok(owner.post('/api/reports/' + saved.report.id + '/data-links', { name: 'With names', personal: true }))
  const r2 = await read(pathOf(withNames.link), bearer(withNames.key))
  assert.ok(r2.json.columns.some(c => c.heading === 'Guest name'), 'an owner let names in')

  // The admin who made a link leaves: it stops.
  await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  try {
    assert.equal((await read(pathOf(plain.link), bearer(plain.key))).status, 403)
  } finally {
    await sql`UPDATE users SET is_active = true WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  }
})

test('a schedule posts its figures to a web address, signed with a secret shown once', async () => {
  const posts = []
  let answer = 200
  pushHooks.send = async (url, body, headers) => { posts.push({ url, body, headers }); return { status: answer } }
  try {
    const timing = { every: 'day', time: '23:58' }
    const params = { period: { relative: 'today' } }
    for (const bad of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://router.local/x']) {
      const r = await owner.post('/api/reports/starter:till_sales_by_day/schedules', { timing, params, recipients: [], push_url: bad })
      assert.equal(r.status, 422, bad)
    }
    // An operator can't, even with Manage... they have none: refused either way.
    assert.equal((await operator.post('/api/reports/starter:till_sales_by_day/schedules', { timing, params, recipients: [], push_url: 'https://hooks.example.com/x' })).status, 403)

    const made = await ok(owner.post('/api/reports/starter:till_sales_by_day/schedules', {
      timing, params, recipients: [], push_url: 'https://hooks.example.com/macaroonie',
    }), 'schedule')
    assert.match(made.push_secret, /^mps_/)
    assert.equal(made.schedule.push_url, 'https://hooks.example.com/macaroonie')
    const id = made.schedule.id
    const [row] = await sql`SELECT push_secret FROM report_schedules WHERE id = ${id}`
    assert.match(row.push_secret, /^v1:/, 'sealed')
    const view = await ok(owner.get('/api/reports/schedules/' + id))
    assert.ok(!JSON.stringify(view).includes(made.push_secret))

    await sql`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = ${id}`
    forgetReportResults()
    await sweepSchedules(log)
    assert.equal(posts.length, 1)
    const post = posts[0]
    const sig = post.headers['x-macaroonie-signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/)
    assert.ok(sig)
    assert.equal(sig[2], createHmac('sha256', made.push_secret).update(sig[1] + '.' + post.body).digest('hex'))
    const payload = JSON.parse(post.body)
    assert.equal(payload.schedule.id, id)
    assert.ok(payload.columns.some(c => /^Net sales/.test(c.heading)))
    const [run] = await sql`SELECT * FROM report_runs WHERE schedule_id = ${id}`
    assert.equal(run.kind, 'scheduled')
    assert.equal(run.format, 'json')
    assert.equal(run.error, null)
    assert.equal((await sql`SELECT last_status FROM report_schedules WHERE id = ${id}`)[0].last_status, 'sent')

    // A receiver that answers 500: worth trying again.
    answer = 500
    await sql`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = ${id}`
    forgetReportResults()
    await sweepSchedules(log)
    const s = (await sql`SELECT * FROM report_schedules WHERE id = ${id}`)[0]
    assert.equal(s.last_status, 'failed')
    assert.ok(s.retry_of, 'tried again later')

    // A new address makes a new secret; taking it off clears it.
    const changed = await ok(owner.patch('/api/reports/schedules/' + id, { push_url: 'https://hooks.example.com/other', recipients: [{ email: A.owner + '@test.local' }] }))
    assert.ok(changed.push_secret && changed.push_secret !== made.push_secret)
    await ok(owner.patch('/api/reports/schedules/' + id, { push_url: null }))
    assert.equal((await sql`SELECT push_secret FROM report_schedules WHERE id = ${id}`)[0].push_secret, null)
  } finally {
    pushHooks.send = realSend
  }
})

test('push addresses: private networks are refused', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip)
  assert.equal(pushUrlProblem('https://hooks.example.com/x'), null)
  assert.ok(pushUrlProblem('https://user:pass@hooks.example.com/x'))
  assert.ok(pushUrlProblem('ftp://hooks.example.com/x'))
  assert.ok(pushUrlProblem('not a url'))
})
