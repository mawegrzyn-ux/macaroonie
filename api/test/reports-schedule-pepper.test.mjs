// Pepper's schedule tools (src/ai/tools/reportSchedules.js, docs/REPORTS.md
// 14 and 16) on the staff connector and in the chat: which roles are offered
// them, who may schedule or email what to whom (the routes' own rules),
// refusals in words, cards that are the route's own dry run and pin the body
// it was worked out with, changes that make someone else's schedule the
// person's own, pausing and resuming, sends recorded as Pepper's, another
// group's schedules never found, and audits that hold counts and never an
// address. Email goes through a stand-in SendGrid: nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, getApp, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { sellTwoDays } = await import('./support/tillDays.mjs')
const { forgetReportResults } = await import('../src/reports/run.js')
const { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } = await import('../src/middleware/auth.js')
const { officeOrigin } = await import('../src/services/platformHost.js')
const { maskAddresses } = await import('../src/ai/tools/reportSchedules.js')

const STARTER = 'starter:till_sales_by_day'
const LIST_STARTER = 'starter:till_trading_days'
const BUILDER = 'a-sched-builder'
const MANAGER = 'a-sched-manager'
const FLOOR = 'a-sched-floor'
const NONE = 'a-sched-none'
const LEAVER = 'a-sched-leaver'
const OUTSIDE = 'accountant@outside.example'
const WEEKLY = { every: 'week', days: ['monday'], time: '07:30' }
const SCHEDULE_TOOLS = ['schedule_report', 'change_schedule', 'pause_schedule', 'send_report']

const realFetch = globalThis.fetch
const mails = []

let ids, filled, V, venueB, venueName, userId, userIdB
let owner, ownerB, builder, leaver
const tokens = {}

const schedulesOf = id => '/api/reports/' + id + '/schedules'
const rowOf = async sid => (await sql`SELECT * FROM report_schedules WHERE id = ${sid}`)[0]
const toOf = m => m.body.personalizations[0].to.map(t => t.email)

// A schedule of the starter, saved through the route, as in the route tests.
const scheduleBody = (to, over = {}) => ({
  timing: { every: 'week', days: [1], time: '07:30' },
  params: { period: { relative: 'today' }, venues: [V] },
  delivery: { in_message: true, attach: 'csv' },
  condition: { when: 'always' },
  recipients: to,
  ...over,
})
const me = sub => [{ user_id: userId[sub] }]

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
// Runs from earlier tests mustn't count towards Pepper's limit in the next one.
const ageRuns = () => sql`UPDATE report_runs SET created_at = created_at - interval '5 minutes' WHERE tenant_id = ${ids.a}`
const schedulesNow = async () => (await sql`SELECT count(*)::int AS n FROM report_schedules WHERE tenant_id = ${ids.a}`)[0].n
// The latest audit row of a tool.
const lastAudit = async tool => (await sql`
  SELECT ok, input, result FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = ${tool}
   ORDER BY created_at DESC, id DESC LIMIT 1`)[0]
const noAddress = (a, what) => assert.ok(!JSON.stringify([a.input, a.result]).includes('@'), what + ' audit holds no address: ' + JSON.stringify(a))

const text = s => [{ type: 'text', text: s }]
/** One chat turn in which the model calls a tool: its card (null when none was made). */
async function chatCard(who, tool, input) {
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_s1', name: tool, input }] }),
    () => ({ stop_reason: 'end_turn', content: text('Press the button on the card.') }),
  )
  const r = await ok(who.post('/api/ai/chat', { message: 'Please do it' }))
  const [card] = await sql`SELECT id, input, card FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id} AND tool = ${tool}`
  return card || null
}
const confirm = async (who, card) => {
  await ok(who.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const [action] = await sql`SELECT status, result FROM ai_pending_actions WHERE id = ${card.id}`
  assert.equal(action.status, 'done', JSON.stringify(action).slice(0, 300))
  return action.result
}
// The tool result the model was given last: { isError, text }.
function lastToolResult() {
  const msgs = claude.requests[claude.requests.length - 1].body.messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const blocks = Array.isArray(msgs[i].content) ? msgs[i].content : []
    const r = blocks.filter(b => b.type === 'tool_result').pop()
    if (r) return { isError: !!r.is_error, text: Array.isArray(r.content) ? r.content.map(c => c.text || '').join('') : String(r.content || '') }
  }
  return null
}

