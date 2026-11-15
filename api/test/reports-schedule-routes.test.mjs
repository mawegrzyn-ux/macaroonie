// Report schedule routes (docs/REPORTS.md 14, 18; migration 251): saving,
// listing, changing, pausing, resuming, deleting and sending schedules, and
// Email it now. A schedule is checked as it will run when it is saved (who
// may send it to whom, its timing, its period, the figure it watches); a
// person with Manage changing someone else's makes it their own; a schedule
// a send holds can't be changed or deleted; resuming checks it as its owner;
// a send that reached nobody is refused with why; and another group's
// schedules, people and venues never show. Email goes through a stand-in
// SendGrid: nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'

const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B, PLATFORM } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { MAX_SCHEDULES } = await import('../src/routes/reportSchedules.js')

const STARTER = 'starter:till_sales_by_day'
const BUILDER = 'a-sched-builder'
const MANAGER = 'a-sched-manager'
const FLOOR = 'a-sched-floor'
const OUTSIDE = 'accountant@outside.example'

const realFetch = globalThis.fetch
const mails = []
// Sends to refuse: { status, times }.
let refuse = null

let ids, filled, V, venueName, today, userId, userIdB, venueB
let owner, admin, operator, viewer, builder, manager, floor, ownerB, platform
let floorRole, builderRole

const path = id => '/api/reports/' + id
const schedulesOf = id => path(id) + '/schedules'
const one = sid => '/api/reports/schedules/' + sid
const rowOf = async sid => (await sql`SELECT * FROM report_schedules WHERE id = ${sid}`)[0]
const runOf = async id => (await sql`SELECT * FROM report_runs WHERE id = ${id}`)[0]
const toOf = m => m.body.personalizations[0].to.map(t => t.email)
const htmlOf = m => m.body.content.find(c => c.type === 'text/html')?.value || ''

// A schedule of the starter to the people given (the person saving, unless said).
const scheduleBody = (to, over = {}) => ({
  timing: { every: 'week', days: [1], time: '07:30' },
  params: { period: { relative: 'today' }, venues: [V] },
  delivery: { in_message: true, attach: 'csv' },
  condition: { when: 'always' },
  recipients: to,
  ...over,
})
const me = sub => [{ user_id: userId[sub] }]

