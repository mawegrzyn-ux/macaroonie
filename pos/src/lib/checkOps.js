// What the till's buttons do, on top of the store's dispatch(). Each
// function builds events; the check rules (shared/pos/checks.js) decide.

import { ulid } from '@shared/pos/ids.js'
import { priceItem, posTax, isActiveLine, lineGross, picksWithin } from '@shared/pos/pricing.js'
import { combosWithItem, stepWithItem, comboOf } from '@shared/combos.js'
import { configItem, dealItem, comboCtx, autoCombosFor, checkOffers } from '@shared/pos/offers.js'
import { chargesWhere, chargeList, chargeFromList } from '@shared/pos/charges.js'
import { heldCourses } from '@shared/pos/checks.js'
import { dispatch, dispatchMany, getState, currentChecks, soldOutMap } from './store.js'

// Offers, item choices and combo lookups live in shared/pos/offers.js (the
// kiosk uses them too).
export { comboCtx, autoCombosFor }
export const tillItem = configItem

export const byId = list => Object.fromEntries((list || []).map(x => [x.id, x]))

export function streamOf(config, id) {
  return (config?.revenue_streams || []).find(r => r.id === id) || null
}

/** The revenue stream a new check starts in: the room's, else the till's, else the first. */
export function defaultStreamId(config, { areaId = null } = {}) {
  const dev = config?.device?.settings || {}
  const area = (config?.floor_areas || []).find(a => a.id === areaId)
  return area?.revenue_stream_id || dev.revenue_stream_id || config?.revenue_streams?.[0]?.id || null
}

export function typeOf(config, id) {
  return (config?.order_types || []).find(t => t.id === id) || null
}

/**
 * The order types a stream offers, in the tenant's order, each with what to
 * ask for: [{ type, ask_name, ask_tent }] (off | ask | required). With no
 * stream (a venue without any) every active type, asking for nothing.
 */
export function streamTypes(config, streamId) {
  const stream = streamOf(config, streamId)
  const active = (config?.order_types || []).filter(t => t.is_active !== false)
  if (!stream) return active.map(type => ({ type, ask_name: 'off', ask_tent: 'off' }))
  const set = Object.fromEntries((stream.order_types || []).filter(x => x.enabled).map(x => [x.order_type_id, x]))
  return active.filter(t => set[t.id]).map(type => ({ type, ask_name: set[type.id].ask_name || 'off', ask_tent: set[type.id].ask_tent || 'off' }))
}

/** The type a new check in a stream starts as: the stream's default, else its first. */
export function defaultTypeId(config, streamId) {
  const list = streamTypes(config, streamId)
  const def = streamOf(config, streamId)?.default_order_type_id
  return (list.find(x => x.type.id === def) || list[0])?.type.id || null
}

/** What a check's order type asks for in its stream: { ask_name, ask_tent }. */
export function promptsFor(config, streamId, typeId) {
  const hit = streamTypes(config, streamId).find(x => x.type.id === typeId)
  return { ask_name: hit?.ask_name || 'off', ask_tent: hit?.ask_tent || 'off' }
}

/**
 * A counter till (Store tech > Tills, Counter service): counter orders only.
 * It has no floor, tables, guests, seats or courses (coversOf, coursesOn and
 * seatsOn say so), and it sends an order to the kitchen as it is paid; its
 * Send button shows only when the till's own setting asks for it
 * (counterSends). A table-service till has no Counter page.
 */
export const counterTill = config => config?.device?.settings?.mode === 'counter'

/**
 * Whether the till asks how many guests a check has when it opens (Store
 * tech > Revenue streams, or the till's own choice in Store tech > Tills;
 * migration 231): 'off' (never), 'ask' (when a table or a tab opens, and it
 * can be skipped) or 'must' (no skipping; a check still without them asks
 * again before Send and Pay). Counter tills never ask.
 */
export function coversOf(config, streamId) {
  if (counterTill(config)) return 'off'
  const own = config?.device?.settings?.covers
  if (own === 'off' || own === 'ask' || own === 'must') return own
  const v = streamOf(config, streamId)?.covers
  return v === 'off' || v === 'must' ? v : 'ask'
}

