// Charges per order type and the company's discounts (migration 225;
// shared/pos/charges.js, discounts.js) through the real routes and the
// cloud's sequencer: what Store tech saves reaches the tills in their config,
// and the sequencer judges charges and discounts from the list as the till does.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'
import { chargesForType } from '../../shared/pos/charges.js'
import { reconValues } from '../src/services/posSvc.js'
import { randomUUID } from 'node:crypto'

let ids, owner, viewer, other, V, serverId, bossId, till, dish, eatIn, vat20

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
const ev = (type, payload, extra = {}) => ({ id: ulid(), type, payload, client_at: new Date().toISOString(), staff_id: serverId, ...extra })
async function send(events) {
  const r = await device(till, 'POST', '/pos-api/events', { events })
  assert.equal(r.status, 200, r.body)
  return r.json.results
}
const line = () => ({ id: ulid(), item_id: dish.id, section_id: dish.section_id, name: dish.name, qty: 1, unit_price: 1000, modifiers: [], vat_rate: 20 })

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyc', slug: 'yyc' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  const menu = await ok(owner.get('/api/menus/' + filled.ids.menu))
  dish = { ...menu.sections[0].items[0], section_id: menu.sections[0].id }
  // A server with no discounts of their own, and a manager.
  const server = await ok(owner.post('/api/pos/roles', { name: 'Zqc Server', permissions: { discount_max_pct: 0 } }))
  const boss = await ok(owner.post('/api/pos/roles', { name: 'Zqc Boss', permissions: { manager: true, discount_max_pct: 100 } }))
  serverId = filled.ids.staff
  bossId = filled.ids.staff2
  await ok(owner.put(`/api/pos/venues/${V}/staff/${serverId}/pos`, { pos_role_id: server.id, pin: '2468' }))
  await ok(owner.put(`/api/pos/venues/${V}/staff/${bossId}/pos`, { pos_role_id: boss.id, pin: '1357' }))
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zqc Till' })
  const types = await ok(owner.get('/api/order-types'))
  eatIn = types.find(t => t.name === 'Eat in')
  const rates = await ok(owner.get('/api/tax-rates'))
  vat20 = (rates.rates || rates).find(r => Number(r.rate) === 20)
})
after(closeApp)

