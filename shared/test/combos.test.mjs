// Combos (shared/combos.js) and repeat / on-request option groups, through
// both pricing engines: online ordering (shared/orderPricing.js) and the
// till (shared/pos/pricing.js).
// Run: node --test shared/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseCombo, stepChoices, resolveSteps, comboFromPrice, comboGuide, findAutoCombos,
  autoMatchable, combosWithItem, stepWithItem, comboProblems, sectionItemsOf, stepRule, countParts,
} from '../combos.js'
import { itemChoices, priceLine, priceBasket, fromPrice, priceVaries } from '../orderPricing.js'
import { priceItem, lineGross, posChoices, groupModifiers, modifierText } from '../pos/pricing.js'

// ── Fixture: a burger place ──────────────────────────────────────
const MAINS = 's-mains', SIDES = 's-sides', DRINKS = 's-drinks', DEALS = 's-deals'
const SAUCES = 'g-sauces', SIZE = 'g-size', EXTRAS = 'g-extras'
const BURGER = { id: 'i-burger', name: 'Burger', section_id: MAINS, price_pence: 900,
  variant_groups: [{ group_id: EXTRAS, name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 3, allow_repeat: true, on_request: true,
    options: [{ option_id: 'o-cheese', label: 'Cheese', price_pence: 100 }, { option_id: 'o-bacon', label: 'Bacon', price_pence: 150 }] }] }
const VEGGIE = { id: 'i-veggie', name: 'Veggie burger', section_id: MAINS, price_pence: 850, variant_groups: [] }
const FRIES = { id: 'i-fries', name: 'Fries', section_id: SIDES, price_pence: 300,
  variant_groups: [{ group_id: SIZE, name: 'Size', price_mode: 'base', min_select: 1, max_select: 1,
    options: [{ option_id: 'o-reg', label: 'Regular', price_pence: 300 }, { option_id: 'o-large', label: 'Large', price_pence: 400 }] }] }
const SLAW = { id: 'i-slaw', name: 'Slaw', section_id: SIDES, price_pence: 250, variant_groups: [] }
const COLA = { id: 'i-cola', name: 'Cola', section_id: DRINKS, price_pence: 250, variant_groups: [] }
const SHAKE = { id: 'i-shake', name: 'Shake', section_id: DRINKS, price_pence: 450, variant_groups: [] }
const DIP = { id: 'i-dip', name: 'Dip', section_id: SIDES, price_pence: 80,
  variant_groups: [{ group_id: SAUCES, name: 'Sauce', price_mode: 'base', min_select: 1, max_select: 1,
    options: [{ option_id: 'o-bbq', label: 'BBQ', price_pence: null }, { option_id: 'o-mayo', label: 'Mayo', price_pence: null }] }] }

const MEAL = {
  id: 'c-meal', name: 'Burger meal', kind: 'combo', section_id: DEALS, price_pence: 1100, variant_groups: [],
  combo: {
    mode: 'auto',
    steps: [
      { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'op-main', type: 'section', section_id: MAINS, price_pence: 0 }] },
      { id: 'st-side', name: 'Side', min: 1, max: 1, options: [{ id: 'op-fries', type: 'item', item_id: FRIES.id }, { id: 'op-slaw', type: 'item', item_id: SLAW.id, price_pence: 50 }] },
      { id: 'st-drink', name: 'Drink', min: 1, max: 1, options: [{ id: 'op-cola', type: 'item', item_id: COLA.id }, { id: 'op-shake', type: 'item', item_id: SHAKE.id, price_pence: 150 }] },
      // Only with fries: dips, up to 2, the same one twice allowed.
      { id: 'st-dip', name: 'Dips', min: 0, max: 2, repeat: true, ask: 'button', when: { step_id: 'st-side', option_ids: ['op-fries'] },
        options: [{ id: 'op-dip', type: 'item', item_id: DIP.id, price_pence: 30 }] },
      // A typed-in choice, picked by itself (one choice, needed).
      { id: 'st-toy', name: 'Toy', min: 1, max: 1, options: [{ id: 'op-toy', type: 'custom', label: 'Surprise toy', kitchen_name: 'TOY' }] },
    ],
  },
}
const DUO = { id: 'c-duo', name: 'Two burgers', kind: 'combo', section_id: DEALS, price_pence: 1500, variant_groups: [],
  combo: { mode: 'auto', steps: [{ id: 'st-b', name: 'Burgers', min: 2, max: 2, repeat: true, options: [{ id: 'op-b', type: 'item', item_id: BURGER.id }] }] } }

