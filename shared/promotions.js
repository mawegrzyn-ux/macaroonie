// shared/promotions.js
//
// Online ordering promotions (migration 131). ONE implementation, used by:
//   - shared/orderPricing.js priceBasket(), so the server (orderSvc.js,
//     the only prices that count) and the guest ordering page (served as
//     /order-api/promotions.js) take off exactly the same amounts;
//   - the admin Promotions page, for the one-line summary of an offer.
// Plain ESM, no dependencies, no DOM.
//
// A promotion (the public shape; the code itself only reaches the browser
// after the guest types it):
//   { id, name, description, badge_text,
//     kind: 'basket' | 'item' | 'bogo' | 'free_item' | 'bundle' | 'tiered',
//     discount_type: 'percent' | 'amount', discount_value,  // % or pence
//     item_ids, section_ids,        // dishes covered (item, bogo); both empty = every dish
//     buy_qty, get_qty, get_percent,// bogo: every buy+get covered dishes, the get cheapest are get_percent off
//                                   // free_item: get_qty of the covered dishes are get_percent off (100 = free)
//     bundle, bundle_price_pence,   // bundle (meal deal): [{ label, item_ids, section_ids, qty }] for a set price
//     tiers,                        // tiered: [{ min_pence, value }], value in discount_type, highest reached applies
//     min_subtotal_pence,           // spend at least this (before discounts)
//     required_item_ids,            // at least one of these dishes in the basket
//     max_discount_pence,           // cap on what this promotion takes off
//     apply_mode: 'auto' | 'manual' | 'code',
//     schedule: { from, until, times },  // like menu schedules (shared/menuSchedule.js)
//     venue_ids,                    // empty = every venue
//     exclusive, sort_order }       // list order = priority, first applies first
//
// How a basket is discounted (applyPromotions):
//   1. Promotions in play: automatic ones, manual ones the guest applied,
//      code ones whose code the guest entered. Each must be on at the
//      time of ordering, at this venue, with its conditions met.
//   2. In priority order, each takes its discount off what is still left
//      to pay on each line (so a basket % after a dish discount is a % of
//      the reduced price). An exclusive promotion only applies when
//      nothing else has, and then nothing else does.
//   3. A basket discount is spread over the lines in proportion to what
//      they cost, so VAT stays right per line.

import { menuOnAt, scheduleLabel } from './menuSchedule.js'

const asList = v => (Array.isArray(v) ? v : [])
const has = (list, v) => asList(list).includes(v)

export function isLiveAt(p, { at = null, venueId = null } = {}) {
  if (p.is_active === false) return false
  if (venueId && asList(p.venue_ids).length && !has(p.venue_ids, venueId)) return false
  if (at && !menuOnAt(p.schedule || {}, at)) return false
  return true
}

/** Is this dish one of these dishes / sections? Both empty = every dish. */
export function coversIds(itemIds, sectionIds, line) {
  const items = asList(itemIds)
  const sections = asList(sectionIds)
  if (!items.length && !sections.length) return true
  return items.includes(line.item_id) || (line.section_id != null && sections.includes(line.section_id))
}

/** Does the offer cover this dish? A meal deal covers the dishes of any of its parts. */
export function covers(p, line) {
  if (p.kind === 'bundle') return asList(p.bundle).some(c => coversIds(c.item_ids, c.section_ids, line))
  return coversIds(p.item_ids, p.section_ids, line)
}

const compQty = c => Math.max(1, Math.floor(Number(c.qty) || 1))
const tiersOf = p => asList(p.tiers)
  .map(t => ({ min_pence: Math.max(0, Number(t.min_pence) || 0), value: Math.max(0, Number(t.value) || 0) }))
  .filter(t => t.value > 0)
  .sort((a, b) => a.min_pence - b.min_pence)

