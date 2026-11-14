// The till fixes of 14 Nov 2026 (migration 246), through the real routes and
// the cloud's sequencer: seats on or off per revenue stream; a till's own
// settings for seats, Send on a counter till, items not sent at Pay, tables,
// the phone list and dish counts; the location's layout for tills on
// phones; typing a discount as a till role's permission; and the migration
// on data written before it. Also (the phone till improvements, the same
// day): what a swipe left on a table's row does first, asking before leaving
// an order with items not sent, and taking one off a counted dish.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, viewer, other, V, VB, till, dish, staffA, staffB

async function device(d, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: `Device ${d.device_id}.${d.secret}`,
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const config = async () => {
  const r = await device(till, 'GET', '/pos-api/config')
  assert.equal(r.status, 200, r.body)
  return r.json
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const theirs = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  VB = theirs.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  staffA = filled.ids.staff
  staffB = filled.ids.staff2
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqf Till' })
})
after(closeApp)

test('seats: a switch of their own on each revenue stream, saved, listed and in the till\'s config', async () => {
  const plain = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqf Restaurant' }))
  assert.deepEqual([plain.covers, plain.courses, plain.seats], ['ask', true, true], 'a new stream asks for guests, uses courses and seats')
  const noSeats = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqf Bar', covers: 'ask', courses: false, seats: false }))
  assert.deepEqual([noSeats.covers, noSeats.courses, noSeats.seats], ['ask', false, false], 'guests asked, without seats or courses')
  const changed = await ok(owner.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqf Restaurant', covers: 'must', courses: true, seats: false }))
  assert.equal(changed.seats, false)
  assert.equal((await owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqf Bad', seats: 'yes' })).status, 400)
  assert.equal((await viewer.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqf Restaurant', seats: true })).status, 403)
  assert.equal((await other.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqf Restaurant', seats: true })).status, 404)
  const [row] = await sql`SELECT seats, covers FROM pos_revenue_streams WHERE id = ${plain.id}`
  assert.deepEqual([row.seats, row.covers], [false, 'must'])
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const listed = Object.fromEntries(setup.revenue_streams.map(r => [r.name, r.seats]))
  assert.equal(listed['Zqf Restaurant'], false)
  assert.equal(listed['Zqf Bar'], false)
  const cfg = await config()
  const inConfig = Object.fromEntries(cfg.revenue_streams.map(r => [r.name, [r.seats, r.covers, r.courses]]))
  assert.deepEqual(inConfig['Zqf Restaurant'], [false, 'must', true])
  assert.deepEqual(inConfig['Zqf Bar'], [false, 'ask', false])
  await ok(owner.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqf Restaurant', covers: 'ask', courses: true, seats: true }))
  const [back] = await sql`SELECT seats FROM pos_revenue_streams WHERE id = ${plain.id}`
  assert.equal(back.seats, true)
})

test('a till\'s own settings: seats, Send on a counter till, items not sent at Pay, tables, the phone list and dish counts', async () => {
  const table = { mode: 'table', seats: 'off', unsent_at_pay: 'send', tables: false, phone_tables: 'list', item_counts: true }
  const saved = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: table }))
  for (const [k, v] of Object.entries(table)) assert.equal(saved.settings[k], v, k)
  let cfg = await config()
  for (const [k, v] of Object.entries(table)) assert.equal(cfg.device.settings[k], v, 'in the till\'s config: ' + k)
  // A counter till's Send button.
  const counter = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'counter', counter_send: true } }))
  assert.equal(counter.settings.counter_send, true)
  cfg = await config()
  assert.equal(cfg.device.settings.counter_send, true)
  // Values the settings don't take.
  for (const bad of [{ seats: 'maybe' }, { unsent_at_pay: 'later' }, { phone_tables: 'grid' }, { tables: 'no' }, { item_counts: 'yes' }, { counter_send: 1 }]) {
    assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', ...bad } })).status, 400, JSON.stringify(bad))
  }
  assert.equal((await viewer.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table' } })).status, 403)
  assert.equal((await other.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table' } })).status, 404)
  // Back to a plain table-service till: none of them (the defaults).
  const plain = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table' } }))
  for (const k of ['seats', 'counter_send', 'unsent_at_pay', 'tables', 'phone_tables', 'item_counts']) assert.equal(plain.settings[k], undefined, k)
})

test('a till\'s own settings for a phone and for leaving an order: swipe left fires first, ask before leaving with items not sent, take one off a counted dish', async () => {
  const s = { mode: 'table', phone_tables: 'list', swipe_left: 'fire', leave_unsent: 'ask', item_counts: true, count_take_off: true }
  const saved = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: s }))
  for (const [k, v] of Object.entries(s)) assert.equal(saved.settings[k], v, k)
  const cfg = await config()
  for (const [k, v] of Object.entries(s)) assert.equal(cfg.device.settings[k], v, 'in the till\'s config: ' + k)
  const [row] = await sql`SELECT settings FROM pos_devices WHERE id = ${till.id}`
  assert.deepEqual([row.settings.swipe_left, row.settings.leave_unsent, row.settings.count_take_off], ['fire', 'ask', true])
  // Values the settings don't take.
  for (const bad of [{ swipe_left: 'pay' }, { swipe_left: true }, { leave_unsent: 'send' }, { leave_unsent: 1 }, { count_take_off: 'yes' }]) {
    assert.equal((await owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', ...bad } })).status, 400, JSON.stringify(bad))
  }
  const other_way = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', swipe_left: 'send', leave_unsent: 'leave', count_take_off: false } }))
  assert.deepEqual([other_way.settings.swipe_left, other_way.settings.leave_unsent, other_way.settings.count_take_off], ['send', 'leave', false])
  assert.equal((await viewer.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', leave_unsent: 'ask' } })).status, 403)
  assert.equal((await other.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table', leave_unsent: 'ask' } })).status, 404)
  // Left out: none of them (the defaults: send first, just leave, no taking off).
  const plain = await ok(owner.patch('/api/pos/devices/' + till.id, { settings: { mode: 'table' } }))
  for (const k of ['swipe_left', 'leave_unsent', 'count_take_off']) assert.equal(plain.settings[k], undefined, k)
  assert.equal((await config()).device.settings.leave_unsent, undefined)
})

test('the layout for tills on phones: only a layout made for a phone, in the till\'s config and the uses; gone when it stops being one', async () => {
  const phone = await ok(owner.post('/api/pos/till-layouts', { name: 'Zqf Phone', template: 'phone' }))
  const tablet = await ok(owner.post('/api/pos/till-layouts', { name: 'Zqf Tablet' }))
  const theirs = await ok(other.post('/api/pos/till-layouts', { name: 'Yyc Phone', template: 'phone' }))
  assert.equal(phone.layout.phone, true)
  const notPhone = await owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: tablet.id })
  assert.equal(notPhone.status, 422)
  assert.equal(notPhone.json.code, 'phone_layout')
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: theirs.id })).status, 422, 'another group\'s layout')
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: '00000000-0000-4000-8000-000000000000' })).status, 422)
  assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: 'nope' })).status, 400)
  assert.equal((await viewer.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: phone.id })).status, 403)
  const saved = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: phone.id }))
  assert.equal(saved.phone_layout_id, phone.id)
  // Left out of a later save, it stays.
  const again = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { tips_enabled: true }))
  assert.equal(again.phone_layout_id, phone.id)
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(setup.settings.phone_layout_id, phone.id)
  let cfg = await config()
  assert.equal(cfg.settings.phone_layout_id, phone.id)
  assert.ok(cfg.till_layouts[phone.id], 'the till gets the layout itself')
  assert.equal(cfg.till_layouts[phone.id].phone, true)
  // The list of layouts says where it is used, and that it is for phones.
  const list = await ok(owner.get('/api/pos/till-layouts'))
  const row = list.layouts.find(l => l.id === phone.id)
  assert.deepEqual(row.used_by.venues.map(v => [v.id, v.phone]), [[V, true]])
  // No longer made for a phone: the location goes back to the built-in phone screen.
  const reloaded = await ok(owner.get('/api/pos/till-layouts/' + phone.id))
  await ok(owner.put('/api/pos/till-layouts/' + phone.id, { name: 'Zqf Phone', layout: { ...reloaded.layout, phone: false } }))
  let [s] = await sql`SELECT phone_layout_id FROM pos_settings WHERE venue_id = ${V}`
  assert.equal(s.phone_layout_id, null)
  cfg = await config()
  assert.equal(cfg.settings.phone_layout_id, null)
  // Picked again, then cleared by hand; then deleted while picked.
  await ok(owner.put('/api/pos/till-layouts/' + phone.id, { name: 'Zqf Phone', layout: { ...reloaded.layout, phone: true } }))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: phone.id }))
  const cleared = await ok(owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: null }))
  assert.equal(cleared.phone_layout_id, null)
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { phone_layout_id: phone.id }))
  await ok(owner.delete('/api/pos/till-layouts/' + phone.id));
  [s] = await sql`SELECT phone_layout_id FROM pos_settings WHERE venue_id = ${V}`
  assert.equal(s.phone_layout_id, null)
})

