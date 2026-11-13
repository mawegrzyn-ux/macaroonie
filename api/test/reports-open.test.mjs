// Opening the record a report's row stands for (docs/REPORTS.md 8): a list's
// rows carry what their page in the app needs (meta.open says which page,
// row.open its values), for the person asking only, never in a file; the
// report can say what its rows open (drill.open: 'self', a path of links or
// 'none'); the rows behind a tapped row of a summary open the same way; and
// the catalogue refuses an open it can't keep.
//
// The sales are the two trading days of support/tillDays.mjs and the online
// days of support/onlineDays.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { sellOnline, D1, D3 } from './support/onlineDays.mjs'
import { runner, LEVELS } from './support/reports.mjs'
import { CATALOGUE, openTarget, catalogueView } from '../src/reports/catalogue/index.js'
import { subject, text } from '../src/reports/catalogue/define.js'
import { compileReport } from '../src/reports/compile.js'
import { normaliseReport } from '../../shared/reports/spec.js'

let ids, run, runB, t, owner, V, filled, sold, floor
const FLOOR = 'a-floor-open'
const CHECK_PAGE = '/pos/reports?check=:id&venue=:venue'
const DAY_PAGE = '/pos/reports?day=:id&venue=:venue'
const ORDER_PAGE = '/orders?order=:id'
const BOOKING_PAGE = '/bookings?booking=:id'
const list = (subjectKey, rows, more = {}) => ({ subject: subjectKey, kind: 'list', rows, ...more })

