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
//   items       the dishes of the section picked in the Categories zone it
//               follows (with a search box on top if set)
//   category    the dishes of one section picked in the designer (section_id),
//               always there whatever the Categories zone shows: a Drinks zone,
//               a Sides zone (up to 8 on a layout)
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
// The Dishes zone and a category's dishes zone can leave dishes out
// (hide_item_ids): they never show in that zone, its search included, but
// stay on the menu everywhere else (shownDishIds()).
//
// Several Dishes zones (14 Nov 2026): a layout can have up to four Dishes
// zones and four Categories zones (food and drinks side by side). Each
// Dishes zone follows one Categories zone (follows: its id; null, or a zone
// the layout doesn't have, means the first): it shows the dishes of the
// category open there (categoriesZoneOf()). Each Categories zone keeps its
// own open category on the till. A Categories zone no Dishes zone follows,
// and two Dishes zones following the same one, are warnings.
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
//
// Phone layouts (12 Nov 2026). The other zones can show as a pop-up too
// (show: 'popup' on the Order, Categories, Menus, Dishes, a category's
// dishes and Seat and course zones; POPUP_ZONES): hidden until an Open a
// pop-up button names them, with a Pop-up zone's own options (title, frame,
// controls, close_outside, close_on_tap = after a category, menu, dish or
// seat is tapped; never for the Order zone). Every pop-up, the Pop-up zone
// included, draws over its own cells or over the whole screen (cover:
// 'zone' | 'screen', a full takeover: a tap outside can't close that one).
// isPopup() says a zone is a pop-up and floats() that it shows only some of
// the time (a pop-up or a Dish choices zone): floating zones may sit over
// other zones and are never in the till's grid of zones. An Order zone that
// is a pop-up needs a button that opens it (problem order_unopened): the
// till shows the order's items and total on that button (and the category
// open, or the seat and course picked, on the button that opens those).
// A button opens a pop-up only when it can be tapped: popupOpeners() marks
// one its zone leaves out (overflow 'hide' and it doesn't fit:
// leftOutButtons()) left_out, and one in a pop-up nothing gets to
// (reachablePopups()) shut; a pop-up with no button that works counts as
// unopened.
// While a pop-up is open the rest of the screen waits behind it.
//
// A zone with buttons can be a list (view: 'list'): one column (cols is
// kept at 1), each button a row with its words on the left and its second
// line (a price, the order's total) on the right (buttonTextStyle()); a
// scrolling list keeps its rows finger-sized on a short screen (the till).
//
// A layout made for a phone says so (phone: true): the designer previews it
// on a phone, and a till on a phone-sized screen draws only phone layouts
// (pos/src/lib/tillLayout.js: any other layout, or none, gives way to the
// phone template there). LAYOUT_TEMPLATES has three phone starting points.
//
// The look (14 Nov 2026). A Label zone (label) is words on the screen in the
// size, colour and place set (text, font, colour, bold, align, valign).
// Every zone but the Order can have a background colour (background; the
// Order keeps its white panel), every zone a border (border: { style none |
// thin | bold | dotted, colour }) and every zone with buttons a border for
// its buttons (button_border: { style standard | none | thin | bold |
// dotted, colour }; standard: each button's own). The layout has its own
// background behind the zones (background: the gaps and the cells no zone
// takes). A category's dishes zone can colour its dish buttons
// (button_colour, button_text) and show the category's name above them
// (show_name, name_font, name_colour). The till and the designer draw them
// through zoneBoxStyle(), buttonBorderStyle() and categoryButtonStyle().
// copyZone() copies a zone a layout can have several of, placed where it fits.

export const LAYOUT_COLS = { min: 4, max: 24, default: 12 }
export const LAYOUT_ROWS = { min: 3, max: 16, default: 8 }
export const ZONE_GRID = { min: 1, max: 12 }
export const FONT = { min: 12, max: 36, default: 16 }
export const MAX_ZONES = 50
export const MAX_BUTTONS = 80
export const MAX_SECTIONS = 100
export const MAX_MENUS = 30
export const MAX_HIDDEN = 300
export const LABEL_MAX = 40
// A Label zone's words and their size; a category's name above its dishes.
export const LABEL_TEXT_MAX = 200
export const LABEL_FONT = { min: 10, max: 72, default: 24 }
export const NAME_FONT = { min: 12, max: 48, default: 18 }
// The till's dark ink: a border's colour when none is set.
const INK = '#1f2a44'

// A zone's border, and the border of the buttons in it (standard: each
// button's own).
export const BORDER_STYLES = [
  { key: 'none', label: 'None' },
  { key: 'thin', label: 'Thin' },
  { key: 'bold', label: 'Bold' },
  { key: 'dotted', label: 'Dotted' },
]
export const BORDER_STYLE_KEYS = BORDER_STYLES.map(b => b.key)
export const BUTTON_BORDERS = [{ key: 'standard', label: 'Standard' }, ...BORDER_STYLES]
export const BUTTON_BORDER_KEYS = BUTTON_BORDERS.map(b => b.key)
const BORDER_WIDTHS = { thin: 1, bold: 3, dotted: 2 }

