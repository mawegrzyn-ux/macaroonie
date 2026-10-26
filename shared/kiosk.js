// shared/kiosk.js
//
// Self-order kiosks (docs/POS.md section 10). A kiosk is a paired till
// device (pos_devices.kind 'kiosk') that guests order on. Its orders are
// counter checks made with the till's own events and rules
// (shared/pos/checks.js: KIOSK_EVENTS and the kiosk rules), so they reach the
// till's Counter list, the kitchen, reports and Cash Recon like any other.
//
// ONE place for what the kiosk app (pos/src/kiosk), the API
// (services/kioskSvc.js, routes/posSetup.js, routes/menus.js) and the admin
// (Store tech > Kiosks, Menus > Translations) share:
//   normaliseDesign(), designProblems()   a kiosk design (kiosk_designs.settings)
//   pickImages()                          the picks' pictures on a dish's photo (split / corner)
//   bundleParts(), bundleLayout()         a meal deal's picture put together from its picks
//   itemLevels(), guestFit(), countFits()  allergens, and how dishes suit the
//                                         allergens and diets a guest picked
//   KIOSK_LANGUAGES, uiText(), allergenName()   words in the guest's language
//                                               (built-in words: shared/kioskText.js)
//   TK, translationSources()              the menu's own words a person translates
//                                         (menu_translations rows, key -> text)
//   kioskStaff(), kioskLine(), kioskOrder()  a basket as till events
//   kioskScale()                          the page zoomed out on a small screen
// Plain ESM, no dependencies but the other shared modules, no DOM.

import { FONT_OPTIONS, FONT_WEIGHTS, fontStack } from './fonts.js'
import { STEP_DISPLAYS, comboOf, comboItemIds, stepChoices, pickScale } from './combos.js'
import { priceItem, posTax, checkTotals } from './pos/pricing.js'
import { replay } from './pos/checks.js'
import { ulid } from './pos/ids.js'
import { configItem, dealItem, comboCtx, checkOffers } from './pos/offers.js'
import { UI_TEXT, ALLERGEN_NAMES } from './kioskText.js'
import { contrast } from './themeKit.js'

export { UI_TEXT, ALLERGEN_NAMES }

export const KIOSK_DISPLAYS = STEP_DISPLAYS
export const DISPLAY_LABELS = { grid: 'Grid', list: 'List', slider: 'Slider', wheel: 'Spin wheel' }

const asList = v => (Array.isArray(v) ? v : [])
const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const url = v => (typeof v === 'string' && /^(https?:\/\/|\/)\S+$/.test(v.trim()) ? v.trim().slice(0, 2000) : null)
const num = (v, min, max, d) => {
  const n = Number(v)
  return v !== null && v !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d
}
const oneOf = (v, list, d) => (list.includes(v) ? v : d)
const ids = (v, max) => [...new Set(asList(v).filter(isUuid))].slice(0, max)
const shortId = (v, i) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : 'x' + i)

// ── Languages ──────────────────────────────────────────────────

export const KIOSK_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ca', name: 'Català' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
]
export const LANG_CODES = KIOSK_LANGUAGES.map(l => l.code)

/**
 * A built-in kiosk word in a language, with {name} parts filled in.
 * overrides: the tenant's own words for this language ({ 'ui:key': text },
 * from menu_translations), which win over the built-in ones.
 */
export function uiText(lang, key, vars = null, overrides = null) {
  let s = (overrides && overrides['ui:' + key]) || UI_TEXT[lang]?.[key] || UI_TEXT.en[key] || key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v))
  return s
}

/** An allergen's name in a language: the tag's own translation, the built-in name of a standard allergen, else its label. */
export function allergenName(tag, lang, texts = null) {
  return (texts && texts[TK.tag(tag.code)]) || (tag.standard_key && ALLERGEN_NAMES[lang]?.[tag.standard_key]) || tag.label
}

// ── Allergens and diets ────────────────────────────────────────
// What a guest picks on the kiosk's allergens screen: the allergens they
// avoid and the diets they follow (prefs { avoid: [codes], diet: [codes] }).
// The screen counts the dishes that suit them, and the menu and meal deal
// choices mark the ones to check (guestFit()).

const LEVEL_RANK = { removable: 1, may_contain: 2, contains: 3 }

/** A dish's tags with their level: { code: 'contains' | 'may_contain' | 'removable' }. */
export function dishLevels(item) {
  const out = {}
  for (const code of item?.dietary || []) out[code] = (item.allergen_levels || {})[code] || 'contains'
  return out
}

/** Several dishes' tags together, each at its strongest level. */
export function mergeLevels(list) {
  const out = {}
  for (const levels of list) for (const [code, lv] of Object.entries(levels)) if (!out[code] || LEVEL_RANK[lv] > LEVEL_RANK[out[code]]) out[code] = lv
  return out
}

/**
 * What an allergen list shows for an item: a dish's own tags; a combo's are
 * every dish it can hold (its own tags carry nothing about its parts).
 * ctx: comboCtx(config).
 */
export function itemLevels(config, item, ctx = comboCtx(config)) {
  if (item?.kind !== 'combo') return dishLevels(item)
  return mergeLevels([dishLevels(item), ...comboItemIds(item, ctx).map(id => dishLevels(configItem(config, id)))])
}

/** The guest's picks, tidied: { avoid, diet } as lists of codes. */
export function cleanPrefs(prefs) {
  const list = v => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x))]
  return { avoid: list(prefs?.avoid), diet: list(prefs?.diet) }
}

export const prefsOn = prefs => !!(prefs?.avoid?.length || prefs?.diet?.length)

// One dish against the guest's picks.
function levelsFit(levels, prefs) {
  const avoid = []
  const removable = []
  for (const code of prefs.avoid) {
    const lv = levels[code]
    if (lv === 'removable') removable.push(code)
    else if (lv) avoid.push({ code, level: lv })
  }
  const missing = prefs.diet.filter(code => !levels[code])
  return { ok: !avoid.length && !missing.length, avoid, removable, missing, some: false }
}

/**
 * How an item suits the guest's picks:
 *   { ok, avoid: [{ code, level }], removable: [codes], missing: [codes], some }
 *   avoid      the guest's allergens it has (contains or may contain): it doesn't suit
 *   removable  ones it has that can be left out on request: it still suits, with a note
 *   missing    diets it isn't marked with: it doesn't suit
 *   some       a meal deal that suits, though some of its choices have the
 *              guest's allergens (avoid lists them)
 * A dish is judged on its own tags. A meal deal on its own tags, then every
 * step that must be picked (at least one, shown whatever else is picked)
 * needs a choice that suits and isn't sold out (a typed-in choice has no
 * tags: it suits allergens, never a diet); a diet also needs one such step,
 * or the deal itself to carry it. Its avoid list is the guest's allergens on
 * any dish it can hold, so the menu can say which. null when no picks.
 */