/** Whether the till uses courses for a stream's checks (the till's own choice first; migration 231). Never on a counter till. */
export function coursesOn(config, streamId) {
  if (counterTill(config)) return false
  const own = config?.device?.settings?.courses
  if (own === 'on') return true
  if (own === 'off') return false
  return streamOf(config, streamId)?.courses !== false
}

/**
 * Whether the till numbers seats on a stream's checks (the seat bar, By seat
 * on the check): the till's own choice first, else the stream's (migration
 * 246: on unless switched off; until then seats followed the guests setting).
 * Never on a counter till.
 */
export function seatsOn(config, streamId) {
  if (counterTill(config)) return false
  const own = config?.device?.settings?.seats
  if (own === 'on') return true
  if (own === 'off') return false
  return streamOf(config, streamId)?.seats !== false
}

/**
 * What the seat and course bar shows for a check of this stream: 'both',
 * 'seats', 'courses' or 'none' (want: what a till layout's zone asks for,
 * shared/pos/tillLayout.js SEAT_PARTS).
 */
export function seatCourseParts(config, streamId, want = 'both') {
  const seats = want !== 'courses' && seatsOn(config, streamId)
  const courses = want !== 'seats' && coursesOn(config, streamId) && (config?.courses || []).length > 0
  return seats && courses ? 'both' : seats ? 'seats' : courses ? 'courses' : 'none'
}

/** A counter till's Send button (Store tech > Tills; absent = none: the order goes to the kitchen as it is paid). */
export const counterSends = config => config?.device?.settings?.counter_send === true

/**
 * What Pay does on a table-service till when the check has items not sent to
 * the kitchen yet, or courses waiting to fire: 'ask' (the default: says so
 * first, Send and pay or Pay without sending) or 'send' (sends them and fires
 * the waiting courses as the check closes). Counter tills always send.
 */
export function unsentAtPay(config) {
  if (counterTill(config)) return 'send'
  return config?.device?.settings?.unsent_at_pay === 'send' ? 'send' : 'ask'
}

/** Whether a table-service till shows its tables (Store tech > Tills; off = only tabs and orders). Counter tills have none. */
export const tablesOn = config => !counterTill(config) && config?.device?.settings?.tables !== false

/**
 * On a phone, a table-service till's tables and tabs as rows to swipe (left
 * sends what is new or fires the course waiting, right pays) instead of
 * tiles (Store tech > Tills, On a phone). Counter tills have none.
 */
export const phoneTablesList = config => !counterTill(config) && config?.device?.settings?.phone_tables === 'list'

/** Whether dish buttons show how many of the dish are on the order already (Store tech > Tills). */
export const showsItemCounts = config => config?.device?.settings?.item_counts === true

/**
 * How many of each dish an open check has, for the dish buttons' badges:
 * { [itemId]: qty } over its active lines (taken off and voided ones don't
 * count; a meal deal counts as its own dish).
 */
export function itemCounts(check) {
  const out = {}
  for (const l of check?.lines || []) {
    if (!l.item_id || !isActiveLine(l)) continue
    out[l.item_id] = (out[l.item_id] || 0) + (Number(l.qty) || 0)
  }
  return out
}

/** Is the check at a table (table service)? Nobody there takes a tent number. */
export const atTable = check => !!check?.table_id || check?.mode === 'table'

/**
 * What a check's order type asks for (promptsFor), without the tent number
 * at a table: the table number already says where the food goes.
 */
export function checkPrompts(config, check, typeId = check?.order_type_id) {
  const p = promptsFor(config, check?.revenue_stream_id, typeId)
  return atTable(check) ? { ...p, ask_tent: 'off' } : p
}

/**
 * A check whose stream must have covers (coversOf 'must') and hasn't them
 * yet: asked before Send and Pay. Tables and tabs alike; never a counter
 * order (counter tills don't ask).
 */
export function coversMissing(check, config) {
  return check?.mode !== 'counter' && coversOf(config, check?.revenue_stream_id) === 'must' && !(Number(check?.covers) > 0)
}

/** Required details a check is still missing: ['name', 'tent']. */
export function missingDetails(check, config) {
  const p = checkPrompts(config, check)
  const out = []
  if (p.ask_name === 'required' && !String(check.tab_name || '').trim()) out.push('name')
  if (p.ask_tent === 'required' && !String(check.tent || '').trim()) out.push('tent')
  return out
}

