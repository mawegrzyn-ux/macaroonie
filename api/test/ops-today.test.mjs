// The ops task feed (GET /api/ops/today, docs/CHAT_FIRST.md P1, C1, C2, R2,
// S1, U1): tasks come from data and rules, not the AI; a task is done when
// its record exists; each part keeps its own permission; one card per thing.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { groupFor, sortTasks, GROUPS, closingTime } from '../src/services/opsToday.js'
import { addDays, weatherText } from '../../shared/localInfo.js'

let ids, owner, V, V2, today
const feed = (who, q = '') => ok(who.get(`/api/ops/today?venue_id=${V}${q}`))
const byKind = (d, kind) => d.tasks.filter(t => t.kind === kind)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  V2 = filled.ids.venue2
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
  const yesterdayCash = byKind(d, 'cash_up').find(t => t.key === 'cash_up:' + addDays(today, -1))
  assert.equal(yesterdayCash?.group, 'late', 'yesterday not submitted')
  assert.deepEqual(yesterdayCash.action, { form: 'cash_up', label: 'Do the cash-up', ref: { date: addDays(today, -1) } })
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
    for (const area of ['cash', 'wages', 'purchasing']) assert.ok(d.not_included.includes(area), area + ' named, not worked round')
    assert.equal(d.tasks.filter(t => ['cash', 'wages', 'purchasing'].includes(t.area)).length, 0)
  } finally {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: op.permissions }))
  }
})

test('a day\'s closing time: the last sitting\'s doors close, else its last orders', () => {
  assert.equal(closingTime([]), null)
  assert.equal(closingTime(null), null)
  assert.equal(closingTime([
    { opens_at: '12:00:00', closes_at: '15:00:00' },
    { opens_at: '17:00:00', closes_at: '22:00:00', doors_close_time: '23:00:00' },
  ]), '23:00')
  assert.equal(closingTime([
    { opens_at: '17:00:00', closes_at: '22:00:00' },
    { opens_at: '12:00:00', closes_at: '15:00:00' },
  ]), '22:00', 'in any order')
  assert.equal(closingTime([{ opens_at: '18:00:00', closes_at: '01:00:00' }]), '23:59', 'past midnight: by the end of the day')
})

// Cash Recon on Today: the day's cash-up (due when the venue closes), the
// days before it not submitted (yesterday always, earlier days of the last
// week once the venue uses Cash Recon), each opening in place; and last
// week's cash wages still to pay (cash due = total less bank, less paid).
test('the cash-up: today\'s at closing time, earlier days once in use, gone once submitted', async () => {
  const C = `/api/venues/${V}/cash-recon`
  const day = n => addDays(today, n)
  const cash = d => byKind(d, 'cash_up')
  const keys = d => cash(d).map(t => t.key).sort()
  const task = (d, date) => cash(d).find(t => t.key === 'cash_up:' + date)

  let d = await feed(owner, '&time=10:00')
  assert.deepEqual(keys(d), ['cash_up:' + day(-1), 'cash_up:' + today].sort(),
    'today and yesterday only, while no day of these two weeks has a cash-up')
  const own = task(d, today)
  assert.equal(own.title, 'Today\'s cash-up')
  assert.equal(own.due, '21:30', 'when the fixtures\' sitting closes')
  assert.equal(own.group, 'later')
  assert.equal(own.detail, 'Not started')
  assert.deepEqual(own.action, { form: 'cash_up', label: 'Do the cash-up', ref: { date: today } })
  assert.equal(own.area, 'cash')
  assert.match(task(d, day(-1)).title, /^Cash-up for \w+day not submitted$/)
  assert.equal(task(await feed(owner, '&time=21:15'), today).group, 'now')
  assert.equal(task(await feed(owner, '&time=22:30'), today).group, 'late', 'an hour after closing')

  // A day three back started: the venue uses Cash Recon, so the week's
  // other days not submitted show too.
  await ok(owner.put(`${C}/daily/${day(-3)}`, { notes: 'Started on Today\'s test' }))
  d = await feed(owner, '&time=10:00')
  assert.deepEqual(keys(d), [0, -1, -2, -3, -4, -5, -6, -7].map(n => 'cash_up:' + day(n)).sort())
  const started = task(d, day(-3))
  assert.equal(started.detail, 'Started, not submitted')
  assert.equal(started.action.label, 'Carry on')
  assert.equal(started.group, 'late')
  assert.ok(!task(d, day(-8)), 'only the last seven days')

  // Submitted: gone (R2). A closed day needs none (R4).
  await ok(owner.post(`${C}/daily/${day(-3)}/submit`, {}))
  const shut = await ok(owner.post(`/api/venues/${V}/schedule/exceptions`, { name: 'Today test closed', date_from: day(-2), date_to: day(-2), is_closed: true }))
  try {
    d = await feed(owner, '&time=10:00')
    assert.ok(!task(d, day(-3)), 'submitted')
    assert.ok(!task(d, day(-2)), 'closed that day')
    assert.ok(task(d, day(-4)), 'the others stay')
  } finally {
    await ok(owner.delete(`/api/venues/${V}/schedule/exceptions/${shut.id}`))
  }

  // A feed for tomorrow has its own cash-up and never counts today as missed.
  const ahead = await feed(owner, '&date=' + day(1))
  assert.ok(task(ahead, day(1)), 'tomorrow\'s own')
  assert.equal(task(ahead, day(1)).group, 'later')
  assert.ok(!task(ahead, today), 'today hasn\'t passed yet')
  // A day gone: its own cash-up is late.
  assert.equal(task(await feed(owner, '&date=' + day(-1)), day(-1)).group, 'late')

  // View on Cash Recon: seen, not done (submitting a day needs Manage).
  const roles = await ok(owner.get('/api/access/roles'))
  const op = roles.find(r => r.key === 'operator')
  try {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...op.permissions, cash_recon: 'view' } }))
    const seen = await feed(as(A.operator, ids.a), '&time=10:00')
    assert.equal(task(seen, today)?.can_act, false)
  } finally {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: op.permissions }))
  }
})

