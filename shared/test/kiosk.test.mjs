// Kiosk tests: the design settings, the built-in words in every language,
// the translation keys, a basket as till events, the kiosk rules in the
// check rules and the sequencer taking a kiosk order.
// Run: node --test shared/test/ shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseDesign, designProblems, payMethods, uiText, allergenName, translationSources, TK, pickImages, hexLayout, cornerWidths,
  configImages, MAX_SAVED_PICTURES, guestFit, countFits, cleanPrefs, prefsOn, kioskOrder, basketCheck, kioskStaff, kioskFontsUrl, UI_TEXT, ALLERGEN_NAMES, KIOSK_LANGUAGES, DESIGN_COLORS, CLEAR_COLORS, CHOICE_ENTRANCES,
  groupLook, ENTRANCE_KEYS, bundleParts, bundleLayout, bundleBox, BUNDLE_MAX, PART_COLORS, PART_FOLLOWS, COLOR_LABELS, partColours,
  pictureFit, fitLayout, PICTURE_FITS, PICTURE_FOCUS, PICTURE_BGS, BANNER_SHAPES, BANNER_RATIOS, KIOSK_MIN_SHORT, kioskScale,
} from '../kiosk.js'
import { contrast } from '../themeKit.js'
import { VARIATION_TYPES, VARIATION_TYPE_KEYS } from '../procurement.js'
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
  assert.deepEqual(plain.layout, {
    tiles: 'cards', option_tiles: 'cards', option_pictures: true, option_align: 'left',
    hero: 'beside', hero_image_align: 'center', hero_text_align: 'center', hero_backdrop: true, combo_build: true, fly_to_order: true, header: true, icon_buttons: false,
  })
  assert.equal(plain.options.pick_photos, undefined, 'set per option group and step now')
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
  // Choices keep the dishes' style until the design picks their own.
  assert.deepEqual(d.layout, {
    tiles: 'hexagon', option_tiles: 'hexagon', option_pictures: true, option_align: 'left',
    hero: 'beside', hero_image_align: 'center', hero_text_align: 'center', hero_backdrop: true, combo_build: true, fly_to_order: true, header: false, icon_buttons: true,
  })
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

test('design: dishes and choices each have their own picture style', () => {
  const d = normaliseDesign({ layout: { tiles: 'round', option_tiles: 'hexagon' } })
  assert.equal(d.layout.tiles, 'round')
  assert.equal(d.layout.option_tiles, 'hexagon')
  assert.equal(normaliseDesign({ layout: { tiles: 'hexagon', option_tiles: 'cards' } }).layout.option_tiles, 'cards')
  assert.equal(normaliseDesign({ layout: { tiles: 'oval', option_tiles: 'star' } }).layout.option_tiles, 'oval')
  assert.equal(normaliseDesign({ layout: { option_tiles: 'round' } }).layout.tiles, 'cards')
  assert.deepEqual(normaliseDesign(d), d)
})

test('design: no frame, the dish page photo on top', () => {
  const d = normaliseDesign({
    layout: { tiles: 'plain', option_tiles: 'plain', hero: 'stacked', hero_image_align: 'right', hero_text_align: 'left' },
  })
  assert.equal(d.layout.tiles, 'plain')
  assert.equal(d.layout.option_tiles, 'plain')
  assert.equal(d.layout.hero, 'stacked')
  assert.equal(d.layout.hero_image_align, 'right')
  assert.equal(d.layout.hero_text_align, 'left')
  assert.deepEqual(normaliseDesign(d), d)
  // Choices follow no frame dishes until the design picks their own.
  assert.equal(normaliseDesign({ layout: { tiles: 'plain' } }).layout.option_tiles, 'plain')
  // Unknown values: photo beside, centred.
  const odd = normaliseDesign({ layout: { hero: 'above', hero_image_align: 'middle', hero_text_align: 'justify' } })
  assert.equal(odd.layout.hero, 'beside')
  assert.equal(odd.layout.hero_image_align, 'center')
  assert.equal(odd.layout.hero_text_align, 'center')
})

test('design: choices words only, and centred', () => {
  const d = normaliseDesign({ layout: { option_tiles: 'hexagon', option_pictures: false, option_align: 'center' } })
  assert.equal(d.layout.option_tiles, 'hexagon')
  assert.equal(d.layout.option_pictures, false)
  assert.equal(d.layout.option_align, 'center')
  assert.deepEqual(normaliseDesign(d), d)
  // Only false turns the pictures off; an unknown line-up is from the left.
  const odd = normaliseDesign({ layout: { option_pictures: 0, option_align: 'middle' } }).layout
  assert.equal(odd.option_pictures, true)
  assert.equal(odd.option_align, 'left')
})

test('honeycomb: rows lock together; a few choices still make two rows', () => {
  const shape = (n, max, compact) => hexLayout(n, max, compact).rows.map(r => r.length)
  // Every other row sits half a hexagon over (odd starts, then even starts).
  const locked = ({ rows }) => rows.every((r, i) => r.every(x => x % 2 === (i % 2 ? 0 : 1)))
  // Dishes: rows of max and max - 1, filled from the left.
  assert.deepEqual(shape(4, 5, false), [4])
  assert.deepEqual(shape(9, 3, false), [3, 2, 3, 1])
  assert.deepEqual(hexLayout(9, 3).rows[3], [2])
  // Choices: two rows from three on, while they fit.
  assert.deepEqual(shape(1, 5, true), [1])
  assert.deepEqual(shape(2, 5, true), [2])
  assert.deepEqual(shape(3, 5, true), [2, 1])
  assert.deepEqual(shape(4, 5, true), [2, 2])
  assert.deepEqual(shape(5, 5, true), [3, 2])
  assert.deepEqual(shape(7, 5, true), [4, 3])
  assert.deepEqual(hexLayout(3, 5, true), { rows: [[1, 3], [2]], width: 4 })
  assert.deepEqual(hexLayout(4, 5, true), { rows: [[1, 3], [2, 4]], width: 5 })
  // More than two rows' worth: rows of max and max - 1, the last centred.
  assert.deepEqual(shape(7, 3, true), [3, 2, 2])
  assert.deepEqual(hexLayout(12, 5, true).rows, [[1, 3, 5, 7, 9], [2, 4, 6, 8], [3, 5, 7]])
  for (let n = 0; n <= 20; n++) {
    for (const max of [2, 3, 5]) {
      for (const compact of [false, true]) {
        const l = hexLayout(n, max, compact)
        assert.equal(l.rows.flat().length, n, `all placed (${n}, ${max}, ${compact})`)
        assert.ok(locked(l), `rows interlock (${n}, ${max}, ${compact})`)
        assert.ok(l.rows.flat().every(x => x + 1 <= l.width), `inside the width (${n}, ${max}, ${compact})`)
        if (compact && n >= 3) assert.ok(l.rows.length >= 2, `two rows or more (${n}, ${max})`)
      }
    }
  }
})

