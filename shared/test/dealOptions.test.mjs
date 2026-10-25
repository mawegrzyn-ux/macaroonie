// A picked dish's options inside a meal deal (shared/combos.js
// dealChoices()): leave a group out, offer only some options, ask another
// group instead, change how many. Through both pricing engines (the till's
// shared/pos/pricing.js and online's shared/orderPricing.js), the till's
// "Make it a combo" trim (picksWithin()), the kiosk's part item (dealItem())
// and its meal picture (bundleParts()), and automatic combos found among
// separate dishes (dealFits() in findAutoCombos()).
// Run: node --test shared/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseCombo, normaliseDealGroups, moveDealGroup, dealChoices, dealSwapIds, dealFits, findAutoCombos, stepChoices, sectionItemsOf, withDealPicks, askedChoices, resolveSteps } from '../combos.js'
import { itemChoices, priceLine, priceBasket } from '../orderPricing.js'
import { priceItem, posChoices, partChoices, picksWithin } from '../pos/pricing.js'
import { dealItem, comboCtx, autoCombosFor, fillDealPicks } from '../pos/offers.js'
import { bundleParts, normaliseDesign } from '../kiosk.js'

// ── Fixture: wings with flavours and dips, fries with a sauce ────
const FLAV = 'g-flav', DIPS = 'g-dips', SAUCE = 'g-sauce', MEAL_SAUCE = 'g-meal-sauce', MEAL_FLAV = 'g-meal-flav'
const LIB = {
  [FLAV]: { id: FLAV, name: 'Flavour', price_mode: 'base', min_select: 1, max_select: 1, allow_repeat: false, on_request: false, kiosk_pick_photo: 'split',
    options: [{ id: 'o-lemon', label: 'Lemon pepper', price_pence: null, photo_url: '/lemon-wings.png' }, { id: 'o-bbq', label: 'BBQ', price_pence: null },
      { id: 'o-hot', label: 'Atomic', price_pence: null }, { id: 'o-garlic', label: 'Garlic', price_pence: null }] },
  [DIPS]: { id: DIPS, name: 'Dip', price_mode: 'extra', min_select: 0, max_select: 2, allow_repeat: true, on_request: true,
    options: [{ id: 'o-ranch', label: 'Ranch', price_pence: 50 }, { id: 'o-blue', label: 'Blue cheese', price_pence: 60 }] },
  [SAUCE]: { id: SAUCE, name: 'Sauce', price_mode: 'extra', min_select: 0, max_select: 1, allow_repeat: false, on_request: false,
    options: [{ id: 'o-mayo', label: 'Mayo', price_pence: 50 }, { id: 'o-ketchup', label: 'Ketchup', price_pence: 30 }] },
  // Copies made for the deal (Variant groups > Copy): fewer options, deal prices.
  [MEAL_SAUCE]: { id: MEAL_SAUCE, name: 'Meal sauce', price_mode: 'extra', min_select: 1, max_select: 1, allow_repeat: false, on_request: false,
    options: [{ id: 'o-msk', label: 'Ketchup', price_pence: 0 }, { id: 'o-msm', label: 'Mayo', price_pence: 20 }] },
  [MEAL_FLAV]: { id: MEAL_FLAV, name: 'Meal flavour', price_mode: 'base', min_select: 1, max_select: 1, allow_repeat: false, on_request: false, kiosk_pick_photo: 'split',
    options: [{ id: 'o-mf1', label: 'Lemon pepper', price_pence: null, photo_url: '/meal-lemon.png' }] },
}
// A group as a dish has it attached (loadMenuFull / a release).
const attached = (g, prices = {}) => ({
  group_id: g.id, name: g.name, price_mode: g.price_mode, min_select: g.min_select, max_select: g.max_select,
  allow_repeat: g.allow_repeat, on_request: g.on_request,
  options: g.options.map(o => ({ option_id: o.id, label: o.label, price_pence: prices[o.id] ?? o.price_pence })),
})
const SECTION = 's-mains', SIDES = 's-sides', DEALS = 's-deals'
const WINGS = { id: 'i-wings', name: '12 Wings', section_id: SECTION, price_pence: 1299, kind: 'dish', image_url: '/wings.png',
  variant_groups: [attached(LIB[FLAV]), attached(LIB[DIPS])] }
