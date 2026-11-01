// shared/pos/tillLayout.js
//
// Till layouts (migration 228; Store tech > Till layouts): how a till's order
// screen is arranged. A layout is a grid of cells (cols x rows) holding
// zones; each zone takes a rectangle of cells and has its own grid for its
// buttons (cols x rows, so the buttons' size follows), text size and what
// happens when it holds more than fits (overflow):
//
//   check       the order: its dishes, totals and More / Send / Bill / Pay
//               (a counter till before an order: New order and the orders waiting)
//   categories  the till's menu sections as buttons: all, or the ones picked, in that order
//   menus       the till's menus as buttons, to switch the menu shown (as More >
//               Menus does): all of the till's menus, or the ones picked, in that
//               order; with a Menu times button to follow the menu times again
//   items       the dishes of the section picked (with a search box on top if set)
//   buttons     buttons set in the designer: a dish, or a function (a tender,
//               the last receipt, a discount or a charge from the list, Send
//               ...); a button can take several cells of its zone
//   modifiers   a dish's choices while it is being added: the ones that must be
//               picked, the optional ones, or both; drawn over its own rectangle
//               (over other zones) or over the whole screen
//   seats       the seat and course bar
//
// Zones may not overlap, except modifiers zones (they show only while a dish
// is being added). The till draws a layout (pos/src/components/LayoutScreen.jsx)
// and the designer (admin pages/TillLayoutDesigner.jsx) previews it, both with
// packCells() below, so a button lands in the same cell in both. A till with
// no layout keeps the standard screen.
//
// A layout can also take the till's top bar away on the order screen
// (top_bar false): the till's pages, sign out and its details are then in
// More (the till menu, pos/src/components/TillMenu.jsx). The Order zone can
// leave out its own buttons (hide: CHECK_BUTTONS), each of which a Buttons
// zone can have instead, and has its own text size and button colours. A
// Dish choices zone can leave out the dish's name, its description and the
// prices, and can add the dish as soon as its last must-pick choice that
// takes one pick is tapped (auto_add), or instead let a choice that takes
// one pick take more, each one more dish (split_picks: Pad Thai with Chicken
// and Prawn adds two Pad Thai; never with auto_add).
//
// Each zone with a grid of buttons sets where the words sit on its buttons:
// across (align: left | center | right) and up and down (valign: top |
// middle | bottom), drawn by the till and the designer through
// buttonTextStyle() below. The Seat and course zone can show the seats only
// or the courses only (parts).
//
// The Menus zone (menu_ids: the menus it offers, null = all the till's; tap:
// one shows just the menu tapped, several adds it or takes it off;
// times_button: a Menu times button first, back to following the menu
// times; show_times: each menu's times under its name) changes what the
// till shows the same way More > Menus does (switchMenus() in
// shared/menuTimes.js): the pick holds until the menus on now change.
//
// A Pop-up zone (popup) holds buttons as a Buttons zone does, but shows only
// when a button opens it (action open_popup, its popup_id), over the cells it
// is placed on (it may sit over other zones), the rest of the screen waiting
// behind it until it closes. It has a name (title), can leave out its border
// and shadow (frame) and its window controls, a bar with its name and an X
// (controls), and closes on a tap outside it (close_outside), after any of
// its buttons is used (close_on_tap) or with a Close button among its own
// (close_popup, offered only in pop-ups). popupCloseProblem() refuses a
// pop-up nothing closes. A button that opens another pop-up shows that one
// in its place; a pop-up never opens itself.

export const LAYOUT_COLS = { min: 4, max: 24, default: 12 }
export const LAYOUT_ROWS = { min: 3, max: 16, default: 8 }
export const ZONE_GRID = { min: 1, max: 12 }
export const FONT = { min: 12, max: 36, default: 16 }
export const MAX_ZONES = 24
export const MAX_BUTTONS = 80
export const MAX_SECTIONS = 100
export const MAX_MENUS = 30
export const LABEL_MAX = 40