export const ZONE_TYPES = [
  { key: 'check', label: 'Order', hint: 'The order: its dishes, totals and More, Send, Bill and Pay.', max: 1 },
  { key: 'categories', label: 'Categories', hint: 'The menu sections as buttons. Pick which ones show, in your order. With several (food, drinks), each shows its dishes in the Dishes zones that follow it.', max: 4 },
  { key: 'menus', label: 'Menus', hint: 'The till\'s menus as buttons: tap one to show it. Pick which ones show, in your order.', max: 1 },
  { key: 'items', label: 'Dishes', hint: 'The dishes of the category picked in the Categories zone it follows, with a search box if you want one.', max: 4 },
  { key: 'category', label: 'A category\'s dishes', hint: 'The dishes of one category you pick, always on screen (a Drinks zone, a Sides zone). Leave out any you don\'t want in it.', max: 8 },
  { key: 'buttons', label: 'Buttons', hint: 'Your own buttons: a dish, or a function such as Exact cash or Last receipt.', max: 8 },
  { key: 'modifiers', label: 'Dish choices', hint: 'A dish\'s choices while it is being added: the must-pick ones, the optional ones, or both.', max: 2 },
  { key: 'seats', label: 'Seat and course', hint: 'The seat and course the next dish goes to (or just one of them).', max: 1 },
  { key: 'popup', label: 'Pop-up', hint: 'Buttons that show only when a button opens them, over the part of the screen you place them on.', max: 8 },
  { key: 'label', label: 'Label', hint: 'Words on the screen: a heading or a note, in the size and colour you pick.', max: 12 },
]
export const ZONE_KEYS = ZONE_TYPES.map(t => t.key)
export const zoneLabel = type => ZONE_TYPES.find(t => t.key === type)?.label || type
// Zones with a grid of buttons.
export const GRID_ZONES = ['categories', 'menus', 'items', 'category', 'buttons', 'modifiers', 'popup']
// Zones with buttons, whose border can be set (button_border): every zone but a Label.
export const BUTTON_ZONES = [...GRID_ZONES, 'check', 'seats']

// Zones that can show as a pop-up instead of always (show: 'popup'). Buttons
// have the Pop-up zone for that; Dish choices float by themselves.
export const POPUP_ZONES = ['check', 'categories', 'menus', 'items', 'category', 'seats']
export const SHOWS = [
  { key: 'always', label: 'Always' },
  { key: 'popup', label: 'As a pop-up' },
]
export const SHOW_KEYS = SHOWS.map(s => s.key)
/** A zone that shows only when a button opens it: a Pop-up zone, or any zone shown as a pop-up. */
export const isPopup = z => !!z && (z.type === 'popup' || z.show === 'popup')
/**
 * A zone that shows only some of the time (a pop-up, or a Dish choices
 * zone): it may sit over other zones and is never in the till's grid of
 * zones. The one rule for the overlap problem, the till and the designer.
 */
export const floats = z => !!z && (z.type === 'modifiers' || isPopup(z))
// What a pop-up is called when it has no name of its own.
const POPUP_NAMES = { check: 'Order', categories: 'Categories', menus: 'Menus', items: 'Dishes', category: 'Dishes', seats: 'Seat and course' }
/** A pop-up's name: its own, else what it shows (Order, Categories, Dishes ...). */
export const popupTitle = z => z?.title || POPUP_NAMES[z?.type] || 'Pop-up'
// Closing after it is used, when a zone first becomes a pop-up: a category
// or a menu is one pick; dishes and seats are tapped several times.
const CLOSE_ON_TAP = { categories: true, menus: true }

// How a zone with buttons draws them: a grid, or a list (one column of rows).
export const VIEWS = [
  { key: 'grid', label: 'Grid' },
  { key: 'list', label: 'List' },
]
export const VIEW_KEYS = VIEWS.map(v => v.key)
export const isList = z => z?.view === 'list'

// More than fits: carry on in a scroll (down, or across in a one-row zone),
// in pages with arrows, behind a More button in the last cell, or not at all.
export const OVERFLOWS = [
  { key: 'scroll', label: 'Scroll' },
  { key: 'pages', label: 'Pages' },
  { key: 'more', label: 'More button' },
  { key: 'hide', label: 'Hide the rest' },
]
export const OVERFLOW_KEYS = OVERFLOWS.map(o => o.key)

// Which choices a modifiers zone shows, and where it (or a pop-up) draws.
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
const hex = v => (HEX.test(String(v || '')) ? String(v).toLowerCase() : null)
function normaliseBorder(b, keys, dflt) {
  const r = b && typeof b === 'object' ? b : {}
  return { style: pick(r.style, keys, dflt), colour: hex(r.colour) }
}

// A zone's own button grid when nothing is set (align / valign: where the
// words sit, as each zone drew them before they could be set).
const GRID_DEFAULTS = {
  categories: { cols: 6, rows: 1, overflow: 'scroll', align: 'center', valign: 'middle' },
  menus: { cols: 4, rows: 1, overflow: 'scroll', align: 'center', valign: 'middle' },
  items: { cols: 4, rows: 4, overflow: 'scroll', align: 'left', valign: 'top' },
  category: { cols: 4, rows: 2, overflow: 'scroll', align: 'left', valign: 'top' },
  buttons: { cols: 4, rows: 2, overflow: 'pages', align: 'center', valign: 'middle' },
  modifiers: { cols: 4, rows: 4, overflow: 'scroll', align: 'left', valign: 'top' },
  popup: { cols: 3, rows: 2, overflow: 'pages', align: 'center', valign: 'middle' },
}