test('split photo: the picks of groups and steps with it on, in pick order', () => {
  const groups = {
    [FLAVOUR]: { ...config.groups[FLAVOUR], kiosk_pick_photo: 'split', options: [{ id: LEMON, label: 'Lemon pepper', image_url: '/lemon.jpg' }, { id: HOT, label: 'Atomic', image_url: '/hot.jpg' }] },
    [EXTRAS]: { ...config.groups[EXTRAS], options: [{ id: DIP, label: 'Ranch', image_url: '/ranch.jpg' }] },
  }
  const dish = { ...WINGS, pos_choices: [{ key: FLAVOUR }, { key: EXTRAS }] }
  const cfg = { ...config, groups }
  const pick = (...ids) => ({ choices: { [FLAVOUR]: ids.map(id => ({ id })), [EXTRAS]: [{ id: DIP }] } })
  // One pick: its picture (the kiosk shows it in place of the dish's photo, or in the corner).
  assert.deepEqual(pickImages(cfg, dish, pick(HOT)).split, ['/hot.jpg'])
  // In pick order; a group without the switch adds nothing.
  assert.deepEqual(pickImages(cfg, dish, pick(HOT, LEMON)).split, ['/hot.jpg', '/lemon.jpg'])
  // With the setting off nothing splits.
  assert.deepEqual(pickImages({ ...config }, dish, pick(HOT, LEMON)), { split: [], corner: [] })
  // An option without a picture is left out; the same option twice shows once.
  const noPic = { ...cfg, groups: { ...groups, [FLAVOUR]: { ...groups[FLAVOUR], options: [{ id: LEMON, label: 'Lemon pepper' }, groups[FLAVOUR].options[1]] } } }
  assert.deepEqual(pickImages(noPic, dish, pick(HOT, LEMON)).split, ['/hot.jpg'])
  assert.deepEqual(pickImages(cfg, dish, pick(HOT, HOT)).split, ['/hot.jpg'])
  assert.deepEqual(pickImages(cfg, dish, pick()).split, [])
  // A combo: steps with it on show the picked dishes' photos (a typed-in choice its own picture), then its own groups.
  const C1 = uuid(), C2 = uuid()
  const meal = { ...MEAL, pos_choices: [], combo: { steps: [
    { ...MEAL.combo.steps[0], pick_photo: 'split', options: [{ id: M1, type: 'item', item_id: WINGS.id }, { id: C1, type: 'custom', label: 'Tenders', image_url: '/tenders.jpg' }] },
    { ...MEAL.combo.steps[1], options: [{ id: S1, type: 'item', item_id: FRIES.id }] },
    { id: uuid(), name: 'Dip', min: 0, max: 1, pick_photo: 'split', options: [{ id: C2, type: 'custom', label: 'Blue cheese', image_url: '/blue.jpg' }] },
  ] } }
  const items = { ...config.items, [WINGS.id]: { ...config.items[WINGS.id], image_url: '/wings.jpg' }, [FRIES.id]: { ...config.items[FRIES.id], image_url: '/fries.jpg' } }
  const cfg2 = { ...config, items }
  const combo = steps => ({ choices: {}, combo: steps })
  assert.deepEqual(pickImages(cfg2, meal, combo({ [MAIN]: [{ option_id: M1, item_id: WINGS.id }], [SIDE]: [{ option_id: S1, item_id: FRIES.id }] })).split, ['/wings.jpg'])
  assert.deepEqual(pickImages(cfg2, meal, combo({
    [MAIN]: [{ option_id: M1, item_id: WINGS.id }, { option_id: C1, item_id: null }],
    [SIDE]: [{ option_id: S1, item_id: FRIES.id }],
    [meal.combo.steps[2].id]: [{ option_id: C2, item_id: null }],
  })).split, ['/wings.jpg', '/tenders.jpg', '/blue.jpg'])
  assert.deepEqual(pickImages(cfg2, null, {}), { split: [], corner: [] })
})

test('split photo: a choice\'s On dish picture (photo_url) wins over its tile picture', () => {
  const groups = {
    [FLAVOUR]: { ...config.groups[FLAVOUR], kiosk_pick_photo: 'split', options: [
      { id: LEMON, label: 'Lemon pepper', image_url: '/lemon-tile.png', photo_url: '/lemon-wings.jpg' },
      { id: HOT, label: 'Atomic', image_url: '/hot-tile.png' },
    ] },
  }
  const dish = { ...WINGS, pos_choices: [{ key: FLAVOUR }] }
  const cfg = { ...config, groups }
  const pick = (...ids) => ({ choices: { [FLAVOUR]: ids.map(id => ({ id })) } })
  assert.deepEqual(pickImages(cfg, dish, pick(LEMON)).split, ['/lemon-wings.jpg'])
  // Without one, the tile picture as before.
  assert.deepEqual(pickImages(cfg, dish, pick(LEMON, HOT)).split, ['/lemon-wings.jpg', '/hot-tile.png'])
  // An On dish picture alone is enough.
  const onlyPhoto = { ...cfg, groups: { [FLAVOUR]: { ...groups[FLAVOUR], options: [{ id: LEMON, label: 'Lemon pepper', photo_url: '/lemon-wings.jpg' }] } } }
  assert.deepEqual(pickImages(onlyPhoto, dish, pick(LEMON)).split, ['/lemon-wings.jpg'])
  // Combo choices: a dish choice's On meal picture wins over the dish's photo, a typed-in one's over its tile.
  const C1 = uuid()
  const meal = { ...MEAL, pos_choices: [], combo: { steps: [
    { ...MEAL.combo.steps[0], pick_photo: 'split', options: [
      { id: M1, type: 'item', item_id: WINGS.id, photo_url: '/wings-in-box.jpg' },
      { id: C1, type: 'custom', label: 'Tenders', image_url: '/tenders-tile.png', photo_url: '/tenders-in-box.jpg' },
    ] },
  ] } }
  const items = { ...config.items, [WINGS.id]: { ...config.items[WINGS.id], image_url: '/wings.jpg' } }
  assert.deepEqual(pickImages({ ...config, items }, meal, { choices: {}, combo: { [MAIN]: [{ option_id: M1, item_id: WINGS.id }, { option_id: C1, item_id: null }] } }).split,
    ['/wings-in-box.jpg', '/tenders-in-box.jpg'])
  // Pictures kept on the kiosk include On dish pictures.
  const origin = 'https://kiosk.example.test'
  assert.ok(configImages({ groups }, origin).includes(origin + '/lemon-wings.jpg'))
})

test('pick photos: the flavours split the photo, the dip small in the corner', () => {
  const groups = {
    [FLAVOUR]: { ...config.groups[FLAVOUR], kiosk_pick_photo: 'split', options: [{ id: LEMON, label: 'Lemon pepper', image_url: '/lemon.jpg' }, { id: HOT, label: 'Atomic', image_url: '/hot.jpg' }] },
    [EXTRAS]: { ...config.groups[EXTRAS], kiosk_pick_photo: 'corner', options: [{ id: DIP, label: 'Ranch', image_url: '/ranch-tile.png', photo_url: '/ranch-pot.png' }] },
  }
  const dish = { ...WINGS, pos_choices: [{ key: FLAVOUR }, { key: EXTRAS }] }
  const cfg = { ...config, groups }
  assert.deepEqual(pickImages(cfg, dish, { choices: { [FLAVOUR]: [{ id: HOT }, { id: LEMON }], [EXTRAS]: [{ id: DIP }] } }),
    { split: ['/hot.jpg', '/lemon.jpg'], corner: [{ src: '/ranch-pot.png', scale: null, tiles: 'cards' }] })
  // Only the dip picked: the dish's own photo with the dip in the corner.
  assert.deepEqual(pickImages(cfg, dish, { choices: { [EXTRAS]: [{ id: DIP }] } }), { split: [], corner: [{ src: '/ranch-pot.png', scale: null, tiles: 'cards' }] })
  // Combo steps the same: the main splits, the drink in the corner.
  const C1 = uuid(), C2 = uuid()
  const meal = { ...MEAL, pos_choices: [], combo: { steps: [
    { ...MEAL.combo.steps[0], pick_photo: 'split', options: [{ id: C1, type: 'custom', label: 'Tenders', image_url: '/tenders.jpg' }] },
    { ...MEAL.combo.steps[1], pick_photo: 'corner', options: [{ id: C2, type: 'custom', label: 'Cola', image_url: '/cola.png' }] },
  ] } }
  assert.deepEqual(pickImages(config, meal, { choices: {}, combo: { [MAIN]: [{ option_id: C1, item_id: null }], [SIDE]: [{ option_id: C2, item_id: null }] } }),
    { split: ['/tenders.jpg'], corner: [{ src: '/cola.png', scale: null, tiles: 'cards' }] })
})