export const ZONE_TYPES = [
  { key: 'check', label: 'Order', hint: 'The order: its dishes, totals and More, Send, Bill and Pay.', max: 1 },
  { key: 'categories', label: 'Categories', hint: 'The menu sections as buttons. Pick which ones show, in your order.', max: 1 },
  { key: 'menus', label: 'Menus', hint: 'The till\'s menus as buttons: tap one to show it. Pick which ones show, in your order.', max: 1 },
  { key: 'items', label: 'Dishes', hint: 'The dishes of the category picked, with a search box if you want one.', max: 1 },
  { key: 'buttons', label: 'Buttons', hint: 'Your own buttons: a dish, or a function such as Exact cash or Last receipt.', max: 8 },
  { key: 'modifiers', label: 'Dish choices', hint: 'A dish\'s choices while it is being added: the must-pick ones, the optional ones, or both.', max: 2 },
  { key: 'seats', label: 'Seat and course', hint: 'The seat and course the next dish goes to (or just one of them).', max: 1 },
  { key: 'popup', label: 'Pop-up', hint: 'Buttons that show only when a button opens them, over the part of the screen you place them on.', max: 8 },
]
export const ZONE_KEYS = ZONE_TYPES.map(t => t.key)
export const zoneLabel = type => ZONE_TYPES.find(t => t.key === type)?.label || type
// Zones with a grid of buttons.
export const GRID_ZONES = ['categories', 'menus', 'items', 'buttons', 'modifiers', 'popup']
// Zones that may sit over other zones (they show only some of the time).
export const FLOATING_ZONES = ['modifiers', 'popup']

// More than fits: carry on in a scroll (down, or across in a one-row zone),
// in pages with arrows, behind a More button in the last cell, or not at all.
export const OVERFLOWS = [
  { key: 'scroll', label: 'Scroll' },
  { key: 'pages', label: 'Pages' },
  { key: 'more', label: 'More button' },
  { key: 'hide', label: 'Hide the rest' },
]
export const OVERFLOW_KEYS = OVERFLOWS.map(o => o.key)

// Which choices a modifiers zone shows, and where it draws.
export const CHOICE_KINDS = [
  { key: 'all', label: 'All choices' },
  { key: 'required', label: 'Must pick' },
  { key: 'optional', label: 'Optional' },
]
export const CHOICE_KIND_KEYS = CHOICE_KINDS.map(k => k.key)
export const COVERS = [
  { key: 'zone', label: 'Its own space' },
  { key: 'screen', label: 'The whole screen' },
]
export const COVER_KEYS = COVERS.map(c => c.key)

// Where the words sit on a zone's buttons: across and up and down.
export const ALIGNS = [
  { key: 'left', label: 'Left' },
  { key: 'center', label: 'Centre' },
  { key: 'right', label: 'Right' },
]
export const ALIGN_KEYS = ALIGNS.map(a => a.key)
export const VALIGNS = [
  { key: 'top', label: 'Top' },
  { key: 'middle', label: 'Middle' },
  { key: 'bottom', label: 'Bottom' },
]
export const VALIGN_KEYS = VALIGNS.map(a => a.key)

// What tapping a menu in the Menus zone does.
export const MENU_TAPS = [
  { key: 'one', label: 'Shows just that menu' },
  { key: 'several', label: 'Adds it or takes it off' },
]
export const MENU_TAP_KEYS = MENU_TAPS.map(t => t.key)

// What the Seat and course zone shows.
export const SEAT_PARTS = [
  { key: 'both', label: 'Seat and course' },
  { key: 'seats', label: 'Seat only' },
  { key: 'courses', label: 'Course only' },
]
export const SEAT_PART_KEYS = SEAT_PARTS.map(p => p.key)

// The Order zone's own buttons, each one a layout can leave out (hide) when
// a Buttons zone does it instead (action: the button action that does the
// same). colour: the ones whose colour can be set.
export const CHECK_BUTTONS = [
  { key: 'back', label: 'Back', action: 'back', colour: false },
  { key: 'cancel', label: 'Cancel order', action: 'cancel_order', colour: true },
  { key: 'more', label: 'More', action: 'more', colour: true },
  { key: 'send', label: 'Send', action: 'send', colour: true },
  { key: 'bill', label: 'Bill', action: 'bill', colour: true },
  { key: 'pay', label: 'Pay', action: 'pay', colour: true },
]
export const CHECK_BUTTON_KEYS = CHECK_BUTTONS.map(b => b.key)
const COLOUR_KEYS = CHECK_BUTTONS.filter(b => b.colour).map(b => b.key)
// Button actions that pay: any of them stands in for the Order zone's Pay.
const PAY_ACTIONS = ['pay', 'exact_cash', 'exact_card', 'tender']

