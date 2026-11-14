// Till layouts (shared/pos/tillLayout.js): the stored shape, what stops a
// save, which zone shows a dish's choices, and how buttons fill a zone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseTillLayout, layoutProblems, layoutWarnings, choiceZones, packCells, buttonLabel,
  ownLayout, layoutIds, templateLayout, LAYOUT_TEMPLATES, overlaps, actionOf, CHECK_BUTTONS,
  buttonTextStyle, ALIGN_KEYS, VALIGN_KEYS, menuZoneMenus, MAX_MENUS, GRID_ZONES,
  floats, isPopup, popupCloseProblem, LABEL_MAX, ZONE_TYPES, MAX_ZONES, shownDishIds, MAX_HIDDEN,
  POPUP_ZONES, popupTitle, popupOpeners, isList, gridDefaults, TEMPLATE_KEYS, ZONE_GRID, leftOutButtons, reachablePopups, unopenedWhy,
  categoriesZoneOf, dishesZonesOf,
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
  assert.deepEqual(empty, { cols: 12, rows: 8, top_bar: true, phone: false, zones: [] })
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
      { type: 'seats', x: 2, y: 0, w: 2, h: 2 },
      { type: 'seats', x: 4, y: 0, w: 2, h: 2 },
    ],
  }), ['too_many'])
  // Up to four Dishes and four Categories zones; a fifth is too many.
  const many = (type, n) => codes({
    cols: 12, rows: 8,
    zones: [{ type: 'check', x: 0, y: 0, w: 2, h: 8 }, ...Array.from({ length: n }).map((_, i) => ({ type, x: 2 + i * 2, y: 0, w: 2, h: 2 }))],
  })
  assert.deepEqual(many('items', 4), [])
  assert.deepEqual(many('items', 5), ['too_many'])
  assert.deepEqual(many('categories', 4), [])
  assert.deepEqual(many('categories', 5), ['too_many'])
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

test('packing: a Dish choices zone keeps a group\'s choices under its heading', () => {
  // Fries: Size (Regular, Large), then Fries Flavour (Wingstop Style, Lemon
  // Pepper, Cajun), each group a heading the width of the zone, 4 across.
  const head = { w: 4, h: 1 }
  const one = { w: 1, h: 1 }
  const fries = [head, one, one, head, one, one, one]
  const at = r => r.pages.map(pg => pg.map(p => [p.i, p.x, p.y]))
  const want = [[0, 0, 0], [1, 0, 1], [2, 1, 1], [3, 0, 2], [4, 0, 3], [5, 1, 3], [6, 2, 3]]
  for (const overflow of ['scroll', 'pages', 'more', 'hide']) {
    assert.deepEqual(at(packCells(fries, { type: 'modifiers', cols: 4, rows: 4, overflow })), [want], overflow + ': in order, each heading on a row of its own')
  }
  // Other zones take the first free place: the flavours fill the end of the
  // Size row (what a Dish choices zone did before, the bug).
  assert.deepEqual(at(packCells(fries, { type: 'buttons', cols: 4, rows: 4, overflow: 'pages' })),
    [[[0, 0, 0], [1, 0, 1], [2, 1, 1], [3, 0, 2], [4, 2, 1], [5, 3, 1], [6, 0, 3]]])
  // Scrolling down, the rows it takes.
  assert.equal(packCells(fries, { type: 'modifiers', cols: 4, rows: 2, overflow: 'scroll' }).rows, 4)
  // Pages: what doesn't fit after the cell before it starts the next page, in order.
  assert.deepEqual(at(packCells(fries, { type: 'modifiers', cols: 4, rows: 3, overflow: 'pages' })),
    [[[0, 0, 0], [1, 0, 1], [2, 1, 1], [3, 0, 2]], [[4, 0, 0], [5, 1, 0], [6, 2, 0]]])
  // More: the last cell is kept for More, so the second heading (a whole
  // row) doesn't fit; it and everything after it go behind More, in order.
  const more = packCells(fries, { type: 'modifiers', cols: 4, rows: 3, overflow: 'more' })
  assert.deepEqual(more.pages[0].map(p => p.i), [0, 1, 2])
  assert.deepEqual(more.rest, [3, 4, 5, 6])
  // A wider button (a group asked on request) after a group's choices goes
  // on the same row when it fits there, else on the next; never back up.
  const wide = { w: 2, h: 1 }
  assert.deepEqual(at(packCells([head, one, one, one, wide, one], { type: 'modifiers', cols: 4, rows: 4, overflow: 'pages' })),
    [[[0, 0, 0], [1, 0, 1], [2, 1, 1], [3, 2, 1], [4, 0, 2], [5, 2, 2]]])
  // Taller cells still never overlap.
  const mixed = packCells(Array.from({ length: 30 }, (_, i) => ({ w: 1 + (i % 3), h: 1 + (i % 2) })), { type: 'modifiers', cols: 4, rows: 3, overflow: 'pages' })
  for (const page of mixed.pages) {
    for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) assert.ok(!overlaps(page[i], page[j]), 'cells on a page don\'t overlap')
    // Reading order: each cell starts at or after the one before it.
    for (let i = 1; i < page.length; i++) {
      const a = page[i - 1], b = page[i]
      assert.ok(b.y > a.y || (b.y === a.y && b.x >= a.x + a.w), 'in reading order')
    }
  }
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
  assert.ok(GRID_ZONES.includes('popup') && floats(drinks) && isPopup(drinks) && floats({ type: 'modifiers' }) && !isPopup({ type: 'modifiers' }))
  assert.ok(!floats(b) && !floats(l.zones[0]) && !floats(null), 'a zone always on screen never floats')
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

test('A category\'s dishes zone and dishes left out of a zone', () => {
  const D = '44444444-4444-4444-8444-444444444444'
  const l = normaliseTillLayout({
    cols: 12, rows: 8,
    zones: [
      { id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { id: 'd', type: 'items', x: 4, y: 2, w: 8, h: 4, hide_item_ids: [B, 'nope', B.toUpperCase()] },
      { id: 'k1', type: 'category', x: 4, y: 0, w: 8, h: 2, section_id: A.toUpperCase(), hide_item_ids: [C], price: false },
      { id: 'k2', type: 'category', x: 4, y: 6, w: 8, h: 2, section_id: 'not-a-uuid' },
    ],
  })
  const [, d, k1, k2] = l.zones
  assert.deepEqual(d.hide_item_ids, [B], 'ids tidied, repeats once')
  assert.equal(d.search, true)
  assert.equal(k1.section_id, A)
  assert.deepEqual(k1.hide_item_ids, [C])
  assert.equal(k1.price, false)
  assert.deepEqual([k1.cols, k1.rows, k1.overflow, k1.align, k1.valign], [4, 2, 'scroll', 'left', 'top'], 'a grid zone with its defaults')
  assert.ok(GRID_ZONES.includes('category'))
  assert.equal(k2.section_id, null)
  assert.deepEqual(k2.hide_item_ids, [])
  assert.equal(k2.price, true)
  // An older Dishes zone gets an empty list.
  assert.deepEqual(normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 2, h: 2 }] }).zones[0].hide_item_ids, [])
  // Up to MAX_HIDDEN, and the zone type allows 8 on a layout.
  const many = Array.from({ length: MAX_HIDDEN + 5 }, (_, i) => '55555555-5555-4555-8555-' + String(i).padStart(12, '0'))
  assert.equal(normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 2, h: 2, hide_item_ids: many }] }).zones[0].hide_item_ids.length, MAX_HIDDEN)
  assert.equal(ZONE_TYPES.find(t => t.key === 'category').max, 8)

  // What shows: the list less the ones left out, in its order.
  assert.deepEqual(shownDishIds(k1, [A, C, D]), [A, D])
  assert.deepEqual(shownDishIds(null, [A, C]), [A, C])
  assert.deepEqual(shownDishIds(k1, null), [])

  // Warnings: a zone with no category picked; dishes are on screen through it.
  const codes = layoutWarnings(l).map(w => w.code)
  assert.ok(codes.includes('category_unset'))
  assert.deepEqual(layoutWarnings(l).find(w => w.code === 'category_unset').zones, ['k2'])
  const onlyCategory = normaliseTillLayout({ zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 8 }, { id: 'k', type: 'category', x: 4, y: 0, w: 4, h: 4, section_id: A }] })
  assert.ok(!layoutWarnings(onlyCategory).some(w => w.code === 'no_dishes'), 'a category zone is a way to dishes')
  assert.deepEqual(layoutProblems(l), [])

  // The ids it names, and only the company's kept.
  const ids = layoutIds(l)
  assert.ok(ids.sections.includes(A) && ids.items.includes(B) && ids.items.includes(C))
  const own = ownLayout(l, { sectionIds: new Set([]), itemIds: new Set([C]), presetIds: [], menuIds: [], chargeIds: [] })
  assert.deepEqual(own.zones[1].hide_item_ids, [], 'another company\'s dish dropped')
  assert.equal(own.zones[2].section_id, null, 'another company\'s section dropped')
  assert.deepEqual(own.zones[2].hide_item_ids, [C])
  const mine = ownLayout(l, { sectionIds: new Set([A]), itemIds: new Set([B, C]), presetIds: [], menuIds: [], chargeIds: [] })
  assert.equal(mine.zones[2].section_id, A)
  assert.deepEqual(mine.zones[1].hide_item_ids, [B])
})