test('corner pictures: each group or step sets their size as a share of the photo', () => {
  const groups = {
    [EXTRAS]: { ...config.groups[EXTRAS], kiosk_pick_photo: 'corner', kiosk_pick_scale: 40, options: [{ id: DIP, label: 'Ranch', image_url: '/ranch.png' }] },
  }
  const dish = { ...WINGS, pos_choices: [{ key: EXTRAS }] }
  assert.deepEqual(pickImages({ ...config, groups }, dish, { choices: { [EXTRAS]: [{ id: DIP }] } }).corner, [{ src: '/ranch.png', scale: 40, tiles: 'cards' }])
  // A size out of range or not whole counts as automatic.
  for (const bad of [5, 71, 25.5, '30', null]) {
    const g = { [EXTRAS]: { ...groups[EXTRAS], kiosk_pick_scale: bad } }
    assert.equal(pickImages({ ...config, groups: g }, dish, { choices: { [EXTRAS]: [{ id: DIP }] } }).corner[0].scale, bad === '30' ? 30 : null, String(bad))
  }
  // A combo step's pick_scale.
  const C2 = uuid()
  const meal = { ...MEAL, pos_choices: [], combo: { steps: [
    { ...MEAL.combo.steps[1], pick_photo: 'corner', pick_scale: 55, options: [{ id: C2, type: 'custom', label: 'Cola', image_url: '/cola.png' }] },
  ] } }
  assert.deepEqual(pickImages(config, meal, { choices: {}, combo: { [MEAL.combo.steps[1].id]: [{ option_id: C2, item_id: null }] } }).corner, [{ src: '/cola.png', scale: 55, tiles: 'cards' }])

  // Widths along the strip (92% of the photo): a set size is its share of the photo.
  assert.deepEqual(cornerWidths([{ scale: null }]), [26], 'automatic: as before')
  assert.deepEqual(cornerWidths([{ scale: 46 }]), [50], '46% of the photo is half the strip')
  const [a, b] = cornerWidths([{ scale: 23 }, { scale: null }])
  assert.equal(a, 25)
  assert.equal(b, 26)
  // Too big to fit side by side: all shrink by one factor, gaps kept.
  const big = cornerWidths([{ scale: 70 }, { scale: 70 }])
  assert.ok(Math.abs(big[0] + big[1] + 2 - 100) < 0.05, 'they fill the strip with the gap')
  assert.equal(big[0], big[1])
  const three = cornerWidths([{ scale: 60 }, { scale: 20 }, { scale: null }])
  assert.ok(three[0] > three[2] && three[2] > three[1], 'the order of sizes is kept')
  assert.deepEqual(cornerWidths([]), [])
})

