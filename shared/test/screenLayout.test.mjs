// Menu screens renderer tests: board settings, schedules (times of day),
// prices and options, sold out, hidden sections, the allergen key.
// Run: node --test shared/test/screenLayout.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeBoard, boardMenuIds, boardContext, renderBoardHtml, renderBlockInner, boardOnAt, itemsOnAt,
  formatPrice, dishPriceText, dishOptionLabels, localParts, clockText, boardFonts, screenFontsUrl, withAlpha,
  orderChanges, keepOrderChanges, orderBoardData, ORDER_CHANGE_KEEP_MS,
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

test('video block: muted, plays on a loop; thumbnails show a frame only', async () => {
  const { renderBlockInner: r, boardContext: bc, boardVideoUrls, boardVideoSeconds } = await import('../screenLayout.js')
  const layout = { blocks: [block('video', { url: '/uploads/t/media/a.mp4', fit: 'contain', duration: 12.4 })] }
  const live = bc(layout, {})
  const html = r(live.board.blocks[0], live)
  assert.match(html, /<video class="sl-video" muted playsinline/)
  assert.match(html, / autoplay preload="auto" loop/)
  assert.match(html, /object-fit:contain/)
  const still = bc(layout, { still: true })
  const thumb = r(still.board.blocks[0], still)
  assert.doesNotMatch(thumb, /autoplay/)
  assert.match(thumb, /a\.mp4#t=0\.5/)
  assert.deepEqual(boardVideoUrls(layout), ['/uploads/t/media/a.mp4'])
  assert.equal(boardVideoSeconds(layout), 13)
  const noLoop = bc({ blocks: [block('video', { url: '/uploads/a.webm', loop: false })] }, {})
  assert.doesNotMatch(r(noLoop.board.blocks[0], noLoop), / loop/)
  const bad = bc({ blocks: [block('video', { url: 'javascript:x' })] }, {})
  assert.equal(r(bad.board.blocks[0], bad), '')
})

test('scrolling text repeats enough to cover the block and is escaped', async () => {
  const { renderBlockInner: r, boardContext: bc } = await import('../screenLayout.js')
  const ctx = bc({ blocks: [block('ticker', { text: '<b>Hot</b>  deals', size: 40, speed: 100, gap: 100 }, { w: 1920 })] }, {})
  const html = r(ctx.board.blocks[0], ctx)
  assert.doesNotMatch(html, /<b>/)
  const copies = (html.match(/sl-tk-item/g) || []).length
  assert.ok(copies >= 2 && copies <= 40, String(copies))
  assert.match(html, /data-sl-ticker="100"/)
  assert.match(html, new RegExp('--sl-tks:' + (-100 / copies).toString().replace('.', '\\.') + '%'))
  const right = bc({ blocks: [block('ticker', { text: 'x', direction: 'right' })] }, {})
  assert.match(r(right.board.blocks[0], right), /sl-tk-right/)
})

test('animations wrap the block content only when set', async () => {
  const { wrapMotion, renderBoardHtml: rb, boardContext: bc } = await import('../screenLayout.js')
  assert.equal(wrapMotion({ opts: {} }, 'X'), 'X')
  assert.equal(wrapMotion({ opts: { anim_in: 'nonsense', anim_loop: 'nope' } }, 'X'), 'X')
  const both = wrapMotion({ opts: { anim_in: 'rise', anim_in_ms: 500, anim_in_delay: 300, anim_loop: 'pulse' } }, 'X')
  assert.equal(both, '<div class="sl-in sl-in-rise" style="--sl-id:500ms;--sl-idl:300ms"><div class="sl-loop sl-loop-pulse" style="--sl-ld:2000ms">X</div></div>')
  const html = rb(bc({ blocks: [block('heading', { text: 'Hi', anim_in: 'fade' })] }, {}))
  assert.match(html, /<div class="sl-block sl-t-heading"[^>]*><div class="sl-in sl-in-fade"/)
})

test('playlist position comes from the clock, the same on every screen', async () => {
  const { playlistPosition, replayStart } = await import('../screenLayout.js')
  const list = [{ id: 'a', duration_secs: 10 }, { id: 'b', duration_secs: 20 }, { id: 'c', duration_secs: 5 }]
  // a cycle is 35 s; at 35 s x 1000 cycles + 12 s we are 2 s into b
  const t = 35_000 * 1000 + 12_000
  const p = playlistPosition(list, t)
  assert.equal(p.index, 1)
  assert.equal(p.startMs, t - 2_000)
  assert.equal(p.endMs, t + 18_000)
  assert.equal(playlistPosition(list, t + 18_000).index, 2)        // c starts exactly at b's end
  assert.equal(playlistPosition(list, t + 23_000).index, 0)
  assert.equal(playlistPosition([], t), null)
  assert.equal(playlistPosition([{ duration_secs: 1 }], 1_000).endMs - playlistPosition([{ duration_secs: 1 }], 1_000).startMs, 3_000) // 3 s minimum
  assert.equal(replayStart({ replay_secs: 0 }, 500, 99_999), 500)
  assert.equal(replayStart({ replay_secs: 30 }, 500, 95_000), 90_000)
  assert.equal(replayStart({ replay_secs: 30 }, 92_000, 95_000), 92_000)
})

test('wall regions split the board with the bezel gap between screens', async () => {
  const { wallRegion, wallBoardSize } = await import('../screenLayout.js')
  assert.deepEqual(wallRegion(1920, 1080, null), { x: 0, y: 0, w: 1920, h: 1080 })
  const size = wallBoardSize(1920, 1080, 2, 1, 40)
  assert.deepEqual(size, { width: 3880, height: 1080 })
  assert.deepEqual(wallRegion(3880, 1080, { cols: 2, rows: 1, col: 1, row: 0, gap: 40 }), { x: 1960, y: 0, w: 1920, h: 1080 })
  assert.deepEqual(wallRegion(3840, 2160, { cols: 2, rows: 2, col: 1, row: 1 }), { x: 1920, y: 1080, w: 1920, h: 1080 })
  // out of range cells are clamped
  assert.deepEqual(wallRegion(3840, 1080, { cols: 2, rows: 1, col: 9, row: 0 }), { x: 1920, y: 0, w: 1920, h: 1080 })
})

test('transitions: keyframes in board pixels, unknown means a cut', async () => {
  const { transitionFrames, TRANSITION_KEYS, normalizeBoard: nb } = await import('../screenLayout.js')
  assert.equal(transitionFrames('none', 100, 50), null)
  assert.equal(transitionFrames('bogus', 100, 50), null)
  assert.deepEqual(transitionFrames('slide_left', 1920, 1080).in[0], { transform: 'translateX(1920px)' })
  assert.deepEqual(transitionFrames('slide_up', 1920, 1080).out[1], { transform: 'translateY(-1080px)' })
  for (const k of TRANSITION_KEYS) if (k !== 'none') assert.ok(transitionFrames(k, 10, 10).in.length === 2, k)
  const b = nb({ replay_secs: 99999, guide_cols: 9, guide_gap: -4 }, 1920, 1080)
  assert.equal(b.replay_secs, 3600)
  assert.equal(b.guide_cols, 6)
  assert.equal(b.guide_gap, 0)
})

test('order status: one board by name, changes animate in and out, layout and colours', async () => {
  const at = Date.parse('2026-10-16T18:00:00Z')
  const n = (id, number) => ({ id, number, at: new Date(at - 60_000).toISOString() })
  const before = { preparing: [n('a', '41'), n('b', '42')], ready: [n('c', '40')], boards: { 'orb 1': { preparing: [n('a', '41')], ready: [] } } }
  const after = { preparing: [n('b', '42'), n('d', '43')], ready: [n('a', '41')], boards: { 'orb 1': { preparing: [], ready: [n('a', '41')] } } }
  assert.deepEqual(orderBoardData(after, ' ORB 1 ').ready.map(x => x.number), ['41'])
  assert.deepEqual(orderBoardData(after, 'ORB 2'), { preparing: [], ready: [] })
  const changes = orderChanges(before, after, at)
  const all = changes.find(c => c.key === '')
  assert.deepEqual([all.prep_in, all.ready_in, all.prep_out.map(x => [x.id, x.index]), all.ready_out.map(x => x.id)],
    [['d'], ['a'], [['a', 0]], ['c']])
  assert.deepEqual(changes.find(c => c.key === 'orb 1').ready_in, ['a'])
  assert.deepEqual(orderChanges(null, after, at), [], 'nothing to compare on the first fetch')
  assert.equal(keepOrderChanges(changes, at + ORDER_CHANGE_KEEP_MS + 1).length, 0)

  const block = opts => ({ id: 'o1', type: 'order_status', x: 0, y: 0, w: 1, h: 1, opts })
  const layout = opts => normalizeBoard({ width: 1920, height: 1080, blocks: [block(opts)] }, 1920, 1080)
  const draw = (opts, t) => renderBlockInner(layout(opts).blocks[0], boardContext(layout(opts), {
    width: 1920, height: 1080, now: new Date(at + t), orders: { ...after, changes },
  }))
  const html = draw({ board: 'ORB 1', change_anim: 'float', change_ms: 1000, layout: 'stacked', ready_first: true, preparing_bg: '#123456' }, 300)
  assert.match(html, /sl-orders[^"]*is-stacked[^"]*sl-och-float/)
  assert.match(html, /--opb:\s*#123456/)
  assert.ok(html.indexOf('is-ready') < html.indexOf('is-prep'), 'ready first')
  assert.match(html, /sl-onum is-ready sl-och-in" style="animation-delay:-300ms" data-main="number"><span class="sl-otext"><span class="sl-oval">41/)
  assert.match(html, /sl-onum is-prep sl-och-out" style="animation-delay:-300ms" data-main="number"><span class="sl-otext"><span class="sl-oval">41/, '41 fades out of preparing')
  const later = draw({ board: 'ORB 1', change_anim: 'float', change_ms: 1000 }, 1200)
  assert.doesNotMatch(later, /sl-och-(in|out)"/, 'over once the animation has played')
  assert.doesNotMatch(draw({ board: 'ORB 1' }, 300), /sl-och-in/, 'no animation unless chosen')
  const sameMs = renderBlockInner(layout({ board: 'ORB 1', change_anim: 'fade' }).blocks[0], boardContext(layout({ board: 'ORB 1', change_anim: 'fade' }), {
    width: 1920, height: 1080, now: new Date(at), orders: { ...after, changes: changes.map(c => ({ ...c, at: at + 0.6 })) },
  }))
  assert.match(sameMs, /sl-onum is-ready sl-och-in" data-main="number"><span class="sl-otext"><span class="sl-oval">41/, 'a draw in the same millisecond still animates')
})

test('order status tiles show the fields picked: a big value and lines under it', () => {
  const at = Date.parse('2026-10-19T12:00:00Z')
  const orders = {
    preparing: [
      { id: 'a', number: '41', tent: '12', name: 'Sam', type_name: 'Eat in', source: 'till', at: new Date(at).toISOString() },
      { id: 'b', number: '42', type_name: 'Take out', source: 'online', at: new Date(at).toISOString() },
    ],
    ready: [],
  }
  const block = opts => ({ id: 'o1', type: 'order_status', x: 0, y: 0, w: 1, h: 1, opts })
  const draw = opts => {
    const l = normalizeBoard({ width: 1920, height: 1080, blocks: [block(opts)] }, 1920, 1080)
    return renderBlockInner(l.blocks[0], boardContext(l, { width: 1920, height: 1080, now: new Date(at), orders }))
  }
  const plain = draw({})
  assert.match(plain, /data-main="number"><span class="sl-otext"><span class="sl-oval">41<\/span><\/span><\/div>/, 'the number alone by default')
  const tent = draw({ tile_main: 'tent', tile_lines: ['number', 'name', 'type', 'source'] })
  assert.match(tent, /data-main="tent"><span class="sl-otext"><span class="sl-ocap">Tent<\/span><span class="sl-oval">12<\/span><span class="sl-oline" data-k="number">Order 41<\/span><span class="sl-oline" data-k="name">Sam<\/span><span class="sl-oline" data-k="type">Eat in<\/span><\/span><\/div>/)
  assert.match(tent, /data-main="number"><span class="sl-otext"><span class="sl-oval">42<\/span><span class="sl-oline" data-k="type">Take out<\/span><span class="sl-oline" data-k="source">Online<\/span>/, 'no tent: the number, lines it has')
  const named = draw({ tile_main: 'name', tile_lines: ['name', 'tent'] })
  assert.match(named, /data-main="name"><span class="sl-otext"><span class="sl-oval">Sam<\/span><span class="sl-oline" data-k="tent">Tent 12<\/span>/, 'the big field is not repeated as a line')
  const safe = draw({ tile_main: 'name', tile_lines: ['nonsense'] })
  assert.doesNotMatch(safe, /nonsense/)
})

test('order board tiles: font, shape, border, pictures and small pictures', async () => {
  const { renderBlockInner, boardContext, normalizeBoard, tileLook, tileIcon, tileImageUrls, boardImageUrls, boardFonts } = await import('../screenLayout.js')
  const o = {
    tile_font: 'Anton', tile_line_font: 'script', tile_weight: 700, tile_shape: 'circle', tile_border_width: 4, tile_border_color: '#ff0000',
    tile_shadow: 'glow', tile_ready_image: '/uploads/a b.png', tile_prep_image: '', tile_image_dim: 40,
    tile_icon: '/uploads/bell.png', tile_type_icons: { 'Eat In': '/uploads/plate.png', Bad: 'javascript:alert(1)' }, tile_icon_pos: 'corner', tile_icon_size: 80,
  }
  const v = tileLook(o)
  assert.match(v['--otf'], /Anton/)
  assert.equal(v['--otlf'], 'var(--sl-script)')
  assert.equal(v['--otr'], '50%')
  assert.equal(v['--otar'], '1 / 1')
  assert.equal(v['--otb'], '4px solid #ff0000')
  assert.match(v['--orimg'], /^url\('\/uploads\/a%20b\.png'\)$/)
  assert.equal(v['--opimg'], null)
  assert.equal(v['--ordim'], '0.4')
  assert.equal(v['--opdim'], null)
  assert.equal(v['--otis'], '0.8')
  // Per order type (any case), else the one for every tile; unsafe addresses ignored.
  assert.equal(tileIcon(o, { type_name: 'eat in' }), '/uploads/plate.png')
  assert.equal(tileIcon(o, { type_name: 'Take out' }), '/uploads/bell.png')
  assert.equal(tileIcon({ ...o, tile_icon: '' }, { type_name: 'Bad' }), '')
  assert.deepEqual(tileImageUrls(o), ['/uploads/a b.png', '/uploads/bell.png', '/uploads/plate.png'])
  // Defaults: nothing set, nothing added.
  const d = tileLook({})
  assert.equal(d['--otr'], null)
  assert.equal(d['--orimg'], null)

  const layout = normalizeBoard({ blocks: [{ id: 'o', type: 'order_status', x: 0, y: 0, w: 800, h: 600, opts: o }] })
  assert.ok(boardFonts(layout).includes('Anton'))
  assert.ok(boardImageUrls(layout).includes('/uploads/plate.png'))
  const ctx = boardContext(layout, { menus: [], now: new Date('2026-10-23T12:00:00Z') })
  const html = renderBlockInner(layout.blocks[0], ctx)
  assert.match(html, /data-icon="corner"/)
  assert.match(html, /<img class="sl-oicon" src="\/uploads\/plate\.png"/)
  assert.match(html, /<img class="sl-oicon" src="\/uploads\/bell\.png"/)
  assert.match(html, /<span class="sl-otext">/)
  assert.match(html, /--orimg:url\('\/uploads\/a%20b\.png'\)/)
  // No pictures: no img, no data-icon.
  const plain = renderBlockInner({ ...layout.blocks[0], opts: {} }, ctx)
  assert.doesNotMatch(plain, /sl-oicon|data-icon/)
})