export function guestFit(config, item, prefs, ctx = comboCtx(config)) {
  const p = cleanPrefs(prefs)
  if (!item || !prefsOn(p)) return null
  if (item.kind !== 'combo') return levelsFit(dishLevels(item), p)
  const own = dishLevels(item)
  const ownFit = levelsFit(own, p)
  const combo = comboOf(item)
  const blockedSteps = { avoid: false, diet: new Set() }
  let required = 0
  for (const step of combo?.steps || []) {
    if (!(step.min > 0) || step.when) continue
    required++
    const open = stepChoices(step, { ...ctx, selfId: item.id }).filter(c => !c.sold_out)
    const fits = open.map(c => (c.item ? levelsFit(dishLevels(c.item), p) : { avoid: [], missing: p.diet }))
    if (!fits.some(f => !f.avoid.length)) blockedSteps.avoid = true
    for (const code of p.diet) if (!fits.some(f => !f.avoid.length && !f.missing.includes(code))) blockedSteps.diet.add(code)
  }
  const all = levelsFit(itemLevels(config, item, ctx), p)
  const missing = p.diet.filter(code => blockedSteps.diet.has(code) || (!required && !own[code]))
  const ok = !ownFit.avoid.length && !blockedSteps.avoid && !missing.length
  return { ok, avoid: all.avoid, removable: all.removable, missing, some: ok && all.avoid.length > 0 }
}

/**
 * The dishes the kiosk sells (each once, sold out ones left out) and how
 * many suit the guest's picks: { total, fits }.
 */
export function countFits(config, itemIds, prefs, ctx = comboCtx(config)) {
  const ids = [...new Set(itemIds)].filter(id => config.items?.[id] && !ctx.soldOut?.(id))
  if (!prefsOn(prefs)) return { total: ids.length, fits: ids.length }
  return { total: ids.length, fits: ids.filter(id => guestFit(config, configItem(config, id), prefs, ctx)?.ok).length }
}

// ── Design ─────────────────────────────────────────────────────

// Fonts a kiosk can use: the admin's list plus bold display fonts that suit
// big touch screens. Weights as Google Fonts serves them (shared/fonts.js).
export const KIOSK_EXTRA_FONTS = {
  'Oswald':           '300;400;500;600;700',
  'Bebas Neue':       '400',
  'Anton':            '400',
  'Barlow Condensed': '300;400;500;600;700;800',
  'Archivo Black':    '400',
}
export const KIOSK_FONTS = [...Object.keys(KIOSK_EXTRA_FONTS), ...FONT_OPTIONS]
export const SYSTEM_FONT = 'System'

/** Google Fonts stylesheet for a design's fonts (null when it uses none). */
export function kioskFontsUrl(design) {
  const names = [...new Set([design?.brand?.font_heading, design?.brand?.font_body])]
    .filter(n => n && n !== SYSTEM_FONT && (FONT_WEIGHTS[n] || KIOSK_EXTRA_FONTS[n]))
  if (!names.length) return null
  return 'https://fonts.googleapis.com/css2?' + names.map(n => {
    const w = FONT_WEIGHTS[n] || KIOSK_EXTRA_FONTS[n]
    return 'family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@' + w
  }).join('&') + '&display=swap'
}

/** CSS font-family for a design font. */
export function kioskFontStack(name) {
  if (!name || name === SYSTEM_FONT) return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  if (KIOSK_EXTRA_FONTS[name]) return "'" + name + "', 'Arial Narrow', sans-serif"
  return fontStack(name)
}

export const DESIGN_COLORS = {
  background:   '#f4f1ea',
  surface:      '#ffffff',
  text:         '#1b1b1b',
  muted:        '#6e6a62',
  primary:      '#0b6b3a',
  primary_text: '#ffffff',
  accent:       '#ffc72c',
  accent_text:  '#1b1b1b',
}
// Colours that may be See-through ('transparent'): fills drawn on the page
// (cards with no fill, outline buttons). The page and the words always have
// a colour.
export const CLEAR_COLORS = ['surface', 'primary', 'accent']
// How a dish's choices come onto the screen: all at once, or one after another
// (kiosk.css data-enter: the design's on the root, an option group's own on
// its choices, groupLook()).
export const CHOICE_ENTRANCES = [
  { key: 'none', label: 'Just there' },
  { key: 'appear', label: 'Fade in' },
  { key: 'slide', label: 'Slide in from the side' },
  { key: 'bubble', label: 'Bubble up' },
  { key: 'deal', label: 'Deal like cards' },
]
export const ENTRANCE_KEYS = CHOICE_ENTRANCES.map(x => x.key)

export const COLOR_LABELS = {
  background: 'Page', surface: 'Cards', text: 'Text', muted: 'Quiet text',
  primary: 'Buttons', primary_text: 'Button text', accent: 'Highlights', accent_text: 'Highlight text',
  bar: 'Bottom bar', bar_text: 'Bottom bar text', rail: 'Side menu', rail_text: 'Side menu text',
}
// Colours for two parts of the screen, set apart from the ones above
// (brand.colors; null = not set: the part follows them, as before these
// could be set; partColours() works out what is in use):
//   bar, bar_text: every bottom bar (.k-bar: the menu, the order, the name
//   and table number, paying, the allergens screen). A dish's own page keeps
//   its bar in the Cards colour.
//   rail, rail_text: the sections down the side of the menu.
export const PART_COLORS = ['bar', 'bar_text', 'rail', 'rail_text']
// What a part's colour follows while it isn't set (the words: whichever of
// Page and Text reads better on their part).
export const PART_FOLLOWS = { bar: 'text', rail: 'surface' }

/**
 * The bottom bar's and side menu's colours in use: each as set, else what
 * it follows. The bar follows Text and the side menu Cards; words that
 * aren't set take whichever of the page colour and the text colour reads
 * better on their part, so a bar colour on its own stays readable (a tie
 * keeps what each used before: Page on the bar, Text on the side menu).
 * With nothing set this is the look from before. The side menu is
 * See-through when it follows See-through cards; its words are then worked
 * out on the page.
 */
export function partColours(colors) {
  const c = colors || {}
  const page = isHex(c.background) ? c.background : DESIGN_COLORS.background
  const ink = isHex(c.text) ? c.text : DESIGN_COLORS.text
  const solid = v => (isHex(v) ? v : page)
  const better = (bg, first, second) => (contrast(second, solid(bg)) > contrast(first, solid(bg)) ? second : first)
  const bar = isHex(c.bar) ? c.bar : ink
  const rail = isHex(c.rail) ? c.rail : c.surface === 'transparent' ? 'transparent' : isHex(c.surface) ? c.surface : DESIGN_COLORS.surface
  return {
    bar,
    bar_text: isHex(c.bar_text) ? c.bar_text : better(bar, page, ink),
    rail,
    rail_text: isHex(c.rail_text) ? c.rail_text : better(rail, ink, page),
  }
}
export const TYPE_ICONS = ['eat_in', 'take_away', 'delivery', 'none']
export const LINK_KINDS = ['none', 'item', 'section']
// How pictures are drawn, set apart for dishes (layout.tiles: the menu, the
// section tiles, the dish's own photo, the basket) and for choices
// (layout.option_tiles: option groups and combo steps): cards (photo on top
// of a card), round or oval photos with the words under them (no card
// behind), hexagons that fit together like a honeycomb, or no frame at all
// (plain: the picture as it is, whole, on the page; best with PNGs on a
// see-through background). Hexagon dishes also give the whole kiosk the
// hexagon look (buttons, chips, badges).
export const TILE_STYLES = ['cards', 'round', 'oval', 'hexagon', 'plain']
export const TILE_LABELS = { cards: 'Cards', round: 'Round', oval: 'Oval', hexagon: 'Hexagons', plain: 'No frame' }
export const OPTION_ALIGNS = ['left', 'center']
// The top of a dish's page: the photo beside the words, or on top of them
// (stacked), with the photo and the words each lined up left, centre or right.
export const HERO_LAYOUTS = ['beside', 'stacked']
export const HERO_ALIGNS = ['left', 'center', 'right']
// How a group's or step's picks show on the dish's photo (pickImages()):
// menu_variant_groups.kiosk_pick_photo, combo steps[].pick_photo (migration 201).
export const PICK_PHOTOS = ['split', 'corner']
/**
 * Where each hexagon of a honeycomb goes (the kiosk's HexGrid): { rows:
 * [[start, ...], ...], width } in half hexagon columns (a hexagon spans two,
 * starting at `start`, 1-based). Rows in turn sit half a hexagon to the
 * right, which is what locks them together; a row may only move by whole
 * hexagons.
 *   full (dishes): rows of `max` and `max - 1`, filled from the left.
 *   compact (choices): from three hexagons on at least two rows, however few
 *   there are (3 = 2 + 1, 4 = 2 + 2, 5 = 3 + 2), else rows of `max` and
 *   `max - 1` with a last row that isn't full centred.
 */