test('Zones shown as pop-ups: any of them but Buttons and Dish choices, over their cells or the whole screen', () => {
  const l = normaliseTillLayout({
    cols: 6, rows: 12,
    zones: [
      { id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 10, show: 'popup', cover: 'screen', title: '  The bill  ', close_on_tap: true },
      { id: 'k', type: 'categories', x: 0, y: 0, w: 6, h: 10, show: 'popup' },
      { id: 'd', type: 'items', x: 0, y: 0, w: 6, h: 10, show: 'popup', frame: false, close_outside: false, title: 'x'.repeat(80) },
      { id: 'm', type: 'menus', x: 0, y: 0, w: 6, h: 3, show: 'popup' },
      { id: 'c1', type: 'category', x: 0, y: 3, w: 6, h: 3, show: 'popup', section_id: A, cover: 'moon' },
      { id: 's', type: 'seats', x: 0, y: 6, w: 6, h: 4, show: 'popup', controls: false, close_outside: false },
      { id: 'c2', type: 'category', x: 0, y: 0, w: 3, h: 3, show: 'sometimes' },
      {
        id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, show: 'popup', cover: 'screen', buttons: [
          { id: 'order', action: 'open_popup', popup_id: 'o' },
          { id: 'cats', action: 'open_popup', popup_id: 'k' },
          { id: 'seat', action: 'open_popup', popup_id: 's', label: 'Seat' },
          { id: 'never', action: 'open_popup', popup_id: 'c2' },
          { id: 'self', action: 'open_popup', popup_id: 'b' },
        ],
      },
      { id: 'ch', type: 'modifiers', x: 0, y: 0, w: 6, h: 10, show: 'popup' },
    ],
  })
  const z = id => l.zones.find(x => x.id === id)
  assert.deepEqual(POPUP_ZONES, ['check', 'categories', 'menus', 'items', 'category', 'seats'])
  // Which zones are pop-ups, and which float (may sit over others).
  assert.deepEqual(l.zones.filter(isPopup).map(x => x.id), ['o', 'k', 'd', 'm', 'c1', 's'])
  assert.deepEqual(l.zones.filter(floats).map(x => x.id), ['o', 'k', 'd', 'm', 'c1', 's', 'ch'])
  assert.equal(z('c2').show, 'always', 'an unknown value: always on screen')
  assert.ok(!('cover' in z('c2')) && !('title' in z('c2')), 'no pop-up fields on a zone always on screen')
  assert.ok(!('show' in z('b')) && !('show' in z('ch')), 'Buttons have the Pop-up zone for that; Dish choices float by themselves')
  assert.equal(z('ch').cover, 'zone', 'a Dish choices zone keeps its own cover')
  // The fields a pop-up has, with their defaults.
  assert.deepEqual(
    { title: z('o').title, cover: z('o').cover, frame: z('o').frame, controls: z('o').controls, close_outside: z('o').close_outside, close_on_tap: z('o').close_on_tap },
    { title: 'The bill', cover: 'screen', frame: true, controls: true, close_outside: true, close_on_tap: false }, 'the Order zone never closes after it is used')
  assert.equal(z('k').close_on_tap, true, 'a category is one pick: the list closes after it')
  assert.equal(z('m').close_on_tap, true, 'so is a menu')
  assert.equal(z('d').close_on_tap, false, 'dishes are tapped several times')
  assert.equal(z('s').close_on_tap, false)
  assert.equal(z('d').title.length, LABEL_MAX)
  assert.equal(z('k').title, null, 'no name of its own')
  assert.equal(z('c1').cover, 'zone', 'an unknown cover: its own cells')
  assert.deepEqual([z('d').frame, z('d').close_outside, z('s').controls, z('s').close_outside], [false, false, false, false])
  // A pop-up's name: its own, else what it shows.
  assert.deepEqual(['o', 'k', 'd', 'm', 'c1', 's'].map(id => popupTitle(z(id))), ['The bill', 'Categories', 'x'.repeat(LABEL_MAX), 'Menus', 'Dishes', 'Seat and course'])
  assert.equal(popupTitle({ type: 'popup', title: 'Drinks' }), 'Drinks')
  assert.equal(popupTitle(null), 'Pop-up')

  // Openers: buttons naming any pop-up zone stay; one naming a zone that is
  // always on screen, or its own zone, goes.
  assert.deepEqual(z('b').buttons.map(x => x.id), ['order', 'cats', 'seat'])
  assert.deepEqual(popupOpeners(l, 'o').map(x => [x.zone.id, x.button.id]), [['b', 'order']])
  assert.deepEqual(popupOpeners(l, 'm'), [])
  assert.deepEqual(popupOpeners(null, 'o'), [])
  const words = b => buttonLabel(b, { popups: l.zones.filter(isPopup) })
  assert.deepEqual(z('b').buttons.map(words), ['The bill', 'Categories', 'Seat'], 'an opener says its pop-up\'s name unless it has its own words')
  // A pop-up's own opener inside it doesn't count (it never opens itself).
  const inside = normaliseTillLayout({ zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 2, h: 2 }, { id: 'p', type: 'popup', x: 0, y: 0, w: 2, h: 2, buttons: [{ id: 'me', action: 'open_popup', popup_id: 'p' }] }] })
  assert.deepEqual(popupOpeners(inside, 'p'), [])

  // Pop-ups sit over each other and over other zones: no overlap problem.
  // Nothing opens the dishes, Menus or the category: a warning each, by name.
  assert.deepEqual(layoutProblems(l).map(p => p.code), ['popup_stuck'], 'the seats pop-up has no way out')
  assert.deepEqual(layoutProblems(l)[0].zones, ['s'])
  const w = layoutWarnings(l).filter(x => x.code === 'popup_unopened')
  assert.deepEqual(w.map(x => x.zones[0]), ['d', 'm', 'c1'])
  assert.match(w[1].message, /\(Menus\)/)
  // Two zones always on screen still may not overlap.
  const both = normaliseTillLayout({ zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 4 }, { id: 'd', type: 'items', x: 2, y: 2, w: 4, h: 4 }, { id: 'k', type: 'categories', x: 0, y: 0, w: 4, h: 4, show: 'popup' }] })
  assert.deepEqual(layoutProblems(both).map(p => p.code), ['overlap'])
  assert.deepEqual(layoutProblems(both)[0].zones, ['o', 'd'])
})