// The schedule's next run as its venue's clock shows it: "Mon 07:30".
const atVenue = (iso, tz) => new Intl.DateTimeFormat('en-GB', {
  timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso)).replace(',', '')

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  const filledB = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  assert.deepEqual(filledB.failed, [], 'fixtures B: ' + JSON.stringify(filledB.failed).slice(0, 600))
  venueB = filledB.ids.venue
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  admin = as(A.admin, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  platform = as(PLATFORM, ids.a)
  const t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  today = t.date
  ;[{ name: venueName }] = await sql`SELECT name FROM venues WHERE id = ${V}`

  // Someone who builds reports on till sales, someone who manages reports
  // without being an owner or an admin, and someone who only looks.
  builderRole = await ok(owner.post('/api/access/roles', {
    key: 'sched_builder', label: 'Report builder', permissions: { reports: 'use', pos_reports: 'view', bookings: 'view' },
  }), 'builder role')
  const managerRole = await ok(owner.post('/api/access/roles', {
    key: 'sched_manager', label: 'Report manager', permissions: { reports: 'manage', pos_reports: 'view', bookings: 'view' },
  }), 'manager role')
  floorRole = await ok(owner.post('/api/access/roles', {
    key: 'sched_floor', label: 'Floor', permissions: { reports: 'view', pos_reports: 'view' },
  }), 'floor role')
  for (const [sub, role] of [[BUILDER, builderRole], [MANAGER, managerRole], [FLOOR, floorRole]]) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
              VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${role.id})`
  }
  builder = as(BUILDER, ids.a)
  manager = as(MANAGER, ids.a)
  floor = as(FLOOR, ids.a)
  userId = Object.fromEntries((await sql`SELECT auth0_user_id, id::text AS id FROM users WHERE tenant_id = ${ids.a}`).map(u => [u.auth0_user_id, u.id]))
  ;[{ id: userIdB }] = await sql`SELECT id::text AS id FROM users WHERE tenant_id = ${ids.b} AND auth0_user_id = ${B.owner}`

  // The venue sends email through SendGrid (a stand-in).
  await ok(owner.post(`/api/email-templates/settings/${V}`, {
    email_provider: 'sendgrid', provider_api_key: 'SG.schedule-routes', from_name: 'Ware kitchen', from_email: 'hello@ware.example',
  }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      if (refuse && refuse.times > 0) {
        refuse.times--
        return new Response('{"errors":[{"message":"Bad key"}]}', { status: refuse.status })
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
  refuse = null
  forgetReportResults()
  if (ids) await sql`DELETE FROM report_schedules WHERE tenant_id IN (${ids.a}, ${ids.b})`
})

test('who may schedule what to whom: Use to themselves, Manage to the team, owners and admins outside it', async () => {
  // Someone with Use, to themselves: saved, and the schedule says what it will do.
  const res = await builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER)))
  assert.equal(res.status, 201, res.body)
  const s = res.json.schedule
  assert.equal(s.report.id, STARTER)
  assert.equal(s.report.kind, 'starter')
  assert.equal(s.report.name, 'Sales by day')
  assert.equal(s.report.subject, 'till.checks')
  assert.equal(s.timing_text, 'Every Monday at 07:30')
  assert.equal(s.delivery_text, 'The report in the email and a CSV file attached')
  assert.equal(s.condition_text, 'Every time')
  assert.deepEqual(s.choices.map(c => [c.key, c.text]), [['period', 'Today'], ['venues', venueName]])
  assert.deepEqual(s.params, { period: { relative: 'today' }, venues: [V] })
  assert.equal(s.recipients.length, 1)
  assert.equal(s.recipients[0].email, BUILDER + '@test.local')
  assert.equal(s.recipients[0].on_team, true)
  assert.equal(s.recipients[0].outside, false)
  assert.equal(s.enabled, true)
  assert.equal(s.mine, true)
  assert.equal(s.takes_over, false)
  assert.ok(s.can_change && s.can_pause && s.can_delete && s.can_send)
  assert.equal(s.owner_email, BUILDER + '@test.local')
  assert.equal(s.time_zone, 'Europe/London')
  assert.ok(new Date(s.next_run_at) > new Date(), 'the next run is ahead')
  assert.ok(new Date(s.next_run_at) - new Date() <= 8 * 86400000, 'within the week')
  assert.equal(atVenue(s.next_run_at, s.time_zone), 'Mon 07:30')
  const row = await rowOf(s.id)
  assert.equal(row.owner_sub, BUILDER)
  assert.equal(row.starter_key, 'till_sales_by_day')
  assert.equal(row.report_id, null)
  assert.deepEqual(row.delivery, { in_message: true, attach: 'csv', keep_file: false })

  // The person's own address, typed: still themselves.
  const typed = await builder.post(schedulesOf(STARTER), scheduleBody([{ email: BUILDER.toUpperCase() + '@test.local' }]))
  assert.equal(typed.status, 201, typed.body)
  assert.equal(typed.json.schedule.recipients[0].on_team, true)

  // To anyone else on the team needs Manage.
  const others = await builder.post(schedulesOf(STARTER), scheduleBody([...me(BUILDER), { user_id: userId[A.operator] }]))
  assert.equal(others.status, 403)
  assert.match(others.json.error, /Sending a report to other people needs Manage on Reports/)
  // View only can't schedule; no access to reports can't reach the route.
  const fl = await floor.post(schedulesOf(STARTER), scheduleBody(me(FLOOR)))
  assert.equal(fl.status, 403)
  const vw = await viewer.post(schedulesOf(STARTER), scheduleBody(me(A.viewer)))
  assert.equal(vw.status, 403)

  // Manage, to the team: saved.
  const team = await manager.post(schedulesOf(STARTER), scheduleBody([{ user_id: userId[A.operator] }]))
  assert.equal(team.status, 201, team.body)
  assert.equal(team.json.schedule.recipients[0].email, A.operator + '@test.local')
  // Manage without being an owner or an admin: not outside the team, and no people's details outside.
  const out = await manager.post(schedulesOf(STARTER), scheduleBody([{ email: OUTSIDE }]))
  assert.equal(out.status, 403)
  assert.match(out.json.error, /Only an owner or an admin can send reports to addresses outside the team/)
  const personal = await manager.post(schedulesOf(STARTER), scheduleBody([{ user_id: userId[A.operator] }], { personal_outside: true }))
  assert.equal(personal.status, 403)
  assert.match(personal.json.error, /Only an owner or an admin can send people's details outside the team/)

  // An owner, and an admin, outside the team.
  const byOwner = await owner.post(schedulesOf(STARTER), scheduleBody([{ email: OUTSIDE }, ...me(A.owner)]))
  assert.equal(byOwner.status, 201, byOwner.body)
  const outsider = byOwner.json.schedule.recipients.find(r => r.email === OUTSIDE)
  assert.deepEqual(outsider, { email: OUTSIDE, user_id: null, name: null, on_team: false, outside: true })
  const byAdmin = await admin.post(schedulesOf(STARTER), scheduleBody([{ email: OUTSIDE }], { personal_outside: true }))
  assert.equal(byAdmin.status, 201, byAdmin.body)
  assert.equal(byAdmin.json.schedule.personal_outside, true)
  // Nothing was sent by saving.
  assert.equal(mails.length, 0)
})

test('what saving refuses: its timing, a fixed period, nobody to send to, a figure it can\'t watch, another group\'s people and venues, too many', async () => {
  const refused = async (body, status, re, id = STARTER, who = owner) => {
    const res = await who.post(schedulesOf(id), body)
    assert.equal(res.status, status, JSON.stringify(body) + ': ' + res.body)
    if (re) assert.match(res.json.error, re)
    return res
  }
  await refused(scheduleBody(me(A.owner), { timing: { every: 'week', days: [] } }), 422, /Pick at least one day of the week/)
  await refused(scheduleBody(me(A.owner), { timing: { every: 'day', time: '25:00' } }), 422, /Type the time as HH:MM/)
  await refused(scheduleBody(me(A.owner), { params: { period: { from: '2026-11-01', to: '2026-11-07' }, venues: [V] } }), 422, /The period is fixed/)
  await refused(scheduleBody([]), 422, /Add at least one person to send it to/)
  await refused(scheduleBody([{ email: 'not an address' }]), 422, /isn't an email address/)
  await refused(scheduleBody(me(A.owner), { delivery: { in_message: false, attach: 'none' } }), 422, /Put the report in the email, attach a file, or both/)

  // A figure the report shows can be watched; one that isn't a number, or a list's, can't.
  const watched = await owner.post(schedulesOf(STARTER), scheduleBody(me(A.owner), {
    condition: { when: 'figure', value: 'net_sales', op: 'over', than: 100, scope: 'total' },
  }))
  assert.equal(watched.status, 201, watched.body)
  assert.match(watched.json.schedule.condition_text, /^Only when Net sales is over £100(\.00)? in total$/)
  const [summary] = await sql`
    INSERT INTO reports (tenant_id, owner_sub, owner_email, name, subject, spec)
    VALUES (${ids.a}, ${A.owner}, ${A.owner + '@test.local'}, 'Sales and last check', 'till.checks', ${sql.json({
      subject: 'till.checks',
      rows: [{ field: 'date' }],
      values: [{ key: 'net', measure: 'net_sales' }, { key: 'last', agg: 'max', field: 'opened_at' }],
      params: [{ key: 'period', type: 'period', label: 'Period', default: { relative: 'last_n_days', n: 7 } }],
      filters: [{ field: 'date', op: 'in_period', param: 'period' }],
    })})
    RETURNING id`
  await refused(scheduleBody(me(A.owner), { params: {}, condition: { when: 'figure', value: 'last', op: 'over', than: 1 } }),
    422, /Pick one of the report's figures to watch/, summary.id)
  const net = await owner.post(schedulesOf(summary.id), scheduleBody(me(A.owner), { params: {}, condition: { when: 'figure', value: 'net', op: 'under', than: 5 } }))
  assert.equal(net.status, 201, net.body)
  assert.equal(net.json.schedule.report.kind, 'saved')
  assert.equal(net.json.schedule.report.name, 'Sales and last check')
  // A choice the report doesn't ask for isn't kept.
  assert.deepEqual(net.json.schedule.params, {})
  const [list] = await sql`
    INSERT INTO reports (tenant_id, owner_sub, owner_email, name, subject, spec)
    VALUES (${ids.a}, ${A.owner}, ${A.owner + '@test.local'}, 'Checks opened', 'till.checks', ${sql.json({
      subject: 'till.checks', kind: 'list',
      rows: [{ field: 'date' }, { field: 'opened_at' }],
      params: [{ key: 'period', type: 'period', label: 'Period', default: { relative: 'yesterday' } }],
      filters: [{ field: 'date', op: 'in_period', param: 'period' }],
    })})
    RETURNING id`
  await refused(scheduleBody(me(A.owner), { params: {}, condition: { when: 'figure', value: 'net', op: 'over', than: 1 } }),
    422, /Only a summary has figures to watch/, list.id)

  // Another group's person isn't on the team; another group's venue isn't found; another group's report isn't either.
  await refused(scheduleBody([{ user_id: userIdB }]), 422, /None of the people picked are on the team any more/)
  await refused(scheduleBody(me(A.owner), { params: { period: { relative: 'today' }, venues: [venueB] } }), 404, /Venue not found/)
  await refused(scheduleBody([{ user_id: userIdB }]), 404, /Report not found/, summary.id, ownerB)
  // Someone who isn't on the group's team (a platform admin) can't own a schedule.
  await refused(scheduleBody([{ email: OUTSIDE }]), 422, /you aren't on it/, STARTER, platform)

  // At most MAX_SCHEDULES each.
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM report_schedules WHERE tenant_id = ${ids.a} AND owner_sub = ${A.owner}`
  for (let i = n; i < MAX_SCHEDULES; i++) {
    await sql`INSERT INTO report_schedules (tenant_id, starter_key, owner_sub, owner_email, timing, next_run_at)
              VALUES (${ids.a}, 'till_sales_by_day', ${A.owner}, ${A.owner + '@test.local'}, ${sql.json({ every: 'day', time: '08:00' })}, now() + interval '1 day')`
  }
  await refused(scheduleBody(me(A.owner)), 422, new RegExp('You have ' + MAX_SCHEDULES + ' schedules'))
  // Someone else still can.
  const other = await admin.post(schedulesOf(STARTER), scheduleBody(me(A.admin)))
  assert.equal(other.status, 201, other.body)
})

