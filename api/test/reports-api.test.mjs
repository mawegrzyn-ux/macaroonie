// The report builder's routes (docs/REPORTS.md 17, 18): saving, opening,
// changing, sharing and deleting reports; running them and drilling into
// them as the person looking; previews; CSV and Excel files; stars and
// copies; the record of every run; every starter report on real data; and
// another group, which sees none of it.
//
// The sales are the two trading days of support/tillDays.mjs (see
// reports-engine.test.mjs for the checks).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import XLSX from 'xlsx'
import { as, ok, closeApp, sql, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { STARTERS } from '../src/reports/starters/index.js'
import { cleanUpReportRuns } from '../src/reports/access.js'
import { forgetReportResults } from '../src/reports/run.js'
import { rowId } from '../../shared/reports/spec.js'
import { grainOf } from '../../shared/reports/also.js'
import { mondayOf, addDays } from '../../shared/reports/period.js'
import { CATALOGUE } from '../src/reports/catalogue/index.js'

const BUILDER = 'a-builder', BUILDER2 = 'a-builder2', FLOOR = 'a-floor'
let ids, t, owner, operator, viewer, builder, builder2, floor, ownerB, builderRole, floorRole, today

const SALES_BY_SERVER = () => ({
  subject: 'till.checks',
  params: [{ key: 'period', type: 'period', default: { relative: 'today' } }, { key: 'venues', type: 'venues', default: 'all' }],
  rows: ['server.name'],
  values: [{ measure: 'checks' }, { measure: 'net_sales' }],
  filters: [
    { field: 'date', op: 'in_period', param: 'period' },
    { field: 'venue', op: 'in', param: 'venues' },
    { field: 'status', op: 'is', value: 'closed' },
  ],
  sort: [{ by: 'net_sales', dir: 'desc' }],
  drill: { down: ['order_type.name'], rows: ['number', 'net'] },
})

// A CSV as rows of cells (quotes, doubled quotes and line breaks inside quotes understood).
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}
const byKey = res => res.rows.map(r => Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]])))
const runs = () => sql`SELECT * FROM report_runs WHERE tenant_id = ${ids.a} ORDER BY created_at, id`
const pence = v => Math.round(Number(v) * 100)

before(async () => {
  ids = await resetAndSeed()
  // No saved reports from the fixtures: these tests count the ones they make.
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  today = { from: t.date, to: t.date }

  // People who build reports on till sales, and someone who only looks at bookings.
  builderRole = await ok(owner.post('/api/access/roles', {
    key: 'report_builder', label: 'Report builder', permissions: { reports: 'use', pos_reports: 'view', bookings: 'view' },
  }), 'builder role')
  floorRole = await ok(owner.post('/api/access/roles', {
    key: 'floor', label: 'Floor', permissions: { reports: 'view', bookings: 'view' },
  }), 'floor role')
  for (const [sub, role] of [[BUILDER, builderRole], [BUILDER2, builderRole], [FLOOR, floorRole]]) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
              VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${role.id})`
  }
  builder = as(BUILDER, ids.a)
  builder2 = as(BUILDER2, ids.a)
  floor = as(FLOOR, ids.a)
})
after(closeApp)

test('the catalogue and the list: what a role may report on, and the starters with whether they run', async () => {
  const cat = await ok(owner.get('/api/reports/catalogue'))
  assert.equal(cat.level, 'manage')
  assert.ok(cat.can_use && cat.can_manage)
  assert.ok(cat.areas.some(a => a.key === 'till'))
  const checks = cat.subjects['till.checks']
  assert.ok(checks.base && checks.measures.net_sales && checks.fields.date && checks.links.server)
  assert.ok(!JSON.stringify(cat).includes('pos_checks'), 'no table names reach the browser')
  assert.ok(!/"sql"|"from"|"where"/.test(JSON.stringify(checks)), 'no SQL reaches the browser')

  // Someone without Till reports can look a server's name up, not report on checks.
  const mine = await ok(floor.get('/api/reports/catalogue'))
  assert.equal(mine.level, 'view')
  assert.ok(!mine.can_use && !mine.can_manage)
  assert.equal(mine.subjects['till.checks'].base, false)
  assert.deepEqual(mine.subjects['till.checks'].measures, {})
  assert.equal(mine.subjects['bookings.bookings'].base, true)
  assert.ok(!mine.subjects['bookings.bookings'].links.customer, 'the customer link needs Customers')

  const list = await ok(owner.get('/api/reports'))
  assert.equal(list.starters.length, STARTERS.length)
  assert.ok(list.starters.length >= 26)
  assert.deepEqual(list.reports, [])
  const s = list.starters.find(x => x.id === 'starter:till_sales_by_day')
  assert.deepEqual(
    { kind: s.kind, name: s.name, subject: s.subject, area: s.area, report_kind: s.report_kind, view: s.view, runs: s.runs, needs: s.needs, can_edit: s.can_edit, can_share: s.can_share, starred: s.starred },
    { kind: 'starter', name: 'Sales by day', subject: 'till.checks', area: 'till', report_kind: 'summary', view: 'bar', runs: true, needs: null, can_edit: false, can_share: false, starred: false })
  assert.ok(list.starters.every(x => x.runs), 'an owner can run every starter')
  assert.ok(list.starters.every(x => !('spec' in x)), 'the list carries no definitions')

  const floorList = await ok(floor.get('/api/reports'))
  const till = floorList.starters.find(x => x.id === 'starter:till_sales_by_day')
  assert.deepEqual([till.runs, till.needs], [false, 'Till reports'])
  assert.equal(floorList.starters.find(x => x.id === 'starter:bookings_by_source').runs, true)

  // No Reports at all: nothing.
  for (const call of [viewer.get('/api/reports'), viewer.get('/api/reports/catalogue'), viewer.get('/api/reports/starter:till_sales_by_day'),
    viewer.post('/api/reports/starter:till_sales_by_day/run', {})]) {
    assert.equal((await call).status, 403)
  }
  assert.equal((await as(null, null).get('/api/reports')).status, 401)

  const one = await ok(owner.get('/api/reports/starter:till_sales_by_day'))
  assert.equal(one.report.spec.subject, 'till.checks')
  assert.equal(one.report.spec.params[0].type, 'period')
  for (const bad of ['starter:nope', 'nonsense', '00000000-0000-4000-8000-000000000000']) {
    assert.equal((await owner.get('/api/reports/' + bad)).status, 404, bad)
  }
})

test('saving: a definition is tidied and checked as the person saving it, and refused with its reasons', async () => {
  const saved = await builder.post('/api/reports', { name: '  Sales by server  ', description: 'Who sold what', spec: SALES_BY_SERVER(), tags: ['Weekly', 'weekly', 'Till'] })
  assert.equal(saved.status, 201, saved.body)
  const r = saved.json.report
  assert.equal(r.name, 'Sales by server')
  assert.equal(r.description, 'Who sold what')
  assert.deepEqual(r.tags, ['weekly', 'till'])
  assert.deepEqual(
    { kind: r.kind, subject: r.subject, area: r.area, mine: r.mine, shared: r.shared, is_starter: r.is_starter, can_edit: r.can_edit, can_delete: r.can_delete, can_share: r.can_share, runs: r.runs, owner_email: r.owner_email },
    { kind: 'saved', subject: 'till.checks', area: 'till', mine: true, shared: 'private', is_starter: false, can_edit: true, can_delete: true, can_share: false, runs: true, owner_email: BUILDER + '@test.local' })
  assert.equal(r.spec.version, 1)
  assert.equal(r.spec.kind, 'summary')
  assert.deepEqual(r.spec.rows, [{ field: 'server.name' }])
  const [row] = await sql`SELECT tenant_id, owner_sub, subject, jsonb_typeof(spec) AS spec_type FROM reports WHERE id = ${r.id}`
  assert.deepEqual({ ...row }, { tenant_id: ids.a, owner_sub: BUILDER, subject: 'till.checks', spec_type: 'object' })

  // What can't be saved, each with a sentence.
  const noValue = await builder.post('/api/reports', { name: 'Top dishes', spec: { subject: 'till.lines', kind: 'summary', rows: ['name'], limit: { top: 5 } } })
  assert.equal(noValue.status, 422)
  assert.deepEqual(noValue.json.problems, ['A top or bottom N needs a value to rank by'])
  assert.equal(noValue.json.error, noValue.json.problems[0])
  const unknown = await builder.post('/api/reports', { name: 'Nothing', spec: { subject: 'till.nothing', rows: ['name'] } })
  assert.equal(unknown.status, 422, unknown.body)
  const noField = await builder.post('/api/reports', { name: 'No field', spec: { subject: 'till.checks', rows: ['no_such_field'], values: [{ measure: 'checks' }] } })
  assert.equal(noField.status, 422, noField.body)
  assert.match(noField.json.error, /no_such_field/)
  // A subject the saver's role can't report on, and a filter on something it can't see.
  const online = await builder.post('/api/reports', { name: 'Online', spec: { subject: 'online.orders', rows: ['date'], values: [{ measure: 'orders' }] } })
  assert.equal(online.status, 403, online.body)
  const hidden = await builder.post('/api/reports', {
    name: 'By customer', spec: { subject: 'bookings.bookings', rows: ['date'], values: [{ measure: 'bookings' }], filters: [{ field: 'customer.name', op: 'contains', value: 'a' }] },
  })
  assert.equal(hidden.status, 403, hidden.body)
  assert.equal((await builder.post('/api/reports', { name: '', spec: SALES_BY_SERVER() })).status, 400)
  assert.equal((await builder.post('/api/reports', { name: 'x'.repeat(121), spec: SALES_BY_SERVER() })).status, 400)
  assert.equal((await builder.post('/api/reports', { name: 'No definition' })).status, 400)
  // View can't save.
  assert.equal((await operator.post('/api/reports', { name: 'Mine', spec: SALES_BY_SERVER() })).status, 403)
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${ids.a}`
  assert.equal(n, 1, 'nothing refused was saved')
})