const menu = { sections: [
  { id: MAINS, items: [BURGER, VEGGIE] }, { id: SIDES, items: [FRIES, SLAW, DIP] },
  { id: DRINKS, items: [COLA, SHAKE] }, { id: DEALS, items: [MEAL, DUO] },
] }
const all = [BURGER, VEGGIE, FRIES, SLAW, COLA, SHAKE, DIP, MEAL, DUO]
const itemsById = Object.fromEntries(all.map(i => [i.id, i]))
const sectionItems = sectionItemsOf([menu])
const ctx = { itemsById, sectionItems }

const pick = (option_id, item_id, choices = {}) => ({ option_id, item_id, choices })
const mealSel = (extra = {}) => ({ combo: {
  'st-main': [pick('op-main', BURGER.id)],
  'st-side': [pick('op-fries', FRIES.id, { [SIZE]: ['o-reg'] })],
  'st-drink': [pick('op-cola', COLA.id)],
  ...extra,
} })

// ── The model ───────────────────────────────────────────────────

test('normaliseCombo: defaults, limits, a condition can only look back', () => {
  const c = normaliseCombo({ steps: [
    { id: 'a', when: { step_id: 'b' }, min: 5, max: 2, options: [{ id: 'x', type: 'custom', label: 'X' }] },
    { id: 'b', name: '', min: -1, max: 0, ask: 'button', options: [{ id: 'y', type: 'item' }] },
  ] })
  assert.equal(c.mode, 'manual')
  assert.equal(c.steps[0].when, null)
  assert.deepEqual([c.steps[0].min, c.steps[0].max], [2, 2])
  assert.equal(c.steps[1].name, 'Choice 2')
  assert.deepEqual([c.steps[1].min, c.steps[1].max, c.steps[1].ask], [0, 1, 'button'])
  assert.equal(c.steps[1].options.length, 0)  // an item option needs an item
  assert.equal(stepRule({ min: 0, max: 2 }), 'Optional, up to 2')
  assert.equal(stepRule({ min: 2, max: 3 }), 'Choose 2 to 3')
})

test('normaliseCombo: a choice\'s picture on the combo\'s photo is kept only when set', () => {
  const c = normaliseCombo({ steps: [{ id: 's', options: [
    { id: 'x', type: 'custom', label: 'X', image_url: '/x-tile.png', photo_url: '/x-box.jpg' },
    { id: 'y', type: 'custom', label: 'Y', photo_url: '' },
  ] }] })
  assert.equal(c.steps[0].options[0].photo_url, '/x-box.jpg')
  assert.ok(!('photo_url' in c.steps[0].options[1]))
  assert.deepEqual(stepChoices(c.steps[0], ctx).map(x => x.photo_url), ['/x-box.jpg', null])
})

test('stepChoices: dishes, a whole section, typed-in choices; no combos', () => {
  const c = normaliseCombo(MEAL.combo)
  assert.deepEqual(stepChoices(c.steps[0], ctx).map(x => x.label), ['Burger', 'Veggie burger'])
  assert.deepEqual(stepChoices(c.steps[1], ctx).map(x => [x.label, x.price_pence]), [['Fries', 0], ['Slaw', 50]])
  assert.deepEqual(stepChoices(c.steps[4], ctx).map(x => [x.label, x.item_id, x.kitchen_name]), [['Surprise toy', null, 'TOY']])
  const withDeals = normaliseCombo({ steps: [{ id: 's', options: [{ id: 'o', type: 'section', section_id: DEALS }] }] })
  assert.equal(stepChoices(withDeals.steps[0], ctx).length, 0)
})