export function hexLayout(total, max, compact = false) {
  const rows = []
  const row = (count, odd, shift = 0) => rows.push(Array.from({ length: count }, (_, j) => (odd ? 2 : 1) + 2 * (shift + j)))
  if (compact && total <= 2) {
    row(total, false)
    return { rows, width: 2 * Math.max(1, total) }
  }
  const top = Math.ceil(total / 2)
  if (compact && top <= max) {
    row(top, false)
    row(total - top, true)
    return { rows, width: 2 * top + (total - top === top ? 1 : 0) }
  }
  let left = total
  for (let r = 0; left > 0; r++) {
    const odd = r % 2 === 1
    const room = odd ? max - 1 : max
    const count = Math.min(room, left)
    row(count, odd, compact ? Math.floor((room - count) / 2) : 0)
    left -= count
  }
  return { rows, width: 2 * max }
}

// Sections down the side with photos or words, or none: the menu opens on a
// page of section tiles instead.
export const RAIL_KINDS = ['images', 'text', 'none']

// How a design picture fills its space (home page banners, featured tiles,
// start screen and reach pictures and videos), each item's `fit`: `mode`
// cover fills the space, cropped, keeping `focus` in view; contain shows the
// whole picture, `size` % of the space, placed at `focus`, on `bg` (a design
// colour, or none: the page shows round it); auto (the default) is contain
// for a picture with a see-through background (pos/src/kiosk/clear.js),
// else cover. pictureFit() reads one; fitLayout() is how the kiosk draws it.
export const PICTURE_FITS = ['auto', 'cover', 'contain']
export const PICTURE_FOCUS = ['top left', 'top', 'top right', 'left', 'center', 'right', 'bottom left', 'bottom', 'bottom right']
export const PICTURE_BGS = ['none', 'surface', 'primary', 'accent', 'text']
export const PICTURE_SIZE_MIN = 30
// A home page banner's shape (menu.banner_shape): width to height, or
// 'picture', each banner the shape of its own picture.
export const BANNER_SHAPES = ['wide', 'short', 'tall', 'picture']
export const BANNER_RATIOS = { wide: 16 / 7, short: 3, tall: 16 / 9 }

export function pictureFit(v) {
  const x = v && typeof v === 'object' ? v : {}
  return {
    mode: oneOf(x.mode, PICTURE_FITS, 'auto'),
    focus: oneOf(x.focus, PICTURE_FOCUS, 'center'),
    size: num(x.size, PICTURE_SIZE_MIN, 100, 100),
    bg: oneOf(x.bg, PICTURE_BGS, 'none'),
  }
}

/**
 * How to draw a fitted picture (an item's `fit`; `clear`: the picture has
 * a see-through background): `whole` (shown whole), `box` (styles for a flex
 * box filling the space) and `media` (styles for the picture or video in
 * it). A whole picture is `size` % of the box, placed at `focus`; a filled
 * one covers the box with `focus` kept in view. `bg` is the design colour
 * key behind a whole picture, else null.
 */
export function fitLayout(raw, clear = false) {
  const f = pictureFit(raw)
  const whole = f.mode === 'contain' || (f.mode === 'auto' && !!clear)
  const at = f.focus
  const size = whole ? f.size : 100
  return {
    whole,
    box: {
      alignItems: at.includes('top') ? 'flex-start' : at.includes('bottom') ? 'flex-end' : 'center',
      justifyContent: at.includes('left') ? 'flex-start' : at.includes('right') ? 'flex-end' : 'center',
    },
    media: { width: size + '%', height: size + '%', objectFit: whole ? 'contain' : 'cover', objectPosition: at },
    bg: whole && f.bg !== 'none' ? f.bg : null,
  }
}

const MAX = { media: 8, reach_media: 4, banners: 10, featured: 12, upsell: 8, hidden: 200, tiles: 200, group_looks: 200 }

function link(v) {
  const kind = oneOf(v?.kind, LINK_KINDS, 'none')
  return kind !== 'none' && isUuid(v?.id) ? { kind, id: v.id } : { kind: 'none', id: null }
}

function sectionTiles(v) {
  const seen = new Set()
  const out = []
  for (const x of asList(v)) {
    if (!isUuid(x?.section_id) || seen.has(x.section_id)) continue
    seen.add(x.section_id)
    out.push({ section_id: x.section_id, image_url: url(x.image_url), title: text(x.title, 60), size: oneOf(x.size, ['normal', 'wide'], 'normal') })
    if (out.length >= MAX.tiles) break
  }
  return out
}

// Option groups with their own look in this design (options.group_looks,
// groupLook()): each part null = not set here. A group with nothing set yet
// stays on the list, so one just added keeps its place.
function groupLooks(v) {
  const seen = new Set()
  const out = []
  for (const x of asList(v)) {
    if (!isUuid(x?.group_id) || seen.has(x.group_id)) continue
    seen.add(x.group_id)
    out.push({
      group_id: x.group_id,
      display: oneOf(x.display, KIOSK_DISPLAYS, null),
      tiles: oneOf(x.tiles, TILE_STYLES, null),
      pictures: typeof x.pictures === 'boolean' ? x.pictures : null,
      entrance: oneOf(x.entrance, ENTRANCE_KEYS, null),
    })
    if (out.length >= MAX.group_looks) break
  }
  return out
}

/**
 * A design with every default filled in and every value checked. Unknown
 * keys are dropped. Text left empty (null) means the built-in words, which
 * come in every language; text typed in is shown as typed and translated on
 * the Translations page (TK.design()).
 */
