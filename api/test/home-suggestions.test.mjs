// Suggestions on Home (Pepper-first step 7a, migration 282): up to four,
// worked out by rules from data the person may see (their own pages opened,
// their own report runs, the tasks of their own feed, the feed's set-up gaps
// for what they manage), each with a reason; never a page they can't open,
// one they've pinned or one they dismissed (for 14 days).
//
// The rules are tested on fixed dates (no clock); the API part builds its
// rows from the feed's own day and time at the venue, so it holds at
// midnight UTC and on any weekday.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import {
  RULES, suggest, dueRule, habitRule, oftenRule, weeklyReportRule, setupRule, sameWeekdays, pageKey,
  MAX_SUGGESTIONS, HIDE_DAYS,
} from '../src/services/suggestions.js'
import { cleanUpUsage } from '../src/services/usageRecord.js'

// ── The rules, on fixed dates ──────────────────────────────────
const FRI = '2026-11-20'
const menuOf = (...routes) => new Map(routes.map(r => [r, { route: r, label: r.slice(1) || 'Home', icon: 'Circle' }]))
const opened = (path, days, hour) => days.map(day => ({ path, day, hour }))

test('the rules are one list, in the order they rank', () => {
  assert.deepEqual(RULES.map(r => r.key), ['due', 'team', 'setup', 'habit', 'often', 'weekly_report'])
  assert.equal(MAX_SUGGESTIONS, 4)
  assert.equal(HIDE_DAYS, 14)
  assert.deepEqual(sameWeekdays(FRI, 3), ['2026-11-13', '2026-11-06', '2026-10-30'])
})

test('due: a page the late or skipped tasks point at, with the count as its reason', () => {
  const out = dueRule({
    tasks: [
      { area: 'food_safety', kind: 'fridge_check', group: 'late' },
      { area: 'food_safety', kind: 'fridge_check', group: 'late' },
      { area: 'food_safety', kind: 'hold_check', group: 'late' },
      { area: 'checklists', kind: 'checklist', group: 'now' },
    ],
    aside: [{ area: 'checklists', kind: 'checklist', state: 'skipped' }, { area: 'rota', kind: 'rota_not_ready', state: 'snoozed' }],
  })
  assert.deepEqual(out.map(o => [o.key, o.reason, o.score]), [
    ['/food-safety', '2 tasks late here', 4],
    ['/food-safety#holds', '1 task late here', 2],
    ['/checklists', '1 task skipped today', 1],
  ])
  assert.equal(out[1].tab, 'holds')
})

test('habit: opened around this hour on 3 of the last 6 same weekdays; often: 5 of the last 14 days', () => {
  const now = { date: FRI, hour: 9 }
  const weeks = sameWeekdays(FRI, 6)
  const usage = [
    ...opened('/rota', weeks.slice(0, 3), 10),            // 3 Fridays, an hour later: a habit
    ...opened('/bookings', weeks.slice(0, 2), 9),         // 2 Fridays: not yet
    ...opened('/orders', weeks.slice(0, 4), 14),          // 4 Fridays, but in the afternoon
    ...opened('/orders', [FRI], 9),                       // today doesn't count
  ]
  assert.deepEqual(habitRule({ now, usage }).map(o => [o.path, o.reason, o.score]), [['/rota', 'You open this most Fridays around now', 3]])
  const days = n => Array.from({ length: n }, (_, i) => new Date(Date.parse(FRI + 'T12:00:00Z') - (i + 1) * 86400000).toISOString().slice(0, 10))
  const often = oftenRule({ now, usage: [...opened('/timeline', days(5), 20), ...opened('/menus', days(4), 8), ...opened('/menus', [FRI], 8)] })
  assert.deepEqual(often.map(o => [o.path, o.reason, o.score]), [['/timeline', 'You open this most days', 5]])
  // 15 days back is outside the fortnight.
  assert.deepEqual(oftenRule({ now, usage: opened('/timeline', [...days(4), '2026-11-05'], 9) }), [])
})

