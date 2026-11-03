// Order flows for guests (migration 236, shared/pos/orderFlows.js): on a
// kiosk (shared/kiosk.js kioskFlows(), kioskPrompts(), kioskOrder()) and on
// online ordering (shared/orderPricing.js priceBasket() with flows): what
// add flows put in the basket by themselves, what the guest may take off,
// the prompts due, and the order that goes to the till or the server.
// Run: node --test shared/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { ulid } from '../pos/ids.js'
import { replay } from '../pos/checks.js'
import { kioskFlows, kioskPrompts, kioskOrder, basketCheck, kioskStaff } from '../kiosk.js'
import { priceBasket, itemChoices } from '../orderPricing.js'
import { normaliseOrderFlow, addKey } from '../pos/orderFlows.js'
import { chargeFromList, normaliseCharge } from '../pos/charges.js'

const uuid = () => globalThis.crypto.randomUUID()

// ── A small kiosk config (services/kioskSvc.js shape) ──────────
const VENUE = uuid(), STREAM = uuid(), EAT_IN = uuid(), TAKE_OUT = uuid(), R20 = uuid()
const MAINS = uuid(), DRINKS = uuid(), EXTRAS = uuid()
const FLAVOUR = uuid(), LEMON = uuid()
const WINGS = { id: uuid(), name: 'Wings', section_id: MAINS, price_pence: 800, kind: 'dish', tax: [{}, {}, {}],
  variant_groups: [{ group_id: FLAVOUR, name: 'Flavour', price_mode: 'extra', min_select: 1, max_select: 1, options: [{ option_id: LEMON, label: 'Lemon pepper', price_pence: 0 }] }] }
const COLA = { id: uuid(), name: 'Cola', section_id: DRINKS, price_pence: 250, kind: 'dish', tax: [{}, {}, {}], variant_groups: [] }
const WATER = { id: uuid(), name: 'Water', section_id: DRINKS, price_pence: 150, kind: 'dish', tax: [{}, {}, {}], variant_groups: [] }
const BAG = { id: uuid(), name: 'Paper bag', section_id: EXTRAS, price_pence: 10, kind: 'dish', tax: [{}, {}, {}], variant_groups: [] }
const SAUCE = { id: uuid(), name: 'Sauce pot', section_id: EXTRAS, price_pence: 50, kind: 'dish', tax: [{}, {}, {}],
  variant_groups: [{ group_id: FLAVOUR, name: 'Flavour', price_mode: 'extra', min_select: 1, max_select: 1, options: [{ option_id: LEMON, label: 'Lemon pepper', price_pence: 0 }] }] }
const BAG_CHARGE = normaliseCharge({ id: uuid(), name: 'Packaging', kind: 'amount', value: 20, optional: false, min_covers: 0, tax_rate_id: R20 })
const SERVICE = normaliseCharge({ id: uuid(), name: 'Service', kind: 'percent', value: 10, optional: true, min_covers: 0, tax_rate_id: null })
const PARTY = normaliseCharge({ id: uuid(), name: 'Party', kind: 'percent', value: 12.5, optional: false, min_covers: 6, tax_rate_id: null })

// Take out: a paper bag nobody may take off, a water the guest may, and the packaging charge.
const TAKE_OUT_FLOW = normaliseOrderFlow({
  id: uuid(), name: 'Take out', kind: 'add', apps: ['kiosk', 'online'], match: { type_ids: [TAKE_OUT] },
  adds: [
    { kind: 'dish', item_id: BAG.id, qty: 1, removable: false },
    { kind: 'dish', item_id: WATER.id, qty: 1, removable: true },
    { kind: 'dish', item_id: SAUCE.id, qty: 1, removable: true },
    { kind: 'charge', charge_id: BAG_CHARGE.id, removable: true },
    { kind: 'charge', charge_id: PARTY.id, removable: false },
  ],
})
// Ask "Add a drink?" when wings are added; at checkout, a sauce.
const DRINK_ASK = normaliseOrderFlow({
  id: uuid(), name: 'Drink', kind: 'ask', trigger: 'dish_added', apps: ['kiosk', 'online'],
  match: { section_ids: [MAINS] }, ask: { title: 'Add a drink?', item_ids: [COLA.id, WATER.id] },
})
const CHECKOUT_ASK = normaliseOrderFlow({
  id: uuid(), name: 'Sauce', kind: 'ask', trigger: 'checkout', apps: ['kiosk'],
  match: {}, ask: { title: 'A sauce?', item_ids: [COLA.id], skip_if_has: false },
})
// A till-only flow: never on a kiosk or online.
const TILL_ONLY = normaliseOrderFlow({
  id: uuid(), name: 'Till', kind: 'add', apps: ['till'], match: {},
  adds: [{ kind: 'charge', charge_id: SERVICE.id, removable: false }],
})
const FLOWS = [TAKE_OUT_FLOW, DRINK_ASK, CHECKOUT_ASK, TILL_ONLY]

