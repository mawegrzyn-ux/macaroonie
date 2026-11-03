// Order flows on kiosks and online ordering (migration 236, shared/pos/orderFlows.js,
// shared/kiosk.js kioskFlows() and shared/orderPricing.js priceBasket()):
// a kiosk's config carries the flows that run on kiosks with the charges list,
// and knows the dishes they put on from a section hidden on the website; an
// order built as the kiosk builds it goes through the sequencer with the
// flow's dish, its charge and the prompt answered. Online ordering's page gets
// the flows without their names and the dishes they put on; the quote and the
// order work them out again from the guest's own dishes (the guest's word
// counts only for taking off removable ones), and the order keeps them for
// the status page and staff.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { ulid } from '../../shared/pos/ids.js'
import { addKey } from '../../shared/pos/orderFlows.js'
import { configItem } from '../../shared/pos/offers.js'
import { checkTotals } from '../../shared/pos/pricing.js'
import { chargeFromList } from '../../shared/pos/charges.js'
import { kioskFlows, kioskOrder, kioskPrompts, TK } from '../../shared/kiosk.js'

let ids, owner, viewer, other, V, V2, menuId, theirVenue
let kiosk, kiosk2, theirKiosk, stream, web, takeOut, eatIn, collection
let curry, lemonade, cola, bag, bagFee
let kBag, kDrink, kSide, tillOnly, oBag, oDrink

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
const guest = as(null, null)
const kioskConfig = async d => {
  const r = await device(d, 'GET', '/pos-api/config')
  assert.equal(r.status, 200, r.body)
  return r.json
}
const asDevice = d => ({ id: d.device_id, venue_id: d.device.venue_id, short_code: d.device.short_code, name: d.device.name })
// The fewest picks a dish needs.
const picks = (config, item) => Object.fromEntries((configItem(config, item.id).pos_choices || [])
  .filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))
const onlinePicks = item => Object.fromEntries((item.choices || []).filter(c => c.min > 0).map(c => [c.key, c.options.slice(0, c.min).map(o => o.id)]))

