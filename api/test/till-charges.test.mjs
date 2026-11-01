// The company's charges and each location's matrix of revenue streams by
// order types (migration 231), the company's discounts (migration 225), and
// covers and courses per revenue stream and till (migration 231), through
// the real routes and the cloud's sequencer: what Store tech saves reaches
// the tills in their config, and the sequencer judges charges and discounts
// from the list as the till does (shared/pos/charges.js, discounts.js).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { ulid } from '../../shared/pos/ids.js'
import { chargesWhere, chargeFromList } from '../../shared/pos/charges.js'
import { reconValues } from '../src/services/posSvc.js'
import { randomUUID } from 'node:crypto'

let ids, owner, viewer, other, V, serverId, bossId, till, dish, eatIn, vat20, stream, list

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
  // The stream the till's checks are in (its own setting is empty: the first).
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  stream = setup.revenue_streams.find(r => r.is_active)
})

// The charges a check of this stream and type gets, as the till works them out.
async function chargesOf(typeId, streamId = stream.id) {
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.equal(cfg.status, 200, cfg.body)
  return chargesWhere(cfg.json.settings.charges, { streamId, typeId }, V, cfg.json.tax_rates)
}
after(closeApp)

test('the charges list: saved cleaned, checked, in order, and in every till\'s settings', async () => {
  const service = await ok(owner.post('/api/pos/charges', { name: ' Service charge ', kind: 'percent', value: 12.5, optional: true }))
  const party = await ok(owner.post('/api/pos/charges', { name: 'Large party', kind: 'percent', value: 2.5, min_covers: 6 }))
  const cork = await ok(owner.post('/api/pos/charges', { name: 'Corkage', kind: 'amount', value: 500, tax_rate_id: vat20.id }))
  // A cup deposit for each hot drink: the dish named, and every dish of its section.
  const cup = await ok(owner.post('/api/pos/charges', {
    name: 'Cup deposit', kind: 'amount', value: 25, optional: true, basis: 'dishes', per: 'dish', item_ids: [dish.id, dish.id], section_ids: [dish.section_id],
  }))
  assert.deepEqual([service.name, service.kind, service.value, service.optional, service.basis, service.per], ['Service charge', 'percent', 12.5, true, 'check', 'check'])
  assert.deepEqual([party.min_covers, party.optional, cork.tax_rate_id], [6, false, vat20.id])
  assert.deepEqual([cup.basis, cup.per, cup.item_ids, cup.section_ids], ['dishes', 'dish', [dish.id], [dish.section_id]])
  // A percent is always once; a whole-check charge keeps no dishes.
  const once = await ok(owner.post('/api/pos/charges', { name: 'Zqc once', kind: 'percent', value: 5, per: 'dish', basis: 'check', item_ids: [dish.id] }))
  assert.deepEqual([once.per, once.item_ids], ['check', []])
  await ok(owner.delete('/api/pos/charges/' + once.id))
  // Refusals.
  const bad = async (body, status = 400) => assert.equal((await owner.post('/api/pos/charges', body)).status, status, JSON.stringify(body))
  await bad({ name: 'Too much', kind: 'percent', value: 60 })
  await bad({ name: 'Half a penny', kind: 'amount', value: 12.5 })
  await bad({ name: 'Nothing', kind: 'amount', value: 0 })
  await bad({ name: 'Bad kind', kind: 'weird', value: 5 })
  await bad({ name: '', kind: 'amount', value: 50 })
  await bad({ name: 'No dishes', kind: 'amount', value: 50, basis: 'dishes' }, 422)
  const theirRates = await ok(other.get('/api/tax-rates'))
  await bad({ name: 'Their VAT', kind: 'amount', value: 50, tax_rate_id: (theirRates.rates || theirRates)[0].id }, 422)
  const theirSetup = await ok(other.get('/api/menus'))
  const theirMenu = await ok(other.get('/api/menus/' + theirSetup[0].id))
  await bad({ name: 'Their dish', kind: 'amount', value: 50, basis: 'dishes', item_ids: [theirMenu.sections[0].items[0].id] }, 422)
  await bad({ name: 'Their section', kind: 'amount', value: 50, basis: 'dishes', section_ids: [theirMenu.sections[0].id] }, 422)
  assert.equal((await viewer.post('/api/pos/charges', { name: 'View only', kind: 'amount', value: 100 })).status, 403)
  // Another group neither sees nor changes them.
  assert.ok(!(await ok(other.get('/api/pos/charges'))).some(x => x.id === service.id))
  assert.equal((await other.patch('/api/pos/charges/' + service.id, { name: 'Hacked', kind: 'percent', value: 49 })).status, 404)
  assert.equal((await other.delete('/api/pos/charges/' + service.id)).status, 404)
  // Edit (a name change keeps the id) and order.
  await ok(owner.patch('/api/pos/charges/' + cork.id, { name: 'Corkage fee', kind: 'amount', value: 500, tax_rate_id: vat20.id }))
  const before = (await ok(owner.get('/api/pos/charges'))).map(x => x.id)
  const first = [service.id, party.id, cork.id, cup.id]
  await ok(owner.put('/api/pos/charges/order', { ids: [...first, ...before.filter(id => !first.includes(id))] }))
  list = await ok(owner.get('/api/pos/charges'))
  assert.deepEqual(list.slice(0, 4).map(x => x.name), ['Service charge', 'Large party', 'Corkage fee', 'Cup deposit'])
  // Every till's settings carry the list, each with where it is on at the till's location.
  const cfg = await device(till, 'GET', '/pos-api/config')
  assert.deepEqual(cfg.json.settings.charges.slice(0, 4).map(x => x.id), first)
  assert.ok(cfg.json.settings.charges.every(x => Array.isArray(x.where)))
  assert.equal(cfg.json.order_types.find(t => t.id === eatIn.id).charges, undefined, 'order types carry no charges')
  // The catalogue for picking dishes is the group's own.
  const cat = await ok(owner.get('/api/pos/charges/catalog'))
  assert.ok(cat.menus.some(m => m.sections.some(sec => sec.items.some(i => i.id === dish.id))))
  assert.ok(!(await ok(other.get('/api/pos/charges/catalog'))).menus.some(m => m.sections.some(sec => sec.items.some(i => i.id === dish.id))))
})