test('who can open, change and delete a report: its owner, people it is shared with, and Manage', async () => {
  const mine = (await ok(builder.get('/api/reports'))).reports
  assert.equal(mine.length, 1)
  const id = mine[0].id
  assert.ok(!('spec' in mine[0]))

  // Private: the other builder and someone with View don't see it, by list or by id.
  for (const who of [builder2, operator, floor]) {
    assert.deepEqual((await ok(who.get('/api/reports'))).reports, [])
    assert.equal((await who.get('/api/reports/' + id)).status, 404)
    assert.equal((await who.post(`/api/reports/${id}/run`, {})).status, 404)
    assert.equal((await who.post(`/api/reports/${id}/star`)).status, 404)
  }
  assert.equal((await builder2.put('/api/reports/' + id, { name: 'Theirs' })).status, 404)
  assert.equal((await builder2.delete('/api/reports/' + id)).status, 404)
  assert.equal((await builder2.post(`/api/reports/${id}/copy`, {})).status, 404)
  assert.equal((await builder2.post(`/api/reports/${id}/export`, { format: 'csv' })).status, 404)

  // Manage sees every report in the group, and can change it.
  const all = (await ok(owner.get('/api/reports'))).reports
  assert.deepEqual(all.map(x => [x.id, x.mine, x.can_edit, x.can_share, x.owner_email]), [[id, false, true, true, BUILDER + '@test.local']])

  // Sharing is for Manage.
  assert.equal((await builder.patch(`/api/reports/${id}/sharing`, { shared: 'everyone' })).status, 403)
  const noRoles = await owner.patch(`/api/reports/${id}/sharing`, { shared: 'roles', role_ids: [] })
  assert.equal(noRoles.status, 422)
  assert.match(noRoles.json.error, /at least one role/)
  const [roleB] = await sql`SELECT id FROM tenant_roles WHERE tenant_id = ${ids.b} LIMIT 1`
  assert.equal((await owner.patch(`/api/reports/${id}/sharing`, { shared: 'roles', role_ids: [roleB.id] })).status, 400, 'another group\'s role')
  assert.equal((await owner.patch(`/api/reports/${id}/sharing`, { shared: 'anyone' })).status, 400)
  assert.equal((await owner.patch('/api/reports/starter:till_sales_by_day/sharing', { shared: 'everyone' })).status, 422)

  // Shared with the builders' role: the other builder runs it, and can't change it.
  const shared = await ok(owner.patch(`/api/reports/${id}/sharing`, { shared: 'roles', role_ids: [builderRole.id] }))
  assert.deepEqual([shared.report.shared, shared.report.shared_role_ids], ['roles', [builderRole.id]])
  const theirs = (await ok(builder2.get('/api/reports'))).reports
  assert.deepEqual(theirs.map(x => [x.id, x.mine, x.can_edit, x.can_delete, x.can_share]), [[id, false, false, false, false]])
  assert.equal((await builder2.post(`/api/reports/${id}/run`, { params: { period: today } })).status, 200)
  const no = await builder2.put('/api/reports/' + id, { name: 'Theirs' })
  assert.equal(no.status, 403)
  assert.match(no.json.error, /Only the person who made this report/)
  assert.equal((await builder2.delete('/api/reports/' + id)).status, 403)
  assert.deepEqual((await ok(floor.get('/api/reports'))).reports, [], 'another role still doesn\'t see it')
  assert.equal((await floor.get('/api/reports/' + id)).status, 404)

  // Everyone: the floor role sees it, but can't run a report on till sales.
  await ok(owner.patch(`/api/reports/${id}/sharing`, { shared: 'everyone' }))
  const [stored] = await sql`SELECT shared, shared_role_ids FROM reports WHERE id = ${id}`
  assert.deepEqual([stored.shared, stored.shared_role_ids], ['everyone', []], 'the roles go when it isn\'t shared by role')
  const seen = (await ok(floor.get('/api/reports'))).reports
  assert.deepEqual(seen.map(x => [x.id, x.runs, x.needs]), [[id, false, 'Till reports']])
  const refused = await floor.post(`/api/reports/${id}/run`, { params: { period: today } })
  assert.equal(refused.status, 403, refused.body)
  assert.ok(Array.isArray(refused.json.problems) && refused.json.problems.length === 1)

  // A starter for the team: open to everyone with Reports, however it is shared.
  const starter = await ok(owner.patch(`/api/reports/${id}/sharing`, { shared: 'private', is_starter: true }))
  assert.deepEqual([starter.report.shared, starter.report.is_starter], ['private', true])
  assert.equal((await ok(operator.get('/api/reports'))).reports.length, 1)
  // Listed, and opened: by id, run and starred.
  assert.equal((await ok(operator.get('/api/reports/' + id))).report.is_starter, true)
  assert.equal((await ok(operator.post(`/api/reports/${id}/run`, { params: { period: today } }))).rows.length, 2)
  assert.deepEqual(await ok(operator.post(`/api/reports/${id}/star`, {})), { starred: true })
  await ok(operator.delete(`/api/reports/${id}/star`))
  await ok(owner.patch(`/api/reports/${id}/sharing`, { is_starter: false }))
  assert.deepEqual((await ok(operator.get('/api/reports'))).reports, [])
  assert.equal((await operator.get('/api/reports/' + id)).status, 404)

  // Its owner changes it; what isn't sent stays.
  const edited = await ok(builder.put('/api/reports/' + id, { name: 'Sales by server, this week' }))
  assert.equal(edited.report.name, 'Sales by server, this week')
  assert.equal(edited.report.description, 'Who sold what')
  assert.deepEqual(edited.report.tags, ['weekly', 'till'])
  assert.deepEqual(edited.report.spec.rows, [{ field: 'server.name' }])
  const respec = await ok(builder.put('/api/reports/' + id, { description: null, tags: [], spec: { ...SALES_BY_SERVER(), rows: ['order_type.name'] } }))
  assert.equal(respec.report.description, null)
  assert.deepEqual(respec.report.tags, [])
  assert.deepEqual(respec.report.spec.rows, [{ field: 'order_type.name' }])
  const bad = await builder.put('/api/reports/' + id, { spec: { subject: 'till.checks', kind: 'summary', rows: ['server.name'], limit: { top: 3 } } })
  assert.equal(bad.status, 422)
  assert.deepEqual((await ok(builder.get('/api/reports/' + id))).report.spec.rows, [{ field: 'order_type.name' }], 'a refused change changes nothing')
  // Manage changes someone else's.
  await ok(owner.put('/api/reports/' + id, { name: 'Sales by server', spec: SALES_BY_SERVER() }))
  assert.equal((await owner.put('/api/reports/starter:till_sales_by_day', { name: 'Mine now' })).status, 422)
  assert.equal((await owner.delete('/api/reports/starter:till_sales_by_day')).status, 422)
})

