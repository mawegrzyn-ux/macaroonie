// The report builder's subjects phase 3d added for Pepper and the group
// (docs/REPORTS.md 20) against the app's own pages for the same rows:
//
//   Pepper's use by month    the Pepper page's Settings tab (GET /api/ai/settings: usage)
//   Pepper's use by person   the same tab's people (GET /api/ai/settings: people)
//   Pepper's changes         the Activity tab (GET /api/ai/activity)
//   Pepper chats             each person's chats (GET /api/ai/conversations)
//   new locations            New location (GET /api/ai/store-openings, /:id)
//   issues                   the Issue log (GET /api/issues)
//   feature requests         Feature requests (GET /api/feature-requests)
//   team, roles              Team and Access (GET /api/team, /api/access/roles)
//
// Usage, changes and chats come from Pepper's model calls, and a new
// location's progress from its answers: they are written here by SQL.
// Tenant B's rows sit beside them and must never show, and what was said to
// Pepper (a change's input and answer, a chat's title and prompt) never
// reaches a report.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B, PLATFORM } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { runner, rowsOf, measures, refused, LEVELS } from './support/reports.mjs'
import { usageMonth, usageDay } from '../src/ai/context.js'
import { audienceTools } from '../src/ai/tools/index.js'
import { runsFor } from '../src/reports/access.js'
import { ACTION_LABELS } from '../../shared/pepperActions.js'

const ALL = LEVELS
const SECRET = 'Zqx-secret'

let ids, owner, V, V2, TZ, run, venues

const go = (spec, levels = ALL) => run(spec, undefined, { levels })
const sorted = list => [...list].map(String).sort()
const count = (list, f) => list.filter(f).length
const distinct = list => new Set(list).size
/** Words as a list shows them: an empty string reads as nothing. */
const words = v => (v == null || v === '' ? null : v)
/** A list result's rows as objects by column key, with the row's id. */
const listRows = res => res.rows.filter(r => r.kind === 'row').map(r => ({
  ...Object.fromEntries(res.columns.map((c, i) => [c.key, r.cells[i]])),
  _id: String(r.id),
}))
const rowOf = (list, id) => list.find(r => r._id === String(id))
/** A summary's figures with no rows. */
const figures = async (subject, list, filters = [], levels = ALL) => rowsOf(await go({ subject, values: measures(list), filters }, levels))[0]
const near = (a, b, what, within = 1e-6) => assert.ok(Math.abs(Number(a) - Number(b)) < within, `${what}: ${a} against ${b}`)
const venueName = id => (id ? venues.find(v => v.id === id)?.name ?? null : null)
const email = sub => sub + '@test.local'
/** Noon at the venues, n days ago: a day that can't slip across midnight. */
const noon = async n => (await sql`
  SELECT ((((now() AT TIME ZONE ${TZ})::date - ${n}::int) + time '12:00') AT TIME ZONE ${TZ}) AS t`)[0].t

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  run = runner(ids.a)
  venues = await ok(owner.get('/api/venues'), 'venues')
  const zones = distinct(venues.map(v => v.timezone))
  assert.equal(zones, 1, 'one time zone, so the report\'s days are the venues\' days')
  TZ = venues[0].timezone
})
after(closeApp)

