// GloriaFood orders on the kitchen screens (migration 178). Orders GloriaFood
// pushes (or a poll collects) go into the kitchen once the venue switches it
// on in Till setup: dishes matched to the menu by name follow dish and section
// links, the rest the default links; the GloriaFood order type maps to one of
// the tenant's. Ready / collected in the kitchen moves the order on the Online
// orders board, the board's Ready / Collected and a cancellation in GloriaFood
// are copied to the kitchen. Checked here end to end through the push
// webhook, a kitchen screen and the board, plus the settings and refusals.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { kitchenOnGloriaFood } from '../src/services/kitchenSvc.js'
import { ulid } from '../../shared/pos/ids.js'

let ids, owner, V, dish, wok, grill, pass, screen, token, types

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

async function pairDevice(kind, name) {
  const made = await ok(owner.post(`/api/pos/venues/${V}/devices`, { name, kind, settings: {} }), 'add ' + name)
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/pos-api/pair',
    headers: { 'content-type': 'application/json', [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
    payload: JSON.stringify({ code: made.pairing_code }),
  })
  assert.equal(res.statusCode, 200, res.body)
  return { ...res.json(), id: made.device.id }
}

const minutes = n => new Date(Date.now() + n * 60_000).toISOString()

/** A GloriaFood order in the Accepted Orders API v2 shape. */
function gfOrder(id, over = {}) {
  return {
    id, restaurant_id: 5150, restaurant_name: 'Zqx Thai Ware', status: 'accepted', type: 'delivery', source: 'website',
    payment: 'ONLINE', currency: 'GBP', total_price: 21.5, sub_total_price: 21.5,
    accepted_at: minutes(-1), fulfill_at: minutes(30), updated_at: minutes(-1), for_later: false,
    client_first_name: 'Ann', client_last_name: 'Example', instructions: 'No chilli please', table_number: null, persons: null,
    items: [
      { type: 'item', name: '  ' + dish.name.toUpperCase() + ' ', quantity: 2, total_item_price: 15, instructions: null,
        options: [{ name: 'Large', group_name: 'Size', quantity: 1 }, { name: 'Extra egg', group_name: 'Extras', quantity: 2 }] },
      { type: 'item', name: 'Mystery Soup', quantity: 1, total_item_price: 6.5, instructions: 'Hot', options: [] },
      { type: 'delivery_fee', name: 'Delivery', quantity: 1, total_item_price: 2.5 },
    ],
    ...over,
  }
}

async function push(orders) {
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url: '/webhooks/gloriafood/' + token,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ count: orders.length, orders }),
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}

const gfRow = async gfId => (await sql`SELECT * FROM gloriafood_orders WHERE tenant_id = ${ids.a} AND gf_order_id = ${gfId}`)[0]
const kitchenOrder = async rowId => (await sql`SELECT * FROM kds_orders WHERE id = ${'gf-' + rowId}`)[0]

/** The kitchen copy is made after the push is answered: wait for it. */
async function until(what, check, ms = 5000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await check()
    if (v) return v
    if (Date.now() > end) assert.fail('timed out waiting for ' + what)
    await new Promise(r => setTimeout(r, 50))
  }
}
const settle = () => new Promise(r => setTimeout(r, 400))

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[1], section_id: menu.sections[0].id }
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  types = Object.fromEntries(setup.order_types.map(t => [t.name, t.id]))
  wok = setup.kds_stations.find(s => s.kind === 'prep')
  grill = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Grill', kind: 'prep' }))
  pass = await ok(owner.post(`/api/pos/venues/${V}/kds-stations`, { name: 'Pass', kind: 'expo' }))
  // The flow in use: the dish's section to the Grill, everything else to the
  // Wok, both on to the pass.
  await ok(owner.put(`/api/pos/kds-flows/${setup.kds_active_flow_id}`, { links: [
    { from: null, to: wok.id, targets: [] },
    { from: null, to: grill.id, targets: [{ kind: 'section', id: dish.section_id }] },
    { from: wok.id, to: pass.id, targets: [] },
    { from: grill.id, to: pass.id, targets: [] },
  ], layout: {} }))
  screen = await pairDevice('kds', 'Pass screen')
  const { push_url } = await ok(owner.get(`/api/gloriafood/venues/${V}/push-url`))
  token = push_url.split('/').pop()
})
after(closeApp)