test('What closes a pop-up: its X, a tap outside unless it takes the whole screen, after it is used (never the Order zone)', () => {
  const pop = (type, extra = {}) => normaliseTillLayout({
    zones: [{ id: 'p', type, x: 0, y: 0, w: 4, h: 4, show: 'popup', controls: false, close_outside: false, close_on_tap: false, ...extra }],
  }).zones[0]
  assert.match(popupCloseProblem(pop('items')), /Nothing closes a pop-up once it is open \(Dishes\)/)
  assert.equal(popupCloseProblem(pop('items', { controls: true })), null)
  assert.equal(popupCloseProblem(pop('items', { close_outside: true })), null)
  assert.equal(popupCloseProblem(pop('items', { close_on_tap: true })), null, 'after a dish is tapped')
  assert.equal(popupCloseProblem(pop('categories', { close_on_tap: true })), null)
  assert.equal(popupCloseProblem(pop('seats', { close_on_tap: true })), null)
  // The whole screen: nothing is outside it.
  assert.match(popupCloseProblem(pop('items', { cover: 'screen', close_outside: true })), /Nothing closes/)
  assert.doesNotMatch(popupCloseProblem(pop('items', { cover: 'screen', close_outside: true })), /tap outside/)
  assert.equal(popupCloseProblem(pop('items', { cover: 'screen', controls: true })), null)
  assert.equal(popupCloseProblem(pop('menus', { cover: 'screen', close_on_tap: true })), null)
  // The Order zone: its X, or a tap outside; never "after it is used".
  assert.match(popupCloseProblem(pop('check', { close_on_tap: true })), /Nothing closes a pop-up once it is open \(Order\): keep its window controls, let a tap outside close it\.$/)
  assert.equal(popupCloseProblem(pop('check', { close_outside: true })), null)
  assert.match(popupCloseProblem(pop('check', { cover: 'screen', close_outside: true })), /\(Order\): keep its window controls\.$/)
  assert.equal(popupCloseProblem(pop('check', { cover: 'screen', controls: true })), null)
  // A Pop-up zone over the whole screen: its X, its buttons, or a Close button.
  const zone = extra => normaliseTillLayout({ zones: [{ id: 'p', type: 'popup', x: 0, y: 0, w: 4, h: 4, cover: 'screen', controls: false, ...extra }] }).zones[0]
  assert.equal(zone({}).cover, 'screen')
  assert.equal(normaliseTillLayout({ zones: [{ id: 'p', type: 'popup', x: 0, y: 0, w: 4, h: 4 }] }).zones[0].cover, 'zone', 'older pop-ups keep their own cells')
  assert.match(popupCloseProblem(zone({ close_outside: true })), /Nothing closes/)
  assert.equal(popupCloseProblem(zone({ buttons: [{ id: 'x', action: 'close_popup' }] })), null)
  assert.equal(popupCloseProblem(zone({ close_on_tap: true, buttons: [{ id: 'x', action: 'no_sale' }] })), null)
  // Zones always on screen never have the problem.
  assert.equal(popupCloseProblem(normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 2, h: 2, controls: false, close_outside: false }] }).zones[0]), null)
})

