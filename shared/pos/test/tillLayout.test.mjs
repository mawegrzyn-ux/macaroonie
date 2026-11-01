// Till layouts (shared/pos/tillLayout.js): the stored shape, what stops a
// save, which zone shows a dish's choices, and how buttons fill a zone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseTillLayout, layoutProblems, layoutWarnings, choiceZones, packCells, buttonLabel,
  ownLayout, layoutIds, templateLayout, LAYOUT_TEMPLATES, overlaps, actionOf, CHECK_BUTTONS,
  buttonTextStyle, ALIGN_KEYS, VALIGN_KEYS, menuZoneMenus, MAX_MENUS, GRID_ZONES,
  FLOATING_ZONES, popupCloseProblem, LABEL_MAX, ZONE_TYPES, MAX_ZONES,
} from '../tillLayout.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

test('normalise: limits, defaults, unknown zones and buttons dropped', () => {
  const l = normaliseTillLayout({
    cols: 99, rows: 1,
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 50, h: 50 },
      { type: 'nonsense', x: 1, y: 1, w: 1, h: 1 },
      { id: 'c', type: 'items', x: 30, y: 2, w: 3, h: 1, cols: 40, rows: 0, font: 3, overflow: 'sideways', search: 'yes' },
      {
        id: 'b', type: 'buttons', x: 1, y: 0, w: 2, h: 2, cols: 3, rows: 2,
        buttons: [
          { id: 'x', action: 'item', item_id: A.toUpperCase(), w: 9, h: 9, label: '  Wings  ', colour: '#ABCDEF' },
          { action: 'item', item_id: 'not-a-uuid' },
          { action: 'launch_rocket' },
          { action: 'tender', tender: 'bitcoin' },
          { action: 'tender', tender: 'voucher', label: 'x'.repeat(60) },
          { id: 'x', action: 'no_sale' },
          { action: 'discount_preset', preset_id: B },
        ],
      },
      { id: 'k', type: 'categories', x: 0, y: 0, w: 1, h: 1, sections: [A, A, 'bad', B] },
      { id: 'm', type: 'modifiers', x: 0, y: 0, w: 1, h: 1, kind: 'weird', cover: 'moon' },
    ],
  })
  assert.equal(l.cols, 24)
  assert.equal(l.rows, 3)
  assert.equal(l.zones.length, 5, 'the unknown zone is dropped')
  const [check, items, buttons, cats, mods] = l.zones
  assert.deepEqual([check.x, check.y, check.w, check.h], [0, 0, 24, 3], 'kept inside the grid')
  assert.notEqual(items.id, 'c', 'a repeated id gets a fresh one')
  assert.deepEqual([items.x, items.y, items.w, items.h], [23, 2, 1, 1])
  assert.equal(items.cols, 12)
  assert.equal(items.rows, 1)
  assert.equal(items.font, 12)
  assert.equal(items.overflow, 'scroll')
  assert.equal(items.search, true, 'not a boolean: the default')
  assert.equal(items.price, true)
  assert.equal(buttons.buttons.length, 4)
  const [wings, voucher, drawer, preset] = buttons.buttons
  assert.equal(wings.item_id, A, 'ids in lower case')
  assert.deepEqual([wings.w, wings.h], [3, 2], 'a button no bigger than its zone\'s grid')
  assert.equal(wings.label, 'Wings')
  assert.equal(wings.colour, '#abcdef')
  assert.equal(voucher.tender, 'voucher')
  assert.equal(voucher.label.length, 40)
  assert.notEqual(drawer.id, 'x', 'a repeated button id gets a fresh one')
  assert.equal(drawer.action, 'no_sale')
  assert.equal(preset.preset_id, B)
  assert.deepEqual(cats.sections, [A, B])
  assert.equal(mods.kind, 'all')
  assert.equal(mods.cover, 'zone')

  const empty = normaliseTillLayout(null)
  assert.deepEqual(empty, { cols: 12, rows: 8, top_bar: true, zones: [] })
  assert.equal(normaliseTillLayout({ zones: [{ type: 'categories' }] }).zones[0].sections, null, 'no list: every section')
})