/**
 * New tax for every line of a check if its order type or stream changed
 * (shared/tax.js via posTax): { [lineId]: { vat_rate, tax_rate_id } }.
 */
export function rerateLines(check, config, changes) {
  const next = { ...check, ...changes }
  const out = {}
  for (const l of check.lines) {
    if (l.status === 'voided') continue
    out[l.id] = posTax(l.item_id ? config.items?.[l.item_id] : null, next, config)
  }
  return out
}

/**
 * The charges a check of this revenue stream and order type gets at this
 * location (Store tech > Charges: the company's list and the location's
 * matrix of streams by order types, migration 231; shared/pos/charges.js),
 * with each tax rate's % at this venue. A charge for parties of N goes on
 * now and counts once the check has N guests.
 */
export function chargesFor(config, { streamId = null, typeId = null } = {}) {
  return chargesWhere(config?.settings?.charges, { streamId, typeId }, config?.venue?.id, config?.tax_rates || [])
}

/** The company's charges, as the till can add them from its list (the Charges window, a till layout button). */
export function listCharges(config) {
  return chargeList(config?.settings?.charges)
}

/** One list charge as charge.added carries it (the sequencer checks it against the list). */
export function listCharge(config, x) {
  return { ...chargeFromList(x, config?.venue?.id, config?.tax_rates || []), list: true }
}

/** Names for chargeOnText(): { items: { id: name }, sections: { id: title } } from the till's menus. */
export function chargeNames(config) {
  const items = {}
  for (const [id, it] of Object.entries(config?.items || {})) items[id] = it.name
  const sections = {}
  for (const m of config?.menus || []) for (const sec of m.sections || []) sections[sec.id] = sec.title
  return { items, sections }
}

/**
 * A charge from the company's list on a check (a till layout button, the
 * Charges window): put back when it was taken off ({ restored: true }),
 * nothing when it is on already ({ ok: true, already: true }), else added
 * from the list. Every answer carries the charge's name.
 */
export function addListCharge(check, chargeId) {
  const { config } = getState()
  const own = (check.charges || []).find(x => x.id === chargeId)
  if (own) {
    if (own.removed) return { ...dispatch('charge.restored', { charge_id: chargeId }, { check_id: check.id }), name: own.name, restored: true }
    return { ok: true, already: true, name: own.name }
  }
  const x = listCharges(config).find(y => y.id === chargeId)
  if (!x) return { ok: false, error: 'This charge isn\'t on the till\'s list any more' }
  return { ...dispatch('charge.added', { charge: listCharge(config, x) }, { check_id: check.id }), name: x.name }
}

/** Open a check. Returns { ok, checkId } or { ok: false, error }. */
export function openCheck({ mode, table_id = null, tab_name = null, covers = null, revenue_stream_id = null, order_type_id = null, tent = null }) {
  const { config } = getState()
  const streamId = revenue_stream_id || defaultStreamId(config)
  const typeId = order_type_id || defaultTypeId(config, streamId)
  const checkId = ulid()
  const r = dispatch('check.opened', {
    mode, table_id, tab_name, covers, revenue_stream_id: streamId, order_type_id: typeId, tent: tent || null,
    charges: chargesFor(config, { streamId, typeId }),
  }, { check_id: checkId })
  return r.ok ? { ok: true, checkId } : r
}

/**
 * What happens to the receipt when a check is paid: the till's own choice
 * (Store tech, Tills) else the venue's: 'ask' | 'always' | 'never'.
 */
export function receiptModeOf(config) {
  const own = config?.device?.settings?.receipt_mode
  if (own && own !== 'venue') return own
  return config?.settings?.receipt_mode || 'ask'
}

/**
 * How the till asks for a new order's order type, name and tent number
 * (components/OrderPrompt.jsx, migration 226): the till's own choice
 * (Store tech, Tills) else the venue's: 'one' (one screen) | 'two' (two steps).
 */
export function orderPromptOf(config) {
  const own = config?.device?.settings?.order_prompt
  if (own === 'one' || own === 'two') return own
  return config?.settings?.order_prompt === 'two' ? 'two' : 'one'
}