// What a button in a buttons zone does. check: needs an order on screen.
export const BUTTON_ACTIONS = [
  { key: 'item', label: 'A dish', check: false, group: 'Dishes' },
  { key: 'exact_cash', label: 'Exact cash', check: true, group: 'Paying' },
  { key: 'exact_card', label: 'Exact card', check: true, group: 'Paying' },
  { key: 'tender', label: 'Pay by', check: true, group: 'Paying' },
  { key: 'pay', label: 'Pay', check: true, group: 'Paying' },
  { key: 'bill', label: 'Print bill', check: true, group: 'Paying' },
  { key: 'last_receipt', label: 'Last receipt', check: false, group: 'Paying' },
  { key: 'discount_preset', label: 'A discount', check: true, group: 'Discounts' },
  { key: 'discount', label: 'Discount', check: true, group: 'Discounts' },
  { key: 'send', label: 'Send', check: true, group: 'Order' },
  { key: 'fire', label: 'Fire a course', check: true, group: 'Order' },
  { key: 'more', label: 'More', check: true, group: 'Order' },
  { key: 'guests', label: 'Guests', check: true, group: 'Order' },
  { key: 'order_type', label: 'Order type', check: true, group: 'Order' },
  { key: 'name', label: 'Name', check: true, group: 'Order' },
  { key: 'tent', label: 'Tent number', check: true, group: 'Order' },
  { key: 'allergy', label: 'Allergy', check: true, group: 'Order' },
  { key: 'table', label: 'Table', check: true, group: 'Order' },
  { key: 'move', label: 'Split / move items', check: true, group: 'Order' },
  { key: 'merge', label: 'Merge checks', check: true, group: 'Order' },
  { key: 'charges', label: 'Charges', check: true, group: 'Order' },
  { key: 'charge', label: 'A charge', check: true, group: 'Order' },
  { key: 'offers', label: 'Offers', check: true, group: 'Order' },
  { key: 'loyalty', label: 'Loyalty', check: true, group: 'Order' },
  { key: 'open_item', label: 'Item not on menu', check: true, group: 'Order' },
  { key: 'cancel_order', label: 'Cancel order', check: true, group: 'Order' },
  { key: 'no_sale', label: 'No sale (open drawer)', check: false, group: 'Till' },
  { key: 'menus', label: 'Menus', check: false, group: 'Till' },
  { key: 'back', label: 'Back', check: false, group: 'Till' },
  { key: 'till_menu', label: 'Till menu', check: false, group: 'Till' },
  { key: 'sign_out', label: 'Sign out', check: false, group: 'Till' },
  { key: 'open_popup', label: 'Open a pop-up', check: false, group: 'Pop-ups' },
  { key: 'close_popup', label: 'Close the pop-up', check: false, group: 'Pop-ups' },
]
export const ACTION_KEYS = BUTTON_ACTIONS.map(a => a.key)
export const actionOf = key => BUTTON_ACTIONS.find(a => a.key === key) || null
const TENDER_KEYS = ['cash', 'card_external', 'card_integrated', 'voucher', 'account', 'other']

const HEX = /^#[0-9a-f]{6}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID = /^[a-z0-9_-]{1,24}$/i

function int(v, min, max, dflt) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const pick = (v, keys, dflt) => (keys.includes(v) ? v : dflt)
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt)

// A zone's own button grid when nothing is set (align / valign: where the
// words sit, as each zone drew them before they could be set).
const GRID_DEFAULTS = {
  categories: { cols: 6, rows: 1, overflow: 'scroll', align: 'center', valign: 'middle' },
  menus: { cols: 4, rows: 1, overflow: 'scroll', align: 'center', valign: 'middle' },
  items: { cols: 4, rows: 4, overflow: 'scroll', align: 'left', valign: 'top' },
  buttons: { cols: 4, rows: 2, overflow: 'pages', align: 'center', valign: 'middle' },
  modifiers: { cols: 4, rows: 4, overflow: 'scroll', align: 'left', valign: 'top' },
  popup: { cols: 3, rows: 2, overflow: 'pages', align: 'center', valign: 'middle' },
}

function normaliseButton(b, grid, i) {
  if (!b || typeof b !== 'object') return null
  const action = pick(b.action, ACTION_KEYS, null)
  if (!action) return null
  const out = {
    id: ID.test(String(b.id || '')) ? String(b.id) : 'b' + (i + 1),
    action,
    label: text(b.label, LABEL_MAX) || null,
    colour: HEX.test(String(b.colour || '')) ? String(b.colour).toLowerCase() : null,
    w: int(b.w, 1, grid.cols, 1),
    h: int(b.h, 1, grid.rows, 1),
  }
  if (action === 'item') {
    if (!UUID.test(String(b.item_id || ''))) return null
    out.item_id = String(b.item_id).toLowerCase()
  }
  if (action === 'discount_preset') {
    if (!UUID.test(String(b.preset_id || ''))) return null
    out.preset_id = String(b.preset_id).toLowerCase()
  }
  if (action === 'tender') {
    if (!TENDER_KEYS.includes(b.tender)) return null
    out.tender = b.tender
  }
  if (action === 'charge') {
    if (!UUID.test(String(b.charge_id || ''))) return null
    out.charge_id = String(b.charge_id).toLowerCase()
  }
  // Checked against the layout's pop-ups in normaliseTillLayout().
  if (action === 'open_popup') out.popup_id = String(b.popup_id || '')
  return out
}

