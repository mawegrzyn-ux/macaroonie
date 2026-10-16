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
//     blocks: [{ id, type, x, y, w, h, opts }] }   later blocks sit on top
//
// Menu data comes from the LIVE menus (api/src/services/screenSvc.js loads
// them with loadMenuVersions()), so prices change on screens when a menu is
// published. Sold out comes from the venue's sold out list.

import { FONT_WEIGHTS, FONT_OPTIONS } from './fonts.js'
import { allergenKey, isRemovable, menuTags } from './menuTags.js'
import { itemChoices, variantRules, fromPrice } from './orderPricing.js'

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

export const BLOCK_TYPES = ['heading', 'text', 'menu', 'dish', 'price', 'image', 'box', 'clock', 'allergen_key']

export const BLOCK_LABELS = {
  heading: 'Heading', text: 'Text', menu: 'Menu list', dish: 'Featured dish', price: 'Price',
  image: 'Image', box: 'Box or line', clock: 'Clock', allergen_key: 'Allergen key',
}

export const BLOCK_HINTS = {
  heading: 'A title or a short line.',
  text: 'A paragraph or notes.',
  menu: 'A section of a menu, or dishes you pick, with prices.',
  dish: 'One dish, large, with its photo and price.',
  price: 'Just a price, to put on a photo or design.',
  image: 'A photo, logo or picture from Media.',
  box: 'A coloured panel or a line.',
  clock: 'The time (and date) at the venue.',
  allergen_key: 'What the tags on this board\'s dishes mean.',
}

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
    },
  },
  dish: {
    w: 0.3, h: 0.6,
    opts: {
      menu_id: null, item_id: null, layout: 'stack', show_image: true, image_share: 60, show_desc: true,
      show_tags: true, show_price: true, sold_out: 'mark', name_size: 56, price_size: 64, desc_size: 26, align: 'left',
    },
  },
  price: { w: 0.22, h: 0.1, opts: { menu_id: null, item_id: null, option: '', size: 80, font: 'heading', weight: 700, align: 'center', valign: 'middle', show_name: false, from_text: 'from', sold_out: 'mark' } },
  image: { w: 0.3, h: 0.3, opts: { url: '', fit: 'cover', radius: 0 } },
  box: { w: 0.3, h: 0.3, opts: { color: '#000000', alpha: 50, radius: 12, border_width: 0, border_color: '#ffffff' } },
  clock: { w: 0.18, h: 0.08, opts: { format: '24', show_date: false, size: 48, font: 'body', weight: 600, align: 'right', valign: 'middle' } },
  allergen_key: { w: 0.5, h: 0.08, opts: { size: 22, show_notice: false, align: 'left' } },
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

function menuItemHtml(it, o, ctx) {
  const menu = ctx.menuOfItem[it.id]
  const sold = ctx.soldOut.has(it.id)
  const withOptions = o.show_options !== false && hasBaseOptions(it, menu)
  const price = sold ? soldOutHtml(ctx) : withOptions ? '' : esc(dishPriceText(it, menu, ctx.board))
  let h = '<div class="sl-item' + (sold ? ' is-sold' : '') + '"><div class="sl-row"><span class="sl-name">' + esc(it.name) +
    (o.show_tags !== false ? tagsHtml(it, ctx) : '') + '</span>'
  if (price) h += (o.leaders ? '<span class="sl-lead"></span>' : '<span class="sl-gap"></span>') + '<span class="sl-price">' + price + '</span>'
  h += '</div>'
  if (o.show_desc !== false && it.description) h += '<div class="sl-desc">' + esc(it.description) + '</div>'
  if (o.show_cal && it.calories != null) h += '<div class="sl-cal">' + esc(it.calories) + ' kcal</div>'
  if (withOptions && !sold) h += optionsHtml(it, menu, ctx.board)
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
    default:
      return ''
  }
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

/** A whole board as HTML (the player). ctx from boardContext(). */
export function renderBoardHtml(ctx) {
  const b = ctx.board
  let blocks = ''
  b.blocks.forEach((block, i) => {
    const inner = renderBlockInner(block, ctx)
    if (inner == null || inner === '') return
    blocks += '<div class="sl-block sl-t-' + block.type + '" style="' + styleString(blockStyle(block, i)) + '">' + inner + '</div>'
  })
  return '<div class="sl-board" style="' + styleString(boardStyle(b)) + '">' + blocks + '</div>'
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
`