const TENDERS = { id: 'i-tenders', name: 'Tenders', section_id: SECTION, price_pence: 999, kind: 'dish', variant_groups: [attached(LIB[FLAV]), attached(LIB[DIPS])] }
const FRIES = { id: 'i-fries', name: 'Fries', section_id: SIDES, price_pence: 350, kind: 'dish', variant_groups: [attached(LIB[SAUCE])] }
const DEAL = {
  // The deal's flavours: three of the four, up to two of them; no dip
  // question (the deal has its own dips step); fries ask the meal's sauce.
  wings: { [FLAV]: { use: 'only', option_ids: ['o-lemon', 'o-hot', 'o-garlic'], max: 2 }, [DIPS]: { use: 'off' } },
  fries: { [SAUCE]: { use: 'swap', group_id: MEAL_SAUCE } },
}
const MEAL = { id: 'c-meal', name: 'Wing meal', section_id: DEALS, price_pence: 1500, kind: 'combo', variant_groups: [],
  combo: { mode: 'manual', steps: [
    { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'op-wings', type: 'item', item_id: WINGS.id, groups: DEAL.wings }] },
    { id: 'st-side', name: 'Side', min: 1, max: 1, options: [{ id: 'op-fries', type: 'item', item_id: FRIES.id, groups: DEAL.fries }] },
  ] } }
// The same deal without changes, and one offering the whole mains section with the flavour change.
const PLAIN = { ...MEAL, id: 'c-plain', combo: { mode: 'manual', steps: [
  { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'op-wings', type: 'item', item_id: WINGS.id }] },
] } }
const ANY = { ...MEAL, id: 'c-any', combo: { mode: 'manual', steps: [
  { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'op-any', type: 'section', section_id: SECTION, groups: { [FLAV]: { use: 'only', option_ids: ['o-bbq'] } } }] },
] } }

const config = {
  items: Object.fromEntries([WINGS, TENDERS, FRIES, MEAL, PLAIN, ANY].map(i => [i.id, structuredClone(i)])),
  groups: LIB,
  section_items: sectionItemsOf([{ sections: [{ id: SECTION, items: [WINGS, TENDERS] }, { id: SIDES, items: [FRIES] }, { id: DEALS, items: [MEAL, PLAIN, ANY] }] }]),
  design: normaliseDesign({}),
  sold_out: [],
}
const ctx = comboCtx(config)
const tillPick = ids => ids.map(id => ({ id }))
const tillSel = (wings, fries) => ({ choices: {}, combo: {
  'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: wings }],
  'st-side': [{ option_id: 'op-fries', item_id: FRIES.id, choices: fries }],
} })

// ── What is stored ───────────────────────────────────────────────

test('normaliseDealGroups: only real changes are kept, the rest left out', () => {
  assert.equal(normaliseDealGroups(null), null)
  assert.equal(normaliseDealGroups([]), null)
  assert.equal(normaliseDealGroups({ a: { use: 'all' } }), null, 'as on the dish with nothing changed is no change')
  assert.deepEqual(normaliseDealGroups({ a: { use: 'only', option_ids: [] } }), { a: { use: 'off' } }, 'none ticked asks nothing')
  assert.deepEqual(normaliseDealGroups({ a: { use: 'off', min: 2, max: 3 } }), { a: { use: 'off' } }, 'how many means nothing when left out')
  assert.equal(normaliseDealGroups({ a: { use: 'swap' } }), null, 'a swap needs a group')
  assert.equal(normaliseDealGroups({ a: { use: 'swap', group_id: 'a' } }), null, 'a swap to itself is no change')
  assert.deepEqual(normaliseDealGroups({ a: { use: 'all', min: 5, max: 2 } }), { a: { use: 'all', max: 2, min: 2 } }, 'at least never above at most')
  assert.deepEqual(normaliseDealGroups({ a: { use: 'all', max: 0, min: -3 } }), { a: { use: 'all', max: 1, min: 0 } })
  assert.deepEqual(normaliseDealGroups({ a: { use: 'all', max: 99 } }), { a: { use: 'all', max: 20 } })
  assert.equal(normaliseDealGroups({ a: { use: 'all', max: 'x', min: '' } }), null)
  assert.deepEqual(normaliseDealGroups({ a: { use: 'only', option_ids: ['x', 'x', 'y', ''] } }), { a: { use: 'only', option_ids: ['x', 'y'] } })
  assert.deepEqual(normaliseDealGroups({ a: { use: 'nonsense', min: 1 } }), { a: { use: 'all', min: 1 } }, 'an unknown use is as on the dish')
})

