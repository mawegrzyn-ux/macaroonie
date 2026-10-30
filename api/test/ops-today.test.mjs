// The ops task feed (GET /api/ops/today, docs/CHAT_FIRST.md P1, C1, C2, R2,
// S1, U1): tasks come from data and rules, not the AI; a task is done when
// its record exists; each part keeps its own permission; one card per thing.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { groupFor, sortTasks, GROUPS } from '../src/services/opsToday.js'

let ids, owner, V, today
const feed = (who, q = '') => ok(who.get(`/api/ops/today?venue_id=${V}${q}`))
const byKind = (d, kind) => d.tasks.filter(t => t.kind === kind)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  today = (await feed(owner)).date
})
after(closeApp)

test('groups by the venue time: late, now, next, later', () => {
  assert.equal(groupFor('09:00', '10:00'), 'late', 'an hour past the 30 minutes grace')
  assert.equal(groupFor('09:00', '09:25'), 'now')
  assert.equal(groupFor('09:00', '08:31'), 'now', 'within 30 minutes before')
  assert.equal(groupFor('09:00', '08:00'), 'next')
  assert.equal(groupFor('09:00', '06:30'), 'later', 'more than two hours ahead')
  assert.equal(groupFor(null, '06:30'), 'now', 'no set time = some time today')
  assert.equal(groupFor('20:00', '06:30', { overdue: true }), 'late')
  const s = sortTasks([
    { title: 'b', group: 'now', due: null },
    { title: 'a', group: 'later', due: '18:00', compliance: true },
    { title: 'c', group: 'late', due: '09:00' },
    { title: 'd', group: 'now', due: '12:00', compliance: true },
  ])
  assert.deepEqual(s.map(t => t.title), ['c', 'd', 'b', 'a'], 'late first, compliance before the rest in a group')
})

test('the day\'s tasks from the fixtures, each with one action', async () => {
  const d = await feed(owner, '&time=10:00')
  assert.equal(d.venue.id, V)
  assert.ok(d.venues.some(v => v.id === V), 'venues for the switch')
  const keys = d.tasks.map(t => t.key)
  assert.equal(new Set(keys).size, keys.length, 'one card per thing to do')
  for (const t of d.tasks) {
    assert.ok(GROUPS.includes(t.group), t.key)
    assert.ok(t.title && t.action?.label, t.key)
    assert.ok(t.action.form || t.action.path, t.key + ' opens a form or a page')
    assert.equal(t.can_act, true, 'the owner can do everything')
  }
  assert.deepEqual(Object.values(d.counts).reduce((a, b) => a + b, 0), d.tasks.length, 'counts match the list')
  const fridge = byKind(d, 'fridge_check')[0]
  assert.equal(fridge.due, '09:00')
  assert.equal(fridge.group, 'late', '09:00 check at 10:00')
  assert.equal(fridge.action.form, 'temps')
  assert.equal(byKind(d, 'hold_check')[0].group, 'later', '12:30 check at 10:00')
  const at11 = await feed(owner, '&time=11:00')
  assert.equal(byKind(at11, 'hold_check')[0].group, 'next', '12:30 check at 11:00')
  assert.equal(byKind(at11, 'cooking_check')[0].group, 'next', '12:00 session at 11:00')
  assert.ok(byKind(d, 'checklist').length, 'a checklist not done yet')
  assert.ok(byKind(d, 'po_to_send').length, 'a purchase order to send')
  assert.ok(byKind(d, 'orders_to_approve').length, 'an order waiting for approval')
  assert.equal(byKind(d, 'cash_up')[0]?.group, 'late', 'yesterday not submitted')
  // A day ahead nothing is due yet; a day gone is all late.
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  const ahead = await feed(owner, '&date=' + tomorrow)
  assert.equal(byKind(ahead, 'fridge_check')[0].group, 'later')
})

test('a task is done when its record exists (R2); out of range needs an action', async () => {
  const [eq] = await ok(owner.get(`/api/food-safety/equipment?venue_id=${V}`))
  const before = byKind(await feed(owner, '&time=10:00'), 'fridge_check')[0]
  const ct = before.action.ref.capture_time_id
  const log = await ok(owner.post('/api/food-safety/temp-logs', {
    venue_id: V, equipment_id: eq.id, capture_time_id: ct, log_date: today, temperature_c: 9,
  }))
  let d = await feed(owner, '&time=10:00')
  assert.equal(byKind(d, 'fridge_check').length, 0, 'every fridge logged for the check')
  const fix = byKind(d, 'corrective_action')
  assert.equal(fix.length, 1, '9°C in a 0-5 fridge')
  assert.equal(fix[0].group, 'late')
  assert.match(fix[0].title, /9\.0°C/)
  await ok(owner.patch('/api/food-safety/temp-logs/' + log.id, { corrective_action: 'Moved stock to the walk-in, called the engineer' }))
  d = await feed(owner, '&time=10:00')
  assert.equal(byKind(d, 'corrective_action').length, 0, 'the action clears it')
})

test('each part keeps its own permission (U1)', async () => {
  const viewer = await feed(as(A.viewer, ids.a), '&time=10:00')
  assert.ok(viewer.tasks.length, 'a viewer sees what they can view')
  assert.ok(viewer.tasks.every(t => t.can_act === false), 'but can act on none of it')
  const roles = await ok(owner.get('/api/access/roles'))
  const op = roles.find(r => r.key === 'operator')
  try {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...op.permissions, cash_recon: 'none', purchasing: 'none' } }))
    const d = await feed(as(A.operator, ids.a), '&time=10:00')
    assert.ok(d.not_included.includes('cash') && d.not_included.includes('purchasing'), 'named, not worked round')
    assert.equal(d.tasks.filter(t => t.area === 'cash' || t.area === 'purchasing').length, 0)
  } finally {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: op.permissions }))
  }
})

test('another group\'s venue is refused; bad input is a 400', async () => {
  const other = as(B.owner, ids.b)
  assert.equal((await other.get(`/api/ops/today?venue_id=${V}`)).status, 404)
  assert.equal((await owner.get(`/api/ops/today?venue_id=${V}&date=2026-02-31`)).status, 400)
  assert.equal((await owner.get(`/api/ops/today?venue_id=${V}&time=25:00`)).status, 400)
  const none = await other.get('/api/ops/today')
  assert.equal(none.status, 404, 'a group with no venues yet')
})
