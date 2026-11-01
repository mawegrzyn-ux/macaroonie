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
//   combo       [{ step_id, step, option_id, item_id, name, kitchen_name,
//                  section_id, course_id, upcharge, modifiers, extras, custom }]
//               a combo's picks (shared/combos.js); a typed-in choice has
//               item_id null and goes to the kitchen like the combo itself
// line gross = (unit_price + modifier prices + combo upcharges and their
// modifier prices) x qty.

import { itemChoices, vatIncluded, basePrice } from '../orderPricing.js'
import { isCombo, priceCombo, dealChoices, withDealPicks } from '../combos.js'
import { taxFor } from '../tax.js'
import { chargeAmount, chargeApplies } from './charges.js'

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
    repeat: !!(g.allow_repeat ?? g.repeat),
    on_request: false,
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
 * the library: "No / Light / Extra" prefixes and nested groups. A till's
 * and a kiosk's dishes carry their menu's option display settings
 * (item.variant_rules, services/posSvc.js tillMenuData()): unpriced options
 * left out, £0 shown without a price, as online ordering does.
 */
export function posChoices(item, groupsById = {}) {
  return itemChoices(item, item.variant_rules || {}).map(c => {
    if (c.key === 'variants') return { ...c, prefixes: false, options: c.options.map(o => ({ ...o, child_group_id: null })) }
    const lib = groupsById[c.key]
    return {
      ...c,
      repeat: !!(c.repeat || lib?.allow_repeat),
      on_request: c.min === 0 && !!(c.on_request || lib?.on_request),
      prefixes: !!lib?.pos_prefixes,
      options: c.options.map(o => ({
        ...o,
        child_group_id: lib?.options?.find(x => (x.option_id ?? x.id) === o.id)?.child_group_id || null,
      })),
    }
  })
}

/**
 * A meal deal's part as the deal asks it: the dish's till choices with the
 * combo choice's changes (groups, shared/combos.js dealChoices()). A group
 * the deal asks instead comes from the library (config.groups), as if the
 * dish had it attached: its own prices, no prices of the dish's.
 */
export function partChoices(part, groups, groupsById = {}) {
  const own = part.pos_choices || posChoices(part, groupsById)
  if (!groups) return own
  return dealChoices(own, groups, id => {
    const g = groupsById[id]
    if (!g) return null
    return posChoices({ variant_groups: [{ ...g, group_id: g.id }], variant_rules: part.variant_rules }, groupsById)[0] || null
  })
}

/**
 * Picks kept to what these choices offer (a dish's options carried into a
 * deal that asks fewer: "Make it a combo"): groups and options the choices
 * don't have go, and a group keeps no more than its most.
 */
export function picksWithin(choices, picked = {}) {
  const out = {}
  for (const c of choices || []) {
    const ids = new Set((c.options || []).map(o => o.id))
    const kept = asEntries(picked[c.key]).filter(e => ids.has(e.id))
    let counted = 0
    const list = []
    for (const e of kept) {
      if (e.prefix !== 'no') { if (counted >= c.max) continue; counted++ }
      list.push(e)
    }
    if (list.length) out[c.key] = list
  }
  return out
}

const asEntries = list => (Array.isArray(list) ? list : []).map(e => (typeof e === 'string' ? { id: e } : e)).filter(e => e && e.id)

/**
 * More picks, more dishes (a till layout's Dish choices zone with
 * split_picks, pos/src/components/LayoutChoices.jsx): a group that takes one
 * pick (max 1, no repeats, no No / Light / Extra) can be picked more than
 * once there, each pick a dish of its own: Pad Thai with Chicken and Prawn
 * is two Pad Thai, one of each. splitsPicks(): a group that can.
 */
export const splitsPicks = c => !!c && c.max === 1 && !c.repeat && !c.prefixes