/**
 * Whether a new order in a stream has anything to ask: a choice of order
 * types, or a name or tent number the only type asks for. (A tab always has
 * its name to ask, so `name` makes the name count.)
 */
export function newOrderAsks(config, streamId, { name = false } = {}) {
  const types = streamTypes(config, streamId)
  if (types.length > 1) return true
  const t = types[0]
  return !!t && (name || t.ask_name !== 'off' || t.ask_tent !== 'off')
}

/** A line as new again (Undo after taking it off): same dish, choices and price, a new id. */
export function copyOfLine(l) {
  return {
    id: ulid(), item_id: l.item_id ?? null, section_id: l.section_id ?? null, name: l.name, kitchen_name: l.kitchen_name || null,
    qty: l.qty, unit_price: l.unit_price, modifiers: l.modifiers || [], combo: l.combo || null,
    seat: l.seat ?? null, course_id: l.course_id ?? null, note: l.note || null, allergies: l.allergies || [],
    vat_rate: l.vat_rate, tax_rate_id: l.tax_rate_id ?? null, revenue_stream_id: l.revenue_stream_id ?? null,
    ...(l.price_override ? { price_override: true } : {}), ...(l.open_item ? { open_item: true } : {}),
  }
}

export function needsChoices(config, item) {
  const it = tillItem(config, item.id)
  if (it.kind === 'combo') return true
  return (it.pos_choices || []).length > 0
}

/** The course a dish goes in: picked on screen, else the dish's / section's. */
export function courseFor(item, picked) {
  if (picked === 'none') return null
  if (picked) return picked
  return item.course_id || null
}

// Compared as data, not as text: a line the till has back from the server has
// its keys in another order (Postgres jsonb sorts them), so comparing plain
// JSON.stringify output never matched once the order had synced, and the
// same dish with the same choices made a second line. Empty values count as
// left out.
const asData = v => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => { if (x[key] != null) o[key] = x[key]; return o }, {})
  : x))
// A dish an order flow put on is its own line (lib/orderFlows.js): never joined.
const sameLine = (a, b) => a.item_id === b.item_id && a.status === 'new' && !a.flow && !b.flow
  && asData(a.modifiers || []) === asData(b.modifiers || [])
  && asData(a.combo || null) === asData(b.combo || null)
  && (a.seat ?? null) === (b.seat ?? null) && (a.course_id ?? null) === (b.course_id ?? null)
  && !a.note && !b.note && !(a.allergies || []).length && !(b.allergies || []).length
  && a.unit_price === b.unit_price && !a.price_override && !b.price_override

/**
 * Add a dish to a check. opts: { qty, seat, course, note, allergies, unit_price (price override), approved_by,
 * flow ({ id, key, removable }: an order flow puts it on, lib/orderFlows.js) }.
 * An identical dish not sent yet gets its quantity raised instead of a new line.
 */
export function addItem(check, item, selection = {}, opts = {}) {
  const { config } = getState()
  const it = tillItem(config, item.id)
  const priced = priceItem(it, selection, comboCtx(config))
  if (!priced.ok) return priced
  const tax = posTax(it, check, config)
  const override = opts.unit_price != null && opts.unit_price !== priced.unit_price
  const line = {
    id: ulid(), item_id: it.id, section_id: it.section_id, name: it.name, kitchen_name: it.kitchen_name || null,
    qty: Math.max(1, opts.qty || 1),
    unit_price: override ? opts.unit_price : priced.unit_price,
    modifiers: priced.modifiers, combo: priced.combo,
    seat: opts.seat ?? null, course_id: coursesOn(config, check.revenue_stream_id) ? courseFor(it, opts.course) : null,
    note: opts.note || null, allergies: opts.allergies || [],
    vat_rate: tax.vat_rate, tax_rate_id: tax.tax_rate_id,
    revenue_stream_id: check.revenue_stream_id,
    price_override: override || undefined,
    ...(opts.flow ? { flow: opts.flow } : {}),
  }
  const twin = !override && check.lines.find(l => sameLine(l, line))
  if (twin) {
    return dispatch('line.changed', { line_id: twin.id, qty: Math.min(999, twin.qty + line.qty) }, { check_id: check.id })
  }
  return dispatch('line.added', { line }, { check_id: check.id, approved_by: opts.approved_by || null })
}