const flowBody = (f, changes = {}) => ({
  name: f.name, on: f.on, kind: f.kind, trigger: f.trigger, apps: f.apps,
  venue_ids: f.venue_ids, till_ids: f.till_ids, kiosk_ids: f.kiosk_ids,
  match: f.match, ask: f.ask, adds: f.adds, ...changes,
})
async function makeFlow(name, kind, { match = {}, ask = {}, ...changes } = {}) {
  const made = await ok(owner.post('/api/pos/order-flows', { name, kind }), 'flow ' + name)
  return ok(owner.put('/api/pos/order-flows/' + made.id, flowBody(made, {
    on: true, ...changes, match: { ...made.match, ...match }, ...(kind === 'ask' ? { ask: { ...made.ask, ...ask } } : {}),
  })), 'flow saved ' + name)
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
  V2 = filled.ids.venue2
  menuId = filled.ids.menu
  theirVenue = theirs.ids.venue
  // Drinks on the menu, and a paper bag in a section hidden on the website.
  const tree = await ok(owner.get('/api/menus/' + menuId))
  const body = menuSaveBody(tree)
  body.sections.push(
    { title: 'Zqc Drinks', items: [
      { name: 'Zqc Lemonade', price_pence: 300, is_orderable: true },
      { name: 'Zqc Cola', price_pence: 250, is_orderable: true },
    ] },
    { title: 'Zqc Extras', visibility: 'website_hidden', items: [{ name: 'Zqc Paper bag', price_pence: 10, is_orderable: true }] },
  )
  await ok(owner.patch('/api/menus/' + menuId, body), 'menu')
  await ok(owner.post(`/api/menus/${menuId}/publish`, {}), 'publish')
  const menu = await ok(owner.get('/api/menus/' + menuId))
  const dishes = menu.sections.flatMap(s => s.items.map(i => ({ ...i, section_id: s.id, section_visibility: s.visibility })))
  const named = n => dishes.find(i => i.name === n)
  curry = named('Zqx Green Curry')
  lemonade = named('Zqc Lemonade')
  cola = named('Zqc Cola')
  bag = named('Zqc Paper bag')
  assert.ok(curry && lemonade && cola && bag, 'the dishes')
  assert.equal(bag.section_visibility, 'website_hidden')
  bagFee = await ok(owner.post('/api/pos/charges', { name: 'Zqc Bag fee', kind: 'amount', value: 20, optional: false }))
  const types = await ok(owner.get('/api/order-types'))
  takeOut = types.find(t => t.name === 'Take out')
  eatIn = types.find(t => t.name === 'Eat in')
  collection = types.find(t => t.name === 'Collection')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  stream = setup.revenue_streams.find(r => r.is_active)
  // Online ordering counts under its own channel.
  web = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Zqc Web' }))
  const settings = await ok(owner.get(`/api/orders/settings/${V}`))
  const s = { ...settings.settings, revenue_stream_id: web.id }
  for (const k of ['venue_id', 'exists', 'tenant_id', 'created_at', 'updated_at', 'hours_extension', 'id']) delete s[k]
  await ok(owner.put(`/api/orders/settings/${V}`, s), 'ordering settings')
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Zqc Front kiosk', settings: { revenue_stream_id: stream.id } })
  kiosk2 = await linkDevice(owner, V, { kind: 'kiosk', name: 'Zqc Side kiosk', settings: { revenue_stream_id: stream.id } })
  theirKiosk = await linkDevice(other, theirVenue, { kind: 'kiosk', name: 'Yyc kiosk' })
  // Kiosks: a bag (staff only take it off) and its fee (removable) on take
  // out orders at the front kiosk; a drink offered when a curry goes in;
  // cola on every order at the side kiosk. Online: the bag, a cola the guest
  // may take off and the fee on the web channel's orders; a drink offered at
  // checkout. A till-only flow.
  kBag = await makeFlow('Zqc Kiosk bag', 'add', {
    apps: ['kiosk'], venue_ids: [V], kiosk_ids: [kiosk.device_id], match: { type_ids: [takeOut.id] },
    adds: [{ kind: 'dish', item_id: bag.id, qty: 1, removable: false }, { kind: 'charge', charge_id: bagFee.id, removable: true }],
  })
  kDrink = await makeFlow('Zqc Kiosk drink', 'ask', {
    apps: ['kiosk'], trigger: 'dish_added', match: { item_ids: [curry.id] },
    ask: { title: 'Zqc Something to drink?', message: 'Zqc Made here', item_ids: [lemonade.id, cola.id], pick: 'one' },
  })
  kSide = await makeFlow('Zqc Side kiosk cola', 'add', {
    apps: ['kiosk'], kiosk_ids: [kiosk2.device_id], adds: [{ kind: 'dish', item_id: cola.id, qty: 1, removable: true }],
  })
  tillOnly = await makeFlow('Zqc Till only', 'add', { apps: ['till'], venue_ids: [V2], adds: [{ kind: 'dish', item_id: lemonade.id, qty: 1, removable: true }] })
  oBag = await makeFlow('Zqc Online bag', 'add', {
    apps: ['online'], venue_ids: [V], match: { stream_names: ['zqc  web'] },
    adds: [
      { kind: 'dish', item_id: bag.id, qty: 1, removable: false },
      { kind: 'dish', item_id: cola.id, qty: 1, removable: true },
      { kind: 'charge', charge_id: bagFee.id, removable: true },
    ],
  })
  oDrink = await makeFlow('Zqc Online drink', 'ask', {
    apps: ['online'], trigger: 'checkout', match: { section_ids: [curry.section_id] },
    ask: { title: 'Zqc A drink with that?', item_ids: [lemonade.id], pick: 'one' },
  })
})
after(closeApp)

