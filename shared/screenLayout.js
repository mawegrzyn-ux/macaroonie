// shared/screenLayout.js
//
// Menu screens (migration 166). A board is a fixed-size canvas in pixels
// (screen_designs.width x height) holding positioned blocks; its layout is
// screen_designs.layout. ONE renderer used by:
//   - the player (screen/player.js, served by api/src/routes/screenSite.js
//     as /lib/screenLayout.js next to the shared files it imports)
//   - the admin board designer canvas (admin/src/pages/ScreenDesigner.jsx)
// so a board looks the same in the designer and on the screen. Plain ESM,
// no DOM, no dependencies beyond the other shared files.
//
// Layout:
//   { background, background_image, background_fit,
//     text_color, accent_color, muted_color,
//     font_body, font_heading, font_script,
//     price_symbol (bool), price_whole (bool: £8 instead of £8.00),
//     sold_out_text, grid (snap, px),
//     replay_secs (0 = block animations play once when the board comes on,
//       else again every N seconds, in step on every screen),
//     guide_cols, guide_rows, guide_gap (the designer's lines where a wall's
//       screens meet; looks only, a wall's own settings decide the split),
//     blocks: [{ id, type, x, y, w, h, opts }] }   later blocks sit on top
//
// Any block may animate (migration 167): opts.anim_in (how it comes on:
// fade, rise, ...) with anim_in_ms / anim_in_delay, and opts.anim_loop
// (pulse, float, ...) with anim_loop_ms. They run only inside a board with
// the class sl-play (the player adds it; the designer on Play), so a
// designed board always shows its final state. Playlists move between
// boards with TRANSITIONS (transitionFrames()); a wall shows one region
// of a board on each screen (wallRegion()), and every screen works out
// which board is on from the clock (playlistPosition()), so screens stay
// in step without talking to each other.
//
// Menu data comes from the LIVE menus (api/src/services/screenSvc.js loads
// them with loadMenuVersions()), so prices change on screens when a menu is
// published. Sold out comes from the venue's sold out list.

import { FONT_WEIGHTS, FONT_OPTIONS } from './fonts.js'
import { allergenKey, isRemovable, menuTags } from './menuTags.js'
import { itemChoices, variantRules, fromPrice, comboMenuPrice } from './orderPricing.js'
import { comboGuide, menuCtx } from './combos.js'

// ── Constants ───────────────────────────────────────────────

export const BOARD_SIZES = [
  { key: 'fhd',  label: 'Full HD, landscape', width: 1920, height: 1080 },
  { key: 'fhdp', label: 'Full HD, portrait',  width: 1080, height: 1920 },
  { key: '4k',   label: '4K, landscape',      width: 3840, height: 2160 },
  { key: '4kp',  label: '4K, portrait',       width: 2160, height: 3840 },
  { key: 'hd',   label: 'HD, landscape',      width: 1280, height: 720 },
  { key: 'hdp',  label: 'HD, portrait',       width: 720,  height: 1280 },
]

export const MIN_SIZE = 240
export const MAX_SIZE = 8192
export const MAX_BLOCKS = 300

export const BLOCK_TYPES = ['heading', 'text', 'menu', 'dish', 'price', 'image', 'video', 'ticker', 'box', 'clock', 'allergen_key', 'order_status']

export const BLOCK_LABELS = {
  heading: 'Heading', text: 'Text', menu: 'Menu list', dish: 'Featured dish', price: 'Price',
  image: 'Image', video: 'Video', ticker: 'Scrolling text', box: 'Box or line', clock: 'Clock', allergen_key: 'Allergen key',
  order_status: 'Order status',
}

export const BLOCK_HINTS = {
  heading: 'A title or a short line.',
  text: 'A paragraph or notes.',
  menu: 'A section of a menu, or dishes you pick, with prices.',
  dish: 'One dish, large, with its photo and price.',
  price: 'Just a price, to put on a photo or design.',
  image: 'A photo, logo or picture from Media.',
  video: 'A video from Media, playing on a loop.',
  ticker: 'A line of text moving across the board.',
  box: 'A coloured panel or a line.',
  clock: 'The time (and date) at the venue.',
  allergen_key: 'What the tags on this board\'s dishes mean.',
  order_status: 'Order numbers being prepared and ready to collect, from the kitchen screens.',
}

// How a block comes on (opts.anim_in) and moves while on (opts.anim_loop).
export const ANIM_IN = [
  { key: 'none', label: 'Just there' },
  { key: 'fade', label: 'Fade in' },
  { key: 'rise', label: 'Rise up' },
  { key: 'drop', label: 'Drop down' },
  { key: 'left', label: 'From the left' },
  { key: 'right', label: 'From the right' },
  { key: 'zoom', label: 'Zoom in' },
  { key: 'pop', label: 'Pop' },
  { key: 'wipe', label: 'Wipe' },
]
export const ANIM_LOOP = [
  { key: 'none', label: 'Still', ms: 0 },
  { key: 'pulse', label: 'Pulse', ms: 2000 },
  { key: 'float', label: 'Float', ms: 3000 },
  { key: 'swing', label: 'Swing', ms: 2500 },
  { key: 'zoom', label: 'Slow zoom', ms: 12000 },
  { key: 'blink', label: 'Blink', ms: 1600 },
]
const IN_KEYS = new Set(ANIM_IN.map(a => a.key))
const LOOP_MS = Object.fromEntries(ANIM_LOOP.map(a => [a.key, a.ms]))

// How a playlist moves to the next board (screen_playlist_items.transition).
export const TRANSITIONS = [
  { key: 'none', label: 'Cut' },
  { key: 'fade', label: 'Fade' },
  { key: 'slide_left', label: 'Slide in from the right' },
  { key: 'slide_right', label: 'Slide in from the left' },
  { key: 'slide_up', label: 'Slide up' },
  { key: 'slide_down', label: 'Slide down' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'wipe', label: 'Wipe' },
]
export const TRANSITION_KEYS = TRANSITIONS.map(t => t.key)
export const DEFAULT_TRANSITION_MS = 800

// Fonts boards can use: the website's list plus a few bold menu-board faces.
// Kept here so the website builder's lists don't change.
export const SCREEN_FONT_WEIGHTS = {
  ...FONT_WEIGHTS,
  'Oswald':           '300;400;500;600;700',
  'Bebas Neue':       '400',
  'Anton':            '400',
  'Barlow Condensed': '300;400;500;600;700;800',
  'Archivo Black':    '400',
  'Pacifico':         '400',
  'Permanent Marker': '400',
}
export const SCREEN_FONT_OPTIONS = [
  ...FONT_OPTIONS, 'Oswald', 'Bebas Neue', 'Anton', 'Barlow Condensed', 'Archivo Black', 'Pacifico', 'Permanent Marker',
]
const SERIF = new Set(['Fraunces', 'Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display', 'Cormorant Garamond', 'Libre Baskerville'])
const SCRIPT = new Set(['Caveat', 'Pacifico', 'Permanent Marker'])

export function screenFontStack(name) {
  const generic = SCRIPT.has(name) ? 'cursive' : SERIF.has(name) ? 'serif' : 'sans-serif'
  return "'" + name + "', " + generic
}

export const DEFAULT_BOARD = {
  background: '#141414', background_image: '', background_fit: 'cover',
  text_color: '#ffffff', accent_color: '#f5b301', muted_color: '#bdbdbd',
  font_body: 'Inter', font_heading: 'Oswald', font_script: 'Caveat',
  price_symbol: true, price_whole: false, sold_out_text: 'Sold out', grid: 10,
  replay_secs: 0, guide_cols: 1, guide_rows: 1, guide_gap: 0,
}

