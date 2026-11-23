// The task store (Pepper-first step 5a, migration 278): a Today task's owner,
// snooze, skip with a reason and done by hand, kept by venue and the feed's
// key, applied to the feed; each change in the task's history; only on a task
// the person can see, with Use on its module (or View where it has no Use);
// the day's skips by site for managers, never by person.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { applyStates, stateLevel } from '../src/services/opsTasks.js'
import { SKIP_REASONS, MANUAL_DONE_KINDS } from '../../shared/todayTasks.js'

let ids, owner, viewer, other, V, today
const feed = (who, q = '') => ok(who.get(`/api/ops/today?venue_id=${V}${q}`))
const change = (who, body) => who.post('/api/ops/tasks', { venue_id: V, ...body })
const kindOf = (d, kind) => d.tasks.find(t => t.kind === kind)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  today = (await feed(owner)).date
})
after(closeApp)

test('the rules: a skip only with a reason, done by hand only where the feed can\'t see it finish', () => {
  assert.equal(stateLevel('food_safety'), 'use', 'a module with Use needs Use')
  assert.equal(stateLevel('purchasing'), 'view', 'a module without Use: View')
  assert.ok(SKIP_REASONS.length >= 3)
  assert.ok(MANUAL_DONE_KINDS.includes('report_alert'))
  const tasks = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }, { key: 'c', title: 'C' }, { key: 'd', title: 'D' }]
  const later = new Date(Date.now() + 3600_000).toISOString()
  const r = applyStates(tasks, [
    { task_key: 'a', skipped_on: '2026-11-23', skip_reason: 'Closed' },
    { task_key: 'b', snoozed_until: later },
    { task_key: 'c', done_on: '2026-11-22' },
    { task_key: 'd', owner_id: 'u1', owner_active: true, owner_full_name: 'Sam Smith', owner_sub: 'me' },
  ], { date: '2026-11-23', isToday: true, me: 'me' })
  assert.deepEqual(r.tasks.map(t => t.key), ['c', 'd'], 'skipped today and snoozed set aside; done another day stays')
  assert.deepEqual(r.aside.map(t => [t.key, t.state]), [['a', 'skipped'], ['b', 'snoozed']])
  assert.deepEqual(r.tasks[1].owner, { id: 'u1', name: 'Sam Smith', me: true })
  const ahead = applyStates(tasks, [{ task_key: 'b', snoozed_until: later }], { date: '2026-11-24', isToday: false })
  assert.equal(ahead.tasks.length, 4, 'a snooze only counts on today\'s feed')
})

test('snooze hides a task until then, and it comes back', async () => {
  const d = await feed(owner, '&time=10:00')
  const fridge = kindOf(d, 'fridge_check')
  assert.equal(fridge.can_change, true)
  assert.equal((await change(owner, { key: fridge.key, action: 'snooze' })).status, 422, 'how long')
  assert.equal((await change(owner, { key: fridge.key, action: 'snooze', minutes: 2 })).status, 422, 'at least 5 minutes')
  const done = await ok(change(owner, { key: fridge.key, action: 'snooze', minutes: 60 }))
  assert.ok(Date.parse(done.snoozed_until) > Date.now() + 55 * 60_000)
  const after = await feed(owner, '&time=10:00')
  assert.ok(!after.tasks.some(t => t.key === fridge.key), 'off the list')
  const aside = after.aside.find(t => t.key === fridge.key)
  assert.equal(aside.state, 'snoozed')
  assert.match(aside.until_text, /^until /)
  assert.equal(after.counts.late + after.counts.now + after.counts.next + after.counts.later, after.tasks.length, 'counts follow the list')
  await ok(change(owner, { key: fridge.key, action: 'unsnooze' }))
  assert.ok((await feed(owner, '&time=10:00')).tasks.some(t => t.key === fridge.key), 'back')
  assert.equal((await change(owner, { key: fridge.key, action: 'unsnooze' })).status, 409, 'not snoozed now')
  // Until a time today at the venue: later than now (held at midnight: only when there is time left).
  const real = (await feed(owner)).now
  if (real > '00:05') assert.equal((await change(owner, { key: fridge.key, action: 'snooze', until: '00:00' })).status, 422, 'a time gone')
  if (real < '23:50') {
    const till = await ok(change(owner, { key: fridge.key, action: 'snooze', until: '23:59' }))
    assert.ok(Date.parse(till.snoozed_until) > Date.now())
    await ok(change(owner, { key: fridge.key, action: 'unsnooze' }))
  }
})