function normaliseZone(z, layout, i) {
  if (!z || typeof z !== 'object' || !ZONE_KEYS.includes(z.type)) return null
  const x = int(z.x, 0, layout.cols - 1, 0)
  const y = int(z.y, 0, layout.rows - 1, 0)
  const zone = {
    id: ID.test(String(z.id || '')) ? String(z.id) : 'z' + (i + 1),
    type: z.type,
    x, y,
    w: int(z.w, 1, layout.cols - x, 1),
    h: int(z.h, 1, layout.rows - y, 1),
  }
  if (GRID_ZONES.includes(z.type)) {
    const d = GRID_DEFAULTS[z.type]
    zone.cols = int(z.cols, ZONE_GRID.min, ZONE_GRID.max, d.cols)
    zone.rows = int(z.rows, ZONE_GRID.min, ZONE_GRID.max, d.rows)
    zone.font = int(z.font, FONT.min, FONT.max, FONT.default)
    zone.bold = bool(z.bold, true)
    zone.overflow = pick(z.overflow, OVERFLOW_KEYS, d.overflow)
    zone.align = pick(z.align, ALIGN_KEYS, d.align)
    zone.valign = pick(z.valign, VALIGN_KEYS, d.valign)
  }
  if (z.type === 'categories') {
    const ids = Array.isArray(z.sections) ? z.sections.filter(s => UUID.test(String(s))).map(s => String(s).toLowerCase()) : null
    zone.sections = ids ? [...new Set(ids)].slice(0, MAX_SECTIONS) : null
  }
  if (z.type === 'menus') {
    const ids = Array.isArray(z.menu_ids) ? z.menu_ids.filter(m => UUID.test(String(m))).map(m => String(m).toLowerCase()) : null
    zone.menu_ids = ids ? [...new Set(ids)].slice(0, MAX_MENUS) : null
    zone.tap = pick(z.tap, MENU_TAP_KEYS, 'one')
    zone.times_button = bool(z.times_button, true)
    zone.show_times = bool(z.show_times, false)
  }
  if (z.type === 'items') {
    zone.search = bool(z.search, true)
    zone.price = bool(z.price, true)
  }
  if (z.type === 'buttons' || z.type === 'popup') {
    // A repeated id gets a fresh one rather than dropping the button. Close
    // the pop-up only in a pop-up (a Buttons zone is behind an open one).
    const seen = new Set()
    zone.buttons = []
    for (const [j, raw] of (Array.isArray(z.buttons) ? z.buttons : []).slice(0, MAX_BUTTONS).entries()) {
      const b = normaliseButton(raw, zone, j)
      if (!b) continue
      if (b.action === 'close_popup' && z.type !== 'popup') continue
      if (seen.has(b.id)) b.id = freshId(seen, 'b')
      seen.add(b.id)
      zone.buttons.push(b)
    }
  }
  if (z.type === 'popup') {
    zone.title = text(z.title, LABEL_MAX) || 'Pop-up'
    // Its border and shadow; its window controls (its name and an X).
    zone.frame = bool(z.frame, true)
    zone.controls = bool(z.controls, true)
    // How else it closes: a tap outside it, or any of its buttons used.
    zone.close_outside = bool(z.close_outside, true)
    zone.close_on_tap = bool(z.close_on_tap, false)
  }
  if (z.type === 'modifiers') {
    zone.kind = pick(z.kind, CHOICE_KIND_KEYS, 'all')
    zone.cover = pick(z.cover, COVER_KEYS, 'zone')
    zone.show_name = bool(z.show_name, true)
    zone.show_description = bool(z.show_description, true)
    zone.show_prices = bool(z.show_prices, true)
    // More picks, more dishes; adding on the last tap can't go with it.
    zone.split_picks = bool(z.split_picks, false)
    zone.auto_add = bool(z.auto_add, false) && !zone.split_picks
  }
  if (z.type === 'seats') {
    zone.font = int(z.font, FONT.min, FONT.max, FONT.default)
    zone.parts = pick(z.parts, SEAT_PART_KEYS, 'both')
  }
  if (z.type === 'check') {
    zone.font = int(z.font, FONT.min, FONT.max, FONT.default)
    const hide = Array.isArray(z.hide) ? z.hide.filter(k => CHECK_BUTTON_KEYS.includes(k)) : []
    zone.hide = CHECK_BUTTON_KEYS.filter(k => hide.includes(k))
    const c = z.colours && typeof z.colours === 'object' ? z.colours : {}
    zone.colours = Object.fromEntries(COLOUR_KEYS.map(k => [k, HEX.test(String(c[k] || '')) ? String(c[k]).toLowerCase() : null]))
  }
  return zone
}