test('running: as the person looking, with the report\'s choices; every run is recorded', async () => {
  const [{ id }] = (await ok(builder.get('/api/reports'))).reports
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  const res = await ok(builder.post(`/api/reports/${id}/run`, { params: { period: today } }))
  assert.deepEqual(res.report, { id, name: 'Sales by server' })
  assert.equal(res.kind, 'summary')
  // The server closed A, C, F and G; the manager B.
  assert.deepEqual(byKey(res), [
    { 'server.name': t.lead, checks: 4, net_sales: 58.8 },
    { 'server.name': t.boss, checks: 1, net_sales: 20 },
  ])
  assert.deepEqual(res.totals.cells, [null, 5, 78.8])
  assert.deepEqual([res.meta.period.from, res.meta.period.to, res.meta.currency, res.meta.row_count], [t.date, t.date, 'GBP', 2])

  // The period it was saved with is "today": no choices given runs the same.
  const plain = await ok(builder.post(`/api/reports/${id}/run`, {}))
  assert.deepEqual(plain.totals.cells, [null, 5, 78.8])
  // Another venue's sales only.
  const [other] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${t.V} ORDER BY created_at LIMIT 1`
  const elsewhere = await ok(builder.post(`/api/reports/${id}/run`, { params: { period: today, venues: [other.id] } }))
  assert.deepEqual(elsewhere.rows, [])
  // A choice the report doesn't ask for is ignored.
  const extra = await ok(builder.post(`/api/reports/${id}/run`, { params: { period: today, nonsense: 'x' } }))
  assert.deepEqual(extra.totals.cells, [null, 5, 78.8])

  const recorded = await runs()
  assert.equal(recorded.length, 4)
  const first = recorded[0]
  assert.deepEqual(
    { report_id: first.report_id, starter_key: first.starter_key, report_name: first.report_name, subject: first.subject, kind: first.kind, format: first.format, user_sub: first.user_sub, user_email: first.user_email, row_count: first.row_count, error: first.error },
    { report_id: id, starter_key: null, report_name: 'Sales by server', subject: 'till.checks', kind: 'run', format: null, user_sub: BUILDER, user_email: BUILDER + '@test.local', row_count: 2, error: null })
  assert.deepEqual(first.params, { params: { period: today, venues: 'all' } })
  assert.ok(first.ms >= 0)
  assert.deepEqual(recorded[2].params, { params: { period: today, venues: [other.id] } })
  const [{ last_run_at }] = await sql`SELECT last_run_at FROM reports WHERE id = ${id}`
  assert.ok(last_run_at && Date.now() - new Date(last_run_at).getTime() < 60000)

  // A choice typed for a run is used, and never copied into its record; a number is kept.
  const base = SALES_BY_SERVER()
  const asked = await ok(builder.post('/api/reports', {
    name: 'One server',
    spec: {
      ...base,
      params: [...base.params, { key: 'who', type: 'value', label: 'Server' }, { key: 'guests', type: 'value', label: 'Guests at least' }],
      filters: [...base.filters, { field: 'server.name', op: 'contains', param: 'who' }, { field: 'covers', op: 'gte', param: 'guests' }],
    },
  }))
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  const typed = t.lead.slice(0, 4)
  const one = await ok(builder.post(`/api/reports/${asked.report.id}/run`, { params: { period: today, who: typed, guests: 2 } }))
  // The server's checks with two guests or more: A (2), C (4), G (3).
  assert.deepEqual(byKey(one), [{ 'server.name': t.lead, checks: 3, net_sales: 58.8 }])
  const everyone = await ok(builder.post(`/api/reports/${asked.report.id}/run`, { params: { period: today } }))
  assert.equal(everyone.rows.length, 2, 'a choice left empty asks for nothing')
  const kept = await runs()
  assert.deepEqual(kept.map(r => r.params), [
    { params: { period: today, venues: 'all', who: { set: true }, guests: 2 } },
    { params: { period: today, venues: 'all', who: null, guests: null } },
  ])
  assert.ok(!JSON.stringify(kept).includes(typed))
  assert.equal((await builder.delete('/api/reports/' + asked.report.id)).status, 204)

  // A starter, and a run that is refused: both recorded.
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  const day = await ok(operator.post('/api/reports/starter:till_sales_by_day/run', { params: { period: today } }))
  assert.equal(day.rows.length, 1)
  const no = await floor.post('/api/reports/starter:till_sales_by_day/run', { params: { period: today } })
  assert.equal(no.status, 403)
  const two = await runs()
  assert.deepEqual(two.map(r => [r.report_id, r.starter_key, r.report_name, r.user_sub, r.row_count, !!r.error]), [
    [null, 'till_sales_by_day', 'Sales by day', A.operator, 1, false],
    [null, 'till_sales_by_day', 'Sales by day', FLOOR, null, true],
  ])
  assert.match(two[1].error, /role/i)
})

test('drilling: someone who may only run a report opens the rows behind a figure and its breakdowns', async () => {
  const day = 'starter:till_sales_by_day'
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  // The day, by server.
  const step1 = { at: [{ field: 'date', value: t.date }], to: { field: 'server.name' } }
  const servers = await ok(operator.post(`/api/reports/${day}/run`, { params: { period: today }, drill: [step1] }))
  assert.equal(servers.kind, 'summary')
  assert.deepEqual(servers.spec.rows, [{ field: 'server.name' }])
  assert.deepEqual(byKey(servers).map(r => [r['server.name'], r.checks, r.net_sales]).sort(), [[t.boss, 1, 20], [t.lead, 4, 58.8]].sort())
  assert.ok(!servers.spec.drill.down.some(d => d.field === 'server.name'), 'the level used is no longer offered')
  // Each result says what its own rows open into: the report's levels, less the ones on the way here.
  const whole = await ok(operator.post(`/api/reports/${day}/run`, { params: { period: today } }))
  assert.deepEqual(whole.meta.drill, {
    down: [
      { field: 'venue.name', label: 'Venue' }, { field: 'server.name', label: 'Server' },
      { field: 'order_type.name', label: 'Order type' }, { field: 'stream.name', label: 'Revenue stream' },
    ],
    rows: true, of: 'Checks',
  })
  assert.deepEqual(servers.meta.drill.down.map(d => d.field), ['venue.name', 'order_type.name', 'stream.name'])
  assert.equal(servers.meta.drill.rows, true)
  // The server's checks that day: A, C, F and G.
  const step2 = { at: [{ field: 'server.name', value: t.lead }], to: 'rows' }
  const rows = await ok(operator.post(`/api/reports/${day}/run`, { params: { period: today }, drill: [step1, step2] }))
  assert.equal(rows.kind, 'list')
  assert.deepEqual(rows.rows.map(r => r.id).sort(), [t.checks.a, t.checks.c, t.checks.f, t.checks.g].sort())
  assert.equal(rows.totals.count, 4)
  assert.equal(rows.meta.drill, null, 'a list is its own rows')

  // Only what the report offers.
  const off = await operator.post(`/api/reports/${day}/run`, { params: { period: today }, drill: [{ at: [], to: { field: 'tab_name' } }] })
  assert.equal(off.status, 422)
  assert.match(off.json.error, /can't be broken down by/)
  const notThere = await operator.post(`/api/reports/${day}/run`, { params: { period: today }, drill: [{ at: [{ field: 'tab_name', value: 'x' }], to: 'rows' }] })
  assert.equal(notThere.status, 422)
  assert.match(notThere.json.error, /isn't grouped by/)
  assert.equal((await operator.post(`/api/reports/${day}/run`, { drill: [{ to: 'nowhere' }] })).status, 422)
  assert.equal((await operator.post(`/api/reports/${day}/run`, { drill: Array.from({ length: 11 }, () => step1) })).status, 400)

  // The record says where a drill went, never the values it held.
  const recorded = (await runs()).filter(r => r.params.drill)
  assert.deepEqual(recorded[0].params.drill, [{ to: 'server.name', at: ['date'] }])
  assert.deepEqual(recorded[1].params.drill, [{ to: 'server.name', at: ['date'] }, { to: 'rows', at: ['server.name'] }])
  assert.ok(!JSON.stringify(recorded.map(r => r.params)).includes(t.lead))
})

test('drilling into one figure: its rows, in a file too, and the record says which figure', async () => {
  const tenders = 'starter:till_payments_by_tender'
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  const params = { period: today }
  // Payments beside refunds count different rows, so the result says a figure can be tapped for its own.
  const whole = await ok(operator.post(`/api/reports/${tenders}/run`, { params }))
  assert.equal(whole.meta.drill.per_figure, true)
  assert.equal((await ok(operator.post('/api/reports/starter:till_sales_by_day/run', { params }))).meta.drill.per_figure, undefined)
  const cash = byKey(whole).find(r => r.tender === 'cash')
  assert.deepEqual([cash.payments, cash.refunds], [3, 1])

  const at = [{ field: 'tender', value: 'cash' }]
  const refunds = await ok(operator.post(`/api/reports/${tenders}/run`, { params, drill: [{ at, to: 'rows', value: 'refunds' }] }))
  assert.equal(refunds.kind, 'list')
  assert.deepEqual(byKey(refunds).map(r => [r.kind, r.amount, r.reason]), [['refund', 3, 'Cold']])
  assert.deepEqual(refunds.meta.notes, ['Only the till payments that count towards Refunds are listed'])
  const payments = await ok(operator.post(`/api/reports/${tenders}/run`, { params, drill: [{ at, to: 'rows', value: 'payments' }] }))
  assert.deepEqual(byKey(payments).map(r => r.kind), ['payment', 'payment', 'payment'])
  // The row itself: every payment and refund in cash.
  const row = await ok(operator.post(`/api/reports/${tenders}/run`, { params, drill: [{ at, to: 'rows' }] }))
  assert.equal(row.rows.length, 4)
  assert.deepEqual(row.meta.notes, [])
  // A figure of a breakdown, two steps in: cash by who took it, then that person's refunds.
  const byStaff = { at, to: { field: 'staff.name' } }
  const deep = await ok(operator.post(`/api/reports/${tenders}/run`, { params, drill: [byStaff, { at: [{ field: 'staff.name', value: t.boss }], to: 'rows', value: 'refunds' }] }))
  assert.deepEqual(byKey(deep).map(r => [r.kind, r.amount]), [['refund', 3]])
  // What isn't a figure's name is dropped, not refused; a figure only counts for rows.
  const odd = await ok(operator.post(`/api/reports/${tenders}/run`, { params, drill: [{ at, to: 'rows', value: 'Not A Key' }] }))
  assert.equal(odd.rows.length, 4)
  const downWith = await ok(operator.post(`/api/reports/${tenders}/run`, { params, drill: [{ ...byStaff, value: 'refunds' }] }))
  assert.equal(downWith.kind, 'summary')

  // The record: where each drill went and which figure, never a value it held.
  const recorded = (await runs()).map(r => r.params.drill).filter(Boolean)
  assert.deepEqual(recorded, [
    [{ to: 'rows', at: ['tender'], value: 'refunds' }],
    [{ to: 'rows', at: ['tender'], value: 'payments' }],
    [{ to: 'rows', at: ['tender'] }],
    [{ to: 'staff.name', at: ['tender'] }, { to: 'rows', at: ['staff.name'], value: 'refunds' }],
    [{ to: 'rows', at: ['tender'] }],
    [{ to: 'staff.name', at: ['tender'] }],
  ])
  assert.ok(!JSON.stringify(recorded).includes('cash') && !JSON.stringify(recorded).includes(t.boss))

  // The same as a file (Use): the drilled list's rows, under the report's own name.
  const csv = await builder.post(`/api/reports/${tenders}/export`, { format: 'csv', params, drill: [{ at, to: 'rows', value: 'refunds' }] })
  assert.equal(csv.status, 200, csv.body)
  assert.match(csv.headers['content-disposition'], /filename="payments-by-tender-/)
  const lines = parseCsv(csv.body.slice(1))
  assert.deepEqual(lines[0], ['Trading day', 'Time', 'Check', 'Payment or refund', 'Tender', 'Amount (GBP)', 'Tip (GBP)', 'Taken by', 'Reason'])
  assert.equal(lines.length, 2)
  assert.deepEqual([lines[1][3], lines[1][4], lines[1][5], lines[1][8]], ['Refund', 'Cash', '3', 'Cold'])
  const xlsx = await getApp().then(a => a.inject({
    method: 'POST', url: `/api/reports/${tenders}/export`,
    headers: { authorization: 'Bearer test:' + BUILDER, 'x-tenant-id': ids.a, 'content-type': 'application/json' },
    payload: JSON.stringify({ format: 'xlsx', params, drill: [byStaff] }),
  }))
  assert.equal(xlsx.statusCode, 200)
  const book = XLSX.read(xlsx.rawPayload, { type: 'buffer' })
  const sheetRows = XLSX.utils.sheet_to_json(book.Sheets.Report, { header: 1 })
  assert.equal(sheetRows[0][0], 'Taken by', 'cash by who took it')
  assert.deepEqual(sheetRows.slice(1).map(r => r[0]).sort(), [t.boss, t.lead, 'Total'].sort())
  assert.equal((await operator.post(`/api/reports/${tenders}/export`, { format: 'csv', params, drill: [{ at, to: 'rows' }] })).status, 403, 'a file needs Use, drilled or not')
  const refused = await builder.post(`/api/reports/${tenders}/export`, { format: 'csv', params, drill: [{ at: [{ field: 'reason', value: 'x' }], to: 'rows' }] })
  assert.equal(refused.status, 422)
})

test('drilling where venues use two currencies: a row says its currency, though the report isn\'t grouped by it', async () => {
  const [other] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND id <> ${t.V} ORDER BY created_at LIMIT 1`
  await sql`UPDATE venues SET currency = 'EUR' WHERE id = ${other.id}`
  forgetReportResults()
  try {
    const day = 'starter:till_sales_by_day'
    const params = { period: today }
    const whole = await ok(operator.post(`/api/reports/${day}/run`, { params, fresh: true }))
    assert.equal(whole.meta.currency_column, 'venue.currency')
    assert.deepEqual(whole.rows.filter(r => r.kind === 'row').map(r => r.k), [['GBP', t.date]])
    const at = [{ field: 'venue.currency', value: 'GBP' }, { field: 'date', value: t.date }]
    const servers = await ok(operator.post(`/api/reports/${day}/run`, { params, drill: [{ at, to: { field: 'server.name' } }], fresh: true }))
    assert.deepEqual(byKey(servers).filter(r => r['server.name']).map(r => [r['venue.currency'], r['server.name'], r.checks]).sort(), [['GBP', t.boss, 1], ['GBP', t.lead, 4]].sort())
    // And from a row of that: the currency again, with the server.
    const rows = await ok(operator.post(`/api/reports/${day}/run`, {
      params, fresh: true,
      drill: [{ at, to: { field: 'server.name' } }, { at: [{ field: 'venue.currency', value: 'GBP' }, { field: 'server.name', value: t.boss }], to: 'rows' }],
    }))
    assert.deepEqual(rows.rows.map(r => r.id), [t.checks.b])
    const euros = await ok(operator.post(`/api/reports/${day}/run`, { params, drill: [{ at: [{ field: 'venue.currency', value: 'EUR' }], to: 'rows' }], fresh: true }))
    assert.equal(euros.rows.length, 0)
  } finally {
    await sql`UPDATE venues SET currency = 'GBP' WHERE id = ${other.id}`
    forgetReportResults()
  }
})