test('a skip needs a reason, leaves the list for the day, shows above the store, and can be undone', async () => {
  const d = await feed(owner, '&time=10:00')
  const list = kindOf(d, 'checklist')
  assert.equal((await change(owner, { key: list.key, action: 'skip' })).status, 422, 'no reason')
  assert.equal((await change(owner, { key: list.key, action: 'skip', reason: '   ' })).status, 422, 'blank')
  assert.equal((await change(owner, { key: list.key, action: 'skip', reason: 'x'.repeat(301) })).status, 422, 'too long')
  const r = await ok(change(owner, { key: list.key, action: 'skip', reason: '  The walk-in is being repaired ' }))
  assert.equal(r.skipped, true)
  assert.equal(r.reason, 'The walk-in is being repaired')
  const after = await feed(owner, '&time=10:00')
  assert.ok(!after.tasks.some(t => t.key === list.key))
  assert.equal(after.aside.find(t => t.key === list.key).reason, 'The walk-in is being repaired')
  assert.equal((await change(owner, { key: list.key, action: 'skip', reason: 'again' })).status, 409)
  // Another day: still on the list.
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  assert.ok((await feed(owner, '&date=' + tomorrow)).tasks.some(t => t.key === list.key), 'only for that day')
  // Above the store: by site, for managers; never who skipped it.
  const skips = await ok(owner.get('/api/ops/skips'))
  assert.equal(skips.can_see, true)
  const site = skips.sites.find(s => s.venue_id === V)
  const mine = site.skips.find(s => s.key === list.key)
  assert.equal(mine.reason, 'The walk-in is being repaired')
  assert.ok(!('by' in mine) && !('skipped_by' in mine), 'never by person')
  const viewerSkips = await ok(viewer.get('/api/ops/skips'))
  assert.equal(viewerSkips.total, 0, 'View on the area: not a manager of it')
  const hist = await ok(owner.get(`/api/ops/tasks/history?venue_id=${V}&key=${encodeURIComponent(list.key)}`))
  assert.equal(hist.history[0].action, 'skipped')
  assert.equal(hist.history[0].reason, 'The walk-in is being repaired')
  await ok(change(owner, { key: list.key, action: 'unskip' }))
  assert.ok((await feed(owner, '&time=10:00')).tasks.some(t => t.key === list.key), 'back on the list')
  const hist2 = await ok(owner.get(`/api/ops/tasks/history?venue_id=${V}&key=${encodeURIComponent(list.key)}`))
  assert.deepEqual(hist2.history.slice(0, 2).map(h => h.action), ['unskipped', 'skipped'])
})

test('assign: to a team member who can do it; the owner shows on the task', async () => {
  const d = await feed(owner, '&time=10:00')
  const fridge = kindOf(d, 'fridge_check')
  const people = await ok(owner.get(`/api/ops/tasks/people?venue_id=${V}&key=${encodeURIComponent(fridge.key)}`))
  const me = people.people.find(p => p.me)
  assert.ok(me, 'the owner can do it')
  const [viewerRow] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.viewer}`
  assert.ok(!people.people.some(p => p.id === viewerRow.id), 'a viewer of food safety can\'t log checks')
  assert.equal((await change(owner, { key: fridge.key, action: 'assign', owner_id: viewerRow.id })).status, 422)
  const [bUser] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.b} LIMIT 1`
  assert.equal((await change(owner, { key: fridge.key, action: 'assign', owner_id: bUser.id })).status, 404, 'another group\'s person')
  const r = await ok(change(owner, { key: fridge.key, action: 'assign', owner_id: me.id }))
  assert.equal(r.owner.id, me.id)
  const after = await feed(owner, '&time=10:00')
  assert.deepEqual(after.tasks.find(t => t.key === fridge.key).owner, { id: me.id, name: me.name, me: true })
  await ok(change(owner, { key: fridge.key, action: 'assign', owner_id: null }))
  assert.equal((await feed(owner, '&time=10:00')).tasks.find(t => t.key === fridge.key).owner, undefined)
})

test('who may change a task: Use on a module with Use, View on one without; only tasks on their own feed', async () => {
  const vd = await feed(viewer, '&time=10:00')
  const fridge = kindOf(vd, 'fridge_check')
  assert.equal(fridge.can_change, false, 'food safety View')
  assert.equal((await change(viewer, { key: fridge.key, action: 'snooze', minutes: 30 })).status, 403)
  assert.equal((await change(owner, { key: 'no-such-task', action: 'snooze', minutes: 30 })).status, 404)
  assert.equal((await change(other, { key: fridge.key, action: 'snooze', minutes: 30 })).status, 404, 'another group\'s venue')
  const d = await feed(owner, '&time=10:00')
  assert.equal((await change(owner, { key: kindOf(d, 'fridge_check').key, action: 'done' })).status, 422, 'a check leaves the list by its record')
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM ops_task_states WHERE tenant_id = ${ids.b}`
  assert.equal(n, 0, 'nothing written for the other group')
})
