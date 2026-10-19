// Kiosk tests: the design settings, the built-in words in every language,
// the translation keys, a basket as till events, the kiosk rules in the
// check rules and the sequencer taking a kiosk order.
// Run: node --test shared/test/ shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseDesign, designProblems, payMethods, uiText, allergenName, translationSources, TK, splitImages,
  kioskOrder, basketCheck, kioskStaff, kioskFontsUrl, UI_TEXT, ALLERGEN_NAMES, KIOSK_LANGUAGES,
} from '../kiosk.js'
import { applyEvent, KIOSK_EVENTS } from '../pos/checks.js'
import { checkTotals } from '../pos/pricing.js'
import { createSequencer } from '../pos/sequencer.js'
import { ulid } from '../pos/ids.js'
import { STANDARD_ALLERGENS } from '../menuTags.js'

const uuid = () => globalThis.crypto.randomUUID()

// ── A small kiosk config (services/kioskSvc.js shape) ──────────
const VENUE = uuid(), STREAM = uuid(), EAT_IN = uuid(), TAKE_OUT = uuid()
const R20 = uuid(), R0 = uuid()
const SECTION = uuid(), DRINKS = uuid()
const FLAVOUR = uuid(), LEMON = uuid(), HOT = uuid(), EXTRAS = uuid(), DIP = uuid()
const WINGS = { id: uuid(), name: 'Wings', section_id: SECTION, price_pence: 800, kind: 'dish', tax: [{}, {}, {}],
  variant_groups: [{ group_id: FLAVOUR, name: 'Flavour', price_mode: 'extra', min_select: 1, max_select: 2, options: [{ option_id: LEMON, label: 'Lemon pepper', price_pence: 0 }, { option_id: HOT, label: 'Atomic', price_pence: 50 }] }] }
const FRIES = { id: uuid(), name: 'Fries', section_id: SECTION, price_pence: 300, kind: 'dish', tax: [{}, {}, {}], variant_groups: [] }
const COLA = { id: uuid(), name: 'Cola', section_id: DRINKS, price_pence: 250, kind: 'dish', tax: [{}, {}, {}],
  variant_groups: [{ group_id: EXTRAS, name: 'Dips', price_mode: 'extra', min_select: 0, max_select: 3, allow_repeat: true, options: [{ option_id: DIP, label: 'Ranch', price_pence: 70 }] }] }
const MAIN = uuid(), SIDE = uuid(), M1 = uuid(), S1 = uuid()
const MEAL = { id: uuid(), name: 'Wing meal', section_id: SECTION, price_pence: 1000, kind: 'combo', tax: [{}, {}, {}], variant_groups: [],
  combo: { mode: 'auto', steps: [
    { id: MAIN, name: 'Main', min: 1, max: 1, auto: false, display: 'slider', options: [{ id: M1, type: 'item', item_id: WINGS.id, price_pence: 0 }] },
    { id: SIDE, name: 'Side', min: 1, max: 1, auto: false, options: [{ id: S1, type: 'item', item_id: FRIES.id, price_pence: 0 }] },
  ] } }
const config = {
  venue: { id: VENUE, name: 'Ware', timezone: 'Europe/London' },
  stream: { id: STREAM, name: 'Kiosk' },
  tax_rates: [
    { id: R20, name: 'Standard', is_default: true, values: { [VENUE]: 20 } },
    { id: R0, name: 'Zero', values: { [VENUE]: 0 } },
  ],
  items: Object.fromEntries([WINGS, FRIES, COLA, MEAL].map(i => [i.id, structuredClone(i)])),
  groups: {
    [FLAVOUR]: { id: FLAVOUR, name: 'Flavour', price_mode: 'extra', min_select: 1, max_select: 2, options: [{ id: LEMON, label: 'Lemon pepper', price_pence: 0 }, { id: HOT, label: 'Atomic', price_pence: 50 }] },
    [EXTRAS]: { id: EXTRAS, name: 'Dips', price_mode: 'extra', min_select: 0, max_select: 3, allow_repeat: true, options: [{ id: DIP, label: 'Ranch', price_pence: 70 }] },
  },
  section_items: { [SECTION]: [WINGS.id, FRIES.id, MEAL.id], [DRINKS]: [COLA.id] },
  promotions: [], sold_out: [],
}
const KIOSK = { id: uuid(), venue_id: VENUE, name: 'Kiosk 1' }
const TILL_PERSON = uuid()
const staffById = { [KIOSK.id]: kioskStaff(KIOSK), [TILL_PERSON]: { id: TILL_PERSON, name: 'Anna', permissions: { void: true } } }