test('problems: an Order zone, one of each, Dish choices split properly, no overlaps but choices', () => {
  for (const t of LAYOUT_TEMPLATES) assert.deepEqual(layoutProblems(templateLayout(t.key)), [], t.key + ' has no problems')
  const codes = l => layoutProblems(normaliseTillLayout(l)).map(p => p.code).sort()
  assert.deepEqual(codes({ zones: [{ type: 'items', x: 0, y: 0, w: 2, h: 2 }] }), ['no_check'])
  assert.deepEqual(codes({
    zones: [
      { type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { type: 'items', x: 3, y: 0, w: 4, h: 4 },
    ],
  }), ['overlap'])
  // Dish choices may sit over other zones.
  assert.deepEqual(codes({
    zones: [
      { type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { type: 'items', x: 4, y: 0, w: 8, h: 8 },
      { type: 'modifiers', x: 0, y: 0, w: 12, h: 8, cover: 'zone' },
    ],
  }), [])
  assert.deepEqual(codes({
    zones: [
      { type: 'check', x: 0, y: 0, w: 2, h: 2 },
      { type: 'items', x: 2, y: 0, w: 2, h: 2 },
      { type: 'items', x: 4, y: 0, w: 2, h: 2 },
    ],
  }), ['too_many'])
  const kinds = (a, b) => codes({
    zones: [
      { type: 'check', x: 0, y: 0, w: 2, h: 2 },
      { type: 'modifiers', x: 2, y: 0, w: 2, h: 2, kind: a },
      { type: 'modifiers', x: 4, y: 0, w: 2, h: 2, kind: b },
    ],
  })
  assert.deepEqual(kinds('required', 'optional'), [])
  assert.deepEqual(kinds('all', 'optional'), ['choice_kinds'])
  assert.deepEqual(kinds('required', 'required'), ['choice_kinds'])
  const p = layoutProblems(normaliseTillLayout({ zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 4 }, { id: 'd', type: 'items', x: 2, y: 2, w: 4, h: 4 }] }))
  assert.deepEqual(p[0].zones, ['o', 'd'], 'a problem names its zones')
  assert.match(p[0].message, /Order and Dishes overlap/)
})

