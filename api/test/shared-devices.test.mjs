// Shared devices and the person switch (Pepper-first step 6a, migration 280):
// a change on a shared device needs a person's PIN first; a till PIN is
// enough for logging checks only; an office PIN person is held to the lower
// of their own role and the signed-in account's; wrong PINs lock that person
// on that device; the switch ends on Lock and when it goes idle; another
// group's device token is not found. The server is the judge throughout.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { PIN_TRIES, ACT_IDLE_SECONDS, DEVICE_HEADER, ACT_HEADER } from '../src/middleware/sharedDevice.js'
import { CHECK_TOOLS } from '../src/ai/chat.js'

let ids, owner, operator, other, V, device, otherDevice, staff, fridge, ownerKey, operatorKey, staffKey

const on = (token, act) => ({ [DEVICE_HEADER]: token, ...(act ? { [ACT_HEADER]: act } : {}) })
const act = (who, person, pin, token = device.token) => who.post('/api/shared-devices/act', { person, pin }, on(token))
const reading = (who, headers, temp = 3) => who.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: fridge.id, temperature_c: temp }, headers)
const issue = (who, headers) => who.post('/api/issues', { title: 'Zqx printer', description: 'jammed', category: 'incident', impact: 'low', urgency: 'low' }, headers)

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  ;[fridge] = await ok(owner.get(`/api/food-safety/equipment?venue_id=${V}`))
  // A member of staff with a till PIN (the till's own route).
  staff = await ok(owner.post(`/api/rota/venues/${V}/staff`, { name: 'Sam Till', pay_type: 'hourly', default_rate: 11 }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staff.id}/pos`, { pin: '4826' }), 'till PIN')
  // The operator sets their own office PIN on their own device.
  await ok(operator.put('/api/shared-devices/my-pin', { pin: '7391' }), 'operator office PIN')
  device = await ok(owner.post('/api/shared-devices', { venue_id: V, name: 'Kitchen tablet' }), 'mark shared')
  const venueB = (await sql`SELECT id FROM venues WHERE tenant_id = ${ids.b} LIMIT 1`)[0]
    ?? (await ok(other.post('/api/venues', { name: 'B Bar', slug: 'b-bar', timezone: 'Europe/London' })))
  otherDevice = await ok(other.post('/api/shared-devices', { venue_id: venueB.id, name: 'B tablet' }))
  const people = await ok(owner.get('/api/shared-devices/people', undefined, on(device.token)))
  const [ownerRow] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.owner}`
  const [operatorRow] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.operator}`
  ownerKey = 'user:' + ownerRow.id
  operatorKey = 'user:' + operatorRow.id
  staffKey = 'staff:' + staff.id
  assert.ok(people.people.some(p => p.key === staffKey && p.pin === 'till'), 'the venue\'s staff with a till PIN')
  assert.ok(people.people.some(p => p.key === operatorKey && p.pin === 'office'), 'people with an office PIN')
  assert.ok(!JSON.stringify(people).includes('pin_hash'), 'no hashes')
})
after(closeApp)

test('only Settings Manage marks a device shared; the token is given once and kept hashed', async () => {
  assert.equal((await operator.post('/api/shared-devices', { venue_id: V, name: 'Bar' })).status, 403)
  assert.match(device.token, /^sd_[0-9a-f]{64}$/)
  const [row] = await sql`SELECT token_hash FROM shared_devices WHERE id = ${device.device.id}`
  assert.notEqual(row.token_hash, device.token)
  const list = await ok(owner.get('/api/shared-devices'))
  assert.ok(list.some(d => d.id === device.device.id && d.venue_name))
  assert.ok(!JSON.stringify(list).includes('token'), 'no token in the list')
  const me = await ok(owner.get('/api/shared-devices/this', undefined, on(device.token)))
  assert.equal(me.device.id, device.device.id)
  assert.equal(me.person, null)
})

test('another group\'s device token is not found', async () => {
  assert.equal((await owner.get('/api/shared-devices/this', undefined, on(otherDevice.token))).status, 404)
  assert.equal((await owner.get('/api/shared-devices/people', undefined, on(otherDevice.token))).status, 404)
  assert.equal((await act(owner, staffKey, '4826', otherDevice.token)).status, 404)
  const res = await issue(owner, on(otherDevice.token))
  assert.equal(res.status, 404)
  assert.equal(res.json.code, 'shared_device_unknown')
  assert.equal((await other.delete('/api/shared-devices/' + device.device.id)).status, 404, 'nor deleted by them')
})

test('a change on a shared device needs a person; a read does not', async () => {
  const res = await issue(owner, on(device.token))
  assert.equal(res.status, 403)
  assert.equal(res.json.code, 'person_needed')
  assert.equal((await owner.get('/api/issues', undefined, on(device.token))).status, 200)
  // The chat's own routes change nothing: no person asked for (refused here for other reasons, never person_needed).
  const chat = await owner.post('/api/ai/chat', { message: 'hi' }, on(device.token))
  assert.notEqual(chat.json?.code, 'person_needed')
})

test('a wrong PIN says nothing about which part was wrong, and locks the person after five', async () => {
  const wrong = await act(owner, staffKey, '1111')
  assert.equal(wrong.status, 403)
  assert.equal(wrong.json.code, 'pin_wrong')
  const nobody = await act(owner, 'staff:00000000-0000-4000-8000-000000000000', '4826')
  assert.equal(nobody.status, 403)
  assert.equal(nobody.json.error, wrong.json.error, 'an unknown name gets the same answer')
  assert.equal((await act(owner, staffKey, '12')).json.error, wrong.json.error, 'nor a malformed PIN')
  // Three wrong so far for the staff member: two more lock them.
  let last
  for (let i = 0; i < PIN_TRIES - 2; i++) last = await act(owner, staffKey, '2222')
  assert.equal(last.json.code, 'pin_locked')
  const right = await act(owner, staffKey, '4826')
  assert.equal(right.status, 429, 'locked even with the right PIN')
  assert.match(right.json.error, /Try again in \d+ minute/)
  // Another person on the device is not locked.
  const opOk = await act(owner, operatorKey, '7391')
  assert.equal(opOk.status, 200)
  await owner.post('/api/shared-devices/lock', {}, on(device.token, opOk.json.token))
  // The lock lasts PIN_LOCK_MINUTES: let it pass.
  await sql`UPDATE shared_device_pin_tries SET locked_until = now() - interval '1 second' WHERE device_id = ${device.device.id}`
  assert.equal((await act(owner, staffKey, '4826')).status, 200)
})

test('a till PIN logs a check, recorded against that person, and nothing else', async () => {
  const sw = await ok(act(owner, staffKey, '4826'))
  assert.match(sw.token, /^sp_/)
  assert.equal(sw.person.kind, 'till')
  const h = on(device.token, sw.token)
  const row = await ok(reading(owner, h))
  assert.equal(row.recorded_by, 'Sam Till', 'logged by the person, not the account')
  const named = await ok(owner.post('/api/food-safety/temp-logs', { venue_id: V, equipment_id: fridge.id, temperature_c: 4, recorded_by: 'Someone Else' }, h))
  assert.equal(named.recorded_by, 'Sam Till', 'the body can\'t name someone else')
  const fix = await ok(owner.patch('/api/food-safety/temp-logs/' + row.id, { corrective_action: 'Moved stock', recorded_by: 'X' }, h))
  assert.equal(fix.recorded_by, 'Sam Till')
  const refused = await issue(owner, h)
  assert.equal(refused.status, 403)
  assert.equal(refused.json.code, 'office_pin_needed')
  const entry = await owner.post('/api/hs-action-log/entries', { venue_id: V, task: 'Fix the door', priority: 'medium' }, h)
  assert.equal(entry.json?.code, 'office_pin_needed', 'an H&S action is not a check')
  // Each change on the device is kept with its person.
  const log = await sql`SELECT person_name, person_kind, route, status FROM shared_device_changes WHERE device_id = ${device.device.id} AND person_kind = 'till' ORDER BY at`
  assert.ok(log.some(l => l.route === '/api/food-safety/temp-logs' && l.status === 200 && l.person_name === 'Sam Till'))
  assert.ok(log.some(l => l.route === '/api/issues' && l.status === 403))
  // Pepper's Confirm: a till PIN answers a check card only.
  const [conv] = await sql`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt, title, model_tier)
    VALUES (${ids.a}, 'staff_chat', ${A.owner}, 'o@test.local', 'test', 'Device chat', 'fast') RETURNING id`
  const card = async tool => (await sql`
    INSERT INTO ai_pending_actions (tenant_id, conversation_id, tool_use_id, tool, input, card, expires_at)
    VALUES (${ids.a}, ${conv.id}, ${'toolu_' + tool}, ${tool}, ${sql.json({})}, ${sql.json({ title: tool, lines: [] })}, now() + interval '30 minutes')
    RETURNING id`)[0].id
  const rota = await owner.post(`/api/ai/actions/${await card('set_rota')}/confirm`, {}, h)
  assert.equal(rota.json?.code, 'office_pin_needed')
  assert.ok(CHECK_TOOLS.has('log_temperature'))
  const check = await owner.post(`/api/ai/actions/${await card('log_temperature')}/confirm`, {}, h)
  assert.notEqual(check.json?.code, 'office_pin_needed', 'a check card passes the device check')
  await owner.post('/api/shared-devices/lock', {}, h)
})

test('an office PIN person can\'t do more than their own role, nor more than the account', async () => {
  const sw = await ok(act(owner, operatorKey, '7391'))
  assert.equal(sw.person.kind, 'office')
  const h = on(device.token, sw.token)
  // The operator may view Pepper's settings but not change them; the owner account may.
  const res = await owner.patch('/api/ai/settings', { chat_retention_days: 90 }, h)
  assert.equal(res.status, 403, 'not beyond the person\'s role')
  // Their own everyday work goes through, recorded under their name, not the account's.
  const row = await ok(reading(owner, h, 2))
  assert.equal(row.recorded_by, A.operator + '@test.local')
  const entry = await ok(owner.post('/api/hs-action-log/entries', { venue_id: V, task: 'Zqx shelf', priority: 'low' }, h))
  assert.equal(entry.created_by, A.operator + '@test.local', 'the H&S action\'s "created by" is the person')
  await ok(owner.post('/api/shared-devices/lock', {}, h))
  // The owner as the person, on a device signed in as the operator: never more than the account.
  await ok(owner.put('/api/shared-devices/my-pin', { pin: '6274' }))
  const sw2 = await ok(act(operator, ownerKey, '6274'))
  const h2 = on(device.token, sw2.token)
  assert.equal((await operator.patch('/api/ai/settings', { chat_retention_days: 90 }, h2)).status, 403, 'not beyond the account')
  assert.equal((await owner.patch('/api/ai/settings', { chat_retention_days: 90 }, h2)).status, 200, 'the owner as the owner')
  // The task log names the person: a Today task snoozed as the owner on the operator's login.
  const feed = await ok(operator.get(`/api/ops/today?venue_id=${V}&time=10:00`))
  const task = feed.tasks.find(t => t.can_change)
  assert.ok(task, 'a task the operator can change')
  {
    await ok(operator.post('/api/ops/tasks', { venue_id: V, key: task.key, action: 'snooze', minutes: 30 }, h2))
    const [log] = await sql`SELECT by_name, by_sub FROM ops_task_log WHERE tenant_id = ${ids.a} AND task_key = ${task.key} ORDER BY at DESC LIMIT 1`
    assert.equal(log.by_sub, A.owner, 'the person, not the account')
  }
  await ok(owner.post('/api/shared-devices/lock', {}, h2))
})

test('the switch ends on Lock and when it goes idle', async () => {
  const sw = await ok(act(owner, staffKey, '4826'))
  const h = on(device.token, sw.token)
  assert.equal((await reading(owner, h)).status, 200)
  assert.equal((await ok(owner.get('/api/shared-devices/this', undefined, h))).person.name, 'Sam Till')
  await sql`UPDATE shared_device_people SET last_used_at = now() - make_interval(secs => ${ACT_IDLE_SECONDS + 5}) WHERE device_id = ${device.device.id} AND ended_at IS NULL`
  const idle = await reading(owner, h)
  assert.equal(idle.status, 403)
  assert.equal(idle.json.code, 'person_needed', 'idle too long')
  assert.equal((await ok(owner.get('/api/shared-devices/this', undefined, h))).person, null)
  const sw2 = await ok(act(owner, staffKey, '4826'))
  const h2 = on(device.token, sw2.token)
  assert.equal((await ok(owner.post('/api/shared-devices/still-here', {}, h2))).person.name, 'Sam Till')
  await ok(owner.post('/api/shared-devices/lock', {}, h2))
  assert.equal((await reading(owner, h2)).json.code, 'person_needed', 'locked')
  // A new switch ends the one before.
  const a1 = await ok(act(owner, staffKey, '4826'))
  const a2 = await ok(act(owner, operatorKey, '7391'))
  assert.equal((await reading(owner, on(device.token, a1.token))).json.code, 'person_needed')
  assert.equal((await reading(owner, on(device.token, a2.token))).status, 200)
  await ok(owner.post('/api/shared-devices/lock', {}, on(device.token, a2.token)))
})

test('stop sharing: Settings Manage or the person who shared it, also on the device itself', async () => {
  const admin = as(A.admin, ids.a)
  const mark = (who, name) => ok(who.post('/api/shared-devices', { venue_id: V, name }), 'mark ' + name)
  const stop = (who, d, headers) => who.delete('/api/shared-devices/' + d.device.id, undefined, headers)
  const gone = async d => (await sql`SELECT 1 FROM shared_devices WHERE id = ${d.device.id}`).length === 0

  // The owner's own phone, marked shared, stopped from that phone: the owner
  // has no office PIN (none can be set on a shared device), and the account
  // signed in on it may stop it.
  await ok(owner.delete('/api/shared-devices/my-pin'), 'the owner without an office PIN')
  const phone = await mark(owner, 'Owner phone')
  assert.equal((await ok(owner.get('/api/shared-devices/this', undefined, on(phone.token)))).can_stop, true)
  const fromItself = await stop(owner, phone, on(phone.token))
  assert.equal(fromItself.status, 200, JSON.stringify(fromItself.json))
  assert.ok(await gone(phone))

  // ...also with a till PIN person switched in on it.
  const pass = await mark(owner, 'Pass phone')
  const till = await ok(act(owner, staffKey, '4826', pass.token))
  assert.equal((await stop(owner, pass, on(pass.token, till.token))).status, 200)
  assert.ok(await gone(pass))

  // The person who shared it, whatever their role is now.
  const bar = await mark(admin, 'Bar tablet')
  await sql`UPDATE users SET role = 'operator' WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  try {
    const list = await ok(operator.get('/api/shared-devices'))
    assert.equal(list.find(d => d.id === bar.device.id).can_stop, false, 'not the operator\'s to stop')
    assert.equal((await stop(operator, bar)).status, 403, 'Settings View, not theirs')
    // The operator's office PIN on the device: their own role still can't.
    const sw = await ok(act(operator, operatorKey, '7391', bar.token))
    assert.equal((await stop(operator, bar, on(bar.token, sw.token))).status, 403)
    await ok(operator.post('/api/shared-devices/lock', {}, on(bar.token, sw.token)))
    assert.equal((await stop(admin, bar)).status, 200, 'the person who shared it')
    assert.ok(await gone(bar))
  } finally {
    await sql`UPDATE users SET role = 'admin' WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.admin}`
  }

  // Another group's device is not found.
  assert.equal((await stop(other, device)).status, 404)
})

