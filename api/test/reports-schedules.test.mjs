// Report schedules (docs/REPORTS.md 14; migration 251): the minute sweep
// (src/reports/schedules.js) and the one sender (src/reports/send.js).
// A schedule that is due is sent once, as its owner, to the people it names,
// moved on to its next time and recorded on Past runs; its condition can
// skip a run; a send that failed for a passing reason is tried again and a
// refused one waits; a run missed by more than six hours isn't sent; a
// schedule whose owner has left pauses and the group's owners are told; two
// sweeps at once send it once; addresses outside the team never get people's
// details. Email goes through a stand-in SendGrid: nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import XLSX from 'xlsx'

const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { sweepSchedules, RETRY_MINUTES, MAX_FAILURES } = await import('../src/reports/schedules.js')
const { LATE_HOURS } = await import('../../shared/reports/schedule.js')

const realFetch = globalThis.fetch
const mails = []
// Sends to refuse: { status, times } (a 503 is passing, a 401 isn't).
let refuse = null

const problems = []
const log = {
  info() {},
  warn(o, msg) { problems.push(['warn', msg, o?.err?.message || '']) },
  error(o, msg) { problems.push(['error', msg, o?.err?.stack || o?.err?.message || '']) },
}

let ids, filled, owner, admin, userId
const MIN = 60 * 1000
// The schedules' time of day: twelve hours from now at the venue, so a retry
// a few minutes after a run is never past the next regular one.
const farTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(new Date(Date.now() + 12 * 60 * MIN))

const schedules = () => sql`SELECT * FROM report_schedules WHERE tenant_id = ${ids.a} ORDER BY created_at`
const scheduleRow = async id => (await sql`SELECT * FROM report_schedules WHERE id = ${id}`)[0]
const runsOf = id => sql`SELECT * FROM report_runs WHERE schedule_id = ${id} ORDER BY created_at, id`

/** A schedule as the routes will save it (written straight to the table here). */
async function addSchedule(fields = {}) {
  const row = {
    tenant_id: ids.a,
    starter_key: 'till_sales_by_day',
    report_id: null,
    owner_sub: A.owner,
    owner_email: A.owner + '@test.local',
    name: null,
    message: null,
    timing: { every: 'day', time: farTime() },
    params: { period: { relative: 'today' } },
    delivery: { in_message: true, attach: 'csv', keep_file: false },
    condition: { when: 'always' },
    recipients: [{ user_id: userId[A.operator] }],
    personal_outside: false,
    next_run_at: new Date(Date.now() - MIN),
    ...fields,
  }
  const [r] = await sql`
    INSERT INTO report_schedules (tenant_id, starter_key, report_id, owner_sub, owner_email, name, message, timing, params,
                                  delivery, condition, recipients, personal_outside, next_run_at, retry_of, enabled, failures)
    VALUES (${row.tenant_id}, ${row.starter_key}, ${row.report_id}, ${row.owner_sub}, ${row.owner_email}, ${row.name}, ${row.message},
            ${sql.json(row.timing)}, ${sql.json(row.params)}, ${sql.json(row.delivery)}, ${sql.json(row.condition)},
            ${sql.json(row.recipients)}, ${row.personal_outside}, ${row.next_run_at}, ${row.retry_of || null},
            ${row.enabled ?? true}, ${row.failures ?? 0})
    RETURNING *`
  return r
}

const sweep = async () => {
  forgetReportResults()
  return sweepSchedules(log)
}
const html = m => m.body.content.find(c => c.type === 'text/html')?.value || ''
const toOf = m => m.body.personalizations[0].to.map(t => t.email)
const attachmentOf = m => m.body.attachments?.[0] || null

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
  userId = Object.fromEntries((await sql`SELECT auth0_user_id, id::text AS id FROM users WHERE tenant_id = ${ids.a}`).map(u => [u.auth0_user_id, u.id]))
  // The venue sends email through SendGrid (a stand-in).
  await ok(owner.post(`/api/email-templates/settings/${filled.ids.venue}`, {
    email_provider: 'sendgrid', provider_api_key: 'SG.schedule-test', from_name: 'Ware kitchen', from_email: 'hello@ware.example',
  }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      if (refuse && refuse.times > 0) {
        refuse.times--
        return new Response('{"errors":[{"message":"Try later"}]}', { status: refuse.status })
      }
      mails.push({ auth: opts.headers.Authorization, body: JSON.parse(opts.body) })
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + mails.length } })
    }
    return realFetch(url, opts)
  }
})
test.after(async () => { globalThis.fetch = realFetch; await closeApp() })
test.beforeEach(async () => {
  mails.length = 0
  problems.length = 0
  refuse = null
  if (ids) await sql`DELETE FROM report_schedules WHERE tenant_id = ${ids.a}`
})

