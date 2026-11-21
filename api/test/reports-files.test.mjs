// Kept report files and Past runs (docs/REPORTS.md 14; migration 250):
// Keep a file on a report's page (POST /api/reports/:id/files), the file
// downloaded by the person who made it only and only while their role sees
// the report the same way, its time (30 days, 7 with people's details), the
// group's room, the hourly clean-up, taking one off early, erasure; Past runs
// (GET /api/reports/runs) with its filters and pages; Pepper's report_runs and
// export_report on the connector and in the chat; and the Report runs subject
// of the catalogue (group.report_runs) against Past runs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { runner, LEVELS, refused: reportRefused, rowsOf } = await import('./support/reports.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { cleanUpReportFiles, GROUP_MB, FILE_DAYS, PERSONAL_DAYS } = await import('../src/reports/files.js')
const { sizeOf, removeDaysBefore } = await import('../src/services/privateStore.js')
const { PEPPER_RUNS_PER_MINUTE } = await import('../src/reports/access.js')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { officeOrigin } = await import('../src/services/platformHost.js')

let ids, filled, t, owner, admin, operator, viewer, ownerB
const tokens = {}
const STARTER = 'starter:till_sales_by_day'
const DAY_MS = 24 * 60 * 60 * 1000
const BOOKINGS_LIST = { subject: 'bookings.bookings', kind: 'list', rows: ['date', 'guest_name', 'customer.name'] }

const today = () => ({ from: t.date, to: t.date })
const onDisk = key => path.join(process.env.PRIVATE_DIR, key)
const fileRow = async id => (await sql`SELECT * FROM report_files WHERE id = ${id}`)[0]
const runCount = async () => (await sql`SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = ${ids.a}`)[0].n
// Runs from earlier tests mustn't count towards Pepper's limit in the next one.
const ageRuns = () => sql`UPDATE report_runs SET created_at = created_at - interval '5 minutes' WHERE tenant_id = ${ids.a}`

/** A request whose reply is a file: the bytes as they came (inject's body is text). */
async function raw(sub, tenantId, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: 'Bearer test:' + sub, 'x-tenant-id': tenantId,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.statusCode, headers: res.headers, bytes: res.rawPayload, text: res.body }
}

/** A file kept as someone: the reply's file. */
async function keep(who, ref, body) {
  const res = await who.post('/api/reports/' + ref + '/files', body)
  assert.equal(res.status, 201, 'kept: ' + res.body.slice(0, 300))
  return res.json.file
}

/** Every page of Past runs as someone, newest first. */
async function allRuns(who, query = '') {
  const out = []
  let next = null
  for (let i = 0; i < 100; i++) {
    const page = await ok(who.get('/api/reports/runs?limit=50' + query + (next ? '&before=' + encodeURIComponent(next) : '')))
    out.push(...page.runs)
    next = page.next
    if (!next) return out
  }
  throw new Error('More pages than expected')
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
const listed = async token => (await mcp(token, 'tools/list')).json.result.tools.map(x => x.name)
async function call(token, name, args) {
  const r = await mcp(token, 'tools/call', { name, arguments: args })
  assert.ok(r.json?.result, name + ': ' + r.body.slice(0, 300))
  const text = r.json.result.content[0].text
  return r.json.result.isError ? { error: text } : { out: JSON.parse(text) }
}

const operatorRole = async () => (await ok(owner.get('/api/access/roles'))).find(r => r.key === 'operator')

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
  t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  tokens.owner = (await ok(owner.post('/api/ai/tokens', { name: 'Files' }))).token
  tokens.operator = (await ok(operator.post('/api/ai/tokens', { name: 'Files' }))).token
})
test.after(async () => { await claude.close(); await closeApp() })
test.beforeEach(async () => { forgetReportResults(); if (ids) await ageRuns() })