// A new block's size (as a share of the board) and options.
export const BLOCK_DEFAULTS = {
  heading: { w: 0.5, h: 0.12, opts: { text: 'Heading', size: 96, font: 'heading', weight: 700, align: 'left', valign: 'middle', upper: true } },
  text: { w: 0.4, h: 0.15, opts: { text: 'Some text', size: 36, font: 'body', weight: 400, align: 'left', valign: 'top' } },
  menu: {
    w: 0.32, h: 0.6,
    opts: {
      source: 'section', menu_id: null, section_id: null, item_ids: [], show_title: true, title: '',
      columns: 1, show_desc: true, show_cal: false, show_tags: true, show_options: true, leaders: false,
      sold_out: 'mark', title_size: 56, name_size: 36, price_size: 36, desc_size: 22, gap: 18,
      combo_view: 'menu',
    },
  },
  dish: {
    w: 0.3, h: 0.6,
    opts: {
      menu_id: null, item_id: null, layout: 'stack', show_image: true, image_share: 60, show_desc: true,
      show_tags: true, show_price: true, sold_out: 'mark', name_size: 56, price_size: 64, desc_size: 26, align: 'left',
      combo_view: 'menu',
    },
  },
  price: { w: 0.22, h: 0.1, opts: { menu_id: null, item_id: null, option: '', size: 80, font: 'heading', weight: 700, align: 'center', valign: 'middle', show_name: false, from_text: 'from', sold_out: 'mark' } },
  image: { w: 0.3, h: 0.3, opts: { url: '', fit: 'cover', radius: 0 } },
  video: { w: 0.4, h: 0.4, opts: { url: '', fit: 'cover', radius: 0, loop: true, sound: false } },
  ticker: {
    w: 1, h: 0.08,
    opts: { text: 'Ask about today\'s specials', size: 48, font: 'heading', weight: 600, speed: 120, gap: 160, direction: 'left', bg: '', bg_alpha: 100 },
  },
  box: { w: 0.3, h: 0.3, opts: { color: '#000000', alpha: 50, radius: 12, border_width: 0, border_color: '#ffffff' } },
  clock: { w: 0.18, h: 0.08, opts: { format: '24', show_date: false, size: 48, font: 'body', weight: 600, align: 'right', valign: 'middle' } },
  allergen_key: { w: 0.5, h: 0.08, opts: { size: 22, show_notice: false, align: 'left' } },
  order_status: {
    w: 0.6, h: 0.8,
    opts: {
      board: '', show_preparing: true, preparing_title: 'Preparing', ready_title: 'Ready', title_size: 56, number_size: 72,
      columns: 1, max: 12, clear_mins: 10, show_names: false, layout: 'side', ready_first: false,
      change_anim: 'none', change_ms: 900,
      title_color: '', ready_bg: '#2e8b57', ready_color: '#ffffff', preparing_color: '', preparing_bg: '',
    },
  },
}

// ── Small helpers ───────────────────────────────────────────