test('warnings', () => {
  const codes = l => layoutWarnings(normaliseTillLayout(l)).map(p => p.code).sort()
  assert.deepEqual(codes(templateLayout('standard')), ['choices_window'])
  assert.deepEqual(codes(templateLayout('quick')), [])
  assert.deepEqual(codes({
    zones: [
      { type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { type: 'categories', x: 4, y: 0, w: 8, h: 1 },
      { type: 'buttons', x: 4, y: 1, w: 8, h: 2 },
      { type: 'modifiers', x: 4, y: 3, w: 8, h: 5 },
    ],
  }), ['categories_alone', 'choices_space', 'empty_buttons', 'no_dishes'])
  assert.deepEqual(codes({ zones: [{ type: 'check', x: 0, y: 0, w: 4, h: 8 }, { type: 'items', x: 4, y: 0, w: 8, h: 8 }, { type: 'modifiers', x: 4, y: 0, w: 8, h: 8 }] }), ['items_alone'])
})

test('the top bar, the Order zone\'s own buttons, the Dish choices zones\' switches', () => {
  const l = normaliseTillLayout({
    top_bar: 'no',
    zones: [
      { id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 8, font: 99, hide: ['pay', 'nonsense', 'back', 'pay'], colours: { pay: '#ABCDEF', send: 'red', more: '#12345', bill: '#000000', back: '#ffffff', nonsense: '#111111' } },
      { id: 'r', type: 'modifiers', x: 4, y: 0, w: 8, h: 6, kind: 'required', show_name: false, show_description: 'x', show_prices: false, auto_add: true },
      { id: 'p', type: 'modifiers', x: 4, y: 6, w: 8, h: 2, kind: 'optional', auto_add: 'yes' },
      { id: 'b', type: 'buttons', x: 4, y: 6, w: 8, h: 2, buttons: [{ action: 'till_menu' }, { action: 'sign_out', label: 'Bye' }] },
    ],
  })
  assert.equal(l.top_bar, true, 'not a boolean: the default (the top bar)')
  assert.equal(normaliseTillLayout({ top_bar: false }).top_bar, false)
  const [o, r, p, b] = l.zones
  assert.equal(o.font, 36, 'the order\'s text size inside its limits')
  assert.deepEqual(o.hide, ['back', 'pay'], 'known buttons, once each, in the Order zone\'s order')
  assert.deepEqual(o.colours, { cancel: null, more: null, send: null, bill: '#000000', pay: '#abcdef' }, 'colour codes only, in lower case; Back has none')
  const plain = normaliseTillLayout({ zones: [{ type: 'check' }] }).zones[0]
  assert.deepEqual([plain.font, plain.hide, Object.values(plain.colours).every(v => v === null)], [16, [], true], 'an Order zone without settings: 16, every button, no colours')
  assert.deepEqual([r.show_name, r.show_description, r.show_prices, r.auto_add], [false, true, false, true])
  assert.deepEqual([p.show_name, p.show_description, p.show_prices, p.auto_add], [true, true, true, false], 'defaults: everything shown, Add needed')
  assert.deepEqual(b.buttons.map(x => [x.action, buttonLabel(x)]), [['till_menu', 'Till menu'], ['sign_out', 'Bye']])
  assert.equal(actionOf('till_menu').check, false, 'the till menu works with no order')
  assert.equal(actionOf('menus').check, false, 'Menus (which menus show) works with no order')
  assert.equal(buttonLabel({ action: 'menus' }), 'Menus')
  assert.equal(actionOf('sign_out').check, false)
  for (const cb of CHECK_BUTTONS) assert.ok(actionOf(cb.action), cb.key + ' has a button action that does its job')

  // Leaving an Order zone button out: a warning unless a Buttons zone does its job.
  const hidden = (hide, actions, top = true) => layoutWarnings(normaliseTillLayout({
    top_bar: top,
    zones: [
      { id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 8, hide },
      { type: 'items', x: 4, y: 0, w: 8, h: 6 },
      { type: 'categories', x: 4, y: 6, w: 2, h: 2 },
      { type: 'buttons', x: 6, y: 6, w: 6, h: 2, buttons: actions.map(action => ({ action, ...(action === 'tender' ? { tender: 'cash' } : {}) })) },
    ],
  })).filter(w => w.code === 'hidden_button')
  assert.deepEqual(hidden(['pay', 'more', 'cancel', 'bill'], ['exact_cash', 'more', 'cancel_order', 'bill']), [], 'every one done by a button')
  for (const a of ['pay', 'exact_card', 'tender']) assert.deepEqual(hidden(['pay'], [a]), [], a + ' stands in for Pay')
  const w = hidden(['send', 'pay', 'back'], ['no_sale'])
  assert.deepEqual(w.map(x => x.button), ['back', 'send', 'pay'])
  assert.deepEqual(w[0].zones, ['o'])
  assert.match(w.find(x => x.button === 'pay').message, /can't be paid/)
  assert.match(w[0].message, /top bar is the only way/)
  assert.match(hidden(['back'], [], false)[0].message, /till menu is the only way/, 'no top bar: the till menu in More')
  assert.match(hidden(['more'], [], false)[0].message, /and the till menu/)
  assert.doesNotMatch(hidden(['more'], [])[0].message, /till menu/, 'with the top bar, the till menu isn\'t in More')
})

test('which zone shows which choices', () => {
  const zones = (...kinds) => normaliseTillLayout({ zones: kinds.map((k, i) => ({ id: k + i, type: 'modifiers', x: i, y: 0, w: 1, h: 1, kind: k })) })
  assert.deepEqual(choiceZones(normaliseTillLayout({ zones: [] })), { required: null, optional: null })
  const one = choiceZones(zones('all'))
  assert.equal(one.required.id, 'all0')
  assert.equal(one.optional.id, 'all0')
  const split = choiceZones(zones('required', 'optional'))
  assert.equal(split.required.id, 'required0')
  assert.equal(split.optional.id, 'optional1')
  const onlyOptional = choiceZones(zones('optional'))
  assert.equal(onlyOptional.required.id, 'optional0', 'a missing zone gives its choices to the other')
  assert.equal(onlyOptional.optional.id, 'optional0')
})

test('packing: scroll down, across in one row, pages, More, hide', () => {
  const ones = n => Array.from({ length: n }, () => ({ w: 1, h: 1 }))
  // Scroll: carries on down; a 2x2 takes the first place it fits.
  const s = packCells([{ w: 1, h: 1 }, { w: 2, h: 2 }, { w: 1, h: 1 }, { w: 1, h: 1 }], { cols: 3, rows: 2, overflow: 'scroll' })
  assert.deepEqual(s.pages[0].map(p => [p.x, p.y, p.w, p.h]), [[0, 0, 1, 1], [1, 0, 2, 2], [0, 1, 1, 1], [0, 2, 1, 1]])
  assert.equal(s.rows, 3)
  // A one-row zone scrolls across, cells one row high.
  const across = packCells([{ w: 1, h: 1 }, { w: 2, h: 3 }, { w: 1, h: 1 }], { cols: 2, rows: 1, overflow: 'scroll' })
  assert.deepEqual(across.pages[0].map(p => [p.x, p.y, p.w, p.h]), [[0, 0, 1, 1], [1, 0, 2, 1], [3, 0, 1, 1]])
  assert.equal(across.cols, 4)
  // Pages: 3x2 = 6 a page.
  const pg = packCells(ones(14), { cols: 3, rows: 2, overflow: 'pages' })
  assert.deepEqual(pg.pages.map(p => p.length), [6, 6, 2])
  assert.deepEqual(pg.pages[1][0], { i: 6, x: 0, y: 0, w: 1, h: 1 })
  // A big cell that doesn't fit what's left starts the next page; order is kept.
  const big = packCells([...ones(5), { w: 2, h: 2 }, { w: 1, h: 1 }], { cols: 3, rows: 2, overflow: 'pages' })
  assert.deepEqual(big.pages.map(p => p.map(c => c.i)), [[0, 1, 2, 3, 4], [5, 6]])
  // A cell bigger than the grid is cut down to it.
  assert.deepEqual(packCells([{ w: 9, h: 9 }], { cols: 2, rows: 2, overflow: 'pages' }).pages[0][0], { i: 0, x: 0, y: 0, w: 2, h: 2 })
  // More: everything fits, no More.
  const fits = packCells(ones(6), { cols: 3, rows: 2, overflow: 'more' })
  assert.deepEqual([fits.pages[0].length, fits.rest.length], [6, 0])
  // More: one too many, the last cell is kept for More.
  const more = packCells(ones(7), { cols: 3, rows: 2, overflow: 'more' })
  assert.equal(more.pages[0].length, 5)
  assert.deepEqual(more.rest, [5, 6])
  assert.ok(!more.pages[0].some(p => p.x === 2 && p.y === 1), 'the last cell stays free for More')
  // Hide: what fits on the first page.
  const hide = packCells(ones(8), { cols: 3, rows: 2, overflow: 'hide' })
  assert.equal(hide.pages.length, 1)
  assert.equal(hide.pages[0].length, 6)
  assert.equal(hide.hidden, 2)
  for (const overflow of ['scroll', 'pages', 'more', 'hide']) {
    assert.deepEqual(packCells([], { cols: 3, rows: 2, overflow }).pages, [[]], overflow + ' with nothing')
  }
  // No two cells on a page share a place.
  const many = packCells(Array.from({ length: 40 }, (_, i) => ({ w: 1 + (i % 3), h: 1 + (i % 2) })), { cols: 4, rows: 3, overflow: 'pages' })
  for (const page of many.pages) {
    for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) assert.ok(!overlaps(page[i], page[j]), 'cells on a page don\'t overlap')
    for (const c of page) assert.ok(c.x + c.w <= 4 && c.y + c.h <= 3, 'inside the page')
  }
  assert.deepEqual(many.pages.flat().map(c => c.i), Array.from({ length: 40 }, (_, i) => i), 'every cell, in order')
})

test('button words and the company\'s own ids', () => {
  const opts = { items: { [A]: { name: 'Wings' } }, presets: [{ id: B, name: 'Staff 50%' }], tenders: [{ key: 'voucher', label: 'Voucher' }] }
  assert.equal(buttonLabel({ action: 'item', item_id: A }, opts), 'Wings')
  assert.equal(buttonLabel({ action: 'item', item_id: C }, opts), 'Dish no longer on the menu')
  assert.equal(buttonLabel({ action: 'discount_preset', preset_id: B }, opts), 'Staff 50%')
  assert.equal(buttonLabel({ action: 'tender', tender: 'voucher' }, opts), 'Pay by Voucher')
  assert.equal(buttonLabel({ action: 'exact_cash' }, opts), 'Exact cash')
  assert.equal(buttonLabel({ action: 'exact_cash', label: 'Cash' }, opts), 'Cash')
  // A charge from the list: its name, or that it has gone from the list.
  const withCharges = { ...opts, charges: [{ id: A, name: 'Cup deposit' }] }
  assert.equal(buttonLabel({ action: 'charge', charge_id: A }, withCharges), 'Cup deposit')
  assert.equal(buttonLabel({ action: 'charge', charge_id: C }, withCharges), 'Charge no longer on the list')

  const layout = normaliseTillLayout({
    zones: [
      { type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { type: 'categories', x: 4, y: 0, w: 8, h: 1, sections: [A, C] },
      { type: 'buttons', x: 4, y: 1, w: 8, h: 2, buttons: [
        { action: 'item', item_id: A }, { action: 'item', item_id: C }, { action: 'discount_preset', preset_id: B }, { action: 'discount_preset', preset_id: C },
        { action: 'charge', charge_id: B.toUpperCase() }, { action: 'charge', charge_id: C }, { action: 'charge' }, { action: 'charge', charge_id: 'nope' }, { action: 'send' },
      ] },
    ],
  })
  // A charge button needs the id of a charge (kept in lower case); one without goes.
  assert.deepEqual(layout.zones[2].buttons.filter(b => b.action === 'charge').map(b => b.charge_id), [B, C])
  assert.deepEqual(layoutIds(layout), { items: [A, C], sections: [A, C], presets: [B, C], menus: [], charges: [B, C] })
  const own = ownLayout(layout, { sectionIds: new Set([A]), itemIds: [A], presetIds: new Set([B]), chargeIds: new Set([B]) })
  assert.deepEqual(own.zones[1].sections, [A])
  assert.deepEqual(own.zones[2].buttons.map(b => b.item_id || b.preset_id || b.charge_id || b.action), [A, B, B, 'send'])
  // Without a list of the company's charges, no charge button is kept.
  assert.ok(!ownLayout(layout, { sectionIds: [A], itemIds: [A], presetIds: [B] }).zones[2].buttons.some(b => b.action === 'charge'))
})

test('where the words sit on a zone\'s buttons: defaults per zone, kept, refused, the styles', () => {
  const l = normaliseTillLayout({
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8, align: 'right', valign: 'bottom' },
      { id: 'k', type: 'categories', x: 4, y: 0, w: 8, h: 1 },
      { id: 'd', type: 'items', x: 4, y: 1, w: 8, h: 4 },
      { id: 'b', type: 'buttons', x: 4, y: 5, w: 8, h: 2 },
      { id: 'm', type: 'modifiers', x: 4, y: 1, w: 8, h: 4 },
      { id: 's', type: 'seats', x: 4, y: 7, w: 8, h: 1, align: 'left' },
    ],
  })
  const by = Object.fromEntries(l.zones.map(z => [z.id, z]))
  // Nothing set: each zone as it drew its words before they could be set.
  assert.deepEqual([by.k.align, by.k.valign], ['center', 'middle'])
  assert.deepEqual([by.d.align, by.d.valign], ['left', 'top'])
  assert.deepEqual([by.b.align, by.b.valign], ['center', 'middle'])
  assert.deepEqual([by.m.align, by.m.valign], ['left', 'top'])
  // Zones without a grid of buttons don't keep them.
  assert.equal('align' in by.c, false)
  assert.equal('valign' in by.c, false)
  assert.equal('align' in by.s, false)

  const set = normaliseTillLayout({
    zones: [
      { id: 'd', type: 'items', x: 0, y: 0, w: 4, h: 4, align: 'right', valign: 'bottom' },
      { id: 'k', type: 'categories', x: 4, y: 0, w: 4, h: 1, align: 'left', valign: 'top' },
      { id: 'b', type: 'buttons', x: 4, y: 1, w: 4, h: 2, align: 'justify', valign: 'baseline' },
      { id: 'm', type: 'modifiers', x: 0, y: 0, w: 4, h: 4, align: 'center', valign: 'middle' },
    ],
  })
  const s2 = Object.fromEntries(set.zones.map(z => [z.id, z]))
  assert.deepEqual([s2.d.align, s2.d.valign], ['right', 'bottom'])
  assert.deepEqual([s2.k.align, s2.k.valign], ['left', 'top'])
  assert.deepEqual([s2.b.align, s2.b.valign], ['center', 'middle'], 'not ours: the zone\'s default')
  assert.deepEqual([s2.m.align, s2.m.valign], ['center', 'middle'])
  // Normalising again changes nothing.
  assert.deepEqual(normaliseTillLayout(set), set)

  // The styles: across = alignItems + textAlign; up and down = justifyContent,
  // the top keeping a second line at the bottom (space-between).
  const across = { left: 'flex-start', center: 'center', right: 'flex-end' }
  const down = { top: 'space-between', middle: 'center', bottom: 'flex-end' }
  for (const align of ALIGN_KEYS) {
    for (const valign of VALIGN_KEYS) {
      assert.deepEqual(buttonTextStyle({ type: 'buttons', align, valign }),
        { alignItems: across[align], justifyContent: down[valign], textAlign: align }, align + ' ' + valign)
    }
  }
  // A zone not normalised yet (or a bad value): its type's default.
  assert.deepEqual(buttonTextStyle({ type: 'items' }), { alignItems: 'flex-start', justifyContent: 'space-between', textAlign: 'left' })
  assert.deepEqual(buttonTextStyle({ type: 'categories', align: 'sideways' }), { alignItems: 'center', justifyContent: 'center', textAlign: 'center' })
  assert.deepEqual(buttonTextStyle(null), { alignItems: 'center', justifyContent: 'center', textAlign: 'center' })
  // The templates carry them.
  for (const t of LAYOUT_TEMPLATES) {
    for (const z of templateLayout(t.key).zones.filter(z => ['categories', 'items', 'buttons', 'modifiers'].includes(z.type))) {
      assert.ok(ALIGN_KEYS.includes(z.align) && VALIGN_KEYS.includes(z.valign), t.key + ' ' + z.id)
    }
  }
})