/** A zone type's own button grid when nothing is set (the designer goes back to it from a list). */
export const gridDefaults = type => ({ ...(GRID_DEFAULTS[type] || GRID_DEFAULTS.buttons) })

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
    // A list is one column of rows.
    zone.view = pick(z.view, VIEW_KEYS, 'grid')
    if (zone.view === 'list') zone.cols = 1
  }
  if (POPUP_ZONES.includes(z.type)) {
    zone.show = pick(z.show, SHOW_KEYS, 'always')
    if (zone.show === 'popup') {
      // Its own name (none: what it shows, popupTitle()).
      zone.title = text(z.title, LABEL_MAX) || null
      popupFields(zone, z)
    }
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
    // The Categories zone it follows (checked in normaliseTillLayout(); null: the first).
    zone.follows = ID.test(String(z.follows || '')) ? String(z.follows) : null
  }
  if (z.type === 'category') {
    zone.section_id = UUID.test(String(z.section_id || '')) ? String(z.section_id).toLowerCase() : null
    zone.price = bool(z.price, true)
    // Its dish buttons' colour and their words' colour (none: the till's
    // own look; words left to the colour are made readable on it), and the
    // category's name above them.
    zone.button_colour = hex(z.button_colour)
    zone.button_text = hex(z.button_text)
    zone.show_name = bool(z.show_name, false)
    zone.name_font = int(z.name_font, NAME_FONT.min, NAME_FONT.max, NAME_FONT.default)
    zone.name_colour = hex(z.name_colour)
  }
  if (z.type === 'items' || z.type === 'category') {
    const ids = Array.isArray(z.hide_item_ids) ? z.hide_item_ids.filter(i => UUID.test(String(i))).map(i => String(i).toLowerCase()) : []
    zone.hide_item_ids = [...new Set(ids)].slice(0, MAX_HIDDEN)
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
    popupFields(zone, z)
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
  if (z.type === 'label') {
    // Its words as typed (lines kept), their size, colour (none: the zone's
    // words colour) and where they sit.
    zone.text = typeof z.text === 'string' ? z.text.replace(/\r\n?/g, '\n').trim().slice(0, LABEL_TEXT_MAX) : ''
    zone.font = int(z.font, LABEL_FONT.min, LABEL_FONT.max, LABEL_FONT.default)
    zone.colour = hex(z.colour)
    zone.bold = bool(z.bold, true)
    zone.align = pick(z.align, ALIGN_KEYS, 'center')
    zone.valign = pick(z.valign, VALIGN_KEYS, 'middle')
  }
  // Every zone's look: its border, its background (not the Order's: it
  // keeps its white panel) and the border of its buttons.
  zone.border = normaliseBorder(z.border, BORDER_STYLE_KEYS, 'none')
  if (z.type !== 'check') zone.background = hex(z.background)
  if (BUTTON_ZONES.includes(z.type)) zone.button_border = normaliseBorder(z.button_border, BUTTON_BORDER_KEYS, 'standard')
  return zone
}

// What every pop-up has (a Pop-up zone, or a zone shown as one).
function popupFields(zone, z) {
  // Over its own cells, or over the whole screen (a takeover).
  zone.cover = pick(z.cover, COVER_KEYS, 'zone')
  // Its border and shadow; its window controls (its name and an X).
  zone.frame = bool(z.frame, true)
  zone.controls = bool(z.controls, true)
  // How else it closes: a tap outside it, or after it is used (any of its
  // buttons; a category, menu, dish or seat tapped; never the Order zone).
  zone.close_outside = bool(z.close_outside, true)
  zone.close_on_tap = zone.type === 'check' ? false : bool(z.close_on_tap, CLOSE_ON_TAP[zone.type] || false)
}