test('The Order zone as a pop-up needs a button that opens it', () => {
  const zones = extra => [
    { id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 10, show: 'popup', cover: 'screen' },
    { id: 'd', type: 'items', x: 0, y: 0, w: 6, h: 10 },
    ...extra,
  ]
  const codes = extra => layoutProblems(normaliseTillLayout({ cols: 6, rows: 12, zones: zones(extra) })).map(p => p.code)
  assert.deepEqual(codes([]), ['order_unopened'])
  const p = layoutProblems(normaliseTillLayout({ cols: 6, rows: 12, zones: zones([]) }))[0]
  assert.deepEqual(p.zones, ['o'])
  assert.match(p.message, /Order zone is a pop-up and nothing opens it/)
  // A Buttons zone with other buttons doesn't open it.
  assert.deepEqual(codes([{ id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons: [{ id: 'pay', action: 'pay' }] }]), ['order_unopened'])
  assert.deepEqual(codes([{ id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons: [{ id: 'open', action: 'open_popup', popup_id: 'o' }] }]), [])
  // From a pop-up counts, as for any pop-up, when that pop-up can be opened itself.
  assert.deepEqual(codes([
    { id: 'p', type: 'popup', x: 0, y: 8, w: 6, h: 2, buttons: [{ id: 'open', action: 'open_popup', popup_id: 'o' }] },
    { id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons: [{ id: 'tools', action: 'open_popup', popup_id: 'p' }] },
  ]), [])
  // The warning is for the other pop-ups: the Order zone has the problem instead.
  const l = normaliseTillLayout({ cols: 6, rows: 12, zones: zones([]) })
  assert.ok(!layoutWarnings(l).some(w => w.code === 'popup_unopened'))
  // No Order zone at all is still its own problem; always on screen needs nothing.
  assert.deepEqual(layoutProblems(normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 2, h: 2 }] })).map(x => x.code), ['no_check'])
  assert.deepEqual(layoutProblems(normaliseTillLayout({ zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 2, h: 2 }] })), [])
  // Taking the Order pop-up's opener out with its Buttons zone brings the problem back.
  const ok = normaliseTillLayout({ cols: 6, rows: 12, zones: zones([{ id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons: [{ id: 'open', action: 'open_popup', popup_id: 'o' }] }]) })
  const without = normaliseTillLayout({ ...ok, zones: ok.zones.filter(z => z.id !== 'b') })
  assert.deepEqual(layoutProblems(without).map(x => x.code), ['order_unopened'])
  // The Order zone back on screen always: its opener goes with the pop-up.
  const back = normaliseTillLayout({ ...ok, zones: ok.zones.map(z => (z.id === 'o' ? { ...z, show: 'always', x: 0, y: 0, w: 6, h: 2 } : z.id === 'd' ? { ...z, y: 2, h: 8 } : z)) })
  assert.deepEqual(back.zones.find(z => z.id === 'b').buttons, [])
  assert.deepEqual(layoutProblems(back), [])
})