test('resolveSteps: conditions, auto picks, hidden picks dropped', () => {
  const r = resolveSteps(MEAL, mealSel({ 'st-dip': [pick('op-dip', DIP.id)] }).combo, ctx)
  assert.deepEqual(r.steps.map(s => s.shown), [true, true, true, true, true])
  assert.equal(r.picks['st-toy'].length, 1)   // one choice, needed: picked for the guest
  assert.ok(r.steps[4].auto)
  // Slaw instead of fries: the dips step goes and its picks with it.
  const slaw = resolveSteps(MEAL, { ...mealSel().combo, 'st-side': [pick('op-slaw', SLAW.id)], 'st-dip': [pick('op-dip', DIP.id)] }, ctx)
  assert.equal(slaw.steps[3].shown, false)
  assert.equal(slaw.picks['st-dip'], undefined)
})

// ── Online ordering prices ──────────────────────────────────────

test('priceLine: a combo, its extra charges and its dishes\' extras', () => {
  const r = priceLine(MEAL, mealSel(), itemChoices(MEAL), ctx)
  assert.ok(r.ok, r.error)
  assert.equal(r.unit_pence, 1100)
  assert.deepEqual(r.parts.map(p => p.name), ['Burger', 'Fries', 'Cola', 'Surprise toy'])
  // Large fries (a base option of the dish) doesn't change the deal's price;
  // a shake (+£1.50), bacon twice (repeat, +£3.00) and two dips (+£0.60) do.
  const big = priceLine(MEAL, mealSel({
    'st-main': [pick('op-main', BURGER.id, { [EXTRAS]: ['o-bacon', 'o-bacon'] })],
    'st-side': [pick('op-fries', FRIES.id, { [SIZE]: ['o-large'] })],
    'st-drink': [pick('op-shake', SHAKE.id)],
    'st-dip': [pick('op-dip', DIP.id, { [SAUCES]: ['o-bbq'] }), pick('op-dip', DIP.id, { [SAUCES]: ['o-bbq'] })],
  }), itemChoices(MEAL), ctx)
  assert.ok(big.ok, big.error)
  assert.equal(big.unit_pence, 1100 + 150 + 300 + 60)
  assert.equal(big.parts.filter(p => p.name === 'Dip').length, 2)
  // The same option twice shows once, with the count and both prices.
  assert.deepEqual(big.parts[0].options.map(o => [o.label, o.price_pence]), [['2 x Bacon', 300]])
})

test('priceLine: what a combo refuses', () => {
  assert.match(priceLine(MEAL, { combo: {} }, itemChoices(MEAL), ctx).error, /Choose main/)
  assert.match(priceLine(MEAL, mealSel({ 'st-side': [pick('op-fries', FRIES.id)] }), itemChoices(MEAL), ctx).error, /Fries: Choose size/)
  assert.match(priceLine(MEAL, mealSel({ 'st-dip': [1, 2, 3].map(() => pick('op-dip', DIP.id, { [SAUCES]: ['o-bbq'] })) }), itemChoices(MEAL), ctx).error, /up to 2/)
  const once = { ...MEAL, combo: { ...MEAL.combo, steps: MEAL.combo.steps.map(s => (s.id === 'st-dip' ? { ...s, repeat: false } : s)) } }
  assert.match(priceLine(once, mealSel({ 'st-dip': [pick('op-dip', DIP.id, { [SAUCES]: ['o-bbq'] }), pick('op-dip', DIP.id, { [SAUCES]: ['o-bbq'] })] }), itemChoices(once), ctx).error, /each one once/)
  const sold = { ...ctx, itemsById: { ...itemsById, [COLA.id]: { ...COLA, sold_out: true } } }
  assert.match(priceLine(MEAL, mealSel(), itemChoices(MEAL), sold).error, /Cola is sold out/)
  // A price of £0 is allowed: the picks' charges make the price.
  const free = { ...MEAL, price_pence: 0 }
  assert.equal(priceLine(free, mealSel({ 'st-drink': [pick('op-shake', SHAKE.id)] }), itemChoices(free), ctx).unit_pence, 150)
})

