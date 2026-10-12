// What the till's buttons do, on top of the store's dispatch(). Each
// function builds events; the check rules (shared/pos/checks.js) decide.

import { ulid } from '@shared/pos/ids.js'
import { priceItem, posVatRate, promoLines, spread, isActiveLine, lineGross, posChoices } from '@shared/pos/pricing.js'
import { applyPromotions, venueNow } from '@shared/promotions.js'
import { dispatch, dispatchMany, getState, currentChecks } from './store.js'

export const byId = list => Object.fromEntries((list || []).map(x => [x.id, x]))

export function rcOf(config, id) {
  return (config?.revenue_centres || []).find(r => r.id === id) || null
}

/** The revenue centre a new check starts in. */
export function defaultRcId(config, { areaId = null, counter = false } = {}) {
  const dev = config?.device?.settings || {}
  const area = (config?.floor_areas || []).find(a => a.id === areaId)
  const pick = counter
    ? (config?.settings?.counter_revenue_centre_id || (config?.revenue_centres || []).find(r => r.vat_mode === 'takeaway')?.id || dev.revenue_centre_id)
    : (area?.revenue_centre_id || dev.revenue_centre_id)
  return pick || config?.revenue_centres?.[0]?.id || null
}

function serviceChargeFor(rc, covers) {
  const pct = Number(rc?.service_charge_percent) || 0
  if (!pct) return null
  if ((Number(rc.service_charge_min_covers) || 0) > (Number(covers) || 0)) return null
  return { percent: pct, vat_rate: 0 }
}

/** Open a check. Returns { ok, checkId } or { ok: false, error }. */
export function openCheck({ mode, table_id = null, tab_name = null, covers = null, revenue_centre_id = null }) {
  const { config } = getState()
  const rcId = revenue_centre_id || defaultRcId(config, { counter: mode === 'counter' })
  const checkId = ulid()
  const r = dispatch('check.opened', {
    mode, table_id, tab_name, covers, revenue_centre_id: rcId,
    service_charge: mode === 'counter' ? null : serviceChargeFor(rcOf(config, rcId), covers),
  }, { check_id: checkId })
  return r.ok ? { ok: true, checkId } : r
}

/** Item with its till choices worked out once. */
export function tillItem(config, id) {
  const it = config?.items?.[id]
  if (!it) return null
  if (!it.pos_choices) it.pos_choices = posChoices(it, config.groups || {})
  return it
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
  const priced = priceItem(it, selection, { itemsById: config.items, groupsById: config.groups || {} })
  if (!priced.ok) return priced
  const rc = rcOf(config, check.revenue_centre_id)
  const override = opts.unit_price != null && opts.unit_price !== priced.unit_price
  const line = {
    id: ulid(), item_id: it.id, section_id: it.section_id, name: it.name, kitchen_name: it.kitchen_name || null,
    qty: Math.max(1, opts.qty || 1),
    unit_price: override ? opts.unit_price : priced.unit_price,
    modifiers: priced.modifiers, combo: priced.combo,
    seat: opts.seat ?? null, course_id: courseFor(it, opts.course),
    note: opts.note || null, allergies: opts.allergies || [],
    vat_rate: posVatRate(it, rc?.vat_mode || 'eat_in', config.settings),
    revenue_centre_id: check.revenue_centre_id,
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
  const rc = rcOf(config, check.revenue_centre_id)
  const line = {
    id: ulid(), item_id: null, section_id: null, name: name.trim().slice(0, 200), qty, unit_price,
    modifiers: [], combo: null, seat: null, course_id: course && course !== 'none' ? course : null,
    note: null, allergies: [],
    vat_rate: rc?.vat_mode === 'takeaway' ? Number(config.settings.default_vat_rate_takeaway) : Number(config.settings.default_vat_rate_eat_in),
    revenue_centre_id: check.revenue_centre_id, open_item: true, price_override: true,
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

/** The offers that apply now, as a promotions.set payload, or null when nothing changed. */
export function promotionsFor(check, { add = null, remove = null } = {}) {
  const { config } = getState()
  const promos = config?.promotions || []
  if (!promos.length && !(check.promotions || []).length) return null
  const lines = promoLines(check)
  const kept = new Set((check.promotions || []).map(p => p.promotion_id))
  if (add) kept.add(add)
  if (remove) kept.delete(remove)
  const chosen = promos.filter(p => p.apply_mode !== 'auto' && kept.has(p.id)).map(p => p.id)
  const result = lines.length ? applyPromotions(lines, promos, {
    at: venueNow(config.venue?.timezone || 'Europe/London'), venueId: config.venue?.id, chosen, unlocked: chosen,
  }) : { applied: [], line_discounts: [], offers: [] }
  const weights = result.line_discounts
  const next = result.applied.map(a => {
    const share = spread(a.discount_pence, weights)
    const linesMap = {}
    lines.forEach((l, i) => { if (share[i] > 0) linesMap[l.line_id] = share[i] })
    return { promotion_id: a.id, name: a.name, lines: linesMap }
  })
  const same = JSON.stringify(next) === JSON.stringify((check.promotions || []).map(p => ({ promotion_id: p.promotion_id, name: p.name, lines: p.lines })))
  return { payload: { promotions: next }, changed: !same, offers: result.offers || [] }
}

/** Bring the check's automatic offers up to date before a bill or payment. */
export function refreshPromotions(checkId, opts) {
  const check = currentChecks()[checkId]
  if (!check || check.status !== 'open') return
  const p = promotionsFor(check, opts)
  if (p && p.changed) dispatch('promotions.set', p.payload, { check_id: checkId })
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