test('flows say where they run: apps, kiosks named, saved with only the company\'s own kiosks', async () => {
  assert.deepEqual([kBag.apps, kBag.kiosk_ids, kBag.till_ids], [['kiosk'], [kiosk.device_id], null])
  assert.equal(kBag.where, 'Zqx Ware · Zqc Front kiosk')
  assert.equal(oBag.where, 'Zqx Ware · online ordering')
  // Another group's kiosk is dropped; a till isn't a kiosk.
  const tillId = (await ok(owner.get(`/api/pos/venues/${V}/setup`))).devices.find(d => d.kind === 'terminal').id
  const saved = await ok(owner.put('/api/pos/order-flows/' + kSide.id, flowBody(kSide, {
    kiosk_ids: [kiosk2.device_id, theirKiosk.device_id, tillId],
  })))
  assert.deepEqual(saved.kiosk_ids, [kiosk2.device_id])
  // Online ordering only: no tills or kiosks to name.
  assert.deepEqual([oBag.apps, oBag.till_ids, oBag.kiosk_ids], [['online'], null, null])
  const nowhere = await owner.put('/api/pos/order-flows/' + kSide.id, flowBody(kSide, { apps: [] }))
  assert.equal(nowhere.status, 422, 'switched on, it needs somewhere to run')
  assert.ok(nowhere.json.problems.some(p => p.code === 'apps'), JSON.stringify(nowhere.json))
  // A name that isn't a place is dropped, as every other field is tidied.
  const phone = await owner.put('/api/pos/order-flows/' + kSide.id, flowBody(kSide, { apps: ['phone'] }))
  assert.equal(phone.status, 422)
  const kept = await ok(owner.put('/api/pos/order-flows/' + kSide.id, flowBody(kSide, { apps: ['phone', 'kiosk', 'kiosk'] })))
  assert.deepEqual(kept.apps, ['kiosk'])
  // The catalogue lists the kiosks, never another group's.
  const cat = await ok(owner.get('/api/pos/order-flows/catalog'))
  assert.ok(cat.kiosks.some(k => k.id === kiosk.device_id && k.venue_id === V))
  assert.ok(!cat.kiosks.some(k => k.id === theirKiosk.device_id))
  assert.ok(!cat.tills.some(t => t.id === kiosk.device_id), 'a kiosk is not a till')
})

test('a kiosk gets the flows that run on kiosks, the charges list, and the dishes they put on from a hidden section', async () => {
  const cfg = await kioskConfig(kiosk)
  const flowIds = cfg.settings.flows.map(f => f.id)
  for (const f of [kBag, kDrink, kSide]) assert.ok(flowIds.includes(f.id), f.name)
  for (const f of [tillOnly, oBag, oDrink]) assert.ok(!flowIds.includes(f.id), f.name + ' isn\'t a kiosk flow')
  assert.ok(cfg.settings.flows.every(f => f.on && f.apps.includes('kiosk')))
  assert.ok(cfg.settings.charges.some(x => x.id === bagFee.id), 'the charges list')
  // The bag: known to the kiosk, never on its menu.
  assert.ok(cfg.items[bag.id], 'the bag is known')
  assert.deepEqual(cfg.items[bag.id].hidden_menu_ids, [menuId])
  const listed = id => cfg.menus.some(m => m.sections.some(s => s.item_ids.includes(id)))
  assert.equal(listed(bag.id), false, 'not on the kiosk\'s menu')
  assert.equal(listed(lemonade.id), true)
  // With no kiosk flow putting it on, it isn't known (online's bag flow doesn't count).
  await ok(owner.patch('/api/pos/order-flows/' + kBag.id, { on: false }))
  const without = await kioskConfig(kiosk)
  assert.equal(without.items[bag.id], undefined)
  assert.ok(!without.settings.flows.some(f => f.id === kBag.id))
  await ok(owner.patch('/api/pos/order-flows/' + kBag.id, { on: true }))
  // Another group's kiosk gets none of these.
  const theirs = await kioskConfig(theirKiosk)
  assert.ok(!theirs.settings.flows.some(f => [kBag.id, kDrink.id, kSide.id].includes(f.id)))
  // The prompt's words can be translated.
  const sources = await ok(owner.get('/api/menus/translations?lang=es'))
  const keys = JSON.stringify(sources)
  assert.ok(keys.includes(TK.flow(kDrink.id, 'title')), 'the prompt\'s title')
  assert.ok(keys.includes(TK.flow(kDrink.id, 'message')), 'the prompt\'s line')
  assert.ok(!keys.includes(TK.flow(oDrink.id, 'title')), 'an online prompt isn\'t on the kiosk')
})