test('normaliseCombo: a choice keeps groups only when set, and a typed-in choice never', () => {
  const c = normaliseCombo({ steps: [{ id: 's', options: [
    { id: 'a', type: 'item', item_id: 'i1', groups: DEAL.wings },
    { id: 'b', type: 'item', item_id: 'i2', groups: { [FLAV]: { use: 'all' } } },
    { id: 'c', type: 'section', section_id: 's1', groups: { [DIPS]: { use: 'off' } } },
    { id: 'd', type: 'custom', label: 'Toy', groups: { [DIPS]: { use: 'off' } } },
    { id: 'e', type: 'item', item_id: 'i3' },
  ] }] })
  const [a, b, sec, custom, e] = c.steps[0].options
  assert.deepEqual(a.groups, { [FLAV]: { use: 'only', option_ids: ['o-lemon', 'o-hot', 'o-garlic'], max: 2 }, [DIPS]: { use: 'off' } })
  assert.equal('groups' in b, false, 'no real change: no groups key, so the deal is no change to publish')
  assert.deepEqual(sec.groups, { [DIPS]: { use: 'off' } })
  assert.equal('groups' in custom, false)
  assert.equal('groups' in e, false)
  // stepChoices carries them to every dish the choice offers.
  const choices = stepChoices(normaliseCombo(ANY.combo).steps[0], ctx)
  assert.deepEqual(choices.map(x => [x.item_id, x.groups]), [[WINGS.id, { [FLAV]: { use: 'only', option_ids: ['o-bbq'] } }], [TENDERS.id, { [FLAV]: { use: 'only', option_ids: ['o-bbq'] } }]])
})

test('dealSwapIds: the library groups a deal asks instead', () => {
  assert.deepEqual(dealSwapIds(MEAL), [MEAL_SAUCE])
  assert.deepEqual(dealSwapIds(PLAIN), [])
  assert.deepEqual(dealSwapIds(WINGS), [])
})

// ── The rule ─────────────────────────────────────────────────────

test('dealChoices: leave out, only some, another group, how many', () => {
  const own = posChoices(WINGS, LIB)
  assert.deepEqual(own.map(c => c.key), [FLAV, DIPS])
  assert.equal(dealChoices(own, null), own, 'no changes: the dish\'s own')

  const deal = dealChoices(own, DEAL.wings)
  assert.deepEqual(deal.map(c => c.key), [FLAV], 'the dip question is gone')
  assert.deepEqual(deal[0].options.map(o => o.id), ['o-lemon', 'o-hot', 'o-garlic'])
  assert.deepEqual([deal[0].min, deal[0].max], [1, 2])
  assert.deepEqual(own[0].options.length, 4, 'the dish\'s own choices are untouched')

  // How many can't be more than the options left (unless a pick can repeat).
  const two = dealChoices(own, { [FLAV]: { use: 'only', option_ids: ['o-lemon', 'o-hot'], min: 3, max: 3 } })
  assert.deepEqual([two[0].min, two[0].max], [2, 2])
  const dips = dealChoices(own, { [DIPS]: { use: 'all', min: 1, max: 4 } })
  assert.deepEqual([dips[1].min, dips[1].max, dips[1].on_request], [1, 4, false], 'a repeat group may ask more than it has; a needed group never waits behind a button')

  // Another group: from the caller's library, in the caller's shape.
  const swapped = dealChoices(posChoices(FRIES, LIB), DEAL.fries, id => posChoices({ variant_groups: [{ ...LIB[id], group_id: id }] }, LIB)[0] || null)
  assert.deepEqual(swapped.map(c => [c.key, c.name, c.min, c.max]), [[MEAL_SAUCE, 'Meal sauce', 1, 1]])
  assert.deepEqual(swapped[0].options.map(o => [o.id, o.price_pence]), [['o-msk', 0], ['o-msm', 20]])
  // A group that can't be found is left out; none of the ticked options left: left out.
  assert.deepEqual(dealChoices(posChoices(FRIES, LIB), DEAL.fries, () => null), [])
  assert.deepEqual(dealChoices(own, { [FLAV]: { use: 'only', option_ids: ['gone'] } }).map(c => c.key), [DIPS])
  // Asked once when a swap brings in a group the dish has too.
  const twice = dealChoices(own, { [FLAV]: { use: 'swap', group_id: DIPS } }, id => posChoices({ variant_groups: [{ ...LIB[id], group_id: id }] }, LIB)[0])
  assert.deepEqual(twice.map(c => c.key), [DIPS])
})

// ── Pricing: the till (and kiosks) ──────────────────────────────