/**
 * The selections, one per dish: every other group, and a group picked once,
 * goes on every dish; groups picked more than once give their first pick to
 * the first dish, the second to the second, so they must have the same
 * number of picks. choices: the dish's till choices (posChoices()).
 * Returns { ok: true, selections } (the selection itself when nothing is
 * picked more than once) or { ok: false, error }.
 */
export function splitPicks(choices, selection = {}) {
  const picked = selection?.choices || {}
  const splits = new Map()
  let n = 1
  for (const c of choices || []) {
    if (!splitsPicks(c)) continue
    const got = asEntries(picked[c.key])
    if (got.length < 2) continue
    if (n > 1 && got.length !== n) {
      return { ok: false, error: c.name + ': pick ' + n + ' (one for each dish) or 1 for all of them' }
    }
    n = got.length
    splits.set(c.key, got)
  }
  if (n === 1) return { ok: true, selections: [selection] }
  const selections = []
  for (let i = 0; i < n; i++) {
    const own = {}
    for (const [key, list] of Object.entries(picked)) own[key] = splits.has(key) ? [splits.get(key)[i]] : list
    selections.push({ ...selection, choices: own })
  }
  return { ok: true, selections }
}

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
    if (!c.repeat && new Set(entries.map(e => e.id)).size !== entries.length) return { ok: false, error: c.name + ': choose each option once' }
    for (const e of entries) {
      const o = c.options.find(x => x.id === e.id)
      if (!o) return { ok: false, error: 'An option is no longer available' }
      const prefix = e.prefix && c.prefixes && PREFIX_KEYS.includes(e.prefix) ? e.prefix : null
      let price = 0
      let isBase = false
      if (c.mode === 'base' && depth === 0) {
        isBase = true
        // An option left empty or at £0 keeps the dish's own price.
        if (basePrice(o) != null) base = (base ?? 0) + basePrice(o)
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

/** The text of a modifier on a ticket or bill: "No onion", "Extra cheese", "2 x Cheese". */
export function modifierText(m) {
  const prefix = PREFIXES.find(p => p.key === m.prefix)
  return (m.count > 1 ? m.count + ' x ' : '') + (prefix ? prefix.label + ' ' : '') + m.label
}

/**
 * Modifiers for showing: the same option picked more than once in a row (a
 * group that allows repeats: Cheese, Cheese) becomes one entry with a count
 * and the summed price ("2 x Cheese +£2.00"). Lines keep one modifier per
 * pick; group only where they are shown or printed.
 */
export function groupModifiers(mods = []) {
  const out = []
  for (const m of mods || []) {
    const last = out[out.length - 1]
    if (last && m.option_id && last.option_id === m.option_id && last.group_id === m.group_id
      && (last.prefix || null) === (m.prefix || null) && (last.depth || 0) === (m.depth || 0) && !!last.base === !!m.base) {
      last.count = (last.count || 1) + 1
      last.price = (Number(last.price) || 0) + (Number(m.price) || 0)
      continue
    }
    out.push({ ...m })
  }
  return out
}

/**
 * Build the priced part of a line from a menu item and a selection.
 * item: the config item ({ id, price_pence, kind, combo?, choices? }),
 * selection: { choices, combo: { [stepId]: [{ option_id, item_id, choices }] } },
 * ctx: { itemsById, groupsById, sectionItems, soldOut(itemId) } from the config.
 * A combo's price may be 0; its picks follow shared/combos.js.
 * Returns { ok, unit_price, modifiers, combo } or { ok: false, error }.
 */
export function priceItem(item, selection = {}, { itemsById = {}, groupsById = {}, sectionItems = {}, soldOut = null } = {}) {
  const choices = item.pos_choices || posChoices(item, groupsById)
  const priced = priceChoices(choices, selection.choices || {}, groupsById)
  if (!priced.ok) return priced
  let unit = priced.base ?? item.price_pence ?? null
  let combo = null
  if (isCombo(item)) {
    unit = unit ?? 0
    const pc = priceCombo(item, selection, { itemsById, sectionItems, soldOut }, (part, picked, groups) => {
      // What the deal picks itself (one option left) is on the line too.
      const choices = partChoices(part, groups, groupsById)
      const pp = priceChoices(choices, withDealPicks(choices, picked || {}), groupsById)
      return pp.ok ? { ok: true, extras: pp.extras, detail: pp.modifiers } : pp
    })
    if (!pc.ok) return pc
    combo = pc.parts.map(p => {
      const part = p.item_id ? itemsById[p.item_id] : null
      return {
        step_id: p.step_id, step: p.step, option_id: p.option_id, item_id: p.item_id,
        name: p.name, kitchen_name: p.kitchen_name || part?.kitchen_name || null,
        section_id: p.section_id ?? null, course_id: part?.course_id ?? null,
        upcharge: p.upcharge, modifiers: p.detail || [], extras: p.extras, custom: p.custom || undefined,
      }
    })
  }
  if (unit == null) return { ok: false, error: 'This item has no price' }
  return { ok: true, unit_price: unit, modifiers: priced.modifiers, combo }
}

/**
 * A dish's tax on the till for a check: { vat_rate, tax_rate_id }. The till
 * config gives each dish its settings (item.tax = [dish, section, menu]) and
 * the tenant's rates; the check's order type and revenue stream decide
 * (shared/tax.js). item null = an item not on the menu: the default rate.
 */
export function posTax(item, check, config) {
  const t = taxFor(item?.tax || [], {
    venue_id: config?.venue?.id || null,
    order_type_id: check?.order_type_id || null,
    revenue_stream_id: check?.revenue_stream_id || null,
  }, config?.tax_rates || [])
  return { vat_rate: t.vat_rate, tax_rate_id: t.tax_rate_id }
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
 *   4. charges (check.charges, shared/pos/charges.js): a percent of what is
 *      left, or an amount; each at its own VAT rate
 * VAT is the VAT inside what is paid for each line, at the line's rate.
 * service_charge is every charge that counts, added up (pos_checks.service_charge,
 * reports, Cash Recon); charges lists each, with what it would come to.
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
    if (off > 0) discounts.push({ id: p.promotion_id, name: p.kind === 'combo' && p.count > 1 ? p.name + ' x ' + p.count : p.name, promotion: true, combo: p.kind === 'combo' || undefined, scope: 'check', amount: off })
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

  // Charges: each that counts adds to the total; one taken off, or waiting
  // for more guests, shows what it would come to.
  let serviceCharge = 0
  const charges = (check.charges || []).map(x => {
    const would = chargeAmount(x, net, lines.length > 0)
    const applies = chargeApplies(x, check.covers)
    if (applies) serviceCharge += would
    return {
      id: x.id, name: x.name, kind: x.kind, value: x.value, optional: !!x.optional, added: !!x.added,
      removed: !!x.removed, waiting: !x.removed && !applies, min_covers: x.min_covers || 0,
      vat_rate: Number(x.vat_rate) || 0, amount: applies ? would : 0, would_be: would,
    }
  })

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
  for (const x of charges) {
    if (!x.amount || !x.vat_rate) continue
    const v = vatByRate.get(x.vat_rate) || { rate: x.vat_rate, gross: 0, vat: 0 }
    v.gross += x.amount; v.vat += vatIncluded(x.amount, x.vat_rate)
    vatByRate.set(x.vat_rate, v)
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
    net, service_charge: serviceCharge, charges, total,
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
  const only = { ...check, promotions: [], charges: [], discounts: (check.discounts || []).filter(d => d.scope === 'line') }
  const byId = Object.fromEntries(checkTotals(only).lines.map(l => [l.id, l]))
  return (check.lines || []).filter(isActiveLine).map(l => ({
    line_id: l.id, item_id: l.item_id, section_id: l.section_id ?? null, qty: Number(l.qty) || 1,
    line_total_pence: byId[l.id]?.net ?? lineGross(l),
  }))
}