test('last week\'s cash wages still to pay, until they are paid', async () => {
  const C = `/api/venues/${V}/cash-recon`
  const dow = new Date(today + 'T12:00:00Z').getUTCDay()
  const monday = addDays(today, -((dow + 6) % 7))
  const last = addDays(monday, -7)
  const wages = d => byKind(d, 'wages_to_pay')
  assert.equal(wages(await feed(owner, '&time=10:00')).length, 0, 'nothing on last week\'s wages yet')

  const entries = [
    { name: 'Today Jo', entry_type: 'fixed', total: 100, cash_amount: 40 },
    { name: 'Today Sam', entry_type: 'fixed', total: 200, bank_amount: 150 },
    { name: 'Today Lee', entry_type: 'fixed', total: 80, bank_amount: 80 },
  ]
  await ok(owner.put(`${C}/wages/${last}`, { entries }))
  // This week's wages aren't due yet.
  await ok(owner.put(`${C}/wages/${monday}`, { entries: [{ name: 'Today Jo', entry_type: 'fixed', total: 90 }] }))
  let d = await feed(owner, '&time=10:00')
  assert.equal(wages(d).length, 1)
  const [w] = wages(d)
  assert.equal(w.key, 'wages:' + last)
  assert.equal(w.area, 'wages')
  assert.equal(w.group, 'late')
  assert.equal(w.detail, '£110.00 cash still to pay · 2 people', 'Jo 60 and Sam 50; Lee is paid by bank')
  assert.deepEqual(w.action, { form: 'wages', label: 'Pay wages', ref: { week: last } })
  assert.equal(w.can_act, true)

  // Paid in cash: gone.
  await ok(owner.put(`${C}/wages/${last}`, { entries: entries.map((e, i) => ({ ...e, cash_amount: [100, 50, 0][i] })) }))
  d = await feed(owner, '&time=10:00')
  assert.equal(wages(d).length, 0)
})

test('another group\'s venue is refused; bad input is a 400', async () => {
  const other = as(B.owner, ids.b)
  assert.equal((await other.get(`/api/ops/today?venue_id=${V}`)).status, 404)
  assert.equal((await owner.get(`/api/ops/today?venue_id=${V}&date=2026-02-31`)).status, 400)
  assert.equal((await owner.get(`/api/ops/today?venue_id=${V}&time=25:00`)).status, 400)
  const none = await other.get('/api/ops/today')
  assert.equal(none.status, 404, 'a group with no venues yet')
})