test('a kept CSV file is the download, kept 30 days in the private store, and its run is on Past runs', async () => {
  const body = { format: 'csv', params: { period: today() } }
  const file = await keep(owner, STARTER, body)
  assert.equal(file.format, 'csv')
  assert.equal(file.personal, false, 'sales by day names nobody')
  assert.equal(file.mine, true)
  assert.equal(file.by, A.owner + '@test.local')
  assert.equal(file.removed, false)
  assert.equal(file.downloads, 0)
  assert.equal(file.path, '/api/reports/files/' + file.id)
  assert.ok(file.rows >= 1, 'a row for the day sold')
  const days = (new Date(file.expires_at) - new Date(file.made_at)) / DAY_MS
  assert.ok(Math.abs(days - FILE_DAYS) < 0.01, 'kept ' + FILE_DAYS + ' days: ' + days)

  // In the private store, readable by the API's own user only.
  const row = await fileRow(file.id)
  assert.match(row.storage_key, /^reports\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.csv$/)
  const stat = fs.statSync(onDisk(row.storage_key))
  assert.equal(stat.mode & 0o777, 0o600)
  assert.equal(Number(row.bytes), stat.size)

  // The same bytes as a download of the same report with the same choices.
  const got = await raw(A.owner, ids.a, 'GET', file.path)
  assert.equal(got.status, 200, got.text.slice(0, 200))
  const fresh = await raw(A.owner, ids.a, 'POST', '/api/reports/' + STARTER + '/export', body)
  assert.equal(fresh.status, 200)
  assert.ok(got.bytes.equals(fresh.bytes), 'the kept file is the download')
  assert.match(got.headers['content-type'], /text\/csv/)
  assert.equal(got.headers['content-disposition'], 'attachment; filename="' + file.name + '"')
  assert.equal(fresh.headers['content-disposition'], got.headers['content-disposition'], 'the same file name as a download')
  assert.equal(got.headers['cache-control'], 'private, no-store')
  assert.equal(Number(got.headers['content-length']), stat.size)

  const after = await fileRow(file.id)
  assert.equal(after.downloads, 1)
  assert.ok(after.last_downloaded_at)

  // Recorded as a file made, on Past runs as kept, with the choices in words.
  const [run] = await sql`SELECT kind, format, starter_key, row_count, error FROM report_runs WHERE id = ${file.run_id}`
  assert.deepEqual([run.kind, run.format, run.starter_key, run.error], ['export', 'csv', 'till_sales_by_day', null])
  assert.equal(run.row_count, file.rows)
  const { runs } = await ok(owner.get('/api/reports/runs?file=' + file.id))
  assert.equal(runs.length, 1)
  assert.equal(runs[0].id, file.run_id)
  assert.equal(runs[0].what, 'kept')
  assert.equal(runs[0].file.id, file.id)
  assert.equal(runs[0].file.downloads, 1)
  assert.equal(runs[0].report.ref, STARTER)
  assert.equal(runs[0].report.name, 'Sales by day')
  assert.equal(runs[0].report.open, true)
  assert.equal(runs[0].report.subject_label, 'Checks')
  const period = runs[0].choices.find(c => c.key === 'period')
  assert.ok(period && period.label && period.text, 'the period in words: ' + JSON.stringify(runs[0].choices))
  // The download on the page itself is recorded as a download, without a file.
  const { runs: mine } = await ok(owner.get('/api/reports/runs?limit=2'))
  assert.equal(mine[0].what, 'downloaded')
  assert.equal(mine[0].file, null)
})

test('a list with people\'s details is kept 7 days; an Excel file is the download too', async () => {
  const saved = await ok(owner.post('/api/reports', { name: 'Zqx guest list', spec: BOOKINGS_LIST }))
  const file = await keep(owner, saved.report.id, { format: 'xlsx' })
  assert.equal(file.personal, true, 'guest names are people\'s details')
  assert.equal(file.format, 'xlsx')
  const days = (new Date(file.expires_at) - new Date(file.made_at)) / DAY_MS
  assert.equal(PERSONAL_DAYS, 7, 'Help says a file with people\'s details is kept 7 days')
  assert.ok(Math.abs(days - 7) < 0.01, 'kept 7 days: ' + days)

  const got = await raw(A.owner, ids.a, 'GET', file.path)
  assert.equal(got.status, 200)
  assert.match(got.headers['content-type'], /spreadsheetml/)
  const fresh = await raw(A.owner, ids.a, 'POST', '/api/reports/' + saved.report.id + '/export', { format: 'xlsx' })
  assert.equal(fresh.status, 200)
  // The About sheet says when the file was made; the report's own sheet is the same.
  const sheet = buf => XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets.Report, { header: 1, raw: true })
  const kept = sheet(got.bytes)
  assert.deepEqual(kept, sheet(fresh.bytes))
  assert.ok(kept.flat().includes('Zqx Bob'), 'the guest on the fixture booking')

  const { runs } = await ok(owner.get('/api/reports/runs?report=' + saved.report.id))
  assert.equal(runs[0].what, 'downloaded', 'newest first: the download')
  assert.equal(runs[1].what, 'kept')
  assert.equal(runs[1].file.personal, true)
  assert.equal(runs[1].report.ref, saved.report.id)
  assert.equal(runs[1].report.name, 'Zqx guest list')
})