/** A layout as stored: known zones only, every number inside its limits. */
export function normaliseTillLayout(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const layout = {
    cols: int(r.cols, LAYOUT_COLS.min, LAYOUT_COLS.max, LAYOUT_COLS.default),
    rows: int(r.rows, LAYOUT_ROWS.min, LAYOUT_ROWS.max, LAYOUT_ROWS.default),
    // The till's top bar on the order screen (false: the till menu is in More).
    top_bar: bool(r.top_bar, true),
    zones: [],
  }
  const seen = new Set()
  for (const [i, z] of (Array.isArray(r.zones) ? r.zones : []).slice(0, MAX_ZONES).entries()) {
    const zone = normaliseZone(z, layout, i)
    if (!zone) continue
    // A repeated id gets a fresh one rather than dropping the zone.
    if (seen.has(zone.id)) zone.id = freshId(seen, 'z')
    seen.add(zone.id)
    layout.zones.push(zone)
  }
  // A button that opens a pop-up the layout doesn't have (any more) goes, and
  // a pop-up never opens itself.
  const popups = new Set(layout.zones.filter(z => z.type === 'popup').map(z => z.id))
  for (const z of layout.zones) {
    if (z.buttons) z.buttons = z.buttons.filter(b => b.action !== 'open_popup' || (popups.has(b.popup_id) && b.popup_id !== z.id))
  }
  return layout
}

/**
 * Why nothing could close a pop-up once it is open, or null: it closes with
 * its window controls (the X), a tap outside it, any of its buttons when
 * close_on_tap is on (and it has a button), or a Close the pop-up button.
 */
export function popupCloseProblem(zone) {
  if (!zone || zone.type !== 'popup') return null
  if (zone.controls || zone.close_outside) return null
  const buttons = zone.buttons || []
  if (zone.close_on_tap && buttons.length) return null
  if (buttons.some(b => b.action === 'close_popup')) return null
  return 'Nothing closes a pop-up once it is open (' + (zone.title || 'Pop-up') + '): keep its window controls, let a tap outside close it, close it after a button is used, or add a Close the pop-up button.'
}

function freshId(seen, prefix) {
  for (let n = seen.size + 1; ; n++) if (!seen.has(prefix + n)) return prefix + n
}

/**
 * Where the words go on a zone's buttons, as styles for a button laid out
 * as a column (flex-direction: column): the first line (a name) goes where
 * the zone says (align, valign); a second line (a price, Sold out) sits at
 * the bottom when the words are at the top, else right under the first.
 * The till's buttons and the designer's preview both take it, so the words
 * land in the same place in both.
 */
export function buttonTextStyle(zone) {
  const d = GRID_DEFAULTS[zone?.type] || { align: 'center', valign: 'middle' }
  const align = pick(zone?.align, ALIGN_KEYS, d.align)
  const valign = pick(zone?.valign, VALIGN_KEYS, d.valign)
  return {
    alignItems: { left: 'flex-start', center: 'center', right: 'flex-end' }[align],
    justifyContent: { top: 'space-between', middle: 'center', bottom: 'flex-end' }[valign],
    textAlign: align,
  }
}

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * What stops a layout being saved: [{ code, message, zones }]. A till can
 * still draw a layout with problems; the designer won't save one.
 */
export function layoutProblems(layout) {
  const out = []
  const zones = layout?.zones || []
  const of = type => zones.filter(z => z.type === type)
  if (!of('check').length) out.push({ code: 'no_check', message: 'Add the Order zone: the till needs the order on screen.', zones: [] })
  for (const t of ZONE_TYPES) {
    const list = of(t.key)
    if (list.length > t.max) {
      out.push({ code: 'too_many', message: t.max === 1 ? 'Only one ' + t.label + ' zone.' : 'At most ' + t.max + ' ' + t.label + ' zones.', zones: list.slice(t.max).map(z => z.id) })
    }
  }
  const mods = of('modifiers')
  const kinds = mods.map(z => z.kind)
  if (mods.length > 1 && (kinds.includes('all') || new Set(kinds).size < kinds.length)) {
    out.push({ code: 'choice_kinds', message: 'Two Dish choices zones split the choices: one Must pick and one Optional.', zones: mods.map(z => z.id) })
  }
  const solid = zones.filter(z => !FLOATING_ZONES.includes(z.type))
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlaps(solid[i], solid[j])) {
        out.push({ code: 'overlap', message: zoneLabel(solid[i].type) + ' and ' + zoneLabel(solid[j].type) + ' overlap: only Dish choices and pop-ups can sit over other zones.', zones: [solid[i].id, solid[j].id] })
      }
    }
  }
  for (const p of of('popup')) {
    const why = popupCloseProblem(p)
    if (why) out.push({ code: 'popup_stuck', message: why, zones: [p.id] })
  }
  return out
}