test('Till setup: the GloriaFood settings, types matched by name until picked, refusals', async () => {
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.ok(setup.gloriafood, 'the venue is linked')
  assert.equal(setup.settings.kds_gloriafood, true, 'the fixtures switched it on')
  assert.equal(setup.settings.kds_gloriafood_lead_mins, 25)
  assert.equal(setup.gloriafood.types.pickup, types['Zqx Drive thru'], 'picked')
  assert.equal(setup.gloriafood.types.delivery, null, 'set to none')
  assert.equal(setup.gloriafood.types.dine_in, types['Eat in'], 'not picked: matched by name')

  const bad = await owner.patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood_types: { delivery: crypto.randomUUID() } })
  assert.equal(bad.status, 422)
  const bType = (await sql`SELECT id FROM order_types WHERE tenant_id = ${ids.b} LIMIT 1`)[0]
  if (bType) assert.equal((await owner.patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood_types: { delivery: bType.id } })).status, 422, 'another tenant\'s type')
  const unknown = await owner.patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood_types: { takeaway_drone: null } })
  assert.equal(unknown.status, 400)
  const viewer = await as(A.viewer, ids.a).patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood: false })
  assert.equal(viewer.status, 403)

  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood_types: { pickup: types['Collection'], delivery: types['Delivery'] }, kds_gloriafood_lead_mins: 20 }))
  const after = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  assert.equal(after.gloriafood.types.delivery, types['Delivery'])
})

test('switched off: a pushed order stays out of the kitchen', async () => {
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood: false }))
  await push([gfOrder(880001)])
  const row = await until('order stored', () => gfRow(880001))
  await settle()
  assert.equal(await kitchenOrder(row.id), undefined)
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { kds_gloriafood: true }))
})