test('only the person who made a file can download it or take it off; others see it listed', async () => {
  const file = await keep(owner, STARTER, { format: 'csv', params: { period: today() } })
  // Another person of the group, with Manage on Reports: not theirs to know about.
  assert.equal((await admin.get(file.path)).status, 404)
  assert.equal((await admin.delete(file.path)).status, 404)
  // Another group.
  assert.equal((await ownerB.get(file.path)).status, 404)
  assert.equal((await ownerB.delete(file.path)).status, 404)
  // Not a file id at all.
  assert.equal((await owner.get('/api/reports/files/nope')).status, 404)
  assert.equal((await owner.get('/api/reports/files/00000000-0000-0000-0000-000000000000')).status, 404)
  assert.equal((await fileRow(file.id)).removed_at, null, 'nothing was taken off')

  // Everyone's runs (Manage) list it, not as theirs.
  const { runs } = await ok(admin.get('/api/reports/runs?scope=all&file=' + file.id))
  assert.equal(runs.length, 1)
  assert.equal(runs[0].person.mine, false)
  assert.equal(runs[0].person.email, A.owner + '@test.local')
  assert.equal(runs[0].file.mine, false)
  assert.equal(runs[0].file.by, A.owner + '@test.local')
  // Their own runs don't hold it.
  assert.equal((await ok(admin.get('/api/reports/runs?file=' + file.id))).runs.length, 0)
  // Another group's Past runs never name it.
  assert.equal((await ownerB.get('/api/reports/runs?scope=all&file=' + file.id)).json.runs.length, 0)
})