test.before(async () => {
  ids = await resetAndSeed()
  filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  const filledB = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc', reports: false })
  assert.deepEqual(filledB.failed, [], 'fixtures B: ' + JSON.stringify(filledB.failed).slice(0, 600))
  venueB = filledB.ids.venue
  V = filled.ids.venue
  owner = as(A.owner, ids.a)
  ownerB = as(B.owner, ids.b)
  await sellTwoDays({ owner, tenantId: ids.a, filled })
  ;[{ name: venueName }] = await sql`SELECT name FROM venues WHERE id = ${V}`

  // Someone who builds reports, someone who manages them without being an
  // owner or an admin, someone who only looks, and someone with no reports.
  // Each may use Pepper (connector tokens need it).
  const roles = {}
  for (const [key, label, permissions] of [
    ['psched_builder', 'Report builder', { reports: 'use', pos_reports: 'view', bookings: 'view', ai_assistant: 'view' }],
    ['psched_manager', 'Report manager', { reports: 'manage', pos_reports: 'view', bookings: 'view', ai_assistant: 'view' }],
    ['psched_floor', 'Floor', { reports: 'view', pos_reports: 'view', ai_assistant: 'view' }],
    ['psched_none', 'No reports', { bookings: 'view', ai_assistant: 'view' }],
  ]) roles[key] = await ok(owner.post('/api/access/roles', { key, label, permissions }), key)
  for (const [sub, role, name] of [
    [BUILDER, 'psched_builder', 'Bella Builder'], [MANAGER, 'psched_manager', 'Max Manager'],
    [FLOOR, 'psched_floor', 'Fran Floor'], [NONE, 'psched_none', 'Nina None'], [LEAVER, 'psched_builder', 'Lee Leaver'],
  ]) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id, full_name)
              VALUES (${ids.a}, ${sub + '@test.local'}, 'operator', ${sub}, ${roles[role].id}, ${name})`
  }
  builder = as(BUILDER, ids.a)
  leaver = as(LEAVER, ids.a)
  userId = Object.fromEntries((await sql`SELECT auth0_user_id, id::text AS id FROM users WHERE tenant_id = ${ids.a}`).map(u => [u.auth0_user_id, u.id]))
  ;[{ id: userIdB }] = await sql`SELECT id::text AS id FROM users WHERE tenant_id = ${ids.b} AND auth0_user_id = ${B.owner}`

  tokens.owner = (await ok(owner.post('/api/ai/tokens', { name: 'Schedules' }))).token
  tokens.read = (await ok(owner.post('/api/ai/tokens', { name: 'Schedules, read only', read_only: true }))).token
  for (const [key, sub] of [['builder', BUILDER], ['manager', MANAGER], ['floor', FLOOR], ['none', NONE]]) {
    tokens[key] = (await ok(as(sub, ids.a).post('/api/ai/tokens', { name: 'Schedules' }), key + ' token')).token
  }

  // The venue sends email through SendGrid (a stand-in).
  await ok(owner.post(`/api/email-templates/settings/${V}`, {
    email_provider: 'sendgrid', provider_api_key: 'SG.schedule-pepper', from_name: 'Ware kitchen', from_email: 'hello@ware.example',
  }))
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      mails.push({ auth: opts.headers.Authorization, body: JSON.parse(opts.body) })
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + mails.length } })
    }
    return realFetch(url, opts)
  }
})
test.after(async () => { globalThis.fetch = realFetch; await claude.close(); await closeApp() })
test.beforeEach(async () => {
  mails.length = 0
  forgetReportResults()
  if (ids) {
    await ageRuns()
    await sql`DELETE FROM report_schedules WHERE tenant_id IN (${ids.a}, ${ids.b})`
  }
})

test('the connector offers the schedule tools by role: Use schedules and sends, View only pauses, a read-only token none', async () => {
  for (const key of ['owner', 'builder', 'manager']) {
    const tools = await listed(tokens[key])
    for (const n of SCHEDULE_TOOLS) assert.ok(tools.includes(n), n + ' for the ' + key)
  }
  const floorTools = await listed(tokens.floor)
  assert.deepEqual(SCHEDULE_TOOLS.filter(n => floorTools.includes(n)), ['pause_schedule'], 'View can pause its own, nothing more')
  const noneTools = await listed(tokens.none)
  assert.deepEqual(SCHEDULE_TOOLS.filter(n => noneTools.includes(n)), [], 'no reports, no schedule tools')
  const readTools = await listed(tokens.read)
  assert.deepEqual(SCHEDULE_TOOLS.filter(n => readTools.includes(n)), [], 'a read-only token changes nothing')
  await refused(tokens.read, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY }, /can only read/)
})

test('schedule_report on the connector: saved as the route keeps it, with the schedule in words and no address in the audit', async () => {
  const out = await done(tokens.builder, 'schedule_report', {
    report: 'Sales by day', to: ['me'], timing: WEEKLY, period: { relative: 'yesterday' }, venues: [venueName], attach: 'csv',
  })
  const s = out.scheduled
  assert.equal(s.report, 'Sales by day')
  assert.equal(s.starter, true)
  assert.equal(s.when, 'Every Monday at 07:30')
  assert.deepEqual(s.to, ['Bella Builder <' + BUILDER + '@test.local>'])
  assert.ok(s.next_send, 'when the first one goes')
  assert.equal(s.owner, undefined, 'the person\'s own: no owner named')
  assert.ok(s.choices.some(c => /: Yesterday$/.test(c)), 'the period: ' + JSON.stringify(s.choices))
  assert.ok(s.choices.some(c => c.endsWith(': ' + venueName)), 'the venue: ' + JSON.stringify(s.choices))
  assert.equal(s.sends, 'The report in the email and a CSV file attached')
  assert.equal(s.only_when, undefined, 'it sends every time')
  assert.equal(out.url, officeOrigin() + '/reports/schedules', 'a link to the Schedules page on the connector')

  const row = await rowOf(s.id)
  assert.equal(row.owner_sub, BUILDER)
  assert.equal(row.owner_email, BUILDER + '@test.local')
  assert.equal(row.starter_key, 'till_sales_by_day')
  assert.equal(row.report_id, null)
  assert.deepEqual(row.timing, { every: 'week', days: [1], time: '07:30' })
  assert.deepEqual(row.params, { period: { relative: 'yesterday' }, venues: [V] })
  assert.deepEqual(row.delivery, { in_message: true, attach: 'csv', keep_file: false })
  assert.deepEqual(row.condition, { when: 'always' })
  assert.deepEqual(row.recipients, [{ user_id: userId[BUILDER] }])
  assert.equal(row.enabled, true)

  const a = await lastAudit('schedule_report')
  assert.equal(a.ok, true)
  assert.deepEqual(a.input, { report: 'Sales by day', recipients: 1 })
  assert.deepEqual(a.result, { report: 'Sales by day', when: 'Every Monday at 07:30', recipients: 1 })
  noAddress(a, 'schedule_report')

  // Days by their names, weekdays, and a month by its day.
  const weekdays = await done(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: { every: 'week', days: ['weekdays'], time: '06:00' } })
  assert.deepEqual((await rowOf(weekdays.scheduled.id)).timing, { every: 'week', days: [1, 2, 3, 4, 5], time: '06:00' })
  const monthly = await done(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: { every: 'month', day_of_month: 'last' } })
  assert.deepEqual((await rowOf(monthly.scheduled.id)).timing, { every: 'month', on: { day: 'last' }, time: '08:00' }, '08:00 unless given')
})

test('schedule_report refuses in words: other people without Manage, fixed days, timings and files that make no sense, a list watching a figure', async () => {
  // Someone with Use sends to themselves only.
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['Max Manager'], timing: WEEKLY }, /Sending a report to other people needs Manage/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: [OUTSIDE], timing: WEEKLY }, /Sending a report to other people needs Manage/)
  // A schedule's period moves with the date.
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY, period: { from: '2026-11-01', to: '2026-11-07' } }, /Invalid input/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: { every: 'week' } }, /give the days it sends/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: { every: 'month' } }, /give day_of_month/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: { every: 'month', weekday: 'monday' } }, /week_of_month and weekday together/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY, keep_file: true }, /A file is kept only when one is attached/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['someone@'], timing: WEEKLY }, /isn't an email address/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY, figure: 'Net sales' }, /Say the line to compare Net sales with/)
  await refused(tokens.builder, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY, figure: 'Net sales', than: 'lots' }, /Invalid input/)
  await refused(tokens.builder, 'schedule_report', { report: 'Trading days', to: ['me'], timing: WEEKLY, when: 'figure' }, /Only a summary report with figures/)
  // Manage reaches the team, not outside it: that needs an owner or an admin.
  await refused(tokens.manager, 'schedule_report', { report: 'Sales by day', to: [OUTSIDE], timing: WEEKLY }, /Only an owner or an admin can send reports to addresses outside the team/)
  const a = await lastAudit('schedule_report')
  assert.equal(a.ok, false)
  assert.match(a.result.error, /Only an owner or an admin/)
  noAddress(a, 'A refused schedule_report')
  // View and no reports at all.
  await refused(tokens.floor, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY }, /build, save, change, delete, schedule or email reports/)
  await refused(tokens.none, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY })
  assert.equal(await schedulesNow(), 0, 'nothing was saved by any of these')
})

test('schedule_report: Manage watches a figure and reaches the team; an owner reaches outside it', async () => {
  const watched = await done(tokens.manager, 'schedule_report', {
    report: 'Sales by day', to: ['me'], timing: WEEKLY, figure: 'Net sales', than: 500,
  })
  assert.deepEqual((await rowOf(watched.scheduled.id)).condition, { when: 'figure', value: 'net_sales', op: 'over', than: 500, scope: 'any' })
  assert.match(watched.scheduled.only_when, /Net sales/, 'it says when it sends')

  const team = await done(tokens.manager, 'schedule_report', { report: 'Sales by day', to: ['Bella Builder'], timing: WEEKLY })
  assert.deepEqual((await rowOf(team.scheduled.id)).recipients, [{ user_id: userId[BUILDER] }])
  assert.deepEqual(team.scheduled.to, ['Bella Builder <' + BUILDER + '@test.local>'])

  const outside = await done(tokens.owner, 'schedule_report', { report: 'Sales by day', to: [OUTSIDE.toUpperCase()], timing: WEEKLY })
  assert.deepEqual((await rowOf(outside.scheduled.id)).recipients, [{ email: OUTSIDE }])
  assert.deepEqual(outside.scheduled.to, [OUTSIDE + ' (outside the team)'])
  noAddress(await lastAudit('schedule_report'), 'An owner\'s schedule_report')
})

test('in the chat, schedule_report\'s card is the route\'s dry run, pins its body, and Confirm saves exactly that', async () => {
  const card = await chatCard(owner, 'schedule_report', { report: 'Sales by day', to: ['me'], timing: WEEKLY, attach: 'xlsx' })
  assert.ok(card, 'a card, not a schedule')
  assert.equal(card.card.title, 'Email "Sales by day" on a schedule?')
  assert.ok(card.card.lines[0].startsWith('When: Every Monday at 07:30. The first goes '), card.card.lines[0])
  assert.ok(card.card.lines.includes('Sends: The report in the email and an Excel file attached'), card.card.lines.join('\n'))
  assert.ok(card.card.lines.includes('To: ' + A.owner + '@test.local'), card.card.lines.join('\n'))
  assert.equal(card.card.lines.at(-1), 'It sends as you: each time, the people it goes to get what your role can see then.')
  assert.equal(card.card.confirmLabel, 'Schedule it')
  assert.equal(card.input.report, STARTER, 'the report it showed is pinned')
  assert.deepEqual(card.input.body.recipients, [{ user_id: userId[A.owner] }], 'and the body it was worked out with')
  assert.equal(await schedulesNow(), 0, 'nothing saved before Confirm')

  const result = await confirm(owner, card)
  const [row] = await sql`SELECT * FROM report_schedules WHERE tenant_id = ${ids.a}`
  assert.ok(row, 'saved on Confirm')
  assert.equal(row.owner_sub, A.owner)
  assert.deepEqual(row.timing, card.input.body.timing)
  assert.deepEqual(row.delivery, { in_message: true, attach: 'xlsx', keep_file: false })
  assert.equal(result.link, '[Schedules](/reports/schedules)', 'a link inside the app in the chat')
  assert.equal(result.scheduled.id, row.id)
})

test('change_schedule: by name or id, only what changes, a manager\'s change makes it theirs, and nothing to change is said', async () => {
  // Someone with Use changes their own, found by its report's name.
  const s1 = (await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))).schedule
  const changed = await done(tokens.builder, 'change_schedule', { schedule: 'Sales by day', time: '09:15' })
  assert.equal(changed.changed.when, 'Every Monday at 09:15')
  assert.deepEqual((await rowOf(s1.id)).timing, { every: 'week', days: [1], time: '09:15' })
  const a = await lastAudit('change_schedule')
  assert.deepEqual(a.input, { report: 'Sales by day', changed: ['timing'] })
  assert.equal(a.result.changed, 'when')
  noAddress(a, 'change_schedule')

  // A manager changing it in the chat: the card says before and after, and that it becomes theirs.
  const card = await chatCard(as(MANAGER, ids.a), 'change_schedule', { schedule: s1.id, time: '10:00' })
  assert.ok(card, 'a card')
  assert.equal(card.card.title, 'Change the schedule of "Sales by day"?')
  assert.ok(card.card.lines.includes('When: Every Monday at 10:00 (was every Monday at 09:15)'), card.card.lines.join('\n'))
  assert.ok(card.card.lines.some(l => l.startsWith('Next send: ')), card.card.lines.join('\n'))
  assert.ok(card.card.lines.includes('It is ' + BUILDER + '@test.local\'s: changing it makes it yours, and it will send what your role can see.'), card.card.lines.join('\n'))
  assert.equal(card.input.schedule, s1.id, 'the schedule it showed is pinned')
  assert.equal((await rowOf(s1.id)).owner_sub, BUILDER, 'nothing changed before Confirm')
  await confirm(as(MANAGER, ids.a), card)
  const after = await rowOf(s1.id)
  assert.equal(after.owner_sub, MANAGER, 'now the manager\'s')
  assert.equal(after.timing.time, '10:00')

  // Who it goes to: add, take off, and never nobody.
  const own = (await ok(owner.post(schedulesOf(STARTER), scheduleBody(me(A.owner))))).schedule
  const added = await done(tokens.owner, 'change_schedule', { schedule: own.id, add_to: ['Bella Builder'] })
  assert.equal(added.changed.to.length, 2)
  assert.deepEqual((await rowOf(own.id)).recipients, [{ user_id: userId[A.owner] }, { user_id: userId[BUILDER] }])
  const taken = await done(tokens.owner, 'change_schedule', { schedule: own.id, remove_from: ['me'] })
  assert.deepEqual(taken.changed.to, ['Bella Builder <' + BUILDER + '@test.local>'])
  await refused(tokens.owner, 'change_schedule', { schedule: own.id, remove_from: ['Bella Builder'] }, /leaves nobody to send it to/)
  await refused(tokens.owner, 'change_schedule', { schedule: own.id, remove_from: ['me'] }, /doesn't go to you/)
  await refused(tokens.owner, 'change_schedule', { schedule: own.id }, /Say what to change/)
  assert.deepEqual((await rowOf(own.id)).recipients, [{ user_id: userId[BUILDER] }], 'the refusals changed nothing')

  // Someone with Use can't change another person's: it isn't found for them.
  await refused(tokens.builder, 'change_schedule', { schedule: own.id, time: '06:00' }, /Schedule not found/)

  // A change that changes nothing is said on the card, and no card is made.
  const s2 = (await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))).schedule
  const none = await chatCard(builder, 'change_schedule', { schedule: s2.id, time: '07:30' })
  assert.equal(none, null, 'no card for nothing')
  const told = lastToolResult()
  assert.equal(told.isError, true)
  assert.match(told.text, /changes nothing/)
})

test('pause_schedule: pause and resume, said when already so; a manager pauses someone else\'s; View finds none of its own', async () => {
  const own = (await ok(owner.post(schedulesOf(STARTER), scheduleBody(me(A.owner))))).schedule
  const paused = await done(tokens.owner, 'pause_schedule', { schedule: own.id })
  assert.equal(paused.paused.paused, 'Paused by ' + A.owner + '@test.local')
  assert.equal((await rowOf(own.id)).enabled, false)
  await refused(tokens.owner, 'pause_schedule', { schedule: own.id }, /already paused/)
  const resumed = await done(tokens.owner, 'pause_schedule', { schedule: own.id, resume: true })
  assert.ok(resumed.resumed.next_send, 'resumed with its next send')
  assert.equal((await rowOf(own.id)).enabled, true)
  await refused(tokens.owner, 'pause_schedule', { schedule: own.id, resume: true }, /isn't paused/)
  const a = await lastAudit('pause_schedule')
  assert.deepEqual(a.input, { report: 'Sales by day', resume: true })
  noAddress(a, 'pause_schedule')

  // Someone who only views has none of their own, and can't reach anyone else's.
  await refused(tokens.floor, 'pause_schedule', { schedule: 'Sales by day' }, /You have no schedules yet/)
  await refused(tokens.floor, 'pause_schedule', { schedule: own.id }, /Schedule not found/)

  // Manage pauses anyone's.
  const theirs = (await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))).schedule
  await done(tokens.manager, 'pause_schedule', { schedule: theirs.id })
  const row = await rowOf(theirs.id)
  assert.equal(row.enabled, false)
  assert.equal(row.paused_reason, 'Paused by ' + MANAGER + '@test.local')
  assert.equal(row.owner_sub, BUILDER, 'pausing doesn\'t take it over')
})

test('send_report emails a report now: sent as Pepper, linked to Past runs, counted in the audit without addresses', async () => {
  const runs = await pepperRuns(A.owner)
  const out = await done(tokens.owner, 'send_report', { report: 'Sales by day', to: ['me', OUTSIDE], venues: [venueName] })
  assert.equal(out.report, 'Sales by day')
  assert.equal(out.result, 'Sent')
  assert.equal(out.sent_to, '2 of 2')
  assert.equal(out.url, officeOrigin() + '/reports/runs?report=starter%3Atill_sales_by_day')
  const to = mails.flatMap(toOf)
  assert.ok(to.includes(A.owner + '@test.local'), JSON.stringify(to))
  assert.ok(to.includes(OUTSIDE), JSON.stringify(to))
  assert.equal(await pepperRuns(A.owner), runs + 1, 'recorded as Pepper\'s')
  const a = await lastAudit('send_report')
  assert.equal(a.ok, true)
  assert.deepEqual(a.input, { report: 'Sales by day', recipients: 2 })
  assert.equal(a.result.status, 'sent')
  assert.equal(a.result.sent, 2)
  noAddress(a, 'send_report')

  // Refusals.
  await refused(tokens.owner, 'send_report', { report: 'Sales by day', schedule: 'Sales by day', to: ['me'] }, /Give either report/)
  await refused(tokens.owner, 'send_report', {}, /Give either report/)
  await refused(tokens.owner, 'send_report', { report: 'Sales by day' }, /Say who to email it to/)
  await refused(tokens.builder, 'send_report', { report: 'Sales by day', to: [OUTSIDE] }, /Sending a report to other people needs Manage/)
  await refused(tokens.floor, 'send_report', { report: 'Sales by day', to: ['me'] }, /build, save, change, delete, schedule or email reports/)
})

test('in the chat, send_report\'s card sends nothing; Confirm sends once, recorded as Pepper\'s', async () => {
  const runs = await pepperRuns(A.owner)
  const card = await chatCard(owner, 'send_report', { report: 'Sales by day', to: ['me'] })
  assert.ok(card, 'a card')
  assert.equal(card.card.title, 'Email "Sales by day" now?')
  assert.ok(card.card.lines.includes('To: ' + A.owner + '@test.local'), card.card.lines.join('\n'))
  assert.equal(card.card.lines.at(-1), 'It runs as you: the people it goes to get what your role can see.')
  assert.equal(card.card.confirmLabel, 'Send it')
  assert.equal(mails.length, 0, 'the dry run sent nothing')
  assert.equal(await pepperRuns(A.owner), runs, 'and isn\'t a run')

  const result = await confirm(owner, card)
  assert.equal(result.result, 'Sent')
  assert.equal(result.link, '[Past runs](/reports/runs?report=starter%3Atill_sales_by_day)')
  assert.deepEqual(mails.flatMap(toOf), [A.owner + '@test.local'])
  assert.equal(await pepperRuns(A.owner), runs + 1)
})

test('send_report sends a schedule now whatever its condition; a refusal naming its owner is masked in the audit', async () => {
  const s = (await ok(owner.post(schedulesOf(STARTER), scheduleBody(me(A.owner), {
    condition: { when: 'figure', value: 'net_sales', op: 'over', than: 1000000, scope: 'total' },
  })))).schedule
  const out = await done(tokens.owner, 'send_report', { schedule: s.id })
  assert.equal(out.result, 'Sent', 'whatever its condition')
  assert.equal(out.url, officeOrigin() + '/reports/runs?schedule=' + s.id)
  assert.deepEqual(mails.flatMap(toOf), [A.owner + '@test.local'])
  assert.equal((await rowOf(s.id)).last_status, 'sent')

  // Someone with Use can't send another person's.
  await refused(tokens.builder, 'send_report', { schedule: s.id }, /Schedule not found/)

  // A schedule whose owner has left: the refusal names them; the audit keeps it masked.
  const gone = (await ok(leaver.post(schedulesOf(STARTER), scheduleBody(me(LEAVER))))).schedule
  await sql`UPDATE users SET is_active = false WHERE tenant_id = ${ids.a} AND auth0_user_id = ${LEAVER}`
  try {
    const said = await refused(tokens.manager, 'send_report', { schedule: gone.id }, /is no longer on the team/)
    assert.ok(said.includes(LEAVER + '@test.local'), 'the person asking is told who: ' + said)
    const a = await lastAudit('send_report')
    assert.equal(a.ok, false)
    assert.match(a.result.error, /\[address\] is no longer on the team/)
    noAddress(a, 'A refused send_report')
  } finally {
    await sql`UPDATE users SET is_active = true WHERE tenant_id = ${ids.a} AND auth0_user_id = ${LEAVER}`
  }
})

test('another group\'s schedules are never found, by name or id', async () => {
  const theirs = (await ok(ownerB.post(schedulesOf(STARTER), scheduleBody([{ user_id: userIdB }], {
    params: { period: { relative: 'today' }, venues: [venueB] },
  })))).schedule
  await refused(tokens.owner, 'change_schedule', { schedule: theirs.id, time: '06:00' }, /Schedule not found/)
  await refused(tokens.owner, 'pause_schedule', { schedule: theirs.id }, /Schedule not found/)
  await refused(tokens.owner, 'send_report', { schedule: theirs.id }, /Schedule not found/)
  await refused(tokens.owner, 'pause_schedule', { schedule: 'Sales by day' }, /There are no schedules yet/)
  const row = await rowOf(theirs.id)
  assert.equal(row.enabled, true)
  assert.deepEqual(row.timing, { every: 'week', days: [1], time: '07:30' })
  assert.equal(mails.length, 0)
})

test('get_report and report_runs say what is scheduled, everyone\'s with Manage', async () => {
  await ok(builder.post(schedulesOf(STARTER), scheduleBody(me(BUILDER))))
  const seen = await done(tokens.manager, 'get_report', { report: 'Sales by day' })
  assert.ok(Array.isArray(seen.schedules), JSON.stringify(seen.schedules))
  assert.equal(seen.schedules[0].owner, BUILDER + '@test.local', 'whose it is, for Manage')
  assert.equal(seen.schedules[0].when, 'Every Monday at 07:30')

  assert.equal((await done(tokens.owner, 'get_report', { report: 'Trading days' })).schedules, 'None: schedule_report emails it on a schedule')
  assert.equal((await done(tokens.floor, 'get_report', { report: 'Trading days' })).schedules, 'None')

  const mine = await done(tokens.builder, 'report_runs', {})
  assert.ok(Array.isArray(mine.scheduled), JSON.stringify(mine.scheduled))
  assert.equal(mine.scheduled[0].report, 'Sales by day')
  assert.equal(mine.scheduled[0].owner, undefined, 'the person\'s own')
  assert.equal(mine.schedules_page, officeOrigin() + '/reports/schedules')
  assert.equal((await done(tokens.floor, 'report_runs', {})).scheduled, 'Nothing scheduled')
})

test('maskAddresses keeps the words and hides every address', () => {
  assert.equal(maskAddresses('x a-owner@test.local can\'t send it, to <bob@x.example>.'), 'x [address] can\'t send it, to <[address]>.')
  assert.equal(maskAddresses('"accountant@outside.example" (outside the team); and lee@test.local'), '"[address]" (outside the team); and [address]')
  assert.equal(maskAddresses(''), '')
  assert.equal(maskAddresses(undefined), '')
})