test('till: the deal\'s options are the ones that price; others are refused or not asked', () => {
  const ok = priceItem(config.items[MEAL.id], tillSel({ [FLAV]: tillPick(['o-lemon', 'o-hot']) }, { [MEAL_SAUCE]: tillPick(['o-msm']) }), ctx)
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.unit_price, 1500)
  assert.deepEqual(ok.combo[0].modifiers.map(m => m.label), ['Lemon pepper', 'Atomic'])
  assert.deepEqual(ok.combo[1].modifiers.map(m => [m.group, m.label, m.price]), [['Meal sauce', 'Mayo', 20]])
  assert.equal(ok.combo[1].extras, 20, 'the deal group\'s own price, not the dish\'s sauce price')

  const bbq = priceItem(config.items[MEAL.id], tillSel({ [FLAV]: tillPick(['o-bbq']) }, { [MEAL_SAUCE]: tillPick(['o-msk']) }), ctx)
  assert.equal(bbq.ok, false)
  assert.match(bbq.error, /no longer available/, 'a flavour the deal doesn\'t offer is refused')

  const three = priceItem(config.items[MEAL.id], tillSel({ [FLAV]: tillPick(['o-lemon', 'o-hot', 'o-garlic']) }, { [MEAL_SAUCE]: tillPick(['o-msk']) }), ctx)
  assert.equal(three.ok, false)
  assert.match(three.error, /up to 2/)

  // A dip picked anyway isn't asked in the deal: not charged, not on the ticket.
  const dip = priceItem(config.items[MEAL.id], tillSel({ [FLAV]: tillPick(['o-lemon']), [DIPS]: tillPick(['o-ranch']) }, { [MEAL_SAUCE]: tillPick(['o-msk']) }), ctx)
  assert.equal(dip.ok, true, dip.error)
  assert.deepEqual(dip.combo[0].modifiers.map(m => m.label), ['Lemon pepper'])
  assert.equal(dip.combo[0].extras, 0)

  // The fries' own sauce isn't asked; the meal sauce is needed.
  const own = priceItem(config.items[MEAL.id], tillSel({ [FLAV]: tillPick(['o-lemon']) }, { [SAUCE]: tillPick(['o-mayo']) }), ctx)
  assert.equal(own.ok, false)
  assert.match(own.error, /meal sauce/i)

  // Without changes the dish is asked as on its own: BBQ is fine, one flavour only.
  const plain = priceItem(config.items[PLAIN.id], { choices: {}, combo: { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: { [FLAV]: tillPick(['o-bbq']), [DIPS]: tillPick(['o-ranch']) } }] } }, ctx)
  assert.equal(plain.ok, true, plain.error)
  assert.equal(plain.combo[0].extras, 50)

  // A section choice changes every dish of the section that has the group:
  // here one flavour is left, so the deal picks it (whatever was picked).
  for (const id of [WINGS.id, TENDERS.id]) {
    for (const picked of [tillPick(['o-lemon']), tillPick(['o-bbq']), undefined]) {
      const r = priceItem(config.items[ANY.id], { choices: {}, combo: { 'st-main': [{ option_id: 'op-any', item_id: id, choices: picked ? { [FLAV]: picked } : {} }] } }, ctx)
      assert.equal(r.ok, true, id + ' ' + r.error)
      assert.deepEqual(r.combo[0].modifiers.map(m => m.label), ['BBQ'], id)
    }
  }
})

test('partChoices + dealItem: what a till or kiosk shows for a part is what prices', () => {
  const wings = dealItem(config, WINGS.id, DEAL.wings)
  assert.notEqual(wings, config.items[WINGS.id], 'a copy: the menu\'s dish keeps its own choices')
  assert.deepEqual(wings.pos_choices.map(c => c.key), [FLAV])
  assert.deepEqual(config.items[WINGS.id].pos_choices.map(c => c.key), [FLAV, DIPS])
  assert.equal(dealItem(config, WINGS.id, null), config.items[WINGS.id], 'no changes: the item itself')
  assert.equal(dealItem(config, 'nope', DEAL.wings), null)
  const fries = partChoices(config.items[FRIES.id], DEAL.fries, LIB)
  assert.deepEqual(fries.map(c => [c.key, c.mode, c.repeat, c.prefixes]), [[MEAL_SAUCE, 'extra', false, false]])
})

test('picksWithin: a dish\'s picks carried into a deal keep only what it asks', () => {
  const choices = dealItem(config, WINGS.id, DEAL.wings).pos_choices
  const picked = {
    [FLAV]: [{ id: 'o-lemon' }, { id: 'o-bbq' }, { id: 'o-hot', prefix: null }, { id: 'o-garlic' }],
    [DIPS]: [{ id: 'o-ranch' }],
    unknown: [{ id: 'x' }],
  }
  assert.deepEqual(picksWithin(choices, picked), { [FLAV]: [{ id: 'o-lemon' }, { id: 'o-hot', prefix: null }] }, 'BBQ isn\'t offered, the dip isn\'t asked, no more than two')
  assert.deepEqual(picksWithin(choices, {}), {})
  // "No" picks don't count towards the most.
  const sauce = [{ key: 'g', max: 1, options: [{ id: 'a' }, { id: 'b' }] }]
  assert.deepEqual(picksWithin(sauce, { g: [{ id: 'a', prefix: 'no' }, { id: 'b' }, { id: 'a' }] }), { g: [{ id: 'a', prefix: 'no' }, { id: 'b' }] })
})

// ── Pricing: online ordering ─────────────────────────────────────