test('a preview runs a definition that isn\'t saved (Use), and isn\'t recorded', async () => {
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  const spec = { subject: 'till.lines', rows: ['name'], values: [{ measure: 'qty_sold' }, { measure: 'net_sales' }], sort: [{ by: 'net_sales', dir: 'desc' }] }
  const res = await ok(builder.post('/api/reports/preview', { spec }))
  assert.deepEqual(res.rows.map(r => r.cells), [[t.d1.name, 4, 46.8], [t.d2.name, 6, 24], [t.d3.name, 1, 8]])
  // A list, cut to the rows asked for, with how many there are.
  const list = await ok(builder.post('/api/reports/preview', { spec: { subject: 'till.lines', kind: 'list', rows: ['name', 'qty'] }, rows: 3 }))
  assert.equal(list.rows.length, 3)
  assert.ok(list.meta.truncated && list.meta.row_count > 3)
  assert.equal(list.totals.count, list.meta.row_count, 'the count is of every row, not the ones shown')
  // A drill of it, as the builder will offer.
  const drill = await ok(builder.post('/api/reports/preview', { spec: { ...spec, drill: { down: ['section.name'] } }, drill: [{ at: [{ field: 'name', value: t.d1.name }], to: { field: 'section.name' } }] }))
  assert.equal(drill.rows.length, 1)
  assert.equal(drill.rows[0].cells[1], 4)

  const bad = await builder.post('/api/reports/preview', { spec: { subject: 'till.lines', kind: 'summary', rows: ['name'], limit: { top: 5 } } })
  assert.equal(bad.status, 422)
  assert.equal((await builder.post('/api/reports/preview', {})).status, 400)
  assert.equal((await builder.post('/api/reports/preview', { spec: { subject: 'online.orders', values: [{ measure: 'orders' }] } })).status, 403, 'a subject the role can\'t report on')
  // View can't run a definition of its own.
  assert.equal((await operator.post('/api/reports/preview', { spec })).status, 403)
  assert.equal((await runs()).length, 0)
})