test('Pepper\'s use by month and by person: the Pepper page\'s Settings tab', async () => {
  const month = usageMonth()
  const today = usageDay()
  const before = new Date(month + 'T00:00:00Z')
  before.setUTCMonth(before.getUTCMonth() - 1)
  const lastMonth = before.toISOString().slice(0, 10)
  const use = (tid, m, channel, n) => sql`
    INSERT INTO ai_usage (tenant_id, month, channel, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, units, web_searches)
    VALUES (${tid}, ${m}, ${channel}, ${n}, ${n * 1000}, ${n * 200}, ${n * 3000}, ${n * 400}, ${n * 5000}, ${n % 3})
    ON CONFLICT (tenant_id, month, channel) DO UPDATE SET
      requests = EXCLUDED.requests, input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
      cache_read_tokens = EXCLUDED.cache_read_tokens, cache_write_tokens = EXCLUDED.cache_write_tokens,
      units = EXCLUDED.units, web_searches = EXCLUDED.web_searches`
  await use(ids.a, month, 'staff_chat', 12)
  await use(ids.a, month, 'staff_mcp', 5)
  await use(ids.a, month, 'guest_chat', 7)
  await use(ids.a, lastMonth, 'staff_chat', 30)
  await use(ids.b, month, 'staff_chat', 99)
  const person = (tid, day, sub, mail, requests, units) => sql`
    INSERT INTO ai_usage_people (tenant_id, day, user_sub, user_email, requests, units)
    VALUES (${tid}, ${day}, ${sub}, ${mail}, ${requests}, ${units})
    ON CONFLICT (tenant_id, day, user_sub) DO UPDATE SET
      requests = ai_usage_people.requests + EXCLUDED.requests, units = ai_usage_people.units + EXCLUDED.units`
  await person(ids.a, month, A.owner, email(A.owner), 4, 40000)
  await person(ids.a, today, A.owner, email(A.owner), 2, 15000)
  await person(ids.a, today, A.admin, email(A.admin), 3, 21000)
  await person(ids.a, month, 'gone-sub', 'gone@test.local', 1, 5000) // no longer on the team
  await person(ids.a, lastMonth, A.operator, email(A.operator), 9, 90000)
  await person(ids.b, today, B.owner, email(B.owner), 50, 500000)

  const settings = await ok(owner.get('/api/ai/settings'), 'Pepper settings')
  const USAGE = ['requests', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'units', 'web_searches']
  const thisMonth = [{ field: 'month', op: 'is', value: month }]
  const list = listRows(await go({ subject: 'pepper.usage', kind: 'list', rows: ['channel', ...USAGE], filters: thisMonth }))
  assert.deepEqual(sorted(list.map(r => r.channel)), sorted(Object.keys(settings.usage.channels)), 'where it was used this month')
  for (const r of list) for (const k of USAGE) assert.equal(Number(r[k]), settings.usage.channels[r.channel][k], r.channel + ': ' + k)
  const chat = await figures('pepper.usage', ['total_units'], [...thisMonth, { field: 'channel', op: 'in', value: ['staff_chat', 'guest_chat'] }])
  assert.equal(Number(chat.total_units), settings.usage.chat_units, 'the chat units the allowance counts')
  const month1 = await figures('pepper.usage', ['total_searches'], thisMonth)
  assert.equal(Number(month1.total_searches), settings.usage.web_searches, 'web searches this month')
  const [own] = await sql`SELECT sum(requests)::int AS r, count(DISTINCT month)::int AS m FROM ai_usage WHERE tenant_id = ${ids.a}`
  const every = await figures('pepper.usage', ['total_requests', 'months'])
  assert.equal(Number(every.total_requests), own.r, 'every month, the group\'s own only')
  assert.equal(Number(every.months), own.m)
  assert.ok(own.m >= 2)

  // By person this month: everyone, as a manager sees them on the tab.
  const want = settings.people
  const days = [{ field: 'date', op: 'in_period', value: { from: month, to: today } }]
  const people = rowsOf(await go({ subject: 'pepper.people', rows: ['email', 'person.name'], values: measures(['total_requests', 'total_units']), filters: days }))
  assert.deepEqual(sorted(people.map(r => r.email)), sorted(want.map(w => w.email)), 'people this month')
  for (const r of people) {
    const w = want.find(x => x.email === r.email)
    assert.equal(Number(r.total_requests), w.requests, r.email + ': requests')
    assert.equal(Number(r.total_units), w.units, r.email + ': units')
    assert.equal(words(r['person.name']), w.user_sub === 'gone-sub' ? null : w.name, r.email + ': on the team')
  }
  const todays = rowsOf(await go({ subject: 'pepper.people', rows: ['email'], values: measures(['total_units']), filters: [{ field: 'date', op: 'is', value: today }] }))
  assert.deepEqual(
    Object.fromEntries(todays.map(r => [r.email, Number(r.total_units)])),
    Object.fromEntries(want.filter(w => w.today > 0).map(w => [w.email, w.today])), 'today\'s units, which the daily share counts')
  const [d] = await sql`SELECT count(DISTINCT day)::int AS n FROM ai_usage_people WHERE tenant_id = ${ids.a} AND day BETWEEN ${month} AND ${today}`
  const pf = await figures('pepper.people', ['people', 'days'], days)
  assert.equal(Number(pf.people), want.length)
  assert.equal(Number(pf.days), d.n)

  // Someone with View sees only their own use on the tab: everyone's is Manage.
  const op = await ok(as(A.operator, ids.a).get('/api/ai/settings'), 'operator settings')
  assert.ok(op.people.every(x => x.user_sub === A.operator), 'the tab shows the operator only their own')
  const view = { ...ALL, ai_assistant: 'view' }
  assert.equal((await refused(go({ subject: 'pepper.people', rows: ['email'], values: measures(['total_units']) }, view))).status, 403)
  assert.equal(rowsOf(await go({ subject: 'pepper.usage', values: measures(['total_units']), filters: thisMonth }, view)).length, 1,
    'the month\'s use is open to View, as the tab\'s own figures are')
})

