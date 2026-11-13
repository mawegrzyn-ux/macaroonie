// Pepper's report tools (src/ai/tools/reports.js, docs/REPORTS.md 16) on the
// staff connector and in the chat: which tools each role is offered, the
// catalogue in words (find_fields, explain_figure), saved reports and the
// starters (list_reports, get_report, run_report), a question answered from
// a plan (ask_data), and the changes (build, change, copy, delete, share).
// Everything goes through the report routes as the person; runs Pepper asks
// for are recorded as Pepper's and limited per person per minute, and that
// mark is believed only from the server itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { CATALOGUE } = await import('../src/reports/catalogue/index.js')
const { PEPPER_HEADER, PEPPER_RUNS_PER_MINUTE } = await import('../src/reports/access.js')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { officeOrigin } = await import('../src/services/platformHost.js')

let ids, filled, owner, admin, operator, ownerB
const tokens = {}

const READING = ['find_fields', 'explain_figure', 'list_reports', 'get_report', 'run_report']
const CHANGING = ['build_report', 'change_report', 'copy_report', 'delete_report', 'share_report']
const ALL = [...READING, 'ask_data', ...CHANGING]

const SERVER_PLAN = {
  subject: 'till.checks',
  by: [{ field: 'server.name' }],
  figures: [{ figure: 'net_sales' }],
  period: { relative: 'today' },
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
const listed = async token => (await mcp(token, 'tools/list')).json.result.tools.map(t => t.name)

/** A tool called on the connector: { out } on success, { error } with the message when refused. */
async function call(token, name, args) {
  const r = await mcp(token, 'tools/call', { name, arguments: args })
  assert.ok(r.json?.result, name + ': ' + r.body.slice(0, 300))
  const text = r.json.result.content[0].text
  return r.json.result.isError ? { error: text } : { out: JSON.parse(text) }
}
async function done(token, name, args) {
  const r = await call(token, name, args)
  assert.equal(r.error, undefined, name + ' refused: ' + r.error)
  return r.out
}
async function refused(token, name, args, pattern) {
  const r = await call(token, name, args)
  assert.ok(r.error, name + ' should have been refused: ' + JSON.stringify(r.out)?.slice(0, 300))
  if (pattern) assert.match(r.error, pattern)
  return r.error
}

const pepperRuns = async sub => (await sql`
  SELECT count(*)::int AS n FROM report_runs
   WHERE tenant_id = ${ids.a} AND user_sub = ${sub} AND params->>'via' = 'pepper'`)[0].n
// Runs from earlier tests mustn't count towards the limit in the next one.
const ageRuns = () => sql`UPDATE report_runs SET created_at = created_at - interval '5 minutes' WHERE tenant_id = ${ids.a}`

async function operatorRole() {
  const roles = await ok(owner.get('/api/access/roles'))
  return roles.find(r => r.key === 'operator')
}

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  ownerB = as(B.owner, ids.b)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
  tokens.owner = (await ok(owner.post('/api/ai/tokens', { name: 'Reports' }))).token
  tokens.admin = (await ok(admin.post('/api/ai/tokens', { name: 'Reports' }))).token
  tokens.operator = (await ok(operator.post('/api/ai/tokens', { name: 'Reports' }))).token
  tokens.read = (await ok(owner.post('/api/ai/tokens', { name: 'Reports, read only', read_only: true }))).token
})
test.after(async () => { await claude.close(); await closeApp() })
test.beforeEach(async () => { forgetReportResults(); if (ids) await ageRuns() })

test('the connector offers each person the report tools their role may use', async () => {
  const own = await listed(tokens.owner)
  for (const n of ALL) assert.ok(own.includes(n), n + ' for an owner')
  assert.ok((await listed(tokens.admin)).includes('share_report'), 'an admin manages reports')

  // An operator views reports (and till reports) by default: the reading tools only.
  const op = await listed(tokens.operator)
  for (const n of READING) assert.ok(op.includes(n), n + ' for an operator')
  for (const n of ['ask_data', ...CHANGING]) assert.ok(!op.includes(n), n + ' is hidden from View')

  // A read-only token: what reads, ask_data included (it saves nothing).
  const ro = await listed(tokens.read)
  for (const n of [...READING, 'ask_data']) assert.ok(ro.includes(n), n + ' on a read-only token')
  for (const n of CHANGING) assert.ok(!ro.includes(n), n + ' is never on a read-only token')
  await refused(tokens.read, 'build_report', { plan: SERVER_PLAN, name: 'Nope' }, /read/i)
})

