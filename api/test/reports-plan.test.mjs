// POST /api/reports/plan (docs/REPORTS.md 10.8): a report written as a plan,
// with the catalogue's own paths, the way Pepper's report tools write one.
// A plan goes through the smart builder's own steps (no model call): it is
// made into a definition only through the builder's edits, checked and run
// as the person with their role, venues and names found in the group's own
// rows. What a plan names that isn't there comes back with the near ones. A
// plan applied to a saved report keeps what a plan can't say (filters made
// of several parts, averages of a calculation, drill-down settings) and the
// keys and order of what it keeps; every starter comes back unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, sql, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { catalogueView, CATALOGUE_MODULES } = await import('../src/reports/catalogue/index.js')
const { PLAN, planOf, planProblems, planSpec } = await import('../src/reports/plan.js')
const { STARTERS } = await import('../src/reports/starters/index.js')
const { normaliseReport } = await import('../../shared/reports/spec.js')

let ids, filled, owner, admin, operator, viewer, ownerB

const PLAN_URL = '/api/reports/plan'
const everything = catalogueView(Object.fromEntries([...CATALOGUE_MODULES, 'reports'].map(k => [k, 'manage'])))
const names = out => out.result.rows.filter(r => r.kind === 'row').map(r => r.k[0])
const usage = async () => (await sql`SELECT COALESCE(sum(requests), 0)::int AS n FROM ai_usage WHERE tenant_id = ${ids.a}`)[0].n

/** A saved report on checks with what a plan can't say: a filter of several parts, an average of a calculation, drill-down settings, its own keys. */
const keeper = () => normaliseReport({
  subject: 'till.checks',
  params: [
    { key: 'period', type: 'period', label: 'Period', default: { relative: 'today' } },
    { key: 'venues', type: 'venues', label: 'Venues', default: 'all' },
  ],
  rows: [{ field: 'server.name' }],
  values: [
    { key: 'sales', measure: 'net_sales' },
    { key: 'checks', measure: 'checks' },
    { key: 'charges', agg: 'sum', of: 'total - net', label: 'Charges again' },
    { key: 'per_check', calc: 'sales / checks', label: 'Per check', format: 'money' },
  ],
  filters: [
    { field: 'date', op: 'in_period', param: 'period' },
    { field: 'venue', op: 'in', param: 'venues' },
    { any: [{ field: 'covers', op: 'gt', value: 0 }, { field: 'net', op: 'gte', value: 0 }] },
  ],
  sort: [{ by: 'per_check', dir: 'desc' }],
  drill: { down: [{ field: 'date' }], rows: ['number', 'net'] },
  view: { kind: 'bar', y: ['sales'] },
})

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
})
test.after(async () => { await closeApp() })
test.beforeEach(() => { forgetReportResults() })

test('a plan is made into a report through the builder and run as the person, with no model call', async () => {
  const before = await usage()
  const res = await owner.post(PLAN_URL, {
    plan: {
      subject: 'till.checks',
      by: [{ field: 'server.name' }],
      figures: [{ figure: 'net_sales' }, { figure: 'checks' }, { calc: 'v1 / v2', label: 'Per check', format: 'money', decimals: 2 }],
      sort: [{ by: 'v1', dir: 'desc' }],
      period: { relative: 'today' },
      venues: ['Ware'],
      name: 'Sales by server today',
    },
  })
  assert.equal(res.status, 200, res.body)
  const out = res.json
  assert.equal(out.problem, null)
  assert.equal(out.unknown, null)
  assert.equal(out.spec.subject, 'till.checks')
  assert.deepEqual(out.spec.rows, [{ field: 'server.name' }])
  assert.deepEqual(out.spec.values.slice(0, 2), [{ key: 'net_sales', measure: 'net_sales' }, { key: 'checks', measure: 'checks' }])
  const calc = out.spec.values[2]
  assert.equal(calc.calc, 'net_sales / checks', 'v1 and v2 read as the figures\' keys')
  assert.deepEqual([calc.label, calc.format, calc.decimals], ['Per check', 'money', 2])
  assert.deepEqual(out.spec.sort, [{ by: 'net_sales', dir: 'desc' }])
  assert.deepEqual(out.spec.params.find(p => p.key === 'period').default, { relative: 'today' })
  assert.deepEqual(out.spec.params.find(p => p.key === 'venues').default, [filled.ids.venue], '"Ware" found among the group\'s venues')
  assert.equal(out.name, 'Sales by server today')
  assert.match(out.about, /by server, for today/)
  assert.deepEqual([out.assumed, out.couldnt, out.questions], [[], [], []])
  assert.equal(out.result.kind, 'summary')
  assert.ok(names(out).includes('Zqx Jo Bloggs'), 'the till\'s own sales, run as the owner: ' + names(out).join(', '))
  assert.equal(await usage(), before, 'no model call, nothing counted')
  const [runs] = await sql`SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = ${ids.a}`
  assert.equal(runs.n, 0, 'nothing recorded: like the builder\'s preview')

  // An admin may too; the rows asked for are a cap.
  const capped = await admin.post(PLAN_URL, { plan: { subject: 'till.lines', list: true, by: [{ field: 'name' }, { field: 'qty' }], period: { relative: 'today' } }, rows: 2 })
  assert.equal(capped.status, 200, capped.body)
  assert.equal(capped.json.spec.kind, 'list')
  assert.equal(capped.json.result.rows.length, 2, 'two rows of a list')
})