/** The tier a subtotal reaches, and the next one up (tiered offers). */
export function tierFor(p, subtotal) {
  const tiers = tiersOf(p)
  let reached = null
  let next = null
  for (const t of tiers) {
    if (subtotal >= t.min_pence) reached = t
    else { next = t; break }
  }
  return { reached, next, tiers }
}

// Every unit of every line the match accepts, valued at what is left on it.
function unitsOf(lines, vals, match) {
  const units = []
  lines.forEach((l, i) => {
    if (vals[i] <= 0 || !match(l)) return
    for (let k = 0; k < l.qty; k++) units.push({ i, v: vals[i] / l.qty, line: l })
  })
  return units
}

// The units a free-item offer makes free: the cheapest get_qty it covers.
function freeUnits(p, lines, vals) {
  const units = unitsOf(lines, vals, l => covers(p, l)).sort((a, b) => a.v - b.v)
  return units.slice(0, Math.max(1, Number(p.get_qty) || 1))
}

// Meal deals: as many complete deals as the basket makes, each part filled
// with the dearest matching dishes not used yet (the guest saves the most).
// missing = the parts the first deal still lacks.
function bundleFill(p, lines, vals) {
  const comps = asList(p.bundle)
  const pool = unitsOf(lines, vals, l => covers(p, l)).sort((a, b) => b.v - a.v)
  const groups = []
  let missing = []
  if (!comps.length) return { groups, missing, any: pool.length > 0 }
  for (;;) {
    const picked = []
    const miss = []
    for (const [index, c] of comps.entries()) {
      const need = compQty(c)
      const got = pool.filter(u => !u.used && !picked.includes(u) && coversIds(c.item_ids, c.section_ids, u.line)).slice(0, need)
      if (got.length < need) miss.push({ index, label: c.label || 'a dish', qty: need - got.length })
      picked.push(...got)
    }
    if (miss.length) { if (!groups.length) missing = miss; break }
    picked.forEach(u => { u.used = true })
    groups.push(picked)
  }
  return { groups, missing, any: pool.length > 0 }
}

/** One line for guests and staff: "10% off your order", "Buy 2 get 1 free". */
export function promoSummary(p, money = pence => '£' + (pence / 100).toFixed(2)) {
  const offOf = v => (p.discount_type === 'amount' ? money(v) : v + '%')
  const off = offOf(p.discount_value)
  if (p.kind === 'free_item') {
    const n = Math.max(1, Number(p.get_qty) || 1)
    const dish = n === 1 ? 'dish' : 'dishes'
    return Number(p.get_percent) >= 100 ? (n === 1 ? 'A free dish' : n + ' free dishes') : p.get_percent + '% off ' + n + ' ' + dish
  }
  if (p.kind === 'bundle') {
    const parts = asList(p.bundle).map(c => (compQty(c) > 1 ? compQty(c) + ' x ' : '') + (c.label || 'dish'))
    return (parts.length ? parts.join(' + ') : 'Meal deal') + ' for ' + money(Number(p.bundle_price_pence) || 0)
  }
  if (p.kind === 'tiered') {
    const tiers = tiersOf(p)
    if (!tiers.length) return 'Spend more, save more'
    return 'Spend ' + tiers.map(t => money(t.min_pence) + ' get ' + offOf(t.value) + ' off').join(', ')
  }
  if (p.kind === 'basket') return off + ' off your order'
  if (p.kind === 'item') return off + ' off' + (p.discount_type === 'amount' ? ' each' : '') + ' selected dishes'
  const get = Number(p.get_percent) >= 100 ? 'free' : p.get_percent + '% off'
  return 'Buy ' + p.buy_qty + ' get ' + p.get_qty + ' ' + get
}

/** The small print for a Promo block: minimum spend, times and dates. */
export function promoTerms(p, money = pence => '£' + (pence / 100).toFixed(2)) {
  const parts = []
  if (Number(p.min_subtotal_pence) > 0) parts.push('Minimum spend ' + money(p.min_subtotal_pence))
  const when = scheduleLabel(p.schedule || {})
  if (when) parts.push(when)
  return parts.join(' · ')
}