test('A button its zone leaves out opens nothing: the pop-up counts as unopened', () => {
  // Hide the rest (overflow hide): the buttons from the first that doesn't fit on never show.
  const bar = (buttons, extra = {}) => ({ id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, cols: 2, rows: 1, overflow: 'hide', buttons, ...extra })
  const zoneOf = (buttons, extra) => normaliseTillLayout({ cols: 6, rows: 12, zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 10 }, bar(buttons, extra)] }).zones.find(z => z.id === 'b')
  const three = [{ id: 'pay', action: 'pay' }, { id: 'send', action: 'send' }, { id: 'more', action: 'more' }]
  assert.deepEqual(leftOutButtons(zoneOf(three)).map(x => x.id), ['more'])
  assert.deepEqual(leftOutButtons(zoneOf(three.slice(0, 2))), [])
  // Everything after the first that doesn't fit goes too, even one that would fit.
  assert.deepEqual(leftOutButtons(zoneOf([{ id: 'pay', action: 'pay' }, { id: 'wide', action: 'send', w: 2 }, { id: 'more', action: 'more' }])).map(x => x.id), ['wide', 'more'])
  // Scroll, pages and More keep every button in reach.
  for (const overflow of ['scroll', 'pages', 'more']) assert.deepEqual(leftOutButtons(zoneOf(three, { overflow })), [], overflow)
  assert.deepEqual(leftOutButtons(null), [])
  assert.deepEqual(leftOutButtons({ type: 'items', overflow: 'hide' }), [])

  // The Order as a pop-up: its only opener left out is the same problem as none.
  const order = { id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 10, show: 'popup', cover: 'screen' }
  const dishes = { id: 'd', type: 'items', x: 0, y: 0, w: 6, h: 10 }
  const open = { id: 'open', action: 'open_popup', popup_id: 'o' }
  const lay = (buttons, extra) => normaliseTillLayout({ cols: 6, rows: 12, zones: [order, dishes, bar(buttons, extra)] })
  const shown = lay([open, { id: 'pay', action: 'pay' }, { id: 'more', action: 'more' }])
  assert.deepEqual(popupOpeners(shown, 'o').map(x => [x.button.id, x.left_out]), [['open', false]])
  assert.deepEqual(layoutProblems(shown), [])
  const out = lay([{ id: 'pay', action: 'pay' }, { id: 'more', action: 'more' }, open])
  assert.deepEqual(popupOpeners(out, 'o').map(x => [x.button.id, x.left_out]), [['open', true]])
  const [p, ...rest] = layoutProblems(out)
  assert.equal(p.code, 'order_unopened')
  assert.deepEqual(rest, [])
  assert.match(p.message, /doesn't fit in its zone and is left out, so nothing opens the order/)
  // The zone to fix comes first (the designer opens it when the problem is tapped).
  assert.deepEqual(p.zones, ['b', 'o'])
  // The same buttons where the rest is kept in reach: no problem.
  for (const overflow of ['scroll', 'pages', 'more']) assert.deepEqual(layoutProblems(lay([{ id: 'pay', action: 'pay' }, { id: 'more', action: 'more' }, open], { overflow })), [], overflow)
  // One opener that shows is enough.
  const two = normaliseTillLayout({ cols: 6, rows: 12, zones: [order, dishes, bar([{ id: 'pay', action: 'pay' }, { id: 'more', action: 'more' }, open]),
    { id: 'b2', type: 'buttons', x: 0, y: 9, w: 6, h: 1, buttons: [{ id: 'open2', action: 'open_popup', popup_id: 'o' }] }] })
  assert.deepEqual(popupOpeners(two, 'o').map(x => [x.zone.id, x.left_out]), [['b', true], ['b2', false]])
  assert.deepEqual(layoutProblems(two).filter(x => x.code === 'order_unopened'), [])

  // Any other pop-up: the note, worded for a button that doesn't fit.
  const cats = { id: 'c', type: 'categories', x: 0, y: 0, w: 6, h: 5, show: 'popup' }
  const openCats = { id: 'cats', action: 'open_popup', popup_id: 'c' }
  const l = normaliseTillLayout({ cols: 6, rows: 12, zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 3 }, { ...dishes, y: 3, h: 7 }, cats, bar([{ id: 'pay', action: 'pay' }, { id: 'more', action: 'more' }, openCats])] })
  const w = layoutWarnings(l).filter(x => x.code === 'popup_unopened')
  assert.equal(w.length, 1)
  assert.match(w[0].message, /The button that opens a pop-up \(Categories\) doesn't fit in its zone and is left out/)
  assert.deepEqual(w[0].zones, ['b', 'c'])
  assert.deepEqual(layoutProblems(l), [])
  const fits = normaliseTillLayout({ ...l, zones: l.zones.map(z => (z.id === 'b' ? { ...z, cols: 3 } : z)) })
  assert.deepEqual(layoutWarnings(fits).filter(x => x.code === 'popup_unopened'), [])
  // A Pop-up zone leaves buttons out the same way.
  const inPop = normaliseTillLayout({ cols: 6, rows: 12, zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 3 }, { ...dishes, y: 3, h: 7 }, cats,
    { id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons: [{ id: 'tools', action: 'open_popup', popup_id: 'p' }] },
    { id: 'p', type: 'popup', title: 'Tools', x: 0, y: 5, w: 6, h: 2, cols: 1, rows: 1, overflow: 'hide', buttons: [{ id: 'pay', action: 'pay' }, openCats] }] })
  assert.deepEqual(popupOpeners(inPop, 'c').map(x => [x.zone.id, x.left_out]), [['p', true]])
  assert.match(layoutWarnings(inPop).find(x => x.code === 'popup_unopened').message, /\(Categories\) doesn't fit/)
  // The phone starting points all fit.
  for (const key of ['phone', 'phone_table', 'phone_categories']) {
    const t = templateLayout(key)
    assert.deepEqual(t.zones.flatMap(z => leftOutButtons(z)), [], key)
    assert.ok(t.zones.filter(isPopup).every(z => popupOpeners(t, z.id).some(o => o.works)), key)
    assert.deepEqual([...reachablePopups(t)].sort(), t.zones.filter(isPopup).map(z => z.id).sort(), key)
  }
})