test('repeat and on-request option groups', () => {
  const [extras] = itemChoices(BURGER)
  assert.equal(extras.repeat, true)
  assert.equal(extras.on_request, true)
  assert.equal(priceLine(BURGER, { choices: { [EXTRAS]: ['o-cheese', 'o-cheese', 'o-bacon'] } }).unit_pence, 900 + 350)
  assert.match(priceLine(BURGER, { choices: { [EXTRAS]: ['o-cheese', 'o-cheese', 'o-cheese', 'o-bacon'] } }).error, /up to 3/)
  // Without repeat the same option counts once.
  const plain = { ...BURGER, variant_groups: [{ ...BURGER.variant_groups[0], allow_repeat: false, on_request: false }] }
  assert.equal(priceLine(plain, { choices: { [EXTRAS]: ['o-cheese', 'o-cheese'] } }).unit_pence, 1000)
  // On request only applies to optional groups.
  const needed = { ...BURGER, variant_groups: [{ ...BURGER.variant_groups[0], min_select: 1 }] }
  assert.equal(itemChoices(needed)[0].on_request, false)
})

test('from price: the cheapest picks; "from" only when picks can cost more', () => {
  assert.equal(fromPrice(MEAL, itemChoices(MEAL), ctx), 1100)
  assert.equal(priceVaries(MEAL, itemChoices(MEAL), ctx), true)   // slaw, shake, dips cost extra
  const flat = { ...MEAL, combo: { steps: [MEAL.combo.steps[0]] } }
  assert.equal(priceVaries(flat, itemChoices(flat), ctx), false)
  // A needed step whose every choice costs extra raises the from price.
  const pricey = { ...DUO, combo: { steps: [{ ...DUO.combo.steps[0], options: [{ id: 'op-b', type: 'item', item_id: BURGER.id, price_pence: 100 }] }] } }
  assert.deepEqual(comboFromPrice(pricey, 1500, ctx), { pence: 1700, varies: true })
})

test('auto combos: found among separate dishes, only when cheaper', () => {
  const lines = [
    { key: 'a', item_id: BURGER.id, section_id: MAINS, qty: 1, unit_base: 900 },
    { key: 'b', item_id: FRIES.id, section_id: SIDES, qty: 1, unit_base: 300 },
    { key: 'c', item_id: COLA.id, section_id: DRINKS, qty: 1, unit_base: 250 },
  ]
  // The meal needs the toy (typed in): it can't be spotted.
  assert.equal(autoMatchable(MEAL), false)
  const meal = { ...MEAL, combo: { ...MEAL.combo, steps: MEAL.combo.steps.slice(0, 4) } }
  assert.equal(autoMatchable(meal), true)
  const [hit] = findAutoCombos(lines, [meal], ctx)
  assert.equal(hit.combo_id, MEAL.id)
  assert.equal(hit.count, 1)
  assert.equal(hit.saving, 900 + 300 + 250 - 1100)
  assert.equal(Object.values(hit.lines).reduce((s, x) => s + x, 0), 350)
  // A shake costs +£1.50 in the meal: 900 + 300 + 450 - (1100 + 150) = 400 saved.
  const shake = findAutoCombos([...lines.slice(0, 2), { key: 'c', item_id: SHAKE.id, section_id: DRINKS, qty: 1, unit_base: 450 }], [meal], ctx)
  assert.equal(shake[0].saving, 400)
  // Not cheaper: nothing.
  assert.deepEqual(findAutoCombos(lines, [{ ...meal, price_pence: 1500 }], ctx), [])
  // Missing a step: nothing.
  assert.deepEqual(findAutoCombos(lines.slice(0, 2), [meal], ctx), [])
  // Two of everything: two meals; the dearest main goes first.
  const two = findAutoCombos(lines.map(l => ({ ...l, qty: 2 })), [meal], ctx)
  assert.equal(two[0].count, 2)
  // Best saving first between combos: 3 burgers -> the duo (2 x 900 - 1500 = 300)
  // and one burger left; with fries and cola, the meal saves 350, so the meal
  // goes first and then there is no second burger pair.
  const mix = findAutoCombos([{ key: 'a', item_id: BURGER.id, section_id: MAINS, qty: 2, unit_base: 900 }, ...lines.slice(1)], [meal, DUO], ctx)
  assert.deepEqual(mix.map(m => [m.combo_id, m.count]), [[MEAL.id, 1]])
  const duo = findAutoCombos([{ key: 'a', item_id: BURGER.id, section_id: MAINS, qty: 3, unit_base: 900 }], [meal, DUO], ctx)
  assert.deepEqual(duo.map(m => [m.combo_id, m.count, m.saving]), [[DUO.id, 1, 300]])
  // Never more off a dish than is left on it.
  const capped = findAutoCombos(lines.map(l => ({ ...l, cap: 50 })), [meal], ctx)
  assert.equal(capped[0].saving, 150)
})

