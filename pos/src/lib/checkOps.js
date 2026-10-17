// What the till's buttons do, on top of the store's dispatch(). Each
// function builds events; the check rules (shared/pos/checks.js) decide.

import { ulid } from '@shared/pos/ids.js'
import { priceItem, posTax, isActiveLine, lineGross } from '@shared/pos/pricing.js'
import { combosWithItem, stepWithItem } from '@shared/combos.js'
import { configItem, comboCtx, autoCombosFor, checkOffers } from '@shared/pos/offers.js'
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

/** Required details a check is still missing: ['name', 'tent']. */
export function missingDetails(check, config) {
  const p = promptsFor(config, check.revenue_stream_id, check.order_type_id)
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

function serviceChargeFor(stream, covers) {
  const pct = Number(stream?.service_charge_percent) || 0
  if (!pct) return null
  if ((Number(stream.service_charge_min_covers) || 0) > (Number(covers) || 0)) return null
  return { percent: pct, vat_rate: 0 }
}

/** Open a check. Returns { ok, checkId } or { ok: false, error }. */
export function openCheck({ mode, table_id = null, tab_name = null, covers = null, revenue_stream_id = null, order_type_id = null, tent = null }) {
  const { config } = getState()
  const streamId = revenue_stream_id || defaultStreamId(config)
  const typeId = order_type_id || defaultTypeId(config, streamId)
  const checkId = ulid()
  const r = dispatch('check.opened', {
    mode, table_id, tab_name, covers, revenue_stream_id: streamId, order_type_id: typeId, tent: tent || null,
    service_charge: mode === 'counter' ? null : serviceChargeFor(streamOf(config, streamId), covers),
  }, { check_id: checkId })
  return r.ok ? { ok: true, checkId } : r
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

const sameLine = (a, b) => a.item_id === b.item_id && a.status === 'new'
  && JSON.stringify(a.modifiers || []) === JSON.stringify(b.modifiers || [])
  && JSON.stringify(a.combo || null) === JSON.stringify(b.combo || null)
  && (a.seat ?? null) === (b.seat ?? null) && (a.course_id ?? null) === (b.course_id ?? null)
  && !a.note && !b.note && !(a.allergies || []).length && !(b.allergies || []).length
  && a.unit_price === b.unit_price && !a.price_override && !b.price_override

/**
 * Add a dish to a check. opts: { qty, seat, course, note, allergies, unit_price (price override), approved_by }.
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
    seat: opts.seat ?? null, course_id: courseFor(it, opts.course),
    note: opts.note || null, allergies: opts.allergies || [],
    vat_rate: tax.vat_rate, tax_rate_id: tax.tax_rate_id,
    revenue_stream_id: check.revenue_stream_id,
    price_override: override || undefined,
  }
  const twin = !override && check.lines.find(l => sameLine(l, line))
  if (twin) {
    return dispatch('line.changed', { line_id: twin.id, qty: Math.min(999, twin.qty + line.qty) }, { check_id: check.id })
  }
  return dispatch('line.added', { line }, { check_id: check.id, approved_by: opts.approved_by || null })
}

/** An item not on the menu: name and price typed in. */
export function addOpenItem(check, { name, unit_price, qty = 1, course = null, approved_by = null }) {
  const { config } = getState()
  const tax = posTax(null, check, config)
  const line = {
    id: ulid(), item_id: null, section_id: null, name: name.trim().slice(0, 200), qty, unit_price,
    modifiers: [], combo: null, seat: null, course_id: course && course !== 'none' ? course : null,
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

export function sendCheck(check, heldCourseIds = []) {
  const lineIds = check.lines.filter(l => l.status === 'new').map(l => l.id)
  if (!lineIds.length) return { ok: false, error: 'Nothing new to send' }
  return dispatch('lines.sent', { send_id: ulid(), line_ids: lineIds, held_course_ids: heldCourseIds }, { check_id: check.id })
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

/** The selection a combo starts with when made from a line. */
export function comboStartFrom(line, start) {
  return {
    combo: { [start.step_id]: [{ option_id: start.option_id, item_id: start.item_id, choices: selectionFromModifiers(line.modifiers) }] },
    choices: {},
  }
}

/** Lines grouped by course (in course order) for the check list. */
export function groupByCourse(check, config) {
  const courses = byId(config?.courses)
  const groups = new Map()
  for (const l of check.lines) {
    const key = l.course_id || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(l)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] ? courses[a[0]]?.sort_order ?? 50 : -1) - (b[0] ? courses[b[0]]?.sort_order ?? 50 : -1))
    .map(([id, lines]) => ({ id: id || null, name: id ? (courses[id]?.name || 'Course') : 'No course', lines, state: check.courses?.[id] || null }))
}

export function groupBySeat(check) {
  const groups = new Map()
  for (const l of check.lines) {
    const key = l.seat ?? 0
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(l)
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([seat, lines]) => ({ id: String(seat), name: seat ? 'Seat ' + seat : 'Shared', lines }))
}

export { lineGross, isActiveLine, dispatchMany }
