// shared/pos/pricing.js
//
// Till prices. ONE implementation for the till (building a line, showing the
// check), the cloud sequencer and reports (check totals), so the bill, the
// receipt and the Z report always agree. Money is in pence, VAT inclusive
// (UK menu prices).
//
// A line's price is fixed when it is added (the event carries it), so a
// menu price change never changes an open check:
//   unit_price  the dish price, or the chosen base options (Chicken £12.50)
//   modifiers   [{ group_id, group, option_id, label, prefix, price, base, depth }]
//               price = per unit, already 0 for "No" / "Light"
//   combo       [{ slot_id, slot, item_id, name, kitchen_name, section_id,
//                  course_id, upcharge, modifiers }]   meal deals
// line gross = (unit_price + modifier prices + combo upcharges and their
// modifier prices) x qty.

import { itemChoices, vatIncluded } from '../orderPricing.js'

export { vatIncluded }

export const PREFIXES = [
  { key: 'no',    label: 'No',    priced: false },
  { key: 'light', label: 'Light', priced: false },
  { key: 'extra', label: 'Extra', priced: true },
  { key: 'side',  label: 'On the side', priced: true },
]
const PREFIX_KEYS = PREFIXES.map(p => p.key)

export function money(pence) {
  const v = Math.round(Number(pence) || 0)
  return (v < 0 ? '-' : '') + '£' + (Math.abs(v) / 100).toFixed(2)
}

/** Split `total` pence over `weights` (whole pence, adds up exactly). */
export function spread(total, weights) {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0)
  if (!total || sum <= 0) return weights.map(() => 0)
  const raw = weights.map(w => (Math.max(0, w) * total) / sum)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((s, x) => s + x, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++
  return out
}

// ── Option groups for the till ─────────────────────────────────

/**
 * A group from the library (config.groups) as a till choice. Nested groups
 * (an option's child_group_id) always add to the price.
 */
export function groupChoice(g, { nested = false } = {}) {
  const max = Math.max(1, Number(g.max_select ?? g.max ?? 1))
  return {
    key: g.id, name: g.name,
    mode: nested ? 'extra' : (g.price_mode === 'extra' || g.mode === 'extra' ? 'extra' : 'base'),
    min: Math.max(0, Math.min(max, Number(g.min_select ?? g.min ?? 0))),
    max,
    prefixes: !!(g.pos_prefixes ?? g.prefixes),
    options: (g.options || []).map(o => ({
      id: o.option_id ?? o.id, label: o.label, price_pence: o.price_pence ?? null,
      child_group_id: o.child_group_id || null,
    })),
  }
}

/**
 * A dish's choices on the till: its ad-hoc variants and attached groups
 * (shared with online ordering's itemChoices), plus the till extras from
 * the library: "No / Light / Extra" prefixes and nested groups.
 */
export function posChoices(item, groupsById = {}) {
  return itemChoices(item).map(c => {
    if (c.key === 'variants') return { ...c, prefixes: false, options: c.options.map(o => ({ ...o, child_group_id: null })) }
    const lib = groupsById[c.key]
    return {
      ...c,
      prefixes: !!lib?.pos_prefixes,
      options: c.options.map(o => ({
        ...o,
        child_group_id: lib?.options?.find(x => (x.option_id ?? x.id) === o.id)?.child_group_id || null,
      })),
    }
  })
}

const asEntries = list => (Array.isArray(list) ? list : []).map(e => (typeof e === 'string' ? { id: e } : e)).filter(e => e && e.id)

/**
 * Price a selection against choice definitions.
 * picked: { [groupKey]: [{ id, prefix?, children?: { [childKey]: [...] } } | id] }
 * Returns { ok, base, extras, modifiers } or { ok: false, error }.
 */
export function priceChoices(choices, picked = {}, groupsById = {}, depth = 0) {
  if (depth > 3) return { ok: false, error: 'Options are nested too deeply' }
  let base = null
  let extras = 0
  const modifiers = []
  for (const c of choices) {
    const entries = asEntries(picked[c.key])
    const counted = entries.filter(e => e.prefix !== 'no')
    if (counted.length < c.min) {
      return { ok: false, error: c.min === 1 ? 'Choose ' + (c.key === 'variants' ? 'an option' : c.name.toLowerCase()) : 'Choose at least ' + c.min + ' for ' + c.name }
    }
    if (counted.length > c.max) return { ok: false, error: 'Choose up to ' + c.max + ' for ' + c.name }
    for (const e of entries) {
      const o = c.options.find(x => x.id === e.id)
      if (!o) return { ok: false, error: 'An option is no longer available' }
      const prefix = e.prefix && c.prefixes && PREFIX_KEYS.includes(e.prefix) ? e.prefix : null
      let price = 0
      let isBase = false
      if (c.mode === 'base' && depth === 0) {
        isBase = true
        if (o.price_pence != null) base = (base ?? 0) + o.price_pence
      } else {
        price = prefix === 'no' || prefix === 'light' ? 0 : (o.price_pence ?? 0)
        extras += price
      }
      modifiers.push({ group_id: c.key, group: c.name, option_id: o.id, label: o.label, prefix, price, base: isBase, depth })
      if (o.child_group_id && prefix !== 'no') {
        const childGroup = groupsById[o.child_group_id]
        if (childGroup) {
          const child = priceChoices([groupChoice(childGroup, { nested: true })], e.children || {}, groupsById, depth + 1)
          if (!child.ok) return child
          extras += child.extras
          modifiers.push(...child.modifiers)
        }
      }
    }
  }
  return { ok: true, base, extras, modifiers }
}

