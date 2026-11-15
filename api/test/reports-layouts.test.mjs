// Layout templates (docs/REPORTS.md 11, migration 253): a group's own
// layouts (made, renamed, one default, twenty at most, only by people who
// manage reports), the layout a report prints with (its own pick, else the
// group's default, else as reports print without one), what a layout changes
// on the print page, and trying a draft layout out through the print link.
//
// The sales are the two trading days of support/tillDays.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { printHtml } from '../src/reports/export/print.js'
import { LAYOUT_LIMITS } from '../../shared/reports/layout.js'

const MAKER = 'a-maker'
const OTHER = 'a-other-maker'
const DAY = 'starter:till_sales_by_day'
let ids, t, owner, operator, viewer, maker, other, ownerB, today

/** A request with no login (the internal header only keeps the tests out of the rate limit). */
async function pub(url) {
  const app = await getApp()
  const res = await app.inject({ method: 'GET', url, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  return { status: res.statusCode, headers: res.headers, body: res.body }
}

const runs = () => sql`SELECT * FROM report_runs WHERE tenant_id = ${ids.a} ORDER BY created_at, id`
const layoutRows = () => sql`SELECT * FROM report_layouts WHERE tenant_id = ${ids.a} ORDER BY created_at, id`
const noLayouts = () => sql`DELETE FROM report_layouts WHERE tenant_id = ${ids.a}`
const newLayout = async (who, body) => (await ok(who.post('/api/reports/layouts', body), 'layout ' + body.name)).layout
const listed = async who => (await ok(who.get('/api/reports/layouts'))).layouts

/** A report's print page as someone, with what they picked: the HTML. */
async function pageOf(who, ref, extra = {}) {
  const link = await ok(who.post('/api/reports/' + ref + '/print-link', { params: { period: today }, ...extra }), 'print link')
  const res = await pub(link.path)
  assert.equal(res.status, 200, 'the print page: ' + res.body.slice(0, 200))
  return { html: res.body, link, headers: res.headers }
}
const pageRuleOf = html => html.match(/@page\{size:([^;]*);margin:([^;}]*)/)?.slice(1, 3) || []

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
  // Two people who build reports of their own and manage nothing.
  const role = await ok(owner.post('/api/access/roles', {
    key: 'maker', label: 'Report maker', permissions: { reports: 'use', pos_reports: 'view' },
  }), 'maker role')
  for (const sub of [MAKER, OTHER]) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
              VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${role.id})`
  }
  maker = as(MAKER, ids.a)
  other = as(OTHER, ids.a)
})
after(closeApp)

test('layouts: made, listed with the default first, changed, twenty at most, and only by people who manage reports', async () => {
  await noLayouts()
  const empty = await ok(operator.get('/api/reports/layouts'))
  assert.deepEqual(empty, { layouts: [], can_manage: false, limit: LAYOUT_LIMITS.layouts })
  assert.equal((await ok(owner.get('/api/reports/layouts'))).can_manage, true)
  assert.equal((await viewer.get('/api/reports/layouts')).status, 403, 'no Reports access: no layouts')
  for (const who of [operator, maker]) {
    assert.equal((await who.post('/api/reports/layouts', { name: 'Mine' })).status, 403, 'only Manage makes a layout')
  }

  const pack = await newLayout(owner, {
    name: '  Board pack ',
    settings: { page: { size: 'a4', way: 'landscape', margin: 'wide' }, footer: { text: 'In confidence' }, junk: { x: 1 }, style: { density: 'huge' } },
  })
  assert.equal(pack.name, 'Board pack')
  assert.equal(pack.is_default, false)
  assert.deepEqual(pack.settings.page, { size: 'a4', way: 'landscape', margin: 'wide' })
  assert.equal(pack.settings.footer.text, 'In confidence')
  assert.equal(pack.settings.style.density, 'normal', 'a setting it doesn\'t know is the usual one')
  assert.equal(pack.settings.header.logo, true, 'what wasn\'t said is filled in')
  assert.equal('junk' in pack.settings, false)
  assert.match(pack.words, /^A4, on its side/)
  const [stored] = await layoutRows()
  assert.equal(stored.created_by, 'a-owner@test.local')
  assert.deepEqual(stored.settings, pack.settings, 'stored tidied')

  const twin = await owner.post('/api/reports/layouts', { name: 'board PACK' })
  assert.equal(twin.status, 409)
  assert.match(twin.json.error, /Another layout has that name/)
  assert.equal((await owner.post('/api/reports/layouts', { name: '   ' })).status, 400)
  assert.equal((await owner.post('/api/reports/layouts', { name: 'x'.repeat(LAYOUT_LIMITS.name + 1) })).status, 400)

  // One default for the group: making another the default takes it off the first.
  const plain = await newLayout(owner, { name: 'Plain', is_default: true })
  assert.equal(plain.is_default, true)
  assert.equal(plain.words, 'As reports print without a layout')
  const alpha = await newLayout(owner, { name: 'Alpha', is_default: true })
  assert.deepEqual((await listed(operator)).map(l => [l.name, l.is_default]),
    [['Alpha', true], ['Board pack', false], ['Plain', false]], 'the default first, then by name')
  const back = (await ok(owner.put('/api/reports/layouts/' + plain.id, { is_default: true }))).layout
  assert.equal(back.is_default, true)
  assert.deepEqual((await layoutRows()).filter(r => r.is_default).map(r => r.name), ['Plain'])
  const off = (await ok(owner.put('/api/reports/layouts/' + plain.id, { is_default: false }))).layout
  assert.equal(off.is_default, false, 'a group can have no default')

  // A name alone keeps the settings; settings replace the whole settings.
  const renamed = (await ok(owner.put('/api/reports/layouts/' + pack.id, { name: 'Board pack 2' }))).layout
  assert.equal(renamed.name, 'Board pack 2')
  assert.deepEqual(renamed.settings, pack.settings)
  const reset = (await ok(owner.put('/api/reports/layouts/' + pack.id, { settings: { style: { density: 'compact' } } }))).layout
  assert.equal(reset.settings.style.density, 'compact')
  assert.equal(reset.settings.page.size, 'auto', 'the paper it had is gone: the whole settings were replaced')
  assert.equal(reset.name, 'Board pack 2')
  const taken = await owner.put('/api/reports/layouts/' + pack.id, { name: 'alpha' })
  assert.equal(taken.status, 409)
  assert.equal((await ok(owner.put('/api/reports/layouts/' + pack.id, { name: 'BOARD PACK 2' }))).layout.name, 'BOARD PACK 2', 'its own name in other letters is fine')

  // Refusals: no such layout, another group's, people who don't manage reports.
  assert.equal((await owner.put('/api/reports/layouts/not-a-layout', { name: 'X' })).status, 404)
  assert.equal((await owner.put('/api/reports/layouts/00000000-0000-4000-8000-000000000000', { name: 'X' })).status, 404)
  assert.equal((await ownerB.put('/api/reports/layouts/' + pack.id, { name: 'Theirs now' })).status, 404)
  assert.equal((await ownerB.delete('/api/reports/layouts/' + pack.id)).status, 404)
  assert.equal((await maker.put('/api/reports/layouts/' + pack.id, { name: 'X' })).status, 403)
  assert.equal((await maker.delete('/api/reports/layouts/' + pack.id)).status, 403)
  assert.deepEqual(await listed(ownerB), [], 'another group sees none of them')
  const theirs = await newLayout(ownerB, { name: 'Alpha', is_default: true })
  assert.equal(theirs.is_default, true, 'a name and a default are a group\'s own')
  assert.deepEqual((await layoutRows()).map(r => r.name).sort(), ['Alpha', 'BOARD PACK 2', 'Plain'])

  // Twenty at most.
  await sql`INSERT INTO report_layouts (tenant_id, name, created_by)
            SELECT ${ids.a}, 'Filler ' || g, 'test' FROM generate_series(1, ${LAYOUT_LIMITS.layouts - 3}) g`
  const full = await owner.post('/api/reports/layouts', { name: 'One too many' })
  assert.equal(full.status, 422)
  assert.match(full.json.error, /can keep 20 layouts/)

  const gone = await owner.delete('/api/reports/layouts/' + alpha.id)
  assert.equal(gone.status, 204)
  assert.equal((await owner.delete('/api/reports/layouts/' + alpha.id)).status, 404)
  assert.equal((await newLayout(owner, { name: 'Room again' })).name, 'Room again')
  await sql`DELETE FROM report_layouts WHERE tenant_id = ${ids.b}`
})

test('a report\'s own layout: picked by whoever may change the report, never for a starter, never another group\'s layout', async () => {
  await noLayouts()
  const layout = await newLayout(owner, { name: 'Wide', settings: { page: { way: 'landscape' } } })
  const theirs = await newLayout(ownerB, { name: 'Theirs' })
  const mine = (await ok(maker.post('/api/reports/' + DAY + '/copy', { name: 'My sales by day' }), 'copy')).report
  assert.equal(mine.layout_id, null)

  const picked = await ok(maker.put('/api/reports/' + mine.id + '/layout', { layout_id: layout.id }))
  assert.deepEqual(picked, { id: mine.id, layout_id: layout.id })
  assert.equal((await ok(maker.get('/api/reports/' + mine.id))).report.layout_id, layout.id)
  assert.equal((await ok(maker.get('/api/reports'))).reports.find(r => r.id === mine.id).layout_id, layout.id, 'the list says it too')
  assert.equal((await ok(maker.get('/api/reports/' + DAY))).report.layout_id, null, 'a starter has none')

  // Someone else who builds reports can open it once it is shared, and still can't change how it prints.
  assert.equal((await other.put('/api/reports/' + mine.id + '/layout', { layout_id: null })).status, 404, 'not shared: not there for them')
  await ok(owner.patch('/api/reports/' + mine.id + '/sharing', { shared: 'everyone' }), 'share')
  const notTheirs = await other.put('/api/reports/' + mine.id + '/layout', { layout_id: null })
  assert.equal(notTheirs.status, 403)
  assert.match(notTheirs.json.error, /Only the person who made this report/)
  assert.equal((await operator.put('/api/reports/' + mine.id + '/layout', { layout_id: null })).status, 403, 'View changes nothing')
  assert.equal((await ok(maker.get('/api/reports/' + mine.id))).report.layout_id, layout.id, 'unchanged by the refusals')

  const starter = await maker.put('/api/reports/' + DAY + '/layout', { layout_id: layout.id })
  assert.equal(starter.status, 422)
  assert.match(starter.json.error, /starter report comes with Macaroonie/)
  const foreign = await maker.put('/api/reports/' + mine.id + '/layout', { layout_id: theirs.id })
  assert.equal(foreign.status, 404)
  assert.match(foreign.json.error, /Layout not found/)
  assert.equal((await maker.put('/api/reports/00000000-0000-4000-8000-000000000000/layout', { layout_id: layout.id })).status, 404)
  assert.equal((await ownerB.put('/api/reports/' + mine.id + '/layout', { layout_id: theirs.id })).status, 404, 'another group\'s report')
  assert.equal((await maker.put('/api/reports/' + mine.id + '/layout', { layout_id: 'wide' })).status, 400)
  assert.equal((await ok(maker.get('/api/reports/' + mine.id))).report.layout_id, layout.id)

  // Someone who manages reports changes anyone's; null puts it back on the group's default.
  assert.deepEqual(await ok(owner.put('/api/reports/' + mine.id + '/layout', { layout_id: null })), { id: mine.id, layout_id: null })
  assert.equal((await ok(maker.get('/api/reports/' + mine.id))).report.layout_id, null)
  await ok(owner.delete('/api/reports/' + mine.id))
  await sql`DELETE FROM report_layouts WHERE tenant_id = ${ids.b}`
})

test('the print page is drawn by the report\'s layout, else the group\'s default, else as before', async () => {
  await noLayouts()
  const mine = (await ok(maker.post('/api/reports/' + DAY + '/copy', { name: 'Sales for the board' }), 'copy')).report

  // No layout: as reports always printed.
  const plain = (await pageOf(maker, mine.id)).html
  assert.match(pageRuleOf(plain)[0], /^(portrait|landscape)$/, 'no paper named: the print window\'s own')
  assert.equal(pageRuleOf(plain)[1], '12mm 10mm 14mm')
  assert.match(plain, /@bottom-right\{content:"Page " counter\(page\) " of " counter\(pages\)/)
  assert.equal(plain.includes('@bottom-left'), false)
  assert.equal(plain.includes('class="front"'), false)
  assert.equal(plain.includes('nth-child(even)'), false)
  assert.match(plain, /<p class="who">Thai House<\/p><h1>Sales for the board<\/h1>/)
  assert.match(plain, /<dt>Period<\/dt>/)
  assert.match(plain, /<dt>Rows<\/dt>/)
  assert.match(plain, /<footer class="foot"><span>Figures as of [^<]+<\/span><span>Printed by a-maker@test\.local<\/span><\/footer>/)

  // The group's default: every report without a pick of its own, starters too.
  const usual = await newLayout(owner, {
    name: 'Usual', is_default: true,
    settings: { page: { size: 'letter', way: 'landscape', margin: 'narrow' }, footer: { text: 'Thai House "in confidence"' } },
  })
  for (const ref of [mine.id, DAY]) {
    const { html, link } = await pageOf(maker, ref)
    assert.deepEqual(pageRuleOf(html), ['letter landscape', '8mm 6mm 10mm'], ref)
    assert.match(html, /<body class="landscape[" ]/)
    assert.match(html, /@bottom-left\{content:"Thai House \\22 in confidence\\22 "/, 'the footer words on every sheet, safe inside the page rule')
    assert.match(html, /<p class="footwords">Thai House &quot;in confidence&quot;<\/p>/)
    const [row] = await sql`SELECT layout, preview FROM report_print_links WHERE id = ${link.path.split('/').pop()}`
    assert.equal(row.layout.page.size, 'letter', 'the link holds the layout as it was')
    assert.equal(row.preview, false)
  }

  // The report's own pick wins, and says what to leave off.
  const pack = await newLayout(owner, {
    name: 'Board pack',
    settings: {
      page: { size: 'a4', way: 'portrait' },
      header: { group: false, about: false, period: false, choices: false, run: false },
      footer: { numbers: false },
      style: { brand: true, density: 'roomy', stripes: true },
      front: { on: true, text: 'For the board\nNot for sharing <b>' },
    },
  })
  await ok(maker.put('/api/reports/' + mine.id + '/layout', { layout_id: pack.id }))
  const made = await pageOf(maker, mine.id)
  const packed = made.html
  assert.deepEqual(pageRuleOf(packed), ['A4 portrait', '12mm 10mm 14mm'])
  assert.match(packed, /<body class="portrait[" ]/)
  assert.equal(packed.includes('@bottom-right'), false, 'no sheet numbers')
  assert.equal(packed.includes('@bottom-left'), false)
  assert.equal(packed.includes('class="who"'), false, 'the group\'s name is left off')
  assert.equal(packed.includes('class="about"'), false, 'and the description')
  assert.match(packed, /<dl class="facts"><\/dl>/, 'and the period, the choices and the row count')
  assert.equal(packed.includes('class="foot"'), false, 'and when the figures were read')
  assert.match(packed, /<section class="front"><p class="fronttitle">Sales for the board<\/p><p class="frontfact">[^<]+<\/p><p class="words">For the board\nNot for sharing &lt;b&gt;<\/p><\/section>/,
    'a front page with the title, the period and its own words, escaped')
  assert.match(packed, /tbody tr:nth-child\(even\):not\(\.sub\):not\(\.total\) td\{background:/, 'striped rows')
  assert.match(packed, /\.top\{border-bottom-color:#[0-9a-f]{6}\}th,th\.dim\{background:#[0-9a-f]{6};/, 'the brand colour on the headings')
  assert.match(packed, /th,td\{padding-top:\d+px;padding-bottom:\d+px\}/, 'roomier rows')
  assert.deepEqual(pageRuleOf((await pageOf(maker, DAY)).html), ['letter landscape', '8mm 6mm 10mm'], 'other reports keep the default')

  // A link holds the layout as it was when it was made: changing the layout doesn't change that page.
  await ok(owner.put('/api/reports/layouts/' + pack.id, { settings: { page: { size: 'letter', way: 'landscape' } } }))
  assert.deepEqual(pageRuleOf((await pub(made.link.path)).body), ['A4 portrait', '12mm 10mm 14mm'])
  assert.deepEqual(pageRuleOf((await pageOf(maker, mine.id)).html), ['letter landscape', '12mm 10mm 14mm'], 'a new link has the change')

  // Deleting a layout puts its reports back on the default; deleting the default, back to none.
  assert.equal((await owner.delete('/api/reports/layouts/' + pack.id)).status, 204)
  assert.equal((await ok(maker.get('/api/reports/' + mine.id))).report.layout_id, null)
  assert.deepEqual(pageRuleOf((await pageOf(maker, mine.id)).html), ['letter landscape', '8mm 6mm 10mm'])
  assert.equal((await owner.delete('/api/reports/layouts/' + usual.id)).status, 204)
  const bare = (await pageOf(maker, mine.id)).html
  assert.equal(pageRuleOf(bare)[1], '12mm 10mm 14mm')
  assert.equal(bare.includes('@bottom-left'), false)
  await ok(owner.delete('/api/reports/' + mine.id))
})

test('trying a layout out: a draft through the print link, for people who manage reports, in a frame, with no bar or script, never recorded', async () => {
  await noLayouts()
  const draft = { page: { size: 'a4', way: 'landscape' }, footer: { text: 'Draft footer' }, junk: 1 }
  for (const [who, body] of [[operator, { layout: draft, preview: true }], [maker, { layout: draft, preview: true }], [maker, { layout: draft }], [maker, { preview: true }]]) {
    const no = await who.post('/api/reports/' + DAY + '/print-link', { params: { period: today }, ...body })
    assert.equal(no.status, 403, JSON.stringify(Object.keys(body)))
    assert.match(no.json.error, /Trying a layout out needs Manage on Reports/)
  }
  assert.equal((await sql`SELECT count(*)::int AS n FROM report_print_links WHERE tenant_id = ${ids.a} AND preview`)[0].n, 0)

  // An ordinary link of the owner's, to see it left alone by the previews.
  const usual = await pageOf(owner, DAY)
  assert.match(usual.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.match(usual.headers['content-security-policy'], /script-src 'nonce-[^']+'/)
  assert.match(usual.html, /<button type="button" id="print">Print<\/button>/)
  assert.match(usual.html, /<script nonce="[^"]+">/)
  const recorded = (await runs()).length
  assert.equal((await runs()).at(-1).format, 'print', 'an ordinary print page is recorded')

  const first = await pageOf(owner, DAY, { layout: draft, preview: true })
  const [row] = await sql`SELECT layout, preview FROM report_print_links WHERE id = ${first.link.path.split('/').pop()}`
  assert.equal(row.preview, true)
  assert.equal(row.layout.footer.text, 'Draft footer')
  assert.equal('junk' in row.layout, false, 'the draft is kept tidied')
  assert.deepEqual(pageRuleOf(first.html), ['A4 landscape', '12mm 10mm 14mm'])
  assert.match(first.html, /<p class="footwords">Draft footer<\/p>/)
  assert.match(first.html, /<body class="landscape[^"]* preview"/)
  assert.equal(first.html.includes('<script'), false, 'no script')
  assert.equal(first.html.includes('id="print"'), false, 'no bar')
  const csp = first.headers['content-security-policy']
  assert.match(csp, /frame-ancestors 'self'/, 'shown in a frame of the app')
  assert.equal(csp.includes('script-src'), false)
  assert.equal(first.headers['cache-control'], 'private, no-store')
  assert.equal((await runs()).length, recorded, 'looking at a preview isn\'t a run')

  // The next preview takes the person's earlier one away, and leaves their ordinary link.
  const second = await pageOf(owner, DAY, { layout: { ...draft, footer: { text: 'Second draft' } }, preview: true })
  assert.match(second.html, /Second draft/)
  assert.equal((await pub(first.link.path)).status, 404, 'the earlier preview is gone')
  assert.equal((await pub(usual.link.path)).status, 200)
  assert.equal((await sql`SELECT count(*)::int AS n FROM report_print_links WHERE tenant_id = ${ids.a} AND preview`)[0].n, 1)
  assert.equal((await runs()).length, recorded + 1, 'only the ordinary page opened again was recorded')

  // A saved layout is tried the same way, with no draft: the report as it prints now.
  const saved = await newLayout(owner, { name: 'Saved', is_default: true, settings: { footer: { text: 'Saved footer' } } })
  const third = await pageOf(owner, DAY, { preview: true })
  assert.match(third.html, /<p class="footwords">Saved footer<\/p>/)
  assert.equal(third.html.includes('<script'), false)
  await ok(owner.delete('/api/reports/layouts/' + saved.id))
})

test('negative figures as the layout says, and a header that leaves parts off', () => {
  const result = {
    kind: 'summary', spec: { view: { kind: 'table' } },
    columns: [{ key: 'name', label: 'Dish', type: 'text', role: 'row' }, { key: 'net', label: 'Net', type: 'money', role: 'value' }],
    rows: [{ kind: 'row', level: 0, k: ['Refunds'], cells: ['Refunds', -12.5] }, { kind: 'row', level: 0, k: ['Curry'], cells: ['Curry', 30] }],
    totals: { cells: [null, 17.5] },
    meta: { currency: 'GBP', tz: 'Europe/London', generated_at: '2026-11-13T14:22:00Z', notes: [] },
  }
  const page = extra => printHtml({
    group: 'Thai House', logo: '/uploads/logo.png', brand: '#630812', name: 'Net by dish', description: 'What each dish took',
    facts: [['Period', 'Today', 'period'], ['Venues', 'Ware', 'venues'], ['Server', 'Ann'], ['Rows', '2', 'rows']],
    result, by: 'a@b.c', nonce: 'n1', ...extra,
  })
  const cell = html => html.match(/<td[^>]*>[^<]*12\.50[^<]*<\/td>/)[0]

  const usual = page({})
  assert.match(cell(usual), /^<td class="r">[^(<]*£12\.50<\/td>$/, 'a minus, in the usual ink')
  assert.match(usual, /<img [^>]*src="\/uploads\/logo\.png"/)
  assert.match(usual, /<dt>Period<\/dt><dd>Today<\/dd><dt>Venues<\/dt><dd>Ware<\/dd><dt>Server<\/dt><dd>Ann<\/dd><dt>Rows<\/dt><dd>2<\/dd>/)
  assert.match(usual, /<p class="about">What each dish took<\/p>/)

  assert.equal(cell(page({ layout: { style: { negatives: 'brackets' } } })), '<td class="r">(£12.50)</td>')
  const red = cell(page({ layout: { style: { negatives: 'red' } } }))
  assert.match(red, /^<td class="r neg">/)
  assert.equal(red.includes('('), false)
  assert.equal(page({ layout: { style: { negatives: 'red' } } }).includes('£30.00</td>'), true)
  assert.match(page({ layout: { style: { negatives: 'red' } } }), /<td class="r">£30\.00<\/td>/, 'only what is below nothing')

  const lean = page({ layout: { header: { logo: false, choices: false } } })
  assert.equal(lean.includes('<img'), false, 'no logo')
  assert.match(lean, /<dl class="facts"><dt>Period<\/dt><dd>Today<\/dd><\/dl>/, 'the period stays; venues, other choices and the row count go')
  const undated = page({ layout: { header: { period: false } } })
  assert.match(undated, /<dl class="facts"><dt>Venues<\/dt>/)
  assert.equal(undated.includes('<dt>Period</dt>'), false)
})