test('Seat and course zone: both, seats only or courses only', () => {
  const l = normaliseTillLayout({
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { id: 'a', type: 'seats', x: 4, y: 7, w: 8, h: 1 },
    ],
  })
  assert.equal(l.zones[1].parts, 'both', 'nothing set: both')
  for (const parts of ['seats', 'courses', 'both']) {
    assert.equal(normaliseTillLayout({ zones: [{ id: 'a', type: 'seats', x: 0, y: 0, w: 4, h: 1, parts }] }).zones[0].parts, parts)
  }
  assert.equal(normaliseTillLayout({ zones: [{ id: 'a', type: 'seats', x: 0, y: 0, w: 4, h: 1, parts: 'tables' }] }).zones[0].parts, 'both')
  // Only the Seat and course zone has it.
  assert.equal('parts' in normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 4, h: 4, parts: 'seats' }] }).zones[0], false)
})

test('Dish choices zone: more picks, more dishes never goes with adding on the last tap', () => {
  const zone = raw => normaliseTillLayout({ zones: [{ id: 'm', type: 'modifiers', x: 0, y: 0, w: 4, h: 4, kind: 'required', ...raw }] }).zones[0]
  assert.deepEqual([zone({}).split_picks, zone({}).auto_add], [false, false])
  assert.deepEqual([zone({ split_picks: true }).split_picks, zone({ split_picks: true }).auto_add], [true, false])
  assert.deepEqual([zone({ auto_add: true }).split_picks, zone({ auto_add: true }).auto_add], [false, true])
  assert.deepEqual([zone({ auto_add: true, split_picks: true }).split_picks, zone({ auto_add: true, split_picks: true }).auto_add], [true, false], 'both asked: more dishes wins')
  assert.equal(zone({ split_picks: 'yes' }).split_picks, false, 'not a boolean: off')
  assert.equal('split_picks' in normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 4, h: 4, split_picks: true }] }).zones[0], false)
})

