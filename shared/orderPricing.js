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
// Plain ESM, no dependencies, no DOM.
//
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

export function itemChoices(item) {
  const out = []
  if (Array.isArray(item.variants) && item.variants.length) {
    out.push({
      key: 'variants', name: 'Choose', mode: 'base', min: 1, max: 1,
      options: item.variants.map(v => ({ id: variantOptionId(v.label), label: v.label, price_pence: v.price_pence })),
    })
  }
  for (const g of item.variant_groups || []) {
    const opts = (g.options || []).map(o => ({ id: o.option_id ?? o.id, label: o.label, price_pence: o.price_pence }))
    if (!opts.length) continue
    const max = Math.max(1, Math.min(opts.length, Number(g.max_select ?? 1)))
    const min = Math.max(0, Math.min(max, Number(g.min_select ?? 1)))
    out.push({ key: g.group_id ?? g.id, name: g.name, mode: g.price_mode === 'extra' ? 'extra' : 'base', min, max, options: opts })
  }
  return out
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
    const cheapest = [...c.options].map(o => o.price_pence).sort((a, b) => a - b).slice(0, c.min)
    price = (price ?? 0) + cheapest.reduce((s, p) => s + p, 0)
  }
  if (price == null) price = item.price_pence ?? null
  if (price == null) return null
  for (const c of choices.filter(c => c.mode === 'extra' && c.min > 0)) {
    const cheapest = [...c.options].map(o => o.price_pence).sort((a, b) => a - b).slice(0, c.min)
    price += cheapest.reduce((s, p) => s + p, 0)
  }
  return price
}

export function isPriced(item, choices = choicesOf(item)) {
  if (item.price_pence != null) return true
  return choices.some(c => c.mode === 'base' && c.min >= 1)
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
      if (c.mode === 'base') base = (base ?? 0) + o.price_pence
      else extras += o.price_pence
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
export function priceBasket(itemsById, lines, { tipPercent = 0 } = {}) {
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
      item_id: item.id, name: item.name, qty, options: priced.options,
      unit_pence: priced.unit_pence, line_total_pence: lineTotal,
      vat_rate: rate, vat_pence: lineVat, note: line.note ? String(line.note).slice(0, 300) : null,
    })
  }
  const tip = tipFor(subtotal, tipPercent)
  return { lines: out, errors, subtotal_pence: subtotal, vat_pence: vat, tip_pence: tip, total_pence: subtotal + tip }
}

export function formatPence(pence, currency = 'GBP') {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : ''
  const n = (Number(pence) || 0) / 100
  return (n < 0 ? '-' : '') + symbol + Math.abs(n).toFixed(2)
}
