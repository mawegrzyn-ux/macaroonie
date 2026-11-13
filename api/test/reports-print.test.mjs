// A report's print page (docs/REPORTS.md 13, migration 244): the link that
// lasts a few minutes, the page it opens with no login, what the page says
// (the same words as the screen's table, the chart, what it was run for),
// the refusals, the record of a print, and how a wide table goes on paper.
//
// The sales are the two trading days of support/tillDays.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { as, ok, closeApp, sql, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { STARTERS } from '../src/reports/starters/index.js'
import { forgetReportResults } from '../src/reports/run.js'
import { cleanUpPrintLinks } from '../src/reports/access.js'
import { printLayout, printHtml, messageHtml, whenText, PAGE_WIDTH } from '../src/reports/export/print.js'
import { tableModel } from '../../shared/reports/table.js'
import { renderChart } from '../../shared/reports/chart.js'

const FLOOR = 'a-floor'
const DAY = 'starter:till_sales_by_day'
const SERVERS = 'starter:till_sales_by_server'
let ids, t, owner, operator, viewer, floor, ownerB, today

/** A request with no login (the internal header only keeps the tests out of the rate limit). */
async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  return { status: res.statusCode, headers: res.headers, body: res.body }
}

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')
const cellsOf = part => [...part.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(r => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => unesc(c[1])))
/** The page's tables as words: [{ head: [[...]], body: [[...]] }]. */
const tablesOf = html => [...html.matchAll(/<table><thead>([\s\S]*?)<\/thead><tbody>([\s\S]*?)<\/tbody><\/table>/g)]
  .map(m => ({ head: cellsOf(m[1]), body: cellsOf(m[2]) }))
/** What the page says the report was run for: { Period: '...', Rows: '...' }. */
const factsOf = html => Object.fromEntries([...html.matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map(m => [unesc(m[1]), unesc(m[2])]))
const links = () => sql`SELECT * FROM report_print_links WHERE tenant_id = ${ids.a} ORDER BY created_at, id`
const runs = () => sql`SELECT * FROM report_runs WHERE tenant_id = ${ids.a} ORDER BY created_at, id`
const linkId = link => link.path.split('/').pop()

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  today = { from: t.date, to: t.date }
  // Someone who only looks at bookings.
  const role = await ok(owner.post('/api/access/roles', {
    key: 'floor', label: 'Floor', permissions: { reports: 'view', bookings: 'view' },
  }), 'floor role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${FLOOR + '@test.local'}, 'operator', ${FLOOR}, ${role.id})`
  floor = as(FLOOR, ids.a)
})
after(closeApp)

test('a print link: someone who can only look at a report gets one, holding what was on their screen', async () => {
  const before = Date.now()
  const link = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params: { period: today } }))
  assert.match(link.path, /^\/api\/reports\/print\/[0-9a-f-]{36}$/)
  const mins = (new Date(link.expires_at).getTime() - before) / 60000
  assert.ok(mins > 14.5 && mins < 15.5, 'the link works for 15 minutes, got ' + mins)

  const [row] = await links()
  assert.equal(row.id, linkId(link))
  assert.equal(row.report_ref, DAY)
  assert.equal(row.name, 'Sales by day')
  assert.match(row.description, /trading day/)
  assert.equal(row.spec.subject, 'till.checks')
  assert.deepEqual(row.params, { period: today })
  assert.deepEqual(row.drill, [])
  assert.deepEqual(row.trail, [])
  assert.equal(row.show_table, null, 'as the report says, unless the screen said otherwise')
  assert.equal(row.user_sub, A.operator)
  assert.match(row.user_email, /@/)
  assert.equal(row.levels.reports, 'view')
  assert.ok(row.levels.pos_reports && row.levels.pos_reports !== 'none')

  // What the screen had beside the report itself: the rows opened up, the
  // words of the way there, and whether the table was showing.
  const step = { at: [{ field: 'date', value: t.date }], to: { field: 'server.name' } }
  const opened = await ok(operator.post(`/api/reports/${DAY}/print-link`, {
    params: { period: today }, drill: [step], trail: [{ label: 'That day', by: 'Server' }], table: false,
  }))
  const stored = (await links()).find(r => r.id === linkId(opened))
  assert.deepEqual(stored.drill, [step])
  assert.deepEqual(stored.trail, [{ label: 'That day', by: 'Server' }])
  assert.equal(stored.show_table, false)
  // Words for a different number of steps describe nothing: they are left out.
  const odd = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params: { period: today }, trail: [{ label: 'x', by: 'y' }] }))
  assert.deepEqual((await links()).find(r => r.id === linkId(odd)).trail, [])
})