test('who sees Past runs and keeps files; filters and pages', async () => {
  // An operator (View on Reports): their own runs, not everyone's; no files.
  assert.equal((await operator.get('/api/reports/runs')).status, 200)
  const all = await operator.get('/api/reports/runs?scope=all')
  assert.equal(all.status, 403)
  assert.match(all.json.error, /Only people who manage reports can see everyone's runs/)
  assert.equal((await operator.post('/api/reports/' + STARTER + '/files', { format: 'csv' })).status, 403)
  // A viewer (no Reports): nothing.
  assert.equal((await viewer.get('/api/reports/runs')).status, 403)

  // By report: a starter by its ref, a saved one by its id; anything else isn't one.
  const byStarter = await allRuns(owner, '&report=' + STARTER)
  assert.ok(byStarter.length >= 2)
  assert.ok(byStarter.every(r => r.report.ref === STARTER))
  assert.equal((await owner.get('/api/reports/runs?report=garbage')).status, 404)
  assert.equal((await owner.get('/api/reports/runs?report=starter:Not%20a%20key')).status, 404)
  assert.equal((await owner.get('/api/reports/runs?file=garbage')).status, 404)
  const bad = await owner.get('/api/reports/runs?before=nope')
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /isn't one this list gave/)

  // Only runs that kept a file.
  const kept = await allRuns(owner, '&files=1')
  assert.ok(kept.length >= 3)
  assert.ok(kept.every(r => r.what === 'kept' && r.file))

  // Runs made within one millisecond: a JS Date keeps milliseconds only, so a
  // cursor read through one would skip or repeat these. Two differ by
  // microseconds and two have the very same time (their ids decide).
  const four = await sql`SELECT id FROM report_runs WHERE tenant_id = ${ids.a} AND user_sub = ${A.owner}
                          ORDER BY created_at DESC, id DESC LIMIT 4`
  assert.equal(four.length, 4)
  const base = (await sql`SELECT date_trunc('milliseconds', now() - interval '1 hour')::text AS t`)[0].t
  for (const [i, us] of [[0, 400], [1, 100], [2, 250], [3, 250]]) {
    await sql`UPDATE report_runs SET created_at = ${base}::timestamptz + make_interval(secs => ${us / 1e6}) WHERE id = ${four[i].id}`
  }
  const sameMs = (await sql`SELECT id FROM report_runs WHERE id = ANY(${four.map(r => r.id)})
                             ORDER BY created_at DESC, id DESC`).map(r => r.id)
  assert.equal(new Set((await sql`SELECT date_trunc('milliseconds', created_at)::text AS ms FROM report_runs
                                   WHERE id = ANY(${four.map(r => r.id)})`).map(r => r.ms)).size, 1, 'all in one millisecond')

  // Pages, newest first, nothing twice and nothing missed.
  const every = await allRuns(owner)
  const paged = []
  let next = null
  do {
    const page = await ok(owner.get('/api/reports/runs?limit=1' + (next ? '&before=' + encodeURIComponent(next) : '')))
    assert.ok(page.runs.length <= 1)
    paged.push(...page.runs)
    next = page.next
  } while (next)
  assert.deepEqual(paged.map(r => r.id), every.map(r => r.id))
  assert.equal(new Set(paged.map(r => r.id)).size, paged.length)
  // The four from one millisecond: each once, in the database's own order.
  assert.deepEqual(paged.map(r => r.id).filter(id => sameMs.includes(id)), sameMs)
  for (let i = 1; i < every.length; i++) assert.ok(new Date(every[i - 1].at) >= new Date(every[i].at), 'newest first')
})

test('a file past its time is gone; the hourly clean-up takes it and any day folder left behind', async () => {
  const file = await keep(owner, STARTER, { format: 'csv', params: { period: today() } })
  const row = await fileRow(file.id)
  await sql`UPDATE report_files SET expires_at = now() - interval '1 minute' WHERE id = ${file.id}`
  const gone = await owner.get(file.path)
  assert.equal(gone.status, 410)
  assert.match(gone.json.error, /isn't kept any more/)

  // A folder a crash left behind, with a file no row points at.
  const stray = path.join(process.env.PRIVATE_DIR, 'reports', '2020-01-01')
  fs.mkdirSync(stray, { recursive: true })
  fs.writeFileSync(path.join(stray, '00000000-0000-0000-0000-000000000000.csv'), 'x')

  const out = await cleanUpReportFiles()
  assert.ok(out.removed >= 1, JSON.stringify(out))
  assert.equal(await sizeOf(row.storage_key), null, 'the file left the store')
  const after = await fileRow(file.id)
  assert.ok(after.removed_at, 'the row stays, marked')
  assert.equal(after.spec, null)
  assert.equal(after.levels, null)
  assert.equal(fs.existsSync(stray), false, 'the old day folder went')
  assert.ok(fs.existsSync(path.dirname(onDisk((await sql`SELECT storage_key FROM report_files WHERE removed_at IS NULL LIMIT 1`)[0].storage_key))), 'today\'s folder stays')

  const { runs } = await ok(owner.get('/api/reports/runs?file=' + file.id))
  assert.equal(runs[0].file.removed, true)
  assert.equal((await owner.get(file.path)).status, 410)
})

test('a file is refused once the person\'s role sees the report differently; other changes don\'t matter', async () => {
  const role = await operatorRole()
  await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { reports: 'use' } }))
  try {
    const saved = await ok(operator.post('/api/reports', { name: 'Zqx my guests', spec: BOOKINGS_LIST }))
    const file = await keep(operator, saved.report.id, { format: 'csv' })
    assert.equal((await raw(A.operator, ids.a, 'GET', file.path)).status, 200)

    // An area the report doesn't read: still the same report.
    await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { reports: 'use', cash_recon: 'none' } }))
    assert.equal((await raw(A.operator, ids.a, 'GET', file.path)).status, 200)

    // Customers taken away: the customer's name is a column the role can't see now.
    await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { reports: 'use', customers: 'none' } }))
    const changed = await operator.get(file.path)
    assert.equal(changed.status, 403)
    assert.match(changed.json.error, /What your role can see has changed since you made this file/)

    // Bookings taken away: the whole subject.
    await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { reports: 'use', bookings: 'none' } }))
    assert.equal((await operator.get(file.path)).status, 403)

    // Back as it was: the file can be downloaded again.
    await ok(owner.patch('/api/access/roles/' + role.id, { permissions: { reports: 'use' } }))
    assert.equal((await raw(A.operator, ids.a, 'GET', file.path)).status, 200)
    assert.equal((await fileRow(file.id)).downloads, 3)
  } finally {
    await ok(owner.patch('/api/access/roles/' + role.id, { permissions: {} }))
  }
})