test('a due schedule is sent once as its owner, moved on to its next time and recorded on Past runs', async () => {
  const s = await addSchedule({ name: 'Morning sales', message: 'Here are this morning\'s figures.' })
  const out = await sweep()
  assert.deepEqual(problems, [])
  assert.equal(out.claimed, 1)
  assert.equal(out.sent, 1)

  // One email, to the operator, from the venue's address, with the file.
  assert.equal(mails.length, 1)
  const m = mails[0]
  assert.equal(m.auth, 'Bearer SG.schedule-test')
  assert.deepEqual(toOf(m), [A.operator + '@test.local'])
  assert.equal(m.body.from.email, 'hello@ware.example')
  assert.equal(m.body.from.name, 'Ware kitchen')
  assert.match(m.body.subject, /^Morning sales/)
  assert.match(html(m), /Here are this morning&#39;s figures\.|Here are this morning's figures\./)
  const file = attachmentOf(m)
  assert.ok(file, 'a CSV attached')
  assert.match(file.filename, /\.csv$/)
  const csv = Buffer.from(file.content, 'base64').toString('utf8')
  assert.match(csv, /Net sales/)

  // Moved on to tomorrow's 08:00 and let go.
  const row = await scheduleRow(s.id)
  assert.equal(row.last_status, 'sent')
  assert.equal(row.failures, 0)
  assert.equal(row.running_until, null)
  assert.equal(row.retry_of, null)
  assert.ok(row.last_sent_at)
  assert.ok(row.next_run_at > new Date(), 'the next run is ahead: ' + row.next_run_at.toISOString())
  assert.ok(row.next_run_at - new Date() <= 24 * 60 * MIN, 'within a day')

  // Recorded as the owner's run, kind scheduled, with what was sent.
  const runs = await runsOf(s.id)
  assert.equal(runs.length, 1)
  assert.equal(runs[0].kind, 'scheduled')
  assert.equal(runs[0].user_sub, A.owner)
  assert.equal(runs[0].format, 'csv')
  assert.equal(runs[0].error, null)
  assert.equal(runs[0].delivery.sent, 1)
  assert.equal(runs[0].delivery.to, 1)
  assert.deepEqual(runs[0].delivery.to_hint, ['a***@test.local'])
  assert.ok(!JSON.stringify(runs[0].delivery).includes('a-operator@'), 'no address in full')

  // Past runs shows it to its owner as sent by a schedule, with the schedule.
  const page = await ok(owner.get('/api/reports/runs?schedule=' + s.id))
  assert.equal(page.runs.length, 1)
  assert.equal(page.runs[0].what, 'scheduled')
  assert.equal(page.runs[0].sent.sent, 1)
  assert.deepEqual(page.runs[0].schedule, { id: s.id, name: 'Morning sales' })

  // Not due again: a second sweep sends nothing.
  const again = await sweep()
  assert.equal(again.claimed, 0)
  assert.equal(mails.length, 1)
})

test('two sweeps at once send a schedule once', async () => {
  await addSchedule()
  const [a, b] = await Promise.all([sweep(), sweep()])
  assert.equal(a.claimed + b.claimed, 1)
  assert.equal(mails.length, 1)
})

test('a condition that isn\'t met skips the run without sending, and says what was found', async () => {
  const s = await addSchedule({ condition: { when: 'figure', value: 'net_sales', op: 'over', than: 1000000, scope: 'total' } })
  const out = await sweep()
  assert.deepEqual(problems, [])
  assert.equal(out.not_met, 1)
  assert.equal(mails.length, 0)
  const row = await scheduleRow(s.id)
  assert.equal(row.last_status, 'not_met')
  assert.match(row.last_error, /Net sales/)
  assert.ok(row.next_run_at > new Date())
  const [run] = await runsOf(s.id)
  assert.equal(run.delivery.not_met, true)
  const page = await ok(owner.get('/api/reports/runs?schedule=' + s.id))
  assert.equal(page.runs[0].what, 'skipped')

  // Met: sent.
  await sql`UPDATE report_schedules SET condition = ${sql.json({ when: 'figure', value: 'net_sales', op: 'over', than: 1, scope: 'total' })},
            next_run_at = now() - interval '1 minute' WHERE id = ${s.id}`
  const met = await sweep()
  assert.equal(met.sent, 1)
  assert.equal(mails.length, 1)
})

test('a send that fails for a passing reason is tried again a few minutes after it was due', async () => {
  const s = await addSchedule()
  refuse = { status: 503, times: 1 }
  const out = await sweep()
  assert.equal(out.failed, 1)
  assert.equal(mails.length, 0)
  let row = await scheduleRow(s.id)
  assert.equal(row.last_status, 'failed')
  assert.equal(row.failures, 0, 'a retry isn\'t a failed run')
  assert.ok(row.retry_of, 'it remembers when the run was due')
  assert.equal(row.retry_of.getTime(), s.next_run_at.getTime())
  assert.equal(row.next_run_at.getTime(), s.next_run_at.getTime() + RETRY_MINUTES[0] * MIN)
  assert.match(row.last_error, /Trying again at/)

  // The retry goes, and the schedule goes back to its own times.
  await sql`UPDATE report_schedules SET next_run_at = now() - interval '1 second' WHERE id = ${s.id}`
  const again = await sweep()
  assert.equal(again.sent, 1)
  assert.equal(mails.length, 1)
  row = await scheduleRow(s.id)
  assert.equal(row.retry_of, null)
  assert.equal(row.last_status, 'sent')
  assert.ok(row.next_run_at > new Date(Date.now() + 60 * MIN), 'tomorrow, not a retry')
})

test('a refused send waits for the next run, and pauses after five in a row', async () => {
  const s = await addSchedule()
  refuse = { status: 401, times: 100 }
  const out = await sweep()
  assert.equal(out.failed, 1)
  let row = await scheduleRow(s.id)
  assert.equal(row.failures, 1)
  assert.equal(row.retry_of, null, 'not retried: the key was refused')
  assert.ok(row.next_run_at > new Date(Date.now() + 60 * MIN))
  assert.equal(MAX_FAILURES, 5, 'Help says it pauses after five in a row')
  for (let i = 2; i <= 5; i++) {
    await sql`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = ${s.id}`
    await sweep()
  }
  row = await scheduleRow(s.id)
  assert.equal(row.enabled, false)
  assert.equal(row.last_status, 'paused')
  assert.match(row.paused_reason, /failed 5 times in a row/)
})

test('a run missed by more than six hours isn\'t sent, and the schedule moves on', async () => {
  const s = await addSchedule({ next_run_at: new Date(Date.now() - (LATE_HOURS * 60 + 5) * MIN) })
  const out = await sweep()
  assert.equal(out.late, 1)
  assert.equal(mails.length, 0)
  const row = await scheduleRow(s.id)
  assert.equal(row.last_status, 'late')
  assert.match(row.last_error, /wasn't sent/)
  assert.ok(row.next_run_at > new Date())
})

test('a schedule whose owner has left pauses, and the group\'s owners are told', async () => {
  const s = await addSchedule({ owner_sub: A.admin, owner_email: A.admin + '@test.local', name: 'Admin sales' })
  await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  try {
    const out = await sweep()
    assert.equal(out.paused, 1)
    const row = await scheduleRow(s.id)
    assert.equal(row.enabled, false)
    assert.match(row.paused_reason, /a-admin@test\.local is no longer on the team/)
    // Told: the group's owner (not the admin, who has left).
    assert.equal(mails.length, 1)
    assert.deepEqual(toOf(mails[0]), [A.owner + '@test.local'])
    assert.match(mails[0].body.subject, /^Report schedule paused: Admin sales/)
    assert.match(html(mails[0]), /no longer on the team/)
    // A paused schedule isn't claimed again.
    await sql`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = ${s.id}`
    assert.equal((await sweep()).claimed, 0)
  } finally {
    await sql`UPDATE users SET is_active = true WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  }
})

test('people who left the team aren\'t sent to, and a send to nobody left pauses', async () => {
  const s = await addSchedule({ recipients: [{ user_id: userId[A.viewer] }, { user_id: userId[A.operator] }] })
  await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.viewer}`
  try {
    const out = await sweep()
    assert.equal(out.sent, 1)
    assert.deepEqual(mails.map(toOf), [[A.operator + '@test.local']])
    const [run] = await runsOf(s.id)
    assert.equal(run.delivery.skipped, 1)

    await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.operator}`
    await sql`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id = ${s.id}`
    mails.length = 0
    const gone = await sweep()
    assert.equal(gone.paused, 1)
    assert.match((await scheduleRow(s.id)).paused_reason, /None of the people picked are on the team/)
  } finally {
    await sql`UPDATE users SET is_active = true WHERE tenant_id = ${ids.a} AND auth0_user_id IN (${A.viewer}, ${A.operator})`
  }
})

test('addresses outside the team get no people\'s details and no link into Macaroonie', async () => {
  // A list of bookings: the guest's name is a person's detail.
  const spec = {
    subject: 'bookings.bookings', kind: 'list',
    rows: [{ field: 'date' }, { field: 'guest_name' }, { field: 'covers' }],
    params: [{ key: 'period', type: 'period', label: 'Period', default: { relative: 'next_n_days', n: 60 } }],
    filters: [{ field: 'date', op: 'in_period', param: 'period' }],
  }
  const [saved] = await sql`
    INSERT INTO reports (tenant_id, owner_sub, owner_email, name, subject, spec)
    VALUES (${ids.a}, ${A.owner}, ${A.owner + '@test.local'}, 'Guest list', 'bookings.bookings', ${sql.json(spec)})
    RETURNING id`
  const s = await addSchedule({
    starter_key: null, report_id: saved.id,
    params: {},
    delivery: { in_message: true, attach: 'xlsx', keep_file: false },
    recipients: [{ user_id: userId[A.operator] }, { email: 'accountant@outside.example' }],
  })
  const out = await sweep()
  assert.deepEqual(problems.filter(p => p[0] === 'error'), [])
  assert.equal(out.sent, 1, JSON.stringify(await scheduleRow(s.id)))
  assert.equal(mails.length, 2)
  const team = mails.find(m => toOf(m)[0] === A.operator + '@test.local')
  const outside = mails.find(m => toOf(m)[0] === 'accountant@outside.example')
  const read = m => XLSX.read(Buffer.from(attachmentOf(m).content, 'base64'), { type: 'buffer' })
  const head = wb => XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0]
  assert.ok(head(read(team)).includes('Guest name'), 'the team sees the guest name: ' + head(read(team)))
  assert.ok(!head(read(outside)).includes('Guest name'), 'the outside copy leaves it out: ' + head(read(outside)))
  assert.match(html(team), /\/reports\//, 'the team gets a link to the report')
  assert.doesNotMatch(html(outside), /\/reports\//, 'no link into Macaroonie for an address outside the team')
})

test('a schedule only sees its own group\'s rows and venues', async () => {
  // Group B's owner can't be a group A schedule's owner: not on A's team.
  const s = await addSchedule({ owner_sub: B.owner, owner_email: B.owner + '@test.local' })
  const out = await sweep()
  assert.equal(out.paused, 1)
  assert.match((await scheduleRow(s.id)).paused_reason, /no longer on the team/)
  assert.equal((await schedules()).length, 1)
  // Another group's venue in the choices: paused, not sent.
  const [venueB] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.b} LIMIT 1`
  if (venueB) {
    const s2 = await addSchedule({ params: { period: { relative: 'today' }, venues: [venueB.id] } })
    mails.length = 0
    const out2 = await sweep()
    assert.equal(out2.paused, 1)
    assert.equal(mails.filter(m => toOf(m)[0] === A.operator + '@test.local').length, 0)
    assert.match((await scheduleRow(s2.id)).paused_reason, /Venue not found/)
  }
})

test('too many requests (429) is a passing reason: tried again, not counted as a failed run', async () => {
  const s = await addSchedule()
  refuse = { status: 429, times: 1 }
  await sweep()
  const row = await scheduleRow(s.id)
  assert.equal(row.failures, 0)
  assert.ok(row.retry_of, 'a retry is planned')
})

test('a schedule another sweep holds isn\'t claimed until its hold runs out', async () => {
  const s = await addSchedule()
  await sql`UPDATE report_schedules SET running_until = now() + interval '5 minutes' WHERE id = ${s.id}`
  const out = await sweep()
  assert.equal(out.claimed, 0)
  assert.equal(mails.length, 0)
  await sql`UPDATE report_schedules SET running_until = now() - interval '1 second' WHERE id = ${s.id}`
  assert.equal((await sweep()).claimed, 1)
  assert.equal(mails.length, 1)
})

test('a list whose every column is a person\'s detail has no outside copy at all', async () => {
  const { outsideCopy, PII_HELD } = await import('../src/reports/send.js')
  const result = { kind: 'list', spec: { kind: 'list', rows: [{ field: 'guest_name' }] }, columns: [{ key: 'c0', pii: true }], rows: [{ cells: ['Zqx Bob'] }], totals: null, meta: {} }
  const out = outsideCopy(result)
  assert.equal(out.result, null)
  assert.equal(out.note, PII_HELD)
})

test('what counts as a passing failure, for every provider', async () => {
  const { transientSend } = await import('../src/reports/send.js')
  assert.equal(transientSend({ message: 'SendGrid 429: busy' }), true)
  assert.equal(transientSend({ message: 'Postmark 401: bad key' }), false)
  assert.equal(transientSend({ status: 429 }), true)
  assert.equal(transientSend({ statusCode: 503 }), true)
  assert.equal(transientSend({ $metadata: { httpStatusCode: 400 } }), false)
  assert.equal(transientSend({ responseCode: 421 }), true)
  assert.equal(transientSend({ responseCode: 550 }), false)
  assert.equal(transientSend({ code: 'ECONNRESET' }), true)
  assert.equal(transientSend({ timeout: true }), true)
  assert.equal(transientSend(null), false)
})