test('find_fields: the subjects for a topic, and one subject in full', async () => {
  const found = await done(tokens.owner, 'find_fields', { topic: 'dishes sold by hour' })
  const keys = found.subjects.map(s => s.subject)
  assert.ok(keys.slice(0, 2).includes('till.lines'), 'dish lines are near the top: ' + keys.join(', '))
  const lines = found.subjects.find(s => s.subject === 'till.lines')
  assert.ok(lines.figures.some(l => l.startsWith('net_sales | ')), 'figures read path | name')
  assert.ok(lines.matching?.length, 'what matches the topic is listed')
  assert.ok(found.subjects.slice(2).every(s => !s.figures), 'only the first two come with their figures')

  const checks = await done(tokens.owner, 'find_fields', { subject: 'till.checks', topic: 'server' })
  assert.equal(checks.subject, 'till.checks')
  assert.match(checks.how_many, /^count: true \| how many/)
  assert.ok(checks.figures.some(l => /^net_sales \| .* \| money/.test(l)), checks.figures.join('\n'))
  assert.ok(checks.fields.some(l => l.startsWith('date | ')))
  assert.ok(checks.linked.some(f => /Server/.test(f.through) && f.lines.some(l => l.startsWith('server.name | '))),
    'a linked thing\'s fields carry the path through the link')
  assert.ok(checks.best_for_the_topic.some(l => l.startsWith('server')), 'the topic narrows it down')

  await refused(tokens.owner, 'find_fields', {}, /topic/)
  await refused(tokens.owner, 'find_fields', { subject: 'warehouse stock' }, /No report subject called/)
})

test('explain_figure: what a figure counts, a rate, how many, a field and a link', async () => {
  const net = await done(tokens.owner, 'explain_figure', { subject: 'till.lines', figure: 'net_sales' })
  assert.equal(net.path, 'net_sales')
  assert.equal(net.kind, 'money')
  assert.equal(net.counts, CATALOGUE.subjects['till.lines'].measures.net_sales.about, 'the catalogue\'s own words')
  assert.match(net.adds_up, /^A total/)

  const [rateKey, rate] = Object.entries(CATALOGUE.subjects['till.checks'].measures).find(([, m]) => Array.isArray(m.ratio))
  const r = await done(tokens.owner, 'explain_figure', { subject: 'till.checks', figure: rateKey })
  assert.match(r.adds_up, /^A rate: /)
  assert.equal(r.parts.length, 2)
  assert.deepEqual(r.parts.map(p => p.figure), rate.ratio.map(k => CATALOGUE.subjects['till.checks'].measures[k].label))

  const many = await done(tokens.owner, 'explain_figure', { subject: 'till.checks', figure: 'how many' })
  assert.equal(many.kind, 'a number')
  assert.match(many.adds_up, /count/i)

  const status = await done(tokens.owner, 'explain_figure', { subject: 'till.checks', figure: 'status' })
  assert.ok(status.choices?.length > 1, 'a choice field lists its choices')
  assert.ok(status.can_be)

  const server = await done(tokens.owner, 'explain_figure', { subject: 'till.checks', figure: 'server' })
  assert.match(server.kind, /each check belongs to$/)

  await refused(tokens.owner, 'explain_figure', { subject: 'till.checks', figure: 'zz nothing like it' }, /No figure or field of/)
})