test('files: a CSV and an Excel workbook of a summary, a matrix and a list (Use)', async () => {
  const [{ id }] = (await ok(builder.get('/api/reports'))).reports
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`

  // A summary: its rows, then the total.
  const csv = await builder.post(`/api/reports/${id}/export`, { format: 'csv', params: { period: today } })
  assert.equal(csv.status, 200, csv.body)
  assert.match(csv.headers['content-type'], /^text\/csv; charset=utf-8/)
  assert.match(csv.headers['content-disposition'], /^attachment; filename="sales-by-server-\d{4}-\d{2}-\d{2}\.csv"$/)
  assert.equal(csv.body.charCodeAt(0), 0xFEFF, 'a byte order mark, so Excel reads it as UTF-8')
  assert.ok(csv.body.endsWith('\r\n') && !/[^\r]\n/.test(csv.body), 'CRLF line ends')
  assert.deepEqual(parseCsv(csv.body.slice(1)), [
    ['Server', 'Checks', 'Net sales (GBP)'],
    [t.lead, '4', '58.8'],
    [t.boss, '1', '20'],
    ['Total', '5', '78.8'],
  ])

  // A list goes out as it is read: every row, no totals row.
  const listSpec = { subject: 'till.checks', kind: 'list', rows: ['number', 'date', 'opened_at', 'status', 'covers', 'net', 'server.name'], sort: [{ by: 'number', dir: 'asc' }] }
  const list = await builder.post('/api/reports/export', { format: 'csv', name: 'Every check', spec: listSpec })
  assert.equal(list.status, 200, list.body)
  assert.match(list.headers['content-disposition'], /filename="every-check-/)
  const rows = parseCsv(list.body.slice(1))
  assert.deepEqual(rows[0], ['Check', 'Trading day', 'Opened', 'Status', 'Guests', 'Net (GBP)', 'Server'])
  assert.equal(rows.length, 1 + 7, 'the seven checks')
  assert.ok(rows.slice(1).every(r => r[1] === t.date && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r[2])), 'days and moments as ISO text')
  assert.deepEqual(rows.slice(1).map(r => r[3]).sort(), ['Void', 'Closed', 'Closed', 'Closed', 'Closed', 'Closed', 'Open'].sort(), 'a choice as its words')

  // A matrix: a column for each heading, the row totals, then the totals row.
  const matrix = await builder.post('/api/reports/export', {
    format: 'csv', spec: { subject: 'till.checks', kind: 'matrix', rows: ['server.name'], columns: ['order_type.name'], values: [{ measure: 'net_sales' }], filters: [{ field: 'status', op: 'is', value: 'closed' }] },
  })
  assert.equal(matrix.status, 200, matrix.body)
  assert.match(matrix.headers['content-disposition'], /filename="report-/)
  const m = parseCsv(matrix.body.slice(1))
  assert.deepEqual(m[0], ['Server', 'Eat in: Net sales (GBP)', 'Take out: Net sales (GBP)', 'Total: Net sales (GBP)'])
  assert.deepEqual(m.slice(1).sort(), [[t.lead, '58.8', '0', '58.8'], [t.boss, '', '20', '20'], ['Total', '58.8', '20', '78.8']].sort())

  // Excel: real numbers and dates, and what was run on its own sheet.
  const xlsx = await builder.request('POST', `/api/reports/${id}/export`, { format: 'xlsx', params: { period: today } })
  assert.equal(xlsx.status, 200)
  assert.match(xlsx.headers['content-type'], /spreadsheetml\.sheet/)
  assert.match(xlsx.headers['content-disposition'], /filename="sales-by-server-.*\.xlsx"$/)
  const raw = await getApp().then(a => a.inject({
    method: 'POST', url: `/api/reports/${id}/export`,
    headers: { authorization: 'Bearer test:' + BUILDER, 'x-tenant-id': ids.a, 'content-type': 'application/json' },
    payload: JSON.stringify({ format: 'xlsx', params: { period: today } }),
  }))
  const wb = XLSX.read(raw.rawPayload, { type: 'buffer', cellNF: true })
  assert.deepEqual(wb.SheetNames, ['Report', 'About'])
  const sheet = wb.Sheets.Report
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [
    ['Server', 'Checks', 'Net sales (GBP)'],
    [t.lead, 4, 58.8],
    [t.boss, 1, 20],
    ['Total', 5, 78.8],
  ])
  assert.deepEqual([sheet.B2.t, sheet.C2.t, sheet.C2.z], ['n', 'n', '#,##0.00'])
  const about = Object.fromEntries(XLSX.utils.sheet_to_json(wb.Sheets.About, { header: 1 }).map(r => [r[0], r[1]]))
  assert.equal(about.Report, 'Sales by server')
  assert.equal(about.Venues, 'All venues')
  assert.equal(about.By, BUILDER + '@test.local')
  assert.equal(about.Rows, 2)
  assert.equal(about['Money in'], 'GBP')
  assert.ok(about.Period)

  // A list in Excel: a day as a date, a moment as a date and time, a percentage as a percentage.
  const listX = await getApp().then(a => a.inject({
    method: 'POST', url: '/api/reports/export',
    headers: { authorization: 'Bearer test:' + BUILDER, 'x-tenant-id': ids.a, 'content-type': 'application/json' },
    payload: JSON.stringify({ format: 'xlsx', name: 'Checks', spec: { subject: 'till.checks', rows: ['date'], values: [{ measure: 'net_sales' }, { key: 'share', calc: 'net_sales / total(net_sales)', label: 'Share', format: 'percent' }], filters: [{ field: 'status', op: 'is', value: 'closed' }] } }),
  }))
  assert.equal(listX.statusCode, 200, listX.body)
  const s2 = XLSX.read(listX.rawPayload, { type: 'buffer', cellNF: true }).Sheets.Report
  assert.equal(s2.A2.t, 'n')
  assert.equal(s2.A2.z, 'dd/mm/yyyy')
  assert.equal(XLSX.SSF.format('yyyy-mm-dd', s2.A2.v), t.date, 'the day, whatever the server\'s time zone')
  assert.deepEqual([s2.C2.v, s2.C2.z, s2.C1.v], [1, '0.0%', 'Share (%)'])

  // Every file is recorded, with its format.
  const recorded = await runs()
  assert.deepEqual(recorded.map(r => [r.kind, r.format, r.report_id, r.report_name, r.row_count, r.error]), [
    ['export', 'csv', id, 'Sales by server', 2, null],
    ['export', 'csv', null, 'Every check', 7, null],
    ['export', 'csv', null, 'Report', 2, null],
    ['export', 'xlsx', id, 'Sales by server', 2, null],
    ['export', 'xlsx', id, 'Sales by server', 2, null],
    ['export', 'xlsx', null, 'Checks', 1, null],
  ])

  // Refusals: a file needs Use; a bad format; a definition that can't run.
  assert.equal((await operator.post('/api/reports/starter:till_sales_by_day/export', { format: 'csv' })).status, 403)
  assert.equal((await builder.post(`/api/reports/${id}/export`, { format: 'pdf' })).status, 400)
  const bad = await builder.post('/api/reports/export', { format: 'csv', spec: { subject: 'online.orders', kind: 'list', rows: ['number'] } })
  assert.equal(bad.status, 403, bad.body)
  assert.match(bad.headers['content-type'], /json/, 'a refusal is said, never sent as a file')
  assert.equal((await runs()).at(-1).error?.length > 0, true)

  // A cell that starts like a formula can't run in a spreadsheet.
  await sql`UPDATE pos_check_lines SET void_reason = '=HYPERLINK("http://x","y")' WHERE tenant_id = ${ids.a} AND void_reason = 'Dropped'`
  forgetReportResults()
  const voids = await builder.post('/api/reports/export', { format: 'csv', spec: { subject: 'till.voids', kind: 'list', rows: ['name', 'reason'] } })
  assert.equal(voids.status, 200, voids.body)
  assert.ok(voids.body.includes('"\'=HYPERLINK(""http://x"",""y"")"'), voids.body)
  await sql`UPDATE pos_check_lines SET void_reason = 'Dropped' WHERE tenant_id = ${ids.a} AND void_reason LIKE '=HYPERLINK%'`
  forgetReportResults()
})

test('a file keeps the words of "everything else" where the grouping is a number', async () => {
  const bySize = { subject: 'till.checks', rows: ['covers'], values: [{ measure: 'net_sales' }], filters: [{ field: 'status', op: 'is', value: 'closed' }], sort: [{ by: 'net_sales', dir: 'desc' }] }
  const sizes = await ok(builder.post('/api/reports/preview', { spec: bySize }))
  assert.ok(sizes.rows.length >= 2, 'more than one party size')
  const topSize = { ...bySize, limit: { top: 1, rest_as: 'Other party sizes' } }
  // On screen: the row says what it is.
  const shown = await ok(builder.post('/api/reports/preview', { spec: topSize }))
  assert.deepEqual(shown.rows.map(r => [r.kind, r.cells[0]]), [['row', sizes.rows[0].cells[0]], ['rest', 'Other party sizes']])
  // In a CSV.
  const rest = await builder.post('/api/reports/export', { format: 'csv', spec: topSize })
  assert.equal(rest.status, 200, rest.body)
  const rows = parseCsv(rest.body.slice(1))
  assert.deepEqual(rows.map(r => r[0]), ['Guests', String(sizes.rows[0].cells[0]), 'Other party sizes', 'Total'])
  assert.equal(pence(Number(rows[1][1]) + Number(rows[2][1])), 7880, 'the two rows are every closed check')
  // In Excel: the party size a number, the words as words.
  const book = await getApp().then(a => a.inject({
    method: 'POST', url: '/api/reports/export',
    headers: { authorization: 'Bearer test:' + BUILDER, 'x-tenant-id': ids.a, 'content-type': 'application/json' },
    payload: JSON.stringify({ format: 'xlsx', spec: topSize }),
  }))
  assert.equal(book.statusCode, 200, book.body)
  const sheet = XLSX.read(book.rawPayload, { type: 'buffer' }).Sheets.Report
  assert.deepEqual([sheet.A2.t, sheet.A3.t, sheet.A3.v, sheet.A4.v], ['n', 's', 'Other party sizes', 'Total'])
})

test('stars and copies', async () => {
  const [{ id }] = (await ok(builder.get('/api/reports'))).reports
  await ok(owner.patch(`/api/reports/${id}/sharing`, { shared: 'everyone' }))
  assert.deepEqual(await ok(operator.post(`/api/reports/${id}/star`)), { starred: true })
  assert.deepEqual(await ok(operator.post(`/api/reports/${id}/star`)), { starred: true }, 'twice is once')
  await ok(operator.post('/api/reports/starter:bookings_by_source/star'))
  const list = await ok(operator.get('/api/reports'))
  assert.equal(list.reports[0].starred, true)
  assert.deepEqual(list.starters.filter(s => s.starred).map(s => s.id), ['starter:bookings_by_source'])
  assert.equal((await ok(operator.get('/api/reports/' + id))).report.starred, true)
  assert.equal((await ok(operator.get('/api/reports/starter:bookings_by_source'))).report.starred, true)
  // A star is a person's own.
  assert.equal((await ok(builder.get('/api/reports'))).reports[0].starred, false)
  assert.deepEqual(await ok(operator.delete('/api/reports/starter:bookings_by_source/star')), { starred: false })
  assert.deepEqual((await ok(operator.get('/api/reports'))).starters.filter(s => s.starred), [])
  assert.equal((await operator.post('/api/reports/starter:nope/star')).status, 404)

  // A copy of a starter is the person's own, to change freely.
  const copy = await builder2.post('/api/reports/starter:till_sales_by_dish/copy', {})
  assert.equal(copy.status, 201, copy.body)
  const c = copy.json.report
  assert.deepEqual([c.name, c.mine, c.shared, c.is_starter, c.starter_key, c.can_edit, c.description.length > 0], ['Sales by dish', true, 'private', false, 'till_sales_by_dish', true, true])
  assert.equal(c.spec.limit.top, 50)
  await ok(builder2.put('/api/reports/' + c.id, { spec: { ...c.spec, limit: { top: 5 } } }))
  // A copy of someone else's shared report, with a name of its own.
  const second = await ok(builder2.post(`/api/reports/${id}/copy`, { name: 'My servers' }))
  assert.deepEqual([second.report.name, second.report.mine, second.report.shared, second.report.owner_email], ['My servers', true, 'private', BUILDER2 + '@test.local'])
  const plain = await ok(builder2.post(`/api/reports/${id}/copy`, {}))
  assert.equal(plain.report.name, 'Sales by server (copy)')
  assert.equal((await operator.post(`/api/reports/${id}/copy`, {})).status, 403, 'a copy needs Use')
  // A copy is checked as the person copying: the floor role's builder can't take a till report... (no Use there), and
  // someone with Use but no Online orders can't copy an online starter.
  assert.equal((await builder2.post('/api/reports/starter:online_refunds/copy', {})).status, 403)

  // Deleting: its stars go with it; the copies stay.
  assert.equal((await builder.delete('/api/reports/' + id)).status, 204)
  assert.equal((await sql`SELECT 1 FROM report_stars WHERE report_ref = ${id}`).length, 0)
  assert.equal((await builder.get('/api/reports/' + id)).status, 404)
  assert.equal((await ok(builder2.get('/api/reports'))).reports.length, 3)
  assert.equal((await operator.delete(`/api/reports/${id}/star`)).status, 200, 'a star on a report since deleted still comes off')
})

test('every starter report runs on real data, with its rows and each of its breakdowns', async () => {
  // A weekly subject beside a daily report lines up whole weeks (a single day
  // gets a note saying the weeks at its ends don't line up): those starters
  // run for the week holding today.
  const week = { from: mondayOf(t.date), to: addDays(mondayOf(t.date), 6) }
  const weekly = s => grainOf(CATALOGUE.subjects[s.spec.subject]) !== 'week'
    && (s.spec.also || []).some(a => grainOf(CATALOGUE.subjects[a.subject]) === 'week')
  for (const s of STARTERS) {
    const params = s.spec.params.some(p => p.type === 'period') ? { period: weekly(s) ? week : today } : {}
    const res = await owner.post(`/api/reports/${s.ref}/run`, { params })
    assert.equal(res.status, 200, s.key + ': ' + res.body)
    assert.equal(res.json.kind, s.spec.kind, s.key)
    assert.deepEqual(res.json.meta.notes.filter(n => !/^The (top|bottom) /.test(n)), [], s.key + ' runs whole')
    if (s.spec.kind === 'list') continue
    const rows = await owner.post(`/api/reports/${s.ref}/run`, { params, drill: [{ at: [], to: 'rows' }] })
    assert.equal(rows.status, 200, s.key + ' rows: ' + rows.body)
    assert.equal(rows.json.kind, 'list', s.key)
    for (const d of s.spec.drill?.down || []) {
      const down = await owner.post(`/api/reports/${s.ref}/run`, { params, drill: [{ at: [], to: d }] })
      assert.equal(down.status, 200, s.key + ' by ' + rowId(d) + ': ' + down.body)
    }
  }
})

test('the till starters add up to the till\'s own day figures', async () => {
  const f = [t.f1, t.f2]
  const sum = pick => f.reduce((n, x) => n + pick(x), 0)
  const starter = async key => {
    const res = await ok(owner.post(`/api/reports/starter:${key}/run`, { params: { period: today } }))
    return { res, rows: byKey(res), total: Object.fromEntries(res.columns.map((c, i) => [c.key, res.totals?.cells[i]])) }
  }

  const day = (await starter('till_sales_by_day')).rows[0]
  assert.equal(day.checks, sum(x => x.counts.closed))
  assert.equal(day.guests, sum(x => x.covers))
  assert.equal(pence(day.gross_sales), sum(x => x.sales.gross))
  assert.equal(pence(day.discounts), sum(x => x.sales.discounts))
  assert.equal(pence(day.net_sales), sum(x => x.sales.net))
  assert.equal(pence(day.charges), sum(x => x.sales.service_charge))
  assert.equal(pence(day.total_sales), sum(x => x.sales.total))
  assert.equal(pence(day.vat_total), sum(x => x.vat.reduce((n, v) => n + v.vat, 0)))

  const dishes = await starter('till_sales_by_dish')
  assert.equal(pence(dishes.total.net_sales), sum(x => x.sales.net))
  assert.equal(dishes.total.qty_sold, sum(x => x.items.reduce((n, i) => n + i.qty, 0)))
  assert.ok(Math.abs(dishes.rows.reduce((n, r) => n + r.share_net_sales, 0) - 1) < 1e-6, 'the shares add up to the whole')

  const tenders = await starter('till_payments_by_tender')
  assert.equal(pence(tenders.total.takings), sum(x => x.takings))
  assert.equal(pence(tenders.total.tips), sum(x => x.tips))
  assert.equal(pence(tenders.total.refunded), sum(x => x.refunds.amount))
  for (const r of tenders.rows) {
    const mine = f.flatMap(x => x.tenders).filter(x => x.tender === r.tender)
    assert.equal(pence(r.taken), mine.reduce((n, x) => n + x.amount, 0), r.tender)
  }

  const discounts = await starter('till_discounts')
  assert.equal(pence(discounts.total.amount_given), sum(x => x.sales.discounts))
  const voids = await starter('till_voids')
  assert.equal(voids.total.voids, sum(x => x.voids.count))
  assert.equal(pence(voids.total.value_voided), sum(x => x.voids.value))
  const cancelled = await starter('till_cancelled')
  assert.equal(cancelled.total.cancelled, sum(x => x.cancelled.count))
  const charges = await starter('till_charges')
  assert.equal(pence(charges.total.amount_charged), sum(x => x.sales.service_charge))
  const vat = await starter('till_vat_by_rate')
  assert.equal(pence(vat.total.vat_total), sum(x => x.vat.reduce((n, v) => n + v.vat, 0)))
  assert.deepEqual(vat.rows.map(r => Math.round(r.rate * 10000) / 100).sort((a, b) => b - a), [...new Set(f.flatMap(x => x.vat.map(v => v.rate)))].sort((a, b) => b - a), 'a rate is a fraction in a report: 0.2 for 20%')

  // Closed days against the cash counted: day 1, a pound short.
  const days = await starter('till_trading_days')
  assert.equal(days.rows.length, 1)
  assert.deepEqual([pence(days.rows[0].cash_expected), pence(days.rows[0].cash_counted), pence(days.rows[0].cash_difference)], [t.f1.cash_expected, t.f1.cash_expected - 100, -100])
})

test('another group sees none of it', async () => {
  const mine = (await ok(builder2.get('/api/reports'))).reports
  const id = mine[0].id
  await ok(owner.patch(`/api/reports/${id}/sharing`, { shared: 'everyone', is_starter: true }))
  assert.deepEqual((await ok(ownerB.get('/api/reports'))).reports, [])
  for (const call of [
    ownerB.get('/api/reports/' + id),
    ownerB.put('/api/reports/' + id, { name: 'Theirs' }),
    ownerB.delete('/api/reports/' + id),
    ownerB.patch(`/api/reports/${id}/sharing`, { shared: 'private' }),
    ownerB.post(`/api/reports/${id}/run`, {}),
    ownerB.post(`/api/reports/${id}/export`, { format: 'csv' }),
    ownerB.post(`/api/reports/${id}/copy`, {}),
    ownerB.post(`/api/reports/${id}/star`),
  ]) assert.equal((await call).status, 404)
  const [still] = await sql`SELECT name, shared FROM reports WHERE id = ${id}`
  assert.deepEqual([still.name !== 'Theirs', still.shared], [true, 'everyone'])

  // The same starter, their own data: nothing sold there, and never this group's.
  const theirs = await ok(ownerB.post('/api/reports/starter:till_sales_by_dish/run', { params: { period: today } }))
  assert.deepEqual(theirs.rows, [])
  // This group's venue can't be named: in a run, a preview, a file or a saved definition.
  const venues = { period: today, venues: [t.V] }
  const mineOnly = { ...SALES_BY_SERVER(), filters: [{ field: 'venue', op: 'in', value: [t.V] }] }
  const pinned = { ...SALES_BY_SERVER(), params: [{ key: 'period', type: 'period', default: { relative: 'today' } }, { key: 'venues', type: 'venues', default: [t.V] }] }
  // Venues a definition asks for without filtering by them are still its venues.
  const asked = type => ({
    ...SALES_BY_SERVER(),
    params: [{ key: 'period', type: 'period', default: { relative: 'today' } }, { key: 'places', type: 'venues', default: type }],
    filters: [{ field: 'date', op: 'in_period', param: 'period' }],
  })
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.b}`
  for (const call of [
    ownerB.post('/api/reports/starter:till_sales_by_day/run', { params: venues }),
    ownerB.post('/api/reports/starter:till_sales_by_day/export', { format: 'csv', params: venues }),
    ownerB.post('/api/reports/preview', { spec: SALES_BY_SERVER(), params: venues }),
    ownerB.post('/api/reports/preview', { spec: mineOnly }),
    ownerB.post('/api/reports/preview', { spec: { ...SALES_BY_SERVER(), filters: [{ any: [{ has: 'lines', where: [{ field: 'check.venue', op: 'is', value: t.V }] }] }] } }),
    ownerB.post('/api/reports/export', { format: 'xlsx', spec: mineOnly }),
    ownerB.post('/api/reports', { name: 'Theirs', spec: mineOnly }),
    ownerB.post('/api/reports', { name: 'Theirs', spec: pinned }),
    ownerB.post('/api/reports', { name: 'Theirs', spec: asked([t.V]) }),
    ownerB.post('/api/reports/preview', { spec: asked('all'), params: { places: [t.V] } }),
  ]) {
    const res = await call
    assert.equal(res.status, 404, res.body)
    assert.equal(res.json.error, 'Venue not found')
  }
  assert.equal((await sql`SELECT 1 FROM report_runs WHERE tenant_id = ${ids.b}`).length, 0, 'a refused venue isn\'t written into a run\'s record')
  assert.equal((await sql`SELECT 1 FROM reports WHERE tenant_id = ${ids.b}`).length, 0)
  // A venue that is nobody's passes, and matches nothing; the group's own venues work.
  const nobody = await ok(ownerB.post('/api/reports/starter:till_sales_by_day/run', { params: { period: today, venues: ['00000000-0000-4000-8000-000000000000'] } }))
  assert.deepEqual(nobody.rows, [])
  assert.equal((await owner.post('/api/reports/preview', { spec: mineOnly })).status, 200)
  assert.equal((await owner.post('/api/reports', { name: 'Ware only', spec: pinned })).status, 201)
  // Their own roles only.
  const saved = await ok(ownerB.post('/api/reports', { name: 'Ours', spec: SALES_BY_SERVER() }))
  assert.equal((await ownerB.patch(`/api/reports/${saved.report.id}/sharing`, { shared: 'roles', role_ids: [builderRole.id] })).status, 400)
  assert.deepEqual((await ok(owner.get('/api/reports'))).reports.filter(r => r.id === saved.report.id), [])
})

