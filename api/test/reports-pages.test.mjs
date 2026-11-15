// Page reports (docs/REPORTS.md 6, 11; shared/reports/page.js): several
// reports, notes and page breaks in order, to read and print as one. A page
// is saved with the reports' own routes; each report on it is found and run
// as the person looking, with the page's period and venues (or the
// visitor's); it prints as one page with one run recorded per report; it
// isn't run, kept as a CSV or scheduled itself; and Pepper says so.
//
// The sales are the two trading days of support/tillDays.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

const MAKER = 'a-maker'
const OTHER = 'a-other-maker'
const FLOOR = 'a-floor'
const DAY = 'starter:till_sales_by_day'
const SERVERS = 'starter:till_sales_by_server'
const GONE = /This report isn(&#39;|&#x27;|')t here any more, or isn(&#39;|&#x27;|')t shared with you/
let ids, t, owner, operator, viewer, maker, other, floor, ownerB, today, mine, venueName, venueB

/** A request with no login (the internal header only keeps the tests out of the rate limit). */
async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  return { status: res.statusCode, headers: res.headers, body: res.body }
}

async function mcp(token, method, params = {}) {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/mcp/staff/thai-house',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + token, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
async function call(token, name, args) {
  const r = await mcp(token, 'tools/call', { name, arguments: args })
  assert.ok(r.json?.result, name + ': ' + r.body.slice(0, 300))
  const text = r.json.result.content[0].text
  return r.json.result.isError ? { error: text } : { out: JSON.parse(text) }
}

const runs = () => sql`SELECT * FROM report_runs WHERE tenant_id = ${ids.a}`
/** What `fn` recorded in report_runs. */
async function recorded(fn) {
  const had = new Set((await runs()).map(r => r.id))
  const out = await fn()
  return { out, made: (await runs()).filter(r => !had.has(r.id)) }
}

const blocksOf = (...more) => [
  { type: 'report', ref: DAY, title: 'Sales by day', show: 'both' },
  { type: 'text', title: 'Notes', text: 'Line one\nLine two' },
  { type: 'break' },
  { type: 'report', ref: mine.id, show: 'table', title: 'Who sold what' },
  ...more,
]
const pageSpec = (over = {}) => ({ kind: 'page', blocks: blocksOf(), period: today, venues: 'all', ...over })
const newPage = async (who, name, spec = pageSpec()) => (await ok(who.post('/api/reports', { name, spec }), 'page ' + name)).report
const opened = async (who, id) => (await ok(who.get('/api/reports/' + id), 'open the page')).report
const share = id => ok(owner.patch('/api/reports/' + id + '/sharing', { shared: 'everyone' }), 'share')

/** A page's print page as someone, with what they picked: the HTML. */
async function printed(who, id, body = {}) {
  const link = await ok(who.post('/api/reports/' + id + '/print-link', body), 'print link')
  const res = await pub(link.path)
  assert.equal(res.status, 200, 'the print page: ' + res.body.slice(0, 200))
  return res.body
}
const count = (html, piece) => html.split(piece).length - 1

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  const filledB = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  venueB = filledB.ids.venue
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  today = { from: t.date, to: t.date }
  venueName = (await sql`SELECT name FROM venues WHERE id = ${t.V}`)[0].name
  // Two people who build reports of their own and manage nothing, and one
  // who only looks at reports and can't see till sales.
  const makerRole = await ok(owner.post('/api/access/roles', {
    key: 'maker', label: 'Report maker', permissions: { reports: 'use', pos_reports: 'view' },
  }), 'maker role')
  const floorRole = await ok(owner.post('/api/access/roles', {
    key: 'floor', label: 'Floor', permissions: { reports: 'view', bookings: 'view' },
  }), 'floor role')
  for (const [sub, role] of [[MAKER, makerRole], [OTHER, makerRole], [FLOOR, floorRole]]) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
              VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${role.id})`
  }
  maker = as(MAKER, ids.a)
  other = as(OTHER, ids.a)
  floor = as(FLOOR, ids.a)
  // The maker's own report, shared with nobody.
  mine = (await ok(maker.post('/api/reports/' + SERVERS + '/copy', { name: 'My servers' }), 'copy')).report
})
after(closeApp)

test('a page is saved with its blocks tidied, says what each of its reports is, and names only reports its maker can open', async () => {
  const made = await maker.post('/api/reports', {
    name: 'Weekly pack',
    description: 'For Monday',
    spec: pageSpec({ blocks: blocksOf({ type: 'sticker', text: 'not a block' }) }),
  })
  assert.equal(made.status, 201, made.body.slice(0, 300))
  const page = made.json.report
  assert.equal(page.report_kind, 'page')
  assert.equal(page.subject, 'page')
  assert.equal(page.area, null)
  assert.equal(page.runs, true)
  assert.equal(page.spec.kind, 'page')
  assert.deepEqual(page.spec.blocks.map(b => [b.id, b.type]), [['b1', 'report'], ['b2', 'text'], ['b3', 'break'], ['b4', 'report']], 'what isn\'t a block is left out')
  assert.deepEqual(page.spec.period, today)
  assert.equal(page.spec.venues, 'all')
  assert.equal(page.spec.blocks[1].text, 'Line one\nLine two', 'a note keeps its lines')
  const day = page.reports[DAY]
  assert.equal(day.name, 'Sales by day')
  assert.equal(day.view, 'bar')
  assert.deepEqual([day.has_period, day.has_venues, day.runs, day.needs], [true, true, true, null])
  assert.equal(page.reports[mine.id].name, 'My servers')
  const [stored] = await sql`SELECT subject, spec FROM reports WHERE id = ${page.id}`
  assert.equal(stored.subject, 'page')
  assert.deepEqual(stored.spec, page.spec, 'stored tidied')

  // In the list with the other reports, as a page.
  const row = (await ok(maker.get('/api/reports'))).reports.find(r => r.id === page.id)
  assert.equal(row.report_kind, 'page')
  assert.equal(row.name, 'Weekly pack')
  assert.deepEqual((await opened(maker, page.id)).spec, page.spec)

  // What can't be saved.
  const empty = await maker.post('/api/reports', { name: 'Only words', spec: { kind: 'page', blocks: [{ type: 'text', title: 'Hello', text: 'x' }] } })
  assert.equal(empty.status, 422)
  assert.match(empty.body, /Add at least one report to the page/)
  const unknown = await maker.post('/api/reports', { name: 'Lost', spec: { kind: 'page', blocks: [{ type: 'report', ref: '11111111-1111-4111-8111-111111111111' }] } })
  assert.equal(unknown.status, 422)
  assert.match(unknown.body, /One of the page's reports isn't here any more, or isn't shared with you/)
  const notTheirs = await other.post('/api/reports', { name: 'Borrowed', spec: pageSpec() })
  assert.equal(notTheirs.status, 422, 'a report that isn\'t shared with its maker can\'t go on a page')
  assert.match(notTheirs.body, /isn't shared with you/)
  const onAPage = await maker.post('/api/reports', { name: 'Nested', spec: { kind: 'page', blocks: [{ type: 'report', ref: page.id }] } })
  assert.equal(onAPage.status, 422, 'a page can\'t hold a page')
  const foreign = await maker.post('/api/reports', { name: 'Elsewhere', spec: pageSpec({ venues: [venueB] }) })
  assert.equal(foreign.status, 404)
  assert.match(foreign.body, /Venue not found/)

  // Who may.
  assert.equal((await viewer.post('/api/reports', { name: 'No', spec: pageSpec() })).status, 403)
  assert.equal((await operator.post('/api/reports', { name: 'No', spec: pageSpec() })).status, 403, 'View doesn\'t make pages')
  assert.equal((await ownerB.get('/api/reports/' + page.id)).status, 404, 'another group never sees it')
  assert.equal((await other.get('/api/reports/' + page.id)).status, 404, 'private until shared')
})

test('a page\'s reports run one by one as the person looking, with the page\'s period and venues or the visitor\'s own', async () => {
  const page = await newPage(maker, 'Run pack')
  const direct = await ok(maker.post('/api/reports/' + DAY + '/run', { params: { period: today } }), 'the report itself')
  assert.ok(direct.rows.length >= 1, 'the day has sales')

  const viaPage = await recorded(() => ok(maker.post('/api/reports/' + page.id + '/blocks/b1/run', {}), 'block run'))
  assert.deepEqual(viaPage.out.report, { id: DAY, name: 'Sales by day' })
  assert.equal(JSON.stringify(viaPage.out.rows), JSON.stringify(direct.rows), 'the page\'s period is the report\'s period')
  assert.equal(viaPage.made.length, 1, 'one run, of the report')
  assert.equal(viaPage.made[0].kind, 'run')
  assert.equal(viaPage.made[0].starter_key, 'till_sales_by_day')
  assert.equal(viaPage.made[0].report_id, null, 'never a run of the page')
  assert.equal(viaPage.made[0].user_sub, MAKER)

  const saved = await recorded(() => ok(maker.post('/api/reports/' + page.id + '/blocks/b4/run', {}), 'the saved report'))
  assert.equal(saved.out.report.name, 'My servers')
  assert.ok(saved.out.rows.length >= 1)
  assert.equal(saved.made[0].report_id, mine.id)

  // The visitor's own period and venues, for the visit.
  const earlier = await ok(maker.post('/api/reports/' + page.id + '/blocks/b1/run', { period: { from: '2020-01-01', to: '2020-01-02' } }))
  assert.equal(earlier.rows.length, 0, 'a period with no sales')
  const oneVenue = await ok(maker.post('/api/reports/' + page.id + '/blocks/b1/run', { venues: [t.V] }))
  assert.equal(JSON.stringify(oneVenue.rows), JSON.stringify(direct.rows), 'the venue the sales were at')
  const elsewhere = await maker.post('/api/reports/' + page.id + '/blocks/b1/run', { venues: [venueB] })
  assert.equal(elsewhere.status, 404)
  assert.match(elsewhere.body, /Venue not found/)

  // What isn't a report of this page.
  for (const id of ['zz9', 'b2', 'b3']) {
    const res = await maker.post('/api/reports/' + page.id + '/blocks/' + id + '/run', {})
    assert.equal(res.status, 404, id)
    assert.match(res.body, /That report isn't on this page/)
  }
  const plain = await maker.post('/api/reports/' + mine.id + '/blocks/b1/run', {})
  assert.equal(plain.status, 404)
  assert.match(plain.body, /That isn't a page of reports/)
  assert.equal((await ownerB.post('/api/reports/' + page.id + '/blocks/b1/run', {})).status, 404)
  assert.equal((await viewer.post('/api/reports/' + page.id + '/blocks/b1/run', {})).status, 403)

  // Shared with everyone: each person gets what they may see of it.
  await share(page.id)
  const forOperator = await opened(operator, page.id)
  assert.deepEqual(forOperator.reports[mine.id], { missing: true }, 'the maker\'s own report isn\'t shared')
  assert.equal(forOperator.reports[DAY].runs, true)
  assert.equal(forOperator.can_edit, false)
  const lost = await operator.post('/api/reports/' + page.id + '/blocks/b4/run', {})
  assert.equal(lost.status, 404)
  assert.match(lost.body, /isn't here any more, or isn't shared with you/)
  assert.equal((await ok(operator.post('/api/reports/' + page.id + '/blocks/b1/run', {}))).rows.length, direct.rows.length)

  const forFloor = await opened(floor, page.id)
  assert.equal(forFloor.reports[DAY].runs, false, 'no till reports for this role')
  assert.equal(forFloor.reports[DAY].needs, 'Till reports')
  const refused = await recorded(() => floor.post('/api/reports/' + page.id + '/blocks/b1/run', {}))
  assert.equal(refused.out.status, 403)
  assert.equal(refused.made.length, 1)
  assert.ok(refused.made[0].error, 'the refusal is on the run\'s record')
})

test('a page prints as one: its reports in order under one top, a run recorded for each report, a refusal said in the report\'s place', async () => {
  const page = await newPage(maker, 'Print pack')
  const first = await recorded(() => printed(maker, page.id))
  const html = first.out
  assert.ok(html.includes('<h1>Print pack</h1>'), 'the page\'s name at the top')
  assert.ok(html.includes('<p class="who">Thai House</p>'))
  assert.ok(html.includes('<section class="block"><h2>Sales by day</h2>'))
  assert.ok(html.includes('<section class="block"><h2>Who sold what</h2>'))
  assert.ok(html.includes('<section class="block text"><h2>Notes</h2><p class="words">Line one\nLine two</p></section>'))
  assert.equal(count(html, '<div class="break"></div>'), 1)
  assert.ok(html.indexOf('<h2>Sales by day</h2>') < html.indexOf('<h2>Notes</h2>') && html.indexOf('<h2>Notes</h2>') < html.indexOf('<h2>Who sold what</h2>'), 'in the page\'s order')
  // The period and venues are said once, at the top.
  assert.equal(count(html, '<dt>Period</dt>'), 1)
  assert.ok(html.includes('<dt>Venues</dt><dd>Every venue</dd>'))
  assert.equal(/<p class="blockfacts">[^<]*Period/.test(html), false, 'not again under each report')
  assert.equal(count(html, '<p class="blockfacts">Rows: '), 2)
  // A chart where the report has one and the page shows it.
  assert.equal(count(html, '<figure class="chart">'), 1)
  assert.equal(count(html, '<p class="gone">'), 0)

  assert.equal(first.made.length, 2, 'a run for each report')
  for (const r of first.made) assert.deepEqual([r.kind, r.format, r.user_sub, r.error], ['export', 'print', MAKER, null])
  assert.deepEqual(first.made.map(r => r.starter_key || r.report_id).sort(), ['till_sales_by_day', mine.id].sort())
  assert.equal(first.made.some(r => r.report_id === page.id), false, 'never a run of the page')

  // The visitor's own venues and period.
  const one = await printed(maker, page.id, { venues: [t.V] })
  assert.ok(one.includes('<dt>Venues</dt><dd>' + venueName + '</dd>'))
  const elsewhere = await maker.post('/api/reports/' + page.id + '/print-link', { venues: [venueB] })
  assert.equal(elsewhere.status, 404)
  const lastYear = await printed(maker, page.id, { period: { from: '2020-01-01', to: '2020-01-02' } })
  assert.equal(count(lastYear, '<p class="blockfacts">Rows: 0'), 2, 'no sales then')

  // The page's own layout.
  const layout = (await ok(owner.post('/api/reports/layouts', { name: 'Pack', settings: { footer: { text: 'In confidence' } } }), 'layout')).layout
  await ok(maker.put('/api/reports/' + page.id + '/layout', { layout_id: layout.id }), 'pick the layout')
  assert.ok((await printed(maker, page.id)).includes('In confidence'))

  // Someone the maker's own report isn't shared with: said in its place.
  await share(page.id)
  const forOperator = await recorded(() => printed(operator, page.id))
  assert.equal(count(forOperator.out, '<p class="gone">'), 1)
  assert.match(forOperator.out, GONE)
  assert.ok(forOperator.out.includes('<section class="block"><h2>Sales by day</h2>'), 'the report they can see is there')
  assert.equal(forOperator.made.length, 1, 'only the report that ran')
  assert.equal(forOperator.made[0].starter_key, 'till_sales_by_day')

  // Someone who can't see till sales: every report says so, and nothing runs.
  const forFloor = await recorded(() => printed(floor, page.id))
  assert.equal(count(forFloor.out, '<p class="gone">'), 2)
  assert.equal(count(forFloor.out, '<figure class="chart">'), 0)
  assert.equal(forFloor.made.length, 0)

  // No login and no link: nothing.
  assert.equal((await pub('/api/reports/print/11111111-1111-4111-8111-111111111111')).status, 404)
  assert.equal((await viewer.post('/api/reports/' + page.id + '/print-link', {})).status, 403)
  assert.equal((await ownerB.post('/api/reports/' + page.id + '/print-link', {})).status, 404)
})

test('a page isn\'t run, kept or scheduled itself; it is changed, copied, starred and deleted like a report', async () => {
  const page = await newPage(maker, 'Change pack')
  const at = '/api/reports/' + page.id
  for (const [what, res] of [
    ['run', await maker.post(at + '/run', {})],
    ['csv', await maker.post(at + '/export', { format: 'csv' })],
    ['xlsx', await maker.post(at + '/export', { format: 'xlsx' })],
    ['keep a file', await maker.post(at + '/files', { format: 'csv' })],
    ['schedule', await maker.post(at + '/schedules', { timing: { every: 'day', time: '07:00' }, recipients: [{ me: true }] })],
    ['schedules', await maker.get(at + '/schedules')],
    ['email it now', await maker.post(at + '/send', { recipients: [{ me: true }] })],
  ]) {
    assert.equal(res.status, 422, what + ': ' + res.body.slice(0, 200))
    assert.match(res.body, /This is a page of several reports/, what)
  }

  // A page stays a page, a report a report.
  const asReport = await maker.put(at, { spec: (await opened(maker, mine.id)).spec })
  assert.equal(asReport.status, 422)
  assert.match(asReport.body, /can't be turned into a single report/)
  const asPage = await maker.put('/api/reports/' + mine.id, { spec: pageSpec() })
  assert.equal(asPage.status, 422)
  assert.match(asPage.body, /can't be turned into a page/)

  // Changed: blocks keep their ids, new ones get the next free; no period or venues of its own.
  const changed = (await ok(maker.put(at, {
    name: 'Changed pack',
    spec: {
      kind: 'page',
      blocks: [
        { id: 'b4', type: 'report', ref: mine.id, show: 'table', title: 'Who sold what' },
        { id: 'b1', type: 'report', ref: DAY, show: 'table' },
        { type: 'text', title: 'New note', text: 'Words' },
      ],
      period: null, venues: null,
    },
  }), 'change')).report
  assert.equal(changed.name, 'Changed pack')
  assert.deepEqual(changed.spec.blocks.slice(0, 2).map(b => b.id), ['b4', 'b1'])
  assert.match(changed.spec.blocks[2].id, /^b\d+$/)
  assert.equal(['b4', 'b1'].includes(changed.spec.blocks[2].id), false)
  assert.deepEqual([changed.spec.period, changed.spec.venues], [null, null])
  // Each report then says its own period, and a chart left off isn't drawn.
  const html = await printed(maker, page.id)
  assert.equal(count(html, '<dt>Period</dt>'), 0)
  assert.equal(count(html, '<p class="blockfacts">Period: '), 2)
  assert.equal(count(html, '<figure class="chart">'), 0, 'show: table')
  assert.ok(html.indexOf('<h2>Who sold what</h2>') < html.indexOf('<h2>Sales by day</h2>'), 'the new order')

  // Who may change it.
  assert.equal((await other.put(at, { name: 'Theirs' })).status, 404, 'not shared with them')
  await share(page.id)
  const notTheirs = await other.put(at, { name: 'Theirs' })
  assert.equal(notTheirs.status, 403)
  assert.match(notTheirs.body, /Only the person who made this report/)
  assert.equal((await operator.put(at, { name: 'Theirs' })).status, 403)

  // Copied as the person copying: the owner sees the maker's report, another maker doesn't.
  const copy = await owner.post(at + '/copy', {})
  assert.equal(copy.status, 201, copy.body.slice(0, 200))
  assert.equal(copy.json.report.name, 'Changed pack (copy)')
  assert.equal(copy.json.report.report_kind, 'page')
  assert.equal(copy.json.report.mine, true)
  assert.deepEqual(copy.json.report.spec.blocks, changed.spec.blocks)
  const noCopy = await other.post(at + '/copy', {})
  assert.equal(noCopy.status, 422)
  assert.match(noCopy.body, /isn't shared with you/)

  // Starred like a report.
  assert.deepEqual(await ok(operator.post(at + '/star', {})), { starred: true })
  assert.equal((await ok(operator.get('/api/reports'))).reports.find(r => r.id === page.id).starred, true)

  // A report deleted from under it: said on the page, and in the way of saving until it is taken off.
  const spare = (await ok(maker.post('/api/reports/' + SERVERS + '/copy', { name: 'Spare' }), 'spare')).report
  const withSpare = { kind: 'page', blocks: [{ type: 'report', ref: DAY }, { type: 'report', ref: spare.id }] }
  await ok(maker.put(at, { spec: withSpare }), 'put the spare on')
  assert.equal((await maker.delete('/api/reports/' + spare.id)).status, 204)
  const after = await opened(maker, page.id)
  assert.deepEqual(after.reports[spare.id], { missing: true })
  const gone = await printed(maker, page.id)
  assert.equal(count(gone, '<p class="gone">'), 1)
  assert.match(gone, GONE)
  const again = await maker.put(at, { spec: after.spec })
  assert.equal(again.status, 422)
  assert.match(again.body, /One of the page's reports isn't here any more/)
  await ok(maker.put(at, { spec: { kind: 'page', blocks: [{ type: 'report', ref: DAY }] } }), 'without it')

  // Deleted.
  assert.equal((await operator.delete(at)).status, 403)
  assert.equal((await maker.delete(at)).status, 204)
  assert.equal((await maker.get(at)).status, 404)
})

test('Pepper reads a page as its reports, and says a page isn\'t run, kept or scheduled as one', async () => {
  const page = await newPage(owner, 'Owner pack', { kind: 'page', blocks: [{ type: 'report', ref: DAY }, { type: 'report', ref: SERVERS, title: 'By server' }, { type: 'text', title: 'Note', text: 'x' }], period: today })
  const { token } = await ok(owner.post('/api/ai/tokens', { name: 'Pages' }))

  const got = await call(token, 'get_report', { report: 'Owner pack' })
  assert.equal(got.error, undefined, got.error)
  assert.equal(got.out.id, page.id)
  assert.match(got.out.shows, /^A page of 2 reports and 1 note, to read and print as one$/)
  assert.deepEqual(got.out.reports.map(r => r.name), ['Sales by day', 'Sales by server'])
  assert.equal(got.out.reports[1].titled, 'By server')

  const had = (await runs()).length
  for (const [tool, args, words] of [
    ['run_report', { report: 'Owner pack' }, /is a page of several reports: open it to read or print it, or run its reports one by one/],
    ['export_report', { report: 'Owner pack' }, /is a page of several reports/],
    ['schedule_report', { report: 'Owner pack', to: ['me'], timing: { every: 'week', days: ['monday'], time: '07:30' } }, /its reports are scheduled and emailed one by one/],
    ['send_report', { report: 'Owner pack', to: ['me'] }, /its reports are scheduled and emailed one by one/],
  ]) {
    const res = await call(token, tool, args)
    assert.ok(res.error, tool + ' is refused')
    assert.match(res.error, words, tool)
    assert.match(res.error, /Its reports: "Sales by day", "Sales by server"/, tool + ' names the reports')
  }
  assert.equal((await runs()).length, had, 'nothing ran')
  assert.equal((await sql`SELECT count(*)::int AS n FROM report_schedules WHERE tenant_id = ${ids.a}`)[0].n, 0)
})