test('a group keeps ' + GROUP_MB + ' MB of files; past that nothing is made or recorded', async () => {
  const file = await keep(owner, STARTER, { format: 'csv', params: { period: today() } })
  const [{ bytes: before }] = await sql`SELECT bytes FROM report_files WHERE id = ${file.id}`
  await sql`UPDATE report_files SET bytes = ${GROUP_MB * 1024 * 1024} WHERE id = ${file.id}`
  try {
    const runs = await runCount()
    const full = await owner.post('/api/reports/' + STARTER + '/files', { format: 'csv' })
    assert.equal(full.status, 422)
    assert.match(full.json.error, /Your group keeps 500 MB of report files already/)
    assert.equal(await runCount(), runs, 'no run recorded')
    // Another group has its own room.
    assert.equal((await ownerB.post('/api/reports/' + STARTER + '/files', { format: 'csv' })).status, 201)
  } finally {
    await sql`UPDATE report_files SET bytes = ${before} WHERE id = ${file.id}`
  }
  assert.equal((await owner.post('/api/reports/' + STARTER + '/files', { format: 'csv' })).status, 201, 'room again')
})

test('the maker takes a file off: gone at once, the row kept, twice is no error', async () => {
  const file = await keep(owner, STARTER, { format: 'csv', params: { period: today() } })
  const row = await fileRow(file.id)
  assert.equal((await owner.delete(file.path)).status, 204)
  assert.equal(await sizeOf(row.storage_key), null)
  const after = await fileRow(file.id)
  assert.ok(after.removed_at)
  assert.equal(after.spec, null)
  assert.equal((await owner.get(file.path)).status, 410)
  assert.equal((await owner.delete(file.path)).status, 204, 'twice is fine')
  const { runs } = await ok(owner.get('/api/reports/runs?file=' + file.id))
  assert.equal(runs[0].file.removed, true)
  assert.equal(runs[0].what, 'kept', 'still a file kept, now gone')
})

test('anonymising a customer takes off every live file with people\'s details, and only those', async () => {
  const saved = await ok(owner.post('/api/reports', { name: 'Zqx guests to forget', spec: BOOKINGS_LIST }))
  const personal = await keep(owner, saved.report.id, { format: 'csv' })
  const plain = await keep(owner, STARTER, { format: 'csv', params: { period: today() } })
  const theirs = await keep(ownerB, STARTER, { format: 'csv' })
  const key = (await fileRow(personal.id)).storage_key

  const [customer] = await sql`SELECT id FROM customers WHERE tenant_id = ${ids.a} AND name = 'Zqx Alice'`
  assert.ok(customer, 'the fixture customer')
  assert.equal((await owner.post('/api/customers/' + customer.id + '/anonymise', {})).status, 204)

  assert.ok((await fileRow(personal.id)).removed_at, 'the file with people\'s details went')
  assert.equal(await sizeOf(key), null)
  assert.equal((await owner.get(personal.path)).status, 410)
  assert.equal((await fileRow(plain.id)).removed_at, null, 'a file naming nobody stays')
  assert.equal((await raw(A.owner, ids.a, 'GET', plain.path)).status, 200)
  assert.equal((await fileRow(theirs.id)).removed_at, null, 'another group\'s files stay')
})