test('list_reports and get_report: the starters with links, a report\'s plan and choices', async () => {
  const till = await done(tokens.owner, 'list_reports', { only: 'starters', area: 'till' })
  const byDay = till.reports.find(r => r.name === 'Sales by day')
  assert.ok(byDay, till.reports.map(r => r.name).join(', '))
  assert.equal(byDay.id, 'starter:till_sales_by_day')
  assert.equal(byDay.whose, 'a starter that comes with Macaroonie')
  assert.equal(byDay.url, officeOrigin() + '/reports/starter%3Atill_sales_by_day', 'the connector gets a full address')
  assert.ok(till.reports.every(r => r.id.startsWith('starter:till_')), 'only the till starters')

  const voids = await done(tokens.owner, 'list_reports', { search: 'voids' })
  assert.deepEqual(voids.reports.map(r => r.name), ['Voids, by whom and why'])
  const none = await done(tokens.owner, 'list_reports', { search: 'zz nothing like it' })
  assert.deepEqual(none.reports, [])
  assert.match(none.note, /ask_data/)

  const got = await done(tokens.owner, 'get_report', { report: 'Sales by server' })
  assert.equal(got.id, 'starter:till_sales_by_server')
  assert.equal(got.plan.subject, 'till.checks')
  assert.ok(got.plan.by.some(b => b.field.startsWith('server')), JSON.stringify(got.plan.by))
  assert.ok(got.choices.some(c => /^Period: /.test(c)) && got.choices.some(c => /^Venues: /.test(c)), got.choices.join('; '))
  assert.ok(got.shows.length > 20, 'what it shows, in a sentence')
  assert.equal(got.can_change, false, 'a starter is copied, never changed')
  assert.match(got.url, /\/reports\/starter%3Atill_sales_by_server$/)
})

test('run_report: a starter for another period and venue, recorded as Pepper\'s', async () => {
  const before = await pepperRuns(A.owner)
  const out = await done(tokens.owner, 'run_report', { report: 'Sales by server', period: { relative: 'today' }, venues: ['Ware'] })
  assert.equal(out.report, 'Sales by server')
  assert.ok(out.columns.length >= 2)
  assert.ok(out.rows.some(r => r[0] === 'Zqx Jo Bloggs'), JSON.stringify(out.rows))
  assert.ok(out.period, 'the period it covers is said')
  assert.equal(await pepperRuns(A.owner), before + 1, 'recorded as Pepper\'s run')
  const [row] = await sql`SELECT starter_key, params FROM report_runs WHERE tenant_id = ${ids.a} AND params->>'via' = 'pepper' ORDER BY created_at DESC LIMIT 1`
  assert.equal(row.starter_key, 'till_sales_by_server')

  await refused(tokens.owner, 'run_report', { report: 'Sales by server', venues: ['Yyc Ware'] }, /No venue called/)
  await refused(tokens.owner, 'run_report', { report: 'Sales by server', period: { n: 3 } }, /relative .* or as from and to/)
  await refused(tokens.owner, 'run_report', { report: 'zz nothing like it' }, /No report called/)

  // The operator views till reports by default, so it runs for them too.
  const op = await done(tokens.operator, 'run_report', { report: 'Sales by day' })
  assert.ok(Array.isArray(op.rows))
})