test('a kiosk order with what its flows put on goes through the sequencer as the kiosk built it', async () => {
  const cfg = await kioskConfig(kiosk)
  const dev = asDevice(kiosk)
  const curryEntry = { key: 'c', item_id: curry.id, selection: { choices: picks(cfg, curry) }, qty: 1 }
  let f = kioskFlows(cfg, [curryEntry], { device: dev, order_type_id: takeOut.id })
  assert.deepEqual(f.entries.map(e => [e.item_id, e.qty, e.flow.removable]), [[bag.id, 1, false]])
  assert.deepEqual(f.charges.map(x => [x.id, x.optional, x.flow.id]), [[bagFee.id, true, kBag.id]], 'optional as the flow says, not as the list has it')
  // The curry going in asks for a drink.
  assert.deepEqual(kioskPrompts(cfg, f, { trigger: 'dish_added', entry: curryEntry }).map(x => x.id), [kDrink.id])
  assert.deepEqual(kioskPrompts(cfg, f, { trigger: 'dish_added', entry: { key: 'l', item_id: lemonade.id, selection: {}, qty: 1 } }), [], 'not for a lemonade')
  // Eat in: no bag. The side kiosk: its own cola, not the front kiosk's bag.
  assert.deepEqual(kioskFlows(cfg, [curryEntry], { device: dev, order_type_id: eatIn.id }).entries, [])
  const side = kioskFlows(cfg, [curryEntry], { device: asDevice(kiosk2), order_type_id: takeOut.id })
  assert.deepEqual(side.entries.map(e => e.item_id), [cola.id])
  assert.deepEqual(side.charges, [])
  // An empty basket: nothing put on, though the cola flow has no conditions.
  assert.deepEqual(kioskFlows(cfg, [], { device: asDevice(kiosk2), order_type_id: takeOut.id }).entries, [])

  // The guest takes a lemonade from the prompt, and orders.
  const lemonEntry = { key: 'l', item_id: lemonade.id, selection: {}, qty: 1 }
  const asked = { [kDrink.id]: { n: 1, answer: 'added', item_ids: [lemonade.id] } }
  f = kioskFlows(cfg, [curryEntry, lemonEntry], { device: dev, order_type_id: takeOut.id, asked })
  assert.deepEqual(kioskPrompts(cfg, f, { trigger: 'dish_added', entry: curryEntry }), [], 'asked once')
  const checkId = ulid()
  const r = kioskOrder(cfg, [curryEntry, lemonEntry, ...f.entries], {
    device: dev, checkId, newId: ulid, order_type_id: takeOut.id, number: 7, order_no: 7,
    charges: f.charges, asked, payment: null, send: false,
  })
  assert.ok(r.ok, r.error)
  const res = await device(kiosk, 'POST', '/pos-api/events', { events: r.events })
  assert.equal(res.status, 200, res.body)
  assert.ok(res.json.results.every(x => x.ok), JSON.stringify(res.json.results))
  const [row] = await sql`SELECT state FROM pos_checks WHERE id = ${checkId}`
  const line = id => row.state.lines.find(l => l.item_id === id)
  assert.deepEqual(line(bag.id).flow, { id: kBag.id, key: addKey(kBag.id, kBag.adds[0]), removable: false })
  assert.equal(line(lemonade.id).flow, undefined, 'the guest\'s own pick')
  const fee = row.state.charges.find(x => x.id === bagFee.id)
  assert.deepEqual([fee.optional, fee.flow], [true, { id: kBag.id, key: addKey(kBag.id, kBag.adds[1]) }])
  assert.equal(row.state.flows_asked[kDrink.id].answer, 'added')
  assert.deepEqual(row.state.flows_asked[kDrink.id].item_ids, [lemonade.id])
  // What the kiosk showed is what the check comes to: the dishes, the bag at its price and its fee.
  assert.deepEqual([line(bag.id).unit_price, line(bag.id).qty, line(lemonade.id).unit_price], [10, 1, 300])
  const totals = checkTotals(row.state)
  assert.equal(totals.total, r.totals.total)
  assert.equal(totals.service_charge, 20)
})