test('Pepper\'s changes: the Activity tab, without what was asked or answered', async () => {
  const [booking] = await sql`SELECT id FROM bookings WHERE tenant_id = ${ids.a} ORDER BY created_at LIMIT 1`
  assert.ok(booking, 'a booking to point at')
  const act = (tid, o) => sql`
    INSERT INTO ai_actions (tenant_id, channel, actor, tool, input, ok, result, booking_id, redacted_at)
    VALUES (${tid}, ${o.channel}, ${o.actor}, ${o.tool}, ${sql.json({ note: SECRET })}, ${o.ok}, ${sql.json({ said: SECRET })},
            ${o.booking || null}, ${o.cleared ? new Date() : null})`
  await act(ids.a, { channel: 'staff_chat', actor: email(A.owner), tool: 'create_booking', ok: true, booking: booking.id })
  await act(ids.a, { channel: 'staff_mcp', actor: email(A.admin), tool: 'log_temperature', ok: false })
  await act(ids.a, { channel: 'guest_chat', actor: 'guest', tool: 'confirm_booking', ok: true })
  await act(ids.a, { channel: 'staff_chat', actor: email(A.owner), tool: 'retired_tool', ok: true, cleared: true })
  await act(ids.b, { channel: 'staff_chat', actor: email(B.owner), tool: 'create_booking', ok: true })
  await act(null, { channel: 'guest_mcp', actor: 'guest', tool: 'request_booking_code', ok: true })

  const activity = await ok(owner.get('/api/ai/activity'), 'activity')
  assert.ok(activity.length >= 4)
  const res = await go({ subject: 'pepper.actions', kind: 'list', rows: ['what', 'channel', 'who', 'went_through', 'cleared', 'booking.guest_name'] })
  const list = listRows(res)
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(activity.map(a => a.id)), 'the same changes, the group\'s own only')
  for (const a of activity) {
    const r = rowOf(list, a.id)
    assert.equal(r.what, a.tool)
    assert.equal(r.channel, a.channel)
    assert.equal(r.who, a.actor === 'guest' ? 'A guest' : a.actor)
    assert.equal(r.went_through, a.ok)
    assert.equal(words(r['booking.guest_name']), words(a.guest_name), a.tool + ': the booking')
  }
  const cleared = await sql`SELECT id FROM ai_actions WHERE tenant_id = ${ids.a} AND redacted_at IS NOT NULL`
  assert.deepEqual(sorted(list.filter(r => r.cleared).map(r => r._id)), sorted(cleared.map(c => c.id)))
  assert.ok(!JSON.stringify(res).includes(SECRET), 'what was asked and answered never shows')

  const f = await figures('pepper.actions', ['changes', 'done', 'failed', 'people', 'done_rate'])
  assert.equal(Number(f.changes), activity.length)
  assert.equal(Number(f.done), count(activity, a => a.ok))
  assert.equal(Number(f.failed), count(activity, a => !a.ok))
  assert.equal(Number(f.people), distinct(activity.filter(a => a.actor && a.actor !== 'guest').map(a => a.actor)))
  near(f.done_rate, count(activity, a => a.ok) / activity.length, 'went through')

  // What was asked isn't a field, and the Activity tab is Manage.
  await refused(go({ subject: 'pepper.actions', kind: 'list', rows: ['input'] }))
  assert.equal((await as(A.operator, ids.a).get('/api/ai/activity')).status, 403)
  assert.equal((await refused(go({ subject: 'pepper.actions', values: measures(['changes']) }, { ...ALL, ai_assistant: 'view' }))).status, 403)
})