// The week ahead (summary.local): the forecast per day and the local news
// from Local info, read through its route as the person, for this venue (its
// own items and the whole group's), never another venue's or hidden ones.
test('the week ahead: the forecast and the headlines from Local info', async () => {
  const day = n => addDays(today, n)
  await sql`DELETE FROM local_info_items WHERE tenant_id = ${ids.a}`
  const [src] = await sql`SELECT id FROM local_info_sources WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND kind = 'weather' LIMIT 1`
  assert.ok(src, 'the fixtures\' weather capture')
  const weather = (venue, n, code, { severity = 'info', rain = 0 } = {}) => sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, details, starts_on, severity, data, external_key)
    VALUES (${ids.a}, ${venue}, ${venue === V ? src.id : null}, 'weather', ${weatherText(code)}, ${'Wk details ' + n},
            ${day(n)}, ${severity}, ${sql.json({ weather_code: code, temp_min: 4.4, temp_max: 11.6, precip_mm: rain, wind_kph: 12 })},
            ${'weather:' + day(n) + ':' + venue})`
  await weather(V, 0, 61)
  await weather(V, 1, 95, { severity: 'warning', rain: 22 })
  await weather(V, 3, 0)
  await weather(V, 8, 3)                        // after the week
  await weather(V2, 0, 75, { severity: 'warning' })   // another venue's
  const add = body => ok(owner.post('/api/local-info/items', body))
  await add({ venue_id: V, kind: 'traffic', title: 'Wk roadworks', starts_on: day(-3), ends_on: day(10), severity: 'notice', url: 'https://roads.test/works', place: 'High St' })
  await add({ venue_id: null, kind: 'events', title: 'Wk food festival', starts_on: day(2), severity: 'notice', time_text: '11:00' })
  for (const t of ['Wk market D', 'Wk market B', 'Wk market A', 'Wk market C']) await add({ venue_id: V, kind: 'events', title: t, starts_on: day(4) })
  await add({ venue_id: V2, kind: 'events', title: 'Wk Hertford parade', starts_on: day(1) })
  await add({ venue_id: V, kind: 'events', title: 'Wk too late', starts_on: day(9) })
  const hidden = await add({ venue_id: V, kind: 'events', title: 'Wk hidden gig', starts_on: day(2) })
  await ok(owner.patch('/api/local-info/items/' + hidden.id, { hidden: true }))

  // Only web addresses: a javascript: or data: link is refused, typed or edited.
  assert.equal((await owner.post('/api/local-info/items', { venue_id: V, title: 'Wk bad', starts_on: day(1), url: 'javascript:alert(1)' })).status, 400)
  assert.equal((await owner.post('/api/local-info/items', { venue_id: V, title: 'Wk bad', starts_on: day(1), url: 'data:text/html,hi' })).status, 400)
  assert.equal((await owner.patch('/api/local-info/items/' + hidden.id, { url: 'JavaScript:alert(1)' })).status, 400)

  const w = (await feed(owner, '&time=10:00')).summary.local
  assert.equal(w.from, today)
  assert.equal(w.to, day(6))
  assert.deepEqual(w.weather.map(x => [x.date, x.title, x.severity]), [
    [day(0), 'Light rain', 'info'], [day(1), 'Thunderstorm', 'warning'], [day(3), 'Clear', 'info'],
  ], 'one forecast a day for this venue, none after the week')
  assert.equal(w.weather[1].precip_mm, 22)
  assert.equal(w.weather[1].code, 95)
  assert.equal(w.weather[0].temp_max, 11.6)
  assert.equal(w.weather[0].details, 'Wk details 0')
  assert.deepEqual(w.headlines.map(h => [h.day, h.title]), [
    [day(0), 'Wk roadworks'], [day(2), 'Wk food festival'],
    [day(4), 'Wk market A'], [day(4), 'Wk market B'], [day(4), 'Wk market C'],
  ], 'by the day each first shows, five at most')
  assert.equal(w.more, 1, 'market D is counted, not listed')
  const road = w.headlines[0]
  assert.equal(road.starts_on, day(-3))
  assert.equal(road.ends_on, day(10))
  assert.equal(road.url, 'https://roads.test/works')
  assert.equal(road.place, 'High St')
  assert.equal(road.kind, 'traffic')
  assert.equal(w.headlines[1].venue_wide, true, 'a whole-group event')
  assert.equal(w.headlines[1].time_text, '11:00')

  // Another day's feed: the week from that day.
  const later = (await feed(owner, `&date=${day(2)}`)).summary.local
  assert.equal(later.from, day(2))
  assert.deepEqual(later.weather.map(x => x.date), [day(3), day(8)], 'day 8 is in that week')
  assert.deepEqual(later.headlines.slice(0, 2).map(h => [h.day, h.title]), [[day(2), 'Wk roadworks'], [day(2), 'Wk food festival']])

  // The other venue sees its own.
  const there = (await ok(owner.get(`/api/ops/today?venue_id=${V2}&time=10:00`))).summary.local
  assert.deepEqual(there.weather.map(x => x.title), ['Heavy snow'])
  assert.deepEqual(there.headlines.map(h => h.title), ['Wk Hertford parade', 'Wk food festival'])

  // A viewer has Local info View: they see it; a role without Local info doesn't.
  assert.ok((await feed(as(A.viewer, ids.a))).summary.local, 'a viewer sees the week')
  const roles = await ok(owner.get('/api/access/roles'))
  const op = roles.find(r => r.key === 'operator')
  try {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...op.permissions, local_info: 'none' } }))
    const d = await feed(as(A.operator, ids.a))
    assert.equal(d.summary.local, undefined, 'no Local info: no week ahead')
    assert.ok(!(d.not_included || []).includes('local_info'), 'not an area of tasks')
  } finally {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: op.permissions }))
  }
  await sql`DELETE FROM local_info_items WHERE tenant_id = ${ids.a} AND title LIKE 'Wk %'`
})

// Migration 227: the Today link is for every role. A custom role names only
// the modules it has, so a Supervisor without the Overview (module dashboard)
// lost Today too while the link was tied to it.
test('Today is in every role\'s menu, even a role without the Overview', async () => {
  const links = nodes => nodes.flatMap(n => [...(n.route ? [n.route] : []), ...links(n.children || [])])
  const role = await ok(owner.post('/api/access/roles', {
    key: 'supervisor', label: 'Supervisor', permissions: { food_safety: 'manage', checklists: 'manage' },
  }))
  await sql`UPDATE users SET custom_role_id = ${role.id} WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.operator}`
  const sup = as(A.operator, ids.a)
  const menu = async () => links((await ok(sup.get('/api/me'))).nav_tree)
  const me = await ok(sup.get('/api/me'))
  assert.equal(me.permissions.dashboard, 'none', 'no Overview for the Supervisor')
  assert.ok(!(await menu()).includes('/'), 'the Overview link is hidden from them')
  assert.ok((await menu()).includes('/today'), 'a new group\'s menu: Today is there')
  const d = await feed(sup)
  assert.ok(d.not_included.includes('cash'), 'their feed names the areas they can\'t see')
  assert.ok(!d.not_included.includes('food_safety') && !d.not_included.includes('checklists'), 'food safety and checklists are theirs')

  // A link as migration 221 made it (the Overview's module and hidden
  // roles): hidden from the Supervisor; migration 227 puts it back.
  await sql`UPDATE nav_items SET module = 'dashboard', hidden_role_ids = ARRAY[${role.id}]::uuid[] WHERE tenant_id = ${ids.a} AND route = '/today'`
  assert.ok(!(await menu()).includes('/today'), 'tied to the Overview, as before')
  await sql.unsafe(fs.readFileSync(new URL('../../migrations/227_today_for_everyone.sql', import.meta.url), 'utf8'))
  assert.ok((await menu()).includes('/today'), 'migration 227: there again')
  const [row] = await sql`SELECT module, hidden_role_ids FROM nav_items WHERE tenant_id = ${ids.a} AND route = '/today'`
  assert.equal(row.module, null)
  assert.deepEqual(row.hidden_role_ids, [])
  await sql`UPDATE users SET custom_role_id = NULL WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.operator}`
})
