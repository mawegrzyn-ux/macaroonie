// Above the store (Pepper-first step 7c): Your sites on Home, for Manage on
// Venues. Each venue ranked by what needs it today (late tasks, checks out of
// range, cash-ups missing, devices offline, skips), with completion today
// and this week (the share of due tasks finished before they went late),
// read from the feed's record (ops_task_days). By site, never by person.
//
// The maths is tested on fixed instants; the API part builds its rows from
// each venue's own today and Monday, so it holds at midnight UTC and on any
// weekday (a Monday's week is that day alone).
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { completion, rankSites, siteScore, siteReasons, mondayOf, WEIGHTS } from '../src/services/sites.js'
import { localParts } from '../src/services/opsTasks.js'

test('completion: of the tasks due, the share finished before they went late', () => {
  assert.deepEqual(completion([]), { due: 0, in_window: 0, share: null }, 'nothing due: no figure, not 0%')
  assert.deepEqual(completion([{ due: 3, in_window: 2 }]), { due: 3, in_window: 2, share: 66.7 })
  assert.deepEqual(completion([{ due: 3, in_window: 2 }, { due: 1, in_window: 1 }]), { due: 4, in_window: 3, share: 75 })
})

test('the ranking: weights stated once, then the lower completion, then the name', () => {
  assert.deepEqual(WEIGHTS, { late: 3, out_of_range: 3, cash_up: 2, offline: 2, skipped: 1 })
  assert.equal(siteScore({ late: 2, out_of_range: 1, cash_up: 1, offline: 0, skipped: 3 }), 2 * 3 + 3 + 2 + 3)
  assert.deepEqual(siteReasons({ late: 1, out_of_range: 2, cash_up: 1, offline: 3, skipped: 1 }).map(r => r.text),
    ['1 task late', '2 checks out of range', 'Cash-up missing', '3 devices offline', '1 task skipped today'])
  assert.deepEqual(siteReasons({}), [])
  // Wednesday 25 Nov 2026, 12:00 UTC: London and Auckland (already 01:00 Thursday there).
  const now = new Date('2026-11-25T12:00:00Z')
  const venues = [
    { id: 'a', name: 'Alpha', timezone: 'Europe/London' },
    { id: 'b', name: 'Bravo', timezone: 'Europe/London' },
    { id: 'c', name: 'Charlie', timezone: 'Pacific/Auckland' },
    { id: 'd', name: 'Delta', timezone: 'Europe/London' },
  ]
  const rows = [
    { venue_id: 'a', day: '2026-11-25', late: 0, skipped: 1, due: 4, in_window: 3 },
    { venue_id: 'a', day: '2026-11-23', due: 2, in_window: 2 },             // Monday: this week
    { venue_id: 'a', day: '2026-11-22', due: 5, in_window: 0 },             // Sunday: last week
    { venue_id: 'b', day: '2026-11-25', late: 2, cash_up: 1, due: 3, in_window: 1 },
    { venue_id: 'c', day: '2026-11-26', out_of_range: 1, due: 1, in_window: 0 },   // Auckland's today
    { venue_id: 'c', day: '2026-11-25', late: 9, due: 9, in_window: 0 },    // Auckland's yesterday: in its week, not its today
    { venue_id: 'd', day: '2026-11-25', skipped: 1, due: 2, in_window: 0 },
  ]
  const out = rankSites(venues, rows, now)
  assert.deepEqual(out.map(s => [s.name, s.score]), [['Bravo', 8], ['Charlie', 3], ['Delta', 1], ['Alpha', 1]],
    'Delta beside Alpha on score: the lower completion today first')
  const alpha = out.find(s => s.name === 'Alpha')
  assert.equal(alpha.today.share, 75)
  assert.deepEqual(alpha.week, { due: 6, in_window: 5, share: 83.3 }, 'Monday counts, Sunday was last week')
  const charlie = out.find(s => s.name === 'Charlie')
  assert.equal(charlie.date, '2026-11-26', 'each venue\'s own today')
  assert.equal(charlie.counts.late, 0)
  assert.deepEqual(charlie.week, { due: 10, in_window: 0, share: 0 })
  const none = rankSites([{ id: 'x', name: 'X', timezone: 'Europe/London' }], [], now)[0]
  assert.equal(none.recorded, false)
  assert.equal(none.today.share, null)
  assert.equal(mondayOf('2026-11-23'), '2026-11-23')
  assert.equal(mondayOf('2026-11-29'), '2026-11-23')
})