const wings = (flavours = [LEMON]) => ({ item_id: WINGS.id, qty: 1, selection: { choices: { [FLAVOUR]: flavours.map(id => ({ id })) } } })
const order = (basket, extra = {}) => kioskOrder(config, basket, { device: KIOSK, checkId: ulid(), newId: () => ulid(), order_type_id: EAT_IN, ...extra })

// ── Design ─────────────────────────────────────────────────────

test('design: defaults, clamps, drops what it does not know', () => {
  const d = normaliseDesign({
    brand: { colors: { primary: '#FF0000', text: 'red' }, radius: 99, font_heading: 'Comic Sans' },
    start: { media: [{ type: 'video', url: '/uploads/a.mp4' }, { url: 'javascript:alert(1)' }], type_cards: { [EAT_IN]: { label: "I'm staying", icon: 'eat_in' }, nope: {} } },
    languages: { source: 'es', enabled: ['en', 'xx', 'es', 'fr'] },
    menu: { columns: 9, hidden_section_ids: [SECTION, 'bad'], banners: [{ image_url: '/b.jpg', link: { kind: 'item', id: WINGS.id } }] },
    behaviour: { idle_secs: 2 },
    junk: true,
  })
  assert.equal(d.brand.colors.primary, '#ff0000')
  assert.equal(d.brand.colors.text, '#1b1b1b')
  assert.equal(d.brand.radius, 32)
  assert.equal(d.brand.font_heading, 'Oswald')
  assert.deepEqual(d.start.media.map(m => m.type), ['video'])
  assert.deepEqual(Object.keys(d.start.type_cards), [EAT_IN])
  assert.deepEqual(d.languages, { source: 'es', enabled: ['es', 'en', 'fr'] })
  assert.equal(d.menu.columns, 4)
  assert.deepEqual(d.menu.hidden_section_ids, [SECTION])
  assert.equal(d.menu.banners[0].link.kind, 'item')
  assert.equal(d.behaviour.idle_secs, 20)
  assert.equal(d.junk, undefined)
  assert.deepEqual(normaliseDesign(d), d)
  assert.match(kioskFontsUrl(d), /family=Oswald/)
})

test('design: layout, section tiles and the spin wheel', () => {
  const plain = normaliseDesign({})
  assert.deepEqual(plain.layout, { tiles: 'cards', header: true, icon_buttons: false })
  assert.equal(plain.menu.rail, 'images')
  assert.deepEqual(plain.menu.section_tiles, [])
  assert.equal(plain.options.wheel_spin, true)
  assert.equal(plain.options.wheel_spin_picks, false)
  const d = normaliseDesign({
    layout: { tiles: 'hexagon', header: false, icon_buttons: 1, extra: true },
    menu: { rail: 'none', section_tiles: [
      { section_id: DRINKS, image_url: '/d.jpg', title: '  Drinks and shakes ', size: 'wide' },
      { section_id: DRINKS, title: 'Twice' },
      { section_id: 'not-a-section', title: 'Bad' },
      { section_id: SECTION, image_url: 'javascript:x', size: 'huge' },
    ] },
    options: { wheel_spin: false, wheel_spin_picks: 'yes' },
  })
  assert.deepEqual(d.layout, { tiles: 'hexagon', header: false, icon_buttons: true })
  assert.equal(d.menu.rail, 'none')
  assert.deepEqual(d.menu.section_tiles, [
    { section_id: DRINKS, image_url: '/d.jpg', title: 'Drinks and shakes', size: 'wide' },
    { section_id: SECTION, image_url: null, title: null, size: 'normal' },
  ])
  assert.equal(d.options.wheel_spin, false)
  assert.equal(d.options.wheel_spin_picks, true)
  assert.equal(normaliseDesign({ layout: { tiles: 'triangle' }, menu: { rail: 'top' } }).layout.tiles, 'cards')
  assert.equal(normaliseDesign({ menu: { rail: 'top' } }).menu.rail, 'images')
  assert.deepEqual(normaliseDesign(d), d)
  // A tile's own words are translated like the design's other words.
  const keys = translationSources({ designs: [{ id: 'd2', name: 'Hex', settings: d }] }).map(x => x.key)
  assert.ok(keys.includes(TK.design('d2', 'tile:' + DRINKS)))
  assert.ok(!keys.includes(TK.design('d2', 'tile:' + SECTION)))
})