function num(v, lo, hi, dflt) {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function safeUrl(u) {
  const s = String(u || '').trim()
  if (/^https?:\/\//i.test(s) || (s.startsWith('/') && !s.startsWith('//'))) return s
  return ''
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
export function colour(v, dflt) {
  return typeof v === 'string' && (HEX.test(v) || v === 'transparent') ? v : dflt
}

function knownFont(v, dflt) { return SCREEN_FONT_WEIGHTS[v] ? v : dflt }

// A hex colour with an opacity (0-100) as rgba().
export function withAlpha(hex, alpha) {
  const h = colour(hex, '#000000')
  if (h === 'transparent') return 'transparent'
  let r, g, b
  if (h.length === 4) { r = parseInt(h[1] + h[1], 16); g = parseInt(h[2] + h[2], 16); b = parseInt(h[3] + h[3], 16) }
  else { r = parseInt(h.slice(1, 3), 16); g = parseInt(h.slice(3, 5), 16); b = parseInt(h.slice(5, 7), 16) }
  return 'rgba(' + r + ',' + g + ',' + b + ',' + (num(alpha, 0, 100, 100) / 100) + ')'
}

function styleString(style) {
  return Object.entries(style).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + ':' + v).join(';')
}

// React style objects want camelCase names; custom properties stay as is.
export function toReactStyle(style) {
  const out = {}
  for (const [k, v] of Object.entries(style)) {
    if (v == null || v === '') continue
    out[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v
  }
  return out
}

// ── Board ───────────────────────────────────────────────────

/** The layout with every setting filled in and blocks cleaned up. */
export function normalizeBoard(layout, width = 1920, height = 1080) {
  const l = layout || {}
  const W = num(width, MIN_SIZE, MAX_SIZE, 1920)
  const H = num(height, MIN_SIZE, MAX_SIZE, 1080)
  const blocks = (Array.isArray(l.blocks) ? l.blocks : []).slice(0, MAX_BLOCKS)
    .filter(b => b && BLOCK_TYPES.includes(b.type))
    .map((b, i) => {
      const w = Math.round(num(b.w, 4, W, 200))
      const h = Math.round(num(b.h, 4, H, 100))
      return {
        id: typeof b.id === 'string' && b.id ? b.id.slice(0, 40) : 'b' + i,
        type: b.type,
        x: Math.round(num(b.x, -W, W, 0)), y: Math.round(num(b.y, -H, H, 0)), w, h,
        opts: b.opts && typeof b.opts === 'object' && !Array.isArray(b.opts) ? b.opts : {},
      }
    })
  return {
    width: W, height: H,
    background: colour(l.background, DEFAULT_BOARD.background),
    background_image: safeUrl(l.background_image),
    background_fit: ['cover', 'contain', 'fill'].includes(l.background_fit) ? l.background_fit : 'cover',
    text_color: colour(l.text_color, DEFAULT_BOARD.text_color),
    accent_color: colour(l.accent_color, DEFAULT_BOARD.accent_color),
    muted_color: colour(l.muted_color, DEFAULT_BOARD.muted_color),
    font_body: knownFont(l.font_body, DEFAULT_BOARD.font_body),
    font_heading: knownFont(l.font_heading, DEFAULT_BOARD.font_heading),
    font_script: knownFont(l.font_script, DEFAULT_BOARD.font_script),
    price_symbol: l.price_symbol !== false,
    price_whole: !!l.price_whole,
    sold_out_text: typeof l.sold_out_text === 'string' ? l.sold_out_text.slice(0, 40) : DEFAULT_BOARD.sold_out_text,
    grid: Math.round(num(l.grid, 1, 200, DEFAULT_BOARD.grid)),
    replay_secs: Math.round(num(l.replay_secs, 0, 3600, 0)),
    guide_cols: Math.round(num(l.guide_cols, 1, 6, 1)),
    guide_rows: Math.round(num(l.guide_rows, 1, 6, 1)),
    guide_gap: Math.round(num(l.guide_gap, 0, 400, 0)),
    blocks,
  }
}

/** Menus a board's blocks point at (to load their live versions). */
export function boardMenuIds(layout) {
  const ids = new Set()
  for (const b of (layout?.blocks || [])) {
    const id = b?.opts?.menu_id
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) ids.add(id)
  }
  return [...ids]
}

/** Images a board shows (for the player to load before it switches). */
export function boardImageUrls(layout, ctx) {
  const urls = new Set()
  const l = layout || {}
  if (safeUrl(l.background_image)) urls.add(safeUrl(l.background_image))
  for (const b of (l.blocks || [])) {
    const o = b.opts || {}
    if (b.type === 'image' && safeUrl(o.url)) urls.add(safeUrl(o.url))
    if (b.type === 'dish' && o.show_image !== false && ctx) {
      const it = ctx.itemsById[o.item_id]
      if (it && safeUrl(it.image_url)) urls.add(safeUrl(it.image_url))
    }
  }
  return [...urls]
}

/** Videos a board plays (for the player to keep on the device). */
export function boardVideoUrls(layout) {
  const urls = new Set()
  for (const b of (layout?.blocks || [])) {
    if (b?.type === 'video' && safeUrl(b.opts?.url)) urls.add(safeUrl(b.opts.url))
  }
  return [...urls]
}

/** The longest video on a board, in whole seconds (0 when none or unknown). */
export function boardVideoSeconds(layout) {
  let max = 0
  for (const b of (layout?.blocks || [])) {
    if (b?.type === 'video' && Number(b.opts?.duration) > 0) max = Math.max(max, Number(b.opts.duration))
  }
  return Math.ceil(max)
}

/** Fonts a board uses, for one Google Fonts stylesheet. */
export function boardFonts(layout) {
  const l = normalizeBoard(layout)
  const out = new Set([l.font_body, l.font_heading, l.font_script])
  for (const b of l.blocks) {
    if (SCREEN_FONT_WEIGHTS[b.opts.font]) out.add(b.opts.font)
  }
  return [...out]
}

export function screenFontsUrl(names) {
  const list = [...new Set(names || [])].filter(n => SCREEN_FONT_WEIGHTS[n])
  if (!list.length) return null
  return 'https://fonts.googleapis.com/css2?' + list.map(n =>
    'family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@' + SCREEN_FONT_WEIGHTS[n]
  ).join('&') + '&display=swap'
}

export function boardFontsUrl(layout) { return screenFontsUrl(boardFonts(layout)) }

// ── Data ────────────────────────────────────────────────────

/**
 * What a board's blocks read: data = { menus: [live menu], sold_out: [item
 * id], tags, allergen_notice, now (Date), tz }. Sections hidden everywhere
 * are left out; tags shown on menus only (migration 146).
 */
export function boardContext(layout, data = {}) {
  const menusById = {}
  const sectionsById = {}
  const itemsById = {}
  const menuOfItem = {}
  let tags = data.tags || null
  for (const m of data.menus || []) {
    menusById[m.id] = m
    if (!tags && m.dietary_tags) tags = m.dietary_tags
    for (const s of m.sections || []) {
      if ((s.visibility || 'show') === 'hidden') continue
      sectionsById[s.id] = s
      for (const it of s.items || []) {
        if (!itemsById[it.id]) { itemsById[it.id] = it; menuOfItem[it.id] = m }
      }
    }
  }
  const shown = menuTags(tags || [])
  const ctx = {
    menusById, sectionsById, itemsById, menuOfItem,
    tags: shown,
    tagsByCode: Object.fromEntries(shown.map(t => [t.code, t])),
    notice: data.allergen_notice || (data.menus || [])[0]?.allergen_notice || null,
    soldOut: new Set(data.sold_out || []),
    now: data.now || new Date(),
    tz: data.tz || 'Europe/London',
    // still: thumbnails (videos show a frame, nothing plays)
    still: !!data.still,
    // Order status block: { preparing: [{ number, name }], ready: [{ number, name, at }],
    // boards: { [board name, lower case]: { preparing, ready } } } from the
    // kitchen screens (services/kitchenSvc.js boardFor()); null in the
    // designer, which shows example numbers.
    orders: data.orders || null,
    board: normalizeBoard(layout, data.width, data.height),
  }
  ctx.shownItems = shownItems(ctx.board, ctx)
  return ctx
}

// Dishes a menu block lists, in order (sold out ones left out when the block hides them).
function menuBlockItems(o, ctx) {
  if (o.source === 'dishes') {
    return (Array.isArray(o.item_ids) ? o.item_ids : []).map(id => ctx.itemsById[id]).filter(Boolean)
  }
  const s = ctx.sectionsById[o.section_id]
  return s ? (s.items || []) : null
}

function shownItems(board, ctx) {
  const out = new Map()
  for (const b of board.blocks) {
    const o = b.opts || {}
    if (b.type === 'menu') {
      for (const it of (menuBlockItems(o, ctx) || [])) {
        if (o.sold_out === 'hide' && ctx.soldOut.has(it.id)) continue
        out.set(it.id, it)
      }
    } else if ((b.type === 'dish' || b.type === 'price') && ctx.itemsById[o.item_id]) {
      out.set(o.item_id, ctx.itemsById[o.item_id])
    }
  }
  return [...out.values()]
}

// ── Prices ──────────────────────────────────────────────────

export function formatPrice(pence, board) {
  if (pence == null || !Number.isFinite(Number(pence))) return ''
  const p = Number(pence) / 100
  const whole = board?.price_whole && Number(pence) % 100 === 0
  return (board?.price_symbol === false ? '' : '£') + (whole ? String(Math.round(p)) : p.toFixed(2))
}

// The options of a dish, as the menu shows them (the menu's own "hide
// unpriced / hide £0" settings apply, as on the website and printed menu).
function dishOptions(item, menu) {
  const rules = variantRules(menu)
  return itemChoices(item, rules)
}

/** Price text for a dish: its price, "from £x" when it has options, '' when none. */
export function dishPriceText(item, menu, board, { option = '', fromText = 'from' } = {}) {
  // A combo (shared/combos.js): its cheapest price, "from" when its choices can cost more.
  if (item.kind === 'combo') {
    const c = comboMenuPrice(item, menu)
    if (c.pence == null) return ''
    return (c.from && fromText ? fromText + ' ' : '') + formatPrice(c.pence, board)
  }
  const choices = dishOptions(item, menu)
  if (option) {
    for (const c of choices) {
      const o = c.options.find(x => x.label === option)
      if (o) {
        const p = c.mode === 'extra' ? (item.price_pence ?? 0) + (o.price_pence ?? 0) : (o.price_pence ?? item.price_pence)
        return formatPrice(p, board)
      }
    }
  }
  const base = choices.filter(c => c.mode === 'base' && c.options.length > 1)
  const p = fromPrice(item, choices)
  if (p == null) return ''
  return (base.length && fromText ? fromText + ' ' : '') + formatPrice(p, board)
}

/** Option labels of a dish (for the Price block's option picker). */
export function dishOptionLabels(item, menu) {
  return dishOptions(item, menu).flatMap(c => c.options.map(o => o.label))
}

// "Small £3.00 · Large £4.50" (each choice on its own line when there are several).
function optionsHtml(item, menu, board) {
  const choices = dishOptions(item, menu)
  if (!choices.length) return ''
  return choices.map(c => {
    const parts = c.options.map(o => {
      const p = o.price_pence
      const zero = p == null || (Number(p) === 0 && (c.mode === 'extra' || c.hide_zero_price))
      const text = zero ? '' : (c.mode === 'extra' ? '+' : '') + formatPrice(p, board)
      return '<span class="sl-opt">' + esc(o.label) + (text ? ' <span class="sl-opt-price">' + esc(text) + '</span>' : '') + '</span>'
    })
    const name = choices.length > 1 && c.name && c.key !== 'variants' ? '<span class="sl-opt-name">' + esc(c.name) + '</span> ' : ''
    return '<div class="sl-opts">' + name + parts.join('<span class="sl-dot">·</span>') + '</div>'
  }).join('')
}

function hasBaseOptions(item, menu) {
  return dishOptions(item, menu).some(c => c.mode === 'base')
}

function tagsHtml(item, ctx) {
  const chips = (item.dietary || []).map(code => ctx.tagsByCode[code]).filter(Boolean).map(t =>
    '<span class="sl-tag" style="background:' + esc(colour(t.colour, '#555555')) + '">' + esc(t.glyph || t.code) +
    (isRemovable(item, t.code) ? '<sup>*</sup>' : '') + '</span>')
  return chips.length ? '<span class="sl-tags">' + chips.join('') + '</span>' : ''
}

// ── Times ───────────────────────────────────────────────────

/** Venue-local { date: 'YYYY-MM-DD', dow: 0-6 (Sunday 0), minutes } for a moment. */
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  })
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]))
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  const hour = Number(p.hour) % 24
  return { date: p.year + '-' + p.month + '-' + p.day, dow, minutes: hour * 60 + Number(p.minute) }
}