test('what the guest takes off stays off; the bag can\'t be; the sequencer refuses a charge no flow put on', async () => {
  const cfg = await kioskConfig(kiosk)
  const dev = asDevice(kiosk)
  const curryEntry = { key: 'c', item_id: curry.id, selection: { choices: picks(cfg, curry) }, qty: 1 }
  const feeKey = addKey(kBag.id, kBag.adds[1])
  const bagKey = addKey(kBag.id, kBag.adds[0])
  const off = { [feeKey]: true, [bagKey]: true }
  const f = kioskFlows(cfg, [curryEntry], { device: dev, order_type_id: takeOut.id, off })
  assert.deepEqual(f.charges, [], 'the fee is off')
  assert.deepEqual(f.entries.map(e => e.item_id), [bag.id], 'the bag can\'t be taken off')
  assert.deepEqual(f.leftOff.map(w => [w.kind, w.charge_id]), [['charge', bagFee.id]], 'Add it back')
  const checkId = ulid()
  const r = kioskOrder(cfg, [curryEntry, ...f.entries], {
    device: dev, checkId, newId: ulid, order_type_id: takeOut.id, number: 8, order_no: 8,
    charges: f.charges, flows_off: { [feeKey]: true }, payment: { ref: 'T-1', label: 'Test card' }, send: false,
  })
  assert.ok(r.ok, r.error)
  const res = await device(kiosk, 'POST', '/pos-api/events', { events: r.events })
  assert.ok(res.json.results.every(x => x.ok), JSON.stringify(res.json.results))
  const [row] = await sql`SELECT state FROM pos_checks WHERE id = ${checkId}`
  assert.deepEqual(row.state.flows_off, { [feeKey]: true }, 'kept on the check, for a till that opens it')
  assert.deepEqual(row.state.charges, [])
  assert.equal(row.state.status, 'closed', 'paid by card')

  // The sequencer judges a kiosk's charges against its flows and the list.
  const open = ulid()
  const base = { venue_id: V, device_id: kiosk.device_id, staff_id: kiosk.device_id, check_id: open, client_at: new Date().toISOString() }
  const ev = (type, payload) => ({ ...base, id: ulid(), type, payload })
  const listed = { ...chargeFromList(cfg.settings.charges.find(x => x.id === bagFee.id), V, cfg.tax_rates), list: true }
  const send = async events => (await device(kiosk, 'POST', '/pos-api/events', { events })).json.results
  const opened = await send([ev('check.opened', { mode: 'counter', revenue_stream_id: stream.id, order_type_id: takeOut.id, number: 9, order_no: 9 })])
  assert.ok(opened[0].ok, JSON.stringify(opened))
  // From the list with no flow: a kiosk adds only its flows' charges.
  const plain = await send([ev('charge.added', { charge: { ...listed, optional: false } })])
  assert.equal(plain[0].code, 'kiosk')
  assert.match(plain[0].error, /order flows put on/)
  // Optional as no flow says (a wrong key): judged as the list has it, and refused.
  const wrong = await send([ev('charge.added', { charge: { ...listed, optional: true, flow: { id: kBag.id, key: bagKey } } })])
  assert.equal(wrong[0].code, 'charge')
  // As its flow says: on.
  const right = await send([ev('charge.added', { charge: { ...listed, optional: true, flow: { id: kBag.id, key: feeKey } } })])
  assert.ok(right[0].ok, JSON.stringify(right))
  // A flow switched off: its removable charge is judged as the list has it.
  await ok(owner.patch('/api/pos/order-flows/' + kBag.id, { on: false }))
  const another = ulid()
  const opened2 = await send([{ ...ev('check.opened', { mode: 'counter', revenue_stream_id: stream.id, order_type_id: takeOut.id, number: 10, order_no: 10 }), check_id: another }])
  assert.ok(opened2[0].ok)
  const offFlow = await send([{ ...ev('charge.added', { charge: { ...listed, optional: true, flow: { id: kBag.id, key: feeKey } } }), check_id: another }])
  assert.equal(offFlow[0].code, 'charge')
  await ok(owner.patch('/api/pos/order-flows/' + kBag.id, { on: true }))
  // A prompt's answer must be one the rules know; a check opened with a key that isn't one is refused.
  assert.equal((await send([ev('check.flow_asked', { flow_id: kDrink.id, answer: 'maybe' })]))[0].code, 'invalid')
  const badOff = await send([{ ...ev('check.opened', { mode: 'counter', revenue_stream_id: stream.id, number: 11, order_no: 11, flows_off: { nope: true } }), check_id: ulid() }])
  assert.equal(badOff[0].code, 'invalid')
})