test('online: the same rule, with the deal\'s groups sent with the combo', () => {
  const combo = { ...structuredClone(MEAL), deal_groups: { [MEAL_SAUCE]: itemChoices({ variant_groups: [attached(LIB[MEAL_SAUCE])] })[0] } }
  const octx = { itemsById: { [WINGS.id]: WINGS, [FRIES.id]: FRIES }, sectionItems: {} }
  const line = (wings, fries) => ({ choices: {}, combo: { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: wings }], 'st-side': [{ option_id: 'op-fries', item_id: FRIES.id, choices: fries }] } })
  const ok = priceLine(combo, line({ [FLAV]: ['o-lemon', 'o-hot'] }, { [MEAL_SAUCE]: ['o-msm'] }), [], octx)
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.unit_pence, 1520)
  assert.deepEqual(ok.parts[1].options.map(o => [o.group, o.label, o.price_pence]), [['Meal sauce', 'Mayo', 20]])
  assert.match(priceLine(combo, line({ [FLAV]: ['o-bbq'] }, { [MEAL_SAUCE]: ['o-msk'] }), [], octx).error, /no longer available/)
  assert.match(priceLine(combo, line({ [FLAV]: ['o-lemon'] }, {}), [], octx).error, /meal sauce/i)
  const dip = priceLine(combo, line({ [FLAV]: ['o-lemon'], [DIPS]: ['o-ranch'] }, { [MEAL_SAUCE]: ['o-msk'] }), [], octx)
  assert.equal(dip.unit_pence, 1500, 'a dip the deal doesn\'t ask costs nothing')
  // Without the deal's groups (an old page), the swapped group isn't asked rather than the dish's own.
  const bare = priceLine(structuredClone(MEAL), line({ [FLAV]: ['o-lemon'] }, { [SAUCE]: ['o-mayo'] }), [], octx)
  assert.equal(bare.ok, true, bare.error)
  assert.equal(bare.unit_pence, 1500)
})

// ── Kiosks: the meal's picture ──────────────────────────────────

test('bundleParts: a group the deal asks instead puts its picks on the dish\'s picture', () => {
  const deal = { ...MEAL, combo: { mode: 'manual', steps: [
    { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'op-wings', type: 'item', item_id: WINGS.id, groups: { [FLAV]: { use: 'swap', group_id: MEAL_FLAV } } }] },
  ] } }
  const picks = { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: { [MEAL_FLAV]: [{ id: 'o-mf1' }] } }] }
  const parts = bundleParts(config, deal, picks)
  assert.deepEqual(parts.map(p => [p.src, p.split]), [['/wings.png', ['/meal-lemon.png']]])
  // Without the swap the meal flavour isn't the dish's: nothing on its picture.
  assert.deepEqual(bundleParts(config, PLAIN, picks).map(p => p.split), [[]])
})

// ── Automatic combos: a dish on its own counts only as the deal could ask it ──

test('dealFits: picks in a group the deal narrows must be its options, within its how many', () => {
  assert.equal(dealFits(null, { [FLAV]: ['o-bbq'] }), true, 'no changes: anything fits')
  assert.equal(dealFits(DEAL.wings, null), true, 'picks not known: fits (as before)')
  assert.equal(dealFits(DEAL.wings, { [FLAV]: ['o-lemon'] }), true)
  assert.equal(dealFits(DEAL.wings, { [FLAV]: ['o-bbq'] }), false, 'BBQ isn\'t in the deal')
  assert.equal(dealFits(DEAL.wings, { [FLAV]: ['o-lemon'], [DIPS]: ['o-ranch', 'o-ranch'] }), true, 'a dip the deal leaves out stays on the dish at its own price')
  assert.equal(dealFits(DEAL.fries, { [SAUCE]: ['o-mayo'] }), true, 'the same for a group the deal swaps')
  assert.equal(dealFits({ [SAUCE]: { use: 'swap', group_id: MEAL_SAUCE, max: 1 } }, { [SAUCE]: ['o-mayo', 'o-ketchup'] }), true, 'a swap\'s how many is for the group it asks, not the dish\'s own')
  assert.equal(dealFits({ [DIPS]: { use: 'all', max: 1 } }, { [DIPS]: ['o-ranch', 'o-blue'] }), false, 'more than the deal\'s most')
  assert.equal(dealFits({ [DIPS]: { use: 'all', max: 1 } }, { [DIPS]: ['o-ranch'] }), true)
  assert.equal(dealFits({ [FLAV]: { use: 'only', option_ids: ['o-lemon'] } }, {}), true, 'nothing picked in it: nothing outside the deal')
})