test('typing a discount: the till role\'s Type a discount, up to its limit, checked by the sequencer', async () => {
  const typer = await ok(owner.post('/api/pos/roles', { name: 'Zqf Typer', permissions: { open_discount: true, discount_max_pct: 20 } }))
  const limitOnly = await ok(owner.post('/api/pos/roles', { name: 'Zqf Limit only', permissions: { discount_max_pct: 20 } }))
  const boss = await ok(owner.post('/api/pos/roles', { name: 'Zqf Boss', permissions: { manager: true, open_discount: true, discount_max_pct: 50 } }))
  assert.deepEqual([typer.permissions.open_discount, limitOnly.permissions.open_discount], [true, false])
  const roles = await ok(owner.get('/api/pos/roles'))
  assert.equal(roles.find(r => r.id === typer.id).permissions.open_discount, true)
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staffA}/pos`, { pos_role_id: limitOnly.id, pin: '4826' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staffB}/pos`, { pos_role_id: boss.id, pin: '7351' }))
  const cfg = await config()
  assert.equal(cfg.roles.find(r => r.id === boss.id).permissions.open_discount, true, 'the till knows it')

  const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: staffA, ...extra })
  const send = async events => {
    const r = await device(till, 'POST', '/pos-api/events', { events })
    assert.equal(r.status, 200, r.body)
    return r.json.results
  }
  const check = ulid()
  const opened = await send([
    ev('check.opened', { mode: 'tab', tab_name: 'Zqf', number: Math.floor(Math.random() * 9000) + 1 }, { check_id: check }),
    ev('line.added', { line: { id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 2000, modifiers: [], vat_rate: 20 } }, { check_id: check }),
  ])
  assert.ok(opened.every(r => r.ok), JSON.stringify(opened))
  const typed = (value, extra = {}) => ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value, name: 'Regular' } }, { check_id: check, ...extra })
  // A limit without Type a discount gives nothing: a manager's PIN.
  assert.equal((await send([typed(10)]))[0].code, 'permission')
  assert.ok((await send([typed(10, { approved_by: staffB })]))[0].ok)
  assert.equal((await send([typed(60, { approved_by: staffB })]))[0].code, 'permission', 'beyond the manager\'s own limit')
  // With Type a discount: up to the role's limit.
  await ok(owner.patch('/api/pos/roles/' + limitOnly.id, { name: 'Zqf Limit only', permissions: { open_discount: true, discount_max_pct: 20 } }))
  assert.ok((await send([typed(5)]))[0].ok)
  assert.equal((await send([typed(25)]))[0].code, 'permission')
  // A manager without it can't approve one either.
  await ok(owner.patch('/api/pos/roles/' + boss.id, { name: 'Zqf Boss', permissions: { manager: true, discount_max_pct: 50 } }))
  assert.equal((await send([typed(25, { approved_by: staffB })]))[0].code, 'permission')
  const [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check}`
  assert.deepEqual(row.state.discounts.map(d => d.value), [10, 5])
})

test('migration 246 on data written before it', async () => {
  // Streams that didn't ask for guests, roles with a discount limit and no
  // Type a discount, and a group whose location had "discounts typed in
  // need a manager" on.
  const [streamA] = await sql`SELECT id FROM pos_revenue_streams WHERE tenant_id = ${ids.a} AND venue_id = ${V} ORDER BY sort_order LIMIT 1`
  await sql`UPDATE pos_revenue_streams SET covers = 'off' WHERE id = ${streamA.id}`
  const must = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqf Must', covers: 'must' }))
  const roleOf = async (tenant, name, permissions) => (await sql`
    INSERT INTO pos_roles (tenant_id, name, permissions, sort_order) VALUES (${tenant}, ${name}, ${sql.json(permissions)}, 90) RETURNING id`)[0].id
  const giver = await roleOf(ids.a, 'Zqf Old giver', { void: true, discount_max_pct: 25 })
  const none = await roleOf(ids.a, 'Zqf Old none', { void: true, discount_max_pct: 0 })
  const decided = await roleOf(ids.a, 'Zqf Old decided', { open_discount: false, discount_max_pct: 30 })
  const strict = await roleOf(ids.b, 'Yyc Old giver', { discount_max_pct: 25 })
  await ok(other.patch(`/api/pos/venues/${VB}/settings`, { tips_enabled: true }))
  await sql`UPDATE pos_settings SET approvals = approvals || '{"custom_discount": true}'::jsonb WHERE venue_id = ${VB}`
  await sql`UPDATE pos_settings SET approvals = approvals || '{"custom_discount": false}'::jsonb WHERE venue_id = ${V}`

  const migration = await readFile(new URL('../../migrations/246_till_seats_open_discount.sql', import.meta.url), 'utf8')
  await sql.unsafe(migration)

  const covers = Object.fromEntries((await sql`SELECT id, covers FROM pos_revenue_streams WHERE id IN ${sql([streamA.id, must.id])}`).map(r => [r.id, r.covers]))
  assert.equal(covers[streamA.id], 'ask', 'a stream that didn\'t ask now asks, with a Skip')
  assert.equal(covers[must.id], 'must', 'one that had to stays')
  const perms = Object.fromEntries((await sql`SELECT id, permissions FROM pos_roles WHERE id IN ${sql([giver, none, decided, strict])}`).map(r => [r.id, r.permissions]))
  assert.equal(perms[giver].open_discount, true, 'a role that could give a discount still can')
  assert.equal(perms[giver].void, true, 'the rest of the role is kept')
  assert.equal(perms[none].open_discount, undefined, 'no limit, nothing to type')
  assert.equal(perms[decided].open_discount, false, 'a role already decided is left alone')
  assert.equal(perms[strict].open_discount, false, 'where a location needed a manager, a manager stays needed')
  const approvals = Object.fromEntries((await sql`SELECT venue_id, approvals FROM pos_settings WHERE venue_id IN ${sql([V, VB])}`).map(r => [r.venue_id, r.approvals]))
  assert.equal(approvals[V].custom_discount, undefined)
  assert.equal(approvals[VB].custom_discount, undefined)
  // Run again: nothing changes.
  await sql.unsafe(migration)
  const again = Object.fromEntries((await sql`SELECT id, permissions FROM pos_roles WHERE id IN ${sql([giver, none, strict])}`).map(r => [r.id, r.permissions.open_discount]))
  assert.deepEqual([again[giver], again[none], again[strict]], [true, undefined, false])
  const [cols] = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'pos_revenue_streams' AND column_name = 'seats'`
  assert.equal(cols.n, 1)
})