test('split photo: the picks of groups and steps with it on, two or more pictures', () => {
  const groups = {
    [FLAVOUR]: { ...config.groups[FLAVOUR], kiosk_split: true, options: [{ id: LEMON, label: 'Lemon pepper', image_url: '/lemon.jpg' }, { id: HOT, label: 'Atomic', image_url: '/hot.jpg' }] },
    [EXTRAS]: { ...config.groups[EXTRAS], options: [{ id: DIP, label: 'Ranch', image_url: '/ranch.jpg' }] },
  }
  const dish = { ...WINGS, pos_choices: [{ key: FLAVOUR }, { key: EXTRAS }] }
  const cfg = { ...config, groups }
  const pick = (...ids) => ({ choices: { [FLAVOUR]: ids.map(id => ({ id })), [EXTRAS]: [{ id: DIP }] } })
  // One picture is not a split: the dish's own photo shows.
  assert.deepEqual(splitImages(cfg, dish, pick(HOT)), [])
  // In pick order; a group without the switch adds nothing.
  assert.deepEqual(splitImages(cfg, dish, pick(HOT, LEMON)), ['/hot.jpg', '/lemon.jpg'])
  // With the switch off nothing splits.
  assert.deepEqual(splitImages({ ...config }, dish, pick(HOT, LEMON)), [])
  // An option without a picture is left out; the same option twice shows once.
  const noPic = { ...cfg, groups: { ...groups, [FLAVOUR]: { ...groups[FLAVOUR], options: [{ id: LEMON, label: 'Lemon pepper' }, groups[FLAVOUR].options[1]] } } }
  assert.deepEqual(splitImages(noPic, dish, pick(HOT, LEMON)), [])
  assert.deepEqual(splitImages(cfg, dish, pick(HOT, HOT)), [])
  // A combo: steps with it on show the picked dishes' photos (a typed-in choice its own picture), then its own groups.
  const C1 = uuid(), C2 = uuid()
  const meal = { ...MEAL, pos_choices: [], combo: { steps: [
    { ...MEAL.combo.steps[0], split: true, options: [{ id: M1, type: 'item', item_id: WINGS.id }, { id: C1, type: 'custom', label: 'Tenders', image_url: '/tenders.jpg' }] },
    { ...MEAL.combo.steps[1], options: [{ id: S1, type: 'item', item_id: FRIES.id }] },
    { id: uuid(), name: 'Dip', min: 0, max: 1, split: true, options: [{ id: C2, type: 'custom', label: 'Blue cheese', image_url: '/blue.jpg' }] },
  ] } }
  const items = { ...config.items, [WINGS.id]: { ...config.items[WINGS.id], image_url: '/wings.jpg' }, [FRIES.id]: { ...config.items[FRIES.id], image_url: '/fries.jpg' } }
  const cfg2 = { ...config, items }
  const combo = steps => ({ choices: {}, combo: steps })
  assert.deepEqual(splitImages(cfg2, meal, combo({ [MAIN]: [{ option_id: M1, item_id: WINGS.id }], [SIDE]: [{ option_id: S1, item_id: FRIES.id }] })), [])
  assert.deepEqual(splitImages(cfg2, meal, combo({
    [MAIN]: [{ option_id: M1, item_id: WINGS.id }, { option_id: C1, item_id: null }],
    [SIDE]: [{ option_id: S1, item_id: FRIES.id }],
    [meal.combo.steps[2].id]: [{ option_id: C2, item_id: null }],
  })), ['/wings.jpg', '/tenders.jpg', '/blue.jpg'])
  assert.deepEqual(splitImages(cfg2, null, {}), [])
})