const AUTO = { ...structuredClone(MEAL), id: 'c-auto', name: 'Auto meal', combo: { ...structuredClone(MEAL.combo), mode: 'auto' } }
const actx = { itemsById: config.items, sectionItems: config.section_items }
const separate = (flavours, extra = {}) => [
  { key: 'w', item_id: WINGS.id, section_id: SECTION, qty: 1, unit_base: 1299, picks: { [FLAV]: flavours }, ...extra },
  { key: 'f', item_id: FRIES.id, section_id: SIDES, qty: 1, unit_base: 350, picks: { [SAUCE]: ['o-mayo'] } },
]

test('findAutoCombos: only dishes whose options the deal could have asked', () => {
  assert.equal(findAutoCombos(separate(['o-lemon']), [AUTO], actx)[0]?.saving, 149, 'lemon pepper wings and fries: the deal (1299 + 350 - 1500)')
  assert.deepEqual(findAutoCombos(separate(['o-bbq']), [AUTO], actx), [], 'BBQ wings aren\'t the deal')
  assert.equal(findAutoCombos(separate(['o-bbq']).map(({ picks, ...l }) => l), [AUTO], actx)[0]?.saving, 149, 'a caller that doesn\'t say: as before')
  // The cheapest choice that fits: a second choice offers the whole section unchanged, for 50p more.
  const two = structuredClone(AUTO)
  two.combo.steps[0].options.push({ id: 'op-any', type: 'section', section_id: SECTION, price_pence: 50 })
  assert.equal(findAutoCombos(separate(['o-lemon']), [two], actx)[0]?.saving, 149, 'lemon pepper: the deal\'s own wings choice')
  assert.equal(findAutoCombos(separate(['o-bbq']), [two], actx)[0]?.saving, 99, 'BBQ: through the section choice, with its 50p')
})

test('the till and online ordering pass each dish\'s picks', () => {
  // The till: picks from the line's modifiers (not "No", not nested).
  const tconfig = { ...config, items: { ...config.items, [AUTO.id]: structuredClone(AUTO) } }
  const tctx = comboCtx(tconfig)
  const line = (id, item, choices) => {
    const r = priceItem(tconfig.items[item.id], { choices }, tctx)
    assert.equal(r.ok, true, r.error)
    return { id, item_id: item.id, section_id: item.section_id, qty: 1, unit_price: r.unit_price, modifiers: r.modifiers, status: 'new' }
  }
  const fries = line('f', FRIES, { [SAUCE]: tillPick(['o-mayo']) })
  const lemon = autoCombosFor({ lines: [line('w', WINGS, { [FLAV]: tillPick(['o-lemon']) }), fries] }, tconfig)
  assert.deepEqual(lemon.map(c => [c.promotion_id, c.count]), [[AUTO.id, 1]])
  assert.deepEqual(autoCombosFor({ lines: [line('w', WINGS, { [FLAV]: tillPick(['o-bbq']) }), fries] }, tconfig), [], 'till: BBQ wings aren\'t the deal')
  assert.deepEqual(autoCombosFor({ lines: [line('w', WINGS, { [FLAV]: [{ id: 'o-lemon' }], [DIPS]: [{ id: 'o-ranch' }, { id: 'o-ranch' }] }), fries] }, tconfig).length, 1, 'till: a dip the deal leaves out doesn\'t stop it')
  // A "No" pick isn't a pick, and an option's own nested group isn't the dish's group.
  const odd = { ...line('w', WINGS, { [FLAV]: tillPick(['o-lemon']) }) }
  odd.modifiers = [...odd.modifiers, { group_id: FLAV, option_id: 'o-bbq', prefix: 'no' }]
  assert.equal(autoCombosFor({ lines: [odd, fries] }, tconfig).length, 1, 'till: No BBQ isn\'t BBQ')
  odd.modifiers = [...odd.modifiers.filter(m => m.prefix !== 'no'), { group_id: FLAV, option_id: 'o-bbq', depth: 1 }]
  assert.equal(autoCombosFor({ lines: [odd, fries] }, tconfig).length, 1, 'till: a nested pick isn\'t the dish\'s own')

  // Online: picks from the basket line's own choices.
  const ib = Object.fromEntries([WINGS, FRIES, AUTO].map(i => [i.id, structuredClone(i)]))
  const opts = { combos: { ctx: { itemsById: ib, sectionItems: config.section_items }, auto: [ib[AUTO.id]] } }
  const basket = flavour => [{ item_id: WINGS.id, qty: 1, choices: { [FLAV]: [flavour] } }, { item_id: FRIES.id, qty: 1, choices: { [SAUCE]: ['o-mayo'] } }]
  const yes = priceBasket(ib, basket('o-lemon'), opts)
  assert.deepEqual(yes.combos.map(c => [c.combo_id, c.discount_pence]), [[AUTO.id, 149]])
  const no = priceBasket(ib, basket('o-bbq'), opts)
  assert.deepEqual(no.combos, [], 'online: BBQ wings aren\'t the deal')
  assert.equal(no.discount_pence, 0)
})