test('weekly report: run in 3 of the last 4 weeks, and only one the person can still open', () => {
  const now = { date: FRI, hour: 9 }
  const runs = [
    { ref: 'r1', day: '2026-11-17' }, { ref: 'r1', day: '2026-11-18' }, { ref: 'r1', day: '2026-11-10' }, { ref: 'r1', day: '2026-11-02' },
    { ref: 'r2', day: '2026-11-17' }, { ref: 'r2', day: '2026-11-10' }, { ref: 'r2', day: '2026-10-25' },   // the 25th is in the fifth week back
    { ref: 'r3', day: '2026-11-16' }, { ref: 'r3', day: '2026-11-09' }, { ref: 'r3', day: '2026-11-02' },
  ]
  const reports = new Map([['r1', 'Weekly sales'], ['r2', 'Covers']])
  assert.deepEqual(weeklyReportRule({ now, runs, reports }).map(o => [o.key, o.label, o.score]), [['report:r1', 'Weekly sales', 3]], 'r3 can no longer be opened')
})

test('set-up gaps only for someone who can set them up', () => {
  const gaps = [{ key: 'no_fridges', module: 'food_safety', path: '/food-safety', reason: 'No fridges set up at Ware yet' }]
  assert.equal(setupRule({ gaps, levels: { food_safety: 'manage' } }).length, 1)
  assert.equal(setupRule({ gaps, levels: { food_safety: 'use' } }).length, 0)
})

test('ranking and the filter: rule order, then score; never off the menu, pinned, dismissed or Home; a page once; four at most', () => {
  const now = { date: FRI, hour: 9 }
  const weeks = sameWeekdays(FRI, 6)
  const facts = {
    now, venueId: '11111111-1111-4111-8111-111111111111',
    menu: menuOf('/', '/rota', '/food-safety', '/bookings', '/orders', '/timeline', '/menus', '/checklists'),
    pinned: new Set(['/orders']),
    hidden: new Set(['/menus']),
    tasks: [{ area: 'food_safety', kind: 'fridge_check', group: 'late' }],
    usage: [
      ...opened('/rota', weeks.slice(0, 4), 9),       // habit, 4
      ...opened('/bookings', weeks.slice(0, 3), 9),   // habit, 3
      ...opened('/orders', weeks, 9),                 // pinned
      ...opened('/menus', weeks, 9),                  // dismissed
      ...opened('/team', weeks, 9),                   // not in the menu
      ...opened('/', weeks, 9),                       // Home itself
      ...opened('/food-safety', weeks, 9),            // already suggested by Due
    ],
    gaps: [{ key: 'no_fridges', module: 'food_safety', path: '/checklists', reason: 'gap' }],
    levels: { food_safety: 'manage' },
  }
  const out = suggest(facts)
  assert.deepEqual(out.map(s => [s.rule, s.path]), [['due', '/food-safety'], ['setup', '/checklists'], ['habit', '/rota'], ['habit', '/bookings']])
  assert.equal(out[0].link, '/food-safety?venue=' + facts.venueId, 'opens at Home\'s venue where the page takes one')
  assert.equal(out[2].link, '/rota?venue=' + facts.venueId)
  assert.equal(out[3].link, '/bookings?venue=' + facts.venueId)
  assert.deepEqual(out[2].pin, { path: '/rota', venue_id: facts.venueId, tab: null })
  assert.equal(suggest(facts, { max: 2 }).length, 2)
  assert.equal(pageKey('/food-safety', 'holds'), '/food-safety#holds')
})

// ── Through the API ────────────────────────────────────────────
let ids, owner, operator, viewer, V, V2
// At a quiet hour unless a test says otherwise: later in the day the fixtures' late tasks fill
// all four places and push the rules under test out (it failed at 13:55).
const feed = (who, venue = V, q = '&time=06:00') => ok(who.get(`/api/ops/today?venue_id=${venue}${q}`))
const keysOf = d => d.suggestions.map(s => s.key)

/** Page opens for `sub` at the venue's local `day` (YYYY-MM-DD) and `time` (HH:MM). */
async function openAt(sub, path, day, time) {
  await sql`INSERT INTO usage_events (tenant_id, user_sub, kind, path, at)
            VALUES (${ids.a}, ${sub}, 'page', ${path}, (${day}::date + ${time}::time) AT TIME ZONE 'Europe/London')`
}
const back = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  await sql`DELETE FROM usage_events WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM home_pins WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM home_suggestion_hides WHERE tenant_id = ${ids.a}`
  await sql`DELETE FROM team_suggestions WHERE tenant_id = ${ids.a}`
})
test.after(closeApp)