test('design: ways to pay and what stops a kiosk taking orders', () => {
  const both = normaliseDesign({})
  assert.deepEqual(payMethods(both, { card_reader: 'test' }), ['card', 'counter'])
  assert.deepEqual(payMethods(both, { card_reader: 'none' }), ['counter'])
  assert.deepEqual(designProblems(both), [])
  assert.equal(designProblems({ checkout: { pay_card: false, pay_counter: false } }).length, 1)
  assert.equal(designProblems({ checkout: { pay_counter: false } }, { card_reader: 'none' }).length, 1)
})

test('words: every language has every English word; allergens in every language', () => {
  for (const { code } of KIOSK_LANGUAGES) {
    assert.ok(UI_TEXT[code], 'no words for ' + code)
    const missing = Object.keys(UI_TEXT.en).filter(k => !UI_TEXT[code][k])
    assert.deepEqual(missing, [], code + ' is missing words')
    for (const [k, v] of Object.entries(UI_TEXT.en)) {
      for (const part of v.match(/\{[a-z]+\}/g) || []) assert.ok(UI_TEXT[code][k].includes(part), code + '.' + k + ' lost ' + part)
    }
    for (const a of STANDARD_ALLERGENS) assert.ok(ALLERGEN_NAMES[code]?.[a.key], code + ' has no name for ' + a.key)
  }
  assert.equal(uiText('en', 'item_count', { n: 3 }), '3 items')
  assert.equal(uiText('en', 'add', null, { 'ui:add': 'Add to bag' }), 'Add to bag')
  assert.equal(allergenName({ code: 'milk', label: 'Milk', standard_key: 'milk' }, 'fr'), 'Lait')
  assert.equal(allergenName({ code: 'milk', label: 'Milk', standard_key: 'milk' }, 'fr', { [TK.tag('milk')]: 'Produits laitiers' }), 'Produits laitiers')
})

test('translation sources: dishes, sections, options, combo steps, types, designs, kiosk words', () => {
  const src = translationSources({
    menus: [{ name: 'Main', sections: [
      { id: SECTION, title: 'Wings', subtitle: '', items: [WINGS, { ...MEAL, combo: { steps: [{ id: MAIN, name: 'Main', options: [{ id: M1, type: 'custom', label: 'Chef special', description: 'Ask us' }] }] } }] },
      { id: uuid(), title: 'Hidden', visibility: 'hidden', items: [{ id: uuid(), name: 'Staff meal' }] },
    ] }],
    groups: [{ id: FLAVOUR, name: 'Flavour', scale_low: 'No spice', options: [{ id: LEMON, label: 'Lemon pepper' }] }],
    types: [{ id: EAT_IN, name: 'Eat in' }],
    designs: [{ id: 'd1', name: 'Main', settings: { start: { headline: 'Hello' } } }],
  })
  const keys = new Set(src.map(s => s.key))
  for (const k of [TK.section(SECTION, 'title'), TK.item(WINGS.id, 'name'), TK.step(MEAL.id, MAIN), TK.choice(MEAL.id, M1), TK.choice(MEAL.id, M1, 'description'),
    TK.group(FLAVOUR, 'name'), TK.group(FLAVOUR, 'scale_low'), TK.option(LEMON, 'label'), TK.type(EAT_IN), TK.design('d1', 'headline'), TK.ui('add_to_order')]) {
    assert.ok(keys.has(k), 'missing ' + k)
  }
  assert.ok(!src.some(s => s.text === 'Staff meal'))
  assert.ok(!keys.has(TK.section(SECTION, 'subtitle')))
})

// ── Orders ─────────────────────────────────────────────────────