test('priceBasket: automatic combo first, then promotions on what is left', () => {
  const meal = { ...MEAL, combo: { ...MEAL.combo, steps: MEAL.combo.steps.slice(0, 4) } }
  const ib = { ...Object.fromEntries(all.map(i => [i.id, { ...i, vat_rate: 20 }])), [meal.id]: { ...meal, vat_rate: 20 } }
  const basket = [
    { item_id: BURGER.id, qty: 1, choices: { [EXTRAS]: ['o-cheese'] } },
    { item_id: FRIES.id, qty: 1, choices: { [SIZE]: ['o-reg'] } },
    { item_id: COLA.id, qty: 1, choices: {} },
  ]
  const q = priceBasket(ib, basket, { combos: { ctx: { itemsById: ib, sectionItems }, auto: [ib[meal.id]] } })
  assert.equal(q.errors.length, 0)
  assert.equal(q.subtotal_pence, 1000 + 300 + 250)
  assert.equal(q.combo_discount_pence, 350)          // cheese stays paid
  assert.deepEqual(q.combos.map(c => [c.name, c.count]), [['Burger meal', 1]])
  assert.equal(q.total_pence, 1100 + 100)
  // A 10% basket promotion applies to what is left after the combo.
  const promo = { id: 'p1', name: '10% off', kind: 'basket', discount_type: 'percent', discount_value: 10, apply_mode: 'auto', item_ids: [], section_ids: [] }
  const q2 = priceBasket(ib, basket, { combos: { ctx: { itemsById: ib, sectionItems }, auto: [ib[meal.id]] }, promos: [promo] })
  assert.equal(q2.discount_pence, 350 + 120)
  // A combo chosen as a combo line isn't counted again.
  const q3 = priceBasket(ib, [{ item_id: meal.id, qty: 1, ...mealSel() }], { combos: { ctx: { itemsById: ib, sectionItems }, auto: [ib[meal.id]] } })
  assert.equal(q3.discount_pence, 0)
  assert.equal(q3.lines[0].parts.length, 3)
})

// ── The till ────────────────────────────────────────────────────

test('till priceItem: combo parts with modifiers, typed-in choice, repeat', () => {
  const groupsById = {
    [EXTRAS]: { id: EXTRAS, name: 'Extras', price_mode: 'extra', min_select: 0, max_select: 3, allow_repeat: true, pos_prefixes: true,
      options: [{ id: 'o-cheese', label: 'Cheese', price_pence: 100 }, { id: 'o-bacon', label: 'Bacon', price_pence: 150 }] },
    [SIZE]: { id: SIZE, name: 'Size', price_mode: 'base', min_select: 1, max_select: 1, options: [{ id: 'o-reg', label: 'Regular', price_pence: 300 }] },
    [SAUCES]: { id: SAUCES, name: 'Sauce', price_mode: 'base', min_select: 1, max_select: 1, options: [{ id: 'o-bbq', label: 'BBQ' }] },
  }
  const sel = mealSel({ 'st-main': [pick('op-main', BURGER.id, { [EXTRAS]: [{ id: 'o-cheese', prefix: 'extra' }, { id: 'o-cheese', prefix: 'extra' }] })] })
  const r = priceItem(MEAL, sel, { itemsById, groupsById, sectionItems })
  assert.ok(r.ok, r.error)
  assert.equal(lineGross({ ...r, qty: 1 }), 1100 + 200)
  assert.deepEqual(r.combo.map(p => [p.step, p.name]), [['Main', 'Burger'], ['Side', 'Fries'], ['Drink', 'Cola'], ['Toy', 'Surprise toy']])
  assert.equal(r.combo[3].item_id, null)
  assert.equal(r.combo[3].kitchen_name, 'TOY')
  assert.equal(r.combo[0].modifiers.length, 2)
  // Repeat off on the till: the same option twice is refused.
  const once = { ...groupsById, [EXTRAS]: { ...groupsById[EXTRAS], allow_repeat: false } }
  const plain = { ...BURGER, variant_groups: [{ ...BURGER.variant_groups[0], allow_repeat: false }] }
  const pc = posChoices(plain, once)
  assert.equal(pc[0].repeat, false)
  assert.match(priceItem(plain, { choices: { [EXTRAS]: [{ id: 'o-cheese' }, { id: 'o-cheese' }] } }, { itemsById, groupsById: once }).error, /once/)
  // Sold out on the till.
  assert.match(priceItem(MEAL, sel, { itemsById, groupsById, sectionItems, soldOut: id => id === COLA.id }).error, /sold out/)
})