test('online ordering\'s page gets its flows without their names, and the dishes they put on', async () => {
  const page = await ok(guest.get(`/order-api/venues/${V}`))
  assert.ok(page.flows, 'flows run here')
  const listIds = page.flows.list.map(f => f.id)
  assert.ok(listIds.includes(oBag.id) && listIds.includes(oDrink.id))
  for (const f of [kBag, kDrink, kSide, tillOnly]) assert.ok(!listIds.includes(f.id), f.name + ' doesn\'t run online')
  assert.ok(page.flows.list.every(f => f.name === '' && f.venue_ids == null && f.kiosk_ids == null && f.till_ids == null), 'no staff words or places')
  assert.deepEqual(page.flows.here.streams, { [web.id]: 'Zqc Web' })
  assert.equal(page.flows.order_type_id, collection.id)
  assert.deepEqual([page.flows.charges[bagFee.id].kind, page.flows.charges[bagFee.id].value], ['amount', 20])
  // The bag comes with the page though its section is hidden on the website; it isn't on the menu.
  assert.equal(page.flows.items[bag.id]?.price_pence, 10)
  const onMenu = page.menus.flatMap(m => m.sections.flatMap(s => s.items.map(i => i.id)))
  assert.equal(onMenu.includes(bag.id), false)
  assert.equal(onMenu.includes(lemonade.id), true)
  // The shared files the page imports for them.
  for (const f of ['/order-api/pos/orderFlows.js', '/order-api/pos/charges.js', '/order-api/pos/ids.js', '/order-api/tax.js']) {
    const r = await guest.get(f)
    assert.equal(r.status, 200, f)
    assert.match(r.headers['content-type'], /javascript/)
  }
  // Another group's page: none of these.
  const theirs = await ok(guest.get(`/order-api/venues/${theirVenue}`))
  assert.ok(!(theirs.flows?.list || []).some(f => [oBag.id, oDrink.id].includes(f.id)))
})

