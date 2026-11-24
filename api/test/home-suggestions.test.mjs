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
const feed = (who, venue = V, q = '') => ok(who.get(`/api/ops/today?venue_id=${venue}${q}`))
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
})
test.after(closeApp)

test('the feed carries the suggestions; a habit from the person\'s own record only', async () => {
  const d = await feed(owner)
  assert.ok(Array.isArray(d.suggestions))
  const hour = d.now.slice(0, 5)
  for (const n of [7, 14, 21]) await openAt(A.owner, '/rota', back(d.date, n), hour)
  // Someone else's opens never count for the owner.
  for (const n of [7, 14, 21]) await openAt(A.operator, '/bookings', back(d.date, n), hour)
  const after = await feed(owner)
  const rota = after.suggestions.find(s => s.path === '/rota')
  assert.ok(rota, 'the habit shows: ' + JSON.stringify(after.suggestions))
  assert.equal(rota.rule, 'habit')
  assert.match(rota.reason, /^You open this most \w+days around now$/)
  assert.equal(rota.link, '/rota?venue=' + V)
  assert.ok(!after.suggestions.some(s => s.path === '/bookings'), 'not from the operator\'s record')
  assert.ok((await feed(operator)).suggestions.some(s => s.path === '/bookings'), 'the operator sees their own')
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