test('Pepper chats: each person\'s own chats, the website chat, and what was said never shown', async () => {
  const [before] = await sql`SELECT count(*)::int AS n FROM ai_conversations WHERE tenant_id = ${ids.a}`
  const chat = (tid, o) => sql`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, guest_key, venue_id, title, system_prompt, model_tier, closed_at, closed_reason)
    VALUES (${tid}, ${o.channel || 'staff_chat'}, ${o.sub || null}, ${o.mail || null}, ${o.key || null}, ${o.venue || null},
            ${SECRET + ' title'}, ${SECRET + ' prompt'}, ${o.tier || null}, ${o.closed ? new Date() : null}, ${o.closed ? 'erased' : null})
    RETURNING id`
  const [c1] = await chat(ids.a, { sub: A.owner, mail: email(A.owner), tier: 'fast' })
  const [c2] = await chat(ids.a, { sub: A.owner, mail: email(A.owner), tier: 'main', closed: true })
  const [c3] = await chat(ids.a, { sub: A.admin, mail: email(A.admin) })
  const [g] = await chat(ids.a, { channel: 'guest_chat', key: SECRET + '-key', venue: V, tier: 'fast' })
  await chat(ids.b, { sub: B.owner, mail: email(B.owner) })
  await sql`
    INSERT INTO ai_actions (tenant_id, channel, actor, tool, ok, conversation_id) VALUES
      (${ids.a}, 'staff_chat', ${email(A.owner)}, 'add_booking_note', true, ${c1.id}),
      (${ids.a}, 'staff_chat', ${email(A.owner)}, 'tick_checklist', false, ${c1.id})`

  for (const who of [A.owner, A.admin]) {
    const mine = await ok(as(who, ids.a).get('/api/ai/conversations'), who + '\'s chats')
    const list = listRows(await go({ subject: 'pepper.chats', kind: 'list', rows: ['who', 'closed'], filters: [{ field: 'who', op: 'is', value: email(who) }] }))
    assert.deepEqual(sorted(list.map(r => r._id)), sorted(mine.map(c => c.id)), who + ': the same chats')
    for (const c of mine) assert.equal(rowOf(list, c.id).closed, c.closed, who + ': closed')
  }

  const res = await go({ subject: 'pepper.chats', kind: 'list', rows: ['channel', 'who', 'model', 'closed', 'closed_why', 'location.name'] })
  const list = listRows(res)
  assert.equal(list.length, before.n + 4, 'the group\'s own chats only')
  assert.equal(rowOf(list, g.id).who, 'A guest')
  assert.equal(rowOf(list, g.id).channel, 'guest_chat')
  assert.equal(rowOf(list, g.id)['location.name'], venueName(V))
  assert.equal(rowOf(list, c1.id).model, 'fast')
  assert.equal(rowOf(list, c3.id).model, 'main', 'a chat with no tier ran on the main model')
  assert.equal(rowOf(list, c2.id).closed_why, 'erased')
  assert.equal(words(rowOf(list, c1.id).closed_why), null)
  assert.ok(!JSON.stringify(res).includes(SECRET), 'a chat\'s title, prompt and key never show')

  const f = await figures('pepper.chats', ['chats', 'staff_chats', 'guest_chats', 'people', 'main_model', 'closed_count', 'changes.changes', 'changes.failed'])
  const [w] = await sql`
    SELECT count(*)::int AS chats,
           count(*) FILTER (WHERE channel = 'staff_chat')::int AS staff,
           count(*) FILTER (WHERE channel = 'guest_chat')::int AS guest,
           count(DISTINCT user_sub) FILTER (WHERE channel = 'staff_chat')::int AS people,
           count(*) FILTER (WHERE COALESCE(model_tier, 'main') = 'main')::int AS main,
           count(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed
      FROM ai_conversations WHERE tenant_id = ${ids.a}`
  assert.equal(Number(f.chats), w.chats)
  assert.equal(Number(f.staff_chats), w.staff)
  assert.equal(Number(f.guest_chats), w.guest)
  assert.equal(Number(f.people), w.people)
  assert.equal(Number(f.main_model), w.main)
  assert.equal(Number(f.closed_count), w.closed)
  assert.equal(Number(f['changes.changes']), 2, 'the changes made in the group\'s chats')
  assert.equal(Number(f['changes.failed']), 1)
  assert.equal((await refused(go({ subject: 'pepper.chats', values: measures(['chats']) }, { ...ALL, ai_assistant: 'view' }))).status, 403)
})