const toMins = t => {
  const [h, m] = String(t || '').slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
// An end of 23:59 means "until midnight" (a time input can't say 24:00).
const endMins = t => (String(t || '').slice(0, 5) === '23:59' ? 1440 : toMins(t))

/**
 * Is a playlist board on at these local parts? Same schedule shape as
 * online-ordering menu times (shared/menuSchedule.js), but a time window's
 * end is NOT included, so Lunch 11:00-15:00 hands over to Dinner 15:00-22:00
 * at 15:00 without both showing. No schedule = always on.
 */
export function boardOnAt(s, { date, dow, minutes }) {
  if (!s || (!s.from && !s.until && !(Array.isArray(s.times) && s.times.length))) return true
  if (s.from && date < s.from) return false
  if (s.until && date > s.until) return false
  if (!s.times?.length) return true
  return s.times.some(t => (t.days || []).includes(dow) && minutes >= toMins(t.start) && minutes < endMins(t.end))
}

/** The playlist items on now, in order. */
export function itemsOnAt(items, parts) {
  return (items || []).filter(i => boardOnAt(i.schedule, parts))
}

const itemMs = i => Math.max(3, Number(i?.duration_secs) || 15) * 1000

/**
 * Which of the boards on now is showing at `nowMs`, worked out from the
 * clock alone (the boards take turns from 1 January 1970), so every
 * screen with the same playlist, a wall's screens above all, shows the
 * same board at the same moment without talking to each other.
 * { index, startMs, endMs } or null for an empty list.
 */
export function playlistPosition(list, nowMs) {
  if (!list?.length) return null
  const total = list.reduce((s, i) => s + itemMs(i), 0)
  const into = ((nowMs % total) + total) % total
  let at = 0
  for (let index = 0; index < list.length; index++) {
    const len = itemMs(list[index])
    if (into < at + len) {
      const startMs = nowMs - (into - at)
      return { index, startMs, endMs: startMs + len }
    }
    at += len
  }
  return { index: 0, startMs: nowMs, endMs: nowMs + itemMs(list[0]) }
}

/**
 * When a board's block animations last started: every `replay_secs` on
 * the clock (so a wall's screens replay together), else when it came on.
 */
export function replayStart(board, shownAtMs, nowMs) {
  const every = Number(board?.replay_secs) * 1000
  if (!every) return shownAtMs
  return Math.max(shownAtMs, Math.floor(nowMs / every) * every)
}

/**
 * The part of a board one screen of a wall shows: the board split into
 * cols x rows equal parts with `gap` pixels between them (the screens'
 * bezels, hidden behind the frames). wall = { cols, rows, col, row, gap }.
 */
export function wallRegion(width, height, wall) {
  if (!wall || !(wall.cols > 1 || wall.rows > 1)) return { x: 0, y: 0, w: width, h: height }
  const cols = Math.max(1, wall.cols | 0), rows = Math.max(1, wall.rows | 0)
  const gap = Math.max(0, Number(wall.gap) || 0)
  const w = Math.max(1, (width - gap * (cols - 1)) / cols)
  const h = Math.max(1, (height - gap * (rows - 1)) / rows)
  const col = Math.min(cols - 1, Math.max(0, wall.col | 0))
  const row = Math.min(rows - 1, Math.max(0, wall.row | 0))
  return { x: col * (w + gap), y: row * (h + gap), w, h }
}

/** The size a board for a wall should be: its screens' size times the grid, plus the gaps. */
export function wallBoardSize(screenW, screenH, cols, rows, gap = 0) {
  return {
    width: Math.min(MAX_SIZE, screenW * cols + gap * (cols - 1)),
    height: Math.min(MAX_SIZE, screenH * rows + gap * (rows - 1)),
  }
}

/**
 * Web Animations keyframes for a playlist moving to the next board, in the
 * board's own pixels (a wall's screens each show part of the same moving
 * board, so a slide crosses the whole wall). { in, out } (out may be null:
 * the old board just stays under the new one until it is removed).
 */
export function transitionFrames(kind, width, height) {
  const W = width + 'px', H = height + 'px'
  switch (kind) {
    case 'fade': return { in: [{ opacity: 0 }, { opacity: 1 }], out: null }
    case 'slide_left': return { in: [{ transform: 'translateX(' + W + ')' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateX(-' + W + ')' }] }
    case 'slide_right': return { in: [{ transform: 'translateX(-' + W + ')' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateX(' + W + ')' }] }
    case 'slide_up': return { in: [{ transform: 'translateY(' + H + ')' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateY(-' + H + ')' }] }
    case 'slide_down': return { in: [{ transform: 'translateY(-' + H + ')' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateY(' + H + ')' }] }
    case 'zoom': return { in: [{ opacity: 0, transform: 'scale(1.15)' }, { opacity: 1, transform: 'none' }], out: [{ opacity: 1 }, { opacity: 0 }] }
    case 'wipe': return { in: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], out: null }
    default: return null
  }
}

/** Clock text for a clock block. */
export function clockText(opts, now, tz) {
  const o = opts || {}
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London', hour: o.format === '12' ? 'numeric' : '2-digit', minute: '2-digit', hour12: o.format === '12',
  }).format(now).replace(/\s?(am|pm)$/i, (_, a) => ' ' + a.toLowerCase())
  if (!o.show_date) return time
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(now)
  return date + ' · ' + time
}

// ── Blocks ──────────────────────────────────────────────────

const FONT_ROLES = { body: '--sl-body', heading: '--sl-heading', script: '--sl-script' }
function fontFamily(f) {
  if (FONT_ROLES[f]) return 'var(' + FONT_ROLES[f] + ')'
  if (SCREEN_FONT_WEIGHTS[f]) return screenFontStack(f)
  return null
}

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }
const ALIGNS = ['left', 'center', 'right']

/** Absolute position (px) of a block, its stacking order and its text settings. */
export function blockStyle(block, index = 0) {
  const o = block.opts || {}
  const s = {
    left: block.x + 'px', top: block.y + 'px', width: block.w + 'px', height: block.h + 'px',
    'z-index': String(index + 1),
  }
  if (ALIGNS.includes(o.align)) s['text-align'] = o.align
  if (VALIGN[o.valign]) s['justify-content'] = VALIGN[o.valign]
  if (o.opacity != null && o.opacity !== '' && Number(o.opacity) < 100) s.opacity = String(num(o.opacity, 0, 100, 100) / 100)
  if (o.rotate) s.transform = 'rotate(' + num(o.rotate, -180, 180, 0) + 'deg)'
  return s
}

function textStyle(o, dflt) {
  return styleString({
    'font-family': fontFamily(o.font || dflt.font),
    'font-size': num(o.size, 6, 1200, dflt.size) + 'px',
    'font-weight': String(num(o.weight, 100, 900, dflt.weight)),
    color: o.color ? colour(o.color, null) : null,
    'font-style': o.italic ? 'italic' : null,
    'text-transform': o.upper ? 'uppercase' : null,
    'letter-spacing': o.spacing ? (num(o.spacing, -20, 100, 0) / 100) + 'em' : null,
    'line-height': o.line_height ? String(num(o.line_height, 0.6, 3, 1.2)) : null,
  })
}

function textHtml(text) {
  return esc(text).replace(/\n/g, '<br>')
}

function soldOutHtml(ctx) {
  return '<span class="sl-sold">' + esc(ctx.board.sold_out_text || 'Sold out') + '</span>'
}

// A combo's steps, numbered like a how-to: "1 Choose your main: Burger,
// Veggie burger (+£1.00)". Shown when a block's combo_view is 'steps'.
function comboStepsHtml(it, menu, board) {
  const guide = comboGuide(it, menuCtx(menu))
  if (!guide.length) return ''
  return '<ol class="sl-steps">' + guide.map((g, i) => '<li class="sl-step"><span class="sl-step-n">' + (i + 1) + '</span><span class="sl-step-body">' +
    '<span class="sl-step-name">' + esc(g.name) + '</span> <span class="sl-step-rule">' + esc(g.rule + (g.when ? ' · ' + g.when : '')) + '</span>' +
    '<span class="sl-step-opts">' + g.options.map(op => esc(op.label) + (op.price_pence ? ' <span class="sl-step-up">+' + esc(formatPrice(op.price_pence, board)) + '</span>' : '')).join(' · ') + '</span>' +
    '</span></li>').join('') + '</ol>'
}

function menuItemHtml(it, o, ctx) {
  const menu = ctx.menuOfItem[it.id]
  const sold = ctx.soldOut.has(it.id)
  const steps = it.kind === 'combo' && o.combo_view === 'steps'
  const withOptions = it.kind !== 'combo' && o.show_options !== false && hasBaseOptions(it, menu)
  const price = sold ? soldOutHtml(ctx) : withOptions ? '' : esc(dishPriceText(it, menu, ctx.board))
  let h = '<div class="sl-item' + (sold ? ' is-sold' : '') + '"><div class="sl-row"><span class="sl-name">' + esc(it.name) +
    (o.show_tags !== false ? tagsHtml(it, ctx) : '') + '</span>'
  if (price) h += (o.leaders ? '<span class="sl-lead"></span>' : '<span class="sl-gap"></span>') + '<span class="sl-price">' + price + '</span>'
  h += '</div>'
  if (o.show_desc !== false && it.description) h += '<div class="sl-desc">' + esc(it.description) + '</div>'
  if (o.show_cal && it.calories != null) h += '<div class="sl-cal">' + esc(it.calories) + ' kcal</div>'
  if (withOptions && !sold) h += optionsHtml(it, menu, ctx.board)
  if (steps && !sold) h += comboStepsHtml(it, menu, ctx.board)
  return h + '</div>'
}

/**
 * Inner HTML of one block. null = what it points at isn't in the live
 * menus (the designer explains; the player leaves the space empty).
 */
export function renderBlockInner(block, ctx) {
  const o = block.opts || {}
  const board = ctx.board
  switch (block.type) {
    case 'heading':
      return o.text ? '<div class="sl-text" style="' + textStyle(o, { font: 'heading', size: 96, weight: 700 }) + '">' + textHtml(o.text) + '</div>' : ''
    case 'text':
      return o.text ? '<div class="sl-text" style="' + textStyle(o, { font: 'body', size: 36, weight: 400 }) + '">' + textHtml(o.text) + '</div>' : ''
    case 'image': {
      const url = safeUrl(o.url)
      if (!url) return ''
      const fit = ['cover', 'contain', 'fill'].includes(o.fit) ? o.fit : 'cover'
      return '<img class="sl-img" alt="" src="' + esc(url) + '" style="object-fit:' + fit + ';border-radius:' + num(o.radius, 0, 2000, 0) + 'px" />'
    }
    case 'video': {
      const url = safeUrl(o.url)
      if (!url) return ''
      const fit = ['cover', 'contain', 'fill'].includes(o.fit) ? o.fit : 'cover'
      const loop = o.loop !== false
      // Always muted to start (browsers only play muted video by themselves);
      // the player turns the sound on when the block asks for it and the
      // device allows it. Thumbnails show a frame and play nothing.
      const attrs = ctx.still
        ? ' preload="metadata"'
        : ' autoplay preload="auto"' + (loop ? ' loop' : '')
      return '<video class="sl-video" muted playsinline disablepictureinpicture' + attrs +
        ' data-sl-video="' + esc(JSON.stringify({ loop, sound: !!o.sound })) + '"' +
        ' src="' + esc(url + (ctx.still ? '#t=0.5' : '')) + '" style="object-fit:' + fit + ';border-radius:' + num(o.radius, 0, 2000, 0) + 'px"></video>'
    }
    case 'ticker': {
      const text = String(o.text || '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      const size = num(o.size, 6, 1200, 48)
      const speed = num(o.speed, 10, 2000, 120)
      const gap = num(o.gap, 0, 4000, 160)
      // Enough copies to cover the block while one slides out; the player
      // and the designer measure the real width (startBoardMotion()).
      const est = Math.max(1, text.length * size * 0.55 + gap)
      const copies = Math.min(40, Math.max(2, Math.ceil(block.w / est) + 1))
      const item = '<span class="sl-tk-item" style="padding-right:' + gap + 'px">' + esc(text) + '</span>'
      const bg = o.bg ? withAlpha(o.bg, o.bg_alpha ?? 100) : null
      return '<div class="sl-ticker" style="' + styleString({ background: bg }) + ';' + textStyle(o, { font: 'heading', size: 48, weight: 600 }) + '">' +
        '<div class="sl-tk-track' + (o.direction === 'right' ? ' sl-tk-right' : '') + '" data-sl-ticker="' + speed + '" style="' +
        styleString({ '--sl-tks': (-100 / copies) + '%', '--sl-tkd': (est / speed).toFixed(2) + 's' }) + '">' +
        item.repeat(copies) + '</div></div>'
    }
    case 'box':
      return '<div class="sl-box" style="' + styleString({
        background: withAlpha(o.color || '#000000', o.alpha ?? 100),
        'border-radius': num(o.radius, 0, 4000, 0) + 'px',
        border: Number(o.border_width) > 0 ? num(o.border_width, 0, 200, 0) + 'px solid ' + colour(o.border_color, '#ffffff') : null,
      }) + '"></div>'
    case 'clock':
      return '<div class="sl-text" data-sl-clock="' + esc(JSON.stringify({ format: o.format === '12' ? '12' : '24', show_date: !!o.show_date })) + '" style="' +
        textStyle(o, { font: 'body', size: 48, weight: 600 }) + '">' + esc(clockText(o, ctx.now, ctx.tz)) + '</div>'
    case 'menu': {
      const items = menuBlockItems(o, ctx)
      if (!ctx.menusById[o.menu_id] || !items) return null
      const list = o.sold_out === 'hide' ? items.filter(it => !ctx.soldOut.has(it.id)) : items
      const section = o.source === 'dishes' ? null : ctx.sectionsById[o.section_id]
      const title = (o.title || '').trim() || (section ? section.title : '')
      const vars = styleString({
        '--t': num(o.title_size, 6, 600, 56) + 'px', '--n': num(o.name_size, 6, 400, 36) + 'px',
        '--p': num(o.price_size, 6, 400, 36) + 'px', '--d': num(o.desc_size, 6, 300, 22) + 'px',
        '--g': num(o.gap, 0, 400, 18) + 'px',
        '--ct': o.title_color ? colour(o.title_color, null) : null, '--cn': o.name_color ? colour(o.name_color, null) : null,
        '--cp': o.price_color ? colour(o.price_color, null) : null, '--cd': o.desc_color ? colour(o.desc_color, null) : null,
      })
      const cols = Math.round(num(o.columns, 1, 6, 1))
      let h = '<div class="sl-menu" style="' + vars + '">'
      if (o.show_title !== false && title) h += '<div class="sl-title">' + esc(title) + '</div>'
      h += '<div class="sl-list" style="column-count:' + cols + '">' + list.map(it => menuItemHtml(it, o, ctx)).join('') + '</div>'
      return h + '</div>'
    }
    case 'dish': {
      const it = ctx.itemsById[o.item_id]
      if (!it || !ctx.menusById[o.menu_id]) return null
      const menu = ctx.menuOfItem[it.id]
      const sold = ctx.soldOut.has(it.id)
      if (sold && o.sold_out === 'hide') return ''
      const img = o.show_image !== false && safeUrl(it.image_url)
      const vars = styleString({
        '--n': num(o.name_size, 6, 600, 56) + 'px', '--p': num(o.price_size, 6, 600, 64) + 'px', '--d': num(o.desc_size, 6, 300, 26) + 'px',
        '--img': num(o.image_share, 10, 90, 60) + '%',
        '--cn': o.name_color ? colour(o.name_color, null) : null, '--cp': o.price_color ? colour(o.price_color, null) : null,
        '--cd': o.desc_color ? colour(o.desc_color, null) : null,
      })
      let h = '<div class="sl-dish sl-dish-' + (o.layout === 'side' ? 'side' : 'stack') + (sold ? ' is-sold' : '') + '" style="' + vars + '">'
      if (img) h += '<div class="sl-dish-img"><img alt="" src="' + esc(img) + '" style="object-fit:' + (o.image_fit === 'contain' ? 'contain' : 'cover') + '" /></div>'
      h += '<div class="sl-dish-body"><div class="sl-dish-name">' + esc(it.name) + (o.show_tags !== false ? tagsHtml(it, ctx) : '') + '</div>'
      if (o.show_desc !== false && it.description) h += '<div class="sl-desc">' + esc(it.description) + '</div>'
      if (o.show_price !== false) h += '<div class="sl-dish-price">' + (sold ? soldOutHtml(ctx) : esc(dishPriceText(it, menu, board))) + '</div>'
      if (it.kind === 'combo' && o.combo_view === 'steps' && !sold) h += comboStepsHtml(it, menu, board)
      return h + '</div></div>'
    }
    case 'price': {
      const it = ctx.itemsById[o.item_id]
      if (!it || !ctx.menusById[o.menu_id]) return null
      const sold = ctx.soldOut.has(it.id)
      if (sold && o.sold_out === 'hide') return ''
      const text = sold ? soldOutHtml(ctx) : '<span class="sl-pfig">' + esc(dishPriceText(it, ctx.menuOfItem[it.id], board, { option: o.option || '', fromText: o.from_text ?? 'from' })) + '</span>'
      return '<div class="sl-text' + (sold ? ' is-sold' : '') + '" style="' + textStyle(o, { font: 'heading', size: 80, weight: 700 }) + '">' +
        (o.show_name ? '<span class="sl-pname">' + esc(it.name) + '</span>' : '') + text + '</div>'
    }
    case 'allergen_key': {
      const k = allergenKey(ctx.tags, [{ items: ctx.shownItems }], ctx.notice)
      if (!k.tags.length && !k.removable && !o.show_notice) return ''
      let h = '<div class="sl-key" style="font-size:' + num(o.size, 6, 200, 22) + 'px' + (o.color ? ';color:' + colour(o.color, '') : '') + '">'
      if (o.show_notice && (k.title || k.body)) h += '<div class="sl-key-notice">' + (k.title ? '<strong>' + esc(k.title) + '</strong> ' : '') + esc(k.body || '') + '</div>'
      h += k.tags.map(t => '<span class="sl-pair"><span class="sl-tag" style="background:' + esc(colour(t.colour, '#555555')) + '">' +
        esc(t.glyph || t.code) + '</span>' + esc(t.label) + '</span>').join('')
      if (k.removable) h += '<span class="sl-pair">* ' + esc(k.removable_note) + '</span>'
      return h + '</div>'
    }
    case 'order_status':
      return orderStatusHtml(o, ctx)
    default:
      return ''
  }
}

const SAMPLE_ORDERS = {
  preparing: [{ id: 's57', number: '57' }, { id: 's58', number: '58', name: 'Sam' }, { id: 's61', number: '61' }],
  ready: [{ id: 's54', number: '54', name: 'Alex' }, { id: 's55', number: '55' }],
}

// Order status block: how a number moves when its status changes.
export const ORDER_CHANGE_ANIMS = [
  { key: 'none', label: 'No animation' },
  { key: 'float', label: 'Float over' },
  { key: 'fade', label: 'Fade out and in' },
  { key: 'pop', label: 'Pop out and in' },
  { key: 'zoom', label: 'Zoom out and in' },
]
const CHANGE_KEYS = new Set(ORDER_CHANGE_ANIMS.map(a => a.key))
// How long the player keeps a change (longer than the longest animation).
export const ORDER_CHANGE_KEEP_MS = 3500

/** The numbers for one Order status block: its board (opts.board, a board
 *  station's name in the kitchen flow) or every counter and online order. */
export function orderBoardData(orders, boardName) {
  if (!orders) return null
  const key = String(boardName || '').trim().toLowerCase()
  if (!key) return orders
  return orders.boards?.[key] || { preparing: [], ready: [] }
}

const boardKeys = orders => ['', ...Object.keys(orders?.boards || {})]

/**
 * What changed between two fetches of the order numbers, per board ('' =
 * every counter and online order): numbers that came onto a column (in) and
 * that left it, with where they were (out, drawn fading in place). The player
 * keeps these for ORDER_CHANGE_KEEP_MS and passes them as orders.changes.
 *   -> [{ key, at, prep_in: [id], ready_in: [id], prep_out: [{ ...number, index }], ready_out: [...] }]
 */
export function orderChanges(prev, next, atMs) {
  if (!prev || !next) return []
  const out = []
  for (const key of boardKeys(next)) {
    const a = orderBoardData(prev, key) || { preparing: [], ready: [] }
    const b = orderBoardData(next, key)
    const ids = list => new Set((list || []).map(x => x.id))
    const diff = (from, to) => (to || []).filter(x => x.id && !ids(from).has(x.id)).map(x => x.id)
    const gone = (from, to) => (from || []).map((x, index) => ({ ...x, index })).filter(x => x.id && !ids(to).has(x.id))
    const c = {
      key, at: atMs,
      prep_in: diff(a.preparing, b.preparing), ready_in: diff(a.ready, b.ready),
      prep_out: gone(a.preparing, b.preparing), ready_out: gone(a.ready, b.ready),
    }
    if (c.prep_in.length || c.ready_in.length || c.prep_out.length || c.ready_out.length) out.push(c)
  }
  return out
}

/** Keep the changes still worth animating. */
export function keepOrderChanges(list, nowMs) {
  return (list || []).filter(c => nowMs - c.at < ORDER_CHANGE_KEEP_MS)
}

/**
 * The order ready board: order numbers being prepared and ready to collect,
 * side by side or one above the other. Ready numbers drop off after
 * clear_mins (or when collected). change_anim moves a number that changes
 * status (orders.changes from the player; in the designer, Play shows one).
 */
function orderStatusHtml(o, ctx) {
  const data = orderBoardData(ctx.orders, o.board) || SAMPLE_ORDERS
  const max = Math.round(num(o.max, 1, 60, 12))
  const clear = num(o.clear_mins, 0, 120, 10)
  const nowMs = (ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now())).getTime()
  let ready = (data.ready || []).filter(x => !ctx.orders || !clear || !x.at || nowMs - Date.parse(x.at) < clear * 60000).slice(0, max)
  let preparing = (data.preparing || []).slice(0, max)
  const cols = Math.round(num(o.columns, 1, 6, 1))
  const stacked = o.layout === 'stacked'
  const readyFirst = !!o.ready_first
  const anim = CHANGE_KEYS.has(o.change_anim) ? o.change_anim : 'none'
  const animMs = num(o.change_ms, 200, 3000, 900)

  // Numbers that changed in the last animMs: coming in (with how far along)
  // and going out (drawn where they were, fading away).
  const into = new Map()
  const outOf = { prep: [], ready: [] }
  if (anim !== 'none') {
    let changes = (ctx.orders?.changes || []).filter(c => c.key === String(o.board || '').trim().toLowerCase())
    if (!ctx.orders && !ctx.still) {
      // Designer Play: 58 is ready, and a new 62 comes in.
      changes = [{ at: nowMs, prep_in: ['s62'], ready_in: ['s58'], prep_out: [{ ...SAMPLE_ORDERS.preparing[1], index: 1 }], ready_out: [] }]
      preparing = [SAMPLE_ORDERS.preparing[0], SAMPLE_ORDERS.preparing[2], { id: 's62', number: '62' }]
      ready = [{ id: 's58', number: '58', name: 'Sam' }, ...SAMPLE_ORDERS.ready]
    }
    for (const c of changes) {
      // A draw in the same millisecond as the change can read a hair earlier
      // (Date drops the fraction of the screen's clock offset): count as 0.
      const t = Math.max(0, nowMs - c.at)
      if (nowMs - c.at < -1000 || t >= animMs) continue
      for (const id of c.prep_in || []) into.set('prep:' + id, t)
      for (const id of c.ready_in || []) into.set('ready:' + id, t)
      for (const x of c.prep_out || []) outOf.prep.push({ ...x, t })
      for (const x of c.ready_out || []) outOf.ready.push({ ...x, t })
    }
  }
  const delay = t => (t ? ' style="animation-delay:-' + Math.round(t) + 'ms"' : '')
  const tile = (x, cls, extra = '', t = 0) => '<div class="sl-onum ' + cls + extra + '"' + delay(t) + '><span>' + esc(x.number) + '</span>' +
    (o.show_names && x.name ? '<span class="sl-oname">' + esc(x.name) + '</span>' : '') + '</div>'
  const column = (title, list, cls, side) => {
    const tiles = list.map(x => {
      const t = into.get(side + ':' + x.id)
      return t == null ? tile(x, cls) : tile(x, cls, ' sl-och-in', t)
    })
    // Leaving numbers stay where they were while they fade (not past the most shown).
    for (const x of outOf[side].sort((p, q) => p.index - q.index)) {
      if (tiles.length >= max + outOf[side].length) break
      tiles.splice(Math.min(x.index, tiles.length), 0, tile(x, cls, ' sl-och-out', x.t))
    }
    return '<div class="sl-ocol ' + cls + '"><div class="sl-otitle">' + esc(title) + '</div><div class="sl-olist">' + tiles.join('') + '</div></div>'
  }
  // Float over: numbers move from the preparing column towards ready.
  const dir = readyFirst ? -1 : 1
  const vars = styleString({
    '--ot': num(o.title_size, 6, 400, 56) + 'px', '--on': num(o.number_size, 6, 600, 72) + 'px', '--oc': cols,
    '--otc': o.title_color ? colour(o.title_color, null) : null,
    '--orb': colour(o.ready_bg, '#2e8b57'), '--orc': colour(o.ready_color, '#ffffff'),
    '--opc': o.preparing_color ? colour(o.preparing_color, null) : null,
    '--opb': o.preparing_bg ? colour(o.preparing_bg, null) : null,
    '--och': animMs + 'ms',
    '--ofx': stacked ? '0px' : (dir * 140) + '%', '--ofy': stacked ? (dir * 140) + '%' : '0px',
  })
  const cls = 'sl-orders' + (ctx.orders ? '' : ' is-sample') + (stacked ? ' is-stacked' : '') + (anim !== 'none' ? ' sl-och-' + anim : '')
  const prep = o.show_preparing !== false ? column(o.preparing_title ?? 'Preparing', preparing, 'is-prep', 'prep') : ''
  const rdy = column(o.ready_title ?? 'Ready', ready, 'is-ready', 'ready')
  return '<div class="' + cls + '" style="' + vars + '">' + (readyFirst ? rdy + prep : prep + rdy) + '</div>'
}

/** The board's own style: size, colours, fonts, background. */
export function boardStyle(board) {
  const b = board
  return {
    width: b.width + 'px', height: b.height + 'px',
    background: b.background,
    'background-image': b.background_image ? 'url("' + b.background_image.replace(/"/g, '%22') + '")' : null,
    'background-size': b.background_image ? (b.background_fit === 'fill' ? '100% 100%' : b.background_fit) : null,
    'background-position': b.background_image ? 'center' : null,
    'background-repeat': b.background_image ? 'no-repeat' : null,
    color: b.text_color,
    '--sl-text': b.text_color, '--sl-accent': b.accent_color, '--sl-muted': b.muted_color,
    '--sl-body': screenFontStack(b.font_body), '--sl-heading': screenFontStack(b.font_heading), '--sl-script': screenFontStack(b.font_script),
  }
}

/**
 * A block's content inside its animation wrappers (only the ones it uses):
 * .sl-in runs the entrance, .sl-loop the movement, so they never fight over
 * `transform` with each other or with the block's own turn (blockStyle()).
 * Used by renderBoardHtml() and by the designer for each block.
 */
export function wrapMotion(block, innerHtml) {
  const o = block.opts || {}
  let html = innerHtml
  const loop = LOOP_MS[o.anim_loop] ? o.anim_loop : null
  if (loop) {
    html = '<div class="sl-loop sl-loop-' + loop + '" style="--sl-ld:' + num(o.anim_loop_ms, 300, 120000, LOOP_MS[loop]) + 'ms">' + html + '</div>'
  }
  const into = IN_KEYS.has(o.anim_in) && o.anim_in !== 'none' ? o.anim_in : null
  if (into) {
    html = '<div class="sl-in sl-in-' + into + '" style="--sl-id:' + num(o.anim_in_ms, 100, 10000, 800) + 'ms;--sl-idl:' +
      num(o.anim_in_delay, 0, 60000, 0) + 'ms">' + html + '</div>'
  }
  return html
}

/** A whole board as HTML (the player). ctx from boardContext(). */
export function renderBoardHtml(ctx) {
  const b = ctx.board
  let blocks = ''
  b.blocks.forEach((block, i) => {
    const inner = renderBlockInner(block, ctx)
    if (inner == null || inner === '') return
    blocks += '<div class="sl-block sl-t-' + block.type + '" style="' + styleString(blockStyle(block, i)) + '">' + wrapMotion(block, inner) + '</div>'
  })
  return '<div class="sl-board" style="' + styleString(boardStyle(b)) + '">' + blocks + '</div>'
}

/**
 * Starts a drawn board's movement (browser only; the player and the
 * designer's Play): sizes each scrolling text to its real width, adds
 * sl-play, and sets every CSS animation's clock so screens agree:
 * entrances from `startMs` (when the board came on, or last replayed),
 * movements from 1 January 1970. Returns the animations it started.
 */
export function startBoardMotion(boardEl, { startMs = Date.now(), nowMs = Date.now() } = {}) {
  if (!boardEl) return []
  for (const track of boardEl.querySelectorAll('.sl-tk-track')) {
    const speed = Number(track.dataset.slTicker) || 120
    const items = track.children.length || 1
    const one = track.scrollWidth / items
    const box = track.parentElement?.clientWidth || 0
    // Add copies until one can slide out without a gap showing.
    let n = items
    while (one > 0 && one * (n - 1) < box && n < 60) { track.appendChild(track.children[0].cloneNode(true)); n++ }
    track.style.setProperty('--sl-tks', (-100 / n) + '%')
    if (one > 0) track.style.setProperty('--sl-tkd', (one / speed).toFixed(3) + 's')
  }
  boardEl.classList.remove('sl-play')
  void boardEl.offsetWidth
  boardEl.classList.add('sl-play')
  const anims = typeof boardEl.getAnimations === 'function' ? boardEl.getAnimations({ subtree: true }) : []
  for (const a of anims) {
    const name = a.animationName || ''
    try {
      if (name.startsWith('sl-in-')) a.currentTime = Math.max(0, nowMs - startMs)
      else if (name.startsWith('sl-loop-')) a.currentTime = nowMs
    } catch { /* not a CSS animation */ }
  }
  return anims
}

/** Stops a board's movement (back to how it was designed). */
export function stopBoardMotion(boardEl) {
  boardEl?.classList.remove('sl-play')
}

export { styleString }

// ── Styles (player and designer) ────────────────────────────

export const SCREEN_LAYOUT_CSS = `
.sl-board { position: relative; overflow: hidden; font-family: var(--sl-body); line-height: 1.2;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
.sl-board *, .sl-board *::before, .sl-board *::after { box-sizing: border-box; margin: 0; padding: 0; }
.sl-block { position: absolute; overflow: hidden; display: flex; flex-direction: column; }
.sl-t-image, .sl-t-box { display: block; }
.sl-text { white-space: normal; overflow-wrap: break-word; }
.sl-img { display: block; width: 100%; height: 100%; max-width: none; }
.sl-box { width: 100%; height: 100%; }
.sl-pname { display: block; font-size: 0.4em; font-weight: 600; opacity: 0.9; }
.sl-pfig { white-space: nowrap; }
.sl-sold { color: var(--sl-accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.sl-text.is-sold .sl-sold { font-size: 0.5em; }

.sl-menu { color: var(--sl-text); }
.sl-title { font-family: var(--sl-heading); font-size: var(--t); font-weight: 700; color: var(--ct, var(--sl-accent));
  text-transform: uppercase; letter-spacing: 0.02em; line-height: 1.05; margin-bottom: calc(var(--g) * 0.8); }
.sl-list { column-gap: 48px; column-fill: auto; }
.sl-item { break-inside: avoid; -webkit-column-break-inside: avoid; padding-bottom: var(--g); }
.sl-row { display: flex; align-items: baseline; gap: 12px; }
.sl-name { font-family: var(--sl-heading); font-size: var(--n); font-weight: 600; color: var(--cn, var(--sl-text)); line-height: 1.1; }
.sl-gap { flex: 1; }
.sl-lead { flex: 1; border-bottom: 3px dotted currentColor; opacity: 0.35; transform: translateY(-0.3em); min-width: 24px; }
.sl-price { font-family: var(--sl-heading); font-size: var(--p); font-weight: 700; color: var(--cp, var(--sl-accent)); white-space: nowrap; }
.sl-desc { font-size: var(--d); color: var(--cd, var(--sl-muted)); line-height: 1.3; margin-top: 4px; }
.sl-steps { list-style: none; margin: 8px 0 0; padding: 0; font-size: var(--d); }
.sl-step { display: flex; gap: .6em; align-items: flex-start; margin-top: .45em; break-inside: avoid; }
.sl-step-n { flex: none; width: 1.6em; height: 1.6em; border-radius: 50%; border: 2px solid var(--cp, var(--sl-accent)); color: var(--cp, var(--sl-accent)); font-weight: 700; display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
.sl-step-body { min-width: 0; }
.sl-step-name { font-weight: 700; color: var(--cn, var(--sl-text)); }
.sl-step-rule { color: var(--cd, var(--sl-muted)); font-size: .85em; }
.sl-step-opts { display: block; color: var(--cd, var(--sl-muted)); line-height: 1.3; }
.sl-step-up { color: var(--cp, var(--sl-accent)); white-space: nowrap; }
.sl-cal { font-size: calc(var(--d) * 0.85); color: var(--sl-muted); margin-top: 2px; }
.sl-opts { font-size: calc(var(--n) * 0.7); margin-top: 4px; color: var(--cn, var(--sl-text)); }
.sl-opt-name { color: var(--sl-muted); }
.sl-opt-price { color: var(--cp, var(--sl-accent)); font-weight: 700; }
.sl-dot { margin: 0 0.5em; opacity: 0.5; }
.sl-item.is-sold .sl-name, .sl-dish.is-sold .sl-dish-name { text-decoration: line-through; opacity: 0.55; }
.sl-item.is-sold .sl-desc, .sl-dish.is-sold .sl-desc, .sl-dish.is-sold .sl-dish-img { opacity: 0.45; }
.sl-tags { display: inline-flex; gap: 6px; margin-left: 10px; vertical-align: middle; }
.sl-tag { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5em; height: 1.5em; padding: 0 0.3em;
  border-radius: 999px; color: #fff; font-family: var(--sl-body); font-size: 0.5em; font-weight: 700; line-height: 1; }
.sl-tag sup { font-size: 0.8em; margin-left: 1px; }

.sl-dish { display: flex; width: 100%; height: 100%; }
.sl-dish-stack { flex-direction: column; }
.sl-dish-side { flex-direction: row; gap: 24px; }
.sl-dish-img { flex: 0 0 var(--img); overflow: hidden; }
.sl-dish-img img { display: block; width: 100%; height: 100%; }
.sl-dish-body { flex: 1; min-width: 0; padding-top: 16px; display: flex; flex-direction: column; }
.sl-dish-side .sl-dish-body { padding-top: 0; justify-content: center; }
.sl-dish-name { font-family: var(--sl-heading); font-size: var(--n); font-weight: 700; color: var(--cn, var(--sl-text)); line-height: 1.05; }
.sl-dish-price { font-family: var(--sl-heading); font-size: var(--p); font-weight: 700; color: var(--cp, var(--sl-accent)); margin-top: 8px; }
.sl-dish .sl-desc { font-size: var(--d); }

.sl-key { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center; color: var(--sl-muted); }
.sl-key-notice { flex-basis: 100%; }
.sl-key strong { color: var(--sl-text); }
.sl-pair { display: inline-flex; align-items: center; gap: 8px; }
.sl-key .sl-tag { font-size: 0.8em; }

.sl-orders { display: flex; gap: 4%; width: 100%; height: 100%; }
.sl-ocol { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sl-otitle { font-family: var(--sl-heading); font-size: var(--ot); font-weight: 700; text-transform: uppercase; text-align: center;
  color: var(--otc, var(--sl-text)); line-height: 1.1; margin-bottom: calc(var(--on) * 0.25); }
.sl-olist { display: grid; grid-template-columns: repeat(var(--oc), minmax(0, 1fr)); gap: calc(var(--on) * 0.18); align-content: start; }
.sl-onum { display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: var(--sl-heading);
  font-size: var(--on); font-weight: 800; line-height: 1.1; padding: 0.08em 0.2em; font-variant-numeric: tabular-nums; }
.sl-onum.is-prep { color: var(--opc, var(--sl-muted)); background: var(--opb, transparent); border-radius: 0.08em; }
.sl-orders.is-stacked { flex-direction: column; gap: calc(var(--on) * 0.4); }
.sl-orders.is-stacked .sl-ocol { min-height: 0; overflow: hidden; }
.sl-och-in, .sl-och-out { animation-duration: var(--och, 900ms); animation-timing-function: cubic-bezier(.2,.7,.3,1); animation-fill-mode: both; }
.sl-och-out { pointer-events: none; }
.sl-och-fade .sl-och-in { animation-name: sl-och-fade-in; }
.sl-och-fade .sl-och-out { animation-name: sl-och-fade-out; }
.sl-och-pop .sl-och-in { animation-name: sl-och-pop-in; }
.sl-och-pop .sl-och-out { animation-name: sl-och-pop-out; }
.sl-och-zoom .sl-och-in { animation-name: sl-och-zoom-in; }
.sl-och-zoom .sl-och-out { animation-name: sl-och-zoom-out; }
.sl-och-float .sl-ocol.is-ready .sl-och-in { animation-name: sl-och-float-in; position: relative; z-index: 2; }
.sl-och-float .sl-ocol.is-prep .sl-och-in { animation-name: sl-och-fade-in; }
.sl-och-float .sl-ocol.is-prep .sl-och-out { animation-name: sl-och-float-out; position: relative; z-index: 2; }
.sl-och-float .sl-ocol.is-ready .sl-och-out { animation-name: sl-och-fade-out; }
@keyframes sl-och-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes sl-och-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes sl-och-pop-in { 0% { opacity: 0; transform: scale(0.2); } 65% { opacity: 1; transform: scale(1.15); } 100% { opacity: 1; transform: none; } }
@keyframes sl-och-pop-out { 0% { opacity: 1; transform: none; } 35% { opacity: 1; transform: scale(1.15); } 100% { opacity: 0; transform: scale(0.2); } }
@keyframes sl-och-zoom-in { from { opacity: 0; transform: scale(2.2); } to { opacity: 1; transform: none; } }
@keyframes sl-och-zoom-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(2.2); } }
@keyframes sl-och-float-in { from { opacity: 0.2; transform: translate(calc(var(--ofx) * -1), calc(var(--ofy) * -1)); } to { opacity: 1; transform: none; } }
@keyframes sl-och-float-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translate(var(--ofx), var(--ofy)); } }
.sl-onum.is-ready { background: var(--orb); color: var(--orc); border-radius: 0.08em; }
.sl-oname { font-size: 0.35em; font-weight: 600; }
.sl-t-video { display: block; }
.sl-video { display: block; width: 100%; height: 100%; max-width: none; background: transparent; }
.sl-ticker { width: 100%; height: 100%; overflow: hidden; display: flex; align-items: center; white-space: nowrap; }
.sl-tk-track { display: inline-flex; flex: none; will-change: transform; }
.sl-tk-item { flex: none; }

/* Animation wrappers (wrapMotion()): they take over the block's layout. */
.sl-in, .sl-loop { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; justify-content: inherit; }
.sl-t-image .sl-in, .sl-t-image .sl-loop, .sl-t-video .sl-in, .sl-t-video .sl-loop, .sl-t-box .sl-in, .sl-t-box .sl-loop { display: block; }

/* Movement runs only on a playing board (the player; the designer's Play). */
.sl-board { --sl-ease: cubic-bezier(.2, .7, .2, 1); }
.sl-board.sl-play .sl-in { animation: var(--sl-in-name) var(--sl-id, 800ms) var(--sl-ease) var(--sl-idl, 0ms) both; }
.sl-in-fade { --sl-in-name: sl-in-fade; } .sl-in-rise { --sl-in-name: sl-in-rise; } .sl-in-drop { --sl-in-name: sl-in-drop; }
.sl-in-left { --sl-in-name: sl-in-left; } .sl-in-right { --sl-in-name: sl-in-right; } .sl-in-zoom { --sl-in-name: sl-in-zoom; }
.sl-in-pop { --sl-in-name: sl-in-pop; } .sl-in-wipe { --sl-in-name: sl-in-wipe; }
@keyframes sl-in-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sl-in-rise { from { opacity: 0; transform: translateY(80px); } to { opacity: 1; transform: none; } }
@keyframes sl-in-drop { from { opacity: 0; transform: translateY(-80px); } to { opacity: 1; transform: none; } }
@keyframes sl-in-left { from { opacity: 0; transform: translateX(-140px); } to { opacity: 1; transform: none; } }
@keyframes sl-in-right { from { opacity: 0; transform: translateX(140px); } to { opacity: 1; transform: none; } }
@keyframes sl-in-zoom { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
@keyframes sl-in-pop { 0% { opacity: 0; transform: scale(0.3); } 70% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: none; } }
@keyframes sl-in-wipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }

.sl-board.sl-play .sl-loop { animation: var(--sl-loop-name) var(--sl-ld, 3000ms) ease-in-out infinite; }
.sl-loop-pulse { --sl-loop-name: sl-loop-pulse; } .sl-loop-float { --sl-loop-name: sl-loop-float; } .sl-loop-swing { --sl-loop-name: sl-loop-swing; }
.sl-loop-zoom { --sl-loop-name: sl-loop-zoom; } .sl-loop-blink { --sl-loop-name: sl-loop-blink; }
.sl-board.sl-play .sl-loop-zoom { animation-direction: alternate; }
@keyframes sl-loop-pulse { 0%, 100% { transform: none; } 50% { transform: scale(1.06); } }
@keyframes sl-loop-float { 0%, 100% { transform: none; } 50% { transform: translateY(-14px); } }
@keyframes sl-loop-swing { 0%, 100% { transform: none; } 25% { transform: rotate(3deg); } 75% { transform: rotate(-3deg); } }
@keyframes sl-loop-zoom { from { transform: none; } to { transform: scale(1.12); } }
@keyframes sl-loop-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.sl-board.sl-play .sl-tk-track { animation: sl-loop-ticker var(--sl-tkd, 20s) linear infinite; }
.sl-board.sl-play .sl-tk-right { animation-direction: reverse; }
@keyframes sl-loop-ticker { from { transform: none; } to { transform: translateX(var(--sl-tks, -50%)); } }
`
