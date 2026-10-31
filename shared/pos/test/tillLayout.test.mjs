// Till layouts (shared/pos/tillLayout.js): the stored shape, what stops a
// save, which zone shows a dish's choices, and how buttons fill a zone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseTillLayout, layoutProblems, layoutWarnings, choiceZones, packCells, buttonLabel,
  ownLayout, layoutIds, templateLayout, LAYOUT_TEMPLATES, overlaps,
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
  assert.deepEqual(empty, { cols: 12, rows: 8, zones: [] })
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

  const layout = normaliseTillLayout({
    zones: [
      { type: 'check', x: 0, y: 0, w: 4, h: 8 },
      { type: 'categories', x: 4, y: 0, w: 8, h: 1, sections: [A, C] },
      { type: 'buttons', x: 4, y: 1, w: 8, h: 2, buttons: [{ action: 'item', item_id: A }, { action: 'item', item_id: C }, { action: 'discount_preset', preset_id: B }, { action: 'discount_preset', preset_id: C }, { action: 'send' }] },
    ],
  })
  assert.deepEqual(layoutIds(layout), { items: [A, C], sections: [A, C], presets: [B, C] })
  const own = ownLayout(layout, { sectionIds: new Set([A]), itemIds: [A], presetIds: new Set([B]) })
  assert.deepEqual(own.zones[1].sections, [A])
  assert.deepEqual(own.zones[2].buttons.map(b => b.item_id || b.preset_id || b.action), [A, B, 'send'])
})