test('a pushed order reaches the kitchen: dishes by name, type, guest, note; once only', async () => {
  await push([gfOrder(880002)])
  const row = await until('order stored', () => gfRow(880002))
  const k = await until('kitchen order', () => kitchenOrder(row.id))
  assert.equal(k.source, 'gloriafood')
  assert.equal(k.order_id, row.id)
  const o = k.state
  assert.equal(o.number, '880002')
  assert.equal(o.guest, 'Ann')
  assert.equal(o.type, types['Delivery'])
  assert.equal(o.type_name, 'Delivery')
  assert.equal(o.note, 'No chilli please')
  assert.equal(o.items.length, 2, 'the delivery fee isn\'t a dish')
  const [matched, soup] = o.items
  assert.equal(matched.item_id, dish.id, 'matched by name, case and spaces ignored')
  assert.equal(matched.name, dish.kitchen_name || dish.name, 'shown under the menu\'s own name')
  assert.equal(matched.qty, 2)
  assert.deepEqual(matched.mods.map(m => m.text), ['Large', '2 x Extra egg'])
  assert.deepEqual(Object.keys(matched.route).sort(), [grill.id, pass.id].sort(), 'section link')
  assert.equal(soup.item_id, null)
  assert.equal(soup.note, 'Hot')
  assert.deepEqual(Object.keys(soup.route).sort(), [wok.id, pass.id].sort(), 'default link')

  // The screen gets it.
  const sync = await device(screen, 'GET', '/pos-api/kitchen/sync?since=0')
  assert.equal(sync.status, 200, sync.body)
  assert.ok(sync.json.orders.some(x => x.id === 'gf-' + row.id))

  // GloriaFood sends it again: still one.
  await push([gfOrder(880002)])
  await settle()
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM kds_orders WHERE order_id = ${row.id}`
  assert.equal(n, 1)
})

test('ready and collected in the kitchen move it on the board', async () => {
  const row = await gfRow(880002)
  const bump = await device(screen, 'POST', '/pos-api/events', { events: [{
    id: ulid(), type: 'kitchen.bumped', client_at: new Date().toISOString(), payload: { order_id: 'gf-' + row.id, station_id: pass.id },
  }] })
  assert.equal(bump.status, 200, bump.body)
  assert.ok(bump.json.results[0].ok, JSON.stringify(bump.json.results[0]))
  const ready = await until('board ready', async () => ((await gfRow(880002)).board_status === 'ready' ? gfRow(880002) : null))
  assert.equal(ready.board_status_by, 'Kitchen screen Pass screen')
  const coll = await device(screen, 'POST', '/pos-api/events', { events: [{
    id: ulid(), type: 'kitchen.collected', client_at: new Date().toISOString(), payload: { order_id: 'gf-' + row.id },
  }] })
  assert.ok(coll.json.results[0].ok, JSON.stringify(coll.json.results[0]))
  await until('board completed', async () => (await gfRow(880002)).board_status === 'completed')
})

test('the board\'s Ready and Collected, and a cancellation in GloriaFood, reach the kitchen', async () => {
  await push([gfOrder(880003), gfOrder(880004, { type: 'pickup' })])
  const r3 = await until('stored', () => gfRow(880003))
  const r4 = await until('stored', () => gfRow(880004))
  await until('in the kitchen', () => kitchenOrder(r3.id))
  const k4 = await until('in the kitchen', () => kitchenOrder(r4.id))
  assert.equal(k4.state.type, types['Collection'])

  await ok(owner.post(`/api/orders/gloriafood/${r3.id}/status`, { to: 'ready' }))
  await until('kitchen ready', async () => (await kitchenOrder(r3.id)).status === 'ready')
  await ok(owner.post(`/api/orders/gloriafood/${r3.id}/status`, { to: 'completed' }))
  await until('kitchen collected', async () => (await kitchenOrder(r3.id)).status === 'collected')

  await push([gfOrder(880004, { type: 'pickup', status: 'canceled', updated_at: minutes(0) })])
  await until('kitchen cancelled', async () => (await kitchenOrder(r4.id)).status === 'cancelled')
})

test('test orders are marked, later orders wait, old and imported ones never go', async () => {
  await push([
    gfOrder(880005, { source: 'admin', instructions: null }),
    gfOrder(880006, { for_later: true, fulfill_at: minutes(120), type: 'dine_in', table_number: '12' }),
    gfOrder(880007, { accepted_at: minutes(-400), fulfill_at: minutes(-300) }),
  ])
  const r5 = await until('stored', () => gfRow(880005))
  const r6 = await until('stored', () => gfRow(880006))
  const r7 = await until('stored', () => gfRow(880007))
  const k5 = await until('test order', () => kitchenOrder(r5.id))
  assert.equal(k5.state.note, 'GloriaFood test order')
  const k6 = await until('later order', () => kitchenOrder(r6.id))
  assert.equal(k6.state.table, '12')
  assert.equal(k6.state.type, types['Eat in'])
  const fire = Date.parse(k6.state.items[0].fire_at)
  assert.ok(Math.abs(fire - (Date.now() + 100 * 60_000)) < 60_000, 'comes on 20 minutes before its time')
  assert.equal(k6.state.items[0].fired_at, null)
  await settle()
  assert.equal(await kitchenOrder(r7.id), undefined, 'five hours late: not sent')

  const [imp] = await sql`
    INSERT INTO gloriafood_orders (tenant_id, venue_id, gf_order_id, status, total_pence, fulfill_at, items, payload, received_via)
    VALUES (${ids.a}, ${V}, 880008, 'accepted', 500, now(), ${sql.json([{ name: 'Soup', qty: 1, options: [] }])}, '{}'::jsonb, 'import')
    RETURNING id`
  assert.deepEqual(await kitchenOnGloriaFood(ids.a, V, [imp.id]), [])
  assert.equal(await kitchenOrder(imp.id), undefined, 'imported: a record of a past day')
})

test('another tenant can\'t send its ids or move these orders', async () => {
  const row = await gfRow(880006)
  assert.deepEqual(await kitchenOnGloriaFood(ids.b, V, [row.id]), [], 'wrong tenant: nothing found')
  const b = as(B.owner, ids.b)
  assert.equal((await b.post(`/api/orders/gloriafood/${row.id}/status`, { to: 'ready' })).status, 404)
  await settle()
  assert.equal((await kitchenOrder(row.id)).status, 'active')
})