test('the quote works the flows out from the guest\'s own dishes; only removable ones come off', async () => {
  const page = await ok(guest.get(`/order-api/venues/${V}`))
  const item = page.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(i => i.id === curry.id)
  const lines = [{ item_id: curry.id, qty: 1, choices: onlinePicks(item) }]
  const q = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines }))
  assert.deepEqual(q.lines.map(l => [l.item_id, l.flow?.removable ?? null]), [[curry.id, null], [bag.id, false], [cola.id, true]])
  assert.deepEqual(q.charges.map(x => [x.id, x.amount_pence, x.removable]), [[bagFee.id, 20, true]])
  assert.equal(q.charges_pence, 20)
  assert.equal(q.own_subtotal_pence, q.lines[0].line_total_pence, 'the guest\'s own dishes')
  assert.equal(q.subtotal_pence, q.own_subtotal_pence + 10 + 250)
  assert.equal(q.total_pence, q.subtotal_pence - q.discount_pence + q.charges_pence + q.tip_pence)
  // Taking off: the cola and the fee come off, the bag stays; Add it back lists them.
  const colaKey = addKey(oBag.id, oBag.adds[1])
  const feeKey = addKey(oBag.id, oBag.adds[2])
  const bagKey = addKey(oBag.id, oBag.adds[0])
  const off = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines, flows_off: [colaKey, feeKey, bagKey, 'not-a-key'] }))
  assert.deepEqual(off.lines.map(l => l.item_id), [curry.id, bag.id])
  assert.deepEqual(off.charges, [])
  assert.deepEqual(off.flows_off.map(w => w.key).sort(), [colaKey, feeKey].sort())
  // A line can't bring its own flow mark: a guest's lemonade is the guest's.
  const marked = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines: [...lines, { item_id: lemonade.id, qty: 1, flow: { id: oBag.id, key: colaKey, removable: true } }] }))
  assert.equal(marked.lines.find(l => l.item_id === lemonade.id).flow, undefined)
  // Nothing of the guest's: nothing put on.
  const empty = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines: [] }))
  assert.deepEqual([empty.lines, empty.charges, empty.total_pence], [[], [], 0])
})

test('an order keeps what the flows put on: dishes, the charge, the prompts asked, what was taken off', async () => {
  const page = await ok(guest.get(`/order-api/venues/${V}`))
  const item = page.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(i => i.id === curry.id)
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
  const slots = await ok(guest.get(`/order-api/venues/${V}/slots?date=${tomorrow}`))
  const at = slots.slots.find(s => s.available)?.at
  assert.ok(at, 'a collection time tomorrow')
  const colaKey = addKey(oBag.id, oBag.adds[1])
  const bagKey = addKey(oBag.id, oBag.adds[0])
  const lines = [{ item_id: curry.id, qty: 2, choices: onlinePicks(item) }, { item_id: lemonade.id, qty: 1 }]
  const quote = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines, flows_off: [colaKey, bagKey] }))
  const placed = await guest.post(`/order-api/venues/${V}/orders`, {
    lines, when: at, data_consent: true, payment_method: 'pay_at_venue',
    customer: { name: 'Fran Flow', email: 'fran@zqx.test', phone: '07700900444' },
    flows_off: [colaKey, bagKey],
    flows_asked: [{ flow_id: oDrink.id, answer: 'added', item_ids: [lemonade.id] }, { flow_id: kDrink.id, answer: 'declined' }],
  })
  assert.equal(placed.status, 201, placed.body)
  const [order] = await sql`SELECT * FROM orders WHERE public_token = ${placed.json.token}`
  assert.equal(order.total_pence, quote.total_pence, 'what the guest was shown')
  assert.equal(order.charges_pence, 20)
  assert.equal(order.total_pence, order.subtotal_pence - order.discount_pence + order.charges_pence + order.tip_pence)
  assert.deepEqual(order.charges.map(x => [x.id, x.amount_pence, x.flow.id]), [[bagFee.id, 20, oBag.id]])
  assert.deepEqual(Object.keys(order.flows.asked), [oDrink.id], 'only this order\'s flows')
  assert.equal(order.flows.asked[oDrink.id].answer, 'added')
  assert.deepEqual(order.flows.off, { [colaKey]: true }, 'only a removable one stays off')
  const items = await sql`SELECT menu_item_id, qty, unit_price_pence, flow FROM order_items WHERE order_id = ${order.id} ORDER BY sort_order`
  assert.deepEqual(items.map(i => [i.menu_item_id, i.qty, i.flow]), [
    [curry.id, 2, null], [lemonade.id, 1, null], [bag.id, 1, { id: oBag.id, key: bagKey, removable: false }],
  ])
  // The guest's status page and staff's order show the charge and the bag.
  const status = await ok(guest.get('/order-api/orders/' + placed.json.token))
  assert.deepEqual(status.charges.map(x => [x.name, x.amount_pence]), [['Zqc Bag fee', 20]])
  assert.equal(status.charges_pence, 20)
  assert.deepEqual(status.items.find(i => i.name === 'Zqc Paper bag').flow, { removable: false })
  assert.equal(JSON.stringify(status).includes(oBag.id), false, 'no flow ids for the guest')
  const staff = await ok(owner.get('/api/orders/' + order.id))
  assert.deepEqual(staff.charges.map(x => x.amount_pence), [20])
  assert.equal(staff.charges_pence, 20)
  assert.equal((await other.get('/api/orders/' + order.id)).status, 404)
})