/** Things worth knowing that don't stop a save: [{ code, message, zones }]. */
export function layoutWarnings(layout) {
  const out = []
  const zones = layout?.zones || []
  const has = type => zones.some(z => z.type === type)
  const withButtons = zones.filter(z => z.type === 'buttons' || z.type === 'popup')
  const dishButtons = withButtons.some(z => z.buttons.some(b => b.action === 'item'))
  if (has('categories') && !has('items')) out.push({ code: 'categories_alone', message: 'Categories pick what the Dishes zone shows: add a Dishes zone.', zones: [] })
  if (has('items') && !has('categories')) out.push({ code: 'items_alone', message: 'No Categories zone: the Dishes zone shows every dish, in menu order.', zones: [] })
  if (!has('items') && !dishButtons) out.push({ code: 'no_dishes', message: 'No Dishes zone and no dish buttons: dishes can only be found by name in the search.', zones: [] })
  if (!has('modifiers')) out.push({ code: 'choices_window', message: 'No Dish choices zone: a dish\'s choices open in a window, as on the standard screen.', zones: [] })
  for (const z of zones) {
    if (z.type === 'buttons' && !z.buttons.length) out.push({ code: 'empty_buttons', message: 'A Buttons zone has no buttons yet.', zones: [z.id] })
    if (z.type === 'popup' && !z.buttons.length) out.push({ code: 'empty_popup', message: 'A pop-up has no buttons yet (' + z.title + ').', zones: [z.id] })
    if (z.type === 'popup' && !withButtons.some(o => o.id !== z.id && o.buttons.some(b => b.action === 'open_popup' && b.popup_id === z.id))) {
      out.push({ code: 'popup_unopened', message: 'No button opens a pop-up (' + z.title + '): add an Open a pop-up button for it.', zones: [z.id] })
    }
  }
  // The Order zone's own buttons left out with nothing else doing their job
  // (a button in a pop-up does it too).
  const actions = new Set(withButtons.flatMap(z => z.buttons.map(b => b.action)))
  const check = zones.find(z => z.type === 'check')
  for (const key of check?.hide || []) {
    const b = CHECK_BUTTONS.find(x => x.key === key)
    const covered = key === 'pay' ? PAY_ACTIONS.some(a => actions.has(a)) : actions.has(b.action)
    if (covered) continue
    const after = {
      pay: 'the order can\'t be paid.',
      send: 'nothing can be sent to the kitchen.',
      more: layout.top_bar === false ? 'the order\'s other actions and the till menu can\'t be reached.' : 'the order\'s other actions can\'t be reached.',
      back: layout.top_bar === false ? 'the till menu is the only way off the order (More).' : 'the top bar is the only way off the order.',
      cancel: 'cancel orders from More.',
      bill: 'print bills from More.',
    }[key]
    out.push({ code: 'hidden_button', message: 'The Order zone leaves out ' + b.label + ' and no Buttons zone has it: ' + after, zones: [check.id], button: key })
  }
  const covered = zones.filter(z => z.type === 'modifiers' && z.cover === 'zone')
  for (const m of covered) {
    if (!zones.some(z => !FLOATING_ZONES.includes(z.type) && overlaps(z, m))) {
      out.push({ code: 'choices_space', message: 'A Dish choices zone has its own space: it stays empty until a dish with choices is tapped.', zones: [m.id] })
    }
  }
  return out
}

/**
 * Which modifiers zone shows which choices: { required, optional } (a zone,
 * or null when the layout has none: the choices window then). With one
 * zone it shows both; Must pick and Optional split them, and either takes
 * the other's when it is missing.
 */
export function choiceZones(layout) {
  const mods = (layout?.zones || []).filter(z => z.type === 'modifiers')
  const by = k => mods.find(z => z.kind === k) || null
  const all = by('all')
  return {
    required: by('required') || all || by('optional'),
    optional: by('optional') || all || by('required'),
  }
}

/**
 * Lays out cells ({ w, h }, in order) in a zone's grid. Returns
 * { pages: [[{ i, x, y, w, h }]], rest: [i], rows }: pages of placements,
 * the cells behind a More button (overflow 'more'), and the rows a scroll
 * needs. Overflow scroll: one page carrying on down, or across in a
 * one-row zone (cells then one row high); pages: as many pages as needed;
 * more: what fits with the last cell kept for More, the rest behind it;
 * hide: what fits on the first page. A cell takes the first free place,
 * row by row; a cell bigger than the grid is cut down to it.
 */
