// shared/orderPricing.js
//
// Web ordering prices. ONE implementation used in two places:
//
//   - api/src/services/orderSvc.js — the only prices that count. The server
//     re-prices every basket; the guest's browser never sets a price.
//   - the guest ordering page (served to the browser as
//     /order-api/pricing.js) — shows the same totals while the guest builds
//     the basket, so the checkout total never jumps.
//
// Plain ESM, no dependencies, no DOM. Promotions (discounts) come from
// ./promotions.js, served next to this file as /order-api/promotions.js.
//
import { applyPromotions } from './promotions.js'

// A dish's choices come from its ad-hoc variants (one required choice) and
// its attached variant groups:
//   mode 'base'  — the option price IS the dish price (Chicken £12.50)
//   mode 'extra' — the option price is added on top (Extra egg +£1.00)
// Unit price = the chosen base options' prices (or the dish's own price
// when no base option is chosen) + every chosen extra.

// Ad-hoc variants are re-inserted on every menu save, so their database ids
// change; the label is what stays the same.
export function variantOptionId(label) {
  return 'v:' + String(label)
}

// The menu's own variant display settings (Menus > menu details), the same
// ones the website menu block and the printed menu follow:
//   hide_unpriced_variants    — an option with no price (or £0) is left out
//                               entirely, so it can't be chosen either
//   hide_zero_priced_variants — an option priced £0 keeps its label but
//                               shows no price
export function variantRules(menu) {
  return {
    hideUnpriced: !!(menu && menu.hide_unpriced_variants),
    hideZeroPrice: !!(menu && menu.hide_zero_priced_variants),
  }
}

const isUnpriced = p => p == null || Number(p) === 0

export function itemChoices(item, rules = {}) {
  const keep = o => !(rules.hideUnpriced && isUnpriced(o.price_pence))
  const out = []
  const adhoc = (Array.isArray(item.variants) ? item.variants : []).filter(keep)
  if (adhoc.length) {
    out.push({
      key: 'variants', name: 'Choose', mode: 'base', min: 1, max: 1, hide_zero_price: !!rules.hideZeroPrice,
      options: adhoc.map(v => ({ id: variantOptionId(v.label), label: v.label, price_pence: v.price_pence ?? null })),
    })
  }
  for (const g of item.variant_groups || []) {
    const opts = (g.options || []).filter(keep).map(o => ({ id: o.option_id ?? o.id, label: o.label, price_pence: o.price_pence ?? null }))
    if (!opts.length) continue
    const max = Math.max(1, Math.min(opts.length, Number(g.max_select ?? 1)))
    const min = Math.max(0, Math.min(max, Number(g.min_select ?? 1)))
    out.push({
      key: g.group_id ?? g.id, name: g.name, mode: g.price_mode === 'extra' ? 'extra' : 'base',
      min, max, hide_zero_price: !!rules.hideZeroPrice, options: opts,
    })
  }
  return out
}

// Price text for one option on the guest page ('' = show no price).
export function optionPriceText(choice, option, money) {
  const p = option.price_pence
  if (p == null) return ''
  if (Number(p) === 0 && (choice.mode === 'extra' || choice.hide_zero_price)) return ''
  return choice.mode === 'extra' ? '+' + money(p) : money(p)
}

// A dish from the ordering API already carries its choices (the browser
// never sees the raw variants); a dish straight from the menu does not.
function choicesOf(item) {
  return Array.isArray(item.choices) ? item.choices : itemChoices(item)
}

// Lowest price a guest can pay for the dish ("from £9.50"), or null when
// it has no price at all (then it can't be ordered).
export function fromPrice(item, choices = choicesOf(item)) {
  const base = choices.filter(c => c.mode === 'base')
  let price = null
  for (const c of base) {
    if (c.min < 1) continue
    // A base option with no price leaves the dish at its own price.
    const cheapest = c.options.map(o => o.price_pence ?? item.price_pence ?? null)
      .filter(p => p != null).sort((a, b) => a - b).slice(0, c.min)
    if (cheapest.length < c.min) continue
    price = (price ?? 0) + cheapest.reduce((s, p) => s + p, 0)
  }
  if (price == null) price = item.price_pence ?? null
  if (price == null) return null
  for (const c of choices.filter(c => c.mode === 'extra' && c.min > 0)) {
    const cheapest = c.options.map(o => o.price_pence ?? 0).sort((a, b) => a - b).slice(0, c.min)
    price += cheapest.reduce((s, p) => s + p, 0)
  }
  return price
}

export function isPriced(item, choices = choicesOf(item)) {
  if (item.price_pence != null) return true
  return choices.some(c => c.mode === 'base' && c.min >= 1 && c.options.some(o => o.price_pence != null))
}