test('totals, figures worked out but not shown, decimals and the table under a chart', async () => {
  const res = await owner.post(PLAN_URL, {
    plan: {
      subject: 'till.checks',
      by: [{ field: 'venue' }, { field: 'server.name' }],
      figures: [{ figure: 'net_sales', decimals: 0 }, { figure: 'checks', hidden: true }, { calc: 'v1 / v2', label: 'Per check', format: 'money' }],
      totals: { grand: false, subtotals: ['venue'] },
      chart: { kind: 'bar', y: ['v1'], table_below: false },
      period: { relative: 'today' },
    },
  })
  assert.equal(res.status, 200, res.body)
  const { spec } = res.json
  assert.deepEqual(spec.rows, [{ field: 'venue.name' }, { field: 'server.name' }], 'a thing grouped by its name')
  assert.deepEqual(spec.totals, { grand: false, subtotals: ['venue.name'] }, 'the subtotal follows the grouping by its path')
  assert.equal(spec.values[0].decimals, 0)
  assert.equal(spec.values[1].hidden, true)
  assert.deepEqual(spec.view, { kind: 'bar', y: ['net_sales'], table_below: false })
  assert.equal(res.json.problem, null)
})

test('a period of every day: a dated report with no period, said back as every day; a period named wins', async () => {
  const res = await owner.post(PLAN_URL, { plan: { subject: 'till.checks', figures: [{ figure: 'checks' }], period: { any: true } } })
  assert.equal(res.status, 200, res.body)
  const { spec } = res.json
  assert.ok(!spec.params.some(p => p.type === 'period'), 'no period choice')
  assert.ok(!spec.filters.some(f => f.op === 'in_period'), 'no period filter')
  assert.ok(!res.json.assumed.some(a => /last week/.test(a)), 'not taken as last week')
  assert.equal(res.json.problem, null)
  assert.ok(res.json.result, 'it runs')
  assert.deepEqual(planOf(everything, spec, [], 'Checks').plan.period, { any: true })

  const named = await owner.post(PLAN_URL, { plan: { subject: 'till.checks', figures: [{ figure: 'checks' }], period: { relative: 'today', any: true } } })
  assert.equal(named.status, 200, named.body)
  assert.deepEqual(named.json.spec.params.find(p => p.key === 'period').default, { relative: 'today' })

  // Left out, the period is last week, as before.
  const plain = await owner.post(PLAN_URL, { plan: { subject: 'till.checks', figures: [{ figure: 'checks' }] } })
  assert.deepEqual(plain.json.spec.params.find(p => p.key === 'period').default, { relative: 'last_week' })
  assert.deepEqual(planOf(everything, plain.json.spec, [], 'Checks').plan.period, { relative: 'last_week' })
})