test('kioskOrder: lines priced and taxed like the till, combo, pay by card closes it', () => {
  const r = order([wings([LEMON, HOT]), { item_id: COLA.id, qty: 2, selection: { choices: { [EXTRAS]: [{ id: DIP }, { id: DIP }] } } }],
    { payment: { ref: 'TEST-1' }, name: 'Sam' })
  assert.ok(r.ok, r.error)
  assert.deepEqual(r.events.map(e => e.type), ['check.opened', 'line.added', 'line.added', 'payment.added', 'lines.sent', 'check.closed'])
  assert.equal(r.check.status, 'closed')
  assert.equal(r.check.mode, 'counter')
  assert.equal(r.check.tab_name, 'Sam')
  assert.equal(r.check.opened_by, KIOSK.id)
  const [w, c] = r.check.lines
  assert.equal(w.unit_price, 800)
  assert.equal(w.vat_rate, 20)
  assert.deepEqual(w.modifiers.map(m => m.label), ['Lemon pepper', 'Atomic'])
  assert.equal(checkTotals({ lines: [c] }).total, 2 * (250 + 140))
  assert.equal(r.totals.total, 850 + 780)
  assert.equal(r.check.payments[0].amount, r.totals.total)
  assert.ok(r.events.every(e => e.staff_id === KIOSK.id && e.device_id === KIOSK.id))
})

test('kioskOrder: pay at the counter stays open and unsent, unless the design sends it', () => {
  const r = order([wings()])
  assert.deepEqual(r.events.map(e => e.type), ['check.opened', 'line.added'])
  assert.equal(r.check.status, 'open')
  assert.equal(r.check.lines[0].status, 'new')
  const s = order([wings()], { send: true })
  assert.deepEqual(s.events.map(e => e.type), ['check.opened', 'line.added', 'lines.sent'])
  assert.equal(s.check.lines[0].status, 'sent')
})

test('kioskOrder: an automatic combo among separate dishes comes off, like on the till', () => {
  const r = basketCheck(config, [wings(), { item_id: FRIES.id, qty: 1, selection: {} }], { device: KIOSK, order_type_id: TAKE_OUT })
  assert.ok(r.ok, r.error)
  assert.equal(r.events.at(-1).type, 'promotions.set')
  assert.equal(r.totals.subtotal, 1100)
  assert.equal(r.totals.discount, 100)
  assert.equal(r.totals.total, 1000)
})

test('kioskOrder: a missing choice or an unknown dish is refused before anything is sent', () => {
  const r = order([{ item_id: WINGS.id, qty: 1, selection: {} }])
  assert.equal(r.ok, false)
  assert.match(r.error, /flavour/i)
  assert.equal(order([{ item_id: uuid(), qty: 1 }]).ok, false)
  const combo = order([{ item_id: MEAL.id, qty: 1, selection: { combo: { [MAIN]: [{ option_id: M1, item_id: WINGS.id, choices: { [FLAVOUR]: [{ id: LEMON }] } }], [SIDE]: [{ option_id: S1, item_id: FRIES.id }] } } }])
  assert.ok(combo.ok, combo.error)
  assert.deepEqual(combo.check.lines[0].combo.map(p => p.name), ['Wings', 'Fries'])
})

// ── Kiosk rules ────────────────────────────────────────────────

const ev = (type, payload, { check_id = null, staff_id = KIOSK.id, device_id = KIOSK.id, approved_by = null } = {}) =>
  ({ id: ulid(), venue_id: VENUE, device_id, staff_id, approved_by, check_id, type, payload, client_at: new Date().toISOString() })