test('listing: the person\'s own schedules, everyone\'s with Manage, a report\'s; another person\'s and another group\'s stay out of sight', async () => {
  const mine = await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))
  const theirs = await ok(owner.post(schedulesOf(STARTER), scheduleBody([{ user_id: userId[A.operator] }])))
  const b = await ok(ownerB.post(schedulesOf(STARTER), { ...scheduleBody([{ user_id: userIdB }]), params: { period: { relative: 'today' } } }))

  const list = await ok(builder.get('/api/reports/schedules'))
  assert.deepEqual(list.schedules.map(s => s.id), [mine.schedule.id])
  assert.equal(list.can_use, true)
  assert.equal(list.can_manage, false)
  assert.equal(list.max, MAX_SCHEDULES)
  const all = await builder.get('/api/reports/schedules?scope=all')
  assert.equal(all.status, 403)
  assert.match(all.json.error, /Seeing everyone's schedules needs Manage on Reports/)

  // An owner sees their own, everyone's with scope=all, and every schedule of a report.
  assert.deepEqual((await ok(owner.get('/api/reports/schedules'))).schedules.map(s => s.id), [theirs.schedule.id])
  const every = await ok(owner.get('/api/reports/schedules?scope=all'))
  assert.deepEqual(every.schedules.map(s => s.id).sort(), [mine.schedule.id, theirs.schedule.id].sort())
  const other = every.schedules.find(s => s.id === mine.schedule.id)
  assert.equal(other.mine, false)
  assert.equal(other.takes_over, true)
  assert.equal(other.can_change, true)
  assert.equal(other.owner_email, BUILDER + '@test.local')
  assert.equal((await ok(owner.get(schedulesOf(STARTER)))).schedules.length, 2)
  assert.deepEqual((await ok(builder.get(schedulesOf(STARTER)))).schedules.map(s => s.id), [mine.schedule.id])
  assert.deepEqual((await ok(builder.get('/api/reports/schedules?report=' + STARTER))).schedules.map(s => s.id), [mine.schedule.id])
  assert.deepEqual((await ok(builder.get('/api/reports/schedules?report=starter:till_sales_by_hour_weekday'))).schedules, [])

  // One schedule: its owner, or Manage.
  assert.equal((await ok(builder.get(one(mine.schedule.id)))).schedule.id, mine.schedule.id)
  assert.equal((await builder.get(one(theirs.schedule.id))).status, 404)
  assert.equal((await ok(owner.get(one(mine.schedule.id)))).schedule.takes_over, true)
  assert.equal((await builder.get(one('not-a-uuid'))).status, 404)

  // Another group sees nothing of these, and these see nothing of theirs.
  assert.equal((await ownerB.get(one(theirs.schedule.id))).status, 404)
  assert.deepEqual((await ok(ownerB.get('/api/reports/schedules?scope=all'))).schedules.map(s => s.id), [b.schedule.id])
  assert.equal((await owner.get(one(b.schedule.id))).status, 404)
  assert.ok(!(await ok(owner.get('/api/reports/schedules?scope=all'))).schedules.some(s => s.id === b.schedule.id))

  // View only sees an empty list; no access to reports, nothing.
  const fl = await ok(floor.get('/api/reports/schedules'))
  assert.deepEqual(fl.schedules, [])
  assert.equal(fl.can_use, false)
  assert.equal((await viewer.get('/api/reports/schedules')).status, 403)
})

