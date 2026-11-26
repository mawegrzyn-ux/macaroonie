// Combined tables on the till (migration 297, shared/pos/tables.js) through
// the real routes and the cloud's sequencer: check.tables_joined and
// check.tables_split from a till, the joined tables beside the check
// (pos_checks.joined_table_ids), a table another open check holds refused
// until that check is merged in, no second check on a joined table, another
// tenant's table and counter and kiosk orders refused, the tables freed when
// the check closes, and the names everything else reads: the kitchen order,
// the admin's check list and the reports' Tables field (the bill is in
// shared/pos/test/tables.test.mjs). The
// till's config carries bookings' table combinations for the Combine window.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { runner, rowsOf, measures } from './support/reports.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'
import { checkTotals } from '../../shared/pos/pricing.js'

let ids, owner, V, dish, till, kiosk, server, boss, T1, T2, T3, theirTable, run
let number = 700

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
const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: server, ...extra })
async function send(events, from = till) {
  const r = await device(from, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  return r.json.results
}
const one = async (type, payload, extra) => (await send([ev(type, payload, extra)]))[0]
const accepted = async (type, payload, extra) => {
  const r = await one(type, payload, extra)
  assert.ok(r.ok, type + ': ' + r.error)
  return r
}
const line = (price = 1000) => ({ id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: price, modifiers: [], vat_rate: 20 })
const openOn = async (tableId, extra = {}) => {
  const id = ulid()
  await accepted('check.opened', { mode: 'table', table_id: tableId, covers: 2, number: ++number, ...extra }, { check_id: id })
  return id
}
const row = async id => (await sql`SELECT table_id, joined_table_ids, status, state FROM pos_checks WHERE id = ${id}`)[0]
const stateOf = async id => (await device(till, 'GET', '/pos-api/checks/' + id)).json
const payAndClose = async id => {
  const { balance } = checkTotals(await stateOf(id))
  if (balance > 0) await accepted('payment.added', { payment: { id: ulid(), tender: 'cash', amount: balance } }, { check_id: id })
  await accepted('check.closed', {}, { check_id: id })
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  const theirs = await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  run = runner(ids.a)
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  server = filled.ids.staff
  boss = filled.ids.staff2
  // The server's role allows nothing (combining asks for nothing); the boss may merge checks.
  const plain = await ok(owner.post('/api/pos/roles', { name: 'Zqt Server', permissions: {} }))
  const lead = await ok(owner.post('/api/pos/roles', { name: 'Zqt Lead', permissions: { transfer: true, reopen: true, manager: true } }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${server}/pos`, { pos_role_id: plain.id, pin: '4826' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${boss}/pos`, { pos_role_id: lead.id, pin: '7351' }))
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqt Till' })
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Zqt Kiosk' })
  const tables = await sql`SELECT id, label FROM tables WHERE tenant_id = ${ids.a} AND venue_id = ${V} AND label IN ('T1', 'T2', 'T3')`
  const byLabel = Object.fromEntries(tables.map(t => [t.label, t.id]))
  ;[T1, T2, T3] = [byLabel.T1, byLabel.T2, byLabel.T3]
  assert.ok(T1 && T2 && T3, 'the fixtures\' tables')
  ;[{ id: theirTable }] = await sql`SELECT id FROM tables WHERE tenant_id = ${ids.b} LIMIT 1`
})
after(closeApp)

test('the till\'s config carries bookings\' table combinations whose tables it has', async () => {
  const cfg = (await device(till, 'GET', '/pos-api/config')).json
  const combo = cfg.table_combinations.find(c => c.name === 'T1+T2')
  assert.ok(combo, JSON.stringify(cfg.table_combinations))
  assert.deepEqual([...combo.table_ids].sort(), [T1, T2].sort())
  assert.deepEqual(Object.keys(combo).sort(), ['id', 'name', 'table_ids'])
  // A combination with a table switched off isn't offered.
  await sql`UPDATE tables SET is_active = false WHERE id = ${T2}`
  try {
    const without = (await device(till, 'GET', '/pos-api/config')).json
    assert.equal(without.table_combinations.some(c => c.name === 'T1+T2'), false)
  } finally {
    await sql`UPDATE tables SET is_active = true WHERE id = ${T2}`
  }
})