// On a Wednesday: from Thursday the fixtures' empty rota for next week is a task (late at the
// weekend), and a late task outranks a habit, so /rota would come as Due (it failed on a Saturday).
const lastWednesday = () => {
  const d = new Date(Date.now() - 7 * 86400000)
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

test('the feed carries the suggestions; a habit from the person\'s own record only', async () => {
  const onWed = '&time=06:00&date=' + lastWednesday()
  const d = await feed(owner, V, onWed)
  assert.ok(Array.isArray(d.suggestions))
  const hour = d.now.slice(0, 5)
  for (const n of [7, 14, 21]) await openAt(A.owner, '/rota', back(d.date, n), hour)
  // Someone else's opens never count for the owner.
  for (const n of [7, 14, 21]) await openAt(A.operator, '/bookings', back(d.date, n), hour)
  const after = await feed(owner, V, onWed)
  const rota = after.suggestions.find(s => s.path === '/rota')
  assert.ok(rota, 'the habit shows: ' + JSON.stringify(after.suggestions))
  assert.equal(rota.rule, 'habit')
  assert.match(rota.reason, /^You open this most \w+days around now$/)
  assert.equal(rota.link, '/rota?venue=' + V)
  assert.ok(!after.suggestions.some(s => s.path === '/bookings'), 'not from the operator\'s record')
  assert.ok((await feed(operator, V, onWed)).suggestions.some(s => s.path === '/bookings'), 'the operator sees their own')
  assert.ok(after.suggestions.length <= 4)
})

test('never a page the person can\'t open, and never one they pinned', async () => {
  const d = await feed(viewer)
  for (const n of [7, 14, 21]) await openAt(A.viewer, '/team', back(d.date, n), d.now.slice(0, 5))
  assert.ok(!(await feed(viewer)).suggestions.some(s => s.path === '/team'), 'Team isn\'t in a viewer\'s menu')
  await ok(owner.put('/api/pins', { pins: [{ path: '/rota' }] }))
  assert.ok(!(await feed(owner)).suggestions.some(s => s.path === '/rota'), 'pinned')
  await ok(owner.put('/api/pins', { pins: [] }))
  assert.ok((await feed(owner)).suggestions.some(s => s.path === '/rota'), 'back once unpinned')
})

test('dismiss: off for 14 days, then back; only the person\'s own; refused shapes', async () => {
  assert.equal((await owner.post('/api/suggestions/hide', { key: '/rota' })).status, 204)
  assert.ok(!keysOf(await feed(owner)).includes('/rota'))
  const [h] = await sql`SELECT hidden_until FROM home_suggestion_hides WHERE tenant_id = ${ids.a} AND user_sub = ${A.owner} AND key = '/rota'`
  const days = (Date.parse(h.hidden_until) - Date.now()) / 86400000
  assert.ok(days > 13.9 && days <= 14, 'for 14 days: ' + days)
  // Another person, another group: untouched.
  assert.equal((await sql`SELECT count(*)::int AS n FROM home_suggestion_hides WHERE user_sub <> ${A.owner}`)[0].n, 0)
  // Its time up: back, and the clean-up clears the row.
  await sql`UPDATE home_suggestion_hides SET hidden_until = now() - interval '1 minute' WHERE tenant_id = ${ids.a} AND key = '/rota'`
  assert.ok(keysOf(await feed(owner)).includes('/rota'), 'back')
  const { hides } = await cleanUpUsage()
  assert.ok(hides >= 1)
  assert.equal((await sql`SELECT count(*)::int AS n FROM home_suggestion_hides WHERE tenant_id = ${ids.a}`)[0].n, 0)
  for (const key of ['', 'rota', 'javascript:x', '/rota?venue=1', 'team:'.padEnd(250, 'x')]) {
    assert.equal((await owner.post('/api/suggestions/hide', { key })).status, 422, key)
  }
  assert.equal((await as(null, null).post('/api/suggestions/hide', { key: '/rota' })).status, 401)
  assert.equal((await as(B.owner, ids.b).post('/api/suggestions/hide', { key: '/rota' })).status, 204, 'their own, in their group')
  assert.ok(keysOf(await feed(owner)).includes('/rota'), 'not the owner\'s in group A')
})

test('due: late tasks point at their page; a set-up gap for whoever manages it', async () => {
  const late = await feed(owner, V, '&time=23:59')
  const due = late.suggestions.find(s => s.rule === 'due' && s.path === '/food-safety')
  assert.ok(due, 'late checks at the end of the day: ' + JSON.stringify(late.suggestions))
  assert.match(due.reason, /^\d+ tasks? late here/)
  assert.equal(late.suggestions[0].rule, 'due', 'what needs doing ranks first')
  // The second venue has no fridges: the feed knows, and the owner (Manage) is told.
  const d2 = await feed(owner, V2)
  assert.ok((d2.gaps || []).some(g => g.key === 'no_fridges'))
  const gap = d2.suggestions.find(s => s.key === 'setup:no_fridges')
  assert.ok(gap, JSON.stringify(d2.suggestions))
  assert.match(gap.reason, /^No fridges set up at .+ yet$/)
  assert.equal(gap.link, '/food-safety?venue=' + V2)
  assert.ok(!(await feed(viewer, V2)).suggestions.some(s => s.key === 'setup:no_fridges'), 'View on food safety: not the set-up')
})

test('a report the person runs most weeks, opened from the suggestion', async () => {
  const list = await ok(owner.get('/api/reports'))
  const starter = list.starters[0]
  const d = await feed(owner)
  for (const n of [0, 7, 14]) {
    // At 00:01 on the venue's day for today's, so never in the future.
    await sql`INSERT INTO report_runs (tenant_id, starter_key, report_name, kind, user_sub, created_at)
              VALUES (${ids.a}, ${starter.id.replace('starter:', '')}, ${starter.name}, 'run', ${A.owner},
                      (${back(d.date, n)}::date + time '00:01') AT TIME ZONE 'Europe/London')`
    await sql`INSERT INTO report_runs (tenant_id, starter_key, report_name, kind, user_sub, created_at)
              VALUES (${ids.a}, ${starter.id.replace('starter:', '')}, ${starter.name}, 'scheduled', ${A.operator},
                      (${back(d.date, n)}::date + time '00:01') AT TIME ZONE 'Europe/London')`
  }
  // Scheduled sends are not the person running it; someone else's runs don't count.
  const after = await feed(owner)
  const rep = after.suggestions.find(s => s.rule === 'weekly_report')
  // Up to four: other rules may fill the strip first; ask with the others dismissed.
  if (!rep) {
    for (const s of after.suggestions) await ok(owner.post('/api/suggestions/hide', { key: s.key }))
  }
  const again = rep ? after : await feed(owner)
  const r = again.suggestions.find(s => s.rule === 'weekly_report')
  assert.ok(r, JSON.stringify(again.suggestions))
  assert.equal(r.key, 'report:' + starter.id)
  assert.equal(r.link, '/reports/' + encodeURIComponent(starter.id))
  assert.equal(r.reason, 'You run this most weeks')
  assert.equal(r.pin, null, 'a report can\'t be pinned')
  assert.ok(!(await feed(operator)).suggestions.some(s => s.rule === 'weekly_report'), 'the owner\'s runs, not the operator\'s')
})

// ── Measuring (step 7d, migration 284) ─────────────────────────
test('suggestions shown, opened, pinned and dismissed go into the person\'s own record; the group sees tap-through by rule, no person', async () => {
  await sql`DELETE FROM usage_events WHERE tenant_id = ${ids.a} AND kind = 'suggestion'`
  const ev = (rule, act, path) => ({ kind: 'suggestion', rule, act, path })
  const admin = as(A.admin, ids.a)
  assert.equal((await admin.post('/api/usage/events', { events: [
    ev('habit', 'shown', '/rota'), ev('habit', 'opened', '/rota?venue=' + V),
    ev('due', 'shown', '/food-safety'), ev('due', 'dismissed', '/food-safety'),
    ev('team', 'shown', '/menus'), ev('team', 'pinned', '/menus'),
    ev('nonsense', 'shown', '/rota'), ev('habit', 'liked', '/rota'), { kind: 'suggestion', act: 'shown' },
  ] })).status, 204)
  await ok(owner.post('/api/usage/events', { events: [ev('habit', 'shown', '/bookings'), ev('habit', 'shown', '/timeline')] }))
  const rows = await sql`SELECT user_sub, rule, act, path FROM usage_events WHERE tenant_id = ${ids.a} AND kind = 'suggestion' ORDER BY user_sub, at, act`
  assert.equal(rows.length, 8, 'unknown rules and acts dropped')
  assert.ok(rows.every(r => !r.path || !r.path.includes('?')), 'the path only, never the venue in the address')
  // The group's figure: tap-through by rule, no person.
  const res = await ok(owner.post('/api/reports/preview', { spec: {
    subject: 'usage.suggestions', kind: 'summary', rows: ['rule'],
    values: ['shown', 'opened', 'pinned', 'dismissed', 'tap_through'].map(measure => ({ measure })),
  } }))
  // Each row's cells: rule, shown, opened, pinned, dismissed, tap-through.
  const byRule = Object.fromEntries(res.rows.map(r => [r.cells[0], r.cells.slice(1)]))
  assert.deepEqual(byRule.habit.slice(0, 4), [3, 1, 0, 0])
  assert.ok(Math.abs(byRule.habit[4] - 1 / 3) < 1e-5, JSON.stringify(byRule.habit))
  assert.deepEqual(byRule.team.slice(0, 4), [1, 0, 1, 0])
  assert.deepEqual(byRule.due.slice(0, 4), [1, 0, 0, 1])
  assert.ok(Math.abs(res.totals.cells[5] - 1 / 5) < 1e-6, 'the group: one opened of five shown')
  const { CATALOGUE } = await import('../src/reports/catalogue/index.js')
  const s = CATALOGUE.subjects['usage.suggestions']
  const sqls = [...Object.values(s.fields), ...Object.values(s.measures)].map(x => x.sql || '').join(' ')
  assert.ok(!/user_sub|query/.test(sqls), 'reads no person')
  assert.deepEqual(Object.keys(s.links), [])
  assert.equal(s.module, 'nav_designer')
  assert.equal((await admin.post('/api/reports/preview', { spec: { subject: 'usage.suggestions', kind: 'list', rows: ['rule'] } })).status, 403, 'Navigation View for the group figure (an admin has none)')
  // The person's own: theirs only.
  const mine = await ok(admin.post('/api/reports/preview', { spec: { subject: 'usage.mine', kind: 'list', rows: ['what', 'page', 'suggestion', 'rule'] } }))
  assert.equal(mine.rows.filter(r => r.cells[0] === 'suggestion').length, 6, 'the admin\'s six, not the owner\'s two')
})

// ── The Team signal (step 7b, migration 283) ───────────────────
test('a page suggested to a role shows to that role until pinned or dismissed; Manage on Navigation only', async () => {
  const roles = await ok(owner.get('/api/access/roles'))
  const opRole = roles.find(r => r.key === 'operator')
  const ownRole = roles.find(r => r.key === 'owner')
  const made = await ok(owner.post('/api/suggestions/team', {
    role_id: opRole.id, path: '/food-safety', venue_id: V, tab: 'cooking', note: '  Log the   cooking checks here ', sign_as: 'name',
  }))
  assert.equal(made.role_label, opRole.label)
  assert.equal(made.label, 'Food safety')
  assert.equal(made.note, 'Log the cooking checks here')
  assert.equal(made.by_label, 'a-owner', 'the maker\'s name (here the start of their email)')
  const shown = (await feed(operator)).suggestions.find(s => s.key === 'team:' + made.id)
  assert.ok(shown, 'the operator sees it')
  assert.equal(shown.rule, 'team')
  assert.equal(shown.reason, 'Suggested by a-owner: Log the cooking checks here')
  assert.equal(shown.link, `/food-safety?venue=${V}&tab=cooking`)
  assert.ok(!(await feed(owner)).suggestions.some(s => s.key === 'team:' + made.id), 'not another role')
  // Pinned: gone while it is a pin.
  await ok(operator.put('/api/pins', { pins: [{ path: '/food-safety' }] }))
  assert.ok(!(await feed(operator)).suggestions.some(s => s.key === 'team:' + made.id), 'pinned')
  await ok(operator.put('/api/pins', { pins: [] }))
  assert.ok((await feed(operator)).suggestions.some(s => s.key === 'team:' + made.id))
  // Dismissed: for good.
  assert.equal((await operator.post('/api/suggestions/hide', { key: 'team:' + made.id })).status, 204)
  const [h] = await sql`SELECT hidden_until FROM home_suggestion_hides WHERE tenant_id = ${ids.a} AND user_sub = ${A.operator} AND key = ${'team:' + made.id}`
  assert.equal(h.hidden_until, null, 'for good')
  assert.ok(!(await feed(operator)).suggestions.some(s => s.key === 'team:' + made.id))
  // Signed with the maker's role.
  const byRole = await ok(owner.post('/api/suggestions/team', { role_id: opRole.id, path: '/rota', sign_as: 'role' }))
  assert.equal(byRole.by_label, ownRole.label)
  assert.equal(byRole.venue_id, null)
  const list = await ok(owner.get('/api/suggestions/team'))
  assert.equal(list.can_manage, true)
  for (const id of [made.id, byRole.id]) assert.ok(list.suggestions.some(s => s.id === id))
})

test('team suggestions: who may, what is refused, and another group\'s ids are 404', async () => {
  const roles = await ok(owner.get('/api/access/roles'))
  const opRole = roles.find(r => r.key === 'operator')
  const bRoles = await ok(as(B.owner, ids.b).get('/api/access/roles'))
  const bVenue = await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Team Elsewhere', slug: 'team-elsewhere', timezone: 'Europe/London' }))
  const body = { role_id: opRole.id, path: '/timeline' }
  // Navigation is the owner's by default: an admin, an operator and a viewer can't.
  for (const who of [as(A.admin, ids.a), operator, viewer]) {
    assert.equal((await who.post('/api/suggestions/team', body)).status, 403)
    assert.equal((await who.get('/api/suggestions/team')).status, 403)
  }
  assert.equal((await owner.post('/api/suggestions/team', { ...body, role_id: bRoles[0].id })).status, 404, 'another group\'s role')
  assert.equal((await owner.post('/api/suggestions/team', { ...body, path: '/rota', venue_id: bVenue.id })).status, 404, 'another group\'s venue')
  assert.equal((await owner.post('/api/suggestions/team', { ...body, path: '/nowhere' })).status, 400, 'not a page of the menu')
  assert.equal((await owner.post('/api/suggestions/team', { ...body, path: '/' })).status, 400, 'not Home')
  assert.equal((await owner.post('/api/suggestions/team', { ...body, note: 'x'.repeat(141) })).status, 422)
  assert.equal((await owner.post('/api/suggestions/team', { path: '/timeline' })).status, 422, 'a role')
  const one = await ok(owner.post('/api/suggestions/team', body))
  assert.equal((await owner.post('/api/suggestions/team', body)).status, 409, 'the same page to the same role once')
  // A page that doesn't take a venue or a tab: both dropped (cleanPin()).
  const plain = await ok(owner.post('/api/suggestions/team', { role_id: opRole.id, path: '/menus', venue_id: V, tab: 'x' }))
  assert.equal(plain.venue_id, null)
  assert.equal(plain.tab, null)
  // Another group: can't see, can't remove.
  assert.ok(!(await ok(as(B.owner, ids.b).get('/api/suggestions/team'))).suggestions.some(s => s.id === one.id))
  assert.equal((await as(B.owner, ids.b).delete('/api/suggestions/team/' + one.id)).status, 404)
  assert.equal((await owner.delete('/api/suggestions/team/not-an-id')).status, 404)
  assert.equal((await operator.delete('/api/suggestions/team/' + one.id)).status, 403)
  // Removed: its dismissals go with it.
  await ok(operator.post('/api/suggestions/hide', { key: 'team:' + one.id }))
  assert.equal((await owner.delete('/api/suggestions/team/' + one.id)).status, 204)
  assert.equal((await owner.delete('/api/suggestions/team/' + one.id)).status, 404)
  assert.equal((await sql`SELECT count(*)::int AS n FROM home_suggestion_hides WHERE key = ${'team:' + one.id}`)[0].n, 0)
})