/**
 * Where a Promo block's button goes: the ordering page with the offer
 * ready (?promo=CODE opens a code, ?offer=<id> applies a tap-to-apply
 * offer; automatic ones need nothing).
 */
export function promoLink(p, orderPath = '/order') {
  if (p.apply_mode === 'code' && p.code) return orderPath + '?promo=' + encodeURIComponent(p.code)
  if (p.apply_mode === 'manual') return orderPath + '?offer=' + encodeURIComponent(p.id)
  return orderPath
}

/** Switched on, not used up, and today within its dates (times of day aside). */
export function promoRunning(p, today) {
  if (!p.is_active) return false
  if (p.max_uses && Number(p.uses) >= p.max_uses) return false
  const s = p.schedule || {}
  if (s.from && today < s.from) return false
  if (s.until && today > s.until) return false
  return true
}

// Split `total` over `weights` in proportion, whole pence, never more than
// a weight (largest remainder).
function allocate(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)
  const t = Math.min(total, sum)
  const raw = weights.map(w => (w * t) / sum)
  const out = raw.map(Math.floor)
  let left = t - out.reduce((s, v) => s + v, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    if (out[i] < weights[i]) { out[i] += 1; left -= 1 }
  }
  return out
}

// Fractional per-line discounts to whole pence: round the TOTAL once and
// split it (rounding each line on its own could take a penny too many, so
// a £15 meal deal would come to £14.99).
function settle(raw, rem) {
  const total = Math.round(raw.reduce((t, x) => t + x, 0))
  return allocate(total, raw).map((x, i) => Math.min(rem[i], x))
}

// Why a promotion can't apply to this basket yet, or null when it can.
function unmet(p, lines, subtotal) {
  const full = lines.map(l => l.line_total_pence)
  // A free dish doesn't count towards the spend that earns it.
  const spend = p.kind === 'free_item'
    ? subtotal - Math.round(freeUnits(p, lines, full).reduce((s, u) => s + u.v, 0))
    : subtotal
  const min = Number(p.min_subtotal_pence) || 0
  if (spend < min) return { reason: 'min_subtotal', short_pence: min - spend }
  if (p.kind === 'tiered') {
    const { reached, tiers } = tierFor(p, subtotal)
    if (!tiers.length) return { reason: 'no_items' }
    if (!reached) return { reason: 'next_tier', short_pence: tiers[0].min_pence - subtotal, value: tiers[0].value, discount_type: p.discount_type }
  }
  const req = asList(p.required_item_ids)
  if (req.length && !lines.some(l => req.includes(l.item_id))) return { reason: 'required_item', item_ids: req }
  if (p.kind === 'item' || p.kind === 'bogo') {
    const units = lines.reduce((n, l) => n + (covers(p, l) ? l.qty : 0), 0)
    if (!units) return { reason: 'no_items' }
    const need = (Number(p.buy_qty) || 1) + (Number(p.get_qty) || 1)
    if (p.kind === 'bogo' && units < need) return { reason: 'bogo_qty', more: need - units }
  }
  if (p.kind === 'free_item' && !lines.some(l => covers(p, l))) return { reason: 'free_item_missing' }
  if (p.kind === 'bundle') {
    const fill = bundleFill(p, lines, full)
    if (!fill.groups.length) return fill.any ? { reason: 'bundle_missing', missing: fill.missing } : { reason: 'no_items' }
  }
  return null
}