test('order type charges: saved cleaned with ids, checked, and in the till\'s config', async () => {
  const saved = await ok(owner.patch('/api/order-types/' + eatIn.id, {
    charges: [
      { name: ' Service charge ', kind: 'percent', value: 12.5, optional: true, min_covers: 0 },
      { name: 'Large party', kind: 'percent', value: 2.5, optional: false, min_covers: 6 },
      { name: 'Corkage', kind: 'amount', value: 500, optional: false, tax_rate_id: vat20.id },
    ],
  }))
  assert.equal(saved.ok, true)
  const [row] = await sql`SELECT charges FROM order_types WHERE id = ${eatIn.id}`
  assert.deepEqual(row.charges.map(x => [x.name, x.kind, x.value, x.optional, x.min_covers, x.tax_rate_id]), [
    ['Service charge', 'percent', 12.5, true, 0, null],
    ['Large party', 'percent', 2.5, false, 6, null],
    ['Corkage', 'amount', 500, false, 0, vat20.id],
  ])
  assert.ok(row.charges.every(x => /^[0-9a-f-]{36}$/.test(x.id)), 'each charge got an id')
  // A save that keeps an id keeps it; a name change alone doesn't add a charge.
  const again = row.charges.map(x => (x.name === 'Corkage' ? { ...x, name: 'Corkage fee' } : x))
  await ok(owner.patch('/api/order-types/' + eatIn.id, { charges: again }))
  const [row2] = await sql`SELECT charges FROM order_types WHERE id = ${eatIn.id}`
  assert.deepEqual(row2.charges.map(x => x.id), row.charges.map(x => x.id))
  assert.equal(row2.charges[2].name, 'Corkage fee')
  // Leaving charges out of a save keeps them.
  await ok(owner.patch('/api/order-types/' + eatIn.id, { colour: '#336699' }))
  const [row3] = await sql`SELECT charges FROM order_types WHERE id = ${eatIn.id}`
  assert.equal(row3.charges.length, 3)
  // Refusals.
  const bad = async (charges, status = 422) => assert.equal((await owner.patch('/api/order-types/' + eatIn.id, { charges })).status, status)
  await bad([{ name: 'Too much', kind: 'percent', value: 60 }])
  await bad([{ name: 'Half a penny', kind: 'amount', value: 12.5 }])
  await bad([{ name: 'Nothing', kind: 'amount', value: 0 }])
  await bad([{ name: 'Twice', kind: 'amount', value: 50, id: row.charges[0].id }, { name: 'Twice', kind: 'amount', value: 50, id: row.charges[0].id }])
  const theirRate = (await ok(other.get('/api/tax-rates')))
  const theirs = (theirRate.rates || theirRate)[0]
  await bad([{ name: 'Their VAT', kind: 'amount', value: 50, tax_rate_id: theirs.id }])
  await bad([{ name: 'Bad kind', kind: 'weird', value: 5 }], 400)
  await bad(Array.from({ length: 7 }, (_, i) => ({ name: 'C' + i, kind: 'amount', value: 10 })), 400)
  assert.equal((await viewer.patch('/api/order-types/' + eatIn.id, { charges: [] })).status, 403)
  assert.equal((await other.patch('/api/order-types/' + eatIn.id, { charges: [] })).status, 404)
  const [still] = await sql`SELECT charges FROM order_types WHERE id = ${eatIn.id}`
  assert.equal(still.charges.length, 3, 'refused saves changed nothing')
  // The till gets them with its order types.
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, cfg.body)
  const type = cfg.json.order_types.find(t => t.id === eatIn.id)
  assert.equal(type.charges.length, 3)
  assert.equal(cfg.json.settings.service_charge_label, undefined)
  // A new type can start with charges.
  const made = await ok(owner.post('/api/order-types', { name: 'Zqc Delivery', charges: [{ name: 'Delivery', kind: 'amount', value: 250 }] }))
  const [mine] = await sql`SELECT charges FROM order_types WHERE id = ${made.id}`
  assert.equal(mine.charges[0].value, 250)
})

test('discounts: the company\'s list, checked, in order, in every till\'s settings', async () => {
  const meal = await ok(owner.post('/api/pos/discounts', { name: 'Staff meal', kind: 'percent', value: 50, scope: 'check' }))
  const fiver = await ok(owner.post('/api/pos/discounts', { name: '£5 off', kind: 'amount', value: 500, needs_manager: true }))
  assert.deepEqual([meal.scope, meal.needs_manager, fiver.scope, fiver.needs_manager], ['check', false, 'any', true])
  const nhs = await ok(owner.post('/api/pos/discounts', { name: 'NHS', kind: 'percent', value: 12.25, scope: 'line' }))
  assert.equal(nhs.value, 12.25)
  // Refusals.
  assert.equal((await owner.post('/api/pos/discounts', { name: 'Too much', kind: 'percent', value: 120 })).status, 400)
  assert.equal((await owner.post('/api/pos/discounts', { name: 'Odd pence', kind: 'amount', value: 2.5 })).status, 400)
  assert.equal((await owner.post('/api/pos/discounts', { name: 'Nowhere', kind: 'amount', value: 100, scope: 'table' })).status, 400)
  assert.equal((await viewer.post('/api/pos/discounts', { name: 'View only', kind: 'amount', value: 100 })).status, 403)
  // Another group neither sees nor changes them.
  const theirs = await ok(other.get('/api/pos/discounts'))
  assert.ok(!theirs.some(d => d.id === meal.id))
  assert.equal((await other.patch('/api/pos/discounts/' + meal.id, { name: 'Hacked', kind: 'percent', value: 99 })).status, 404)
  assert.equal((await other.delete('/api/pos/discounts/' + meal.id)).status, 404)
  // Edit and order.
  await ok(owner.patch('/api/pos/discounts/' + nhs.id, { name: 'NHS', kind: 'percent', value: 15, scope: 'line', needs_manager: false }))
  const mineBefore = (await ok(owner.get('/api/pos/discounts'))).map(d => d.id)
  await ok(owner.put('/api/pos/discounts/order', { ids: [nhs.id, fiver.id, meal.id, ...mineBefore.filter(id => ![nhs.id, fiver.id, meal.id].includes(id))] }))
  const list = await ok(owner.get('/api/pos/discounts'))
  assert.deepEqual(list.slice(0, 3).map(d => [d.name, d.value]), [['NHS', 15], ['£5 off', 500], ['Staff meal', 50]])
  // The till's settings carry the list (the rules read them there).
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.deepEqual(cfg.json.settings.discounts.slice(0, 3).map(d => d.id), [nhs.id, fiver.id, meal.id])
  // Removed: off the list.
  const extra = await ok(owner.post('/api/pos/discounts', { name: 'Gone soon', kind: 'amount', value: 100 }))
  await ok(owner.delete('/api/pos/discounts/' + extra.id))
  assert.ok(!(await ok(owner.get('/api/pos/discounts'))).some(d => d.id === extra.id))
})