const config = {
  venue: { id: VENUE, name: 'Ware', timezone: 'Europe/London' },
  stream: { id: STREAM, name: 'Kiosk' },
  tax_rates: [{ id: R20, name: 'Standard', is_default: true, values: { [VENUE]: 20 } }],
  items: Object.fromEntries([WINGS, COLA, WATER, BAG, SAUCE].map(i => [i.id, structuredClone(i)])),
  groups: { [FLAVOUR]: { id: FLAVOUR, name: 'Flavour', price_mode: 'extra', min_select: 1, max_select: 1, options: [{ id: LEMON, label: 'Lemon pepper', price_pence: 0 }] } },
  section_items: { [MAINS]: [WINGS.id], [DRINKS]: [COLA.id, WATER.id], [EXTRAS]: [BAG.id, SAUCE.id] },
  promotions: [], sold_out: [],
  settings: { flows: FLOWS, charges: [BAG_CHARGE, SERVICE, PARTY] },
}
const KIOSK = { id: uuid(), venue_id: VENUE, name: 'Kiosk 1', short_code: 'KS1' }
const wings = () => ({ key: 'w1', item_id: WINGS.id, qty: 1, selection: { choices: { [FLAVOUR]: [{ id: LEMON }] } } })
const keyOf = i => addKey(TAKE_OUT_FLOW.id, TAKE_OUT_FLOW.adds[i])

test('kiosk: what add flows put in the basket, and what they leave off', () => {
  const eatIn = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: EAT_IN })
  assert.deepEqual(eatIn.entries, [])
  assert.deepEqual(eatIn.charges, [], 'a till-only flow never runs on a kiosk')
  const f = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: TAKE_OUT })
  // The bag and the water; the sauce pot has a choice to make, so it is left off.
  assert.deepEqual(f.entries.map(e => [e.item_id, e.flow.removable]), [[BAG.id, false], [WATER.id, true]])
  assert.equal(f.entries[0].key, 'flow:' + keyOf(0))
  // The packaging charge (optional as the flow says) with its VAT; the party
  // charge counts from 6 guests: a kiosk has no guest count.
  assert.deepEqual(f.charges.map(x => [x.id, x.optional, x.vat_rate, x.list, x.flow.key]), [[BAG_CHARGE.id, true, 20, true, keyOf(3)]])
  // The guest takes the water and the charge off; the bag can't be.
  const off = { [keyOf(0)]: true, [keyOf(1)]: true, [keyOf(3)]: true }
  const g = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: TAKE_OUT, off })
  assert.deepEqual(g.entries.map(e => e.item_id), [BAG.id])
  assert.deepEqual(g.charges, [])
  assert.deepEqual(g.leftOff.map(w => w.item_id || w.charge_id), [WATER.id, BAG_CHARGE.id])
  // Sold out, or not on the menus on now: left off.
  const sold = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: TAKE_OUT, soldOut: new Set([BAG.id]), isOn: id => id !== WATER.id })
  assert.deepEqual(sold.entries, [])
  // The flows' own entries in the basket never count, nor set flows off.
  const onlyFlow = kioskFlows(config, f.entries, { device: KIOSK, order_type_id: EAT_IN })
  assert.deepEqual(onlyFlow.entries, [])
  // A kiosk the flow doesn't name.
  const other = kioskFlows({ ...config, settings: { ...config.settings, flows: [{ ...TAKE_OUT_FLOW, kiosk_ids: [uuid()] }] } }, [wings()], { device: KIOSK, order_type_id: TAKE_OUT })
  assert.deepEqual(other.entries, [])
  // An empty basket: nothing until the guest has a dish of their own.
  const empty = kioskFlows(config, [], { device: KIOSK, order_type_id: TAKE_OUT })
  assert.deepEqual([empty.entries, empty.charges, empty.leftOff], [[], [], []])
})