test('ask_data: a plan answered from the data; what isn\'t there comes back with the near ones', async () => {
  const before = await pepperRuns(A.owner)
  const out = await done(tokens.owner, 'ask_data', { plan: { ...SERVER_PLAN, figures: [{ figure: 'net_sales' }, { count: true }] } })
  assert.ok(out.rows.some(r => r[0] === 'Zqx Jo Bloggs'), JSON.stringify(out.rows))
  assert.ok(out.shows, 'what it shows')
  assert.match(out.keep_it, /build_report/)
  assert.equal(out.columns.length, 3)
  assert.equal(await pepperRuns(A.owner), before + 1, 'a plan Pepper asks for is recorded as its run')
  assert.equal((await sql`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${ids.a}`)[0].n, 0, 'nothing saved')

  const near = await refused(tokens.owner, 'ask_data', { plan: { ...SERVER_PLAN, by: [{ field: 'server.nam' }] } })
  assert.match(near, /"server\.nam" isn't there; near: .*server\.name/)
  assert.match(near, /find_fields/)
  const subj = await refused(tokens.owner, 'ask_data', { plan: { ...SERVER_PLAN, subject: 'till.nothing' } })
  assert.match(subj, /Subjects there are: .*till\.checks/)

  // A browser's plan run isn't recorded (like the builder's preview).
  const runs = (await sql`SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = ${ids.a}`)[0].n
  await ok(owner.post('/api/reports/plan', { plan: SERVER_PLAN }))
  assert.equal((await sql`SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = ${ids.a}`)[0].n, runs)
})

test('build, change, copy, share and delete a report on the connector', async () => {
  const built = await done(tokens.owner, 'build_report', { plan: SERVER_PLAN, name: 'Zqx sales by server', description: 'For the Monday meeting' })
  assert.equal(built.saved, 'Zqx sales by server')
  assert.match(built.url, new RegExp('/reports/' + built.id + '$'))
  const [row] = await sql`SELECT name, description, spec, owner_sub, shared FROM reports WHERE tenant_id = ${ids.a} AND id = ${built.id}`
  assert.deepEqual([row.name, row.description, row.spec.subject, row.owner_sub, row.shared],
    ['Zqx sales by server', 'For the Monday meeting', 'till.checks', A.owner, 'private'])
  assert.equal(row.spec.values.length, 1)

  // The plan get_report gives back changes it: a count added, the name kept.
  const { plan } = await done(tokens.owner, 'get_report', { report: 'Zqx sales by server' })
  const changed = await done(tokens.owner, 'change_report', { report: 'Zqx sales by server', plan: { ...plan, figures: [...plan.figures, { count: true }] } })
  assert.equal(changed.changed, 'Zqx sales by server')
  const [after] = await sql`SELECT name, spec FROM reports WHERE id = ${built.id}`
  assert.equal(after.name, 'Zqx sales by server')
  assert.equal(after.spec.values.length, 2)
  const renamed = await done(tokens.owner, 'change_report', { report: built.id, name: 'Zqx server sales', description: null })
  assert.equal(renamed.changed, 'Zqx server sales')
  assert.equal((await sql`SELECT description FROM reports WHERE id = ${built.id}`)[0].description, null)
  await refused(tokens.owner, 'change_report', { report: 'Zqx server sales' }, /Say what to change/)
  await refused(tokens.owner, 'change_report', { report: 'Sales by day', name: 'Mine' }, /starter report: .*copy_report/)

  // A starter is copied as the person's own, under its own name.
  const copied = await done(tokens.owner, 'copy_report', { report: 'Sales by day' })
  assert.equal(copied.as, 'Sales by day')
  const [copyRow] = await sql`SELECT starter_key, owner_sub FROM reports WHERE id = ${copied.id}`
  assert.deepEqual([copyRow.starter_key, copyRow.owner_sub], ['till_sales_by_day', A.owner])
  // Two reports called Sales by day now: the person's own saved one is picked.
  assert.equal((await done(tokens.owner, 'get_report', { report: 'Sales by day' })).id, copied.id)

  // Shared with a role by its name; a starter can't be shared.
  const role = await operatorRole()
  const shared = await done(tokens.owner, 'share_report', { report: 'Zqx server sales', with: 'roles', roles: ['operator'] })
  assert.equal(shared.shared_with, 'some roles')
  const [sh] = await sql`SELECT shared, shared_role_ids FROM reports WHERE id = ${built.id}`
  assert.deepEqual([sh.shared, sh.shared_role_ids], ['roles', [role.id]])
  await refused(tokens.owner, 'share_report', { report: 'Voids, by whom and why', with: 'everyone' }, /starter report/)
  await refused(tokens.owner, 'share_report', { report: 'Zqx server sales', with: 'roles', roles: ['zz no such role'] }, /No role called/)
  const offered = await done(tokens.owner, 'share_report', { report: 'Zqx server sales', with: 'everyone', starter: true })
  assert.equal(offered.offered_as_starter, true)

  // The operator now sees it, can't change it.
  const theirs = await done(tokens.operator, 'list_reports', { search: 'server sales', only: 'saved' })
  assert.deepEqual(theirs.reports.map(r => r.name), ['Zqx server sales'])
  assert.equal(theirs.reports[0].whose, 'made by a-owner@test.local')

  const gone = await done(tokens.owner, 'delete_report', { report: 'Zqx server sales' })
  assert.equal(gone.deleted, 'Zqx server sales')
  assert.equal((await sql`SELECT count(*)::int AS n FROM reports WHERE id = ${built.id}`)[0].n, 0)
  await refused(tokens.owner, 'delete_report', { report: 'Sales by server' }, /can't be deleted/)

  const audit = await sql`SELECT tool, ok FROM ai_actions WHERE tenant_id = ${ids.a} AND tool LIKE '%_report' ORDER BY created_at`
  assert.deepEqual([...new Set(audit.map(a => a.tool))].sort(), ['build_report', 'change_report', 'copy_report', 'delete_report', 'share_report'])
  assert.ok(audit.every(a => a.ok))
})

test('someone with Use changes only their own reports; a role without till reports can\'t run till ones', async () => {
  const role = await operatorRole()
  await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { reports: 'use', pos_reports: 'none' } }))
  try {
    const mine = await done(tokens.owner, 'build_report', { plan: { ...SERVER_PLAN, subject: 'bookings.bookings', by: [{ field: 'date', bucket: 'day' }], figures: [{ count: true }] }, name: 'Zqx bookings by day' })
    await ok(owner.patch('/api/reports/' + mine.id + '/sharing', { shared: 'everyone' }))

    const op = await listed(tokens.operator)
    for (const n of ['ask_data', 'build_report', 'change_report', 'copy_report', 'delete_report']) assert.ok(op.includes(n), n + ' with Use')
    assert.ok(!op.includes('share_report'), 'sharing needs Manage')

    await refused(tokens.operator, 'change_report', { report: 'Zqx bookings by day', name: 'Mine now' }, /Only the person who made .* copy_report/)
    await refused(tokens.operator, 'delete_report', { report: 'Zqx bookings by day' }, /Only the person who made/)
    const theirCopy = await done(tokens.operator, 'copy_report', { report: 'Zqx bookings by day', name: 'Zqx my bookings' })
    const changed = await done(tokens.operator, 'change_report', { report: theirCopy.id, name: 'Zqx my bookings by day' })
    assert.equal(changed.changed, 'Zqx my bookings by day')

    // Till reports are out of their role now: the starters say so, plans refuse.
    const got = await done(tokens.operator, 'get_report', { report: 'Sales by day' })
    assert.match(got.cant_run, /can't run it/)
    assert.equal(got.plan, undefined)
    await refused(tokens.operator, 'run_report', { report: 'Sales by day' }, /can't run "Sales by day"/)
    const fields = await done(tokens.operator, 'find_fields', { topic: 'sales by dish' })
    assert.ok(fields.subjects.every(s => !s.subject.startsWith('till.')), fields.subjects.map(s => s.subject).join(', '))
    await refused(tokens.operator, 'ask_data', { plan: SERVER_PLAN })
  } finally {
    await ok(owner.patch('/api/access/roles/' + role.id, { permissions: {} }))
  }
})

test('in the chat, build_report\'s card pins the report it showed, and Confirm saves exactly that', async () => {
  const text = s => [{ type: 'text', text: s }]
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_r1', name: 'build_report', input: { plan: SERVER_PLAN, name: 'Zqx chat report' } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Press Save it on the card.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'Save sales by server as a report' }))
  const [card] = await sql`SELECT id, input, card FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id} AND tool = 'build_report'`
  assert.ok(card, 'a card, not a report')
  assert.equal(card.card.title, 'Save the report "Zqx chat report"?')
  assert.ok(card.card.lines.includes('First rows:'), card.card.lines.join('\n'))
  assert.ok(card.card.lines.some(l => l.startsWith('Zqx Jo Bloggs | ')), 'the card shows the first rows')
  assert.equal(card.input.spec?.subject, 'till.checks', 'the definition the card showed is pinned')
  assert.equal((await sql`SELECT count(*)::int AS n FROM reports WHERE tenant_id = ${ids.a} AND name = 'Zqx chat report'`)[0].n, 0, 'nothing saved before Confirm')

  const runs = await pepperRuns(A.owner)
  const confirmed = await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const [saved] = await sql`SELECT id, spec FROM reports WHERE tenant_id = ${ids.a} AND name = 'Zqx chat report'`
  assert.ok(saved, 'saved on Confirm')
  assert.deepEqual(saved.spec, card.input.spec, 'exactly the definition the card showed')
  assert.equal(await pepperRuns(A.owner), runs, 'Confirm doesn\'t build the plan again')
  const [action] = await sql`SELECT status, result FROM ai_pending_actions WHERE id = ${card.id}`
  assert.equal(action.status, 'done', JSON.stringify(confirmed).slice(0, 300))
  assert.equal(action.result.link, '[Zqx chat report](/reports/' + saved.id + ')', 'a link inside the app in the chat')
})

test('Pepper runs at most ' + PEPPER_RUNS_PER_MINUTE + ' reports a minute for a person; other runs aren\'t counted, and a browser can\'t claim the mark', async () => {
  await sql`
    INSERT INTO report_runs (tenant_id, starter_key, report_name, subject, kind, user_sub, user_email, params)
    SELECT ${ids.a}, 'till_sales_by_day', 'Sales by day', 'till.checks', 'run', ${A.owner}, 'a-owner@test.local', '{"via":"pepper"}'
      FROM generate_series(1, ${PEPPER_RUNS_PER_MINUTE})`
  await refused(tokens.owner, 'run_report', { report: 'Sales by day' }, new RegExp('Pepper has run ' + PEPPER_RUNS_PER_MINUTE + ' reports for you in the last minute'))
  await refused(tokens.owner, 'ask_data', { plan: SERVER_PLAN }, /in the last minute/)

  // The limit is each person's, and only Pepper's runs count.
  await done(tokens.admin, 'run_report', { report: 'Sales by day' })
  const page = await owner.post('/api/reports/starter:till_sales_by_day/run', {})
  assert.equal(page.status, 200, 'a run on the page isn\'t held back')

  // The mark without the server's own secret: an ordinary run, not counted as Pepper's.
  const before = await pepperRuns(A.owner)
  const browser = await owner.post('/api/reports/starter:till_sales_by_day/run', {}, { [PEPPER_HEADER]: 'pepper', [INTERNAL_CALL_HEADER]: 'nope' })
  assert.equal(browser.status, 200)
  assert.equal(await pepperRuns(A.owner), before, 'not recorded as Pepper\'s')
  const [last] = await sql`SELECT params FROM report_runs WHERE tenant_id = ${ids.a} AND user_sub = ${A.owner} ORDER BY created_at DESC LIMIT 1`
  assert.equal(last.params.via, undefined)

  await ageRuns()
  await done(tokens.owner, 'run_report', { report: 'Sales by day' })
})

test('another group\'s reports, venues and roles are out of reach', async () => {
  const theirs = await ok(ownerB.post('/api/reports', { name: 'Yyc private sales', spec: { subject: 'till.checks', values: [{ measure: 'net_sales' }] } }))
  await refused(tokens.owner, 'get_report', { report: theirs.report.id }, /No report called/)
  await refused(tokens.owner, 'run_report', { report: 'Yyc private sales' }, /No report called/)
  const asked = await done(tokens.owner, 'ask_data', { plan: { ...SERVER_PLAN, venues: ['Yyc Ware'] } })
  assert.ok(asked.couldnt.includes('There\'s no venue called "Yyc Ware"'), JSON.stringify(asked.couldnt))
  // Roles are picked among the group's own: another group's role id isn't one.
  const theirRole = (await ok(ownerB.get('/api/access/roles'))).find(r => r.key === 'operator')
  await refused(tokens.owner, 'share_report', { report: 'Sales by day', with: 'roles', roles: [theirRole.id] }, /No role called/)
  const out = await done(tokens.owner, 'list_reports', { search: 'Yyc' })
  assert.deepEqual(out.reports, [])
})