test('the page opens with no login and says what the screen says', async () => {
  forgetReportResults()
  const given = { params: { period: today } }
  const result = await ok(operator.post(`/api/reports/${DAY}/run`, given))
  const link = await ok(operator.post(`/api/reports/${DAY}/print-link`, given))
  const page = await pub(link.path)
  assert.equal(page.status, 200, page.body.slice(0, 300))
  assert.match(page.headers['content-type'], /^text\/html; charset=utf-8/)
  assert.equal(page.headers['cache-control'], 'private, no-store')
  assert.equal(page.headers['referrer-policy'], 'no-referrer')
  assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow')
  const csp = page.headers['content-security-policy']
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  // One script, the page's own, let through by the nonce in the header.
  const scripts = [...page.body.matchAll(/<script([^>]*)>/g)]
  assert.equal(scripts.length, 1)
  const nonce = scripts[0][1].match(/nonce="([^"]+)"/)?.[1]
  assert.ok(nonce && nonce.length >= 20)
  assert.ok(csp.includes('script-src \'nonce-' + nonce + '\''), 'the header lets the page\'s script through')
  const again = await pub(link.path)
  assert.notEqual(again.body.match(/nonce="([^"]+)"/)[1], nonce, 'a new nonce each time')

  const html = page.body
  assert.match(html, /<title>Sales by day · Thai House<\/title>/)
  assert.match(html, /<p class="who">Thai House<\/p>/)
  assert.match(html, /<h1>Sales by day<\/h1>/)
  assert.match(html, /<p class="about">Each trading day&#39;s closed checks/)
  assert.match(html, /Printed by [^<]+@[^<]+<\/span>/)
  assert.match(html, /Figures as of [A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/)
  assert.match(html, /<button type="button" id="print">Print<\/button>/)
  assert.match(html, /The page works until \d{2}:\d{2}/)
  assert.match(html, /@page\{size:(portrait|landscape);/)
  assert.match(html, /counter\(page\) " of " counter\(pages\)/)

  // What it was run for.
  const facts = factsOf(html)
  assert.equal(facts.Period, result.meta.period.text)
  // The words for a choice stand alone here, so they start with a capital.
  assert.equal(facts.Venues, 'Every venue')
  assert.equal(facts.Rows, '1')
  assert.ok(!('Opened up' in facts))
  assert.deepEqual(Object.keys(facts), ['Period', 'Venues', 'Rows'], 'the report\'s own period is said once')

  // The table: the words the screen's table shows, cell for cell.
  const model = tableModel(result)
  const tables = tablesOf(html)
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0].head, model.head.map(row => row.map(h => h.label)))
  assert.deepEqual(tables[0].body, [...model.rows.map(r => r.cells), model.total])
  assert.equal(tables[0].body.at(-1)[0], 'Total')
  assert.match(html, /<tr class="total">/)
  assert.ok(!html.includes('<tfoot'), 'the Total is the last row, not a foot repeated on every page')
  // Ten columns want the paper on its side.
  assert.match(html, /<body class="landscape"/)

  // The chart the report has, drawn by the rules the screen draws by.
  const chart = renderChart(result, { width: 950, legend: 'inside' })
  assert.equal(chart.ok, true)
  assert.match(html, /<figure class="chart"><svg[\s\S]*?<\/svg><\/figure>/)
  assert.equal(html.match(/<svg/g).length, 1)
})

test('rows opened up print as the rows on screen, with the way there', async () => {
  const params = { period: today }
  const step1 = { at: [{ field: 'date', value: t.date }], to: { field: 'server.name' } }
  const servers = await ok(operator.post(`/api/reports/${DAY}/run`, { params, drill: [step1] }))
  const link = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params, drill: [step1], trail: [{ label: 'Mon 19 Oct 2026', by: 'Server' }] }))
  const html = (await pub(link.path)).body
  const facts = factsOf(html)
  assert.equal(facts['Opened up'], 'All, then Mon 19 Oct 2026 (by server)')
  assert.equal(facts.Rows, '2')
  assert.match(html, /<h1>Sales by day<\/h1>/, 'the report keeps its name')
  const model = tableModel(servers)
  assert.deepEqual(tablesOf(html)[0].head[0], model.head[0].map(h => h.label))
  assert.deepEqual(tablesOf(html)[0].body, [...model.rows.map(r => r.cells), model.total])
  assert.ok(html.includes(t.lead) && html.includes(t.boss))
  assert.ok(!html.includes('<svg'), 'what a row opens into is a table')

  // The rows behind a figure, two steps down.
  const step2 = { at: [{ field: 'server.name', value: t.lead }], to: 'rows', value: 'net_sales' }
  const rows = await ok(operator.post(`/api/reports/${DAY}/run`, { params, drill: [step1, step2] }))
  const deep = await ok(operator.post(`/api/reports/${DAY}/print-link`, {
    params, drill: [step1, step2],
    trail: [{ label: 'Mon 19 Oct 2026', by: 'Server' }, { label: t.lead, by: 'Checks', of: 'Net sales' }],
  }))
  const list = (await pub(deep.path)).body
  assert.equal(factsOf(list)['Opened up'], `All, then Mon 19 Oct 2026 (by server), then ${t.lead} (checks behind Net sales)`)
  assert.equal(factsOf(list).Rows, String(rows.rows.length))
  const listModel = tableModel(rows)
  assert.deepEqual(tablesOf(list)[0].body, [...listModel.rows.map(r => r.cells), listModel.total])
  assert.match(tablesOf(list)[0].body.at(-1)[0], /^\d+ rows?$/, 'a list\'s last row says how many rows there are')
  // The note that only some rows are listed prints with the list.
  for (const note of rows.meta.notes || []) assert.ok(unesc(list).includes(note), note)

  // No words for the way there: the page still says rows were opened up.
  const bare = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params, drill: [step1, step2] }))
  assert.equal(factsOf((await pub(bare.path)).body)['Opened up'], 'All, then A row (by another field), then A row (the rows)')
})

test('the table can be left off a chart; a report with no chart always prints its table', async () => {
  const params = { period: today }
  const chartOnly = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params, table: false }))
  const html = (await pub(chartOnly.path)).body
  assert.match(html, /<figure class="chart"><svg/)
  assert.equal(tablesOf(html).length, 0)
  assert.match(html, /data-parts="0"/)
  const both = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params, table: true }))
  assert.equal(tablesOf((await pub(both.path)).body).length, 1)

  // Sales by server has no chart: there is nothing to print instead of its table.
  const plain = await ok(operator.post(`/api/reports/${SERVERS}/print-link`, { params, table: false }))
  const page = (await pub(plain.path)).body
  assert.ok(!page.includes('<svg'))
  assert.equal(tablesOf(page).length, 1)
  assert.ok(page.includes(t.lead))
})

