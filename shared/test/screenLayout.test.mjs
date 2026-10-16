// Menu screens renderer tests: board settings, schedules (times of day),
// prices and options, sold out, hidden sections, the allergen key.
// Run: node --test shared/test/screenLayout.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeBoard, boardMenuIds, boardContext, renderBoardHtml, renderBlockInner, boardOnAt, itemsOnAt,
  formatPrice, dishPriceText, dishOptionLabels, localParts, clockText, boardFonts, screenFontsUrl, withAlpha,
} from '../screenLayout.js'

const MENU = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Lunch',
  hide_unpriced_variants: false, hide_zero_priced_variants: false,
  sections: [
    {
      id: 's1', title: 'Mains',
      items: [
        { id: 'i1', name: 'Pad Thai', description: 'Rice noodles', price_pence: 1250, dietary: ['n', 'vg'], allergen_levels: { n: 'removable' } },
        {
          id: 'i2', name: 'Green curry', price_pence: null, dietary: [],
          variant_groups: [{ group_id: 'g1', name: 'Protein', price_mode: 'base', min_select: 1, max_select: 1,
            options: [{ option_id: 'o1', label: 'Chicken', price_pence: 1295 }, { option_id: 'o2', label: 'Prawn', price_pence: 1495 }] }],
        },
        { id: 'i3', name: 'Rice', price_pence: 350, dietary: [] },
      ],
    },
    { id: 's2', title: 'Staff only', visibility: 'hidden', items: [{ id: 'i9', name: 'Staff meal', price_pence: 100 }] },
  ],
}
const TAGS = [
  { code: 'n', label: 'Nuts', glyph: 'N', colour: '#aa3300', kind: 'allergen' },
  { code: 'vg', label: 'Vegan', glyph: 'VG', colour: '#118833', kind: 'dietary' },
  { code: 'hot', label: 'Hot', glyph: 'H', colour: '#cc0000', kind: 'dietary', show_on_menu: false },
]
const block = (type, opts, extra = {}) => ({ id: 'b-' + type, type, x: 0, y: 0, w: 800, h: 400, opts, ...extra })

test('normalizeBoard fills defaults, drops unknown blocks, clamps sizes', () => {
  const b = normalizeBoard({ background: 'red', blocks: [
    { type: 'heading', x: 99999, y: 0, w: 99999, h: 10, opts: { text: 'Hi' } },
    { type: 'marquee', x: 0, y: 0, w: 10, h: 10 },
  ] }, 1920, 1080)
  assert.equal(b.background, '#141414')   // not a hex: default
  assert.equal(b.blocks.length, 1)
  assert.equal(b.blocks[0].x, 1920)
  assert.equal(b.blocks[0].w, 1920)
  assert.equal(b.price_symbol, true)
  assert.equal(b.font_heading, 'Oswald')
})

test('boardMenuIds lists only real menu ids', () => {
  assert.deepEqual(boardMenuIds({ blocks: [block('menu', { menu_id: MENU.id }), block('price', { menu_id: 'nope' }), block('text', {})] }), [MENU.id])
})

test('boardOnAt: no schedule = always; end not included; 23:59 means midnight', () => {
  const at = (date, dow, h, m = 0) => ({ date, dow, minutes: h * 60 + m })
  assert.equal(boardOnAt(null, at('2026-10-16', 5, 3)), true)
  const lunch = { times: [{ days: [5], start: '11:00', end: '15:00' }] }
  assert.equal(boardOnAt(lunch, at('2026-10-16', 5, 11)), true)
  assert.equal(boardOnAt(lunch, at('2026-10-16', 5, 14, 59)), true)
  assert.equal(boardOnAt(lunch, at('2026-10-16', 5, 15)), false)    // hands over at 15:00
  assert.equal(boardOnAt(lunch, at('2026-10-17', 6, 12)), false)    // other day
  const late = { times: [{ days: [5], start: '22:00', end: '23:59' }] }
  assert.equal(boardOnAt(late, at('2026-10-16', 5, 23, 59)), true)
  const dated = { from: '2026-10-20', until: '2026-10-31', times: [] }
  assert.equal(boardOnAt(dated, at('2026-10-16', 5, 12)), false)
  assert.equal(boardOnAt(dated, at('2026-10-25', 0, 12)), true)
  const items = [{ id: 'a', schedule: lunch }, { id: 'b', schedule: { times: [{ days: [5], start: '15:00', end: '22:00' }] } }, { id: 'c', schedule: null }]
  assert.deepEqual(itemsOnAt(items, at('2026-10-16', 5, 15)).map(i => i.id), ['b', 'c'])
})

test('localParts and clockText use the venue time zone', () => {
  const d = new Date('2026-07-01T11:30:00Z')   // 12:30 in London (BST)
  assert.deepEqual(localParts(d, 'Europe/London'), { date: '2026-07-01', dow: 3, minutes: 12 * 60 + 30 })
  assert.equal(clockText({ format: '24' }, d, 'Europe/London'), '12:30')
  assert.equal(clockText({ format: '12' }, d, 'Europe/London'), '12:30 pm')
})