test('the matrix: which checks get which charges at a location, checked, in the till\'s config', async () => {
  const [service, party, cork] = list
  const rules = [service, party, cork].map(x => ({ charge_id: x.id, revenue_stream_id: stream.id, order_type_id: eatIn.id }))
  const saved = await ok(owner.put(`/api/pos/venues/${V}/charge-rules`, { rules: [...rules, rules[0]] }))
  assert.equal(saved.filter(r => r.revenue_stream_id === stream.id && r.order_type_id === eatIn.id).length, 3, 'the same rule twice is saved once')
  assert.equal((await ok(owner.get(`/api/pos/venues/${V}/charge-rules`))).length, saved.length)
  // Refusals: another group's charge, stream, order type or venue; a viewer.
  const theirs = await ok(other.post('/api/pos/charges', { name: 'Yyc fee', kind: 'amount', value: 100 }))
  const [theirStream] = await sql`SELECT id FROM pos_revenue_streams WHERE tenant_id = ${ids.b} LIMIT 1`
  const theirTypes = await ok(other.get('/api/order-types'))
  const refused = async (body, status = 422) => assert.equal((await owner.put(`/api/pos/venues/${V}/charge-rules`, body)).status, status, JSON.stringify(body))
  await refused({ rules: [{ charge_id: theirs.id, revenue_stream_id: stream.id, order_type_id: eatIn.id }] })
  await refused({ rules: [{ charge_id: service.id, revenue_stream_id: theirStream.id, order_type_id: eatIn.id }] })
  await refused({ rules: [{ charge_id: service.id, revenue_stream_id: stream.id, order_type_id: theirTypes[0].id }] })
  await refused({ rules: [{ charge_id: 'nope', revenue_stream_id: stream.id, order_type_id: eatIn.id }] }, 400)
  assert.equal((await viewer.put(`/api/pos/venues/${V}/charge-rules`, { rules })).status, 403)
  assert.equal((await other.put(`/api/pos/venues/${V}/charge-rules`, { rules: [] })).status, 404)
  assert.equal((await other.get(`/api/pos/venues/${V}/charge-rules`)).status, 404)
  // Refused saves changed nothing.
  assert.equal((await ok(owner.get(`/api/pos/venues/${V}/charge-rules`))).length, saved.length)
  // The till's checks of the stream and Eat in get the three; another type none.
  const got = await chargesOf(eatIn.id)
  assert.deepEqual(got.map(x => x.name), ['Service charge', 'Large party', 'Corkage fee'])
  assert.equal(got.find(x => x.name === 'Corkage fee').vat_rate, 20)
  const takeOut = (await ok(owner.get('/api/order-types'))).find(t => t.name === 'Take out')
  assert.deepEqual(await chargesOf(takeOut.id), [])
  // A charge deleted leaves every matrix.
  const gone = await ok(owner.post('/api/pos/charges', { name: 'Gone soon', kind: 'amount', value: 100 }))
  await ok(owner.put(`/api/pos/venues/${V}/charge-rules`, { rules: [...rules, { charge_id: gone.id, revenue_stream_id: stream.id, order_type_id: takeOut.id }] }))
  await ok(owner.delete('/api/pos/charges/' + gone.id))
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM pos_charge_rules WHERE charge_id = ${gone.id}`
  assert.equal(n, 0)
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
  const charges = await chargesOf(eatIn.id)
  const check = ulid()
  const opened = await send([
    ev('check.opened', { mode: 'table', covers: 2, revenue_stream_id: stream.id, order_type_id: eatIn.id, number: Math.floor(Math.random() * 9000) + 1, charges }, { check_id: check }),
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
  const charges = await chargesOf(eatIn.id)
  const check = ulid()
  const service = charges.find(x => x.name === 'Service charge')
  const res = await send([
    ev('check.opened', { mode: 'tab', tab_name: 'Zqc', covers: 2, revenue_stream_id: stream.id, order_type_id: eatIn.id, number: Math.floor(Math.random() * 9000) + 1, charges }, { check_id: check }),
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

test('charges from the list on the till: checked against the list; a cup deposit for each dish', async () => {
  const cfg = await device(till, 'GET', '/pos-api/config')
  const own = cfg.json.settings.charges
  const cup = own.find(x => x.name === 'Cup deposit')
  const cork = own.find(x => x.name === 'Corkage fee')
  const takeOut = (await ok(owner.get('/api/order-types'))).find(t => t.name === 'Take out')
  const check = ulid()
  const res = await send([
    ev('check.opened', { mode: 'tab', tab_name: 'Zqc cups', revenue_stream_id: stream.id, order_type_id: takeOut.id, number: Math.floor(Math.random() * 9000) + 1, charges: [] }, { check_id: check }),
    ev('line.added', { line: line() }, { check_id: check }),
    ev('line.added', { line: { ...line(), qty: 2, unit_price: 900 } }, { check_id: check }),
    ev('charge.added', { charge: { ...chargeFromList(cup, V, cfg.json.tax_rates), list: true } }, { check_id: check }),
  ])
  assert.ok(res.every(r => r.ok), JSON.stringify(res))
  // 3 cups of the named dish: 3 x 25p.
  let [row] = await sql`SELECT service_charge, total, state FROM pos_checks WHERE id = ${check}`
  assert.equal(Number(row.service_charge), 75)
  assert.equal(Number(row.total), 1000 + 1800 + 75)
  const onCheck = row.state.charges.find(x => x.id === cup.id)
  assert.deepEqual([onCheck.basis, onCheck.per, onCheck.list, onCheck.added], ['dishes', 'dish', true, true])
  // Not as the list has it (another amount, another dish), or not on the list: refused.
  const changed = await send([ev('charge.added', { charge: { ...chargeFromList(cork, V, cfg.json.tax_rates), value: 100, list: true } }, { check_id: check })])
  assert.equal(changed[0].code, 'charge')
  const theirs = (await ok(other.get('/api/pos/charges')))[0]
  const notOurs = await send([ev('charge.added', { charge: { ...chargeFromList(theirs, V, []), list: true } }, { check_id: check })])
  assert.equal(notOurs[0].code, 'charge')
  // Typed in on the till: whole check, optional, no VAT, whatever it said.
  const typed = await send([ev('charge.added', { charge: { id: ulid(), name: 'Zqc typed', kind: 'amount', value: 100, basis: 'dishes', item_ids: [dish.id], per: 'dish', tax_rate_id: vat20.id } }, { check_id: check })])
  assert.ok(typed[0].ok, JSON.stringify(typed));
  [row] = await sql`SELECT service_charge, state FROM pos_checks WHERE id = ${check}`
  const t = row.state.charges.find(x => x.name === 'Zqc typed')
  assert.deepEqual([t.basis ?? 'check', t.per ?? 'check', t.optional, t.vat_rate, t.tax_rate_id], ['check', 'check', true, 0, null])
  assert.equal(Number(row.service_charge), 75 + 100)
  // A dish of the named section counts too, as a meal deal's part.
  const deal = { ...line(), item_id: randomUUID(), section_id: null, name: 'Zqc deal', combo: [{ step_id: 's', item_id: dish.id, section_id: dish.section_id, name: dish.name, upcharge: 0 }] }
  await send([ev('line.added', { line: deal }, { check_id: check })]);
  [row] = await sql`SELECT service_charge FROM pos_checks WHERE id = ${check}`
  assert.equal(Number(row.service_charge), 100 + 100)
})

test('a stream change brings its charges; one taken off stays off on the way back', async () => {
  const second = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqc Terrace', order_types: [{ order_type_id: eatIn.id, enabled: true }] }))
  const charges = await chargesOf(eatIn.id)
  const check = ulid()
  const service = charges.find(x => x.name === 'Service charge')
  const res = await send([
    ev('check.opened', { mode: 'tab', tab_name: 'Zqc moving', covers: 2, revenue_stream_id: stream.id, order_type_id: eatIn.id, number: Math.floor(Math.random() * 9000) + 1, charges }, { check_id: check }),
    ev('line.added', { line: line() }, { check_id: check }),
    ev('charge.removed', { charge_id: service.id, reason: 'Guest asked' }, { check_id: check }),
    // The terrace's checks of Eat in get no charges here.
    ev('check.stream_set', { revenue_stream_id: second.id, lines: {}, charges: await chargesOf(eatIn.id, second.id) }, { check_id: check }),
  ])
  assert.ok(res.every(r => r.ok), JSON.stringify(res))
  let [row] = await sql`SELECT service_charge, state FROM pos_checks WHERE id = ${check}`
  assert.equal(Number(row.service_charge), 0)
  assert.deepEqual(row.state.charges, [])
  const back = await send([ev('check.stream_set', { revenue_stream_id: stream.id, lines: {}, charges }, { check_id: check })])
  assert.ok(back[0].ok, JSON.stringify(back));
  [row] = await sql`SELECT service_charge, state FROM pos_checks WHERE id = ${check}`
  assert.equal(row.state.charges.find(x => x.id === service.id).removed, true, 'the service charge stays off')
  assert.equal(Number(row.service_charge), 500, 'corkage only')
  // Without charges, a stream change leaves the check's charges as they are.
  await send([ev('check.stream_set', { revenue_stream_id: second.id, lines: {} }, { check_id: check })]);
  [row] = await sql`SELECT state FROM pos_checks WHERE id = ${check}`
  assert.equal(row.state.charges.length, 3)
  await ok(owner.delete(`/api/pos/revenue-streams/${second.id}`))
})

test('covers and courses: per revenue stream, and a till\'s own, in the till\'s config', async () => {
  const made = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqc Counter', covers: 'off', courses: false }))
  assert.deepEqual([made.covers, made.courses], ['off', false])
  const plain = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqc Plain' }))
  assert.deepEqual([plain.covers, plain.courses], ['ask', true], 'new streams ask and use courses')
  await ok(owner.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqc Plain', covers: 'must', courses: true }))
  assert.equal((await owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqc Bad', covers: 'sometimes' })).status, 400)
  assert.equal((await viewer.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqc Plain', covers: 'off' })).status, 403)
  assert.equal((await other.patch(`/api/pos/revenue-streams/${plain.id}`, { name: 'Zqc Plain', covers: 'off' })).status, 404)
  const cfg = await device(till, 'GET', '/pos-api/config')
  const byName = Object.fromEntries(cfg.json.revenue_streams.map(r => [r.name, r]))
  assert.deepEqual([byName['Zqc Counter'].covers, byName['Zqc Counter'].courses], ['off', false])
  assert.deepEqual([byName['Zqc Plain'].covers, byName['Zqc Plain'].courses], ['must', true])
  assert.equal(cfg.json.settings.require_covers, undefined, 'the venue switch is gone')
  // A till's own choice, kept in its settings; nonsense refused.
  await ok(owner.patch(`/api/pos/devices/${till.device_id}`, { settings: { mode: 'table', covers: 'off', courses: 'on' } }))
  const own = await device(till, 'GET', '/pos-api/config')
  assert.deepEqual([own.json.device.settings.covers, own.json.device.settings.courses], ['off', 'on'])
  assert.equal((await owner.patch(`/api/pos/devices/${till.device_id}`, { settings: { mode: 'table', covers: 'maybe' } })).status, 400)
  assert.equal((await owner.patch(`/api/pos/devices/${till.device_id}`, { settings: { mode: 'table', courses: true } })).status, 400)
  await ok(owner.patch(`/api/pos/devices/${till.device_id}`, { settings: { mode: 'table' } }))
  await ok(owner.delete(`/api/pos/revenue-streams/${made.id}`))
  await ok(owner.delete(`/api/pos/revenue-streams/${plain.id}`))
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