test('kiosk: the prompts due when a dish is added and at checkout', () => {
  const f = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: EAT_IN })
  assert.deepEqual(kioskPrompts(config, f, { trigger: 'dish_added', entry: wings() }).map(x => x.id), [DRINK_ASK.id])
  // A drink added sets nothing off.
  assert.deepEqual(kioskPrompts(config, f, { trigger: 'dish_added', entry: { item_id: COLA.id, qty: 1, selection: {} } }), [])
  // Already asked on this order: not again.
  const asked = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: EAT_IN, asked: { [DRINK_ASK.id]: { n: 1, answer: 'declined', item_ids: [] } } })
  assert.deepEqual(kioskPrompts(config, asked, { trigger: 'dish_added', entry: wings() }), [])
  // At checkout.
  assert.deepEqual(kioskPrompts(config, f, { trigger: 'checkout' }).map(x => x.id), [CHECKOUT_ASK.id])
  // Nothing it offers can be had (sold out): no prompt.
  assert.deepEqual(kioskPrompts(config, f, { trigger: 'checkout', soldOut: new Set([COLA.id]) }), [])
  // Nor what isn't on the menus on now.
  assert.deepEqual(kioskPrompts(config, f, { trigger: 'dish_added', entry: wings(), shownIds: new Set([WINGS.id]) }), [])
})

test('kiosk: the order sent carries the flow dishes, the charges, the prompts asked and what was taken off', () => {
  const off = { [keyOf(1)]: true }
  const f = kioskFlows(config, [wings()], { device: KIOSK, order_type_id: TAKE_OUT, off })
  const asked = { [DRINK_ASK.id]: { n: 1, answer: 'added', item_ids: [COLA.id] } }
  const basket = [wings(), { key: 'c1', item_id: COLA.id, qty: 1, selection: {} }, ...f.entries]
  const r = kioskOrder(config, basket, {
    device: KIOSK, checkId: ulid(), newId: () => ulid(), order_type_id: TAKE_OUT,
    charges: f.charges, asked, flows_off: off,
  })
  assert.ok(r.ok, r.error)
  assert.deepEqual(r.events.map(e => e.type), ['check.opened', 'line.added', 'line.added', 'line.added', 'charge.added', 'check.flow_asked'])
  assert.deepEqual(r.check.flows_off, off)
  assert.equal(r.check.flows_asked[DRINK_ASK.id].answer, 'added')
  const bag = r.check.lines.find(l => l.item_id === BAG.id)
  assert.deepEqual(bag.flow, { id: TAKE_OUT_FLOW.id, key: keyOf(0), removable: false })
  assert.equal(r.check.charges[0].name, 'Packaging')
  // 800 wings + 250 cola + 10 bag + 20 packaging.
  assert.equal(r.totals.total, 1080)
  // What the order page shows agrees.
  assert.equal(basketCheck(config, basket, { device: KIOSK, order_type_id: TAKE_OUT, charges: f.charges }).totals.total, 1080)
  // The till's sequencer takes the same events (the kiosk's flows in the venue's settings).
  const seq = replay({}, r.events, { staffById: { [KIOSK.id]: kioskStaff(KIOSK) }, settings: config.settings })
  assert.deepEqual(seq.refused, [])
  // A charge the flows don't put on is refused on the kiosk itself.
  const bad = kioskOrder(config, [wings()], {
    device: KIOSK, checkId: ulid(), newId: () => ulid(), order_type_id: TAKE_OUT,
    charges: [{ ...chargeFromList(SERVICE, VENUE, config.tax_rates), list: true, optional: true }],
  })
  assert.equal(bad.ok, false)
})

// ── Online ordering ────────────────────────────────────────────
const itemsById = Object.fromEntries([WINGS, COLA, WATER, BAG, SAUCE].map(i => [i.id, { ...i, vat_rate: 20, choices: itemChoices(i) }]))
const flowsFor = (type, off = {}, extra = {}) => ({
  list: FLOWS, here: { venueId: VENUE, app: 'online', streams: { [STREAM]: 'Online' } },
  revenue_stream_id: STREAM, order_type_id: type, off,
  charges: Object.fromEntries([BAG_CHARGE, SERVICE, PARTY].map(x => [x.id, chargeFromList(x, VENUE, config.tax_rates)])),
  ...extra,
})
const line = (item, qty = 1, choices = {}) => ({ item_id: item.id, qty, choices })