// ── Through the API ────────────────────────────────────────────
let ids, owner, V, V2
const day = (key, venue, date, extra = {}) => ({
  tenant_id: ids.a, venue_id: venue, day: date, task_key: key, area: extra.area || 'food_safety', kind: extra.kind || 'fridge_check',
  title: key, late_at: extra.late_at ?? null, finished_at: extra.finished_at ?? null, skipped: !!extra.skipped,
})

test.before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  await sql`DELETE FROM ops_task_days WHERE tenant_id = ${ids.a}`
})
test.after(closeApp)

test('Your sites: the venue that needs it first, its reasons, completion today and this week', async () => {
  const today = localParts(new Date(), 'Europe/London').date
  const monday = mondayOf(today)
  const lastSunday = new Date(Date.parse(monday + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
  const t = mins => new Date(Date.now() - mins * 60_000)
  const rows = [
    // V: two finished in their window, one finished after going late.
    day('a1', V, today, { finished_at: t(50) }),
    day('a2', V, today, { finished_at: t(40), late_at: t(30) }),
    day('a3', V, today, { late_at: t(90), finished_at: t(20) }),
    day('a4', V, today, {}),                                                         // still to do, not late: not counted yet
    day('w1', V, lastSunday, { late_at: t(9000) }),                                  // last week
    // V2: two late and open, a reading out of range, a cash-up missing, a skip.
    day('b1', V2, today, { late_at: t(60) }),
    day('b2', V2, today, { late_at: t(30) }),
    day('b3', V2, today, { kind: 'corrective_action', late_at: t(30) }),
    day('b4', V2, today, { area: 'cash', kind: 'cash_up', late_at: t(30) }),
    day('b5', V2, today, { area: 'checklists', kind: 'checklist', skipped: true }),
  ]
  for (const r of rows) await sql`INSERT INTO ops_task_days ${sql(r)}`
  const out = await ok(owner.get('/api/ops/sites'))
  assert.deepEqual(out.sites.slice(0, 2).map(s => s.venue_id), [V2, V], 'the site that needs it first')
  const [two, one] = out.sites
  assert.deepEqual(two.counts, { late: 3, skipped: 1, out_of_range: 1, cash_up: 1, offline: 0 }, 'the reading out of range counted once, not also as late')
  assert.deepEqual(two.reasons.map(r => r.key), ['late', 'out_of_range', 'cash_up', 'skipped'])
  assert.deepEqual(two.today, { due: 5, in_window: 0, share: 0 })
  assert.deepEqual(one.today, { due: 3, in_window: 2, share: 66.7 })
  assert.equal(one.reasons.length, 0)
  assert.equal(one.recorded, true)
  // The week: Monday to today (today alone on a Monday); last Sunday never.
  assert.equal(one.week.due, 3, 'last Sunday\'s late task is last week')
  assert.deepEqual(out.today, { due: 8, in_window: 2, share: 25 })
  // By site, never by person: nothing in the answer names anyone.
  assert.doesNotMatch(JSON.stringify(out), /a-owner|_sub|by_name|owner_id/)
})

test('Your sites: Manage on Venues only, and only the group\'s own', async () => {
  assert.equal((await as(A.operator, ids.a).get('/api/ops/sites')).status, 403, 'View on Venues')
  assert.equal((await as(A.viewer, ids.a).get('/api/ops/sites')).status, 403)
  assert.equal((await as(A.admin, ids.a).get('/api/ops/sites')).status, 200, 'an admin runs the sites too')
  const b = await ok(as(B.owner, ids.b).get('/api/ops/sites'))
  assert.ok(!b.sites.some(s => s.venue_id === V || s.venue_id === V2), 'not another group\'s venues')
  assert.equal(b.today.due, 0)
})