test('A button in a pop-up nothing opens opens nothing either: pop-ups are judged by whether a person can get to them', () => {
  const order = { id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 10, show: 'popup', cover: 'screen' }
  const dishes = { id: 'd', type: 'items', x: 0, y: 0, w: 6, h: 10 }
  const tools = buttons => ({ id: 'p', type: 'popup', title: 'Tools', x: 0, y: 6, w: 6, h: 4, buttons })
  const bar = (buttons, extra = {}) => ({ id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons, ...extra })
  const openOrder = { id: 'open', action: 'open_popup', popup_id: 'o' }
  const openTools = { id: 'tools', action: 'open_popup', popup_id: 'p' }
  const pay = { id: 'pay', action: 'pay' }
  const lay = zones => normaliseTillLayout({ cols: 6, rows: 12, zones: [order, dishes, ...zones] })

  // No button at all.
  assert.deepEqual(unopenedWhy(lay([bar([pay])]), 'o'), { why: 'none', zone: null })
  // The order's only button sits in a pop-up nothing opens: the order can't be reached.
  const shut = lay([tools([openOrder]), bar([pay])])
  assert.deepEqual([...reachablePopups(shut)], [])
  assert.deepEqual(popupOpeners(shut, 'o').map(x => [x.zone.id, x.left_out, x.shut, x.works]), [['p', false, true, false]])
  assert.equal(unopenedWhy(shut, 'o').why, 'shut')
  const [p, ...rest] = layoutProblems(shut)
  assert.deepEqual([p.code, p.zones], ['order_unopened', ['p', 'o']])
  assert.match(p.message, /The button that opens the order is in a pop-up nothing opens \(Tools\), so nothing opens the order/)
  assert.deepEqual(rest, [])
  // The pop-up itself has the note for a pop-up no button opens.
  assert.deepEqual(layoutWarnings(shut).filter(w => w.code === 'popup_unopened').map(w => w.zones), [['p']])

  // A button for that pop-up in the bar: both in reach.
  const chained = lay([tools([openOrder]), bar([openTools])])
  assert.deepEqual([...reachablePopups(chained)].sort(), ['o', 'p'])
  assert.deepEqual(popupOpeners(chained, 'o').map(x => [x.shut, x.works]), [[false, true]])
  assert.equal(unopenedWhy(chained, 'o'), null)
  assert.deepEqual(layoutProblems(chained), [])
  assert.ok(!layoutWarnings(chained).some(w => w.code === 'popup_unopened'))
  // ... unless the bar leaves that button out: the pop-up is shut again, and the order with it.
  const squeezed = lay([tools([openOrder]), bar([pay, openTools], { cols: 1, rows: 1, overflow: 'hide' })])
  assert.deepEqual([...reachablePopups(squeezed)], [])
  assert.deepEqual(layoutProblems(squeezed).map(x => [x.code, x.zones]), [['order_unopened', ['p', 'o']]])
  assert.deepEqual(layoutWarnings(squeezed).filter(w => w.code === 'popup_unopened').map(w => w.zones), [['b', 'p']])
  // A button that doesn't fit is the one to fix first: making room is all it takes.
  const both = lay([tools([openOrder]), bar([pay, { id: 'open2', action: 'open_popup', popup_id: 'o' }], { cols: 1, rows: 1, overflow: 'hide' })])
  assert.deepEqual(popupOpeners(both, 'o').map(x => [x.zone.id, x.left_out, x.shut]), [['p', false, true], ['b', true, false]])
  assert.deepEqual([unopenedWhy(both, 'o').why, unopenedWhy(both, 'o').zone.id], ['left_out', 'b'])
  assert.deepEqual(layoutProblems(both).map(x => x.zones), [['b', 'o']])
  assert.match(layoutProblems(both)[0].message, /doesn't fit in its zone and is left out/)
  // A button that doesn't fit in a pop-up nothing opens: the pop-up comes first (room for the button alone opens nothing).
  const lost = lay([{ ...tools([pay, openOrder]), cols: 1, rows: 1, overflow: 'hide' }, bar([pay])])
  assert.deepEqual(popupOpeners(lost, 'o').map(x => [x.zone.id, x.left_out, x.shut, x.works]), [['p', true, true, false]])
  assert.deepEqual([unopenedWhy(lost, 'o').why, unopenedWhy(lost, 'o').zone.id], ['shut', 'p'])
  assert.match(layoutProblems(lost)[0].message, /is in a pop-up nothing opens \(Tools\), so nothing opens the order/)

  // Two pop-ups that only open each other are never reached, nor is what they open.
  const cats = { id: 'c', type: 'categories', x: 0, y: 0, w: 6, h: 5, show: 'popup' }
  const ring = normaliseTillLayout({
    cols: 6, rows: 12,
    zones: [{ id: 'o', type: 'check', x: 0, y: 0, w: 6, h: 3 }, { ...dishes, y: 3, h: 7 }, cats,
      { id: 'p', type: 'popup', title: 'One', x: 0, y: 5, w: 6, h: 2, buttons: [{ id: 'a', action: 'open_popup', popup_id: 'q' }, { id: 'k', action: 'open_popup', popup_id: 'c' }] },
      { id: 'q', type: 'popup', title: 'Two', x: 0, y: 7, w: 6, h: 2, buttons: [{ id: 'b', action: 'open_popup', popup_id: 'p' }] }],
  })
  assert.deepEqual([...reachablePopups(ring)], [])
  const notes = layoutWarnings(ring).filter(w => w.code === 'popup_unopened')
  assert.deepEqual(notes.map(w => w.zones), [['p', 'c'], ['q', 'p'], ['p', 'q']])
  assert.match(notes[0].message, /The button that opens a pop-up \(Categories\) is in a pop-up nothing opens \(One\)/)
  assert.deepEqual(layoutProblems(ring), [])
  // One button in a Buttons zone for either of them lets all three be reached.
  const freed = normaliseTillLayout({ ...ring, zones: [...ring.zones, { id: 'b', type: 'buttons', x: 0, y: 10, w: 6, h: 2, buttons: [{ id: 'x', action: 'open_popup', popup_id: 'q' }] }] })
  assert.deepEqual([...reachablePopups(freed)].sort(), ['c', 'p', 'q'])
  assert.ok(!layoutWarnings(freed).some(w => w.code === 'popup_unopened'))
  assert.deepEqual(reachablePopups(null), new Set())
})

test('List view: one column of rows, the words on the left and the second line on the right', () => {
  const l = normaliseTillLayout({
    zones: [
      { id: 'o', type: 'check', x: 0, y: 0, w: 4, h: 8, view: 'list' },
      { id: 'k', type: 'categories', x: 4, y: 0, w: 2, h: 8, view: 'list', cols: 5, rows: 7 },
      { id: 'd', type: 'items', x: 6, y: 0, w: 6, h: 6, view: 'list', cols: 4, rows: 9, align: 'right', valign: 'bottom' },
      { id: 'g', type: 'category', x: 6, y: 6, w: 3, h: 1, view: 'rows' },
      { id: 'b', type: 'buttons', x: 9, y: 6, w: 3, h: 2, view: 'list', cols: 3, rows: 4, buttons: [{ id: 'a', action: 'pay', w: 3, h: 2 }, { id: 'c', action: 'send' }] },
      { id: 'm', type: 'modifiers', x: 6, y: 0, w: 6, h: 6, view: 'list', cols: 4 },
      { id: 'p', type: 'popup', x: 0, y: 0, w: 4, h: 4, view: 'list', cols: 3 },
      { id: 'n', type: 'menus', x: 6, y: 7, w: 3, h: 1, view: 'list' },
      { id: 's', type: 'seats', x: 0, y: 0, w: 1, h: 1, view: 'list' },
    ],
  })
  const z = id => l.zones.find(x => x.id === id)
  for (const id of ['k', 'd', 'b', 'm', 'p', 'n']) {
    assert.equal(z(id).view, 'list', id)
    assert.equal(z(id).cols, 1, id + ': one column')
    assert.ok(isList(z(id)))
  }
  assert.equal(z('k').rows, 7, 'the rows on screen at once stay as set')
  assert.equal(z('d').rows, 9)
  assert.equal(z('g').view, 'grid', 'an unknown view: a grid')
  assert.equal(z('g').cols, 4)
  assert.ok(!('view' in z('o')) && !('view' in z('s')), 'only zones with buttons have a view')
  assert.ok(!isList(z('g')) && !isList(null))
  // An older zone is a grid.
  assert.equal(normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 2, h: 2, cols: 5 }] }).zones[0].view, 'grid')
  assert.equal(normaliseTillLayout({ zones: [{ id: 'd', type: 'items', x: 0, y: 0, w: 2, h: 2, cols: 5 }] }).zones[0].cols, 5)
  // The row: words left, the second line right, whatever the zone's align says.
  assert.deepEqual(buttonTextStyle(z('d')), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', columnGap: '0.6em' })
  assert.deepEqual(buttonTextStyle(z('b')), buttonTextStyle(z('k')))
  assert.equal(buttonTextStyle(z('g')).flexDirection, undefined, 'a grid keeps the column')
  // Packing: one cell a row; a wide button is cut to the column, a tall one keeps its rows.
  const packed = packCells(z('b').buttons.map(b => ({ w: b.w, h: b.h })), z('b'))
  assert.deepEqual(packed.pages[0].map(p => [p.x, p.y, p.w, p.h]), [[0, 0, 1, 2], [0, 2, 1, 1]])
  const many = packCells(Array.from({ length: 12 }, () => ({})), { cols: z('d').cols, rows: z('d').rows, overflow: 'scroll' })
  assert.equal(many.rows, 12, 'a list scrolls down')
  assert.deepEqual(many.pages[0].map(p => p.y), Array.from({ length: 12 }, (_, i) => i))
  // Back to a grid: the type's own columns (the designer).
  assert.equal(gridDefaults('items').cols, 4)
  assert.equal(gridDefaults('categories').cols, 6)
  assert.equal(gridDefaults('nonsense').cols, 4)
  const d = gridDefaults('items'); d.cols = 99
  assert.equal(gridDefaults('items').cols, 4, 'a copy each time')
})