test('a series switched off in the chart\'s legend stays off on paper', async () => {
  const saved = await ok(owner.post('/api/reports', {
    name: 'Guests and checks by server',
    spec: {
      subject: 'till.checks',
      params: [{ key: 'period', type: 'period', default: { relative: 'today' } }],
      rows: ['server.name'], values: [{ measure: 'checks' }, { measure: 'guests' }],
      filters: [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'status', op: 'is', value: 'closed' }],
      view: { kind: 'bar', y: ['checks', 'guests'] },
    },
  }))
  const id = saved.report.id
  const params = { period: today }
  const result = await ok(owner.post(`/api/reports/${id}/run`, { params }))
  const drawn = hidden => renderChart(result, { width: 934, legend: 'inside', hidden })
  // The legend inside the drawing names the series that are drawn.
  const legendOf = html => [...html.match(/<figure class="chart">([\s\S]*?)<\/figure>/)[1].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => unesc(m[1])).filter(w => w === 'Checks' || w === 'Guests')
  assert.deepEqual(legendOf('<figure class="chart">' + drawn([]).svg + '</figure>'), ['Checks', 'Guests'], 'both series, in the report\'s order')

  const all = await ok(owner.post(`/api/reports/${id}/print-link`, { params }))
  assert.deepEqual(legendOf((await pub(all.path)).body), ['Checks', 'Guests'])

  const one = await ok(owner.post(`/api/reports/${id}/print-link`, { params, hidden: ['guests', 'guests'] }))
  const [row] = await sql`SELECT hidden FROM report_print_links WHERE id = ${linkId(one)}`
  assert.deepEqual(row.hidden, ['guests'], 'kept once')
  const html = (await pub(one.path)).body
  assert.deepEqual(legendOf(html), ['Checks'])
  // The table still has every figure: only the drawing leaves the series out.
  assert.deepEqual(tablesOf(html)[0].head.at(-1), ['Server', 'Checks', 'Guests'])

  // Every series switched off, or a key the chart doesn't have: the chart draws as it would.
  const none = await ok(owner.post(`/api/reports/${id}/print-link`, { params, hidden: ['checks', 'guests'] }))
  assert.deepEqual(legendOf((await pub(none.path)).body), ['Checks', 'Guests'])
  const other = await ok(owner.post(`/api/reports/${id}/print-link`, { params, hidden: ['net_sales'] }))
  assert.deepEqual(legendOf((await pub(other.path)).body), ['Checks', 'Guests'])

  for (const bad of [{ hidden: 'guests' }, { hidden: [''] }, { hidden: [7] }, { hidden: Array.from({ length: 41 }, (_, i) => 'k' + i) }, { hidden: ['x'.repeat(201)] }]) {
    assert.equal((await owner.post(`/api/reports/${id}/print-link`, { params, ...bad })).status, 400, JSON.stringify(bad).slice(0, 60))
  }
  await ok(owner.delete(`/api/reports/${id}`))
})

test('a report compared with the period before says so on paper, its figures for then dimmed', async () => {
  forgetReportResults()
  const ref = 'starter:till_average_spend'
  const given = { params: { period: today } }
  const result = await ok(owner.post(`/api/reports/${ref}/run`, given))
  assert.ok(result.meta.compare?.text, 'the run says what it is compared with')
  const link = await ok(owner.post(`/api/reports/${ref}/print-link`, given))
  const page = await pub(link.path)
  assert.equal(page.status, 200, page.body.slice(0, 300))
  const facts = factsOf(page.body)
  assert.equal(facts['Compared with'], result.meta.compare.text)
  assert.deepEqual(Object.keys(facts).slice(0, 2), ['Period', 'Compared with'], 'said after the period')
  // The words the screen's table shows, the period before's figures dimmed.
  const model = tableModel(result)
  assert.deepEqual(tablesOf(page.body)[0].head, model.head.map(row => row.map(h => h.label)))
  const then = result.columns.findIndex(c => c.role === 'compare')
  assert.ok(then > 0)
  assert.ok(page.body.includes('<th scope="col" class="r dim">' + model.head[0].find(h => h.i === then).label + '</th>'))
  assert.ok(page.body.includes('<td class="r dim">' + model.rows[0].cells[then] + '</td>'))
})