export function packCells(cells, { cols, rows, overflow }) {
  cols = Math.max(1, cols | 0)
  rows = Math.max(1, rows | 0)
  const size = cells.map(c => ({ w: Math.min(cols, Math.max(1, c?.w | 0 || 1)), h: Math.min(rows, Math.max(1, c?.h | 0 || 1)) }))
  if (overflow === 'scroll' && rows === 1 && cols > 1) {
    // Across: one row, as many columns as it takes.
    let x = 0
    const page = size.map((s, i) => { const p = { i, x, y: 0, w: s.w, h: 1 }; x += s.w; return p })
    return { pages: [page], rest: [], hidden: 0, rows: 1, cols: Math.max(cols, x) }
  }
  if (overflow === 'scroll') {
    const grid = new Grid(cols, Infinity)
    const page = size.map((s, i) => ({ i, ...grid.place(s.w, s.h), w: s.w, h: s.h }))
    return { pages: [page], rest: [], hidden: 0, rows: Math.max(rows, grid.used), cols }
  }
  if (overflow === 'more') {
    const one = new Grid(cols, rows)
    const all = size.map((s, i) => one.fits(s.w, s.h) ? { i, ...one.place(s.w, s.h), w: s.w, h: s.h } : null)
    if (all.every(Boolean)) return { pages: [all], rest: [], hidden: 0, rows, cols }
    // Not everything fits: keep the last cell for More.
    const grid = new Grid(cols, rows)
    grid.block(cols - 1, rows - 1)
    const page = []
    const rest = []
    size.forEach((s, i) => {
      if (!rest.length && grid.fits(s.w, s.h)) page.push({ i, ...grid.place(s.w, s.h), w: s.w, h: s.h })
      else rest.push(i)
    })
    return { pages: [page], rest, hidden: 0, rows, cols }
  }
  // Pages, or (hide) the first page and nothing after the first cell that doesn't fit.
  const pages = [[]]
  let grid = new Grid(cols, rows)
  for (let i = 0; i < size.length; i++) {
    const s = size[i]
    if (!grid.fits(s.w, s.h)) {
      if (overflow === 'hide') return { pages, rest: [], hidden: size.length - i, rows, cols }
      grid = new Grid(cols, rows)
      pages.push([])
    }
    pages[pages.length - 1].push({ i, ...grid.place(s.w, s.h), w: s.w, h: s.h })
  }
  return { pages, rest: [], hidden: 0, rows, cols }
}

// Free cells of one page, filled row by row. rows Infinity grows as needed.
class Grid {
  constructor(cols, rows) {
    this.cols = cols
    this.rows = rows
    this.taken = new Set()
    this.used = 0
  }
  free(x, y, w, h) {
    if (x + w > this.cols || y + h > this.rows) return false
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (this.taken.has((y + dy) * 1000 + x + dx)) return false
    return true
  }
  spot(w, h) {
    const limit = Number.isFinite(this.rows) ? this.rows : this.used + h + 1
    for (let y = 0; y + h <= limit; y++) for (let x = 0; x + w <= this.cols; x++) if (this.free(x, y, w, h)) return { x, y }
    return null
  }
  fits(w, h) { return !!this.spot(w, h) }
  place(w, h) {
    const at = this.spot(w, h)
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.taken.add((at.y + dy) * 1000 + at.x + dx)
    this.used = Math.max(this.used, at.y + h)
    return at
  }
  block(x, y) { this.taken.add(y * 1000 + x) }
}

/** A button's words: its own label, else from what it does. */
export function buttonLabel(b, { items = {}, presets = [], tenders = [], charges = [], popups = [] } = {}) {
  if (b?.label) return b.label
  if (b?.action === 'item') return items[b.item_id]?.name || 'Dish no longer on the menu'
  if (b?.action === 'open_popup') return popups.find(p => p.id === b.popup_id)?.title || 'Pop-up no longer in the layout'
  if (b?.action === 'close_popup') return 'Close'
  if (b?.action === 'discount_preset') return presets.find(p => p.id === b.preset_id)?.name || 'Discount no longer on the list'
  if (b?.action === 'charge') return charges.find(x => x.id === b.charge_id)?.name || 'Charge no longer on the list'
  if (b?.action === 'tender') {
    const t = tenders.find(x => x.key === b.tender)
    return 'Pay by ' + (t?.label || b.tender)
  }
  return actionOf(b?.action)?.label || ''
}

/**
 * Drops what a layout names that isn't the company's: sections, menus,
 * dishes, discounts and charges (sets of ids). Buttons (in Buttons zones and
 * pop-ups) pointing at another tenant's dish, discount or charge go; a
 * categories list keeps only the company's sections, a menus list only its
 * menus.
 */