test('prices: £ sign, whole pounds, options as "from"', () => {
  assert.equal(formatPrice(1250, {}), '£12.50')
  assert.equal(formatPrice(1200, { price_whole: true }), '£12')
  assert.equal(formatPrice(1250, { price_whole: true, price_symbol: false }), '12.50')
  const curry = MENU.sections[0].items[1]
  assert.equal(dishPriceText(curry, MENU, {}), 'from £12.95')
  assert.equal(dishPriceText(curry, MENU, {}, { option: 'Prawn' }), '£14.95')
  assert.equal(dishPriceText(curry, MENU, {}, { fromText: '' }), '£12.95')
  assert.deepEqual(dishOptionLabels(curry, MENU), ['Chicken', 'Prawn'])
  assert.equal(dishPriceText(MENU.sections[0].items[0], MENU, {}), '£12.50')
})

test('menu block: section dishes, options listed, hidden section never shown, hidden tags dropped', () => {
  const layout = { blocks: [block('menu', { menu_id: MENU.id, section_id: 's1', show_options: true })] }
  const ctx = boardContext(layout, { menus: [MENU], tags: TAGS })
  const html = renderBoardHtml(ctx)
  assert.match(html, /Pad Thai/)
  assert.match(html, /Chicken <span class="sl-opt-price">£12\.95/)
  assert.match(html, /£12\.50/)
  assert.doesNotMatch(html, /Staff meal/)
  assert.match(html, /<sup>\*<\/sup>/)                 // removable nuts
  assert.ok(!ctx.tags.some(t => t.code === 'hot'))
  // a block pointing at the hidden section shows nothing
  const hidden = boardContext({ blocks: [block('menu', { menu_id: MENU.id, section_id: 's2' })] }, { menus: [MENU], tags: TAGS })
  assert.equal(renderBlockInner(hidden.board.blocks[0], hidden), null)
})

test('sold out: crossed out, or left out; price block says so', () => {
  const layout = { sold_out_text: 'Gone', blocks: [
    block('menu', { menu_id: MENU.id, section_id: 's1' }),
    block('price', { menu_id: MENU.id, item_id: 'i3' }, { id: 'p' }),
  ] }
  const ctx = boardContext(layout, { menus: [MENU], tags: TAGS, sold_out: ['i3'] })
  const menuHtml = renderBlockInner(ctx.board.blocks[0], ctx)
  assert.match(menuHtml, /sl-item is-sold/)
  assert.match(menuHtml, /Gone/)
  assert.match(renderBlockInner(ctx.board.blocks[1], ctx), /Gone/)
  const hide = boardContext({ blocks: [block('menu', { menu_id: MENU.id, section_id: 's1', sold_out: 'hide' })] }, { menus: [MENU], sold_out: ['i3'] })
  assert.doesNotMatch(renderBlockInner(hide.board.blocks[0], hide), />Rice</)
  const gone = boardContext({ blocks: [block('price', { menu_id: MENU.id, item_id: 'i3', sold_out: 'hide' })] }, { menus: [MENU], sold_out: ['i3'] })
  assert.equal(renderBlockInner(gone.board.blocks[0], gone), '')
})

test('picked dishes keep their order; missing menu or dish renders null', () => {
  const ctx = boardContext({ blocks: [block('menu', { source: 'dishes', menu_id: MENU.id, item_ids: ['i3', 'i1'], title: 'Picks' })] }, { menus: [MENU] })
  const html = renderBlockInner(ctx.board.blocks[0], ctx)
  assert.ok(html.indexOf('Rice') < html.indexOf('Pad Thai'))
  assert.match(html, /Picks/)
  const none = boardContext({ blocks: [block('dish', { menu_id: MENU.id, item_id: 'zzz' })] }, { menus: [MENU] })
  assert.equal(renderBlockInner(none.board.blocks[0], none), null)
  const nomenu = boardContext({ blocks: [block('price', { menu_id: MENU.id, item_id: 'i1' })] }, { menus: [] })
  assert.equal(renderBlockInner(nomenu.board.blocks[0], nomenu), null)
})

test('allergen key lists the tags used on the board', () => {
  const ctx = boardContext({ blocks: [
    block('price', { menu_id: MENU.id, item_id: 'i1' }),
    block('allergen_key', {}, { id: 'k' }),
  ] }, { menus: [MENU], tags: TAGS })
  const html = renderBlockInner(ctx.board.blocks[1], ctx)
  assert.match(html, /Nuts/)
  assert.match(html, /Vegan/)
  assert.match(html, /Can be removed on request/)
  assert.doesNotMatch(html, /Hot/)
})

test('text is escaped; urls must be http(s) or site paths', () => {
  const ctx = boardContext({ blocks: [
    block('text', { text: '<script>x</script>' }),
    block('image', { url: 'javascript:alert(1)' }, { id: 'i' }),
    block('image', { url: '/uploads/a.png' }, { id: 'j' }),
  ] }, {})
  assert.doesNotMatch(renderBlockInner(ctx.board.blocks[0], ctx), /<script>/)
  assert.equal(renderBlockInner(ctx.board.blocks[1], ctx), '')
  assert.match(renderBlockInner(ctx.board.blocks[2], ctx), /src="\/uploads\/a\.png"/)
})

test('fonts: one stylesheet with each font\'s own weights', () => {
  const fonts = boardFonts({ font_body: 'Inter', font_heading: 'Bebas Neue', blocks: [block('text', { font: 'Anton', text: 'x' })] })
  assert.ok(fonts.includes('Bebas Neue') && fonts.includes('Anton'))
  const url = screenFontsUrl(fonts)
  assert.match(url, /family=Bebas\+Neue:wght@400&/)
  assert.match(url, /family=Inter:wght@300;400;500;600;700;800/)
  assert.equal(withAlpha('#ff0000', 50), 'rgba(255,0,0,0.5)')
})