/** The text of a modifier on a ticket or bill: "No onion", "Extra cheese". */
export function modifierText(m) {
  const prefix = PREFIXES.find(p => p.key === m.prefix)
  return (prefix ? prefix.label + ' ' : '') + m.label
}

/**
 * Build the priced part of a line from a menu item and a selection.
 * item: the config item ({ id, price_pence, kind, choices?, combo_slots? }),
 * selection: { choices, combo: { [slotId]: [{ item_id, choices }] } },
 * itemsById / groupsById: from the config.
 * Returns { ok, unit_price, modifiers, combo } or { ok: false, error }.
 */
export function priceItem(item, selection = {}, { itemsById = {}, groupsById = {} } = {}) {
  const choices = item.pos_choices || posChoices(item, groupsById)
  const priced = priceChoices(choices, selection.choices || {}, groupsById)
  if (!priced.ok) return priced
  const unit = priced.base ?? item.price_pence ?? null
  if (unit == null) return { ok: false, error: 'This item has no price' }

  let combo = null
  if (item.kind === 'combo') {
    combo = []
    for (const slot of item.combo_slots || []) {
      const picks = (selection.combo && selection.combo[slot.id]) || []
      if (picks.length < slot.min) return { ok: false, error: 'Choose ' + (slot.min > 1 ? slot.min + ' for ' : '') + slot.name.toLowerCase() }
      if (picks.length > slot.max) return { ok: false, error: 'Choose up to ' + slot.max + ' for ' + slot.name.toLowerCase() }
      for (const p of picks) {
        const opt = (slot.options || []).find(o => o.item_id === p.item_id)
        const part = itemsById[p.item_id]
        if (!opt || !part) return { ok: false, error: slot.name + ': that choice is no longer available' }
        const partChoices = part.pos_choices || posChoices(part, groupsById)
        // A part's base options don't change the deal's price; its extras do.
        const pp = priceChoices(partChoices, p.choices || {}, groupsById)
        if (!pp.ok) return { ok: false, error: part.name + ': ' + pp.error }
        combo.push({
          slot_id: slot.id, slot: slot.name, item_id: part.id, name: part.name,
          kitchen_name: part.kitchen_name || null, section_id: part.section_id ?? null,
          course_id: part.course_id ?? null, upcharge: Number(opt.upcharge_pence) || 0,
          modifiers: pp.modifiers.map(m => (m.base ? m : { ...m })),
          extras: pp.extras,
        })
      }
    }
  }
  return { ok: true, unit_price: unit, modifiers: priced.modifiers, combo }
}

/**
 * A dish's VAT rate on the till: the dish's own rate for the revenue
 * centre's mode (eat in / takeaway), else its section's (both resolved into
 * item.vat by the API's config), else the venue default.
 */
export function posVatRate(item, mode, settings = {}) {
  const key = mode === 'takeaway' ? 'takeaway' : 'eat_in'
  const v = item?.vat?.[key]
  if (v != null) return Number(v)
  const d = key === 'takeaway' ? settings.default_vat_rate_takeaway : settings.default_vat_rate_eat_in
  return d != null ? Number(d) : 20
}

/** One unit of a line, everything included. */
export function lineUnit(line) {
  let u = Number(line.unit_price) || 0
  for (const m of line.modifiers || []) u += Number(m.price) || 0
  for (const c of line.combo || []) {
    u += Number(c.upcharge) || 0
    for (const m of c.modifiers || []) if (!m.base) u += Number(m.price) || 0
  }
  return u
}

export function lineGross(line) {
  return lineUnit(line) * (Number(line.qty) || 0)
}

export const isActiveLine = l => l.status !== 'voided'

// ── Check totals ───────────────────────────────────────────────

function discountOff(d, base) {
  if (base <= 0) return 0
  if (d.comp) return base
  if (d.type === 'percent') return Math.min(base, Math.round(base * (Number(d.value) || 0) / 100))
  return Math.min(base, Math.max(0, Math.round(Number(d.value) || 0)))
}

/**
 * Everything a check adds up to. Order:
 *   1. line discounts and comps (comps first), each on what is left on its lines
 *   2. automatic promotions (check.promotions, set by the till at bill / pay time)
 *   3. check discounts, spread over the lines by what is left on them
 *   4. service charge on what is left (check.service_charge.percent or .amount)
 * VAT is the VAT inside what is paid for each line, at the line's rate.
 */