test('design: pictures or videos above the kiosk while the reach button has slid it down', () => {
  assert.deepEqual(normaliseDesign({}).behaviour.reach_media, [])
  const d = normaliseDesign({ behaviour: { reach_media: [
    { id: 'a', type: 'video', url: '/uploads/reach.mp4' }, { type: 'image', url: '/uploads/reach.jpg' }, { type: 'gif', url: '/uploads/x.png' },
    { type: 'image' }, { url: '/uploads/4.jpg' }, { url: '/uploads/5.jpg' }, { url: '/uploads/6.jpg' },
  ] } })
  assert.equal(d.behaviour.reach_media.length, 4, 'at most 4, ones without an address dropped')
  assert.deepEqual(d.behaviour.reach_media.slice(0, 3).map(m => [m.type, m.url]),
    [['video', '/uploads/reach.mp4'], ['image', '/uploads/reach.jpg'], ['image', '/uploads/x.png']])
  assert.deepEqual(normaliseDesign(d), d)
  // Pictures (not videos) are kept on the kiosk for offline.
  const origin = 'https://kiosk.example.test'
  const imgs = configImages({ design: d }, origin)
  assert.ok(imgs.includes(origin + '/uploads/reach.jpg'))
  assert.ok(!imgs.includes(origin + '/uploads/reach.mp4'))
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

test('configImages: every picture the kiosk can show, on its own origin, each once', () => {
  const origin = 'https://kiosk.example.test'
  const config = {
    design: normaliseDesign({
      brand: { logo_url: '/uploads/logo.png' },
      start: { media: [{ id: 'm1', type: 'image', url: '/uploads/start.jpg' }, { id: 'm2', type: 'video', url: '/uploads/start.mp4' }] },
      menu: {
        banners: [{ id: 'b1', image_url: '/uploads/banner.jpg', title: 'Hot', link: { kind: 'none' } }],
        featured: [{ id: 'f1', image_url: 'https://cdn.other.test/feature.jpg', title: 'Deal', link: { kind: 'none' } }],
      },
    }),
    sections: [{ id: 's1', image_url: '/uploads/section.png', item_ids: ['i1'] }],
    items: {
      i1: { id: 'i1', image_url: '/uploads/wings.jpg', combo: { steps: [{ id: 'st', options: [{ id: 'o', image_url: '/uploads/dip.png' }] }] } },
      i2: { id: 'i2', image_url: origin + '/uploads/wings.jpg' },
      i3: { id: 'i3', image_url: 'data:image/png;base64,AAAA' },
      i4: { id: 'i4', image_url: null },
    },
    groups: { g1: { options: [{ id: 'x', image_url: '/uploads/flavour.png' }] } },
  }
  const urls = configImages(config, origin)
  assert.deepEqual(urls.slice(0, 3), [origin + '/uploads/logo.png', origin + '/uploads/start.jpg', origin + '/uploads/banner.jpg'], 'the design first')
  for (const u of ['section.png', 'wings.jpg', 'dip.png', 'flavour.png']) assert.ok(urls.includes(origin + '/uploads/' + u), u)
  assert.equal(urls.filter(u => u.endsWith('wings.jpg')).length, 1, 'each picture once')
  assert.ok(!urls.some(u => u.endsWith('.mp4')), 'no videos')
  assert.ok(!urls.some(u => u.includes('cdn.other.test') || u.startsWith('data:')), 'only the kiosk\'s own pictures')
  assert.deepEqual(configImages(null, origin), [])
  const many = { items: Object.fromEntries(Array.from({ length: MAX_SAVED_PICTURES + 50 }, (_, n) => ['i' + n, { image_url: '/uploads/p' + n + '.jpg' }])) }
  assert.equal(configImages(many, origin).length, MAX_SAVED_PICTURES, 'capped below the cache size')
})

test('the number a guest types is a tent unless the design says table', () => {
  assert.equal(normaliseDesign({}).checkout.number_kind, 'tent')
  assert.equal(normaliseDesign({ checkout: { number_kind: 'table' } }).checkout.number_kind, 'table')
  assert.equal(normaliseDesign({ checkout: { number_kind: 'chair' } }).checkout.number_kind, 'tent')
  for (const lang of Object.keys(UI_TEXT)) {
    for (const k of ['tent_number', 'tent_hint', 'tent_done']) assert.ok(UI_TEXT[lang][k], lang + ' has ' + k)
    assert.match(UI_TEXT[lang].tent_done, /\{n\}/, lang + ' tent_done names the tent')
  }
})

test('See-through colours: only cards, buttons and highlights may be transparent', () => {
  const d = normaliseDesign({ brand: { colors: {
    surface: 'transparent', primary: 'transparent', accent: 'transparent',
    background: 'transparent', text: 'transparent', primary_text: 'none',
  } } })
  const c = d.brand.colors
  assert.equal(c.surface, 'transparent')
  assert.equal(c.primary, 'transparent')
  assert.equal(c.accent, 'transparent')
  assert.equal(c.background, DESIGN_COLORS.background)
  assert.equal(c.text, DESIGN_COLORS.text)
  assert.equal(c.primary_text, DESIGN_COLORS.primary_text)
  assert.deepEqual(CLEAR_COLORS, ['surface', 'primary', 'accent'])
  // Round trip: a saved design keeps them.
  assert.equal(normaliseDesign(d).brand.colors.surface, 'transparent')
})

test('bottom bar and side menu colours: not set they follow as before, set ones stay, their words stay readable', () => {
  const NIGHT = { background: '#121212', surface: '#1f1f1f', text: '#f5f5f5', muted: '#a3a3a3', primary: '#ffc72c', primary_text: '#121212', accent: '#2f9e44', accent_text: '#ffffff' }
  // Nothing set: null, and the look from before (the bar in Text with the
  // Page colour for its words; the side menu in Cards with Text words).
  const plain = normaliseDesign({}).brand.colors
  for (const k of PART_COLORS) assert.equal(plain[k], null, k)
  assert.deepEqual(partColours(plain), { bar: plain.text, bar_text: plain.background, rail: plain.surface, rail_text: plain.text })
  const night = normaliseDesign({ brand: { colors: NIGHT } }).brand.colors
  assert.deepEqual(partColours(night), { bar: '#f5f5f5', bar_text: '#121212', rail: '#1f1f1f', rail_text: '#f5f5f5' })
  // Set: kept in lower case; anything but a colour code is dropped (no See-through either).
  const d = normaliseDesign({ brand: { colors: { ...NIGHT, bar: '#C8102E', rail: '#000000', bar_text: 'red', rail_text: 'transparent' } } })
  assert.equal(d.brand.colors.bar, '#c8102e')
  assert.equal(d.brand.colors.rail, '#000000')
  assert.equal(d.brand.colors.bar_text, null)
  assert.equal(d.brand.colors.rail_text, null)
  assert.deepEqual(normaliseDesign(d).brand.colors, d.brand.colors, 'a saved design keeps them')
  // Words not set: whichever of Page and Text reads better on their part.
  const p = partColours(d.brand.colors)
  assert.equal(p.bar_text, '#f5f5f5', 'light words on a red bar, not the near-black page colour')
  assert.equal(p.rail_text, '#f5f5f5', 'light words on a black side menu')
  assert.equal(partColours({ ...NIGHT, bar: '#ffd43b' }).bar_text, '#121212', 'a yellow bar on the dark design: the dark page colour')
  assert.equal(partColours({ ...DESIGN_COLORS, rail: '#0b3d2e' }).rail_text, DESIGN_COLORS.background, 'a dark side menu on a light design: the light page colour')
  for (const bar of ['#c8102e', '#ffd43b', '#0b3d2e', '#7a7a7a', '#ffffff', '#000000']) {
    const q = partColours({ ...NIGHT, bar })
    const other = q.bar_text === NIGHT.background ? NIGHT.text : NIGHT.background
    assert.ok(contrast(q.bar_text, bar) >= contrast(other, bar), bar + ': the better of the two')
  }
  // Words set: as set, even when hard to read (the designer warns).
  assert.equal(partColours({ ...NIGHT, bar: '#c8102e', bar_text: '#c8102e' }).bar_text, '#c8102e')
  // See-through cards: the side menu follows (see-through), its words worked out on the page.
  const clear = partColours({ ...DESIGN_COLORS, surface: 'transparent' })
  assert.equal(clear.rail, 'transparent')
  assert.equal(clear.rail_text, DESIGN_COLORS.text)
  assert.equal(partColours({ ...DESIGN_COLORS, surface: 'transparent', rail: '#222222' }).rail_text, DESIGN_COLORS.background)
  // Every one has a name; the parts' backgrounds follow Text and Cards.
  for (const k of PART_COLORS) assert.ok(COLOR_LABELS[k], k)
  assert.deepEqual(PART_FOLLOWS, { bar: 'text', rail: 'surface' })
})

test('choice entrances: kept when known, none otherwise', () => {
  assert.deepEqual(CHOICE_ENTRANCES.map(x => x.key), ['none', 'appear', 'slide', 'bubble', 'deal'])
  assert.equal(normaliseDesign({}).options.entrance, 'none')
  for (const k of ['appear', 'slide', 'bubble', 'deal']) assert.equal(normaliseDesign({ options: { entrance: k } }).options.entrance, k)
  assert.equal(normaliseDesign({ options: { entrance: 'explode' } }).options.entrance, 'none')
})

test('option groups with their own look: the design\'s for the group, else the group\'s own, else the design\'s', () => {
  assert.deepEqual(ENTRANCE_KEYS, CHOICE_ENTRANCES.map(x => x.key))
  // The list: one row per group, unknown values dropped to "not set", kept with nothing set.
  const A = uuid(), B = uuid()
  const d = normaliseDesign({ options: { group_looks: [
    { group_id: A, display: 'wheel', tiles: 'hexagon', pictures: false, entrance: 'deal' },
    { group_id: A, tiles: 'round' },
    { group_id: B, display: 'carousel', tiles: 'square', pictures: 'no', entrance: 'explode' },
    { group_id: 'not-a-uuid', tiles: 'round' },
    { tiles: 'round' },
  ] } })
  assert.deepEqual(d.options.group_looks, [
    { group_id: A, display: 'wheel', tiles: 'hexagon', pictures: false, entrance: 'deal' },
    { group_id: B, display: null, tiles: null, pictures: null, entrance: null },
  ])
  assert.deepEqual(normaliseDesign({}).options.group_looks, [])
  assert.deepEqual(normaliseDesign({ options: { group_looks: 'x' } }).options.group_looks, [])
  assert.equal(normaliseDesign({ options: { group_looks: Array.from({ length: 250 }, () => ({ group_id: uuid() })) } }).options.group_looks.length, 200)
  // A saved design keeps them.
  assert.deepEqual(normaliseDesign(d).options.group_looks, d.options.group_looks)

  const design = normaliseDesign({ layout: { option_tiles: 'cards' }, options: { display: 'grid', entrance: 'appear' } })
  const plain = { id: A }
  // Nothing set anywhere: the design's for every choice.
  assert.deepEqual(groupLook(design, plain), { display: 'grid', tiles: 'cards', pictures: true, entrance: 'appear' })
  assert.deepEqual(groupLook(design, null), { display: 'grid', tiles: 'cards', pictures: true, entrance: 'appear' })
  assert.deepEqual(groupLook(null, null), { display: 'grid', tiles: 'cards', pictures: true, entrance: 'none' }, 'no design: the defaults')
  // The group's own look wins over the design's.
  const own = { id: A, kiosk_display: 'slider', kiosk_tiles: 'round', kiosk_pictures: false, kiosk_entrance: 'bubble' }
  assert.deepEqual(groupLook(design, own), { display: 'slider', tiles: 'round', pictures: false, entrance: 'bubble' })
  // Values the group can't have count as not set.
  assert.deepEqual(groupLook(design, { id: A, kiosk_display: 'carousel', kiosk_tiles: 'square', kiosk_pictures: 'no', kiosk_entrance: 'explode' }),
    { display: 'grid', tiles: 'cards', pictures: true, entrance: 'appear' })
  // The design's look for the group wins over the group's own, part by part.
  const withLook = look => normaliseDesign({ ...design, options: { ...design.options, group_looks: [{ group_id: A, ...look }] } })
  assert.deepEqual(groupLook(withLook({ tiles: 'hexagon' }), own), { display: 'slider', tiles: 'hexagon', pictures: false, entrance: 'bubble' })
  assert.deepEqual(groupLook(withLook({ pictures: true, entrance: 'none' }), own), { display: 'slider', tiles: 'round', pictures: true, entrance: 'none' })
  assert.deepEqual(groupLook(withLook({ display: 'wheel', tiles: 'plain', pictures: false, entrance: 'deal' }), plain),
    { display: 'wheel', tiles: 'plain', pictures: false, entrance: 'deal' })
  // Another group's look doesn't touch this one, nor choices that aren't a group's.
  assert.deepEqual(groupLook(withLook({ tiles: 'hexagon' }), { id: B }), { display: 'grid', tiles: 'cards', pictures: true, entrance: 'appear' })
  assert.deepEqual(groupLook(withLook({ tiles: 'hexagon' }), null), { display: 'grid', tiles: 'cards', pictures: true, entrance: 'appear' })

  // Corner pictures on the dish's photo are framed in their group's style; a step's in the design's.
  const groups = {
    [EXTRAS]: { ...config.groups[EXTRAS], kiosk_pick_photo: 'corner', kiosk_tiles: 'round', options: [{ id: DIP, label: 'Ranch', image_url: '/ranch.png' }] },
  }
  const dish = { ...WINGS, pos_choices: [{ key: EXTRAS }] }
  const pick = { choices: { [EXTRAS]: [{ id: DIP }] } }
  assert.equal(pickImages({ ...config, groups, design }, dish, pick).corner[0].tiles, 'round')
  const hexDesign = normaliseDesign({ ...design, options: { ...design.options, group_looks: [{ group_id: EXTRAS, tiles: 'hexagon' }] } })
  assert.equal(pickImages({ ...config, groups, design: hexDesign }, dish, pick).corner[0].tiles, 'hexagon')
  const C2 = uuid()
  const meal = { ...MEAL, pos_choices: [], combo: { steps: [
    { ...MEAL.combo.steps[1], pick_photo: 'corner', options: [{ id: C2, type: 'custom', label: 'Cola', image_url: '/cola.png' }] },
  ] } }
  const ovals = normaliseDesign({ layout: { option_tiles: 'oval' } })
  assert.equal(pickImages({ ...config, design: ovals }, meal, { choices: {}, combo: { [MEAL.combo.steps[1].id]: [{ option_id: C2, item_id: null }] } }).corner[0].tiles, 'oval')
})

test('variation types: what an option group does to the dish, for stock', () => {
  assert.deepEqual(VARIATION_TYPE_KEYS, ['modification', 'side', 'addition'])
  for (const t of VARIATION_TYPES) assert.ok(t.label && t.hint, t.key)
})

test('design: the shade behind the dish\'s photo, the meal deal picture from the picks and the flight into the order, all on unless turned off', () => {
  const d = normaliseDesign({})
  assert.equal(d.layout.hero_backdrop, true)
  assert.equal(d.layout.combo_build, true)
  assert.equal(d.layout.fly_to_order, true)
  const off = normaliseDesign({ layout: { hero_backdrop: false, combo_build: false, fly_to_order: false } })
  assert.deepEqual([off.layout.hero_backdrop, off.layout.combo_build, off.layout.fly_to_order], [false, false, false])
  // Only false turns them off.
  const odd = normaliseDesign({ layout: { hero_backdrop: 'no', combo_build: 0, fly_to_order: null } })
  assert.deepEqual([odd.layout.hero_backdrop, odd.layout.combo_build, odd.layout.fly_to_order], [true, true, true])
})

// A meal: dips (small, first, twice), the main (wings split by their flavours, with their own dip), a side, a drink, a note with no picture.
function mealSetup() {
  const groups = {
    [FLAVOUR]: { ...config.groups[FLAVOUR], kiosk_pick_photo: 'split', options: [{ id: LEMON, label: 'Lemon pepper', image_url: '/lemon.png' }, { id: HOT, label: 'Atomic', image_url: '/hot.png', photo_url: '/hot-wings.png' }] },
    [EXTRAS]: { ...config.groups[EXTRAS], kiosk_pick_photo: 'corner', options: [{ id: DIP, label: 'Ranch', image_url: '/ranch.png' }] },
  }
  const items = {
    ...config.items,
    [WINGS.id]: { ...config.items[WINGS.id], image_url: '/wings.png', pos_choices: [{ key: FLAVOUR }, { key: EXTRAS }] },
    [FRIES.id]: { ...config.items[FRIES.id], image_url: '/fries.png' },
  }
  const ids = { DIPS: uuid(), DRINK: uuid(), NOTE: uuid(), BLUE: uuid(), COKE: uuid(), WATER: uuid(), PLAIN: uuid(), T1: uuid() }
  const meal = { ...MEAL, pos_choices: [{ key: EXTRAS }], combo: { steps: [
    { id: ids.DIPS, name: 'Dip', min: 0, max: 2, repeat: true, pick_photo: 'corner', options: [{ id: ids.BLUE, type: 'custom', label: 'Blue cheese', image_url: '/blue-tile.png', photo_url: '/blue-pot.png' }] },
    { ...MEAL.combo.steps[0], options: [{ id: M1, type: 'item', item_id: WINGS.id }, { id: ids.T1, type: 'custom', label: 'Tenders' }] },
    { ...MEAL.combo.steps[1], options: [{ id: S1, type: 'item', item_id: FRIES.id, photo_url: '/fries-cup.png' }] },
    { id: ids.DRINK, name: 'Drink', min: 1, max: 1, options: [{ id: ids.COKE, type: 'custom', label: 'Cola', image_url: '/cola.png' }, { id: ids.WATER, type: 'custom', label: 'Water' }] },
    { id: ids.NOTE, name: 'Note', min: 0, max: 1, options: [{ id: ids.PLAIN, type: 'custom', label: 'No ice' }] },
  ] } }
  const picks = {
    [ids.DIPS]: [{ option_id: ids.BLUE, item_id: null }, { option_id: ids.BLUE, item_id: null }],
    [MAIN]: [{ option_id: M1, item_id: WINGS.id, choices: { [FLAVOUR]: [{ id: HOT }, { id: LEMON }], [EXTRAS]: [{ id: DIP }] } }],
    [SIDE]: [{ option_id: S1, item_id: FRIES.id }],
    [ids.DRINK]: [{ option_id: ids.COKE, item_id: null }],
    [ids.NOTE]: [{ option_id: ids.PLAIN, item_id: null }],
  }
  return { cfg: { ...config, groups, items }, meal, picks, ids }
}

test('meal deal picture: every step\'s picks with a picture, the first step big, corner steps small', () => {
  const { cfg, meal, picks, ids } = mealSetup()
  const parts = bundleParts(cfg, meal, picks, { [EXTRAS]: [{ id: DIP }] })
  assert.deepEqual(parts.map(p => [p.size, p.src, p.split.join('+'), p.item_id]), [
    // The dip step comes first but is set to the corner: small, once per pick, its picture for the meal.
    ['small', '/blue-pot.png', '', null],
    ['small', '/blue-pot.png', '', null],
    // The first step with a picture that isn't small: the wings, split by their flavours (a flavour's picture for the dish first) ...
    ['main', '/wings.png', '/hot-wings.png+/lemon.png', WINGS.id],
    // ... their own corner pick small beside them.
    ['small', '/ranch.png', '', null],
    // The side's picture for the meal wins over the dish's photo; a typed-in choice shows its own picture.
    ['side', '/fries-cup.png', '', FRIES.id],
    ['side', '/cola.png', '', null],
    // No ice has no picture: left out. The deal's own corner pick last.
    ['small', '/ranch.png', '', null],
  ])
  assert.equal(new Set(parts.map(p => p.sig)).size, parts.length, 'every part has its own sig')

  // New flavours: only the wings change.
  const again = bundleParts(cfg, meal, { ...picks, [MAIN]: [{ ...picks[MAIN][0], choices: { [FLAVOUR]: [{ id: LEMON }] } }] }, { [EXTRAS]: [{ id: DIP }] })
  const wingsNow = again.find(p => p.item_id === WINGS.id)
  const wingsBefore = parts.find(p => p.item_id === WINGS.id)
  assert.notEqual(wingsNow.sig, wingsBefore.sig, 'the wings come in again')
  assert.deepEqual(wingsNow.split, ['/lemon.png'])
  assert.equal(again.find(p => p.src === '/cola.png').sig, parts.find(p => p.src === '/cola.png').sig, 'the drink is the same part')
  assert.equal(again.filter(p => p.src === '/ranch.png').length, 1, 'no flavour or dip on the wings now: only the deal\'s own dip')

  // A main pick without a picture: the next step's pick is the big one.
  const noPic = bundleParts(cfg, meal, { [MAIN]: [{ option_id: ids.T1, item_id: null }], [SIDE]: [{ option_id: S1, item_id: FRIES.id }], [ids.DRINK]: [{ option_id: ids.COKE, item_id: null }] })
  assert.deepEqual(noPic.map(p => [p.size, p.src]), [['main', '/fries-cup.png'], ['side', '/cola.png']])
  // A picked dish without a photo is left out.
  const bare = { ...cfg, items: { ...cfg.items, [WINGS.id]: { ...cfg.items[WINGS.id], image_url: null } } }
  assert.equal(bundleParts(bare, meal, { [MAIN]: picks[MAIN] }).filter(p => p.item_id === WINGS.id).length, 0)
  // Nothing picked, or not a meal deal: nothing to build (the deal keeps its photo).
  assert.deepEqual(bundleParts(cfg, meal, {}), [])
  assert.deepEqual(bundleParts(cfg, cfg.items[WINGS.id], picks), [])
  assert.deepEqual(bundleParts(cfg, null, picks), [])
  // At most BUNDLE_MAX.
  const many = bundleParts(cfg, meal, { [ids.DIPS]: Array.from({ length: 12 }, () => ({ option_id: ids.BLUE, item_id: null })) })
  assert.equal(many.length, BUNDLE_MAX)
})

test('a small screen: the kiosk zoomed out to a short side of KIOSK_MIN_SHORT', () => {
  assert.equal(KIOSK_MIN_SHORT, 800)
  // A phone, either way round: the same scale, so the page is laid out 800 across its short side.
  const k = kioskScale(412, 915)
  assert.equal(k, 0.515)
  assert.equal(kioskScale(915, 412), k, 'turned: the same scale')
  assert.ok(412 / k >= 800 && 412 / k < 801, 'never narrower than 800')
  assert.equal(kioskScale(360, 780), 0.45)
  // Rounded down, so the short side comes out at least 800.
  for (const short of [320, 375, 390, 393, 400, 411, 414, 430, 540, 600, 720, 768, 799]) {
    const s = kioskScale(short, short * 2)
    assert.ok(s < 1 && short / s >= 800 && short / s < 802, short + ' -> ' + s)
  }
  // 800 or more on the short side (a 10" tablet, a 1080 x 1920 kiosk, a landscape 1920 x 1080): as it is.
  for (const [w, h] of [[800, 1280], [810, 1440], [1080, 1920], [1920, 1080], [1280, 800], [2160, 3840]]) assert.equal(kioskScale(w, h), 1, w + ' x ' + h)
  // Unknown: as it is.
  for (const [w, h] of [[0, 0], [undefined, 900], [null, null], [NaN, 400], [-412, 915], ['412', '915']]) {
    assert.equal(kioskScale(w, h), w === '412' ? 0.515 : 1, String(w) + ' x ' + String(h))
  }
  assert.equal(kioskScale(40, 80), 0.1, 'never below a tenth')
})

test('meal deal picture: laid out like a photo of the meal, inside the box', () => {
  const P = (...sizes) => sizes.map(size => ({ size }))
  assert.deepEqual(bundleLayout([]), [])
  assert.deepEqual(bundleBox('cards'), { aspect: 4 / 3, inset: 3 })
  assert.deepEqual(bundleBox('round'), { aspect: 1, inset: 15 })
  assert.deepEqual(bundleBox('hexagon'), { aspect: 0.866, inset: 17 })
  assert.deepEqual(bundleBox('plain'), { aspect: 4 / 3, inset: 0 })
  assert.equal(bundleBox('cards', true).aspect, 1, 'an order line is square')
  const right = p => p.left + p.width
  const bottom = p => p.top + p.height

  // One part: centred.
  const [one] = bundleLayout(P('main'), bundleBox('cards'))
  assert.ok(Math.abs(one.left + one.width / 2 - 50) < 0.05 && Math.abs(one.top + one.height / 2 - 50) < 0.05, JSON.stringify(one))

  const mid = p => p.left + p.width / 2
  // Main and two sides: the first side to the left, the second to the right, smaller, a little further back, the main in the middle.
  const [m, s1, s2] = bundleLayout(P('main', 'side', 'side'), bundleBox('cards'))
  assert.ok(s1.left < m.left && s2.left > m.left, 'left, then right')
  assert.ok(m.width > s1.width && s1.width === s2.width)
  assert.ok(Math.abs(bottom(s1) - bottom(s2)) < 0.05, 'the sides stand on one line')
  assert.ok(Math.abs(bottom(m) - bottom(s1) - 0.08 * m.height) < 0.1, 'a little further back up the table than the main')
  assert.ok(right(s1) > m.left && right(m) > s2.left, 'neighbours overlap a little')
  assert.ok(Math.abs(mid(m) - 50) < 0.05, 'the main in the middle across')
  assert.ok(Math.abs((s1.left + right(s2)) / 2 - 50) < 0.05, 'centred across')
  const three = [m, s1, s2]
  assert.ok(Math.abs((Math.min(...three.map(p => p.top)) + Math.max(...three.map(bottom))) / 2 - 50) < 0.05, 'centred top to bottom')
  assert.ok(m.z > s1.z && m.z > s2.z, 'the main in front of its neighbours')
  // Further out, further back: the third on the far left, the fourth on the far right.
  const five = bundleLayout(P('main', 'side', 'side', 'side', 'side'), bundleBox('cards'))
  assert.ok(bottom(five[3]) < bottom(five[1]) && five[3].z < five[1].z && right(five[3]) < right(five[1]), 'the third side behind the first, further left')
  assert.ok(bottom(five[4]) < bottom(five[2]) && five[4].z < five[2].z && five[4].left > five[2].left, 'the fourth side behind the second, further right')
  assert.ok(Math.abs(mid(five[0]) - 50) < 0.05, 'five parts: the main in the middle')
  // One side (or three): the main still in the middle, no bigger than with a side each way.
  const [om, os] = bundleLayout(P('main', 'side'), bundleBox('cards'))
  assert.ok(right(os) < right(om) && os.left < om.left, 'one side: on the left')
  assert.ok(Math.abs(mid(om) - 50) < 0.05, 'one side: the main in the middle')
  assert.ok(Math.abs(om.width - m.width) < 0.05, 'one side: as big as with a side each way')
  const odd = bundleLayout(P('main', 'side', 'side', 'side'), bundleBox('cards'))
  assert.ok(Math.abs(mid(odd[0]) - 50) < 0.05 && odd[3].left < odd[1].left && odd[2].left > odd[0].left, 'three sides: the main in the middle, the third further left')
  // Two mains (Pick 2 burgers): their middle in the middle of the box.
  const two = bundleLayout(P('main', 'main', 'side'), bundleBox('cards'))
  assert.ok(Math.abs((two[0].left + right(two[1])) / 2 - 50) < 0.05 && two[2].left < two[0].left, 'two mains in the middle, the side on the left')
  // Squares in the box's shape.
  assert.ok(Math.abs(m.height - m.width * 4 / 3) < 0.05)

  // Small parts in front, under the main, reaching below the row's line.
  const l = bundleLayout(P('main', 'side', 'small', 'small'), bundleBox('cards'))
  const [lm, , d1, d2] = l
  assert.ok(d1.z > lm.z && d2.z > lm.z)
  assert.ok(d1.width < l[1].width && d1.width === d2.width)
  assert.ok(bottom(d1) > bottom(lm), 'in front')
  assert.ok(Math.abs((d1.left + right(d2)) / 2 - (lm.left + lm.width / 2)) < 0.05, 'under the main')
  assert.ok(d2.left > right(d1), 'side by side with a gap')

  // Only small parts: they make the row.
  const smalls = bundleLayout(P('small', 'small'), bundleBox('cards'))
  assert.ok(smalls[0].width === smalls[1].width && Math.abs(bottom(smalls[0]) - bottom(smalls[1])) < 0.05)

  // Every mix, every shape: inside the box.
  const kinds = ['main', 'side', 'small']
  for (const tiles of ['cards', 'round', 'oval', 'hexagon', 'plain']) {
    for (const square of [false, true]) {
      const box = bundleBox(tiles, square)
      for (let n = 1; n <= BUNDLE_MAX; n++) {
        for (let seed = 0; seed < 12; seed++) {
          const parts = Array.from({ length: n }, (_, i) => ({ size: kinds[(i * 7 + seed * 3 + (i === 0 ? 0 : seed)) % 3] }))
          for (const p of bundleLayout(parts, box)) {
            assert.ok(p.left >= box.inset - 0.01 && p.top >= box.inset - 0.01 && right(p) <= 100 - box.inset + 0.01 && bottom(p) <= 100 - box.inset + 0.01,
              tiles + (square ? ' square ' : ' ') + parts.map(x => x.size).join(',') + ' ' + JSON.stringify(p))
            assert.ok(p.width > 0 && Math.abs(p.height - p.width * box.aspect) < 0.05)
          }
        }
      }
    }
  }
})

test('guest picks: which dishes suit the allergens and diets a guest picked', () => {
  const tags = it => ({ ...it, dietary: [], allergen_levels: {} })
  const items = {
    [WINGS.id]: { ...tags(WINGS), dietary: ['milk', 'gf'] },
    [FRIES.id]: { ...tags(FRIES), dietary: ['vegan', 'gf'] },
    [COLA.id]: { ...tags(COLA), dietary: ['vegan', 'milk'], allergen_levels: { milk: 'removable' } },
    [MEAL.id]: tags(MEAL),
  }
  const c = { ...config, items }
  const fit = (id, prefs) => guestFit(c, c.items[id], prefs)
  // Nothing picked: no marks, everything counts.
  assert.equal(fit(WINGS.id, { avoid: [], diet: [] }), null)
  assert.equal(prefsOn({ avoid: [], diet: [] }), false)
  assert.deepEqual(countFits(c, [WINGS.id, FRIES.id, COLA.id, MEAL.id, WINGS.id], {}), { total: 4, fits: 4 })
  // Milk: wings have it, cola only on request (still suits, with a note), fries don't.
  assert.deepEqual(fit(WINGS.id, { avoid: ['milk'] }), { ok: false, avoid: [{ code: 'milk', level: 'contains' }], removable: [], missing: [], some: false })
  assert.deepEqual(fit(COLA.id, { avoid: ['milk'] }), { ok: true, avoid: [], removable: ['milk'], missing: [], some: false })
  assert.equal(fit(FRIES.id, { avoid: ['milk'] }).ok, true)
  // May contain counts as having it.
  const may = { ...c, items: { ...items, [FRIES.id]: { ...items[FRIES.id], dietary: ['vegan', 'gf', 'milk'], allergen_levels: { milk: 'may_contain' } } } }
  assert.deepEqual(guestFit(may, may.items[FRIES.id], { avoid: ['milk'] }).avoid, [{ code: 'milk', level: 'may_contain' }])
  // A diet the dish isn't marked with.
  assert.deepEqual(fit(WINGS.id, { diet: ['vegan'] }).missing, ['vegan'])
  assert.equal(fit(FRIES.id, { diet: ['vegan', 'gf'] }).ok, true)
  // The meal: its main (wings) always has milk, so it can't be made without it.
  assert.deepEqual(fit(MEAL.id, { avoid: ['milk'] }), { ok: false, avoid: [{ code: 'milk', level: 'contains' }], removable: [], missing: [], some: false })
  // With a choice of fries as the main too, it can: it suits, some choices have milk.
  const both = { ...c, items: { ...items, [MEAL.id]: { ...items[MEAL.id], combo: { mode: 'auto', steps: [
    { ...MEAL.combo.steps[0], options: [...MEAL.combo.steps[0].options, { id: uuid(), type: 'item', item_id: FRIES.id, price_pence: 0 }] },
    MEAL.combo.steps[1],
  ] } } } }
  assert.deepEqual(guestFit(both, both.items[MEAL.id], { avoid: ['milk'] }), { ok: true, avoid: [{ code: 'milk', level: 'contains' }], removable: [], missing: [], some: true })
  // ...unless the fries are sold out.
  const gone = { ...both, sold_out: [{ item_id: FRIES.id }] }
  assert.equal(guestFit(gone, gone.items[MEAL.id], { avoid: ['milk'] }).ok, false)
  // A diet: every step needs a choice with it. Gluten free: wings and fries both are.
  assert.equal(fit(MEAL.id, { diet: ['gf'] }).ok, true)
  assert.deepEqual(fit(MEAL.id, { diet: ['vegan'] }).missing, ['vegan'])
  assert.deepEqual(guestFit(both, both.items[MEAL.id], { diet: ['vegan'] }).missing, [])
  // A typed-in choice has no tags: fine for allergens, never a diet.
  const typed = { ...c, items: { ...items, [MEAL.id]: { ...items[MEAL.id], combo: { mode: 'auto', steps: [
    { id: MAIN, name: 'Main', min: 1, max: 1, options: [{ id: uuid(), type: 'custom', label: 'Chef special', price_pence: 0 }] },
  ] } } } }
  assert.equal(guestFit(typed, typed.items[MEAL.id], { avoid: ['milk'] }).ok, true)
  assert.deepEqual(guestFit(typed, typed.items[MEAL.id], { diet: ['gf'] }).missing, ['gf'])
  // An optional step never stops it: no required step and the deal's own tags decide a diet.
  const optional = { ...c, items: { ...items, [MEAL.id]: { ...items[MEAL.id], dietary: ['gf'], combo: { mode: 'auto', steps: [
    { ...MEAL.combo.steps[0], min: 0 },
  ] } } } }
  assert.equal(guestFit(optional, optional.items[MEAL.id], { avoid: ['milk'] }).ok, true)
  assert.equal(guestFit(optional, optional.items[MEAL.id], { avoid: ['milk'] }).some, true)
  assert.equal(guestFit(optional, optional.items[MEAL.id], { diet: ['gf'] }).ok, true)
  assert.deepEqual(guestFit(optional, optional.items[MEAL.id], { diet: ['vegan'] }).missing, ['vegan'])
  // The count: milk leaves out the wings and the meal; sold out dishes aren't counted.
  assert.deepEqual(countFits(c, [WINGS.id, FRIES.id, COLA.id, MEAL.id], { avoid: ['milk'] }), { total: 4, fits: 2 })
  assert.deepEqual(countFits({ ...c, sold_out: [{ item_id: COLA.id }] }, [WINGS.id, FRIES.id, COLA.id, MEAL.id], { avoid: ['milk'] }), { total: 3, fits: 1 })
  assert.deepEqual(countFits(c, [WINGS.id, FRIES.id, COLA.id, MEAL.id], { avoid: ['milk'], diet: ['vegan'] }), { total: 4, fits: 2 })
  // Picks tidied: no repeats, no junk.
  assert.deepEqual(cleanPrefs({ avoid: ['milk', 'milk', 3, ''], diet: 'vegan' }), { avoid: ['milk'], diet: [] })
})

test('picture fit: banners, featured tiles, start and reach pictures fill their space or show whole', () => {
  // Nothing set: automatic, centred, full size, nothing behind; banners wide (the old look).
  const d = normaliseDesign({
    start: { media: [{ id: 's1', type: 'image', url: '/a.png' }] },
    menu: { banners: [{ id: 'b1', image_url: '/b.png' }], featured: [{ id: 'f1', image_url: '/f.png', size: 'wide' }] },
    behaviour: { reach_media: [{ id: 'r1', type: 'video', url: '/r.mp4' }] },
  })
  const std = { mode: 'auto', focus: 'center', size: 100, bg: 'none' }
  assert.deepEqual(d.menu.banners[0].fit, std)
  assert.deepEqual(d.menu.featured[0].fit, std)
  assert.equal(d.menu.featured[0].size, 'wide', 'a tile\'s width is its own size, not the picture\'s')
  assert.deepEqual(d.start.media[0].fit, std)
  assert.deepEqual(d.behaviour.reach_media[0].fit, std)
  assert.equal(d.menu.banner_shape, 'wide')
  assert.deepEqual(PICTURE_FITS, ['auto', 'cover', 'contain'])
  assert.equal(PICTURE_FOCUS.length, 9)
  assert.deepEqual(BANNER_SHAPES, ['wide', 'short', 'tall', 'picture'])
  assert.ok(Math.abs(BANNER_RATIOS.wide - 16 / 7) < 1e-9 && BANNER_RATIOS.short === 3 && Math.abs(BANNER_RATIOS.tall - 16 / 9) < 1e-9)

  // Set: kept; bad values back to the defaults; sizes clamped to 30-100 and rounded.
  const set = normaliseDesign({ menu: {
    banner_shape: 'picture',
    banners: [
      { id: 'b1', image_url: '/b.png', fit: { mode: 'contain', focus: 'top left', size: 72.4, bg: 'accent' } },
      { id: 'b2', image_url: '/c.png', fit: { mode: 'stretch', focus: 'middle', size: 5, bg: 'red' } },
      { id: 'b3', image_url: '/d.png', fit: { mode: 'cover', focus: 'bottom', size: 500 } },
      { id: 'b4', image_url: '/e.png', fit: 'contain' },
    ],
  } })
  assert.equal(set.menu.banner_shape, 'picture')
  assert.deepEqual(set.menu.banners.map(b => b.fit), [
    { mode: 'contain', focus: 'top left', size: 72, bg: 'accent' },
    { mode: 'auto', focus: 'center', size: 30, bg: 'none' },
    { mode: 'cover', focus: 'bottom', size: 100, bg: 'none' },
    std,
  ])
  assert.equal(normaliseDesign({ menu: { banner_shape: 'round' } }).menu.banner_shape, 'wide')
  assert.deepEqual(PICTURE_BGS, ['none', 'surface', 'primary', 'accent', 'text'])
  assert.deepEqual(pictureFit(null), std)

  // How it is drawn: automatic fills unless the picture is see-through.
  const auto = fitLayout(std)
  assert.equal(auto.whole, false)
  assert.deepEqual(auto.media, { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' })
  assert.equal(auto.bg, null)
  const autoClear = fitLayout({ ...std, size: 60, bg: 'surface' }, true)
  assert.equal(autoClear.whole, true)
  assert.deepEqual(autoClear.media, { width: '60%', height: '60%', objectFit: 'contain', objectPosition: 'center' })
  assert.equal(autoClear.bg, 'surface')
  // Fill the space crops even a see-through picture, keeps the part asked for in view, never shrinks.
  const cover = fitLayout({ mode: 'cover', focus: 'top', size: 50, bg: 'primary' }, true)
  assert.equal(cover.whole, false)
  assert.deepEqual(cover.media, { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' })
  assert.equal(cover.bg, null)
  // Whole picture, placed bottom right at 40%, on the brand colour.
  const whole = fitLayout({ mode: 'contain', focus: 'bottom right', size: 40, bg: 'primary' })
  assert.equal(whole.whole, true)
  assert.deepEqual(whole.box, { alignItems: 'flex-end', justifyContent: 'flex-end' })
  assert.deepEqual(whole.media, { width: '40%', height: '40%', objectFit: 'contain', objectPosition: 'bottom right' })
  assert.equal(whole.bg, 'primary')
  assert.deepEqual(fitLayout({ mode: 'contain', focus: 'top left' }).box, { alignItems: 'flex-start', justifyContent: 'flex-start' })
  assert.deepEqual(fitLayout({ mode: 'contain', focus: 'left' }).box, { alignItems: 'center', justifyContent: 'flex-start' })
  assert.deepEqual(fitLayout({ mode: 'contain', focus: 'top' }).box, { alignItems: 'flex-start', justifyContent: 'center' })
  assert.equal(fitLayout({ mode: 'contain', bg: 'none' }).bg, null)
})