/**
 * A dish as the choices window or a till layout's Dish choices zones give
 * it: o = { selection, qty, seat, course, note, allergies, unit_price,
 * split? }. With split (more picks, more dishes: LayoutChoices.jsx) each
 * selection is a dish of its own, added to the check as it then is, so the
 * same dish picked twice joins one line. Returns the last add's result
 * with every event.
 */
export function addChosen(checkId, item, o) {
  const list = Array.isArray(o.split) && o.split.length ? o.split : [o.selection || {}]
  const events = []
  let r = { ok: true }
  for (const selection of list) {
    const check = currentChecks()[checkId]
    if (!check) return { ok: false, error: 'This check is no longer open' }
    r = addItem(check, item, selection, { qty: o.qty, seat: o.seat, course: o.course, note: o.note, allergies: o.allergies, unit_price: o.unit_price, approved_by: o.approved_by })
    if (!r.ok) return r
    events.push(...(r.events || []))
  }
  return { ...r, events }
}

/** An item not on the menu: name and price typed in. */
export function addOpenItem(check, { name, unit_price, qty = 1, course = null, approved_by = null }) {
  const { config } = getState()
  const tax = posTax(null, check, config)
  const line = {
    id: ulid(), item_id: null, section_id: null, name: name.trim().slice(0, 200), qty, unit_price,
    modifiers: [], combo: null, seat: null, course_id: course && course !== 'none' && coursesOn(config, check.revenue_stream_id) ? course : null,
    note: null, allergies: [],
    vat_rate: tax.vat_rate, tax_rate_id: tax.tax_rate_id,
    revenue_stream_id: check.revenue_stream_id, open_item: true, price_override: true,
  }
  return dispatch('line.added', { line }, { check_id: check.id, approved_by })
}

/** Courses that should wait when these lines go: a course held by default waits when an earlier course is on the check. */
export function defaultHeld(check, config) {
  const courses = byId(config.courses)
  const sortOf = id => courses[id]?.sort_order ?? -1
  const fresh = check.lines.filter(l => l.status === 'new' && l.course_id)
  const ids = [...new Set(fresh.map(l => l.course_id))]
  const active = check.lines.filter(l => isActiveLine(l) && l.course_id)
  return ids.filter(id => {
    if (!courses[id]?.hold_by_default) return false
    if (check.courses?.[id]?.fired_at) return false
    return active.some(l => sortOf(l.course_id) < sortOf(id))
  })
}

/**
 * Whether sending a check's new items needs the Send window (which courses
 * cook now and which wait): new items in more than one course, or a course
 * that waits by default.
 */
export function needsSendChoice(check, config) {
  const ids = new Set(check.lines.filter(l => l.status === 'new' && l.course_id).map(l => l.course_id))
  const courses = byId(config.courses)
  return ids.size > 1 || [...ids].some(id => courses[id]?.hold_by_default) || defaultHeld(check, config).length > 0
}

export function sendCheck(check, heldCourseIds = []) {
  const lineIds = check.lines.filter(l => l.status === 'new').map(l => l.id)
  if (!lineIds.length) return { ok: false, error: 'Nothing new to send' }
  return dispatch('lines.sent', { send_id: ulid(), line_ids: lineIds, held_course_ids: heldCourseIds }, { check_id: check.id })
}

/**
 * What the kitchen hasn't been told to make yet: { unsent, held } (items not
 * sent, courses sent but waiting to be fired).
 */
export function notFired(check) {
  return { unsent: (check?.lines || []).filter(l => l.status === 'new').length, held: heldCourses(check) }
}

/**
 * The events that tell the kitchen to make everything on a check now: its
 * items not sent yet go (none held back), then each course waiting is fired.
 * Used as a check is paid (Pay, unsent_at_pay; counter tills always) and by
 * Send and pay. [] when there is nothing to send or fire.
 */
export function sendAllSpecs(check) {
  const specs = []
  const ids = (check?.lines || []).filter(l => l.status === 'new').map(l => l.id)
  if (ids.length) specs.push(['lines.sent', { send_id: ulid(), line_ids: ids, held_course_ids: [] }, { check_id: check.id }])
  for (const id of heldCourses(check)) specs.push(['course.fired', { course_id: id }, { check_id: check.id }])
  return specs
}