export function checkTotals(check) {
  const lines = (check.lines || []).filter(isActiveLine)
  const rows = lines.map(l => ({ id: l.id, line: l, gross: lineGross(l), discount: 0, promo: 0 }))
  const left = r => r.gross - r.discount - r.promo
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  const discounts = []

  const all = check.discounts || []
  const lineDiscounts = [...all.filter(d => d.scope === 'line' && d.comp), ...all.filter(d => d.scope === 'line' && !d.comp)]
  for (const d of lineDiscounts) {
    const targets = (d.line_ids || []).map(id => byId[id]).filter(Boolean)
    if (!targets.length) continue
    let off = 0
    if (d.comp || d.type === 'percent') {
      for (const r of targets) { const x = discountOff(d, left(r)); r.discount += x; off += x }
    } else {
      const amount = discountOff(d, targets.reduce((s, r) => s + left(r), 0))
      spread(amount, targets.map(left)).forEach((x, i) => { targets[i].discount += x })
      off = amount
    }
    discounts.push({ id: d.id, name: d.name, comp: !!d.comp, scope: 'line', amount: off })
  }

  let promotions = 0
  for (const p of check.promotions || []) {
    let off = 0
    for (const [lineId, pence] of Object.entries(p.lines || {})) {
      const r = byId[lineId]
      if (!r) continue
      const x = Math.min(left(r), Math.max(0, Math.round(Number(pence) || 0)))
      r.promo += x
      off += x
    }
    promotions += off
    if (off > 0) discounts.push({ id: p.promotion_id, name: p.name, promotion: true, scope: 'check', amount: off })
  }

  for (const d of all.filter(d => d.scope !== 'line')) {
    const base = rows.reduce((s, r) => s + left(r), 0)
    const amount = discountOff(d, base)
    spread(amount, rows.map(left)).forEach((x, i) => { rows[i].discount += x })
    discounts.push({ id: d.id, name: d.name, comp: !!d.comp, scope: 'check', amount })
  }

  const subtotal = rows.reduce((s, r) => s + r.gross, 0)
  const discount = rows.reduce((s, r) => s + r.discount + r.promo, 0)
  const net = subtotal - discount

  const sc = check.service_charge
  let serviceCharge = 0
  if (sc && !sc.removed) {
    if (sc.amount != null) serviceCharge = Math.max(0, Math.round(Number(sc.amount) || 0))
    else serviceCharge = Math.round(net * (Number(sc.percent) || 0) / 100)
  }

  const vatByRate = new Map()
  const lineTotals = rows.map(r => {
    const paid = left(r)
    const rate = Number(r.line.vat_rate) || 0
    const vat = vatIncluded(paid, rate)
    const v = vatByRate.get(rate) || { rate, gross: 0, vat: 0 }
    v.gross += paid; v.vat += vat
    vatByRate.set(rate, v)
    return { id: r.id, gross: r.gross, discount: r.discount + r.promo, net: paid, vat_rate: rate, vat }
  })
  if (serviceCharge && sc?.vat_rate) {
    const rate = Number(sc.vat_rate) || 0
    const v = vatByRate.get(rate) || { rate, gross: 0, vat: 0 }
    v.gross += serviceCharge; v.vat += vatIncluded(serviceCharge, rate)
    vatByRate.set(rate, v)
  }
  const vat = [...vatByRate.values()].filter(v => v.gross).sort((a, b) => a.rate - b.rate)
    .map(v => ({ rate: v.rate, net: v.gross - v.vat, vat: v.vat, gross: v.gross }))

  const total = net + serviceCharge
  const payments = (check.payments || []).filter(p => !p.voided)
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const tips = payments.reduce((s, p) => s + (Number(p.tip) || 0), 0)
  const refunded = (check.refunds || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)

  return {
    lines: lineTotals,
    subtotal, discount, promotions, discounts,
    net, service_charge: serviceCharge, total,
    vat, vat_total: vat.reduce((s, v) => s + v.vat, 0),
    paid, tips, refunded,
    balance: total - paid,
    items: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
  }
}

/** Lines with what is left on them, for a promotion engine run (shared/promotions.js). */
// Only line discounts and comps come before promotions, so they are the only
// ones taken off here; check discounts are taken after promotions.
export function promoLines(check) {
  const only = { ...check, promotions: [], service_charge: null, discounts: (check.discounts || []).filter(d => d.scope === 'line') }
  const byId = Object.fromEntries(checkTotals(only).lines.map(l => [l.id, l]))
  return (check.lines || []).filter(isActiveLine).map(l => ({
    line_id: l.id, item_id: l.item_id, section_id: l.section_id ?? null, qty: Number(l.qty) || 1,
    line_total_pence: byId[l.id]?.net ?? lineGross(l),
  }))
}