test('changing a schedule: its owner, or Manage making it their own; the next run follows the timing; paused stays paused; a send holding it stops a change', async () => {
  const { schedule: s } = await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))

  const changed = await ok(builder.patch(one(s.id), { timing: { every: 'day', time: '06:15' }, name: 'Daily sales', message: 'Morning figures' }))
  assert.equal(changed.schedule.timing_text, 'Every day at 06:15')
  assert.equal(changed.schedule.name, 'Daily sales')
  assert.equal(changed.schedule.message, 'Morning figures')
  assert.match(atVenue(changed.schedule.next_run_at, changed.schedule.time_zone), / 06:15$/)
  assert.ok(new Date(changed.schedule.next_run_at) - new Date() <= 86400000, 'within a day')
  // What wasn't sent stays as it was.
  assert.equal(changed.schedule.delivery_text, 'The report in the email and a CSV file attached')
  assert.deepEqual(changed.schedule.params, { period: { relative: 'today' }, venues: [V] })
  // An empty name goes back to the report's own.
  assert.equal((await ok(builder.patch(one(s.id), { name: '' }))).schedule.name, null)
  const bad = await builder.patch(one(s.id), { timing: { every: 'week', days: [] } })
  assert.equal(bad.status, 422)
  const fixed = await builder.patch(one(s.id), { params: { period: { from: today, to: today } } })
  assert.equal(fixed.status, 422)
  assert.match(fixed.json.error, /The period is fixed/)
  const others = await builder.patch(one(s.id), { recipients: [{ user_id: userId[A.operator] }] })
  assert.equal(others.status, 403)
  assert.equal((await rowOf(s.id)).recipients[0].user_id, userId[BUILDER], 'a refused change changes nothing')

  // Someone with Manage changing it makes it theirs: it then sends what their role sees.
  assert.equal((await ok(owner.get(one(s.id)))).schedule.takes_over, true)
  const taken = await ok(owner.patch(one(s.id), { message: 'From the owner' }))
  assert.equal(taken.schedule.mine, true)
  assert.equal(taken.schedule.owner_email, A.owner + '@test.local')
  assert.equal(taken.schedule.message, 'From the owner')
  assert.equal((await rowOf(s.id)).owner_sub, A.owner)
  assert.equal((await builder.get(one(s.id))).status, 404, 'the builder no longer sees it')
  assert.equal((await builder.patch(one(s.id), { name: 'Mine again' })).status, 404)

  // Paused stays paused through a change, and has no next run until resumed.
  const paused = await ok(owner.post(one(s.id) + '/pause'))
  assert.equal(paused.schedule.enabled, false)
  assert.equal(paused.schedule.paused_reason, 'Paused by ' + A.owner + '@test.local')
  assert.equal(paused.schedule.next_run_at, null)
  const still = await ok(owner.patch(one(s.id), { name: 'Still paused' }))
  assert.equal(still.schedule.enabled, false)
  assert.equal(still.schedule.next_run_at, null)
  assert.ok((await rowOf(s.id)).next_run_at, 'the row keeps a next run for when it is resumed')

  // While a send holds it: no change, no delete, no second send.
  await sql`UPDATE report_schedules SET running_until = now() + interval '5 minutes' WHERE id = ${s.id}`
  assert.equal((await ok(owner.get(one(s.id)))).schedule.sending, true)
  for (const res of [
    await owner.patch(one(s.id), { name: 'Held' }),
    await owner.delete(one(s.id)),
    await owner.post(one(s.id) + '/send'),
  ]) {
    assert.equal(res.status, 409, res.body)
    assert.match(res.json.error, /It is being sent right now/)
  }
  assert.equal((await rowOf(s.id)).name, 'Still paused')
  assert.equal(mails.length, 0)
  // A hold that has run out (the process that held it died) doesn't count.
  await sql`UPDATE report_schedules SET running_until = now() - interval '1 minute' WHERE id = ${s.id}`
  assert.equal((await ok(owner.patch(one(s.id), { name: 'Free again' }))).schedule.name, 'Free again')
})