before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  sold = await sellOnline({ owner, tenantId: ids.a, venueId: V })
  run = runner(ids.a)
  runB = runner(ids.b)
  // Someone who may run reports on bookings and nothing else.
  const role = await ok(owner.post('/api/access/roles', {
    key: 'floor_open', label: 'Floor open', permissions: { reports: 'use', bookings: 'view' },
  }), 'floor role')
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${FLOOR + '@test.local'}, 'operator', ${FLOOR}, ${role.id})`
  floor = as(FLOOR, ids.a)
})
after(closeApp)

test('a list of checks: each row carries the check and its venue, and the page says where they open', async () => {
  const res = await run(list('till.checks', ['number', 'status']))
  assert.deepEqual(res.meta.open, { page: CHECK_PAGE, label: 'Open the check' })
  const checks = await sql`SELECT id, venue_id FROM pos_checks WHERE tenant_id = ${ids.a}`
  const venueOf = Object.fromEntries(checks.map(c => [c.id, c.venue_id]))
  assert.ok(res.rows.length >= 5)
  for (const r of res.rows) assert.deepEqual(r.open, { id: r.id, venue: venueOf[r.id] }, 'row ' + r.id)
  // The columns asked for, and nothing else: the values ride beside the cells.
  assert.deepEqual(res.columns.map(c => c.key), ['number', 'status'])
  assert.ok(res.rows.every(r => r.cells.length === 2))
  assert.ok(!JSON.stringify(res).includes('_o_'), 'no working columns reach the page')
})

test('rows of another kind open the record they belong to, by its link, or the one a report names', async () => {
  // A dish sold opens its check (till.lines opens 'check').
  const lines = await run(list('till.lines', ['name', 'qty']))
  assert.deepEqual(lines.meta.open, { page: CHECK_PAGE, label: 'Open the check' })
  const lineRows = await sql`
    SELECT l.id, l.day_id AS line_day, c.id AS check_id, c.day_id AS check_day, c.venue_id
    FROM pos_check_lines l JOIN pos_checks c ON c.id = l.check_id WHERE l.tenant_id = ${ids.a}`
  const lineOf = Object.fromEntries(lineRows.map(l => [String(l.id), l]))
  assert.ok(lines.rows.length >= 3)
  for (const r of lines.rows) {
    const l = lineOf[String(r.id)]
    assert.deepEqual(r.open, { id: l.check_id, venue: l.venue_id }, 'line ' + r.id)
  }

  // Two links on: each dish's check's trading day.
  const days = await run(list('till.lines', ['name'], { drill: { open: 'check.day' } }))
  assert.deepEqual(days.meta.open, { page: DAY_PAGE, label: 'Open the trading day' })
  for (const r of days.rows) {
    const l = lineOf[String(r.id)]
    assert.deepEqual(r.open, { id: l.check_day, venue: l.venue_id }, 'line ' + r.id)
  }
  assert.ok(days.rows.some(r => r.open.id === t.day1) && days.rows.some(r => r.open.id === t.day2))
  // One link on: the dish's own trading day.
  const viaDay = await run(list('till.lines', ['name'], { drill: { open: 'day' } }))
  assert.equal(viaDay.meta.open.page, DAY_PAGE)
  for (const r of viaDay.rows) {
    const l = lineOf[String(r.id)]
    assert.deepEqual(r.open, { id: l.line_day, venue: l.venue_id }, 'line ' + r.id)
  }

  // A dish's own page in the menu editor: the menu it is on comes along.
  const dishes = await run(list('till.lines', ['name'], { drill: { open: 'item' } }))
  assert.equal(dishes.meta.open.page, '/menus?edit=:menu&dish=:id')
  const dishRows = await sql`SELECT i.id, s.menu_id FROM menu_items i JOIN menu_sections s ON s.id = i.section_id WHERE i.tenant_id = ${ids.a}`
  const menuOf = Object.fromEntries(dishRows.map(d => [d.id, d.menu_id]))
  const withDish = dishes.rows.filter(r => r.open)
  assert.ok(withDish.length >= 3)
  for (const r of withDish) assert.equal(r.open.menu, menuOf[r.open.id])

  // Nothing: no page, no values.
  for (const open of ['none', 'self']) {
    const none = await run(list('till.lines', ['name'], { drill: { open } }))
    assert.equal(none.meta.open, null, open)
    assert.ok(none.rows.every(r => !('open' in r)), open)
  }
})

test('a row opens only what the person asking may open, decided at every run', async () => {
  // Without Menus a dish can't open; without Customers a booking's guest can't.
  const noMenus = { ...LEVELS, menus: 'none' }
  const res = await run(list('till.lines', ['name'], { drill: { open: 'item' } }), undefined, { levels: noMenus })
  assert.equal(res.meta.open, null)
  assert.ok(res.rows.every(r => !r.open))
  // The usual still works: the check needs Till reports, which they have.
  const usual = await run(list('till.lines', ['name']), undefined, { levels: noMenus })
  assert.equal(usual.meta.open.page, CHECK_PAGE)

  const bookings = await run(list('bookings.bookings', ['guest_name']))
  assert.deepEqual(bookings.meta.open, { page: BOOKING_PAGE, label: 'Open the booking' })
  assert.ok(bookings.rows.length >= 1 && bookings.rows.every(r => r.open && r.open.id === r.id))
  const guest = await run(list('bookings.bookings', ['guest_name'], { drill: { open: 'customer' } }))
  assert.equal(guest.meta.open.page, '/customers?customer=:id')
  const noGuests = await run(list('bookings.bookings', ['guest_name'], { drill: { open: 'customer' } }), undefined, { levels: { ...LEVELS, customers: 'none' } })
  assert.equal(noGuests.meta.open, null)

  // Through the route, as someone with Bookings only: the usual opens, the guest doesn't.
  const viaRoute = await ok(floor.post('/api/reports/preview', { spec: list('bookings.bookings', ['guest_name']), fresh: true }))
  assert.equal(viaRoute.meta.open.page, BOOKING_PAGE)
  const refusedGuest = await ok(floor.post('/api/reports/preview', { spec: list('bookings.bookings', ['guest_name'], { drill: { open: 'customer' } }), fresh: true }))
  assert.equal(refusedGuest.meta.open, null)
  assert.ok(refusedGuest.rows.every(r => !r.open))

  // A deposit opens its booking.
  const deposits = CATALOGUE.subjects['bookings.deposits']
  assert.equal(deposits.open, 'booking')
  assert.equal(openTarget('bookings.deposits', null, LEVELS).page, BOOKING_PAGE)

  // Another group's list never holds this group's checks, so never opens one.
  const theirs = await runB(list('till.checks', ['number']))
  const ours = new Set(Object.values(t.checks))
  assert.ok(theirs.rows.every(r => !ours.has(r.id) && !ours.has(r.open?.id)), 'no checks of A in B')
})

test('online sales: the group\'s own orders open on the Online orders page, GloriaFood ones open nothing', async () => {
  const period = { field: 'date', op: 'in_period', value: { from: D1, to: D3 } }
  const res = await run(list('online.sales', ['source', 'number'], { filters: [period] }))
  assert.deepEqual(res.meta.open, { page: ORDER_PAGE, label: 'Open the order' })
  const own = res.rows.filter(r => r.cells[0] === 'web')
  assert.ok(own.length >= 3)
  const ownIds = new Set(Object.values(sold.own))
  for (const r of own) {
    assert.ok(ownIds.has(r.id), 'one of the group\'s own orders')
    assert.deepEqual(r.open, { id: r.id })
  }
  const gf = res.rows.filter(r => r.cells[0] === 'gloriafood')
  assert.ok(gf.length >= 1, 'GloriaFood orders are on the list')
  assert.ok(gf.every(r => !r.open), 'and open nothing')

  const orders = await run(list('online.orders', ['number'], { filters: [period] }))
  assert.equal(orders.meta.open.page, ORDER_PAGE)
  assert.ok(orders.rows.every(r => r.open?.id === r.id))
  const items = await run(list('online.items', ['name'], { filters: [period] }))
  assert.equal(items.meta.open.page, ORDER_PAGE)
  const orderIds = new Set(orders.rows.map(r => r.id))
  assert.ok(items.rows.length >= 3 && items.rows.every(r => orderIds.has(r.open?.id)))
})

test('a summary has no rows to open; the rows behind a tapped row do, unless the report says nothing', async () => {
  const day = 'starter:till_sales_by_day'
  const today = { from: t.date, to: t.date }
  const whole = await ok(owner.post(`/api/reports/${day}/run`, { params: { period: today }, fresh: true }))
  assert.equal(whole.kind, 'summary')
  assert.equal(whole.meta.open, null)
  assert.ok(whole.rows.every(r => !r.open))

  const step = { at: [{ field: 'date', value: t.date }], to: 'rows' }
  const behind = await ok(owner.post(`/api/reports/${day}/run`, { params: { period: today }, drill: [step], fresh: true }))
  assert.equal(behind.kind, 'list')
  assert.deepEqual(behind.meta.open, { page: CHECK_PAGE, label: 'Open the check' })
  assert.ok(behind.rows.length >= 4 && behind.rows.every(r => r.open?.id === r.id && r.open.venue === t.V))

  // A report of its own that says its rows open their trading day, or nothing.
  const spec = { subject: 'till.checks', rows: ['date'], values: [{ measure: 'checks' }], filters: [{ field: 'date', op: 'in_period', value: today }] }
  for (const [open, page] of [['day', DAY_PAGE], ['none', null]]) {
    const saved = await ok(owner.post('/api/reports', { name: 'Open ' + open, spec: { ...spec, drill: { open } } }))
    assert.equal(saved.report.spec.drill.open, open)
    const rows = await ok(owner.post(`/api/reports/${saved.report.id}/run`, { drill: [step], fresh: true }))
    assert.equal(rows.meta.open?.page ?? null, page, open)
    assert.equal(rows.spec.drill?.open, open, 'the drilled definition keeps it')
  }
})

test('files carry the report\'s columns only: nothing a row opens goes into a CSV or a spreadsheet', async () => {
  const spec = list('till.checks', ['number', 'status'])
  const res = await owner.post('/api/reports/export', { spec, format: 'csv' })
  assert.equal(res.status, 200)
  const lines = String(res.body).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  assert.equal(lines[0].split(',').length, 2, 'two columns: ' + lines[0])
  assert.ok(lines.length >= 6, 'the checks are in it')
  assert.ok(!res.body.includes('_o_') && !res.body.includes(t.V), 'no venue ids, no working columns')
  // The same list on the page carries the venue on every row.
  const page = await ok(owner.post('/api/reports/preview', { spec, fresh: true }))
  assert.ok(page.rows.length >= 5 && page.rows.every(r => r.open?.venue === t.V), 'the page has them')
  // A file's rows (the spreadsheet's) aren't worked out with them at all.
  const forFile = await run(spec, undefined, { mode: 'export' })
  assert.ok(forFile.rows.length >= 5 && forFile.meta.open == null && forFile.rows.every(r => !('open' in r)), 'a file\'s rows open nothing')
  // Nor is the statement a file runs: no working columns, no joins for them.
  const env = { tenantId: ids.a, levels: LEVELS, params: {}, today: t.date, tz: 'Europe/London' }
  const dishes = normaliseReport(list('till.lines', ['name']))
  const onPage = compileReport(dishes, env)
  assert.ok(onPage.open && onPage.rows.text.includes('_o_id'), 'the page\'s statement has them')
  const inFile = compileReport(dishes, env, { open: false })
  assert.equal(inFile.open, null)
  assert.ok(!inFile.rows.text.includes('_o_'), 'the file\'s doesn\'t')
})

test('a check opened by its address: its venue and day, the names its history needs, and no check without a check\'s id', async () => {
  const id = Object.values(t.checks)[0]
  const got = await ok(owner.get('/api/pos/checks/' + id), 'the check')
  const [row] = await sql`SELECT venue_id, day_id FROM pos_checks WHERE id = ${id}`
  assert.equal(got.venue_id, row.venue_id)
  assert.equal(got.day_id, row.day_id, 'its trading day: the list behind it')
  assert.equal(got.names.staff[t.leadId], t.lead, 'the venue\'s staff by id (a check given to someone)')
  // Not there, or not a check's id at all (an address typed wrong): the same answer.
  for (const bad of ['01JZZZZZZZZZZZZZZZZZZZZZZZ', '00000000-0000-4000-8000-000000000000', 'nope']) {
    const res = await owner.get('/api/pos/checks/' + bad)
    assert.equal(res.status, 404, bad)
    assert.equal(res.json?.error, 'Check not found', bad)
  }
  // Another group's check isn't there for this one.
  const other = await as(B.owner, ids.b).get('/api/pos/checks/' + id)
  assert.equal(other.status, 404)
})

test('the catalogue: who sees a page, what rows usually open, and an open it can\'t keep is refused', () => {
  const all = catalogueView(LEVELS)
  assert.deepEqual(all.subjects['till.checks'].page, { label: 'Open the check' })
  assert.equal(all.subjects['till.checks'].opens, 'self')
  assert.equal(all.subjects['till.lines'].opens, 'check')
  assert.ok(!all.subjects['till.lines'].page, 'a dish sold has no page of its own')
  const noTill = catalogueView({ ...LEVELS, pos_reports: 'none' })
  assert.ok(!noTill.subjects['till.checks'].page, 'no page for someone who can\'t open it')
  assert.ok(!JSON.stringify(all).includes('/pos/reports?'), 'the page\'s address isn\'t in the catalogue view')

  // openTarget(): the usual, a path, too far, through a list, unknown.
  assert.equal(openTarget('till.checks', null, LEVELS).page, CHECK_PAGE)
  assert.equal(openTarget('till.lines', 'check.day', LEVELS).page, DAY_PAGE)
  assert.equal(openTarget('till.lines', 'check.day.venue', LEVELS), null, 'three links is too far')
  assert.equal(openTarget('till.lines', 'item.section', LEVELS).page, '/menus?edit=:menu&section=:id', 'two links reach a page')
  assert.equal(openTarget('till.lines', 'item.section.menu', LEVELS), null, 'three links is too far, even to a page')
  assert.equal(openTarget('till.checks', 'lines', LEVELS), null, 'a list of rows has no one row to open')
  assert.equal(openTarget('guests.customers', 'bookings', LEVELS), null, 'nor has a list of rows with pages of their own')
  // A link the role can't see is never followed, even to a page the role may open.
  const link = CATALOGUE.subjects['till.lines'].links.check
  link.needs = 'menus'
  try {
    assert.equal(openTarget('till.lines', 'check', { ...LEVELS, menus: 'none' }), null, 'the link is hidden from them')
    assert.equal(openTarget('till.lines', 'check', LEVELS).page, CHECK_PAGE, 'and followed by someone who can see it')
  } finally { delete link.needs }
  assert.equal(openTarget('till.lines', 'self', LEVELS), null, 'a dish sold has no page of its own')
  assert.equal(openTarget('bookings.bookings', 'customer', { ...LEVELS, customers: 'none' }), null, 'a link the role can\'t see')
  assert.equal(openTarget('till.checks', 'nowhere', LEVELS), null)
  assert.equal(openTarget('till.checks', 'none', LEVELS), null)
  assert.equal(openTarget('nope', null, LEVELS), null)

  // subject(): the shapes an open must have.
  const base = { key: 'x.things', label: 'Things', one: 'thing', area: 'till', module: 'pos_reports', from: 'pos_checks', fields: { name: text('number') } }
  assert.ok(subject({ ...base, open: { page: '/x?thing=:id', module: 'pos_reports' } }).open)
  assert.ok(subject({ ...base, open: { page: '/x?thing=:id&venue=:venue', module: 'pos_reports', with: { venue: 'venue_id' } } }).open.with.venue)
  for (const [bad, why] of [
    [{ page: 'x?thing=:id', module: 'pos_reports' }, /page in the app/],
    [{ page: '/x?thing=1', module: 'pos_reports' }, /page in the app/],
    [{ page: '/x?thing=:id' }, /module/],
    [{ page: '/x?thing=:id&venue=:venue', module: 'pos_reports' }, /:venue/],
    [{ page: '/x?thing=:id', module: 'pos_reports', with: { venue: 'venue_id' } }, /doesn't use/],
    [{ page: '/x?thing=:id', module: 'pos_reports', with: { id: 'id' } }, /can't name/],
    ['Not a key', /link's key/],
  ]) assert.throws(() => subject({ ...base, open: bad }), why, JSON.stringify(bad))
})