test('kiosk rules: counter orders only, its own orders only, menu dishes, card only', () => {
  assert.deepEqual(KIOSK_EVENTS, ['check.opened', 'line.added', 'promotions.set', 'lines.sent', 'payment.added', 'check.closed'])
  const id = ulid()
  const refused = (e, checks = {}) => applyEvent(checks, e, { staffById })
  assert.equal(refused(ev('check.opened', { mode: 'table', table_id: uuid() }, { check_id: id })).code, 'kiosk')
  assert.equal(refused(ev('check.opened', { mode: 'counter' }, { check_id: id, device_id: uuid() })).code, 'kiosk')
  assert.equal(refused(ev('check.opened', { mode: 'counter' }, { check_id: id, approved_by: TILL_PERSON })).code, 'kiosk')
  const opened = applyEvent({}, ev('check.opened', { mode: 'counter' }, { check_id: id }), { staffById })
  assert.ok(opened.ok)
  const checks = opened.checks
  const open = { id: ulid(), item_id: null, name: 'Open', qty: 1, unit_price: 100, vat_rate: 20, open_item: true }
  assert.equal(refused(ev('line.added', { line: open }, { check_id: id }), checks).code, 'kiosk')
  assert.equal(refused(ev('discount.applied', { discount: { id: ulid(), scope: 'check', type: 'percent', value: 10 } }, { check_id: id }), checks).code, 'kiosk')
  assert.equal(refused(ev('payment.added', { payment: { id: ulid(), tender: 'cash', amount: 100, tendered: 100 } }, { check_id: id }), checks).code, 'kiosk')
  // A check a person opened on a till is off limits.
  const tillId = ulid()
  const till = applyEvent({}, ev('check.opened', { mode: 'counter' }, { check_id: tillId, staff_id: TILL_PERSON, device_id: 'T1' }), { staffById }).checks
  assert.equal(refused(ev('lines.sent', { send_id: ulid(), line_ids: [ulid()] }, { check_id: tillId }), till).code, 'kiosk')
  // Staff on a till can work on a kiosk order (take payment at the counter).
  const kioskOrderPlaced = order([wings()])
  let state = { [kioskOrderPlaced.check.id]: kioskOrderPlaced.check }
  for (const [type, payload] of [
    ['payment.added', { payment: { id: ulid(), tender: 'cash', amount: kioskOrderPlaced.totals.total, tendered: 1000 } }],
    ['lines.sent', { send_id: ulid(), line_ids: kioskOrderPlaced.check.lines.map(l => l.id) }],
    ['check.closed', {}],
  ]) {
    const r = applyEvent(state, ev(type, payload, { check_id: kioskOrderPlaced.check.id, staff_id: TILL_PERSON, device_id: 'T1' }), { staffById })
    assert.ok(r.ok, type + ': ' + r.error)
    state = { ...state, ...r.checks }
  }
  assert.equal(state[kioskOrderPlaced.check.id].status, 'closed')
})

test('sequencer: takes a kiosk order, numbers it, refuses a kiosk working on a till check', async () => {
  const s = { events: new Map(), rejections: new Map(), checks: new Map(), state: { last_seq: 0, next_check_no: 1, next_order_no: 1, day: null } }
  let queue = Promise.resolve()
  const store = {
    run: (_v, fn) => (queue = queue.then(fn, fn)),
    findEvent: id => s.events.get(id) || null,
    findRejection: id => s.rejections.get(id) || null,
    context: () => ({ staffById, print: {}, timezone: 'Europe/London', settings: { order_no_start: 40 } }),
    venueState: () => ({ ...s.state }),
    openDay: ({ business_date }) => (s.state.day = { id: uuid(), business_date }),
    loadChecks: ids => Object.fromEntries(ids.filter(id => s.checks.has(id)).map(id => [id, s.checks.get(id)])),
    openCheckCount: () => 0,
    saveEvent: e => { s.events.set(e.id, e) },
    saveChecks: changed => { for (const [id, c] of Object.entries(changed)) s.checks.set(id, c) },
    saveJobs: () => {},
    saveRejection: (e, error, code) => { s.rejections.set(e.id, { error, code }) },
    saveVenueState: v => { Object.assign(s.state, v) },
    closeDay: () => {},
  }
  const seq = createSequencer(store)
  const r = order([wings(), { item_id: COLA.id, qty: 1 }], { payment: { ref: 'T' } })
  const results = await seq.submitAll(r.events)
  assert.ok(results.every(x => x.ok), JSON.stringify(results.filter(x => !x.ok)))
  assert.equal(results[0].event.assigned.order_no, 40)
  const stored = s.checks.get(r.check.id)
  assert.equal(stored.status, 'closed')
  assert.equal(stored.order_no, 40)
  const tillId = ulid()
  await seq.submit(ev('check.opened', { mode: 'counter' }, { check_id: tillId, staff_id: TILL_PERSON, device_id: 'T1' }))
  const bad = await seq.submit(ev('line.added', { line: { ...r.check.lines[0], id: ulid() } }, { check_id: tillId }))
  assert.equal(bad.code, 'kiosk')
})