/** A layout as stored: known zones only, every number inside its limits. */
export function normaliseTillLayout(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const layout = {
    cols: int(r.cols, LAYOUT_COLS.min, LAYOUT_COLS.max, LAYOUT_COLS.default),
    rows: int(r.rows, LAYOUT_ROWS.min, LAYOUT_ROWS.max, LAYOUT_ROWS.default),
    // The till's top bar on the order screen (false: the till menu is in More).
    top_bar: bool(r.top_bar, true),
    // Made for a phone: previewed on one, and what a phone-sized till draws.
    phone: bool(r.phone, false),
    // Behind the zones: the gaps between them and the cells no zone takes
    // (none: the till's own grey).
    background: hex(r.background),
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
  const popups = new Set(layout.zones.filter(isPopup).map(z => z.id))
  for (const z of layout.zones) {
    if (z.buttons) z.buttons = z.buttons.filter(b => b.action !== 'open_popup' || (popups.has(b.popup_id) && b.popup_id !== z.id))
  }
  // A Dishes zone follows a Categories zone of this layout, or the first one.
  const cats = new Set(layout.zones.filter(z => z.type === 'categories').map(z => z.id))
  for (const z of layout.zones) if (z.type === 'items' && z.follows && !cats.has(z.follows)) z.follows = null
  return layout
}

/**
 * The Categories zone a Dishes zone follows: the one it names (follows),
 * else the layout's first; null when the layout has none (the Dishes zone
 * then shows every dish of the menus on now). The one rule for the till,
 * the designer and the warnings.
 */
export function categoriesZoneOf(layout, zone) {
  const cats = (layout?.zones || []).filter(z => z.type === 'categories')
  return cats.find(z => z.id === zone?.follows) || cats[0] || null
}

/** The Dishes zones that follow a Categories zone (categoriesZoneOf()), in the layout's order. */
export function dishesZonesOf(layout, cats) {
  if (!cats) return []
  return (layout?.zones || []).filter(z => z.type === 'items' && categoriesZoneOf(layout, z)?.id === cats.id)
}

// A zone as messages name it: Dishes, or Dishes 2 when the layout has several.
function nthName(layout, z) {
  const same = (layout?.zones || []).filter(x => x.type === z.type)
  return zoneLabel(z.type) + (same.length > 1 ? ' ' + (same.indexOf(z) + 1) : '')
}

// Names in a sentence: A, A and B, A, B and C.
function andList(names) {
  return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

/**
 * The buttons of a Buttons zone or a Pop-up zone that never show: with When
 * more than fits = Hide the rest (overflow 'hide'), the ones from the first
 * that doesn't fit on (packCells()). Scroll, pages and More keep every
 * button in reach.
 */
export function leftOutButtons(zone) {
  const buttons = zone?.buttons || []
  if (zone?.overflow !== 'hide' || !buttons.length) return []
  const { hidden } = packCells(buttons.map(x => ({ w: x.w, h: x.h })), zone)
  return hidden ? buttons.slice(-hidden) : []
}

/**
 * The pop-ups a person can get to, as a Set of zone ids: opened by a button
 * that shows (not left out of its zone) in a Buttons zone, which is always
 * there, or in a pop-up they can get to. A pop-up whose only buttons sit in
 * pop-ups nothing opens (or in each other) is never reached.
 */
export function reachablePopups(layout) {
  const zones = layout?.zones || []
  const open = new Set()
  for (let grew = true; grew;) {
    grew = false
    for (const z of zones) {
      if (!z.buttons?.length || (isPopup(z) && !open.has(z.id))) continue
      const hidden = new Set(leftOutButtons(z).map(x => x.id))
      for (const b of z.buttons) {
        if (b.action !== 'open_popup' || !b.popup_id || hidden.has(b.id) || open.has(b.popup_id)) continue
        open.add(b.popup_id)
        grew = true
      }
    }
  }
  return open
}

/**
 * The buttons that open a pop-up: [{ zone, button, left_out, shut, works }],
 * the Open a pop-up buttons naming it in Buttons zones and in other pop-ups.
 * left_out: the button doesn't fit in its zone and that zone leaves out what
 * doesn't fit (leftOutButtons()). shut: its zone is a pop-up nothing gets to
 * (reachablePopups()). Either way it can't be tapped on the till; works says
 * it can.
 */
export function popupOpeners(layout, popupId) {
  const out = []
  const reach = reachablePopups(layout)
  for (const z of layout?.zones || []) {
    if (z.id === popupId || !z.buttons?.length) continue
    const hidden = new Set(leftOutButtons(z).map(x => x.id))
    const shut = isPopup(z) && !reach.has(z.id)
    for (const x of z.buttons) {
      if (x.action !== 'open_popup' || x.popup_id !== popupId) continue
      const leftOut = hidden.has(x.id)
      out.push({ zone: z, button: x, left_out: leftOut, shut, works: !leftOut && !shut })
    }
  }
  return out
}

/**
 * Why no button opens a pop-up, or null when one does: { why: 'none' |
 * 'left_out' | 'shut', zone } with the zone to look at for the last two (the
 * one holding a button that doesn't fit, where making room fixes it, before
 * a pop-up nothing opens).
 */
export function unopenedWhy(layout, popupId) {
  const openers = popupOpeners(layout, popupId)
  if (!openers.length) return { why: 'none', zone: null }
  if (openers.some(o => o.works)) return null
  const out = openers.find(o => o.left_out && !o.shut)
  return out ? { why: 'left_out', zone: out.zone } : { why: 'shut', zone: openers[0].zone }
}

/**
 * Why nothing could close a pop-up once it is open, or null: it closes with
 * its window controls (the X), a tap outside it (not when it takes the whole
 * screen: nothing is outside), after it is used when close_on_tap is on (a
 * Pop-up zone needs a button for that; the Order zone never closes that
 * way), or a Close the pop-up button (Pop-up zones).
 */
export function popupCloseProblem(zone) {
  if (!isPopup(zone)) return null
  if (zone.controls) return null
  if (zone.close_outside && zone.cover !== 'screen') return null
  if (zone.type === 'popup') {
    const buttons = zone.buttons || []
    if (zone.close_on_tap && buttons.length) return null
    if (buttons.some(b => b.action === 'close_popup')) return null
  } else if (zone.close_on_tap) return null
  return 'Nothing closes a pop-up once it is open (' + popupTitle(zone) + '): keep its window controls'
    + (zone.cover === 'screen' ? '' : ', let a tap outside close it')
    + (zone.type === 'check' ? '.' : zone.type === 'popup' ? ', close it after a button is used, or add a Close the pop-up button.' : ', or close it after it is used.')
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
 * land in the same place in both. In a list (view: 'list') the button is a
 * row instead: its words on the left, its second line on the right.
 */
export function buttonTextStyle(zone) {
  // A list: a row, the words on the left and the second line on the right.
  if (isList(zone)) return { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', columnGap: '0.6em' }
  const d = GRID_DEFAULTS[zone?.type] || { align: 'center', valign: 'middle' }
  const align = pick(zone?.align, ALIGN_KEYS, d.align)
  const valign = pick(zone?.valign, VALIGN_KEYS, d.valign)
  return {
    alignItems: { left: 'flex-start', center: 'center', right: 'flex-end' }[align],
    justifyContent: { top: 'space-between', middle: 'center', bottom: 'flex-end' }[valign],
    textAlign: align,
  }
}

/**
 * Dark or white words on a colour (#rrggbb), by the till's own rule
 * (inkOn() in pos/src/components/ui.jsx): for a zone's background and a
 * category's dish buttons.
 */
export function inkOnColour(colour) {
  const n = parseInt(String(colour).slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111827' : '#ffffff'
}

/**
 * The words on a zone with a background of its own: { ink, muted } (muted:
 * notes, counts, empty lists), or null when it has none (the till's own).
 */
export function zoneInk(zone) {
  if (!zone?.background) return null
  const ink = inkOnColour(zone.background)
  return { ink, muted: ink === '#ffffff' ? 'rgba(255, 255, 255, 0.75)' : 'rgba(17, 24, 39, 0.7)' }
}

/**
 * A zone's own box, as styles: its background with the words on it (color,
 * and --zone-muted for the zone-muted class) and its border. Nothing set:
 * no styles (the till's white box).
 */
export function zoneBoxStyle(zone) {
  const out = {}
  const ink = zoneInk(zone)
  if (ink) Object.assign(out, { background: zone.background, color: ink.ink, '--zone-muted': ink.muted })
  const b = zone?.border
  const w = BORDER_WIDTHS[b?.style]
  if (w) out.border = w + 'px ' + (b.style === 'dotted' ? 'dotted' : 'solid') + ' ' + (b.colour || INK)
  return out
}

/**
 * The border of a zone's buttons (button_border), as styles laid over each
 * button's own: standard leaves its own; none takes it away; thin, bold and
 * dotted set its width and style, and its colour when one is set (none:
 * each button keeps its own colour).
 */
export function buttonBorderStyle(zone) {
  const b = zone?.button_border
  const w = BORDER_WIDTHS[b?.style]
  if (b?.style === 'none') return { borderWidth: '0px' }
  if (!w) return {}
  return { borderWidth: w + 'px', borderStyle: b.style === 'dotted' ? 'dotted' : 'solid', ...(b.colour ? { borderColor: b.colour } : {}) }
}

/**
 * A category's dishes zone's dish buttons, as styles: its button colour
 * with words in its words colour, else made readable on it. Nothing set (or
 * another kind of zone): no styles (the till's own look).
 */
export function categoryButtonStyle(zone) {
  if (zone?.type !== 'category') return {}
  const bg = zone.button_colour
  const ink = zone.button_text || (bg ? inkOnColour(bg) : null)
  return { ...(bg ? { background: bg, borderColor: bg } : {}), ...(ink ? { color: ink } : {}) }
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
  const solid = zones.filter(z => !floats(z))
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlaps(solid[i], solid[j])) {
        out.push({ code: 'overlap', message: zoneLabel(solid[i].type) + ' and ' + zoneLabel(solid[j].type) + ' overlap: only Dish choices and pop-ups can sit over other zones.', zones: [solid[i].id, solid[j].id] })
      }
    }
  }
  for (const p of zones.filter(isPopup)) {
    const why = popupCloseProblem(p)
    if (why) out.push({ code: 'popup_stuck', message: why, zones: [p.id] })
  }
  // The order has to be reachable: as a pop-up it needs a button that opens
  // it, and one that can be tapped (a button its zone leaves out, or one in
  // a pop-up nothing opens, opens nothing).
  for (const c of of('check').slice(0, 1)) {
    if (!isPopup(c)) continue
    const u = unopenedWhy(layout, c.id)
    if (!u) continue
    out.push(u.why === 'none'
      ? { code: 'order_unopened', message: 'The Order zone is a pop-up and nothing opens it: add an Open a pop-up button for it (it shows the order\'s items and total).', zones: [c.id] }
      : u.why === 'left_out'
        ? { code: 'order_unopened', message: 'The button that opens the order doesn\'t fit in its zone and is left out, so nothing opens the order: make room for it there (fewer or smaller buttons, more buttons across or down, or another When more than fits).', zones: [u.zone.id, c.id] }
        : { code: 'order_unopened', message: 'The button that opens the order is in a pop-up nothing opens (' + popupTitle(u.zone) + '), so nothing opens the order: add a button that opens that pop-up, or one for the order in a Buttons zone.', zones: [u.zone.id, c.id] })
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
  const cats = zones.filter(z => z.type === 'categories')
  const dishes = zones.filter(z => z.type === 'items')
  if (cats.length && !dishes.length) out.push({ code: 'categories_alone', message: 'Categories pick what the Dishes zone shows: add a Dishes zone.', zones: [] })
  if (dishes.length && !cats.length) {
    out.push({ code: 'items_alone', message: dishes.length > 1 ? 'No Categories zone: the Dishes zones show every dish, in menu order.' : 'No Categories zone: the Dishes zone shows every dish, in menu order.', zones: [] })
  }
  if (dishes.length) {
    for (const c of cats) {
      const followers = dishesZonesOf(layout, c)
      if (!followers.length) {
        out.push({ code: 'categories_alone', message: 'No Dishes zone follows ' + nthName(layout, c) + ', so its categories show no dishes: set a Dishes zone to follow it.', zones: [c.id] })
      } else if (followers.length > 1) {
        out.push({
          code: 'same_dishes',
          message: andList(followers.map(z => nthName(layout, z))) + (cats.length > 1
            ? ' follow the same Categories zone (' + nthName(layout, c) + '), so they show the dishes of the same category: set one to follow another.'
            : ' follow the one Categories zone, so they show the dishes of the same category: add another Categories zone for one of them to follow.'),
          zones: followers.map(z => z.id),
        })
      }
    }
  }
  if (!has('items') && !has('category') && !dishButtons) out.push({ code: 'no_dishes', message: 'No Dishes zone and no dish buttons: dishes can only be found by name in the search.', zones: [] })
  if (!has('modifiers')) out.push({ code: 'choices_window', message: 'No Dish choices zone: a dish\'s choices open in a window, as on the standard screen.', zones: [] })
  for (const z of zones) {
    if (z.type === 'category' && !z.section_id) out.push({ code: 'category_unset', message: 'A category\'s dishes zone has no category picked yet.', zones: [z.id] })
    if (z.type === 'buttons' && !z.buttons.length) out.push({ code: 'empty_buttons', message: 'A Buttons zone has no buttons yet.', zones: [z.id] })
    if (z.type === 'popup' && !z.buttons.length) out.push({ code: 'empty_popup', message: 'A pop-up has no buttons yet (' + z.title + ').', zones: [z.id] })
    if (z.type === 'label' && !z.text) out.push({ code: 'empty_label', message: 'A Label zone has no words yet.', zones: [z.id] })
    // (An Order zone nothing opens stops the save: layoutProblems().) A
    // button that can't be tapped opens nothing either.
    if (isPopup(z) && z.type !== 'check') {
      const u = unopenedWhy(layout, z.id)
      if (u) {
        out.push(u.why === 'none'
          ? { code: 'popup_unopened', message: 'No button opens a pop-up (' + popupTitle(z) + '): add an Open a pop-up button for it.', zones: [z.id] }
          : u.why === 'left_out'
            ? { code: 'popup_unopened', message: 'The button that opens a pop-up (' + popupTitle(z) + ') doesn\'t fit in its zone and is left out: make room for it there.', zones: [u.zone.id, z.id] }
            : { code: 'popup_unopened', message: 'The button that opens a pop-up (' + popupTitle(z) + ') is in a pop-up nothing opens (' + popupTitle(u.zone) + ').', zones: [u.zone.id, z.id] })
      }
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
    if (!zones.some(z => !floats(z) && overlaps(z, m))) {
      out.push({ code: 'choices_space', message: 'A Dish choices zone has its own space: it stays empty until a dish with choices is tapped.', zones: [m.id] })
    }
  }
  return out
}

/**
 * A copy of a zone, for the designer's Duplicate: { layout, id } (the copy's
 * id), or null when the zone isn't there or the layout can't take another
 * of its kind (its type's most, or MAX_ZONES). The copy goes last in the
 * zones with a fresh id (the zone's id without its number, then 2, 3 ...),
 * in the first free space of its size, else a smaller one, else on the
 * zone it copies (an overlap to move); a zone that floats goes a cell down
 * and to the right when it fits. A name gets (copy); a Dishes zone's copy
 * follows a Categories zone no Dishes zone follows yet, else the same one;
 * a Dish choices zone's copy shows the other kind (Must pick, Optional),
 * so the two split the choices.
 */
export function copyZone(layout, id) {
  const zones = layout?.zones || []
  const src = zones.find(z => z.id === id)
  const type = src && ZONE_TYPES.find(t => t.key === src.type)
  if (!type || zones.length >= MAX_ZONES || zones.filter(z => z.type === src.type).length >= type.max) return null
  const ids = new Set(zones.map(z => z.id))
  const base = (src.id.replace(/\d+$/, '') || 'z').slice(0, 20)
  let n = 2
  while (ids.has(base + n)) n++
  const copy = JSON.parse(JSON.stringify(src))
  copy.id = base + n
  if (copy.title) copy.title = (copy.title + ' (copy)').slice(0, LABEL_MAX)
  if (copy.type === 'items') {
    const free = zones.find(z => z.type === 'categories' && !dishesZonesOf(layout, z).length)
    if (free) copy.follows = free.id
  }
  if (copy.type === 'modifiers') copy.kind = src.kind === 'optional' ? 'required' : 'optional'
  if (floats(copy)) {
    if (copy.x + 1 + copy.w <= layout.cols && copy.y + 1 + copy.h <= layout.rows) Object.assign(copy, { x: copy.x + 1, y: copy.y + 1 })
  } else {
    const spot = freeSpace(layout, copy.w, copy.h)
    if (spot) Object.assign(copy, spot)
  }
  const next = normaliseTillLayout({ ...layout, zones: [...zones, copy] })
  return { layout: next, id: copy.id }
}

// The first free space for a zone that sits in the grid: the size asked
// for, else one cell lower, narrower ... (high first), row by row; null
// when the grid has no free cell.
function freeSpace(layout, w, h) {
  const solid = (layout?.zones || []).filter(z => !floats(z))
  for (let hh = h; hh >= 1; hh--) {
    for (let ww = w; ww >= 1; ww--) {
      for (let y = 0; y + hh <= layout.rows; y++) {
        for (let x = 0; x + ww <= layout.cols; x++) {
          const r = { x, y, w: ww, h: hh }
          if (!solid.some(z => overlaps(z, r))) return r
        }
      }
    }
  }
  return null
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
 * row by row; a cell bigger than the grid is cut down to it. In a Dish
 * choices zone (type 'modifiers') a cell takes the first free place after
 * the cell before it, never a gap left further up: a group's heading
 * starts its own row and its choices follow it, so the choices of the next
 * group never fill the end of this group's row.
 */
export function packCells(cells, { cols, rows, overflow, type }) {
  cols = Math.max(1, cols | 0)
  rows = Math.max(1, rows | 0)
  const inOrder = type === 'modifiers'
  const size = cells.map(c => ({ w: Math.min(cols, Math.max(1, c?.w | 0 || 1)), h: Math.min(rows, Math.max(1, c?.h | 0 || 1)) }))
  if (overflow === 'scroll' && rows === 1 && cols > 1) {
    // Across: one row, as many columns as it takes.
    let x = 0
    const page = size.map((s, i) => { const p = { i, x, y: 0, w: s.w, h: 1 }; x += s.w; return p })
    return { pages: [page], rest: [], hidden: 0, rows: 1, cols: Math.max(cols, x) }
  }
  if (overflow === 'scroll') {
    const grid = new Grid(cols, Infinity, inOrder)
    const page = size.map((s, i) => ({ i, ...grid.place(s.w, s.h), w: s.w, h: s.h }))
    return { pages: [page], rest: [], hidden: 0, rows: Math.max(rows, grid.used), cols }
  }
  if (overflow === 'more') {
    const one = new Grid(cols, rows, inOrder)
    const all = size.map((s, i) => one.fits(s.w, s.h) ? { i, ...one.place(s.w, s.h), w: s.w, h: s.h } : null)
    if (all.every(Boolean)) return { pages: [all], rest: [], hidden: 0, rows, cols }
    // Not everything fits: keep the last cell for More.
    const grid = new Grid(cols, rows, inOrder)
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
  let grid = new Grid(cols, rows, inOrder)
  for (let i = 0; i < size.length; i++) {
    const s = size[i]
    if (!grid.fits(s.w, s.h)) {
      if (overflow === 'hide') return { pages, rest: [], hidden: size.length - i, rows, cols }
      grid = new Grid(cols, rows, inOrder)
      pages.push([])
    }
    pages[pages.length - 1].push({ i, ...grid.place(s.w, s.h), w: s.w, h: s.h })
  }
  return { pages, rest: [], hidden: 0, rows, cols }
}

// Free cells of one page, filled row by row. rows Infinity grows as needed.
// inOrder: each cell goes after the one placed before it (at: where the
// last one ended), never back into a gap further up.
class Grid {
  constructor(cols, rows, inOrder = false) {
    this.cols = cols
    this.rows = rows
    this.taken = new Set()
    this.used = 0
    this.inOrder = inOrder
    this.at = { x: 0, y: 0 }
  }
  free(x, y, w, h) {
    if (x + w > this.cols || y + h > this.rows) return false
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (this.taken.has((y + dy) * 1000 + x + dx)) return false
    return true
  }
  spot(w, h) {
    const limit = Number.isFinite(this.rows) ? this.rows : this.used + h + 1
    const from = this.inOrder ? this.at : { x: 0, y: 0 }
    for (let y = from.y; y + h <= limit; y++) {
      for (let x = y === from.y ? from.x : 0; x + w <= this.cols; x++) if (this.free(x, y, w, h)) return { x, y }
    }
    return null
  }
  fits(w, h) { return !!this.spot(w, h) }
  place(w, h) {
    const at = this.spot(w, h)
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.taken.add((at.y + dy) * 1000 + at.x + dx)
    this.used = Math.max(this.used, at.y + h)
    this.at = { x: at.x + w, y: at.y }
    return at
  }
  block(x, y) { this.taken.add(y * 1000 + x) }
}

/** A button's words: its own label, else from what it does. */
export function buttonLabel(b, { items = {}, presets = [], tenders = [], charges = [], popups = [] } = {}) {
  if (b?.label) return b.label
  if (b?.action === 'item') return items[b.item_id]?.name || 'Dish no longer on the menu'
  if (b?.action === 'open_popup') {
    const p = popups.find(x => x.id === b.popup_id)
    return p ? popupTitle(p) : 'Pop-up no longer in the layout'
  }
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
 * menus, a category's dishes zone only its own section, and the dishes left
 * out of a zone only the company's dishes.
 */
export function ownLayout(layout, { sectionIds, itemIds, presetIds, menuIds, chargeIds }) {
  const has = (set, id) => (set instanceof Set ? set.has(id) : (set || []).includes(id))
  return {
    ...layout,
    zones: layout.zones.map(z => {
      if (z.type === 'categories' && z.sections) return { ...z, sections: z.sections.filter(id => has(sectionIds, id)) }
      if (z.type === 'items' || z.type === 'category') {
        return {
          ...z,
          hide_item_ids: z.hide_item_ids.filter(id => has(itemIds, id)),
          ...(z.type === 'category' ? { section_id: z.section_id && has(sectionIds, z.section_id) ? z.section_id : null } : {}),
        }
      }
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
    if (z.section_id) sections.add(z.section_id)
    for (const i of z.hide_item_ids || []) items.add(i)
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
 * The dishes a Dishes zone or a category's dishes zone shows from a list of
 * dish ids: the list without the ones the zone leaves out, in its order.
 */
export function shownDishIds(zone, ids) {
  const hidden = new Set(zone?.hide_item_ids || [])
  return (ids || []).filter(id => !hidden.has(id))
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
// The phone ones (phone: true) are upright, with no top bar: the categories
// across the top, the dishes as a list and the order behind a button that
// shows its items and total, taking the whole screen when open (phone); the
// same with the seat and course behind a button (phone_table); or the
// dishes with the categories as a list behind a button, which closes when
// one is picked (phone_categories).
export const LAYOUT_TEMPLATES = [
  { key: 'standard', label: 'Like the standard screen' },
  { key: 'quick', label: 'Quick service' },
  { key: 'phone', label: 'Phone: counter service', phone: true },
  { key: 'phone_table', label: 'Phone: table service', phone: true },
  { key: 'phone_categories', label: 'Phone: categories behind a button', phone: true },
]
export const TEMPLATE_KEYS = LAYOUT_TEMPLATES.map(t => t.key)

// The colours of the phone templates' buttons: the order in the till's dark
// ink, Send and Pay as on the order itself.
const ORDER_INK = INK
const SEND_BLUE = '#2f5bd3'
const PAY_GREEN = '#15803d'

function phoneTemplate(key) {
  // The order: the whole screen while it is open, closed with its X.
  const order = { id: 'order', type: 'check', x: 0, y: 0, w: 6, h: 10, show: 'popup', cover: 'screen', controls: true }
  // The bar at the bottom, four buttons across and two down: the button that
  // opens the order (it says the order's items and total) takes the left half.
  const open = { id: 'order', action: 'open_popup', popup_id: 'order', colour: ORDER_INK, w: 2, h: 2 }
  const pay = { id: 'pay', action: 'pay', colour: PAY_GREEN, w: 2 }
  const menu = { id: 'menu', action: 'till_menu', label: 'Menu' }
  const bar = buttons => ({ id: 'bar', type: 'buttons', x: 0, y: 10, w: 6, h: 2, cols: 4, rows: 2, overflow: 'hide', font: 16, buttons })
  const dishes = { id: 'dishes', type: 'items', x: 0, y: 1, w: 6, h: 9, view: 'list', rows: 9, overflow: 'scroll', font: 16, search: true }
  const strip = { id: 'cats', type: 'categories', x: 0, y: 0, w: 6, h: 1, cols: 3, rows: 1, overflow: 'scroll', font: 15 }
  if (key === 'phone_table') {
    return {
      cols: 6, rows: 12, top_bar: false, phone: true,
      zones: [
        strip, dishes,
        bar([open, { id: 'send', action: 'send', colour: SEND_BLUE, w: 2 }, { id: 'seat', action: 'open_popup', popup_id: 'seats', label: 'Seat & course' }, menu]),
        // Over the lower part of the dishes: closed with its X or a tap outside.
        { id: 'seats', type: 'seats', x: 0, y: 5, w: 6, h: 5, show: 'popup', cover: 'zone', controls: true, close_outside: true },
        order,
      ],
    }
  }
  if (key === 'phone_categories') {
    return {
      cols: 6, rows: 12, top_bar: false, phone: true,
      zones: [
        { ...dishes, y: 0, h: 10, rows: 10 },
        bar([open, { id: 'cats', action: 'open_popup', popup_id: 'cats', w: 2 }, { id: 'more', action: 'more' }, menu]),
        // The categories as a list over the dishes: one tap picks a category and closes it.
        { id: 'cats', type: 'categories', x: 0, y: 0, w: 6, h: 10, view: 'list', rows: 9, overflow: 'scroll', font: 17, show: 'popup', cover: 'zone', frame: false, controls: true, close_on_tap: true },
        order,
      ],
    }
  }
  return {
    cols: 6, rows: 12, top_bar: false, phone: true,
    zones: [strip, dishes, bar([open, pay, { id: 'more', action: 'more' }, menu]), order],
  }
}

export function templateLayout(key = 'standard') {
  if (String(key).startsWith('phone')) return normaliseTillLayout(phoneTemplate(key))
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