test('a person keeps at most 300 reports of their own', async () => {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${ids.a} AND owner_sub = ${BUILDER}`
  await sql`
    INSERT INTO reports (tenant_id, name, subject, spec, owner_sub, owner_email)
    SELECT ${ids.a}, 'Filler ' || g, 'till.checks', ${sql.json({ version: 1, kind: 'summary', subject: 'till.checks', values: [{ key: 'checks', measure: 'checks' }] })}, ${BUILDER}, ${BUILDER + '@test.local'}
      FROM generate_series(1, ${300 - n}) g`
  const full = await builder.post('/api/reports', { name: 'One too many', spec: SALES_BY_SERVER() })
  assert.equal(full.status, 422)
  assert.match(full.json.error, /You have 300 reports/)
  assert.equal((await builder.post('/api/reports/starter:till_sales_by_day/copy', {})).status, 422)
  // Someone else's count is their own; and the list still opens.
  assert.equal((await builder2.post('/api/reports/starter:till_sales_by_day/copy', {})).status, 201)
  assert.equal((await ok(builder.get('/api/reports'))).reports.length >= 300, true)
  // A filler report, saved before today's tidying, opens and runs as the definition it is now.
  const [filler] = await sql`SELECT id FROM reports WHERE tenant_id = ${ids.a} AND name = 'Filler 1'`
  const opened = await ok(builder.get('/api/reports/' + filler.id))
  assert.deepEqual(opened.report.spec.values.map(v => v.key), ['checks'])
  assert.deepEqual((await ok(builder.post(`/api/reports/${filler.id}/run`, {}))).rows.map(r => r.cells), [[5]], 'the closed checks')
  await sql`DELETE FROM reports WHERE tenant_id = ${ids.a} AND name LIKE 'Filler %'`
})

test('records of runs are kept 400 days', async () => {
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  await ok(owner.post('/api/reports/starter:till_sales_by_day/run', { params: { period: today } }))
  await ok(owner.post('/api/reports/starter:till_sales_by_day/run', { params: { period: today } }))
  const [old] = await runs()
  await sql`UPDATE report_runs SET created_at = now() - interval '401 days' WHERE id = ${old.id}`
  assert.deepEqual(await cleanUpReportRuns(), { removed: 1 })
  assert.equal((await runs()).length, 1)
  assert.deepEqual(await cleanUpReportRuns(), { removed: 0 })
})