test('Pepper lists past runs and keeps files on the connector, as the person', async () => {
  // report_runs: the person's own, with their kept files and where to download them.
  const listedRuns = await call(tokens.owner, 'report_runs', { files_only: true, limit: 5 })
  assert.equal(listedRuns.error, undefined, listedRuns.error)
  assert.ok(listedRuns.out.runs.length >= 1)
  const withFile = listedRuns.out.runs.find(r => r.file && r.file.download)
  assert.ok(withFile, JSON.stringify(listedRuns.out.runs).slice(0, 400))
  assert.match(withFile.file.download, new RegExp('^' + officeOrigin().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/reports/runs\\?file='))
  assert.equal(listedRuns.out.whose, 'the person\'s own')

  // export_report keeps a file at once on the connector, recorded as Pepper's and audited.
  const before = (await sql`SELECT count(*)::int AS n FROM report_files WHERE tenant_id = ${ids.a}`)[0].n
  const made = await call(tokens.owner, 'export_report', { report: 'Sales by day', period: { from: t.date, to: t.date } })
  assert.equal(made.error, undefined, made.error)
  assert.equal(made.out.report, 'Sales by day')
  assert.match(made.out.kept, /\.csv$/)
  assert.ok(made.out.kept_until)
  assert.equal(made.out.only_you, 'Only the person who asked can download it.')
  const [file] = await sql`SELECT id, run_id, user_sub FROM report_files WHERE tenant_id = ${ids.a} ORDER BY created_at DESC LIMIT 1`
  assert.equal((await sql`SELECT count(*)::int AS n FROM report_files WHERE tenant_id = ${ids.a}`)[0].n, before + 1)
  assert.equal(file.user_sub, A.owner, 'kept for the person, not for Pepper')
  assert.equal(made.out.url, officeOrigin() + '/reports/runs?file=' + file.id)
  const [run] = await sql`SELECT params FROM report_runs WHERE id = ${file.run_id}`
  assert.equal(run.params.via, 'pepper')
  const [audit] = await sql`SELECT tool, ok, channel FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'export_report' ORDER BY created_at DESC LIMIT 1`
  assert.ok(audit, 'audited')
  assert.equal(audit.ok, true)
  assert.equal(audit.channel, 'staff_mcp')
  // The person downloads it themselves.
  assert.equal((await raw(A.owner, ids.a, 'GET', '/api/reports/files/' + file.id)).status, 200)

  // An operator (View on Reports) is offered the list, not files.
  const op = await listed(tokens.operator)
  assert.ok(op.includes('report_runs'))
  assert.ok(!op.includes('export_report'), 'keeping a file needs Use')

  // Everyone's needs Manage.
  const everyone = await call(tokens.operator, 'report_runs', { everyone: true })
  assert.ok(everyone.error, 'refused')
})

test('in the chat, export_report\'s card pins the choices it showed, and Confirm keeps the file', async () => {
  const text = s => [{ type: 'text', text: s }]
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_f1', name: 'export_report', input: { report: 'Sales by day', format: 'xlsx', period: { from: t.date, to: t.date } } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Press Keep the file on the card.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'Give me an Excel file of sales by day for today' }))
  const [card] = await sql`SELECT id, input, card FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id} AND tool = 'export_report'`
  assert.ok(card, 'a card, not a file')
  assert.equal(card.card.title, 'Keep an Excel file of "Sales by day"?')
  assert.equal(card.card.confirmLabel, 'Keep the file')
  assert.ok(card.card.lines.some(l => /Kept for 30 days/.test(l)), card.card.lines.join('\n'))
  assert.equal(card.input.report, STARTER, 'the report is pinned')
  assert.deepEqual(card.input.params?.period, { from: t.date, to: t.date }, 'the choices are pinned')
  const count = async () => (await sql`SELECT count(*)::int AS n FROM report_files WHERE tenant_id = ${ids.a}`)[0].n
  const before = await count()

  await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  assert.equal(await count(), before + 1, 'kept on Confirm')
  const [file] = await sql`SELECT id, format FROM report_files WHERE tenant_id = ${ids.a} ORDER BY created_at DESC LIMIT 1`
  assert.equal(file.format, 'xlsx')
  const [action] = await sql`SELECT status, result FROM ai_pending_actions WHERE id = ${card.id}`
  assert.equal(action.status, 'done')
  assert.equal(action.result.link, '[Download it from Past runs](/reports/runs?file=' + file.id + ')', 'a link inside the app in the chat')
})

test('Pepper keeps at most ' + PEPPER_RUNS_PER_MINUTE + ' reports a minute for a person', async () => {
  await sql`
    INSERT INTO report_runs (tenant_id, starter_key, report_name, subject, kind, user_sub, user_email, params)
    SELECT ${ids.a}, 'till_sales_by_day', 'Sales by day', 'till.checks', 'run', ${A.owner}, 'a-owner@test.local', '{"via":"pepper"}'
      FROM generate_series(1, ${PEPPER_RUNS_PER_MINUTE})`
  const before = (await sql`SELECT count(*)::int AS n FROM report_files WHERE tenant_id = ${ids.a}`)[0].n
  const held = await call(tokens.owner, 'export_report', { report: 'Sales by day' })
  assert.ok(held.error, 'refused')
  assert.match(held.error, new RegExp('Pepper has run ' + PEPPER_RUNS_PER_MINUTE + ' reports for you in the last minute'))
  assert.equal((await sql`SELECT count(*)::int AS n FROM report_files WHERE tenant_id = ${ids.a}`)[0].n, before)
  // Keeping a file on the page isn't held back.
  assert.equal((await owner.post('/api/reports/' + STARTER + '/files', { format: 'csv' })).status, 201)
})

test('the Report runs subject counts what Past runs lists, and needs Manage on Reports', async () => {
  const run = runner(ids.a)
  const listed = await allRuns(owner, '&scope=all')
  const res = await run({ subject: 'group.report_runs', kind: 'list', rows: ['at', 'what', 'who'] }, {}, { levels: LEVELS })
  assert.equal(res.rows.length, listed.length, 'one row a run')

  const counts = {}
  for (const r of listed) counts[r.what] = (counts[r.what] || 0) + 1
  const sum = await run({ subject: 'group.report_runs', values: [{ measure: 'runs' }, { measure: 'on_screen' }, { measure: 'downloads' }, { measure: 'kept' }, { measure: 'prints' }, { measure: 'by_pepper_runs' }] }, {}, { levels: LEVELS })
  // With no groupings the one row is the total.
  const [totals] = rowsOf(sum)
  for (const k of ['runs', 'on_screen', 'downloads', 'kept', 'prints', 'by_pepper_runs']) assert.ok(k in totals, 'a column ' + k + ': ' + sum.columns.map(c => c.key))
  assert.equal(Number(totals.runs), listed.length)
  assert.equal(Number(totals.on_screen), counts.ran || 0)
  assert.equal(Number(totals.downloads), counts.downloaded || 0)
  assert.equal(Number(totals.kept), counts.kept || 0)
  assert.equal(Number(totals.prints), counts.printed || 0)
  assert.equal(Number(totals.by_pepper_runs), listed.filter(r => r.via === 'pepper').length)
  assert.ok((counts.kept || 0) >= 5, 'the files kept in these tests')
  assert.ok((counts.downloaded || 0) >= 2 && (counts.ran || 0) >= 1, JSON.stringify(counts))

  // By what was done: the same counts a row each.
  const byWhat = await run({ subject: 'group.report_runs', rows: ['what'], values: [{ measure: 'runs' }] }, {}, { levels: LEVELS })
  const rows = Object.fromEntries(rowsOf(byWhat).map(r => [r.what, Number(r.runs)]))
  assert.equal(Object.values(rows).reduce((a, b) => a + b, 0), listed.length)

  // View on Reports isn't enough: the subject is everyone's runs.
  const no = await reportRefused(run({ subject: 'group.report_runs', values: [{ measure: 'runs' }] }, {}, { levels: { ...LEVELS, reports: 'view' } }))
  assert.equal(no.status, 403)
})

test('Past runs says Printed for a print, and the clean-up keeps the day it is given', async () => {
  const link = await ok(owner.post('/api/reports/' + STARTER + '/print-link', { params: { period: today() } }))
  const app = await getApp()
  const page = await app.inject({ method: 'GET', url: link.path })
  assert.equal(page.statusCode, 200, page.body.slice(0, 200))
  const { runs } = await ok(owner.get('/api/reports/runs?report=' + STARTER))
  assert.equal(runs[0].what, 'printed')

  const area = path.join(process.env.PRIVATE_DIR, 'reports')
  for (const d of ['2020-02-01', '2020-02-02', '2020-02-03']) fs.mkdirSync(path.join(area, d), { recursive: true })
  const removed = await removeDaysBefore('reports', '2020-02-02')
  assert.ok(removed >= 1)
  assert.equal(fs.existsSync(path.join(area, '2020-02-01')), false, 'a day before goes')
  assert.equal(fs.existsSync(path.join(area, '2020-02-02')), true, 'the day given stays')
  assert.equal(fs.existsSync(path.join(area, '2020-02-03')), true)
  for (const d of ['2020-02-02', '2020-02-03']) fs.rmSync(path.join(area, d), { recursive: true, force: true })
})