test('New locations: the store openings list, follow-ups left, and the venues module', async () => {
  const one = await ok(owner.post('/api/ai/store-openings/wizard', {}), 'opening')
  const two = await ok(owner.post('/api/ai/store-openings/wizard', {}), 'second opening')
  await ok(as(B.owner, ids.b).post('/api/ai/store-openings/wizard', {}), 'another group\'s opening')
  await sql`
    UPDATE store_openings
       SET title = 'Zqx Hertford', status = 'created', venue_id = ${V2}, rounds = 2,
           created_at = ${await noon(5)}, opened_at = ${await noon(2)}, opened_by = ${email(A.owner)},
           followups = ${sql.json([
             { key: 'printers', text: 'Check each printer', done: true },
             { key: 'website', text: 'Check the location page', done: false },
             { key: 'team', text: 'Add the team' },
           ])}
     WHERE id = ${one.id} AND tenant_id = ${ids.a}`
  await sql`UPDATE store_openings SET title = 'Zqx Ware', status = 'questions', rounds = 1 WHERE id = ${two.id} AND tenant_id = ${ids.a}`

  const openings = await ok(owner.get('/api/ai/store-openings'), 'openings')
  const list = listRows(await go({ subject: 'group.openings', kind: 'list',
    rows: ['name', 'status', 'made', 'started_by', 'made_by', 'location.name', 'rounds', 'followups', 'followups_left', 'days_to_make'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(openings.map(o => o.id)), 'the same openings, the group\'s own only')
  let left = 0
  for (const o of openings) {
    const r = rowOf(list, o.id)
    const full = await ok(owner.get('/api/ai/store-openings/' + o.id), 'opening ' + o.title)
    assert.equal(r.name, o.title)
    assert.equal(r.status, o.status)
    assert.equal(r.made, o.status === 'created')
    assert.equal(words(r.started_by), words(o.created_by_email))
    assert.equal(words(r['location.name']), words(o.venue_name))
    assert.equal(Number(r.rounds), full.rounds)
    assert.equal(Number(r.followups), full.followups.length, o.title + ': follow-ups')
    assert.equal(Number(r.followups_left), count(full.followups, x => !x.done), o.title + ': follow-ups left')
    left += count(full.followups, x => !x.done)
  }
  const made = rowOf(list, one.id)
  assert.equal(Number(made.days_to_make), 3)
  assert.equal(made.made_by, email(A.owner))
  assert.equal(made['location.name'], venueName(V2))
  assert.equal(rowOf(list, two.id).days_to_make, null)

  const f = await figures('group.openings', ['openings', 'made_count', 'in_progress', 'total_followups_left'])
  assert.equal(Number(f.openings), openings.length)
  assert.equal(Number(f.made_count), count(openings, o => o.status === 'created'))
  assert.equal(Number(f.in_progress), count(openings, o => o.status !== 'created'))
  assert.equal(Number(f.total_followups_left), left)
  assert.equal(left, 2)

  // Venues View, as the page: a viewer sees the list and can report on it.
  assert.equal((await as(A.viewer, ids.a).get('/api/ai/store-openings')).status, 200)
  assert.equal(Number((await figures('group.openings', ['openings'], [], { ...ALL, venues: 'view' })).openings), openings.length)
  assert.equal((await refused(go({ subject: 'group.openings', values: measures(['openings']) }, { ...ALL, venues: 'none' }))).status, 403)
})

test('Issues: the Issue log, its priority and how long resolving took', async () => {
  const till = await ok(owner.post('/api/issues', { title: 'Zqx Till down', description: 'Zqx no power', category: 'incident', impact: 'critical', urgency: 'high' }), 'issue')
  const wifi = await ok(owner.post('/api/issues', { title: 'Zqx Slow wifi', category: 'problem', impact: 'medium', urgency: 'low' }), 'second issue')
  await sql`
    UPDATE issue_log SET status = 'resolved', resolved_at = created_at + interval '2 days 3 hours', resolution_notes = 'Zqx router swapped'
     WHERE id = ${wifi.id} AND tenant_id = ${ids.a}`
  // Closed on the Issue log by Macaroonie: closed is done, as resolved is.
  const jam = await ok(owner.post('/api/issues', { title: 'Zqx Printer jam', category: 'incident', impact: 'low', urgency: 'low' }), 'third issue')
  await ok(as(PLATFORM, ids.a).patch(`/api/issues/${jam.id}`, { status: 'closed' }), 'close the third issue')
  const issues = await ok(owner.get('/api/issues'), 'issues')
  assert.ok(issues.some(i => i.id === till.id))
  assert.ok(issues.some(i => i.id === jam.id && i.status === 'closed' && i.resolved_at), 'a closed issue is in the data')

  const list = listRows(await go({ subject: 'group.issues', kind: 'list',
    rows: ['title', 'description', 'kind', 'impact', 'urgency', 'priority', 'status', 'still_open', 'resolution', 'time_to_resolve'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(issues.map(i => i.id)), 'the same issues, the group\'s own only')
  for (const i of issues) {
    const r = rowOf(list, i.id)
    assert.equal(r.title, i.title)
    assert.equal(words(r.description), words(i.description))
    assert.equal(r.kind, i.category)
    assert.equal(r.impact, i.impact)
    assert.equal(r.urgency, i.urgency)
    assert.equal(r.priority, i.priority)
    assert.equal(r.status, i.status)
    assert.equal(r.still_open, !['resolved', 'closed'].includes(i.status))
    assert.equal(words(r.resolution), words(i.resolution_notes))
    if (i.resolved_at) near(r.time_to_resolve, (Date.parse(i.resolved_at) - Date.parse(i.created_at)) / 1000, i.title + ': time to resolve', 1)
    else assert.equal(r.time_to_resolve, null)
  }
  near(rowOf(list, wifi.id).time_to_resolve, (2 * 24 + 3) * 3600, 'two days and three hours', 1)
  assert.equal(rowOf(list, jam.id).still_open, false, 'a closed issue isn\'t open')
  assert.equal(rowOf(list, till.id).still_open, true, 'a new issue is open')

  const resolved = issues.filter(i => i.resolved_at)
  const f = await figures('group.issues', ['issues', 'open_count', 'resolved_count', 'urgent', 'average_to_resolve'])
  assert.equal(Number(f.issues), issues.length)
  assert.equal(Number(f.open_count), count(issues, i => !['resolved', 'closed'].includes(i.status)))
  assert.equal(Number(f.resolved_count), resolved.length)
  assert.equal(Number(f.urgent), count(issues, i => ['p1', 'p2'].includes(i.priority)))
  near(f.average_to_resolve, resolved.reduce((s, i) => s + (Date.parse(i.resolved_at) - Date.parse(i.created_at)) / 1000, 0) / resolved.length, 'average to resolve', 1)

  assert.equal(Number((await figures('group.issues', ['issues'], [], { ...ALL, issue_log: 'view' })).issues), issues.length)
  assert.equal((await refused(go({ subject: 'group.issues', values: measures(['issues']) }, { ...ALL, issue_log: 'none' }))).status, 403)
})

test('Feature requests: the group\'s own requests with every group\'s votes', async () => {
  const asked = await ok(owner.post('/api/feature-requests', { title: 'Zqx Rota on the phone', description: 'Zqx please' }), 'request')
  await ok(owner.post('/api/feature-requests/' + asked.id + '/upvote', {}), 'vote')
  await ok(as(A.admin, ids.a).post('/api/feature-requests/' + asked.id + '/upvote', {}), 'second vote')
  await ok(as(B.owner, ids.b).post('/api/feature-requests/' + asked.id + '/upvote', {}), 'a vote from another group')
  const [dark] = await sql`SELECT id FROM feature_requests WHERE tenant_id = ${ids.a} AND title LIKE '%Dark mode%'`
  await sql`UPDATE feature_requests SET status = 'shipped', admin_notes = 'Zqx out now' WHERE id = ${dark.id}`

  const board = await ok(owner.get('/api/feature-requests'), 'feature requests')
  assert.ok(board.some(r => r.tenant_id === ids.b), 'the page lists other groups\' requests too')
  const ours = board.filter(r => r.tenant_id === ids.a)
  const list = listRows(await go({ subject: 'group.requests', kind: 'list', rows: ['title', 'description', 'status', 'votes', 'reply'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(ours.map(r => r.id)), 'the group\'s own requests only')
  for (const q of ours) {
    const r = rowOf(list, q.id)
    assert.equal(r.title, q.title)
    assert.equal(words(r.description), words(q.description))
    assert.equal(r.status, q.status)
    assert.equal(Number(r.votes), q.upvotes)
    assert.equal(words(r.reply), words(q.admin_notes))
  }
  assert.equal(Number(rowOf(list, asked.id).votes), 3, 'every group\'s votes')

  const f = await figures('group.requests', ['requests', 'total_votes', 'shipped', 'waiting', 'votes_a_request'])
  const votes = ours.reduce((s, q) => s + q.upvotes, 0)
  assert.equal(Number(f.requests), ours.length)
  assert.equal(Number(f.total_votes), votes)
  assert.equal(Number(f.shipped), count(ours, q => q.status === 'shipped'))
  assert.equal(Number(f.waiting), count(ours, q => ['submitted', 'under_review', 'planned', 'in_progress'].includes(q.status)))
  near(f.votes_a_request, votes / ours.length, 'votes a request', 0.051)
  assert.equal((await refused(go({ subject: 'group.requests', values: measures(['requests']) }, { ...ALL, feature_requests: 'none' }))).status, 403)
})

test('Who can report on Pepper and the group: each starter says what it needs', async () => {
  const op = as(A.operator, ids.a)
  const reports = await ok(op.get('/api/reports'), 'reports')
  const starter = key => reports.starters.find(s => s.id === 'starter:' + key)
  const expect = {
    pepper_use_by_month: [true, null],
    pepper_use_by_person: [false, 'Manage on Pepper (AI assistant)'],
    pepper_changes: [false, 'Manage on Pepper (AI assistant)'],
    group_team_sign_ins: [false, 'Team'],
    group_issues: [true, null],
    app_emails: [false, 'Booking emails'],
  }
  for (const [key, [runs, needs]] of Object.entries(expect)) {
    const s = starter(key)
    assert.ok(s, key)
    assert.equal(s.runs, runs, key + ': runs')
    if (!runs) assert.equal(s.needs, needs, key + ': needs')
  }
  await ok(op.post('/api/reports/starter:pepper_use_by_month/run', {}), 'the month\'s use, for View')
  await ok(op.post('/api/reports/starter:group_issues/run', {}), 'issues')
  assert.equal((await op.post('/api/reports/starter:pepper_use_by_person/run', {})).status, 403)
  assert.equal((await op.post('/api/reports/starter:pepper_changes/run', {})).status, 403)
  assert.equal((await op.post('/api/reports/starter:group_team_sign_ins/run', {})).status, 403)
  // The rule itself: a level above View says so.
  assert.deepEqual(runsFor('pepper.people', { ai_assistant: 'view' }), { runs: false, needs: 'Manage on Pepper (AI assistant)' })
  assert.equal(runsFor('pepper.people', { ai_assistant: 'manage' }).runs, true)
  assert.deepEqual(runsFor('pepper.usage', { ai_assistant: 'none' }), { runs: false, needs: 'Pepper (AI assistant)' })
})

test('Every change Pepper can make has words for the Activity tab and reports', async () => {
  const changes = [...audienceTools('staff'), ...audienceTools('guest')].filter(t => t.confirm).map(t => t.name)
  assert.ok(changes.length > 50)
  assert.deepEqual(changes.filter(n => !ACTION_LABELS[n]), [], 'changes without words')
  const dir = new URL('../src/ai/tools/', import.meta.url)
  const src = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n')
  const audited = [...new Set([...src.matchAll(/tool:\s*'([a-z_]+)'/g)].map(m => m[1]))]
  assert.ok(audited.length > 0)
  assert.deepEqual(audited.filter(n => !ACTION_LABELS[n]), [], 'audited names without words')
})

// Last: it changes the operator's role and switches the viewer off.
test('Team and roles: the Team page and Access, a custom role and sign-ins', async () => {
  const roles = await ok(owner.get('/api/access/roles'), 'roles')
  const own = roles.find(r => !r.is_builtin)
  assert.ok(own, 'the fixtures\' own role')
  const before = await ok(owner.get('/api/team'), 'team')
  const person = sub => before.find(u => u.email === email(sub))
  await ok(owner.patch('/api/team/' + person(A.operator).id, { role: own.id }), 'give the operator the group\'s own role')
  await ok(owner.patch('/api/team/' + person(A.viewer).id, { is_active: false }), 'switch the viewer off')
  // A sign-in can point at one of the four built-in role rows (migration 160
  // made them rows): the Team page shows that as the built-in role, never as
  // a role of the group's own.
  const adminRow = roles.find(r => r.is_builtin && r.key === 'admin')
  assert.ok(adminRow, 'the built-in admin row')
  await sql`UPDATE users SET custom_role_id = ${adminRow.id} WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  const signed = async (sub, t) => sql`UPDATE users SET last_login_at = ${t} WHERE tenant_id = ${ids.a} AND auth0_user_id = ${sub}`
  await signed(A.owner, await noon(1))
  await signed(A.admin, await noon(40))
  await signed(A.operator, null)
  await signed(A.viewer, await noon(2))

  const team = await ok(owner.get('/api/team'), 'team')
  const builtin = key => roles.find(r => r.is_builtin && r.key === key)?.label
  const roleName = u => u.custom_role_name || builtin(u.role)
  const nameOf = u => (u.full_name || '').trim() || u.email
  const list = listRows(await go({ subject: 'group.team', kind: 'list',
    rows: ['name', 'email', 'builtin_role', 'custom', 'role.name', 'active', 'signed_in', 'days_since', 'invited_by.name'] }))
  assert.deepEqual(sorted(list.map(r => r._id)), sorted(team.map(u => u.id)), 'the same people, the group\'s own only')
  for (const u of team) {
    const r = rowOf(list, u.id)
    assert.equal(r.name, nameOf(u))
    assert.equal(r.email, u.email)
    assert.equal(r.builtin_role, u.role)
    assert.equal(r.custom, !!u.custom_role_id, u.email + ': a role of the group\'s own')
    assert.equal(r['role.name'], roleName(u), u.email + ': role')
    assert.equal(r.active, u.is_active)
    assert.equal(r.signed_in, !!u.last_login_at)
    const inviter = team.find(x => x.id === u.invited_by)
    assert.equal(words(r['invited_by.name']), inviter ? nameOf(inviter) : null)
  }
  const at = sub => rowOf(list, person(sub).id)
  assert.equal(at(A.operator)['role.name'], own.label)
  assert.equal(at(A.operator).custom, true)
  assert.equal(at(A.admin).custom, false, 'a built-in role row isn\'t a role of the group\'s own')
  assert.equal(at(A.admin)['role.name'], builtin('admin'))
  assert.equal(Number(at(A.owner).days_since), 1)
  assert.equal(Number(at(A.admin).days_since), 40)
  assert.equal(at(A.operator).days_since, null)

  const now = Date.now()
  const f = await figures('group.team', ['people', 'active_people', 'never_signed_in', 'recent'])
  assert.equal(Number(f.people), team.length)
  assert.equal(Number(f.active_people), count(team, u => u.is_active))
  assert.equal(Number(f.never_signed_in), count(team, u => u.is_active && !u.last_login_at))
  assert.equal(Number(f.recent), count(team, u => u.last_login_at && now - Date.parse(u.last_login_at) < 30 * 86400_000))

  // Roles, as Access lists them, each with the people who have it.
  const rl = listRows(await go({ subject: 'group.roles', kind: 'list', rows: ['name', 'description', 'builtin', 'in_use'] }))
  assert.deepEqual(sorted(rl.map(r => r._id)), sorted(roles.map(r => r.id)), 'the same roles, the group\'s own only')
  for (const role of roles) {
    const r = rowOf(rl, role.id)
    assert.equal(r.name, role.label)
    assert.equal(words(r.description), words(role.description))
    assert.equal(r.builtin, role.is_builtin)
    assert.equal(r.in_use, role.is_active)
  }
  const held = rowsOf(await go({ subject: 'group.roles', rows: ['name'], values: measures(['people.people']) }))
  assert.equal(held.length, roles.length)
  for (const h of held) assert.equal(Number(h['people.people'] ?? 0), count(team, u => roleName(u) === h.name), h.name + ': people')
  const rf = await figures('group.roles', ['roles', 'own_roles'])
  assert.equal(Number(rf.roles), roles.length)
  assert.equal(Number(rf.own_roles), count(roles, r => !r.is_builtin))

  // Team needs the Team module; the role names alone need nothing.
  assert.equal(Number((await figures('group.team', ['people'], [], { ...ALL, team: 'view' })).people), team.length)
  assert.equal((await refused(go({ subject: 'group.team', values: measures(['people']) }, { ...ALL, team: 'none' }))).status, 403)
  assert.equal(Number((await figures('group.roles', ['roles'], [], { reports: 'view' })).roles), roles.length)
})