export function normaliseDesign(raw) {
  const d = raw && typeof raw === 'object' ? raw : {}
  const b = d.brand || {}
  const s = d.start || {}
  const l = d.languages || {}
  const m = d.menu || {}
  const o = d.options || {}
  const c = d.checkout || {}
  const h = d.behaviour || {}
  const y = d.layout || {}
  const colors = {}
  for (const [k, def] of Object.entries(DESIGN_COLORS)) {
    const v = b.colors?.[k]
    colors[k] = isHex(v) ? v.toLowerCase() : v === 'transparent' && CLEAR_COLORS.includes(k) ? v : def
  }
  for (const k of PART_COLORS) colors[k] = isHex(b.colors?.[k]) ? b.colors[k].toLowerCase() : null
  const source = oneOf(l.source, LANG_CODES, 'en')
  const enabled = [...new Set([source, ...asList(l.enabled).filter(x => LANG_CODES.includes(x))])]
  const tiles = oneOf(y.tiles, TILE_STYLES, 'cards')
  const typeCards = {}
  for (const [id, v] of Object.entries(s.type_cards && typeof s.type_cards === 'object' ? s.type_cards : {})) {
    if (!isUuid(id) || !v || typeof v !== 'object') continue
    typeCards[id] = { label: text(v.label, 40), icon: oneOf(v.icon, TYPE_ICONS, 'none'), image_url: url(v.image_url) }
  }
  return {
    brand: {
      logo_url: url(b.logo_url),
      colors,
      font_heading: oneOf(b.font_heading, [SYSTEM_FONT, ...KIOSK_FONTS], 'Oswald'),
      font_body: oneOf(b.font_body, [SYSTEM_FONT, ...KIOSK_FONTS], 'Inter'),
      radius: num(b.radius, 0, 32, 18),
      heading_case: oneOf(b.heading_case, ['upper', 'normal'], 'upper'),
    },
    layout: {
      tiles,
      // Choices' pictures; a design that hasn't picked one keeps the dishes' style.
      option_tiles: oneOf(y.option_tiles, TILE_STYLES, tiles),
      // Off: choices show only their words, in the choices' shape (a card, a
      // circle, an oval or a hexagon). The split photo still uses the pictures.
      option_pictures: y.option_pictures !== false,
      // A grid or honeycomb of choices (and its heading) from the left or
      // centred on the screen.
      option_align: oneOf(y.option_align, OPTION_ALIGNS, 'left'),
      // The top of a dish's page (HERO_LAYOUTS). On a wide screen the photo
      // is always above the words in a column of its own: only the words'
      // line-up applies there.
      hero: oneOf(y.hero, HERO_LAYOUTS, 'beside'),
      hero_image_align: oneOf(y.hero_image_align, HERO_ALIGNS, 'center'),
      hero_text_align: oneOf(y.hero_text_align, HERO_ALIGNS, 'center'),
      // A quiet shade behind the dish's photo on its page and in the order
      // (kiosk.css data-hero-backdrop), so cut-out pictures sit on the same
      // background whether one pick shows or several share the photo. Off:
      // no shade, not even behind a split photo.
      hero_backdrop: y.hero_backdrop !== false,
      // A meal deal's picture put together from the picks as they're made
      // (bundleParts(), BundlePhoto); off, the deal's own photo with each
      // step's picks on it as the step says (pickImages()).
      combo_build: y.combo_build !== false,
      // Add to order: the dish's picture flies into the order button and
      // shrinks away as it goes (pos/src/kiosk/fly.js); off, the button
      // only bounces.
      fly_to_order: y.fly_to_order !== false,
      // The bar along the top (logo, language); off, the language button
      // moves to the bottom bar.
      header: y.header !== false,
      // Back and Start again as icons only (the words stay for screen readers).
      icon_buttons: !!y.icon_buttons,
    },
    start: {
      layout: oneOf(s.layout, ['split', 'full'], 'split'),
      media: asList(s.media).map((x, i) => ({ id: shortId(x?.id, i), type: oneOf(x?.type, ['image', 'video'], 'image'), url: url(x?.url), fit: pictureFit(x?.fit) }))
        .filter(x => x.url).slice(0, MAX.media),
      media_secs: num(s.media_secs, 3, 30, 6),
      headline: text(s.headline, 60),
      question: text(s.question, 60),
      type_cards: typeCards,
      show_allergens: s.show_allergens !== false,
    },
    languages: { source, enabled: enabled.slice(0, LANG_CODES.length) },
    menu: {
      home: m.home !== false,
      banners: asList(m.banners).map((x, i) => ({ id: shortId(x?.id, i), image_url: url(x?.image_url), title: text(x?.title, 80), link: link(x?.link), fit: pictureFit(x?.fit) }))
        .filter(x => x.image_url).slice(0, MAX.banners),
      banner_secs: num(m.banner_secs, 3, 20, 5),
      banner_shape: oneOf(m.banner_shape, BANNER_SHAPES, 'wide'),
      featured: asList(m.featured).map((x, i) => ({
        id: shortId(x?.id, i), image_url: url(x?.image_url), title: text(x?.title, 60), subtitle: text(x?.subtitle, 80),
        size: oneOf(x?.size, ['normal', 'wide'], 'normal'), link: link(x?.link), fit: pictureFit(x?.fit),
      })).filter(x => x.image_url || x.title || x.link.kind !== 'none').slice(0, MAX.featured),
      rail: oneOf(m.rail, RAIL_KINDS, 'images'),
      // With no rail: the section tiles page, in this order (sections not
      // listed follow in menu order), with a picture, words and a width each.
      section_tiles: sectionTiles(m.section_tiles),
      columns: m.columns === 'auto' || m.columns == null ? 'auto' : num(m.columns, 2, 4, 3),
      show_calories: m.show_calories !== false,
      show_descriptions: m.show_descriptions !== false,
      show_tags: m.show_tags !== false,
      quick_add: m.quick_add !== false,
      hidden_section_ids: ids(m.hidden_section_ids, MAX.hidden),
    },
    options: {
      display: oneOf(o.display, KIOSK_DISPLAYS, 'grid'),
      level_icon: oneOf(o.level_icon, ['flame', 'star', 'dot'], 'flame'),
      // The spin wheel's Spin button, and whether a spin picks where it stops.
      wheel_spin: o.wheel_spin !== false,
      wheel_spin_picks: !!o.wheel_spin_picks,
      // How choices come onto the screen (CHOICE_ENTRANCES; kiosk.css data-enter).
      entrance: oneOf(o.entrance, ENTRANCE_KEYS, 'none'),
      // Option groups shown their own way in this design: [{ group_id,
      // display, tiles, pictures, entrance }], each part null = not set here
      // (groupLook()).
      group_looks: groupLooks(o.group_looks),
    },
    checkout: {
      pay_card: c.pay_card !== false,
      pay_counter: c.pay_counter !== false,
      send_counter: !!c.send_counter,
      counter_note: text(c.counter_note, 200),
      upsell: c.upsell !== false,
      upsell_title: text(c.upsell_title, 60),
      upsell_item_ids: ids(c.upsell_item_ids, MAX.upsell),
      receipt: oneOf(c.receipt, ['off', 'ask', 'always'], 'off'),
      thanks: text(c.thanks, 60),
      // What the number a stream's order type asks for is (Store tech >
      // Revenue streams, Tent): a numbered tent picked up beside the kiosk
      // and put on the table, or the number already on the table.
      number_kind: oneOf(c.number_kind, ['tent', 'table'], 'tent'),
    },
    behaviour: {
      idle_secs: num(h.idle_secs, 20, 600, 60),
      warn_secs: num(h.warn_secs, 5, 60, 20),
      done_secs: num(h.done_secs, 5, 120, 15),
      reach: h.reach !== false,
      // Each guest's visit recorded for Store tech > Kiosk analytics
      // (shared/kioskJourney.js, pos/src/kiosk/journey.js). On unless switched off.
      record_journeys: h.record_journeys !== false,
      // Pictures or videos filling the space above the kiosk while the reach
      // button has slid it down (none = the brand colour with the reach icon);
      // pictures take turns every start.media_secs, like the start screen's.
      reach_media: asList(h.reach_media).map((x, i) => ({ id: shortId(x?.id, i), type: oneOf(x?.type, ['image', 'video'], 'image'), url: url(x?.url), fit: pictureFit(x?.fit) }))
        .filter(x => x.url).slice(0, MAX.reach_media),
    },
  }
}