test('online: the flows\' dishes and charges, priced on the server from the basket', () => {
  const p = priceBasket(itemsById, [line(WINGS, 1, { [FLAVOUR]: [LEMON] })], { flows: flowsFor(TAKE_OUT) })
  assert.deepEqual(p.errors, [])
  // Wings, then the bag and the water; the sauce pot has a choice: left off.
  assert.deepEqual(p.lines.map(l => [l.name, l.flow?.removable ?? null]), [['Wings', null], ['Paper bag', false], ['Water', true]])
  assert.equal(p.subtotal_pence, 800 + 10 + 150)
  // The packaging charge (20p) after every discount; the party one (from 6 guests) never online.
  assert.deepEqual(p.charges.map(x => [x.name, x.amount_pence, x.removable]), [['Packaging', 20, true]])
  assert.equal(p.charges_pence, 20)
  assert.equal(p.total_pence, 960 + 20)
  // VAT includes the charge's (20% of 20p, included).
  const eatIn = priceBasket(itemsById, [line(WINGS, 1, { [FLAVOUR]: [LEMON] })], { flows: flowsFor(EAT_IN) })
  // 20% included: the bag 10p (2p), the water 150p (25p), the charge 20p (3p).
  assert.equal(p.vat_pence - eatIn.vat_pence, 2 + 25 + 3)
  // The guest takes off the water and the charge, and tries the bag: it stays.
  const off = { [keyOf(0)]: true, [keyOf(1)]: true, [keyOf(3)]: true }
  const q = priceBasket(itemsById, [line(WINGS, 1, { [FLAVOUR]: [LEMON] })], { flows: flowsFor(TAKE_OUT, off) })
  assert.deepEqual(q.lines.map(l => l.name), ['Wings', 'Paper bag'])
  assert.deepEqual(q.charges, [])
  assert.equal(q.total_pence, 810)
  assert.deepEqual(q.flows_off.map(w => w.item_id || w.charge_id), [WATER.id, BAG_CHARGE.id])
  // Not take out: nothing.
  assert.deepEqual(eatIn.lines.map(l => l.name), ['Wings'])
  assert.equal(eatIn.total_pence, 800)
  // A dish not on at the time, or sold out: left off.
  const later = priceBasket(itemsById, [line(WINGS, 1, { [FLAVOUR]: [LEMON] })], { flows: flowsFor(TAKE_OUT, {}, { itemOk: id => id !== BAG.id }) })
  assert.deepEqual(later.lines.map(l => l.name), ['Wings', 'Water'])
  const sold = priceBasket({ ...itemsById, [WATER.id]: { ...itemsById[WATER.id], sold_out: true } }, [line(WINGS, 1, { [FLAVOUR]: [LEMON] })], { flows: flowsFor(TAKE_OUT) })
  assert.deepEqual(sold.lines.map(l => l.name), ['Wings', 'Paper bag'])
  // Nothing of the guest's own: nothing put on (a bag never sits in an empty basket).
  const empty = priceBasket(itemsById, [], { flows: flowsFor(TAKE_OUT) })
  assert.deepEqual([empty.lines, empty.charges, empty.total_pence], [[], [], 0])
  // Without flows, as before.
  const none = priceBasket(itemsById, [line(WINGS, 1, { [FLAVOUR]: [LEMON] })])
  assert.deepEqual(none.charges, [])
  assert.equal(none.total_pence, 800)
})

test('online: a percent charge counts the dishes after discounts; the tip only the dishes', () => {
  const pct = normaliseOrderFlow({ id: uuid(), name: 'Service', kind: 'add', apps: ['online'], match: {}, adds: [{ kind: 'charge', charge_id: SERVICE.id, removable: false }] })
  const flows = { ...flowsFor(EAT_IN), list: [pct] }
  const promos = [{ id: uuid(), name: '10% off', kind: 'basket', value_type: 'percent', value: 10, apply_mode: 'auto', schedule: null, venue_ids: null, on: true, is_active: true, channels: ['web'] }]
  const p = priceBasket(itemsById, [line(COLA, 4)], { flows, promos, promoCtx: { at: { date: '2026-11-03', time: '12:00', dow: 2 }, venueId: VENUE }, tipPercent: 10 })
  assert.equal(p.subtotal_pence, 1000)
  const net = p.subtotal_pence - p.discount_pence
  assert.equal(p.charges[0].amount_pence, Math.round(net * 10 / 100))
  assert.equal(p.tip_pence, Math.round(net * 10 / 100))
  assert.equal(p.total_pence, net + p.charges_pence + p.tip_pence)
  assert.equal(p.charges[0].removable, false)
})