test('the sequencer: charges on the check, taken off by the rules, a discount from the list', async () => {
  const types = await ok(owner.get('/api/order-types'))
  const type = types.find(t => t.id === eatIn.id)
  const rates = await ok(owner.get('/api/tax-rates'))
  const charges = chargesForType(type, V, (rates.rates || rates).map(r => ({ ...r, rate: Number(r.rate) })))
  const check = ulid()
  const opened = await send([
    ev('check.opened', { mode: 'table', covers: 2, order_type_id: eatIn.id, number: Math.floor(Math.random() * 9000) + 1, charges }, { check_id: check }),
    ev('line.added', { line: line() }, { check_id: check }),
    ev('line.added', { line: line() }, { check_id: check }),
  ])
  assert.ok(opened.every(r => r.ok), JSON.stringify(opened))
  // 2000 + 12.5% service (250) + corkage 500; the party charge waits for 6 guests.
  let [row] = await sql`SELECT service_charge, total, state FROM pos_checks WHERE id = ${check}`
  assert.equal(Number(row.service_charge), 750)
  assert.equal(Number(row.total), 2750)
  // Not optional: a manager every time.
  const cork = row.state.charges.find(x => x.name === 'Corkage fee')
  const refused = await send([ev('charge.removed', { charge_id: cork.id, reason: 'Our wine' }, { check_id: check })])
  assert.equal(refused[0].code, 'manager')
  const okd = await send([ev('charge.removed', { charge_id: cork.id, reason: 'Our wine' }, { check_id: check, approved_by: bossId })])
  assert.ok(okd[0].ok, JSON.stringify(okd))
  // Optional: the server takes the service charge off; then the venue's switch.
  const service = row.state.charges.find(x => x.name === 'Service charge')
  const off = await send([ev('charge.removed', { charge_id: service.id, reason: 'Guest asked' }, { check_id: check })])
  assert.ok(off[0].ok, JSON.stringify(off))
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { remove_charge: true } }))
  await send([ev('charge.restored', { charge_id: service.id }, { check_id: check })])
  const sw = await send([ev('charge.removed', { charge_id: service.id, reason: 'Guest asked' }, { check_id: check })])
  assert.equal(sw[0].code, 'manager')
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { approvals: { remove_charge: false } })) ;
  [row] = await sql`SELECT service_charge, total FROM pos_checks WHERE id = ${check}`
  assert.equal(Number(row.service_charge), 250)
  // Six guests: the party charge starts.
  await send([ev('check.covers_set', { covers: 6 }, { check_id: check })]);
  [row] = await sql`SELECT service_charge FROM pos_checks WHERE id = ${check}`
  assert.equal(Number(row.service_charge), 250 + 50)
  // A discount from the list: the server has no discounts of their own.
  const list = await ok(owner.get('/api/pos/discounts'))
  const meal = list.find(d => d.name === 'Staff meal')
  const fiver = list.find(d => d.name === '£5 off')
  const put = (d, extra = {}) => ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: d.kind, value: d.value, name: d.name, preset_id: d.id } }, { check_id: check, ...extra })
  const typed = await send([ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 50, name: 'Typed' } }, { check_id: check })])
  assert.equal(typed[0].code, 'permission')
  const used = await send([put(meal)])
  assert.ok(used[0].ok, JSON.stringify(used))
  const changed = await send([ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 60, name: 'Staff meal', preset_id: meal.id } }, { check_id: check })])
  assert.equal(changed[0].code, 'preset')
  assert.equal((await send([put(fiver)]))[0].code, 'manager')
  assert.ok((await send([put(fiver, { approved_by: bossId })]))[0].ok);
  [row] = await sql`SELECT discount, total, state FROM pos_checks WHERE id = ${check}`
  // 2000 - 50% (1000) - £5 = 500; charges on 500: 12.5% = 63, party 2.5% = 13.
  assert.equal(Number(row.discount), 1500)
  assert.equal(Number(row.total), 500 + 63 + 13)
  assert.ok(row.state.discounts.some(d => d.preset_id === meal.id))
  // A discount another group set up isn't on this till's list.
  const theirs = await ok(other.post('/api/pos/discounts', { name: 'Yyc deal', kind: 'percent', value: 10 }))
  assert.equal((await send([put(theirs)]))[0].code, 'preset')
  // The day's figures list each charge by name and what was taken off.
  const report = await device(till, 'GET', '/pos-api/reports/day')
  assert.equal(report.status, 200, report.body)
})