// What one promotion takes off each line, given what is left on each.
function discountFor(p, lines, rem, subtotal) {
  const v = Math.max(0, Number(p.discount_value) || 0)
  let d = lines.map(() => 0)
  if (p.kind === 'basket' || p.kind === 'tiered') {
    const value = p.kind === 'tiered' ? (tierFor(p, subtotal).reached?.value || 0) : v
    const base = rem.reduce((s, r) => s + r, 0)
    const total = p.discount_type === 'amount' ? Math.min(value, base) : Math.round(base * Math.min(value, 100) / 100)
    d = allocate(total, rem)
  } else if (p.kind === 'free_item') {
    const pct = Math.min(100, Math.max(1, Number(p.get_percent) || 100))
    const raw = lines.map(() => 0)
    for (const u of freeUnits(p, lines, rem)) raw[u.i] += u.v * pct / 100
    d = settle(raw, rem)
  } else if (p.kind === 'bundle') {
    const price = Math.max(0, Number(p.bundle_price_pence) || 0)
    const raw = lines.map(() => 0)
    for (const group of bundleFill(p, lines, rem).groups) {
      const value = group.reduce((s, u) => s + u.v, 0)
      if (value <= price) continue
      for (const u of group) raw[u.i] += (value - price) * u.v / value
    }
    d = settle(raw, rem)
  } else if (p.kind === 'item') {
    d = lines.map((l, i) => {
      if (!covers(p, l) || rem[i] <= 0) return 0
      return p.discount_type === 'amount' ? Math.min(rem[i], v * l.qty) : Math.round(rem[i] * Math.min(v, 100) / 100)
    })
  } else if (p.kind === 'bogo') {
    // Every buy+get covered dishes (dearest first), the get cheapest of
    // each group are get_percent off. Unit value = what is left on the line.
    const units = unitsOf(lines, rem, l => covers(p, l)).sort((a, b) => b.v - a.v)
    const buy = Math.max(1, Number(p.buy_qty) || 1)
    const get = Math.max(1, Number(p.get_qty) || 1)
    const pct = Math.min(100, Math.max(1, Number(p.get_percent) || 100))
    const size = buy + get
    const raw = lines.map(() => 0)
    for (let g = 0; (g + 1) * size <= units.length; g++) {
      for (let k = buy; k < size; k++) {
        const u = units[g * size + k]
        raw[u.i] += u.v * pct / 100
      }
    }
    d = settle(raw, rem)
  }
  const total = d.reduce((s, x) => s + x, 0)
  const cap = Number(p.max_discount_pence) || 0
  if (cap > 0 && total > cap) d = allocate(cap, d)
  return d
}

// What an automatic offer tells the guest when it doesn't apply yet: only
// things one more step fixes (spend a bit more, add a dish).
const NUDGES = new Set(['min_subtotal', 'bogo_qty', 'free_item_missing', 'bundle_missing', 'next_tier'])

const byPriority = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.name).localeCompare(String(b.name))

/**
 * @param lines    priced lines: [{ item_id, section_id, qty, line_total_pence }]
 * @param promos   promotions (see top of file)
 * @param ctx      { at: { date, dow, minutes } venue-local ordering time,
 *                   venueId, chosen: [manual promotion ids the guest applied],
 *                   unlocked: [code promotion ids whose code the guest entered] }
 * @returns {{ applied: {id,name,code,discount_pence}[], line_discounts: number[],
 *             discount_pence: number,
 *             offers: {id,name,description,saving_pence}[],   // manual ones the guest can apply now
 *             notices: {id,name,reason,short_pence?,more?,item_ids?,missing?,value?}[] }}
 */