export function ownLayout(layout, { sectionIds, itemIds, presetIds, menuIds, chargeIds }) {
  const has = (set, id) => (set instanceof Set ? set.has(id) : (set || []).includes(id))
  return {
    ...layout,
    zones: layout.zones.map(z => {
      if (z.type === 'categories' && z.sections) return { ...z, sections: z.sections.filter(id => has(sectionIds, id)) }
      if (z.type === 'menus' && z.menu_ids) return { ...z, menu_ids: z.menu_ids.filter(id => has(menuIds, id)) }
      if (z.type === 'buttons' || z.type === 'popup') {
        return {
          ...z,
          buttons: z.buttons.filter(b => (b.action !== 'item' || has(itemIds, b.item_id)) && (b.action !== 'discount_preset' || has(presetIds, b.preset_id))
            && (b.action !== 'charge' || has(chargeIds, b.charge_id))),
        }
      }
      return z
    }),
  }
}

/** Every dish, section, menu, discount and charge id a layout names (for ownLayout()). */
export function layoutIds(layout) {
  const items = new Set()
  const sections = new Set()
  const presets = new Set()
  const menus = new Set()
  const charges = new Set()
  for (const z of layout?.zones || []) {
    for (const s of z.sections || []) sections.add(s)
    for (const m of z.menu_ids || []) menus.add(m)
    for (const b of z.buttons || []) {
      if (b.item_id) items.add(b.item_id)
      if (b.preset_id) presets.add(b.preset_id)
      if (b.charge_id) charges.add(b.charge_id)
    }
  }
  return { items: [...items], sections: [...sections], presets: [...presets], menus: [...menus], charges: [...charges] }
}

/**
 * The menus a Menus zone offers on a till, from the till's menus ({ id,
 * name, times }, in the till's order): the ones the zone picked, in the
 * zone's order, else (none picked, or none of them on this till) all of them.
 */
export function menuZoneMenus(zone, menus) {
  const list = menus || []
  if (!zone?.menu_ids) return list
  const picked = zone.menu_ids.map(id => list.find(m => m.id === id)).filter(Boolean)
  return picked.length ? picked : list
}

// Starting points for a new layout. standard: the standard screen as a
// layout (the order on the left, categories across the top, dishes, seats);
// quick: counter service with categories down the side, the must-pick
// choices over the dishes, the optional ones in a strip and paying buttons.
export const LAYOUT_TEMPLATES = [
  { key: 'standard', label: 'Like the standard screen' },
  { key: 'quick', label: 'Quick service' },
]

export function templateLayout(key = 'standard') {
  if (key === 'quick') {
    return normaliseTillLayout({
      cols: 12, rows: 8,
      zones: [
        { id: 'check', type: 'check', x: 0, y: 0, w: 4, h: 8 },
        { id: 'cats', type: 'categories', x: 4, y: 0, w: 2, h: 6, cols: 1, rows: 6, overflow: 'pages', font: 16 },
        { id: 'dishes', type: 'items', x: 6, y: 0, w: 6, h: 6, cols: 3, rows: 4, overflow: 'pages', font: 18, search: false },
        { id: 'must', type: 'modifiers', x: 4, y: 0, w: 8, h: 6, kind: 'required', cover: 'zone', cols: 4, rows: 4, font: 18 },
        { id: 'extra', type: 'modifiers', x: 4, y: 6, w: 8, h: 2, kind: 'optional', cover: 'zone', cols: 6, rows: 2, font: 15, overflow: 'pages' },
        {
          id: 'pay', type: 'buttons', x: 4, y: 6, w: 8, h: 2, cols: 4, rows: 2, overflow: 'pages', font: 16,
          buttons: [
            { id: 'cash', action: 'exact_cash', colour: '#15803d', h: 2 },
            { id: 'card', action: 'exact_card', colour: '#1d4ed8', h: 2 },
            { id: 'receipt', action: 'last_receipt' },
            { id: 'drawer', action: 'no_sale' },
            { id: 'discount', action: 'discount' },
            { id: 'more', action: 'more' },
          ],
        },
      ],
    })
  }
  return normaliseTillLayout({
    cols: 12, rows: 8,
    zones: [
      { id: 'check', type: 'check', x: 0, y: 0, w: 5, h: 8 },
      { id: 'cats', type: 'categories', x: 5, y: 0, w: 7, h: 1, cols: 5, rows: 1, overflow: 'scroll', font: 16 },
      { id: 'dishes', type: 'items', x: 5, y: 1, w: 7, h: 6, cols: 4, rows: 5, overflow: 'scroll', font: 15, search: true },
      { id: 'seats', type: 'seats', x: 5, y: 7, w: 7, h: 1 },
    ],
  })
}