test('Menus zone: a grid zone of the till\'s menus, picked and sorted, with its own options', () => {
  const l = normaliseTillLayout({
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { id: 'm', type: 'menus', x: 4, y: 0, w: 8, h: 1 },
    ],
  })
  const z = l.zones[1]
  assert.ok(GRID_ZONES.includes('menus'))
  assert.deepEqual(
    { cols: z.cols, rows: z.rows, overflow: z.overflow, align: z.align, valign: z.valign, font: z.font, bold: z.bold },
    { cols: 4, rows: 1, overflow: 'scroll', align: 'center', valign: 'middle', font: 16, bold: true },
    'the standard grid controls with a strip of buttons to start')
  assert.deepEqual({ menu_ids: z.menu_ids, tap: z.tap, times_button: z.times_button, show_times: z.show_times },
    { menu_ids: null, tap: 'one', times_button: true, show_times: false }, 'all of the till\'s menus, one at a time, a Menu times button')
  assert.deepEqual(buttonTextStyle(z), { alignItems: 'center', justifyContent: 'center', textAlign: 'center' })

  const many = Array.from({ length: MAX_MENUS + 5 }, (_, i) => '44444444-4444-4444-8444-' + String(i).padStart(12, '0'))
  const k = normaliseTillLayout({
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { id: 'm', type: 'menus', x: 4, y: 0, w: 8, h: 2, cols: 2, rows: 2, overflow: 'pages', align: 'left', valign: 'top', font: 20, bold: false,
        menu_ids: [B.toUpperCase(), A, B, 'not-a-uuid'], tap: 'several', times_button: false, show_times: true },
      { id: 'n', type: 'menus', x: 4, y: 2, w: 8, h: 1, menu_ids: many, tap: 'all-of-them' },
    ],
  })
  const [, m, n] = k.zones
  assert.deepEqual(m.menu_ids, [B, A], 'lower case, once each, in the order given')
  assert.deepEqual([m.tap, m.times_button, m.show_times, m.cols, m.rows, m.overflow, m.align, m.valign, m.font, m.bold],
    ['several', false, true, 2, 2, 'pages', 'left', 'top', 20, false])
  assert.equal(n.menu_ids.length, MAX_MENUS)
  assert.equal(n.tap, 'one', 'an unknown tap is one')
  assert.ok(layoutProblems(k).some(p => p.code === 'too_many' && p.zones.includes('n')), 'one Menus zone only')
  assert.ok(layoutProblems(k).some(p => p.code === 'overlap') === false)

  // The company's own menus only, and the ids a layout names.
  assert.deepEqual(layoutIds(k).menus.slice(0, 2), [B, A])
  const own = ownLayout({ ...k, zones: k.zones.slice(0, 2) }, { sectionIds: [], itemIds: [], presetIds: [], menuIds: new Set([A]) })
  assert.deepEqual(own.zones[1].menu_ids, [A], 'another group\'s menu is dropped')
  const all = ownLayout(l, { sectionIds: [], itemIds: [], presetIds: [], menuIds: [] })
  assert.equal(all.zones[1].menu_ids, null, 'all of the till\'s menus stays all')

  // What a till offers: the picked ones it has, in the zone's order; else all of its menus.
  const menus = [{ id: A, name: 'Lunch' }, { id: B, name: 'Dinner' }, { id: C, name: 'Drinks' }]
  assert.deepEqual(menuZoneMenus({ menu_ids: null }, menus).map(x => x.name), ['Lunch', 'Dinner', 'Drinks'])
  assert.deepEqual(menuZoneMenus({ menu_ids: [C, A] }, menus).map(x => x.name), ['Drinks', 'Lunch'])
  assert.deepEqual(menuZoneMenus({ menu_ids: [C, 'gone'] }, menus).map(x => x.name), ['Drinks'])
  assert.deepEqual(menuZoneMenus({ menu_ids: ['gone'] }, menus).map(x => x.name), ['Lunch', 'Dinner', 'Drinks'], 'none of them on this till: all of its menus')
  assert.deepEqual(menuZoneMenus({ menu_ids: [A] }, []), [])
})

