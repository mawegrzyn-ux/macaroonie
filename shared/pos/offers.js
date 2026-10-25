// shared/pos/offers.js
//
// What comes off a check by itself: automatic combos (shared/combos.js)
// found among its separate dishes, then the venue's promotions
// (shared/promotions.js, channel 'pos'). ONE implementation for the till
// (pos/src/lib/checkOps.js) and the kiosk (pos/src/kiosk, shared/kiosk.js),
// so an order placed on a kiosk and paid at the till keeps its price: the
// till works the offers out again before a bill or payment, with the same
// rules and the same promotions.
//
// Works on a till or kiosk config (services/posSvc.js tillConfig(),
// services/kioskSvc.js kioskConfig()): items, groups, section_items,
// sold_out, promotions, venue.

import { posChoices, partChoices, promoLines, spread, isActiveLine } from './pricing.js'
import { applyPromotions, venueNow } from '../promotions.js'
import { findAutoCombos, autoMatchable } from '../combos.js'
import { fromPrice } from '../orderPricing.js'

/** Dishes sold out now: Map(item id -> until ISO | null), from config.sold_out (services/soldOut.js). */
export function soldOutMap(config, now = Date.now()) {
  const out = new Map()
  for (const s of config?.sold_out || []) {
    if (!s.until || Date.parse(s.until) > now) out.set(s.item_id, s.until || null)
  }
  return out
}

/** A config item with its till choices worked out once (cached on the item). */
export function configItem(config, id) {
  const it = config?.items?.[id]
  if (!it) return null
  if (!it.pos_choices) it.pos_choices = posChoices(it, config.groups || {})
  return it
}

/**
 * A dish picked in a meal deal as the deal asks it: the config item with its
 * choices changed by the combo choice's groups (pricing.js partChoices()),
 * the item itself when the deal changes nothing. What a till or kiosk shows
 * for a part's options and pictures comes from this, so it is what the
 * pricing accepts.
 */
export function dealItem(config, id, groups) {
  const it = configItem(config, id)
  if (!it || !groups) return it
  return { ...it, pos_choices: partChoices(it, groups, config.groups || {}) }
}

/** What priceItem() needs to find options and combo dishes in a config. */
export function comboCtx(config) {
  const sold = soldOutMap(config)
  const items = config?.items || {}
  // Every dish carries its till choices (combo parts are priced with them).
  for (const id of Object.keys(items)) configItem(config, id)
  return { itemsById: items, groupsById: config?.groups || {}, sectionItems: config?.section_items || {}, soldOut: id => sold.has(id) }
}

// A line's own picks as { groupKey: [optionId] } (its top-level options, not "No").
function linePicks(modifiers) {
  const out = {}
  for (const m of modifiers || []) {
    if (m.depth || m.prefix === 'no' || m.group_id == null) continue
    out[m.group_id] = [...(out[m.group_id] || []), m.option_id]
  }
  return out
}

/**
 * Automatic combos among the check's separate dishes:
 * [{ promotion_id: comboId, name, kind: 'combo', count, lines: { lineId: pence } }].
 * Only dishes at their menu price count (not combo lines, open items or
 * changed prices), and only with options the deal could have asked
 * (dealFits()); the most that comes off a line is what is left on it after
 * line discounts.
 */
export function autoCombosFor(check, config) {
  const combos = Object.values(config?.items || {}).filter(i => i.kind === 'combo' && autoMatchable(i))
  if (!combos.length) return []
  const left = Object.fromEntries(promoLines(check).map(l => [l.line_id, l.line_total_pence]))
  const lines = (check.lines || []).filter(l => isActiveLine(l) && l.item_id && !(l.combo && l.combo.length) && !l.price_override && !l.open_item)
    .map(l => ({ key: l.id, item_id: l.item_id, section_id: l.section_id, qty: l.qty, unit_base: Number(l.unit_price) || 0, cap: Math.floor((left[l.id] ?? 0) / Math.max(1, l.qty)), picks: linePicks(l.modifiers) }))
  const sold = soldOutMap(config)
  const found = findAutoCombos(lines, combos.filter(c => !sold.has(c.id)), { itemsById: config.items, sectionItems: config.section_items || {} },
    c => fromPrice({ ...c, kind: 'dish', combo: null, price_pence: c.price_pence ?? 0 }, configItem(config, c.id).pos_choices) ?? 0)
  return found.map(f => ({ promotion_id: f.combo_id, name: f.name, kind: 'combo', count: f.count, lines: f.lines }))
}

/**
 * The offers that apply to a check now (automatic combos, then promotions),
 * as a promotions.set payload: { payload, changed, offers }, or null when
 * the venue has none and the check has none. `add` / `remove` pick or drop
 * a promotion that staff choose (apply mode manual or code).
 */
export function checkOffers(check, config, { add = null, remove = null } = {}) {
  const promos = config?.promotions || []
  const combos = autoCombosFor(check, config)
  if (!promos.length && !combos.length && !(check.promotions || []).length) return null
  // Promotions work on what is left after the combos.
  const comboOff = {}
  for (const c of combos) for (const [id, p] of Object.entries(c.lines)) comboOff[id] = (comboOff[id] || 0) + p
  const lines = promoLines(check).map(l => ({ ...l, line_total_pence: Math.max(0, l.line_total_pence - (comboOff[l.line_id] || 0)) }))
  const kept = new Set((check.promotions || []).map(p => p.promotion_id))
  if (add) kept.add(add)
  if (remove) kept.delete(remove)
  const chosen = promos.filter(p => p.apply_mode !== 'auto' && kept.has(p.id)).map(p => p.id)
  const result = lines.length && promos.length ? applyPromotions(lines, promos, {
    at: venueNow(config.venue?.timezone || 'Europe/London'), venueId: config.venue?.id, chosen, unlocked: chosen,
  }) : { applied: [], line_discounts: [], offers: [] }
  const weights = result.line_discounts
  const next = [...combos, ...result.applied.map(a => {
    const share = spread(a.discount_pence, weights)
    const linesMap = {}
    lines.forEach((l, i) => { if (share[i] > 0) linesMap[l.line_id] = share[i] })
    return { promotion_id: a.id, name: a.name, lines: linesMap }
  })]
  const shape = p => ({ promotion_id: p.promotion_id, name: p.name, ...(p.kind ? { kind: p.kind, count: p.count } : {}), lines: p.lines })
  const same = JSON.stringify(next.map(shape)) === JSON.stringify((check.promotions || []).map(shape))
  return { payload: { promotions: next }, changed: !same, offers: result.offers || [] }
}