export function applyPromotions(lines, promos, ctx = {}) {
  const chosen = new Set(asList(ctx.chosen))
  const unlocked = new Set(asList(ctx.unlocked))
  const subtotal = lines.reduce((s, l) => s + l.line_total_pence, 0)
  const rem = lines.map(l => l.line_total_pence)
  const applied = []
  const offers = []
  const notices = []
  const lineDiscounts = lines.map(() => 0)
  if (!lines.length) return { applied, line_discounts: lineDiscounts, discount_pence: 0, offers, notices }

  const inPlay = []
  for (const p of [...asList(promos)].sort(byPriority)) {
    const mode = p.apply_mode || 'auto'
    const picked = mode === 'auto' || (mode === 'manual' && chosen.has(p.id)) || (mode === 'code' && unlocked.has(p.id))
    const live = isLiveAt(p, ctx)
    if (!live) {
      // The guest asked for it: say why it isn't taking anything off.
      if (picked && mode !== 'auto') notices.push({ id: p.id, name: p.name, reason: 'not_now' })
      continue
    }
    const why = unmet(p, lines, subtotal)
    if (mode === 'manual' && !picked) {
      if (!why) {
        const saving = discountFor(p, lines, lines.map(l => l.line_total_pence), subtotal).reduce((s, x) => s + x, 0)
        if (saving > 0) offers.push({ id: p.id, name: p.name, description: p.description || null, saving_pence: saving })
      }
      continue
    }
    if (!picked) continue
    if (why) {
      // Automatic offers only nudge when the guest is close (spend more,
      // add one more); anything the guest applied says what's missing.
      if (mode !== 'auto' || NUDGES.has(why.reason)) notices.push({ id: p.id, name: p.name, ...why })
      continue
    }
    inPlay.push(p)
  }

  let closed = false
  for (const p of inPlay) {
    if (closed || (p.exclusive && applied.length)) {
      notices.push({ id: p.id, name: p.name, reason: 'not_combinable' })
      continue
    }
    const d = discountFor(p, lines, rem, subtotal)
    const total = d.reduce((s, x) => s + x, 0)
    if (total <= 0) continue
    d.forEach((x, i) => { rem[i] -= x; lineDiscounts[i] += x })
    applied.push({ id: p.id, name: p.name, code: p.apply_mode === 'code' ? (p.code || null) : null, discount_pence: total })
    if (p.kind === 'tiered') {
      const { next } = tierFor(p, subtotal)
      if (next) notices.push({ id: p.id, name: p.name, reason: 'next_tier', short_pence: next.min_pence - subtotal, value: next.value, discount_type: p.discount_type })
    }
    if (p.exclusive) closed = true
  }

  return {
    applied,
    line_discounts: lineDiscounts,
    discount_pence: lineDiscounts.reduce((s, x) => s + x, 0),
    offers,
    notices,
  }
}

/** What to tell the guest about a notice ('' = nothing). */
export function noticeText(n, money = pence => '£' + (pence / 100).toFixed(2)) {
  if (n.reason === 'min_subtotal') return 'Spend ' + money(n.short_pence) + ' more to get ' + n.name
  if (n.reason === 'bogo_qty') return 'Add ' + n.more + ' more to get ' + n.name
  if (n.reason === 'next_tier') return 'Spend ' + money(n.short_pence) + ' more to get ' + (n.discount_type === 'amount' ? money(n.value) : n.value + '%') + ' off'
  if (n.reason === 'free_item_missing') return n.name + ': add your free dish to the basket'
  if (n.reason === 'bundle_missing') {
    const parts = asList(n.missing).map(m => (m.qty > 1 ? m.qty + ' x ' : '') + m.label)
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : (parts[0] || 'a dish')
    return 'Add ' + list + ' to get ' + n.name
  }
  if (n.reason === 'required_item') return n.name + ' needs a particular dish in your basket'
  if (n.reason === 'no_items') return n.name + ' needs a dish it covers in your basket'
  if (n.reason === 'not_now') return n.name + " isn't available right now"
  if (n.reason === 'not_combinable') return n.name + " can't be combined with your other offer"
  return ''
}

/** Venue-local ordering time { date, dow, minutes } in a browser or on the server. */
export function venueNow(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date)
  const m = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return {
    date: m.year + '-' + m.month + '-' + m.day,
    dow: new Date(Date.UTC(+m.year, +m.month - 1, +m.day)).getUTCDay(),
    minutes: Number(m.hour) * 60 + Number(m.minute),
  }
}