// ── A group left with one option: the deal picks it ──────────────

const swapLib = id => posChoices({ variant_groups: [{ ...LIB[id], group_id: id }] }, LIB)[0] || null

test('dealChoices: a changed group left with one option to pick is picked by the deal (fixed)', () => {
  const own = posChoices(WINGS, LIB)
  const fixedOf = groups => dealChoices(own, groups, swapLib).map(c => [c.key, c.fixed || null])
  // One flavour left (a flavour must be picked): the deal picks it.
  assert.deepEqual(fixedOf({ [FLAV]: { use: 'only', option_ids: ['o-lemon'] } }), [[FLAV, ['o-lemon']], [DIPS, null]])
  // Two left: still asked.
  assert.deepEqual(fixedOf({ [FLAV]: { use: 'only', option_ids: ['o-lemon', 'o-hot'] } }), [[FLAV, null], [DIPS, null]])
  // An optional group (dips) left with one option is still asked (yes or no)...
  assert.deepEqual(fixedOf({ [DIPS]: { use: 'only', option_ids: ['o-ranch'] } }), [[FLAV, null], [DIPS, null]])
  // So is an optional pick-one group left with one option.
  const optional = dealChoices([{ key: 'k', min: 0, max: 1, options: [{ id: 'a' }, { id: 'b' }] }], { k: { use: 'only', option_ids: ['a'] } })
  assert.equal(optional[0].fixed, undefined)
  // ...unless the deal says at least one: then a set number of it.
  assert.deepEqual(fixedOf({ [DIPS]: { use: 'only', option_ids: ['o-ranch'], min: 2, max: 2 } }), [[FLAV, null], [DIPS, ['o-ranch', 'o-ranch']]])
  // A repeat group with a range is still asked how many.
  assert.deepEqual(fixedOf({ [DIPS]: { use: 'only', option_ids: ['o-ranch'], min: 1, max: 3 } }), [[FLAV, null], [DIPS, null]])
  // A group the deal leaves alone isn't picked, even with one option.
  const single = dealChoices([{ key: 'k', min: 1, max: 1, options: [{ id: 'only' }] }], { other: { use: 'off' } })
  assert.equal(single[0].fixed, undefined)
  // Another group with one option, a pick needed: picked.
  assert.deepEqual(fixedOf({ [FLAV]: { use: 'swap', group_id: MEAL_FLAV } }), [[MEAL_FLAV, ['o-mf1']], [DIPS, null]])
  // An option that opens a group of its own is still asked.
  const nested = dealChoices([{ key: 'k', min: 1, max: 1, options: [{ id: 'steak', child_group_id: 'g-cook' }, { id: 'fish' }] }], { k: { use: 'only', option_ids: ['steak'] } })
  assert.equal(nested[0].fixed, undefined)
})

test('withDealPicks / askedChoices: fill what the deal picks, ask the rest', () => {
  const choices = dealChoices(posChoices(WINGS, LIB), { [FLAV]: { use: 'only', option_ids: ['o-lemon'] } })
  assert.deepEqual(askedChoices(choices).map(c => c.key), [DIPS])
  assert.deepEqual(askedChoices(null), [])
  const picks = { [DIPS]: [{ id: 'o-ranch' }] }
  assert.deepEqual(withDealPicks(choices, picks), { [DIPS]: [{ id: 'o-ranch' }], [FLAV]: ['o-lemon'] })
  // A stale pick for the fixed group is replaced; nothing fixed: the same picks back.
  assert.deepEqual(withDealPicks(choices, { [FLAV]: ['o-bbq'] }), { [FLAV]: ['o-lemon'] })
  const asked = askedChoices(choices)
  assert.equal(withDealPicks(asked, picks), picks)
  assert.deepEqual(withDealPicks(choices, undefined), { [FLAV]: ['o-lemon'] })
})

// The wings in a deal with one flavour left; the fries as before.
const ONE = { ...MEAL, id: 'c-one', combo: { mode: 'manual', steps: [
  { id: 'st-main', name: 'Main', min: 1, max: 1, options: [{ id: 'op-wings', type: 'item', item_id: WINGS.id, groups: { [FLAV]: { use: 'only', option_ids: ['o-lemon'] }, [DIPS]: { use: 'off' } } }] },
] } }

