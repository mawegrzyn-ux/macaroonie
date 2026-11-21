// Report builder phase 5 (docs/REPORTS.md 15): a report as a dashboard
// widget (migration 257), and a schedule raising a task on Today
// (delivery.today, GET /api/reports/alerts, the Today feed's report_alerts).
// Email goes through a stand-in SendGrid: nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { sweepSchedules } = await import('../src/reports/schedules.js')
const { todayIn } = await import('../../shared/reports/period.js')

const realFetch = globalThis.fetch
const mails = []
const log = { info() {}, warn() {}, error() {} }
let ids, filled, owner, operator, viewer
const START = 'starter:till_sales_by_day'

const sweep = async () => { forgetReportResults(); return sweepSchedules(log) }
const dueNow = id => sql`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = ${id}`
const today = () => todayIn('Europe/London')

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      mails.push(JSON.parse(opts.body))
      return new Response('', { status: 202 })
    }
    return realFetch(url, opts)
  }
})
test.after(async () => { globalThis.fetch = realFetch; await closeApp() })
test.beforeEach(async () => {
  mails.length = 0
  if (ids) await sql`DELETE FROM report_schedules WHERE tenant_id = ${ids.a}`
})

test('a report goes on any dashboard as a widget, needing Reports to add it', async () => {
  const V = filled.ids.venue
  const d = await ok(owner.post('/api/custom-dashboards/dashboards', { venue_id: V, name: 'Reports board' }))
  const w = await ok(owner.post(`/api/custom-dashboards/dashboards/${d.id}/widgets`, { widget_type: 'report' }))
  const p = await ok(owner.patch(`/api/custom-dashboards/dashboards/${d.id}/widgets/${w.id}`, { settings: { report: START, chart_only: true } }))
  assert.equal(p.settings.report, START)
  const h = await ok(owner.post('/api/hs-dashboards/dashboards', { venue_id: V, name: 'H&S with a report' }))
  await ok(owner.post(`/api/hs-dashboards/dashboards/${h.id}/widgets`, { widget_type: 'report' }), 'on an H&S dashboard too')
  // A role that may change the dashboard but has no Reports: refused, with the module named.
  const roles = await ok(owner.get('/api/access/roles'))
  const op = (roles.roles || roles).find(r => r.key === 'operator')
  await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...op.permissions, reports: 'none', custom_dashboard: 'manage' } }))
  try {
    const refused = await operator.post(`/api/custom-dashboards/dashboards/${d.id}/widgets`, { widget_type: 'report' })
    assert.equal(refused.status, 403)
    assert.match(refused.json.error, /Reports/)
  } finally {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: op.permissions }))
  }
})

test('a schedule can raise a task on Today with nobody to email, and the feed shows it to people who can open the report', async () => {
  const V = filled.ids.venue
  // Today with no recipients saves (a push-like send to nobody).
  const res = await owner.post(`/api/reports/${START}/schedules`, {
    name: 'Sales check', timing: { every: 'day', time: '23:59' }, params: { period: { relative: 'today' } },
    delivery: { in_message: true, attach: 'none', today: true }, condition: { when: 'always' }, recipients: [],
  })
  assert.equal(res.status, 201, res.body)
  const sid = res.json.schedule.id
  assert.equal(res.json.schedule.delivery.today, true)
  assert.match(res.json.schedule.delivery_text, /task on Today/)
  // Without Today, nobody to email is still refused.
  const none = await owner.post(`/api/reports/${START}/schedules`, {
    timing: { every: 'day', time: '23:59' }, params: { period: { relative: 'today' } },
    delivery: { in_message: true, attach: 'none' }, condition: { when: 'always' }, recipients: [],
  })
  assert.equal(none.status, 422)

  await dueNow(sid)
  const out = await sweep()
  assert.equal(out.sent, 1)
  assert.equal(mails.length, 0, 'nobody emailed')
  const [run] = await sql`SELECT * FROM report_runs WHERE schedule_id = ${sid}`
  assert.equal(run.delivery.today, true)
  assert.equal(run.error, null)

  // The alert, for the venue's day, as the operator (Reports View).
  const a = await ok(operator.get(`/api/reports/alerts?venue_id=${V}&date=${today()}`))
  assert.equal(a.alerts.length, 1)
  assert.equal(a.alerts[0].name, 'Sales check')
  assert.equal(a.alerts[0].report.id, START)
  // Another day: nothing. The viewer: no Reports. Another group's venue: 404.
  assert.equal((await ok(operator.get(`/api/reports/alerts?venue_id=${V}&date=2020-01-01`))).alerts.length, 0)
  assert.equal((await viewer.get(`/api/reports/alerts?venue_id=${V}&date=${today()}`)).status, 403)
  const other = await as(B.owner, ids.b).get(`/api/reports/alerts?venue_id=${V}&date=${today()}`)
  assert.equal(other.status, 404)

  // On the Today feed as a task, opening the report.
  const feed = await ok(owner.get(`/api/ops/today?venue_id=${V}&date=${today()}`))
  const task = feed.tasks.find(t => t.kind === 'report_alert')
  assert.ok(task, 'a report alert on Today')
  assert.equal(task.title, 'Sales check')
  assert.equal(task.action.path, '/reports/' + encodeURIComponent(START))
  // The viewer's feed leaves the area out.
  const vfeed = await ok(viewer.get(`/api/ops/today?venue_id=${V}&date=${today()}`))
  assert.ok(!vfeed.tasks.some(t => t.kind === 'report_alert'))
  assert.ok((vfeed.not_included || []).includes('report_alerts'))
})

test('no task when the condition isn\'t met, or for a venue outside the report\'s venues', async () => {
  const [V, V2] = [filled.ids.venue, filled.ids.venue2]
  const s1 = await ok(owner.post(`/api/reports/${START}/schedules`, {
    name: 'Never', timing: { every: 'day', time: '23:59' }, params: { period: { relative: 'today' } },
    delivery: { in_message: true, attach: 'none', today: true },
    condition: { when: 'figure', value: 'net_sales', op: 'over', than: 1e9, scope: 'total' }, recipients: [],
  }))
  const s2 = await ok(owner.post(`/api/reports/${START}/schedules`, {
    name: 'Hertford only', timing: { every: 'day', time: '23:59' }, params: { period: { relative: 'today' }, venues: [V2] },
    delivery: { in_message: true, attach: 'none', today: true }, condition: { when: 'always' }, recipients: [],
  }))
  await dueNow(s1.schedule.id)
  await dueNow(s2.schedule.id)
  await sweep()
  const atWare = await ok(owner.get(`/api/reports/alerts?venue_id=${V}&date=${today()}`))
  assert.deepEqual(atWare.alerts.map(a => a.name), [])
  const atHertford = await ok(owner.get(`/api/reports/alerts?venue_id=${V2}&date=${today()}`))
  assert.deepEqual(atHertford.alerts.map(a => a.name), ['Hertford only'])
})

test('Email it now never raises a task on Today', async () => {
  const r = await ok(owner.post(`/api/reports/${START}/send`, {
    params: { period: { relative: 'today' } }, delivery: { in_message: true, attach: 'none', today: true },
    recipients: [{ email: A.owner + '@test.local' }], dry_run: true,
  }))
  assert.equal(r.send.delivery?.today ?? false, false)
})