export const DEFAULT_DESIGN = normaliseDesign({})

/**
 * How an option group's choices look on a kiosk with this design: the
 * design's own look for the group (options.group_looks) where it sets one,
 * else the group's own (Menus > Variant groups: kiosk_display, kiosk_tiles,
 * kiosk_pictures, kiosk_entrance), else the design's for every choice. Each
 * part is decided on its own, so a design can change only a group's
 * entrance and keep the tiles the group asks for.
 *   design  a normalised design
 *   group   the kiosk config's group ({ id, kiosk_display, ... }), or null
 *           for choices that aren't a group's (combo steps, a dish's one-off
 *           options): the design's
 * { display, tiles, pictures, entrance }
 */
export function groupLook(design, group = null) {
  const d = design || DEFAULT_DESIGN
  const own = group?.id ? (d.options?.group_looks || []).find(x => x.group_id === group.id) || null : null
  const first = (...vals) => vals.find(v => v != null)
  return {
    display: first(own?.display, oneOf(group?.kiosk_display, KIOSK_DISPLAYS, null), d.options.display),
    tiles: first(own?.tiles, oneOf(group?.kiosk_tiles, TILE_STYLES, null), d.layout.option_tiles),
    pictures: first(own?.pictures, typeof group?.kiosk_pictures === 'boolean' ? group.kiosk_pictures : null, d.layout.option_pictures !== false),
    entrance: first(own?.entrance, oneOf(group?.kiosk_entrance, ENTRANCE_KEYS, null), d.options.entrance),
  }
}

/**
 * What stops a design (with this kiosk's set-up) taking orders, for the
 * editor and Store tech: strings, none = []. kiosk: { card_reader }.
 */
export function designProblems(design, kiosk = null) {
  const d = normaliseDesign(design)
  const out = []
  const card = d.checkout.pay_card && (!kiosk || (kiosk.card_reader && kiosk.card_reader !== 'none'))
  if (!d.checkout.pay_counter && !d.checkout.pay_card) out.push('Pick at least one way to pay: by card or at the counter.')
  else if (kiosk && !card && !d.checkout.pay_counter) out.push('This kiosk has no card machine and the design doesn\'t let guests pay at the counter.')
  return out
}

export const SPLIT_MAX = 6

/**
 * The picks' pictures on a dish's photo on the kiosk (the dish page, the
 * order line): { split: [], corner: [] }. Each option group says where its
 * picks go (menu_variant_groups.kiosk_pick_photo, migration 201: 'split' =
 * they share the photo, one pick's picture replacing it; 'corner' = small in
 * its corner; null = not on the photo), and so does each combo step
 * (steps[].pick_photo). So a dish can split its photo between the flavours
 * and show the dip in the corner. Each pick shows its photo_url (migration
 * 199: the picture made for the dish's photo), else its tile picture
 * (image_url; a picked dish its own photo). Steps first, then groups, each
 * in pick order; an option picked twice shows once. At most SPLIT_MAX each.
 * split is a list of pictures; corner of { src, scale, tiles }, scale the
 * group's or step's size for corner pictures (kiosk_pick_scale / pick_scale,
 * migration 205; null = automatic, cornerWidths()) and tiles the picture
 * style its choices have (groupLook(): a step's are the design's), which the
 * corner picture's frame follows.
 * selection: { choices, combo } as the builder keeps it.
 */
export function pickImages(config, item, selection = {}) {
  const out = { split: [], corner: [] }
  if (!item) return out
  const seen = new Set()
  const add = (where, key, src, scale = null, tiles = 'cards') => {
    if (!src || !out[where] || seen.has(key)) return
    seen.add(key)
    out[where].push(where === 'corner' ? { src, scale: pickScale(scale), tiles } : src)
  }
  const combo = comboOf(item)
  const stepTiles = groupLook(config?.design).tiles
  for (const st of combo?.steps || []) {
    if (!st.pick_photo) continue
    for (const e of asList(selection?.combo?.[st.id])) {
      const opt = st.options.find(o => o.id === e.option_id)
      add(st.pick_photo, 's:' + st.id + ':' + e.option_id + ':' + (e.item_id || ''), opt?.photo_url || (e.item_id ? configItem(config, e.item_id)?.image_url : opt?.image_url), st.pick_scale, stepTiles)
    }
  }
  for (const c of item.pos_choices || []) {
    const lib = config?.groups?.[c.key]
    if (!lib?.kiosk_pick_photo) continue
    const tiles = groupLook(config?.design, lib).tiles
    for (const e of asList(selection?.choices?.[c.key])) {
      const o = (lib.options || []).find(x => (x.option_id ?? x.id) === e.id)
      add(lib.kiosk_pick_photo, 'g:' + c.key + ':' + e.id, o?.photo_url || o?.image_url, lib.kiosk_pick_scale, tiles)
    }
  }
  return { split: out.split.slice(0, SPLIT_MAX), corner: out.corner.slice(0, SPLIT_MAX) }
}

/**
 * How wide each corner picture is (CornerPicks), in % of the strip along the
 * bottom of the dish's photo (92% of its width, 2% gaps between pictures).
 * A set size is that share of the photo's width; automatic is about a
 * quarter, less when several share the corner. When they don't fit side by
 * side, they all shrink by the same factor.
 *   corner  [{ scale }] as pickImages() gives
 */
export function cornerWidths(corner) {
  const n = (corner || []).length
  if (!n) return []
  const auto = Math.min(26, 92 / n - 3)
  const want = corner.map(c => (pickScale(c.scale) ? pickScale(c.scale) / 0.92 : auto))
  const sum = want.reduce((t, w) => t + w, 0)
  const room = 100 - 2 * (n - 1)
  const k = sum > room ? room / sum : 1
  return want.map(w => Math.round(w * k * 100) / 100)
}

// ── A meal deal's picture from its picks ─────────────────────────
// design.layout.combo_build: a meal deal's picture (its pages and its order
// line) shows each picked part, put together like a photo of the meal,
// instead of the deal's own photo (pos/src/kiosk/parts.jsx BundlePhoto).