test('Pop-up zones: buttons that show when a button opens them, how they look and close', () => {
  const l = normaliseTillLayout({
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { id: 'd', type: 'items', x: 4, y: 0, w: 8, h: 6 },
      {
        id: 'b', type: 'buttons', x: 4, y: 6, w: 8, h: 2, buttons: [
          { id: 'open', action: 'open_popup', popup_id: 'drinks' },
          { id: 'shut', action: 'close_popup' },
          { id: 'ghost', action: 'open_popup', popup_id: 'gone' },
          { id: 'blank', action: 'open_popup' },
          { id: 'odd', action: 'open_popup', popup_id: 'not ok!' },
        ],
      },
      {
        id: 'drinks', type: 'popup', x: 5, y: 1, w: 6, h: 4, title: '  Drinks  ', buttons: [
          { id: 'cola', action: 'item', item_id: A },
          { id: 'self', action: 'open_popup', popup_id: 'drinks' },
          { id: 'more', action: 'open_popup', popup_id: 'hot', label: 'Hot drinks' },
          { id: 'close', action: 'close_popup' },
        ],
      },
      { id: 'hot', type: 'popup', x: 4, y: 0, w: 8, h: 8, title: 'x'.repeat(80), frame: false, controls: false, close_outside: false, close_on_tap: true, buttons: [{ id: 'tea', action: 'item', item_id: B }] },
    ],
  })
  const [, , b, drinks, hot] = l.zones
  assert.ok(GRID_ZONES.includes('popup') && FLOATING_ZONES.includes('popup') && FLOATING_ZONES.includes('modifiers'))
  assert.deepEqual(b.buttons.map(x => x.id), ['open'], 'outside a pop-up: no Close; buttons opening a pop-up the layout lacks go')
  assert.equal(b.buttons[0].popup_id, 'drinks')
  assert.deepEqual(drinks.buttons.map(x => x.id), ['cola', 'more', 'close'], 'a pop-up never opens itself; Close stays in a pop-up')
  assert.deepEqual(
    { title: drinks.title, frame: drinks.frame, controls: drinks.controls, close_outside: drinks.close_outside, close_on_tap: drinks.close_on_tap },
    { title: 'Drinks', frame: true, controls: true, close_outside: true, close_on_tap: false }, 'framed, with window controls, closed by a tap outside')
  assert.deepEqual(
    { cols: drinks.cols, rows: drinks.rows, overflow: drinks.overflow, align: drinks.align, valign: drinks.valign, font: drinks.font, bold: drinks.bold },
    { cols: 3, rows: 2, overflow: 'pages', align: 'center', valign: 'middle', font: 16, bold: true }, 'a grid of buttons like a Buttons zone')
  assert.equal(hot.title.length, LABEL_MAX)
  assert.deepEqual([hot.frame, hot.controls, hot.close_outside, hot.close_on_tap], [false, false, false, true])
  assert.equal(normaliseTillLayout({ zones: [{ type: 'popup', x: 0, y: 0, w: 2, h: 2, title: '   ' }] }).zones[0].title, 'Pop-up', 'a name, always')
  const a = actionOf('open_popup')
  assert.equal(a.check, false, 'opens with no order on screen too')
  assert.equal(a.group, 'Pop-ups')
  assert.equal(actionOf('close_popup').check, false)

  // Over other zones and each other, never an overlap; the layout saves.
  assert.deepEqual(layoutProblems(l), [])
  assert.ok(overlaps(drinks, hot) && overlaps(drinks, l.zones[1]))

  // Nothing to close it with: refused. Any one way out is enough.
  const stuck = { ...hot, close_on_tap: false }
  assert.match(popupCloseProblem(stuck), /Nothing closes a pop-up once it is open \(x+\)/)
  assert.equal(popupCloseProblem(hot), null, 'closes after a button is used')
  assert.match(popupCloseProblem({ ...hot, buttons: [] }), /Nothing closes/, 'after a button is used needs a button')
  assert.equal(popupCloseProblem({ ...stuck, controls: true }), null)
  assert.equal(popupCloseProblem({ ...stuck, close_outside: true }), null)
  assert.equal(popupCloseProblem({ ...stuck, buttons: [...stuck.buttons, { id: 'x', action: 'close_popup' }] }), null)
  assert.equal(popupCloseProblem(l.zones[2]), null, 'not a pop-up')
  const shut = { ...l, zones: l.zones.map(z => (z.id === 'hot' ? stuck : z)) }
  const prob = layoutProblems(shut)
  assert.deepEqual(prob.map(p => p.code), ['popup_stuck'])
  assert.deepEqual(prob[0].zones, ['hot'])

  // Warnings: no buttons, nothing opens it; a Pay in a pop-up does the
  // Order zone's job; a Dish choices zone over a pop-up only waits empty.
  const w = normaliseTillLayout({
    zones: [
      { id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8, hide: ['pay'] },
      { id: 'p1', type: 'popup', x: 4, y: 0, w: 8, h: 4, buttons: [{ id: 'cash', action: 'exact_cash' }, { id: 'tea', action: 'item', item_id: B }] },
      { id: 'p2', type: 'popup', x: 4, y: 4, w: 8, h: 4, title: 'Spare' },
      { id: 'm', type: 'modifiers', x: 4, y: 4, w: 8, h: 4 },
    ],
  })
  const codes = layoutWarnings(w).map(x => x.code)
  assert.ok(codes.includes('empty_popup') && layoutWarnings(w).find(x => x.code === 'empty_popup').zones[0] === 'p2')
  assert.deepEqual(layoutWarnings(w).filter(x => x.code === 'popup_unopened').map(x => x.zones[0]), ['p1', 'p2'])
  assert.match(layoutWarnings(w).find(x => x.code === 'popup_unopened' && x.zones[0] === 'p2').message, /\(Spare\)/)
  assert.ok(!codes.includes('hidden_button'), 'Exact cash in a pop-up pays')
  assert.ok(!codes.includes('no_dishes'), 'a dish button in a pop-up is a dish button')
  assert.ok(codes.includes('choices_space'), 'a pop-up isn\'t always there')
  // Opened from another pop-up counts.
  const chain = normaliseTillLayout({ zones: [...w.zones, { id: 'b', type: 'buttons', x: 0, y: 7, w: 1, h: 1, buttons: [{ id: 'o', action: 'open_popup', popup_id: 'p1' }] }] })
  chain.zones[1].buttons.push({ id: 'o2', action: 'open_popup', popup_id: 'p2', w: 1, h: 1 })
  assert.deepEqual(layoutWarnings(chain).filter(x => x.code === 'popup_unopened'), [])

  // Words: the pop-up's name, Close; its own label wins.
  const popups = l.zones.filter(z => z.type === 'popup')
  assert.equal(buttonLabel(b.buttons[0], { popups }), 'Drinks')
  assert.equal(buttonLabel({ action: 'open_popup', popup_id: 'gone' }, { popups }), 'Pop-up no longer in the layout')
  assert.equal(buttonLabel(drinks.buttons[1], { popups }), 'Hot drinks')
  assert.equal(buttonLabel(drinks.buttons[2]), 'Close')

  // The company's own: a pop-up's dishes are named and checked like a Buttons zone's.
  assert.deepEqual(layoutIds(l).items.sort(), [A, B].sort())
  const own = ownLayout(l, { sectionIds: [], itemIds: [A], presetIds: [], menuIds: [], chargeIds: [] })
  assert.deepEqual(own.zones[3].buttons.map(x => x.id), ['cola', 'more', 'close'])
  assert.deepEqual(own.zones[4].buttons, [], 'another group\'s dish goes')

  // Eight pop-ups at most, and room for every zone at once.
  const eight = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, type: 'popup', x: 4, y: 0, w: 4, h: 4 }))
  const many = normaliseTillLayout({ zones: [{ id: 'c', type: 'check', x: 0, y: 0, w: 4, h: 8 }, ...eight] })
  assert.equal(many.zones.length, 10)
  assert.ok(layoutProblems(many).some(p => p.code === 'too_many' && p.zones.length === 1 && p.zones[0] === 'p8'))
  const every = ZONE_TYPES.reduce((n, t) => n + t.max, 0)
  assert.ok(every <= MAX_ZONES, 'every zone type at its most fits (' + every + ' of ' + MAX_ZONES + ')')
})