test('what a plan names that isn\'t there comes back with the near ones, and nothing runs', async () => {
  const bad = await owner.post(PLAN_URL, { plan: { subject: 'dishes sold', figures: [{ count: true }] } })
  assert.equal(bad.status, 200, bad.body)
  assert.match(bad.json.problem, /"dishes sold" isn't a subject this role can build reports on/)
  assert.ok(bad.json.unknown.subjects.some(s => s.subject === 'till.lines' && s.label === 'Dishes sold'), JSON.stringify(bad.json.unknown))
  assert.equal(bad.json.spec, null)
  assert.equal(bad.json.result, null)

  const paths = await owner.post(PLAN_URL, {
    plan: { subject: 'till.lines', by: [{ field: 'dish_name' }], figures: [{ figure: 'sales' }, {}], sort: [{ by: 'v7' }] },
  })
  assert.equal(paths.status, 200, paths.body)
  const { problem, unknown } = paths.json
  assert.match(problem, /have nothing called "dish_name", "sales"/)
  assert.match(problem, /no figure v7 \(figures are v1 to v2/)
  assert.match(problem, /figure v2 says nothing/)
  const near = p => unknown.paths.find(x => x.path === p).near
  assert.ok(near('dish_name').includes('name'), JSON.stringify(unknown))
  assert.ok(near('sales').includes('net_sales'), JSON.stringify(unknown))
  assert.deepEqual(unknown.names, ['v7'])
  assert.equal(paths.json.result, null)

  // A plan the shape refuses.
  for (const body of [
    { plan: { figures: [{ count: true }] } },
    { plan: { subject: 'till.lines', filters: [{ field: 'name', op: 'resembles', values: ['x'] }] } },
    { plan: { subject: 'till.lines', top: { which: 'top', n: 0 } } },
    { plan: { subject: 'till.lines' }, rows: 0 },
    { plan: { subject: 'till.lines' }, rows: 500 },
  ]) assert.equal((await owner.post(PLAN_URL, body)).status, 400, JSON.stringify(body))
})

test('names: the group\'s own venues and the report\'s own rows only', async () => {
  // A dish named loosely is found among the dishes sold, with a question.
  const res = await owner.post(PLAN_URL, {
    plan: { subject: 'till.lines', by: [{ field: 'date' }], figures: [{ figure: 'qty_sold' }], filters: [{ field: 'name', op: 'is', values: ['zqx'] }], period: { relative: 'today' } },
  })
  assert.equal(res.status, 200, res.body)
  const dishQ = res.json.questions.find(q => /dish/i.test(q.question))
  assert.ok(dishQ, 'a question about the dish: ' + JSON.stringify(res.json.questions))
  assert.ok(dishQ.choices.every(c => c.change && c.label), 'each choice a change to the report')

  // Another group's venue isn't one of this group's.
  const other = await ownerB.post(PLAN_URL, { plan: { subject: 'till.checks', by: [{ field: 'server.name' }], figures: [{ figure: 'net_sales' }], venues: ['Zqx Ware'], period: { relative: 'today' } } })
  assert.equal(other.status, 200, other.body)
  assert.ok(other.json.couldnt.some(x => x === 'There\'s no venue called "Zqx Ware"'), JSON.stringify(other.json.couldnt))
  assert.ok(!JSON.stringify(other.json).includes('Zqx'.concat(' Jo')), 'nothing of the other group\'s sales')

  // A report naming another group's venue is refused before anything runs.
  const theirs = normaliseReport({ ...keeper(), filters: [...keeper().filters, { field: 'venue', op: 'in', value: [filled.ids.venue] }] })
  const refused = await ownerB.post(PLAN_URL, { plan: planOf(everything, theirs).plan, report: theirs })
  assert.equal(refused.status, 404, refused.body)
})

test('a plan applied to a report keeps what a plan can\'t say, and the keys and order of what it keeps', async () => {
  const report = keeper()
  const { plan, kept } = planOf(everything, report, [], 'Per check by server')
  assert.deepEqual(plan.figures, [{ figure: 'net_sales' }, { figure: 'checks' }, { calc: 'v1 / v2', label: 'Per check', format: 'money' }], 'figures named by their place')
  assert.deepEqual(plan.sort, [{ by: 'v3', dir: 'desc' }])
  assert.deepEqual(plan.chart, { kind: 'bar', y: ['v1'] })
  assert.equal(kept.length, 3, JSON.stringify(kept))
  assert.match(kept[0], /^Filter: Any of: Guests is more than 0; or Net is at least £0\.00$/)
  assert.equal(kept[1], 'Value: Charges again (charges)')
  assert.match(kept[2], /drill-down/)

  // As it is: the same report.
  const same = await owner.post(PLAN_URL, { plan, report })
  assert.equal(same.status, 200, same.body)
  assert.deepEqual(same.json.spec, report)
  assert.ok(names(same.json).includes('Zqx Jo Bloggs'))

  // Guests added: everything else stays, keys and places included.
  const more = await owner.post(PLAN_URL, { plan: { ...plan, figures: [...plan.figures, { figure: 'guests' }] }, report })
  assert.equal(more.status, 200, more.body)
  const m = more.json.spec
  assert.deepEqual(m.values.map(v => v.key), ['sales', 'checks', 'charges', 'per_check', 'guests'])
  assert.equal(m.values[3].calc, 'sales / checks', 'the calculation reads the kept keys')
  assert.deepEqual(m.values[2], report.values[2], 'the average of a calculation, where it was')
  assert.deepEqual(m.filters, report.filters)
  assert.deepEqual(m.drill, report.drill)
  assert.deepEqual(m.sort, report.sort)
  assert.deepEqual(m.params, report.params, 'the choices keep their words')

  // Checks taken off, a new calculation: a new key for what is new.
  const swapped = await owner.post(PLAN_URL, {
    plan: { ...plan, figures: [plan.figures[0], { figure: 'guests' }, { calc: 'v1 / v2', label: 'Per guest', format: 'money' }] },
    report,
  })
  assert.equal(swapped.status, 200, swapped.body)
  const s = swapped.json.spec
  assert.deepEqual(s.values.map(v => v.key), ['sales', 'guests', 'charges', 'calc_1'])
  assert.equal(s.values[3].calc, 'sales / guests')
  assert.deepEqual(s.sort, [{ by: 'calc_1', dir: 'desc' }])

  // About other rows: nothing of the report's own is kept.
  const lines = await owner.post(PLAN_URL, { plan: { subject: 'till.lines', by: [{ field: 'name' }], figures: [{ figure: 'net_sales' }], period: { relative: 'today' } }, report })
  assert.equal(lines.status, 200, lines.body)
  assert.equal(lines.json.spec.drill, null)
  assert.ok(!lines.json.spec.filters.some(f => f.any), 'the filter of several parts was about checks')
  assert.deepEqual(lines.json.spec.values.map(v => v.key), ['net_sales'])
})

test('every starter written as a plan fits the plan\'s shape and comes back unchanged', () => {
  for (const s of STARTERS) {
    const spec = normaliseReport(s.spec)
    const { plan } = planOf(everything, spec, [], s.name)
    const parsed = PLAN.safeParse(plan)
    assert.ok(parsed.success, s.key + ': ' + JSON.stringify(parsed.error?.issues))
    assert.equal(planProblems(everything, parsed.data), null, s.key)
    assert.deepEqual(planSpec(everything, parsed.data, { report: spec }).spec, spec, s.key)
  }
})

test('who may: Reports Use, and only about what their role sees', async () => {
  const plan = { subject: 'till.checks', by: [{ field: 'server.name' }], figures: [{ figure: 'net_sales' }], period: { relative: 'today' } }
  assert.equal((await viewer.post(PLAN_URL, { plan })).status, 403, 'no Reports')
  assert.equal((await operator.post(PLAN_URL, { plan })).status, 403, 'Reports View only')
  assert.equal((await as(null, ids.a).post(PLAN_URL, { plan })).status, 401)

  // The other group runs a plan on its own data only.
  const theirs = await ownerB.post(PLAN_URL, { plan })
  assert.equal(theirs.status, 200, theirs.body)
  assert.ok(!names(theirs.json).some(n => n.startsWith('Zqx')), JSON.stringify(names(theirs.json)))
})