// One basket line: { choices: { [key]: [optionId, ...] } }.
// Returns { ok: true, unit_pence, options } or { ok: false, error }.
export function priceLine(item, selection, choices = choicesOf(item)) {
  const picked = (selection && selection.choices) || {}
  const options = []
  let base = null
  let extras = 0
  for (const c of choices) {
    const ids = [...new Set(Array.isArray(picked[c.key]) ? picked[c.key] : [])]
    if (ids.length < c.min) {
      const what = c.key === 'variants' ? 'an option' : c.name.toLowerCase()
      return { ok: false, error: c.min === 1 ? 'Choose ' + what : 'Choose at least ' + c.min + ' for ' + c.name }
    }
    if (ids.length > c.max) return { ok: false, error: 'Choose up to ' + c.max + ' for ' + c.name }
    for (const id of ids) {
      const o = c.options.find(x => x.id === id)
      if (!o) return { ok: false, error: 'An option is no longer available: please choose again' }
      options.push({ group: c.name, label: o.label, price_pence: o.price_pence, mode: c.mode })
      // A base option with no price leaves the dish at its own price.
      if (c.mode === 'base') { if (o.price_pence != null) base = (base ?? 0) + o.price_pence }
      else extras += o.price_pence ?? 0
    }
  }
  if (base == null) base = item.price_pence ?? null
  if (base == null) return { ok: false, error: 'This dish has no price' }
  return { ok: true, unit_pence: base + extras, options }
}

// VAT inside a VAT-inclusive amount.
export function vatIncluded(amountPence, ratePercent) {
  const r = Number(ratePercent) || 0
  if (r <= 0) return 0
  return Math.round(amountPence * r / (100 + r))
}

export function tipFor(subtotalPence, percent) {
  const p = Number(percent) || 0
  return p > 0 ? Math.round(subtotalPence * p / 100) : 0
}

// A whole basket. itemsById: { [menuItemId]: item (with vat_rate) },
// lines: [{ item_id, qty, choices, note }].
// With `promos` (+ `promoCtx`, see shared/promotions.js) the discounts are
// taken off: subtotal stays the full price, discount_pence is what the
// promotions take off, VAT is on what is paid per line, the tip is a % of
// the discounted subtotal, total = subtotal - discount + tip.
export function priceBasket(itemsById, lines, { tipPercent = 0, promos = null, promoCtx = {} } = {}) {
  const out = []
  const errors = []
  let subtotal = 0
  let vat = 0
  for (const [i, line] of (lines || []).entries()) {
    const item = itemsById[line.item_id]
    if (!item) { errors.push({ index: i, error: 'This dish is no longer on the menu' }); continue }
    if (item.sold_out) { errors.push({ index: i, error: item.name + ' is sold out' }); continue }
    const qty = Math.max(1, Math.min(99, Math.floor(Number(line.qty) || 1)))
    const priced = priceLine(item, line)
    if (!priced.ok) { errors.push({ index: i, error: item.name + ': ' + priced.error }); continue }
    const lineTotal = priced.unit_pence * qty
    const rate = Number(item.vat_rate) || 0
    const lineVat = vatIncluded(lineTotal, rate)
    subtotal += lineTotal
    vat += lineVat
    out.push({
      item_id: item.id, section_id: item.section_id ?? null, name: item.name, qty, options: priced.options,
      unit_pence: priced.unit_pence, line_total_pence: lineTotal,
      vat_rate: rate, vat_pence: lineVat, note: line.note ? String(line.note).slice(0, 300) : null,
    })
  }
  let discount = 0
  let promo = null
  if (promos && promos.length && out.length) {
    promo = applyPromotions(out, promos, promoCtx)
    vat = 0
    out.forEach((l, i) => {
      l.discount_pence = promo.line_discounts[i] || 0
      l.vat_pence = vatIncluded(l.line_total_pence - l.discount_pence, l.vat_rate)
      vat += l.vat_pence
    })
    discount = promo.discount_pence
  } else {
    out.forEach(l => { l.discount_pence = 0 })
  }
  const net = subtotal - discount
  const tip = tipFor(net, tipPercent)
  return {
    lines: out, errors, subtotal_pence: subtotal, discount_pence: discount, vat_pence: vat, tip_pence: tip, total_pence: net + tip,
    promotions: promo ? promo.applied : [], promo_offers: promo ? promo.offers : [], promo_notices: promo ? promo.notices : [],
  }
}

export function formatPence(pence, currency = 'GBP') {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : ''
  const n = (Number(pence) || 0) / 100
  return (n < 0 ? '-' : '') + symbol + Math.abs(n).toFixed(2)
}