export const BUNDLE_MAX = 8
// How wide each kind of part is against the main one.
const BUNDLE_WEIGHT = { main: 1, side: 0.72, small: 0.36 }
// Neighbours in the row overlap by this share of the narrower one.
const BUNDLE_OVERLAP = 0.28
// How far small parts reach below the line the row stands on, by their height.
const BUNDLE_BELOW = 0.4
// Each step away from the middle stands this much further back up the table
// (by the main part's height).
const BUNDLE_DEPTH = 0.08

/**
 * The parts of a meal deal's picture, in step order: every step's picks that
 * have a picture (the choice's picture for the dish's photo, photo_url, else
 * the dish's photo or a typed-in choice's own picture), then the picks of
 * the deal's own option groups that put theirs on its photo
 * (kiosk_pick_photo). The first step with a picture gives the main part(s); a
 * step that puts its picks small in the corner (pick_photo 'corner'), and
 * every corner pick, gives small ones; the rest stand beside the main one. A
 * picked dish keeps its own split picks on its picture (wings split by their
 * flavours); its corner picks become small parts. sig changes whenever a
 * part's picture does, so a changed part comes in again. At most BUNDLE_MAX;
 * none = the deal keeps its own photo.
 *   picks  { [stepId]: [{ option_id, item_id, choices }] } (resolveSteps())
 *   own    the deal's own option groups' picks ({ [key]: [{ id }] })
 * [{ key, sig, src, split, size: 'main' | 'side' | 'small', item_id }]
 */
export function bundleParts(config, item, picks = {}, own = {}) {
  const combo = comboOf(item)
  if (!combo) return []
  const out = []
  const add = p => {
    if (p.src && out.length < BUNDLE_MAX) out.push({ ...p, sig: [p.key, p.size, p.src, ...p.split].join('|') })
  }
  let mainStep = null
  for (const st of combo.steps || []) {
    asList(picks?.[st.id]).forEach((e, i) => {
      const opt = (st.options || []).find(o => o.id === e.option_id)
      // The dish as the deal asks it: a group it asks instead puts its picks on the picture too.
      const dish = e.item_id ? dealItem(config, e.item_id, opt?.groups) : null
      const src = opt?.photo_url || (e.item_id ? dish?.image_url : opt?.image_url) || null
      if (!src) return
      let size = 'side'
      if (st.pick_photo === 'corner') size = 'small'
      else if (mainStep === null || mainStep === st.id) { mainStep = st.id; size = 'main' }
      const its = dish ? pickImages(config, dish, { choices: e.choices || {} }) : { split: [], corner: [] }
      const key = 's:' + st.id + ':' + i
      add({ key, src, split: its.split, size, item_id: dish?.id || null })
      its.corner.forEach((c, j) => add({ key: key + ':' + j, src: c.src, split: [], size: 'small', item_id: null }))
    })
  }
  const mine = pickImages(config, item, { choices: own || {} })
  mine.split.forEach((src, j) => add({ key: 'g:' + j, src, split: [], size: 'side', item_id: null }))
  mine.corner.forEach((c, j) => add({ key: 'gc:' + j, src: c.src, split: [], size: 'small', item_id: null }))
  return out
}

/**
 * The box a meal deal's picture is drawn in, for the dishes' picture style
 * (design.layout.tiles): its shape (width / height) and the share kept clear
 * on every side, so a round, oval or hexagon photo doesn't cut parts off.
 * square: a square box whatever the style (an order line's picture).
 */
export function bundleBox(tiles, square = false) {
  const aspect = square || tiles === 'round' ? 1 : tiles === 'hexagon' ? 0.866 : 4 / 3
  const inset = { round: 15, oval: 15, hexagon: 17, plain: 0 }[tiles] ?? 3
  return { aspect, inset }
}

const r2 = v => Math.round(v * 100) / 100

/**
 * Where each part of a meal deal's picture goes (bundleParts()), like a photo
 * of the meal: the main part(s) in the middle of a row, the others beside
 * them in turn in the order picked (the first on the left, the second on the
 * right, the third further left, the fourth further right ...), smaller, a
 * little behind and a little further back up the table; small parts (dips)
 * in front, under the main part, in the order picked. The main part stays in
 * the middle of the box across (with only one side, the picture is as big as
 * if there were one on each side), the whole centred top to bottom and as
 * big as fits. Each part gets a square: { left, top, width, height } in % of
 * the box's width (left, width) and height (top, height), and z (higher = in
 * front).
 *   box  { aspect, inset } (bundleBox())
 */
export function bundleLayout(parts, { aspect = 4 / 3, inset = 0 } = {}) {
  const n = (parts || []).length
  if (!n) return []
  const size = parts.map(p => (p?.size === 'main' || p?.size === 'small' ? p.size : 'side'))
  const mains = [], sides = [], smalls = []
  size.forEach((s, i) => (s === 'main' ? mains : s === 'small' ? smalls : sides).push(i))
  // Only small parts: they make the row.
  if (!mains.length && !sides.length) sides.push(...smalls.splice(0))
  const left = [], right = []
  sides.forEach((i, k) => (k % 2 ? right : left).push(i))
  const row = [...left.reverse(), ...mains, ...right]
  const firstMain = left.length
  const lastMain = left.length + mains.length - 1
  // Laid out with the main part 1 wide, y going down from the line the row
  // stands on; then scaled to fit and centred.
  const at = new Array(n)
  let x = 0
  row.forEach((i, k) => {
    const w = size[i] === 'main' ? 1 : BUNDLE_WEIGHT.side
    const far = k < firstMain ? firstMain - k : k > lastMain ? k - lastMain : 0
    const lift = far * BUNDLE_DEPTH
    at[i] = { x, y: -lift - w, w, z: 10 - far }
    const next = row[k + 1]
    if (next !== undefined) x += w - BUNDLE_OVERLAP * Math.min(w, size[next] === 'main' ? 1 : BUNDLE_WEIGHT.side)
  })
  if (smalls.length) {
    const under = mains.length ? mains : row
    const mid = (at[under[0]].x + at[under[under.length - 1]].x + at[under[under.length - 1]].w) / 2
    const w = BUNDLE_WEIGHT.small
    const gap = w * 0.1
    const total = smalls.length * w + (smalls.length - 1) * gap
    smalls.forEach((i, j) => { at[i] = { x: mid - total / 2 + j * (w + gap), y: w * BUNDLE_BELOW - w, w, z: 20 + j } })
  }
  const all = at.filter(Boolean)
  const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x + p.w))
  const minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y + p.w))
  // Across, the middle of the main part(s) goes in the middle of the box
  // (without one, the middle of the whole), so the wider half decides the size.
  const cx = mains.length ? (at[mains[0]].x + at[mains[mains.length - 1]].x + at[mains[mains.length - 1]].w) / 2 : (minX + maxX) / 2
  const halfW = Math.max(cx - minX, maxX - cx)
  // The box is 100 wide and 100 / aspect tall in these units.
  const roomW = 100 - 2 * inset
  const roomH = (100 - 2 * inset) / aspect
  const u = Math.min(roomW * 0.96 / (2 * halfW), roomH * 0.96 / (maxY - minY))
  const dx = 50 - cx * u
  const dy = 50 / aspect - ((minY + maxY) / 2) * u
  return at.map(p => ({
    left: r2(dx + p.x * u),
    top: r2((dy + p.y * u) * aspect),
    width: r2(p.w * u),
    height: r2(p.w * u * aspect),
    z: p.z,
  }))
}