test('till and kiosk: the deal\'s pick prices and shows without being asked', () => {
  const cfg = { ...config, items: { ...config.items, [ONE.id]: structuredClone(ONE) } }
  const cctx = comboCtx(cfg)
  const r = priceItem(cfg.items[ONE.id], { choices: {}, combo: { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: {} }] } }, cctx)
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.combo[0].modifiers.map(m => [m.group_id, m.label]), [[FLAV, 'Lemon pepper']])
  // dealItem keeps the group, marked: the till and kiosk ask askedChoices() only.
  const part = dealItem(cfg, WINGS.id, ONE.combo.steps[0].options[0].groups)
  assert.deepEqual(part.pos_choices.map(c => [c.key, c.fixed || null]), [[FLAV, ['o-lemon']]])
  assert.deepEqual(askedChoices(part.pos_choices), [])
  // The kiosk's picks: the deal's pick filled in as an { id } entry.
  const { steps, picks } = resolveSteps(cfg.items[ONE.id], { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: {} }] }, cctx)
  const filled = fillDealPicks(cfg, steps, picks)
  assert.deepEqual(filled['st-main'][0].choices, { [FLAV]: [{ id: 'o-lemon' }] })
  assert.notEqual(filled, picks, 'a new picks object')
  // Nothing fixed: the same picks object back.
  const plainSteps = resolveSteps(cfg.items[PLAIN.id], { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: {} }] }, cctx)
  assert.equal(fillDealPicks(cfg, plainSteps.steps, plainSteps.picks), plainSteps.picks)
  // The meal's picture puts the deal's flavour on the wings (split photo).
  const pic = bundleParts(cfg, cfg.items[ONE.id], filled)
  assert.equal(pic.length, 1)
  assert.equal(pic[0].src, '/wings.png')
  assert.deepEqual(pic[0].split, ['/lemon-wings.png'], 'the wings split by the deal\'s flavour')
  assert.deepEqual(bundleParts(cfg, cfg.items[ONE.id], picks)[0].split, [], 'unfilled: no flavour on the picture')
})

test('online: the deal\'s pick prices without being asked, and lists on the line', () => {
  const octx = { itemsById: { [WINGS.id]: WINGS, [FRIES.id]: FRIES }, sectionItems: {} }
  const r = priceLine(structuredClone(ONE), { choices: {}, combo: { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: {} }] } }, [], octx)
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.parts[0].options.map(o => o.label), ['Lemon pepper'])
  // A stale pick is replaced by the deal's.
  const stale = priceLine(structuredClone(ONE), { choices: {}, combo: { 'st-main': [{ option_id: 'op-wings', item_id: WINGS.id, choices: { [FLAV]: ['o-bbq'] } }] } }, [], octx)
  assert.deepEqual(stale.parts[0].options.map(o => o.label), ['Lemon pepper'])
})

test('moveDealGroup: a dish\'s own options turned into a group keep the deal\'s changes', () => {
  const ids = { 'v:Chicken': 'o-c', 'v:Beef': 'o-b', 'v:Prawn': 'o-p' }
  // Only some: the picked labels become the group's option ids.
  assert.deepEqual(moveDealGroup({ variants: { use: 'only', option_ids: ['v:Chicken', 'v:Prawn'], max: 1 } }, 'variants', 'g-new', ids),
    { 'g-new': { use: 'only', option_ids: ['o-c', 'o-p'], max: 1 } })
  // Left out and how many move as they are; other groups stay.
  assert.deepEqual(moveDealGroup({ variants: { use: 'off' }, [DIPS]: { use: 'off' } }, 'variants', 'g-new', ids),
    { [DIPS]: { use: 'off' }, 'g-new': { use: 'off' } })
  assert.deepEqual(moveDealGroup({ variants: { use: 'all', min: 2, max: 2 } }, 'variants', 'g-new', ids),
    { 'g-new': { use: 'all', min: 2, max: 2 } })
  // A section choice keeps the old entry for the section's other dishes.
  assert.deepEqual(moveDealGroup({ variants: { use: 'off' } }, 'variants', 'g-new', ids, { keepOld: true }),
    { variants: { use: 'off' }, 'g-new': { use: 'off' } })
  // A picked label the group doesn't have goes; none left = left out.
  assert.deepEqual(moveDealGroup({ variants: { use: 'only', option_ids: ['v:Tofu'] } }, 'variants', 'g-new', ids),
    { 'g-new': { use: 'off' } })
  // Nothing to move, or the group already has its own entry: unchanged.
  assert.equal(moveDealGroup(null, 'variants', 'g-new', ids), null)
  assert.deepEqual(moveDealGroup({ [DIPS]: { use: 'off' } }, 'variants', 'g-new', ids), { [DIPS]: { use: 'off' } })
  assert.deepEqual(moveDealGroup({ variants: { use: 'off' }, 'g-new': { use: 'all', max: 1 } }, 'variants', 'g-new', ids),
    { variants: { use: 'off' }, 'g-new': { use: 'all', max: 1 } })
})