test('make it a combo, the guide, set-up problems', () => {
  assert.deepEqual(combosWithItem(COLA.id, [MEAL, DUO], ctx).map(c => c.id), [MEAL.id])
  assert.deepEqual(stepWithItem(MEAL, VEGGIE.id, ctx), { step_id: 'st-main', option_id: 'op-main', item_id: VEGGIE.id })
  const guide = comboGuide(MEAL, ctx)
  assert.deepEqual(guide.map(g => [g.name, g.rule]), [['Main', 'Choose 1'], ['Side', 'Choose 1'], ['Drink', 'Choose 1'], ['Dips', 'Optional, up to 2'], ['Toy', 'Choose 1']])
  assert.equal(guide[3].when, 'With Fries')
  assert.deepEqual(guide[1].options, [{ label: 'Fries', price_pence: 0, sold_out: false }, { label: 'Slaw', price_pence: 50, sold_out: false }])
  assert.deepEqual(comboProblems(MEAL.combo), ['Toy: an automatic combo can only be spotted from dishes, not typed-in choices.'])
  assert.match(comboProblems({ steps: [{ id: 'a', name: 'Sides', min: 2, max: 2, options: [{ id: 'o', type: 'item', item_id: 'x' }] }] }, { itemIds: new Set() }).join(' '), /more than once.*no longer on this menu/)
})

test('groupModifiers: the same pick in a row shows once with a count', () => {
  const mods = [
    { group_id: 'g', option_id: 'a', label: 'Cheese', price: 100, depth: 0 },
    { group_id: 'g', option_id: 'a', label: 'Cheese', price: 100, depth: 0 },
    { group_id: 'g', option_id: 'b', label: 'Onion', prefix: 'no', price: 0, depth: 0 },
    { group_id: 'g', option_id: 'a', label: 'Cheese', price: 100, depth: 0 },
  ]
  const g = groupModifiers(mods)
  assert.deepEqual(g.map(modifierText), ['2 x Cheese', 'No Onion', 'Cheese'])
  assert.equal(g[0].price, 200)
  assert.equal(mods.length, 4)
  assert.equal(mods[0].count, undefined)
})

test('countParts: the same pick twice in a step shows once with a count', () => {
  const parts = [
    { step_id: 's1', option_id: 'a', item_id: 'i1', name: 'Burger', modifiers: [{ label: 'Cheese' }], upcharge: 0 },
    { step_id: 's2', option_id: 'k', item_id: null, name: 'Ketchup pot', modifiers: [], upcharge: 30 },
    { step_id: 's2', option_id: 'm', item_id: null, name: 'Mayo pot', modifiers: [], upcharge: 30 },
    { step_id: 's2', option_id: 'k', item_id: null, name: 'Ketchup pot', modifiers: [], upcharge: 30 },
    { step_id: 's1', option_id: 'a', item_id: 'i1', name: 'Burger', modifiers: [{ label: 'Bacon' }], upcharge: 0 },
  ]
  assert.deepEqual(countParts(parts).map(x => x.count + ' ' + x.part.name), ['1 Burger', '2 Ketchup pot', '1 Mayo pot', '1 Burger'])
  // An online order's parts (options) and a kitchen item's (mods) the same way.
  assert.equal(countParts([{ name: 'Dip', options: [{ label: 'BBQ' }] }, { name: 'Dip', options: [{ label: 'BBQ' }] }])[0].count, 2)
  assert.equal(countParts([{ name: 'Dip', mods: [{ text: 'BBQ', kind: 'add' }] }, { name: 'Dip', mods: [{ text: 'Mayo', kind: 'add' }] }]).length, 2)
})