// Below the kiosk-images cache's maxEntries (pos/vite.config.js), so saving
// every picture never pushes out the ones saved first.
export const MAX_SAVED_PICTURES = 1800

/**
 * Every picture a kiosk config can show, for keeping them on the device
 * (pos/src/kiosk/photos.js): the logo, start screen pictures (not videos),
 * and every image_url / logo_url / photo_url anywhere in the config (dishes, sections,
 * option and combo choices, banners, featured tiles, section tiles, order
 * type cards). Absolute URLs on the kiosk's own origin only (the service
 * worker keeps only those), each once, design first, at most MAX_SAVED_PICTURES.
 */
export function configImages(config, origin) {
  const out = new Set()
  const add = u => {
    if (typeof u !== 'string' || !u || u.startsWith('data:')) return
    let url
    try { url = new URL(u, origin) } catch { return }
    if (url.origin === origin) out.add(url.href)
  }
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 12) return
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    for (const [k, x] of Object.entries(v)) {
      if (k === 'image_url' || k === 'logo_url' || k === 'photo_url') add(x)
      else if (x && typeof x === 'object') walk(x, depth + 1)
    }
  }
  const d = config?.design
  add(d?.brand?.logo_url)
  for (const m of [...(d?.start?.media || []), ...(d?.behaviour?.reach_media || [])]) if (m?.type !== 'video') add(m?.url)
  walk(d, 0)
  walk(config, 0)
  return [...out].slice(0, MAX_SAVED_PICTURES)
}

// ── The kiosk on a small screen ──────────────────────────────────
// kiosk.css sizes follow the screen's short side (vmin) with finger-sized
// minimums. Below KIOSK_MIN_SHORT CSS px of short side (a phone, a TV box at
// twice the pixel density) the minimums take over, so the kiosk looks zoomed
// in and its bars crowd. There the kiosk zooms the page out, as a browser's
// desktop mode does (pos/src/kiosk/viewport.js): it is laid out at a short
// side of KIOSK_MIN_SHORT and shown at kioskScale() of that size.
export const KIOSK_MIN_SHORT = 800

/**
 * The page scale for a screen of w x h CSS px (either way round): 1 when its
 * short side is KIOSK_MIN_SHORT or more (or unknown), else short /
 * KIOSK_MIN_SHORT rounded down to 3 decimals, so the page is never narrower
 * than it needs to be.
 */
export function kioskScale(w, h) {
  const short = Math.min(Number(w), Number(h))
  if (!(short > 0) || short >= KIOSK_MIN_SHORT) return 1
  return Math.max(0.1, Math.floor((short / KIOSK_MIN_SHORT) * 1000) / 1000)
}

/** Ways a guest can pay on this kiosk: ['card', 'counter'] in that order. */
export function payMethods(design, kioskSettings = {}) {
  const out = []
  if (design.checkout.pay_card && kioskSettings.card_reader && kioskSettings.card_reader !== 'none') out.push('card')
  if (design.checkout.pay_counter) out.push('counter')
  return out
}

// ── Translations ───────────────────────────────────────────────

// menu_translations keys. Ids are stable (menu saves keep them, migration
// 121), so a translation follows its dish through edits and publishes.
export const TK = {
  item:    (id, field) => 'item:' + id + ':' + field,           // name | description
  variant: (itemId, label) => 'item:' + itemId + ':variant:' + label,
  section: (id, field) => 'section:' + id + ':' + field,        // title | subtitle
  group:   (id, field) => 'group:' + id + ':' + field,          // name | scale_low | scale_high
  option:  (id, field) => 'option:' + id + ':' + field,         // label | description
  step:    (itemId, stepId) => 'combo:' + itemId + ':step:' + stepId,
  choice:  (itemId, optionId, field = 'label') => 'combo:' + itemId + ':choice:' + optionId + (field === 'label' ? '' : ':' + field),
  type:    id => 'type:' + id,
  tag:     code => 'tag:' + code,
  notice:  field => 'notice:' + field,                          // title | body | removable_note
  design:  (id, path) => 'design:' + id + ':' + path,
  ui:      key => 'ui:' + key,
}