test('join and split: the events go through the till API, and the joined tables sit beside the check', async () => {
  const a = await openOn(T1)
  await accepted('check.tables_joined', { table_ids: [T2] }, { check_id: a })
  let r = await row(a)
  assert.equal(r.table_id, T1)
  assert.deepEqual(r.joined_table_ids, [T2])
  assert.deepEqual(r.state.joined_table_ids, [T2])
  assert.deepEqual((await stateOf(a)).joined_table_ids, [T2])
  const sync = (await device(till, 'GET', '/pos-api/sync?since=0')).json
  assert.deepEqual(sync.checks.find(c => c.id === a).joined_table_ids, [T2], 'devices get it with the check')

  // No second check on the joined table, and none moves there.
  const second = await one('check.opened', { mode: 'table', table_id: T2, number: ++number }, { check_id: ulid() })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'table_held')
  assert.match(second.error, /Table T2 is combined with another order/)
  const b = await openOn(T3)
  assert.equal((await one('check.table_moved', { table_id: T2 }, { check_id: b })).code, 'table_held')
  // The refusal is kept (a conflict for a manager), and nothing was written.
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM pos_event_rejections WHERE tenant_id = ${ids.a} AND code = 'table_held'`
  assert.equal(n, 2)

  await accepted('check.tables_split', { table_ids: [T2] }, { check_id: a })
  r = await row(a)
  assert.deepEqual(r.joined_table_ids, [])
  assert.ok(!('joined_table_ids' in r.state), 'no empty list in the check\'s state')
  assert.equal((await one('check.tables_split', { table_ids: [T2] }, { check_id: a })).code, 'missing')
  // Split off, the table takes the other check.
  await accepted('check.table_moved', { table_id: T2 }, { check_id: b })
  await accepted('check.closed', {}, { check_id: a })
  await accepted('check.closed', {}, { check_id: b })
})

test('a table with its own open check: refused until that check is merged in, then it joins', async () => {
  const a = await openOn(T1)
  const b = await openOn(T3)
  await accepted('line.added', { line: line(1200) }, { check_id: b })
  const held = await one('check.tables_joined', { table_ids: [T3] }, { check_id: a })
  assert.equal(held.code, 'table_held')
  assert.equal(held.error, 'Table T3 has an open order: merge it into this one first')
  // Merging keeps its own permission (Move items between checks): the server's role hasn't it.
  assert.equal((await one('check.merged', { into_check_id: a }, { check_id: b })).code, 'permission')
  // The till's Combine sends both in one go, with the manager's approval on the merge.
  const both = await send([
    ev('check.merged', { into_check_id: a }, { check_id: b, approved_by: boss }),
    ev('check.tables_joined', { table_ids: [T3, T2] }, { check_id: a }),
  ])
  assert.ok(both.every(r => r.ok), JSON.stringify(both))
  const r = await row(a)
  assert.deepEqual(r.joined_table_ids, [T3, T2])
  assert.equal(r.state.lines.length, 1)
  assert.equal(r.state.covers, 4)
  const merged = await row(b)
  assert.equal(merged.status, 'merged')
  assert.deepEqual(merged.joined_table_ids, [])

  // The admin's check list (and Pepper's till_checks, which reads it) calls it the same.
  const open = await ok(owner.get(`/api/pos/venues/${V}/checks?status=open`))
  const listed = open.find(c => c.id === a)
  assert.equal(listed.table_label, 'T1 + T3 + T2')
  assert.deepEqual(listed.joined_table_ids, [T3, T2])
  // Reports: the Tables field and how many it held.
  const res = await run({ subject: 'till.checks', rows: ['tables', 'tables_held'], values: measures(['open_checks']), filters: [{ field: 'status', op: 'is', value: 'open' }] })
  assert.deepEqual(rowsOf(res).map(x => [x.tables, x.tables_held, x.open_checks]), [['T1 + T3 + T2', 3, 1]])

  // Moving the party to a joined table: that one is the main table now, the old one is free.
  await accepted('check.table_moved', { table_id: T2 }, { check_id: a })
  assert.deepEqual([(await row(a)).table_id, (await row(a)).joined_table_ids], [T2, [T3]])
  const onOld = await openOn(T1)
  await accepted('check.closed', {}, { check_id: onOld })

  // Paid and closed: every table is free, and the closed check still says what it held.
  await payAndClose(a)
  const closed = await row(a)
  assert.equal(closed.status, 'closed')
  assert.deepEqual(closed.joined_table_ids, [T3])
  const next = await openOn(T3)
  await accepted('check.tables_joined', { table_ids: [T2] }, { check_id: next })
  // Reopened, the first check gets back only what nobody else holds: nothing here.
  await accepted('check.reopened', { reason: 'Zqt wrong tender' }, { check_id: a, staff_id: boss })
  assert.deepEqual((await row(a)).joined_table_ids, [])
  const closedList = await ok(owner.get(`/api/pos/venues/${V}/checks?status=open`))
  assert.equal(closedList.find(c => c.id === next).table_label, 'T3 + T2')
  await accepted('check.closed', {}, { check_id: next })
  await payAndClose(a)
})

test('refused: another tenant\'s table, a table that doesn\'t exist, the main table, a tab, a counter order and a kiosk', async () => {
  const a = await openOn(T1)
  const theirs = await one('check.tables_joined', { table_ids: [theirTable] }, { check_id: a })
  assert.equal(theirs.code, 'table')
  assert.match(theirs.error, /isn't one of this location's/)
  assert.equal((await one('check.tables_joined', { table_ids: ['11111111-2222-4333-8444-555555555555'] }, { check_id: a })).code, 'table')
  assert.equal((await one('check.tables_joined', { table_ids: [T1] }, { check_id: a })).code, 'invalid')
  assert.equal((await one('check.tables_joined', { table_ids: [] }, { check_id: a })).code, 'invalid')
  assert.equal((await one('check.tables_joined', { table_ids: [T2, T2] }, { check_id: a })).code, 'invalid')
  assert.deepEqual((await row(a)).joined_table_ids, [])

  const tab = ulid()
  await accepted('check.opened', { mode: 'tab', tab_name: 'Zqt Smith', number: ++number }, { check_id: tab })
  assert.equal((await one('check.tables_joined', { table_ids: [T2] }, { check_id: tab })).code, 'no_table')
  const counter = ulid()
  await accepted('check.opened', { mode: 'counter', number: ++number, order_no: 41 }, { check_id: counter })
  assert.equal((await one('check.tables_joined', { table_ids: [T2] }, { check_id: counter })).code, 'no_table')

  // A kiosk's own order: a kiosk sends only the events a kiosk may.
  const kioskCheck = ulid()
  const opened = await send([{ ...ev('check.opened', { mode: 'counter', number: 1, order_no: 901 }, { check_id: kioskCheck }), staff_id: kiosk.id }], kiosk)
  assert.ok(opened[0].ok, opened[0].error)
  const fromKiosk = await send([{ ...ev('check.tables_joined', { table_ids: [T2] }, { check_id: kioskCheck }), staff_id: kiosk.id }], kiosk)
  assert.equal(fromKiosk[0].ok, false)
  assert.equal(fromKiosk[0].code, 'kiosk')
  assert.deepEqual((await row(kioskCheck)).joined_table_ids, [])

  for (const id of [a, tab, counter]) await accepted('check.closed', {}, { check_id: id })
})

test('the kitchen order follows the join: its table says both', async () => {
  const stations = await sql`SELECT count(*)::int AS n FROM kds_stations WHERE tenant_id = ${ids.a} AND venue_id = ${V}`
  if (!stations[0].n) await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Zqt Grill', kind: 'prep' }))
  const a = await openOn(T1)
  const l = line(900)
  await accepted('line.added', { line: l }, { check_id: a })
  await accepted('lines.sent', { send_id: ulid(), line_ids: [l.id] }, { check_id: a })
  const [before] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND check_id = ${a}`
  assert.ok(before, 'the kitchen has the order')
  assert.equal(before.state.table, 'T1')
  await accepted('check.tables_joined', { table_ids: [T2] }, { check_id: a })
  const [joined] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND check_id = ${a}`
  assert.equal(joined.state.table, 'T1 + T2')
  await accepted('check.tables_split', { table_ids: [T2] }, { check_id: a })
  const [split] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND check_id = ${a}`
  assert.equal(split.state.table, 'T1')
  await payAndClose(a)
})