test('the day report: charges by name, with what was taken off', async () => {
  const types = await ok(owner.get('/api/order-types'))
  const type = types.find(t => t.id === eatIn.id)
  const charges = chargesForType(type, V, [])
  const check = ulid()
  const service = charges.find(x => x.name === 'Service charge')
  const res = await send([
    ev('check.opened', { mode: 'tab', tab_name: 'Zqc', covers: 2, order_type_id: eatIn.id, number: Math.floor(Math.random() * 9000) + 1, charges }, { check_id: check }),
    ev('line.added', { line: line() }, { check_id: check }),
    ev('charge.removed', { charge_id: service.id, reason: 'Guest asked' }, { check_id: check }),
    ev('charge.removed', { charge_id: charges.find(x => x.name === 'Corkage fee').id, reason: 'Waived' }, { check_id: check, approved_by: bossId }),
    ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 1000 } }, { check_id: check }),
    ev('check.closed', {}, { check_id: check }),
  ])
  assert.ok(res.every(r => r.ok), JSON.stringify(res))
  const report = await device(till, 'GET', '/pos-api/reports/day')
  const row = report.json.figures.charges.find(x => x.name === 'Service charge')
  assert.ok(row && row.removed >= 1 && row.removed_value >= 125, JSON.stringify(report.json.figures.charges))
})

test('Cash Recon: a charge by name, or every charge together, never twice', async () => {
  const figures = {
    revenue_streams: [], tenders: [], refunds: { amount: 0 }, tips: 120,
    sales: { service_charge: 900 },
    charges: [{ name: 'Service charge', amount: 700 }, { name: 'Packaging', amount: 200 }],
  }
  const fields = { income: [], takings: [], sc: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id })) }
  const map = { sc: {
    a: ['charge:Service charge', 'tips'],
    b: ['charge:Packaging'],
    c: ['service_charge'],
    d: ['service_charge', 'charge:Packaging'],
    e: ['charge:Not any more'],
  } }
  const out = Object.fromEntries(reconValues(figures, map, fields).map(x => [x.id, x.amount]))
  assert.deepEqual(out, { a: 8.2, b: 2, c: 9, d: 9, e: 0 })
  // A day closed before charges had names still fills All charges.
  const old = Object.fromEntries(reconValues({ ...figures, charges: undefined }, map, fields).map(x => [x.id, x.amount]))
  assert.deepEqual(old, { a: 1.2, b: 0, c: 9, d: 9, e: 0 })
  // The settings take a charge by name and refuse anything else.
  const src = randomUUID()
  const save = terms => owner.patch(`/api/pos/venues/${V}/settings`, { recon_map: { income: {}, takings: {}, sc: { [src]: terms } } })
  assert.equal((await save(['charge:Service charge', 'tips'])).status, 200)
  const [st] = await sql`SELECT recon_map FROM pos_settings WHERE venue_id = ${V}`
  assert.deepEqual(st.recon_map.sc[src], ['charge:Service charge', 'tips'])
  assert.equal((await save(['charge:'])).status, 400)
  assert.equal((await save(['charge: leading space'])).status, 400)
  assert.equal((await save(['nonsense'])).status, 400)
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, { recon_map: { income: {}, takings: {}, sc: {} } }))
})