test('an office PIN is set on the person\'s own device only, never too easy, never shown', async () => {
  assert.equal((await operator.put('/api/shared-devices/my-pin', { pin: '1234' })).status, 422, 'digits in a row')
  assert.equal((await operator.put('/api/shared-devices/my-pin', { pin: '12' })).status, 400)
  const sw = await ok(act(owner, operatorKey, '7391'))
  const onDevice = await owner.put('/api/shared-devices/my-pin', { pin: '8402' }, on(device.token, sw.token))
  assert.equal(onDevice.status, 409, 'not on a shared device')
  const mine = await ok(operator.get('/api/shared-devices/my-pin'))
  assert.equal(mine.set, true)
  assert.ok(!('pin_hash' in mine))
  await ok(owner.post('/api/shared-devices/lock', {}, on(device.token, sw.token)))
  // An account with an office PIN of its own proves it is them on the device
  // before stopping it: nobody switched in is asked who they are.
  await ok(owner.put('/api/shared-devices/my-pin', { pin: '5928' }), 'owner office PIN')
  const del = await owner.delete('/api/shared-devices/' + device.device.id, undefined, on(device.token))
  assert.equal(del.json?.code, 'person_needed')
  const till = await ok(act(owner, staffKey, '4826'))
  assert.equal((await owner.delete('/api/shared-devices/' + device.device.id, undefined, on(device.token, till.token))).json?.code, 'office_pin_needed')
  const [ownerRow] = await sql`SELECT id FROM users WHERE tenant_id = ${ids.a} AND auth0_user_id = ${A.owner}`
  const me = await ok(act(owner, 'user:' + ownerRow.id, '5928'))
  await ok(owner.delete('/api/shared-devices/' + device.device.id, undefined, on(device.token, me.token)), 'the owner with their PIN')
})