test('the minimum order counts the guest\'s own dishes; a flow switched off puts nothing on', async () => {
  const page = await ok(guest.get(`/order-api/venues/${V}`))
  const item = page.menus.flatMap(m => m.sections.flatMap(s => s.items)).find(i => i.id === curry.id)
  const lines = [{ item_id: curry.id, qty: 1, choices: onlinePicks(item) }]
  const q = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines }))
  const own = q.own_subtotal_pence
  const settings = await ok(owner.get(`/api/orders/settings/${V}`))
  const s = { ...settings.settings }
  for (const k of ['venue_id', 'exists', 'tenant_id', 'created_at', 'updated_at', 'hours_extension', 'id']) delete s[k]
  await ok(owner.put(`/api/orders/settings/${V}`, { ...s, min_order_pence: own + 100 }))
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
  const at = (await ok(guest.get(`/order-api/venues/${V}/slots?date=${tomorrow}`))).slots.find(x => x.available)?.at
  const order = { lines, when: at, data_consent: true, payment_method: 'pay_at_venue', customer: { name: 'Min Mo', email: 'mo@zqx.test', phone: '07700900555' } }
  // The bag and the cola would take it over the minimum; they don't count.
  assert.ok(q.subtotal_pence >= own + 100)
  const short = await guest.post(`/order-api/venues/${V}/orders`, order)
  assert.equal(short.status, 422, short.body)
  assert.equal(short.json.code, 'min_order')
  await ok(owner.put(`/api/orders/settings/${V}`, { ...s, min_order_pence: 0 }))
  // Switched off: the quote puts nothing on.
  await ok(owner.patch('/api/pos/order-flows/' + oBag.id, { on: false }))
  const off = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines }))
  assert.deepEqual([off.lines.length, off.charges.length], [1, 0])
  await ok(owner.patch('/api/pos/order-flows/' + oBag.id, { on: true }))
  // Not the web channel any more: nothing either.
  await ok(owner.put(`/api/orders/settings/${V}`, { ...s, revenue_stream_id: null }))
  const elsewhere = await ok(guest.post(`/order-api/venues/${V}/quote`, { lines }))
  assert.deepEqual([elsewhere.lines.length, elsewhere.charges.length], [1, 0])
  await ok(owner.put(`/api/orders/settings/${V}`, { ...s, revenue_stream_id: web.id }))
  // View can't change flows.
  assert.equal((await viewer.patch('/api/pos/order-flows/' + oBag.id, { on: false })).status, 403)
})