test('a saved report prints under its own name, and every word on the page is escaped', async () => {
  const name = '<img src=x onerror=alert(1)> & "sales"'
  const saved = await ok(owner.post('/api/reports', {
    name, description: 'By server </p><script>alert(2)</script>',
    spec: {
      subject: 'till.checks',
      params: [{ key: 'period', type: 'period', default: { relative: 'today' } }],
      rows: ['server.name'], values: [{ measure: 'checks' }, { measure: 'net_sales', label: 'Net <b>sales</b>' }],
      filters: [{ field: 'date', op: 'in_period', param: 'period' }, { field: 'status', op: 'is', value: 'closed' }],
      drill: { down: ['order_type.name'] },
    },
  }))
  const id = saved.report.id
  const step = { at: [{ field: 'server.name', value: t.lead }], to: { field: 'order_type.name' } }
  const link = await ok(owner.post(`/api/reports/${id}/print-link`, {
    params: { period: today }, drill: [step], trail: [{ label: '<b>' + t.lead + '</b>', by: '<i>Order type</i>' }],
  }))
  const page = await pub(link.path)
  assert.equal(page.status, 200, page.body.slice(0, 300))
  const html = page.body
  assert.ok(html.includes('<h1>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;sales&quot;</h1>'))
  assert.ok(html.includes('<title>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;sales&quot; · Thai House</title>'))
  assert.ok(html.includes('By server &lt;/p&gt;&lt;script&gt;alert(2)&lt;/script&gt;'))
  assert.ok(html.includes('&lt;b&gt;' + t.lead + '&lt;/b&gt; (by &lt;i&gt;Order type&lt;/i&gt;)'))
  // A value's own words head its column, escaped too.
  assert.ok(html.includes('class="r">Net &lt;b&gt;sales&lt;/b&gt;</th>'))
  assert.ok(!html.includes('<b>'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(!html.includes('<script>alert'))
  assert.equal(html.match(/<script/g).length, 1, 'the page\'s own script and no other')
  assert.equal(html.match(/<img/g), null, 'no logo saved, no picture')

  // The print counts as a run of the saved report.
  const [row] = await sql`SELECT last_run_at FROM reports WHERE id = ${id}`
  assert.ok(row.last_run_at)
  const [run] = await sql`SELECT * FROM report_runs WHERE tenant_id = ${ids.a} AND report_id = ${id} ORDER BY created_at DESC LIMIT 1`
  assert.deepEqual([run.kind, run.format, run.report_name, run.user_sub, run.row_count, run.error], ['export', 'print', name, A.owner, 2, null])
  // The record keeps the fields a row was opened by, never the values.
  assert.ok(!JSON.stringify(run.params).includes(t.lead))

  // The group's logo and brand name, when it has them (only our own or an https picture).
  await sql`UPDATE tenant_site SET brand_name = 'Thai <House>', logo_url = '/uploads/logo.png' WHERE tenant_id = ${ids.a}`
  const branded = (await pub(link.path)).body
  assert.ok(branded.includes('<p class="who">Thai &lt;House&gt;</p>'))
  assert.ok(branded.includes('<img src="/uploads/logo.png" alt="">'))
  await sql`UPDATE tenant_site SET logo_url = 'javascript:alert(3)' WHERE tenant_id = ${ids.a}`
  assert.equal((await pub(link.path)).body.match(/<img/g), null)
  await sql`UPDATE tenant_site SET logo_url = 'https://cdn.example.test/logo.svg' WHERE tenant_id = ${ids.a}`
  assert.ok((await pub(link.path)).body.includes('<img src="https://cdn.example.test/logo.svg" alt="">'))
  await sql`UPDATE tenant_site SET brand_name = NULL, logo_url = NULL WHERE tenant_id = ${ids.a}`
})

test('who gets a link, and what a link that is wrong, old or broken shows', async () => {
  const params = { period: today }
  const before = (await links()).length
  // No Reports access: no link.
  assert.equal((await viewer.post(`/api/reports/${DAY}/print-link`, { params })).status, 403)
  // Reports, but not till sales: refused in the app, not on a page in a new tab.
  const noTill = await floor.post(`/api/reports/${DAY}/print-link`, { params })
  assert.equal(noTill.status, 403)
  assert.match(noTill.json.error, /role/i)
  // A report the same person may run prints.
  const mine = await ok(floor.post('/api/reports/starter:bookings_party_sizes/print-link', {}))
  assert.equal((await pub(mine.path)).status, 200)
  // Rows that can't be opened that way.
  const bad = await operator.post(`/api/reports/${DAY}/print-link`, { params, drill: [{ at: [{ field: 'tab_name', value: 'x' }], to: 'rows' }] })
  assert.equal(bad.status, 422)
  assert.equal((await operator.post(`/api/reports/${DAY}/print-link`, { params, drill: [{ to: 'nowhere' }] })).status, 422)
  assert.equal((await operator.post(`/api/reports/${DAY}/print-link`, { params, table: 'yes' })).status, 400)
  // No such report; another group's report; another group's venue.
  assert.equal((await operator.post('/api/reports/starter:nope/print-link', {})).status, 404)
  const saved = await ok(owner.post('/api/reports', { name: 'Ours', spec: { subject: 'till.checks', rows: ['server.name'], values: [{ measure: 'checks' }] } }))
  assert.equal((await ownerB.post(`/api/reports/${saved.report.id}/print-link`, {})).status, 404)
  const [venueB] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.b} LIMIT 1`
  assert.equal((await operator.post(`/api/reports/${DAY}/print-link`, { params: { period: today, venues: [venueB.id] } })).status, 404)
  assert.equal((await links()).length, before + 1, 'refused requests made no links')

  // A link nobody made, or that isn't one, is a page that says so.
  for (const path of ['/api/reports/print/00000000-0000-4000-8000-000000000000', '/api/reports/print/not-a-link', '/api/reports/print/' + '9'.repeat(90)]) {
    const none = await pub(path)
    assert.equal(none.status, 404, path)
    assert.match(none.body, /<h1>This print page isn&#39;t there<\/h1>/)
    assert.match(none.headers['content-type'], /text\/html/)
    assert.equal(none.headers['cache-control'], 'private, no-store')
    assert.ok(!/script-src/.test(none.headers['content-security-policy']), 'a page that only says something runs nothing')
    assert.ok(!none.body.includes('<script'))
  }

  // Past its 15 minutes: gone, with the way to get another.
  const link = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params }))
  assert.equal((await pub(link.path)).status, 200)
  await sql`UPDATE report_print_links SET expires_at = now() - interval '1 second' WHERE id = ${linkId(link)}`
  const gone = await pub(link.path)
  assert.equal(gone.status, 410)
  assert.match(gone.body, /<h1>This print page has run out<\/h1>/)
  assert.match(gone.body, /works for 15 minutes[\s\S]*press Print again/)
  assert.ok(!gone.body.includes('Sales by day'))

  // A report that can't be run any more says so in words, and the try is recorded.
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  const broken = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params }))
  await sql`UPDATE report_print_links SET levels = '{}'::jsonb WHERE id = ${linkId(broken)}`
  forgetReportResults()
  const refused = await pub(broken.path)
  assert.equal(refused.status, 403)
  assert.match(refused.body, /<h1>This report can&#39;t be printed<\/h1>/)
  assert.ok(!refused.body.includes('<table'))
  const [failed] = await runs()
  assert.deepEqual([failed.kind, failed.format, failed.starter_key, failed.row_count], ['export', 'print', 'till_sales_by_day', null])
  assert.match(failed.error, /role/i)
})

test('a print is recorded; links are cleared away as new ones are made, and by the hourly clean-up', async () => {
  await sql`DELETE FROM report_runs WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM report_print_links WHERE tenant_id = ${ids.a}`
  const params = { period: today }
  const step = { at: [{ field: 'date', value: t.date }], to: { field: 'server.name' } }
  const link = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params, drill: [step] }))
  assert.equal((await runs()).length, 0, 'making the link runs nothing')
  await pub(link.path)
  const [run, ...more] = await runs()
  assert.equal(more.length, 0)
  assert.deepEqual([run.report_id, run.starter_key, run.report_name, run.subject, run.kind, run.format, run.user_sub, run.row_count, run.error],
    [null, 'till_sales_by_day', 'Sales by day', 'till.checks', 'export', 'print', A.operator, 2, null])
  // The fields the rows were opened by, never the values held.
  assert.deepEqual(run.params.drill, [{ at: ['date'], to: 'server.name' }])
  assert.ok(!JSON.stringify(run.params.drill).includes(t.date))
  assert.deepEqual(run.params.params.period, today)

  // The person's own links that have run out go when they make another;
  // someone else's stay a day (their page says it has run out, not that it never was).
  const mine = await ok(owner.post(`/api/reports/${DAY}/print-link`, { params }))
  await sql`UPDATE report_print_links SET expires_at = now() - interval '1 minute' WHERE id IN (${linkId(link)}, ${linkId(mine)})`
  const next = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params }))
  assert.deepEqual((await links()).map(r => r.id).sort(), [linkId(mine), linkId(next)].sort())
  assert.equal((await pub(link.path)).status, 404)
  assert.equal((await pub(mine.path)).status, 410)
  await sql`UPDATE report_print_links SET expires_at = now() - interval '25 hours' WHERE id = ${linkId(mine)}`
  const last = await ok(operator.post(`/api/reports/${DAY}/print-link`, { params }))
  assert.deepEqual((await links()).map(r => r.id).sort(), [linkId(next), linkId(last)].sort())

  // Another group's clearing never touches these.
  await sql`UPDATE report_print_links SET expires_at = now() - interval '25 hours' WHERE id = ${linkId(next)}`
  const theirs = await ok(ownerB.post('/api/reports/starter:bookings_party_sizes/print-link', {}))
  assert.ok((await links()).some(r => r.id === linkId(next)))

  // The hourly clean-up clears what nobody's next print would: every
  // group's links a day after they ran out (a link holds the choices typed
  // for the visit). One that has only just run out stays, and so does a live one.
  const live = await ok(ownerB.post('/api/reports/starter:bookings_party_sizes/print-link', {}))
  await sql`UPDATE report_print_links SET expires_at = now() - interval '1 minute' WHERE id = ${linkId(last)}`
  await sql`UPDATE report_print_links SET expires_at = now() - interval '25 hours' WHERE id = ${linkId(theirs)}`
  const all = async () => (await sql`SELECT id FROM report_print_links`).map(r => r.id)
  const had = await all()
  for (const l of [next, last, theirs, live]) assert.ok(had.includes(linkId(l)))
  assert.deepEqual(await cleanUpPrintLinks(), { removed: 2 })
  const has = await all()
  assert.deepEqual(had.filter(id => !has.includes(id)).sort(), [linkId(next), linkId(theirs)].sort(),
    'both groups\' old links went; the one that just ran out and the live one stayed')
  assert.equal((await pub(last.path)).status, 410, 'a page opened late still says it has run out')
  assert.deepEqual(await cleanUpPrintLinks(), { removed: 0 })
})

test('every starter with a chart draws one from its own result, and prints', async () => {
  forgetReportResults()
  const charted = STARTERS.filter(s => s.spec.view && s.spec.view.kind !== 'table')
  assert.ok(charted.length >= 10, 'starters with a chart: ' + charted.length)
  // The year up to the day the till sold on (a "last N days" ends yesterday).
  const from = new Date(new Date(t.date + 'T12:00:00Z').getTime() - 400 * 86_400_000).toISOString().slice(0, 10)
  const params = { period: { from, to: t.date } }
  const drawn = []
  for (const s of charted) {
    const result = await ok(owner.post(`/api/reports/${s.ref}/run`, { params }), s.key)
    const chart = renderChart(result, { width: 700, legend: 'inside' })
    // Nothing to show for the period: no chart, and nothing to say about it (the table says so).
    if (!result.rows.length) { assert.equal(chart.ok, false, s.key); assert.equal(chart.why, null, s.key); continue }
    assert.equal(chart.ok, true, s.key + ': ' + chart.why)
    assert.match(chart.svg, /^<svg[\s\S]*<\/svg>$/, s.key)
    assert.ok(!/NaN|undefined|Infinity/.test(chart.svg), s.key + ' draws no broken numbers')
    drawn.push(s.key)
    const link = await ok(owner.post(`/api/reports/${s.ref}/print-link`, { params }))
    const page = await pub(link.path)
    assert.equal(page.status, 200, s.key)
    assert.equal(page.body.match(/<svg/g)?.length, 1, s.key + ' prints its chart')
    assert.ok(tablesOf(page.body).length >= 1, s.key + ' prints its table under it')
  }
  // The two days of till sales and the fixtures' bookings give most of them something to draw.
  assert.ok(drawn.includes('till_sales_by_day') && drawn.includes('till_sales_by_dish') && drawn.includes('till_sales_by_section'), drawn.join(', '))
  assert.ok(drawn.length >= 6, 'drawn: ' + drawn.join(', '))
})

// ── How a table goes on paper (no database) ──────────────────

const money = n => ({ key: 'v' + n, label: 'Net sales ' + n, type: 'money', role: 'value' })
const wide = n => ({
  kind: 'summary', spec: { view: { kind: 'table' } },
  columns: [{ key: 'name', label: 'Dish', type: 'text', role: 'row' }, ...Array.from({ length: n }, (_, i) => money(i + 1))],
  rows: [{ kind: 'row', level: 0, k: ['Pad Thai'], cells: ['Pad Thai', ...Array.from({ length: n }, (_, i) => 1234.5 + i)] }],
  totals: { cells: [null, ...Array.from({ length: n }, (_, i) => 1234.5 + i)] },
  meta: { currency: 'GBP', tz: 'Europe/London', generated_at: '2026-11-13T14:22:00Z', notes: [] },
})

test('a table on paper: upright, then on its side, then smaller, then in parts with its first columns repeated', () => {
  const seen = []
  for (let n = 1; n <= 40; n++) {
    const model = tableModel(wide(n))
    const lay = printLayout(model)
    const stage = lay.parts.length > 1 ? 'parts' : lay.small ? 'small' : lay.landscape ? 'landscape' : 'portrait'
    if (seen.at(-1) !== stage) seen.push(stage)
    // Every column is printed: the first in every part, the others once.
    for (const part of lay.parts) assert.equal(part[0], 0, n + ': each part starts with the row\'s name')
    const others = lay.parts.flatMap(p => p.slice(1))
    assert.deepEqual(others, Array.from({ length: n }, (_, i) => i + 1), n + ' columns')
    if (stage === 'parts') { assert.ok(lay.landscape && lay.small, 'parts are printed on the side, small'); assert.ok(lay.parts.every(p => p.length >= 2)) }
  }
  assert.deepEqual(seen, ['portrait', 'landscape', 'small', 'parts'], 'each way in turn as the table widens')
  assert.ok(PAGE_WIDTH.portrait < PAGE_WIDTH.landscape)

  // A long name wraps: it never pushes the figures onto another page by itself.
  const long = wide(3)
  long.rows[0].cells[0] = 'A very long dish name that goes on and on, far past what a column should take from the figures beside it'
  assert.deepEqual(printLayout(tableModel(long)), { landscape: false, small: false, parts: [[0, 1, 2, 3]] })

  // A list with no grouping repeats its first column; two groupings both lead every part.
  const list = wide(30)
  list.kind = 'list'
  list.columns[0].role = 'value'
  list.totals = { cells: list.totals.cells, count: 1 }
  const listLay = printLayout(tableModel(list))
  assert.ok(listLay.parts.length > 1 && listLay.parts.every(p => p[0] === 0))
  const two = wide(30)
  two.columns.splice(1, 0, { key: 'section', label: 'Section', type: 'text', role: 'row' })
  two.rows[0].cells.splice(1, 0, 'Mains')
  two.totals.cells.splice(1, 0, null)
  const twoLay = printLayout(tableModel(two))
  assert.ok(twoLay.parts.length > 1 && twoLay.parts.every(p => p[0] === 0 && p[1] === 1))
  // One column, however wide, is one part.
  assert.deepEqual(printLayout(tableModel({ kind: 'list', columns: [{ key: 'a', label: 'x'.repeat(400), type: 'text', role: 'value' }], rows: [], totals: null })).parts, [[0]])
  assert.deepEqual(printLayout(tableModel(null)), { landscape: false, small: false, parts: [[]] })
})

test('a table across in parts: the values under one heading stay together, and each part has its own headings', () => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const result = {
    kind: 'matrix', spec: { view: { kind: 'table' } },
    columns: [
      { key: 'hour', label: 'Hour opened', type: 'text', role: 'row' },
      ...days.flatMap((d, i) => ['Checks', 'Net sales', 'Average check'].map((label, j) => ({
        key: 'c' + i + '_' + j, label, group: d, type: j === 0 ? 'number' : 'money', role: 'value', at: d,
      }))),
      ...['Checks', 'Net sales', 'Average check'].map((label, j) => ({ key: 't' + j, label, group: 'Total', type: j === 0 ? 'number' : 'money', role: 'total' })),
    ],
    rows: [{ kind: 'row', level: 0, cells: ['12:00', ...Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 12 : 1234.56))] }],
    totals: { cells: [null, ...Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 12 : 1234.56))] },
    meta: { currency: 'GBP', tz: 'Europe/London', generated_at: '2026-11-13T14:22:00Z', notes: ['Money is in pounds.'] },
  }
  const model = tableModel(result)
  assert.equal(model.head.length, 2)
  const lay = printLayout(model)
  assert.ok(lay.parts.length > 1, 'too wide for one page')
  for (const part of lay.parts) {
    assert.equal(part[0], 0)
    // Each day's three values are all in the part, or none of them.
    for (let g = 0; g < 8; g++) {
      const cols = [1, 2, 3].map(j => g * 3 + j)
      const inPart = cols.filter(c => part.includes(c)).length
      assert.ok(inPart === 0 || inPart === 3, 'a heading\'s values split between parts: ' + JSON.stringify(lay.parts))
    }
  }

  const html = printHtml({ group: 'Thai House', name: 'Sales by hour and weekday', facts: [['Period', 'Last 28 days']], result, by: 'me@example.test', nonce: 'n0nce' })
  const tables = tablesOf(html)
  assert.equal(tables.length, lay.parts.length)
  assert.match(html, new RegExp('data-parts="' + lay.parts.length + '"'))
  assert.ok(html.includes('<p class="part">Part 1 of ' + lay.parts.length + '</p>'))
  assert.ok(html.includes('The table is too wide for one page, so its columns are printed in ' + lay.parts.length + ' parts.'))
  assert.ok(html.includes('<li>Money is in pounds.</li>'))
  assert.match(html, /<body class="landscape small"/)
  lay.parts.forEach((part, i) => {
    const [top, under] = tables[i].head
    assert.equal(top[0], 'Hour opened', 'the row\'s heading leads every part')
    const groups = [...new Set(part.slice(1).map(c => result.columns[c].group))]
    assert.deepEqual(top.slice(1), groups, 'the headings over this part\'s values')
    assert.deepEqual(under, part.slice(1).map(c => result.columns[c].label))
    assert.deepEqual(tables[i].body[0], part.map(c => model.rows[0].cells[c]))
    assert.deepEqual(tables[i].body[1], part.map(c => model.total[c]))
  })
  // A heading over three values spans three; the row's heading covers both heading rows.
  assert.match(html, /<th scope="col" rowspan="2">Hour opened<\/th>/)
  assert.match(html, /<th scope="col" colspan="3" class="c">Monday<\/th>/)

  // However many values a heading has and however wide they are, a part
  // holds all of a heading's values or none of them.
  const shape = (size, word) => {
    const labels = Array.from({ length: size }, (_, j) => (j === 0 ? 'Checks' : word + ' ' + j))
    const cells = Array.from({ length: 8 * size }, (_, i) => (i % size === 0 ? 12 : 1234.56))
    return {
      ...result,
      columns: [
        result.columns[0],
        ...days.flatMap((d, i) => labels.map((label, j) => ({ key: 'c' + i + '_' + j, label, group: d, type: j ? 'money' : 'number', role: 'value', at: d }))),
        ...labels.map((label, j) => ({ key: 't' + j, label, group: 'Total', type: j ? 'money' : 'number', role: 'total' })),
      ],
      rows: [{ kind: 'row', level: 0, cells: ['12:00', ...cells] }],
      totals: { cells: [null, ...cells] },
    }
  }
  let split = 0
  for (const size of [2, 3, 4, 5]) {
    for (const word of ['Net', 'Net sales', 'Net sales after discounts']) {
      const parts = printLayout(tableModel(shape(size, word))).parts
      if (parts.length < 2) continue
      split++
      for (const part of parts) {
        for (let g = 0; g < 8; g++) {
          const inPart = Array.from({ length: size }, (_, j) => 1 + g * size + j).filter(c => part.includes(c)).length
          assert.ok(inPart === 0 || inPart === size, size + ' x "' + word + '": ' + JSON.stringify(parts))
        }
      }
    }
  }
  assert.ok(split >= 6, 'shapes printed in parts: ' + split)
})

/** Runs the page's script with a stand-in browser: how often it prints when loaded, and when its button is pressed. */
function printsOf(html, search) {
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
  let prints = 0, click = null
  const on = {}
  vm.runInNewContext(script, {
    document: { getElementById: id => (id === 'print' ? { addEventListener: (ev, f) => { if (ev === 'click') click = f } } : null) },
    window: { print: () => { prints++ }, addEventListener: (ev, f) => { on[ev] = f } },
    location: { search },
    setTimeout: f => f(),
  })
  on.load?.()
  const loaded = prints
  click?.()
  return { loaded, pressed: prints - loaded }
}

test('the page by itself: every word escaped, figures to the right, the paper the way round the table needs, the dialog only when asked', () => {
  const marked = wide(2)
  marked.columns[1] = { ...marked.columns[1], label: 'Net <b>sales</b> & "more"' }
  marked.rows[0].cells[0] = '<i>Pad Thai</i> & co'
  marked.meta = { ...marked.meta, notes: ['<b>Money</b> is in "pounds" & pence'] }
  const html = printHtml({ name: 'Sales', result: marked, by: '<u>me</u>@example.test', nonce: 'abc' })
  // Headings, cells, notes and who printed it: every word escaped.
  assert.ok(html.includes('>Net &lt;b&gt;sales&lt;/b&gt; &amp; &quot;more&quot;</th>'))
  assert.ok(html.includes('<td>&lt;i&gt;Pad Thai&lt;/i&gt; &amp; co</td>'))
  assert.ok(html.includes('<li>&lt;b&gt;Money&lt;/b&gt; is in &quot;pounds&quot; &amp; pence</li>'))
  assert.ok(html.includes('<span>Printed by &lt;u&gt;me&lt;/u&gt;@example.test</span>'))
  for (const raw of ['<b>', '<i>', '<u>']) assert.ok(!html.includes(raw), raw + ' printed as it came')
  // Figures and their headings to the right, names to the left.
  assert.ok(html.includes('<th scope="col">Dish</th>'))
  assert.ok(html.includes('<th scope="col" class="r">Net sales 2</th>'))
  assert.ok(html.includes('<td class="r">£1,234.50</td><td class="r">£1,235.50</td>'))
  // The paper upright for a narrow table, on its side for a wide one.
  assert.match(html, /@page\{size:portrait;/)
  const onItsSide = Array.from({ length: 40 }, (_, i) => i + 1).find(n => printLayout(tableModel(wide(n))).landscape)
  assert.match(printHtml({ name: 'Sales', result: wide(onItsSide) }), /@page\{size:landscape;/)
  // The print dialog opens by itself only with print=1 in the address (the
  // viewer's Print button adds it); the page's own button always opens it.
  for (const search of ['?print=1', '?a=b&print=1', '?print=1&a=b']) assert.deepEqual(printsOf(html, search), { loaded: 1, pressed: 1 }, search)
  for (const search of ['', '?a=b', '?print=0', '?print=10', '?reprint=1']) assert.deepEqual(printsOf(html, search), { loaded: 0, pressed: 1 }, search)
})

test('the page by itself: notes, an empty result, a cut list, and the pages that only say something', () => {
  const base = wide(2)
  const page = extra => printHtml({ group: 'Thai House', name: 'Sales', facts: [['Period', 'Today']], result: base, by: 'me@example.test', nonce: 'abc', ...extra })
  const html = page({})
  assert.match(html, /^<!doctype html>\n<html lang="en">/)
  assert.match(html, /<body class="portrait" data-rows="1" data-parts="1">/)
  assert.match(html, /<script nonce="abc">/)
  // On screen the paper keeps its own width whatever the screen's (a phone
  // scrolls the sheet sideways): squeezed to the screen it isn't how it prints.
  assert.match(html, /<main class="sheet"><div class="paper"><header class="top">/)
  assert.match(html, /<\/footer><\/div><\/main>/)
  assert.match(html, /\.sheet\{width:calc\(190mm \+ 24mm\)\}\.paper\{width:190mm\}/)
  assert.match(html, /@media print\{[^@]*\.paper\{width:auto!important\}/)
  const onItsSide = Array.from({ length: 40 }, (_, i) => i + 1).find(n => printLayout(tableModel(wide(n))).landscape)
  const side = printHtml({ name: 'Sales', result: wide(onItsSide) })
  assert.match(side, /<body class="landscape/)
  assert.match(side, /\.sheet\{width:calc\(277mm \+ 24mm\)\}\.paper\{width:277mm\}/)
  assert.match(html, /Figures as of Fri, 13 Nov 2026, 14:22/)
  assert.ok(!html.includes('The page works until'), 'no time to say without one')
  assert.match(page({ expires: '2026-11-13T14:37:00Z' }), /The page works until 14:37:/)
  // Kept results say when their figures are from.
  const kept = { ...base, meta: { ...base.meta, cached_at: '2026-11-13T09:05:00Z' } }
  assert.match(printHtml({ name: 'Sales', result: kept }), /Figures as of Fri, 13 Nov 2026, 09:05/)
  // The venue's own time, not the server's.
  const ny = { ...base, meta: { ...base.meta, tz: 'America/New_York' } }
  assert.match(printHtml({ name: 'Sales', result: ny }), /Figures as of Fri, 13 Nov 2026, 09:22/)
  // The Print button wears the brand when the brand can be read on white.
  assert.match(page({ brand: '#630812' }), /\.bar button\{background:#630812;color:#ffffff\}/i)
  assert.match(page({ brand: '#fff8e7' }), /\.bar button\{background:#0b0b0b;color:#ffffff\}/i)
  assert.match(page({ brand: 'red;}body{display:none' }), /\.bar button\{background:#0b0b0b;/)

  const none = { ...base, rows: [], totals: null }
  const empty = printHtml({ name: 'Sales', result: none })
  assert.match(empty, /<td class="none" colspan="3">Nothing to show for these choices\.<\/td>/)
  assert.ok(!empty.includes('class="total"'))

  const cut = {
    kind: 'list', spec: { view: { kind: 'table' } },
    columns: [{ key: 'n', label: 'Check', type: 'text', role: 'value' }, { key: 'net', label: 'Net', type: 'money', role: 'value', adds: true }],
    rows: [{ kind: 'row', level: 0, cells: ['T1-1', 12] }, { kind: 'row', level: 0, cells: ['T1-2', 8] }],
    totals: { cells: [null, 2046], count: 6120 },
    meta: { currency: 'GBP', tz: 'Europe/London', row_count: 6120, truncated: true, notes: [] },
  }
  const list = printHtml({ name: 'Checks', result: cut })
  assert.ok(list.includes('<li>The first 2 of 6,120 rows are printed.</li>'))
  assert.deepEqual(tablesOf(list)[0].body.at(-1), ['6,120 rows', '£2,046.00'])

  // A chart that can't be drawn says why, as the screen does, and the table
  // prints whatever the screen had. With nothing to show there is nothing to say.
  const noChart = { ...base, totals: null, spec: { view: { kind: 'figures' } } }
  const said = printHtml({ name: 'Sales', result: noChart, table: false })
  assert.ok(said.includes('<li>No chart: Switch the total on to show the report as figures.</li>'))
  assert.equal(tablesOf(said).length, 1)
  assert.ok(!said.includes('<svg'))
  const quiet = printHtml({ name: 'Sales', result: { ...none, spec: { view: { kind: 'bar', x: 'name', y: ['v1'] } } }, table: false })
  assert.ok(!quiet.includes('No chart'))
  assert.equal(tablesOf(quiet).length, 1)
  // A chart that can: one drawing, and the table under it unless the screen had it closed.
  const bars = { ...base, spec: { view: { kind: 'bar', x: 'name', y: ['v1'] } } }
  const drawn = printHtml({ name: 'Sales', result: bars })
  assert.equal(drawn.match(/<svg/g).length, 1)
  assert.equal(tablesOf(drawn).length, 1)
  assert.equal(tablesOf(printHtml({ name: 'Sales', result: bars, table: false })).length, 0)
  assert.equal(tablesOf(printHtml({ name: 'Sales', result: { ...bars, spec: { view: { ...bars.spec.view, table_below: false } } } })).length, 0, 'as the report says')
  assert.equal(tablesOf(printHtml({ name: 'Sales', result: { ...bars, spec: { view: { ...bars.spec.view, table_below: false } } }, table: true })).length, 1, 'the screen had it open')

  const msg = messageHtml('It\'s <gone>', 'Press "Print" & try again')
  assert.ok(msg.includes('<h1>It&#39;s &lt;gone&gt;</h1><p>Press &quot;Print&quot; &amp; try again</p>'))
  assert.ok(!msg.includes('<script'))
  assert.equal(whenText('2026-07-01T11:30:00Z', 'Europe/London'), 'Wed, 1 Jul 2026, 12:30')
  assert.equal(whenText('2026-07-01T11:30:00Z', 'Europe/London', { time: true }), '12:30')
  assert.equal(whenText('2026-07-01T11:30:00Z', 'Not/AZone'), 'Wed, 1 Jul 2026, 12:30')
  assert.equal(whenText('nonsense', 'Europe/London'), '')
})
