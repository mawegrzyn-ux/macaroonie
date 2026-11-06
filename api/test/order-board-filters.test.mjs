// Order ready boards that show only some orders (shared/screenLayout.js
// orderShow() / orderFilter()): the board filters by order type and revenue
// stream name, so the feed a menu screen reads (/screen-api/orders) must say
// each order's stream. Checked here: a till's counter order carries its
// stream and order type to the feed, and follows a change of stream; an
// online order carries the stream set in Ordering setup into the kitchen;
// the screen designer lists the order types and the streams (one per name
// across the locations); the migration turns the old preparing switch into
// the Show setting.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { kitchenOnOnlineOrder } from '../src/services/kitchenSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, V2, dish, till, staffId, takeOut, front, drive

async function call(method, url, body, headers = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body }
}
const device = (d, method, url, body) => call(method, url, body, { authorization: `Device ${d.device_id}.${d.secret}` })
const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: staffId, ...extra })
async function send(events) {
  const r = await device(till, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  assert.ok(r.json.results.every(x => x.ok), JSON.stringify(r.json.results))
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  staffId = filled.ids.staff
  const role = await ok(owner.post('/api/pos/roles', { name: 'Zqf Server', permissions: {} }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${staffId}/pos`, { pos_role_id: role.id, pin: '5937' }))
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqf Till' })
  takeOut = (await ok(owner.get('/api/order-types'))).find(t => t.name === 'Take out')
  front = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqf Front counter' }))
  drive = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqf Drive thru' }))
  // A second location with a stream of the same name, in other letters.
  V2 = (await ok(owner.post('/api/venues', { name: 'Zqf Second', slug: 'zqf-second', timezone: 'Europe/London' }))).id
  await ok(owner.post(`/api/pos/venues/${V2}/revenue-streams`, { name: ' zqf drive THRU ' }))
  // Every dish goes to the wok, so counter orders show on the boards.
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const wok = setup.kds_stations.find(s => s.kind === 'prep')
  await ok(owner.put(`/api/pos/kds-flows/${setup.kds_active_flow_id}`, { links: [{ from: null, to: wok.id, targets: [] }], layout: {} }))
})
after(closeApp)

test('a till\'s counter order carries its stream and order type to a menu screen\'s feed, and follows a change of stream', async () => {
  const check = ulid()
  const l = { id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1000, modifiers: [], vat_rate: 20 }
  await send([
    ev('check.opened', { mode: 'counter', revenue_stream_id: front.id, order_type_id: takeOut.id, number: 1, order_no: 731 }, { check_id: check }),
    ev('line.added', { line: l }, { check_id: check }),
    ev('lines.sent', { send_id: ulid(), line_ids: [l.id], held_course_ids: [] }, { check_id: check }),
  ])
  const p = (await call('POST', '/screen-api/pairings', { device: { width: 1920, height: 1080 } })).json
  const scr = await ok(owner.post('/api/screens/screens/claim', { code: p.code, name: 'Zqf Board', venue_id: V }))
  const tile = async () => {
    const res = await call('GET', '/screen-api/orders', undefined, { authorization: `Screen ${scr.id}.${p.secret}` })
    assert.equal(res.status, 200, res.body)
    return res.json.orders.preparing.find(t => t.number === '731')
  }
  let t = await tile()
  assert.ok(t, 'the order is on the board')
  assert.equal(t.stream, 'Zqf Front counter')
  assert.equal(t.type_name, 'Take out')
  await send([ev('check.stream_set', { revenue_stream_id: drive.id }, { check_id: check })])
  t = await tile()
  assert.equal(t.stream, 'Zqf Drive thru', 'the board follows the check to another stream')
  await ok(owner.delete(`/api/screens/screens/${scr.id}`))
})

test('an online order carries the stream set in Ordering setup into the kitchen', async () => {
  const settings = await ok(owner.get(`/api/orders/settings/${V}`))
  const s = { ...settings.settings, revenue_stream_id: drive.id }
  for (const k of ['venue_id', 'exists', 'tenant_id', 'created_at', 'updated_at', 'hours_extension', 'id']) delete s[k]
  await ok(owner.put(`/api/orders/settings/${V}`, s), 'ordering settings')
  const guest = as(null, null)
  const page = await ok(guest.get(`/order-api/venues/${V}`))
  // A dish that isn't sold out, with its options picked (as a guest would).
  const item = page.menus.flatMap(m => m.sections.flatMap(x => x.items)).find(i => i.price_pence > 0 && !i.sold_out && i.kind !== 'combo')
  assert.ok(item, 'a dish to order')
  const picks = Object.fromEntries((item.choices || []).filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
  const at = (await ok(guest.get(`/order-api/venues/${V}/slots?date=${tomorrow}`))).slots.find(x => x.available)?.at
  assert.ok(at, 'a collection time tomorrow')
  const placed = await guest.post(`/order-api/venues/${V}/orders`, {
    lines: [{ item_id: item.id, qty: 1, choices: picks }], when: at, data_consent: true, payment_method: 'pay_at_venue',
    customer: { name: 'Zqf Guest', email: 'guest@zqf.test', phone: '07700900555' },
  })
  assert.equal(placed.status, 201, placed.body)
  const [order] = await sql`SELECT * FROM orders WHERE public_token = ${placed.json.token}`
  assert.equal(order.revenue_stream_id, drive.id)
  await kitchenOnOnlineOrder({ ...order, status: 'accepted' })
  const [ko] = await sql`SELECT state FROM kds_orders WHERE tenant_id = ${ids.a} AND order_id = ${order.id}`
  assert.ok(ko, 'the order reached the kitchen')
  assert.equal(ko.state.stream, drive.id)
  assert.equal(ko.state.stream_name, 'Zqf Drive thru')
})

test('the screen designer lists the order types and the streams, one per name across the locations', async () => {
  const data = await ok(owner.get('/api/screens/menu-data'))
  assert.ok(data.order_types.includes('Take out'), data.order_types.join())
  const drives = data.order_streams.filter(n => n.trim().toLowerCase() === 'zqf drive thru')
  assert.equal(drives.length, 1, 'one per name, any case or spaces: ' + data.order_streams.join())
  assert.ok(data.order_streams.includes('Zqf Front counter'))
  // Only the group's own.
  const other = await ok(as(B.owner, ids.b).get('/api/screens/menu-data'))
  assert.ok(!other.order_streams.some(n => /zqf/i.test(n)), 'another group sees none of these')
})

test('migration 237: the old preparing switch becomes the Show setting', async () => {
  const migration = await readFile(new URL('../../migrations/237_order_board_show.sql', import.meta.url), 'utf8')
  const layout = {
    blocks: [
      { id: 'a', type: 'order_status', opts: { show_preparing: false, ready_title: 'Collect' } },
      { id: 'b', type: 'order_status', opts: { show_preparing: true } },
      { id: 'c', type: 'heading', opts: { text: 'Hi', show_preparing: false } },
    ],
  }
  const [d] = await sql`INSERT INTO screen_designs (tenant_id, name, width, height, layout)
    VALUES (${ids.a}, 'Zqf old board', 1920, 1080, ${sql.json(layout)}) RETURNING id`
  await sql.unsafe(migration)
  const [row] = await sql`SELECT layout FROM screen_designs WHERE id = ${d.id}`
  assert.deepEqual(row.layout.blocks.map(b => b.opts), [
    { ready_title: 'Collect', show: 'ready' },
    {},
    { text: 'Hi', show_preparing: false },
  ])
  assert.deepEqual(row.layout.blocks.map(b => b.id), ['a', 'b', 'c'], 'blocks keep their order')
})