export const KEY_PATTERN = /^[a-z_]+:[A-Za-z0-9:_ .,'&()/-]{1,190}$/

/**
 * Every word a kiosk can show that a person may translate, in groups:
 *   [{ key, group, context, text }]
 * (text = the words as written, in the design's source language). From:
 *   menus     [{ name, sections: [{ id, title, subtitle, items: [...] }] }] (drafts)
 *   groups    the option group library ([{ id, name, scale_low, scale_high, options }])
 *   types     order types; tags (dietary + allergens); notice; designs [{ id, name, settings }]
 */
export function translationSources({ menus = [], groups = [], types = [], tags = [], notice = null, designs = [] } = {}) {
  const out = []
  const seen = new Set()
  const add = (key, group, context, value) => {
    const t = typeof value === 'string' ? value.trim() : ''
    if (!t || seen.has(key)) return
    seen.add(key)
    out.push({ key, group, context, text: t })
  }
  for (const m of menus) {
    for (const s of m.sections || []) {
      if ((s.visibility || 'show') === 'hidden') continue
      add(TK.section(s.id, 'title'), 'Sections', m.name, s.title)
      add(TK.section(s.id, 'subtitle'), 'Sections', s.title, s.subtitle)
      for (const it of s.items || []) {
        add(TK.item(it.id, 'name'), 'Dishes', s.title, it.name)
        add(TK.item(it.id, 'description'), 'Dishes', it.name, it.description)
        for (const v of it.variants || []) add(TK.variant(it.id, v.label), 'Dishes', it.name + ' option', v.label)
        const combo = comboOf(it)
        if (combo) {
          for (const st of combo.steps) {
            add(TK.step(it.id, st.id), 'Combos', it.name + ' step', st.name)
            for (const o of st.options) {
              if (o.type !== 'custom') continue
              add(TK.choice(it.id, o.id), 'Combos', it.name + ': ' + st.name, o.label)
              add(TK.choice(it.id, o.id, 'description'), 'Combos', o.label, o.description)
            }
          }
        }
      }
    }
  }
  for (const g of groups) {
    add(TK.group(g.id, 'name'), 'Options', 'Option group', g.name)
    add(TK.group(g.id, 'scale_low'), 'Options', g.name + ': low end of the scale', g.scale_low)
    add(TK.group(g.id, 'scale_high'), 'Options', g.name + ': high end of the scale', g.scale_high)
    for (const o of g.options || []) {
      add(TK.option(o.id, 'label'), 'Options', g.name, o.label)
      add(TK.option(o.id, 'description'), 'Options', o.label, o.description)
    }
  }
  for (const t of types) add(TK.type(t.id), 'Order types', 'Order type', t.name)
  for (const t of tags) add(TK.tag(t.code), t.kind === 'allergen' ? 'Allergens' : 'Dietary', t.standard_key ? 'Built-in names in every language; type here to change it' : 'Tag', t.label)
  if (notice) {
    add(TK.notice('title'), 'Allergen notice', 'Title', notice.title)
    add(TK.notice('body'), 'Allergen notice', 'Text', notice.body)
    add(TK.notice('removable_note'), 'Allergen notice', 'Asterisk note', notice.removable_note)
  }
  for (const d of designs) {
    const s = normaliseDesign(d.settings)
    const g = 'Kiosk design: ' + d.name
    add(TK.design(d.id, 'headline'), g, 'Start screen headline', s.start.headline)
    add(TK.design(d.id, 'question'), g, 'Start screen question', s.start.question)
    for (const [typeId, v] of Object.entries(s.start.type_cards)) add(TK.design(d.id, 'type:' + typeId), g, 'Order type button', v.label)
    for (const x of s.menu.banners) add(TK.design(d.id, 'banner:' + x.id), g, 'Banner', x.title)
    for (const x of s.menu.featured) {
      add(TK.design(d.id, 'featured:' + x.id + ':title'), g, 'Featured tile', x.title)
      add(TK.design(d.id, 'featured:' + x.id + ':subtitle'), g, 'Featured tile, second line', x.subtitle)
    }
    for (const x of s.menu.section_tiles) add(TK.design(d.id, 'tile:' + x.section_id), g, 'Section tile', x.title)
    add(TK.design(d.id, 'counter_note'), g, 'Pay at the counter note', s.checkout.counter_note)
    add(TK.design(d.id, 'upsell_title'), g, '"Anything else?" heading', s.checkout.upsell_title)
    add(TK.design(d.id, 'thanks'), g, 'Order placed heading', s.checkout.thanks)
  }
  for (const key of Object.keys(UI_TEXT.en)) add(TK.ui(key), 'Kiosk words', 'Built in, in every language; type here to change it', UI_TEXT.en[key])
  return out
}

// ── Orders ─────────────────────────────────────────────────────

/** The kiosk as the check rules know it (shared/pos/checks.js): no permissions, kiosk rules. */
export function kioskStaff(device) {
  return { id: device.id, name: device.name || 'Kiosk', is_active: true, permissions: {}, kiosk: true }
}

/**
 * A basket entry as a check line (the till's line shape, shared/pos/checks.js
 * line.added): priced with the till's rules (shared/pos/pricing.js) and taxed
 * for the check's order type and revenue stream (shared/tax.js). The line
 * keeps the dish's own name (the kitchen and receipts use the menu's words).
 * entry: { item_id, selection: { choices, combo }, qty, note }.
 * Returns { ok, line, unit } or { ok: false, error }.
 */
export function kioskLine(config, entry, check, id, ctx = null) {
  const it = configItem(config, entry.item_id)
  if (!it) return { ok: false, error: 'This is no longer on the menu' }
  const priced = priceItem(it, entry.selection || {}, ctx || comboCtx(config))
  if (!priced.ok) return priced
  const tax = posTax(it, check, config)
  return {
    ok: true,
    line: {
      id, item_id: it.id, section_id: it.section_id ?? null, name: it.name, kitchen_name: it.kitchen_name || null,
      qty: Math.max(1, Math.min(99, Number(entry.qty) || 1)),
      unit_price: priced.unit_price, modifiers: priced.modifiers, combo: priced.combo,
      seat: null, course_id: it.course_id || null, note: entry.note ? String(entry.note).slice(0, 300) : null, allergies: [],
      vat_rate: tax.vat_rate, tax_rate_id: tax.tax_rate_id, revenue_stream_id: check.revenue_stream_id ?? null,
    },
  }
}

/**
 * A kiosk order as till events, in order, checked with the same rules the
 * sequencer uses (so what the guest sees is what the till gets):
 *   check.opened   counter, the kiosk's revenue stream, the order type, the
 *                  guest's name (tab_name) and table number (tent)
 *   line.added     one per basket entry
 *   promotions.set when automatic combos or promotions apply
 *   then for a card payment: payment.added (the whole total: card_integrated
 *   naming its card machine attempt when payment.card_payment_id is given,
 *   migration 193; else card_external, the preview's pretend reader),
 *   lines.sent, check.closed; for pay at the counter: lines.sent only when
 *   the design sends counter orders straight away (send).
 * opts: { device, checkId, newId(), at, order_type_id, name, tent,
 *         provisional_no, payment: { id?, card_payment_id?, ref, label } | null, send, receipt }
 * Returns { ok, events, check, totals } or { ok: false, error, index }.
 */
export function kioskOrder(config, basket, opts) {
  const { device, checkId, newId, at = new Date().toISOString() } = opts
  const base = { venue_id: device.venue_id ?? null, device_id: device.id, staff_id: device.id, approved_by: null, check_id: checkId, client_at: at }
  const ev = (type, payload) => ({ ...base, id: newId(), type, payload })
  const streamId = config.stream?.id || null
  const opened = ev('check.opened', {
    mode: 'counter', revenue_stream_id: streamId, order_type_id: opts.order_type_id || null,
    tab_name: text(opts.name, 80), tent: text(opts.tent, 20), provisional_no: opts.provisional_no || null,
  })
  const events = [opened]
  const check = { id: checkId, revenue_stream_id: streamId, order_type_id: opts.order_type_id || null }
  const ctx = comboCtx(config)
  for (const [index, entry] of asList(basket).entries()) {
    const r = kioskLine(config, entry, check, newId(), ctx)
    if (!r.ok) return { ok: false, error: r.error, index }
    events.push(ev('line.added', { line: r.line }))
  }
  const rules = { staffById: { [device.id]: kioskStaff(device) } }
  const run = () => {
    const r = replay({}, events, rules)
    return r.refused.length ? { error: r.refused[0].error } : { check: r.checks[checkId] }
  }
  let state = run()
  if (state.error) return { ok: false, error: state.error }
  const offers = checkOffers(state.check, config)
  if (offers && offers.payload.promotions.length) {
    events.push(ev('promotions.set', offers.payload))
    state = run()
    if (state.error) return { ok: false, error: state.error }
  }
  const totals = checkTotals(state.check)
  const sendAll = () => events.push(ev('lines.sent', { send_id: newId(), line_ids: state.check.lines.map(l => l.id), held_course_ids: [] }))
  if (opts.payment) {
    if (totals.total > 0) {
      const card = opts.payment.card_payment_id || null
      events.push(ev('payment.added', { payment: {
        id: opts.payment.id || newId(), tender: card ? 'card_integrated' : 'card_external', amount: totals.total,
        ref: text(opts.payment.ref, 120), label: text(opts.payment.label, 80),
        ...(card ? { card_payment_id: card } : {}),
      } }))
    }
    sendAll()
    events.push(ev('check.closed', opts.receipt ? { print_receipt: true } : {}))
  } else if (opts.send) {
    sendAll()
  }
  state = run()
  if (state.error) return { ok: false, error: state.error }
  return { ok: true, events, check: state.check, totals: checkTotals(state.check) }
}

/** The order a basket would make now, for showing its total and offers (no events kept). */
export function basketCheck(config, basket, { device, order_type_id }) {
  return kioskOrder(config, basket, {
    device: device || { id: '00000000-0000-4000-8000-000000000000' },
    checkId: ulid(), newId: () => ulid(), order_type_id,
  })
}