// ── Promotions on the till (shared/promotions.js, channel 'pos') ──

/** The offers that apply now (automatic combos, then promotions), as a promotions.set payload, or null when nothing changed. */
export function promotionsFor(check, opts = {}) {
  return checkOffers(check, getState().config, opts)
}

/** Bring the check's automatic offers up to date before a bill or payment. */
export function refreshPromotions(checkId, opts) {
  const check = currentChecks()[checkId]
  if (!check || check.status !== 'open') return
  const p = promotionsFor(check, opts)
  if (p && p.changed) dispatch('promotions.set', p.payload, { check_id: checkId })
}

/**
 * A line's modifiers back as option picks ({ [groupId]: [{ id, prefix, children }] }),
 * for starting a combo with a dish already on the check.
 */
export function selectionFromModifiers(mods = []) {
  const out = {}
  let last = null
  for (const m of mods) {
    if ((m.depth || 0) === 0) {
      last = { id: m.option_id, prefix: m.prefix || null }
      ;(out[m.group_id] ||= []).push(last)
    } else if (last) {
      last.children = last.children || {}
      ;(last.children[m.group_id] ||= []).push({ id: m.option_id, prefix: m.prefix || null })
    }
  }
  return out
}

/** Combos (manual or automatic) that offer this line's dish, with where it goes: [{ combo, start }]. */
export function combosForLine(line, config) {
  if (!line?.item_id || line.status !== 'new' || (line.combo && line.combo.length) || line.open_item) return []
  const ctx = { itemsById: config?.items || {}, sectionItems: config?.section_items || {} }
  const sold = soldOutMap(config)
  return combosWithItem(line.item_id, Object.values(config?.items || {}).filter(i => i.kind === 'combo' && !sold.has(i.id)), ctx)
    .map(combo => ({ combo, start: stepWithItem(combo, line.item_id, ctx) }))
    .filter(x => x.start)
}

/**
 * The selection a combo starts with when made from a line: the dish's
 * options carried over, kept to what the deal asks of it (some groups left
 * out, only some options; dealItem() + picksWithin()).
 */
export function comboStartFrom(line, start, combo = null, config = null) {
  let choices = selectionFromModifiers(line.modifiers)
  const option = comboOf(combo)?.steps.find(s => s.id === start.step_id)?.options.find(o => o.id === start.option_id)
  const part = option?.groups && config ? dealItem(config, start.item_id, option.groups) : null
  if (part) choices = picksWithin(part.pos_choices, choices)
  return {
    combo: { [start.step_id]: [{ option_id: start.option_id, item_id: start.item_id, choices }] },
    choices: {},
  }
}

/**
 * Lines grouped by course (in course order) for the check list. With `all`,
 * every course the venue has (and No course) is there, empty or not: the
 * places an item can be dragged to.
 */
export function groupByCourse(check, config, { all = false } = {}) {
  const courses = byId(config?.courses)
  const groups = new Map()
  if (all) {
    groups.set('', [])
    for (const c of config?.courses || []) groups.set(c.id, [])
  }
  for (const l of check.lines) {
    const key = l.course_id || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(l)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] ? courses[a[0]]?.sort_order ?? 50 : -1) - (b[0] ? courses[b[0]]?.sort_order ?? 50 : -1))
    .map(([id, lines]) => ({ id: id || null, name: id ? (courses[id]?.name || 'Course') : 'No course', lines, state: check.courses?.[id] || null }))
}

/** Lines grouped by seat (Shared first). With `upTo`, seats 1..upTo are there even when empty. */
export function groupBySeat(check, { upTo = 0 } = {}) {
  const groups = new Map()
  if (upTo) {
    groups.set(0, [])
    for (let n = 1; n <= upTo; n++) groups.set(n, [])
  }
  for (const l of check.lines) {
    const key = l.seat ?? 0
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(l)
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([seat, lines]) => ({ id: String(seat), name: seat ? 'Seat ' + seat : 'Shared', lines }))
}

/** Can an item be dragged to another group? Courses: only before it is sent. Seats: unless voided. */
export function canRegroup(line, by) {
  if (line.status === 'voided') return false
  return by === 'seat' || line.status === 'new'
}

export { lineGross, isActiveLine, dispatchMany }