test('pausing and resuming: whoever can see it pauses it; resuming checks it as its owner', async () => {
  const { schedule: s } = await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))
  const paused = await ok(builder.post(one(s.id) + '/pause'))
  assert.equal(paused.schedule.enabled, false)
  assert.equal(paused.schedule.paused_reason, 'Paused by ' + BUILDER + '@test.local')
  assert.equal((await ok(builder.post(one(s.id) + '/pause'))).schedule.paused_reason, 'Paused by ' + BUILDER + '@test.local')

  await sql`UPDATE report_schedules SET failures = 3, next_run_at = now() - interval '2 days' WHERE id = ${s.id}`
  const resumed = await ok(builder.post(one(s.id) + '/resume'))
  assert.equal(resumed.schedule.enabled, true)
  assert.equal(resumed.schedule.paused_reason, null)
  assert.equal(resumed.schedule.failures, 0)
  assert.ok(new Date(resumed.schedule.next_run_at) > new Date(), 'the next run is worked out again from now')
  assert.equal((await ok(builder.post(one(s.id) + '/resume'))).schedule.enabled, true)

  // Its owner has left: an owner can't resume it until they make it theirs.
  await ok(builder.post(one(s.id) + '/pause'))
  await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${BUILDER}`
  try {
    const gone = await owner.post(one(s.id) + '/resume')
    assert.equal(gone.status, 422)
    assert.match(gone.json.error, new RegExp(BUILDER + '@test.local is no longer on the team, so it can\'t send'))
  } finally {
    await sql`UPDATE users SET is_active = true WHERE tenant_id = ${ids.a} AND auth0_user_id = ${BUILDER}`
  }

  // Its owner can't schedule reports any more: an owner resuming it is told so.
  await sql`UPDATE users SET custom_role_id = ${floorRole.id} WHERE tenant_id = ${ids.a} AND auth0_user_id = ${BUILDER}`
  try {
    const lost = await owner.post(one(s.id) + '/resume')
    assert.equal(lost.status, 403)
    assert.match(lost.json.error, new RegExp('^' + BUILDER + '@test.local can\'t send it: scheduling reports needs Use on Reports'))
    assert.equal((await rowOf(s.id)).enabled, false)
    // The owner, with View only, can't resume it, but can still pause and delete their own.
    assert.equal((await builder.post(one(s.id) + '/resume')).status, 403)
    assert.equal((await builder.post(one(s.id) + '/pause')).status, 200)
    assert.equal((await builder.delete(one(s.id))).status, 204)
    assert.equal(await rowOf(s.id), undefined)
  } finally {
    await sql`UPDATE users SET custom_role_id = ${builderRole.id} WHERE tenant_id = ${ids.a} AND auth0_user_id = ${BUILDER}`
  }
})

test('Send now: one email as its owner whatever its condition, recorded on Past runs, its next run as it was', async () => {
  const { schedule: s } = await ok(owner.post(schedulesOf(STARTER), scheduleBody([{ user_id: userId[A.operator] }], {
    name: 'Sales so far',
    // A figure no day reaches: Send now sends whatever the condition.
    condition: { when: 'figure', value: 'net_sales', op: 'over', than: 999999999, scope: 'total' },
  })))
  const before = await rowOf(s.id)
  const sent = await ok(owner.post(one(s.id) + '/send'))
  assert.equal(sent.status, 'sent')
  assert.equal(sent.to, 1)
  assert.equal(sent.sent, 1)
  assert.equal(sent.failed, 0)
  assert.equal(sent.schedule.last_status, 'sent')
  assert.ok(sent.run_id)
  assert.equal(mails.length, 1)
  assert.deepEqual(toOf(mails[0]), [A.operator + '@test.local'])
  assert.equal(mails[0].auth, 'Bearer SG.schedule-routes')
  assert.match(mails[0].body.subject, /^Sales so far/)
  assert.match(htmlOf(mails[0]), /set this up in Macaroonie/)
  assert.ok(mails[0].body.attachments?.[0]?.filename.endsWith('.csv'), 'the CSV attached')

  const row = await rowOf(s.id)
  assert.equal(row.last_status, 'sent')
  assert.ok(row.last_sent_at && row.last_run_at)
  assert.equal(row.running_until, null, 'let go')
  assert.equal(row.failures, 0)
  assert.equal(row.next_run_at.getTime(), before.next_run_at.getTime(), 'its next run as it was')
  const run = await runOf(sent.run_id)
  assert.equal(run.kind, 'scheduled')
  assert.equal(run.schedule_id, s.id)
  assert.equal(run.format, 'csv')
  assert.equal(run.delivery.sent, 1)
  assert.equal(run.delivery.forced, true, 'sent although its condition wasn\'t met')
  assert.ok(!JSON.stringify(run.delivery).includes(A.operator + '@test.local'), 'addresses masked in the record')

  // A paused schedule can be sent now too; it stays paused.
  await ok(owner.post(one(s.id) + '/pause'))
  mails.length = 0
  forgetReportResults()
  const again = await ok(owner.post(one(s.id) + '/send'))
  assert.equal(again.status, 'sent')
  assert.equal(again.schedule.enabled, false)
  assert.equal(mails.length, 1)

  // The email service refuses: refused with why, recorded, let go.
  refuse = { status: 401, times: 5 }
  mails.length = 0
  forgetReportResults()
  const failed = await owner.post(one(s.id) + '/send')
  assert.equal(failed.status, 422, failed.body)
  assert.equal(failed.json.code, 'not_sent')
  assert.match(failed.json.error, /^It wasn't sent: /)
  assert.ok(failed.json.run_id)
  const after = await rowOf(s.id)
  assert.equal(after.last_status, 'failed')
  assert.ok(after.last_error)
  assert.equal(after.running_until, null)
  assert.equal((await runOf(failed.json.run_id)).delivery.failed, 1)

  // Someone with Use sends their own; not someone else's.
  refuse = null
  const { schedule: b } = await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))
  mails.length = 0
  forgetReportResults()
  assert.equal((await ok(builder.post(one(b.id) + '/send'))).status, 'sent')
  assert.deepEqual(mails.map(toOf), [[BUILDER + '@test.local']])
  assert.equal((await builder.post(one(s.id) + '/send')).status, 404)
  assert.equal((await floor.post(one(b.id) + '/send')).status, 403)
})

test('Email it now: the report run as the person asking and emailed once, as a send would be checked', async () => {
  const send = (who, body, headers) => who.post(path(STARTER) + '/send', {
    params: { period: { relative: 'today' }, venues: [V] }, delivery: { in_message: true, attach: 'none' }, ...body,
  }, headers)

  const res = await send(builder, { recipients: me(BUILDER), message: 'For the meeting' })
  assert.equal(res.status, 200, res.body)
  assert.equal(res.json.status, 'sent')
  assert.equal(res.json.sent, 1)
  assert.deepEqual(mails.map(toOf), [[BUILDER + '@test.local']])
  assert.match(htmlOf(mails[0]), /For the meeting/)
  assert.match(htmlOf(mails[0]), /You sent this from Macaroonie/)
  assert.ok(!mails[0].body.attachments, 'no file asked for')
  const run = await runOf(res.json.run_id)
  assert.equal(run.kind, 'emailed')
  assert.equal(run.schedule_id, null)
  assert.equal(run.format, 'email')
  assert.equal(run.user_sub, BUILDER)

  // A fixed period is fine for a send made once.
  forgetReportResults()
  assert.equal((await send(builder, { recipients: me(BUILDER), params: { period: { from: today, to: today }, venues: [V] } })).status, 200)
  // Not to anyone else without Manage; not at all without Use.
  assert.equal((await send(builder, { recipients: [{ user_id: userId[A.operator] }] })).status, 403)
  assert.equal((await send(floor, { recipients: me(FLOOR) })).status, 403)
  // Nobody to send to; an address that isn't one.
  assert.equal((await send(owner, { recipients: [] })).status, 422)
  assert.equal((await send(owner, { recipients: [{ email: 'nope' }] })).status, 422)

  // An owner, outside the team: no link into Macaroonie for that address.
  mails.length = 0
  forgetReportResults()
  const out = await send(owner, { recipients: [{ email: OUTSIDE }] })
  assert.equal(out.status, 200, out.body)
  assert.deepEqual(mails.map(toOf), [[OUTSIDE]])
  assert.doesNotMatch(htmlOf(mails[0]), /\/reports\//)

  // Pepper asking is recorded as Pepper's.
  forgetReportResults()
  const viaPepper = await send(owner, { recipients: me(A.owner) }, { 'x-maca-via': 'pepper' })
  assert.equal(viaPepper.status, 200, viaPepper.body)
  assert.equal((await runOf(viaPepper.json.run_id)).params.via, 'pepper')

  // Another group can't send this group's saved report.
  const [saved] = await sql`
    INSERT INTO reports (tenant_id, owner_sub, owner_email, name, subject, spec)
    VALUES (${ids.a}, ${A.owner}, ${A.owner + '@test.local'}, 'Sales by venue', 'till.checks', ${sql.json({
      subject: 'till.checks', rows: [{ field: 'venue' }], values: [{ key: 'net', measure: 'net_sales' }],
    })})
    RETURNING id`
  const theirs = await ownerB.post(path(saved.id) + '/send', { recipients: [{ user_id: userIdB }] })
  assert.equal(theirs.status, 404)
})

test('deleting, and who the schedule window offers to send to', async () => {
  const { schedule: mine } = await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))
  const { schedule: theirs } = await ok(owner.post(schedulesOf(STARTER), scheduleBody(me(A.owner))))
  assert.equal((await builder.delete(one(theirs.id))).status, 404)
  assert.equal((await builder.delete(one(mine.id))).status, 204)
  assert.equal((await builder.get(one(mine.id))).status, 404)
  const { schedule: again } = await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))
  assert.equal((await owner.delete(one(again.id))).status, 204, 'Manage deletes anyone\'s')
  assert.equal((await ownerB.delete(one(theirs.id))).status, 404)
  assert.ok(await rowOf(theirs.id), 'another group can\'t delete it')

  // Who can be picked: the person's own address; the team with Manage; outside with an owner or admin.
  const b = await ok(builder.get('/api/reports/recipients'))
  assert.equal(b.me.email, BUILDER + '@test.local')
  assert.equal(b.me.user_id, userId[BUILDER])
  assert.deepEqual(b.team, [])
  assert.deepEqual([b.can_others, b.can_outside, b.can_personal_outside], [false, false, false])
  assert.equal(b.max, 50)
  const m = await ok(manager.get('/api/reports/recipients'))
  assert.ok(m.team.some(u => u.email === A.operator + '@test.local'))
  assert.deepEqual([m.can_others, m.can_outside, m.can_personal_outside], [true, false, false])
  const o = await ok(owner.get('/api/reports/recipients'))
  assert.deepEqual([o.can_others, o.can_outside, o.can_personal_outside], [true, true, true])
  assert.ok(!o.team.some(u => u.email === B.owner + '@test.local'), 'never another group\'s people')
  await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.viewer}`
  try {
    assert.ok(!(await ok(owner.get('/api/reports/recipients'))).team.some(u => u.email === A.viewer + '@test.local'), 'nor anyone who has left')
  } finally {
    await sql`UPDATE users SET is_active = true WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.viewer}`
  }
  assert.equal((await floor.get('/api/reports/recipients')).status, 403)
  assert.equal((await viewer.get('/api/reports/recipients')).status, 403)
  // The operator role views reports by default: no recipients for them either.
  assert.equal((await operator.get('/api/reports/recipients')).status, 403)
})