test('Phone layouts: the flag, and the three templates', () => {
  assert.equal(normaliseTillLayout({}).phone, false, 'older layouts are not phone layouts')
  assert.equal(normaliseTillLayout({ phone: true }).phone, true)
  assert.equal(normaliseTillLayout({ phone: 'yes' }).phone, false)
  assert.deepEqual(TEMPLATE_KEYS, ['standard', 'quick', 'phone', 'phone_table', 'phone_categories'])
  assert.deepEqual(LAYOUT_TEMPLATES.filter(t => t.phone).map(t => t.key), ['phone', 'phone_table', 'phone_categories'])
  assert.deepEqual([templateLayout('standard').phone, templateLayout('quick').phone], [false, false])
  for (const key of ['phone', 'phone_table', 'phone_categories']) {
    const l = templateLayout(key)
    const z = id => l.zones.find(x => x.id === id)
    assert.deepEqual([l.phone, l.top_bar, l.cols, l.rows], [true, false, 6, 12], key + ': upright, no top bar')
    assert.deepEqual(layoutProblems(l), [], key)
    assert.deepEqual(layoutWarnings(l).map(w => w.code), ['choices_window'], key + ': choices in the window')
    assert.deepEqual(normaliseTillLayout(JSON.parse(JSON.stringify(l))), l, key + ': stored as it is')
    // The order: a pop-up over the whole screen with its X, opened by the big button.
    const order = z('order')
    assert.deepEqual([order.type, order.show, order.cover, order.controls], ['check', 'popup', 'screen', true], key)
    const open = z('bar').buttons.find(b => b.action === 'open_popup' && b.popup_id === 'order')
    assert.deepEqual([open.w, open.h, open.colour], [2, 2, '#1f2a44'], key + ': the Order button, the left half of the bar')
    assert.deepEqual([z('bar').cols, z('bar').rows], [4, 2], key)
    assert.ok(z('bar').buttons.some(b => b.action === 'till_menu'), key + ': no top bar, so a way to the till menu')
    // The dishes: a list, with the search box.
    assert.deepEqual([z('dishes').view, z('dishes').cols, z('dishes').search], ['list', 1, true], key)
    // Every button of the bar fits its two rows.
    const packed = packCells(z('bar').buttons.map(b => ({ w: b.w, h: b.h })), z('bar'))
    assert.equal(packed.hidden, 0, key)
    assert.equal(packed.pages.length, 1, key)
    // Nothing always on screen overlaps, and together they fill it.
    const solid = l.zones.filter(x => !floats(x))
    assert.equal(solid.reduce((n, x) => n + x.w * x.h, 0), l.cols * l.rows, key + ': the zones always on screen fill it')
  }
  // Table service: seat and course behind a button, over the lower dishes.
  const t = templateLayout('phone_table')
  const seats = t.zones.find(z => z.id === 'seats')
  assert.deepEqual([seats.type, seats.show, seats.cover, seats.controls, seats.close_outside], ['seats', 'popup', 'zone', true, true])
  assert.deepEqual(popupOpeners(t, 'seats').map(o => o.button.label), ['Seat & course'])
  assert.deepEqual(t.zones.find(z => z.id === 'bar').buttons.map(b => b.action), ['open_popup', 'send', 'open_popup', 'till_menu'], 'tables: Send beside the order')
  // Categories behind a button: a list over the dishes that closes when one is picked.
  const c = templateLayout('phone_categories')
  const cats = c.zones.find(z => z.id === 'cats')
  const dishes = c.zones.find(z => z.id === 'dishes')
  assert.deepEqual([cats.view, cats.show, cats.cover, cats.frame, cats.controls, cats.close_on_tap], ['list', 'popup', 'zone', false, true, true])
  assert.deepEqual([dishes.show, dishes.view], ['always', 'list'])
  assert.deepEqual([cats.x, cats.y, cats.w, cats.h], [dishes.x, dishes.y, dishes.w, dishes.h], 'the categories open over the dishes')
  assert.deepEqual(popupOpeners(c, 'cats').map(o => [o.zone.id, o.button.id]), [['bar', 'cats']])
  assert.equal(buttonLabel(popupOpeners(c, 'cats')[0].button, { popups: c.zones.filter(isPopup) }), 'Categories')
  // The counter one: categories across the top, a strip that scrolls.
  const p = templateLayout('phone')
  assert.deepEqual(p.zones.find(z => z.id === 'bar').buttons.map(b => b.action), ['open_popup', 'pay', 'more', 'till_menu'], 'counter: Pay beside the order')
  assert.deepEqual(c.zones.find(z => z.id === 'bar').buttons.map(b => b.action), ['open_popup', 'open_popup', 'more', 'till_menu'])
  const strip = p.zones.find(z => z.id === 'cats')
  assert.deepEqual([strip.view, strip.rows, strip.overflow, strip.h], ['grid', 1, 'scroll', 1])
  assert.ok(strip.cols >= ZONE_GRID.min && strip.cols <= 4, 'a few categories across a phone')
  // An unknown key is still the standard screen.
  assert.deepEqual(templateLayout('nonsense'), templateLayout('standard'))
})

test('Several Dishes zones, each following a Categories zone', () => {
  const zones = [
    { id: 'order', type: 'check', x: 0, y: 0, w: 4, h: 8 },
    { id: 'food', type: 'categories', x: 4, y: 0, w: 4, h: 1 },
    { id: 'drinks', type: 'categories', x: 8, y: 0, w: 4, h: 1 },
    { id: 'mains', type: 'items', x: 4, y: 1, w: 4, h: 7 },
    { id: 'glasses', type: 'items', x: 8, y: 1, w: 4, h: 7, follows: 'drinks' },
  ]
  const l = normaliseTillLayout({ zones })
  const z = id => l.zones.find(x => x.id === id)
  assert.equal(z('mains').follows, null, 'none named: the first')
  assert.equal(z('glasses').follows, 'drinks')
  assert.equal(categoriesZoneOf(l, z('mains')).id, 'food')
  assert.equal(categoriesZoneOf(l, z('glasses')).id, 'drinks')
  assert.deepEqual(dishesZonesOf(l, z('food')).map(x => x.id), ['mains'])
  assert.deepEqual(dishesZonesOf(l, z('drinks')).map(x => x.id), ['glasses'])
  assert.deepEqual(dishesZonesOf(l, null), [])
  assert.deepEqual(layoutProblems(l), [])
  assert.deepEqual(layoutWarnings(l).map(w => w.code), ['choices_window'], 'each Categories zone has its own Dishes zone')

  // A zone it can't follow (gone, not a Categories zone, not an id): the first one.
  for (const bad of ['gone', 'order', 'mains', 'not an id!', 7]) {
    const k = normaliseTillLayout({ zones: zones.map(x => (x.id === 'glasses' ? { ...x, follows: bad } : x)) })
    assert.equal(k.zones.find(x => x.id === 'glasses').follows, null, String(bad))
    assert.equal(categoriesZoneOf(k, k.zones.find(x => x.id === 'glasses')).id, 'food')
  }
  // Only Dishes zones follow.
  const own = normaliseTillLayout({ zones: [...zones.slice(0, 3), { id: 'cat', type: 'category', x: 4, y: 1, w: 4, h: 2, follows: 'drinks' }] })
  assert.equal('follows' in own.zones.find(x => x.id === 'cat'), false)
  // The Categories zone it followed taken out: it follows the first one.
  const left = normaliseTillLayout({ zones: zones.filter(x => x.id !== 'drinks') })
  assert.equal(left.zones.find(x => x.id === 'glasses').follows, null)
  // No Categories zone: none followed (every dish of the menus on now).
  const none = normaliseTillLayout({ zones: zones.filter(x => x.type !== 'categories') })
  assert.equal(categoriesZoneOf(none, none.zones.find(x => x.id === 'mains')), null)

  const warn = (list, code) => layoutWarnings(normaliseTillLayout({ zones: list })).filter(w => w.code === code)
  // Both following the first: the second Categories zone shows no dishes, and they show the same.
  const same = zones.map(x => (x.id === 'glasses' ? { ...x, follows: null } : x))
  const [alone] = warn(same, 'categories_alone')
  assert.deepEqual(alone.zones, ['drinks'])
  assert.match(alone.message, /No Dishes zone follows Categories 2/)
  const [both] = warn(same, 'same_dishes')
  assert.deepEqual(both.zones, ['mains', 'glasses'])
  assert.match(both.message, /^Dishes 1 and Dishes 2 follow the same Categories zone \(Categories 1\)/)
  // One Categories zone and three Dishes zones: add another Categories zone.
  const one = [...zones.filter(x => x.id !== 'drinks').map(x => ({ ...x, follows: null })), { id: 'third', type: 'items', x: 8, y: 0, w: 4, h: 1 }]
  const [three] = warn(one.map(x => (x.id === 'glasses' ? { ...x, y: 1 } : x)), 'same_dishes')
  assert.match(three.message, /^Dishes 1, Dishes 2 and Dishes 3 follow the one Categories zone.*add another Categories zone/)
  assert.deepEqual(warn(one, 'categories_alone'), [])
  // No Dishes zone at all: one warning, not one per Categories zone.
  const noDishes = warn(zones.filter(x => x.type !== 'items'), 'categories_alone')
  assert.equal(noDishes.length, 1)
  assert.deepEqual(noDishes[0].zones, [])
  // No Categories zone: the Dishes zones show every dish.
  const [every] = warn(zones.filter(x => x.type !== 'categories'), 'items_alone')
  assert.match(every.message, /the Dishes zones show every dish/)
  assert.deepEqual(warn(zones.filter(x => x.type !== 'categories'), 'same_dishes'), [])
})
