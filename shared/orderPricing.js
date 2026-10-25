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
import { isCombo, priceCombo, comboFromPrice, findAutoCombos, autoMatchable, menuCtx, dealChoices, withDealPicks } from './combos.js'

// A dish's choices come from its ad-hoc variants (one required choice) and
// its attached variant groups:
//   mode 'base'  — the option price IS the dish price (Chicken £12.50)
//   mode 'extra' — the option price is added on top (Extra egg +£1.00)
// Unit price = the chosen base options' prices (or the dish's own price
// when no base option is chosen) + every chosen extra.
// A group may let the same option be picked more than once (repeat,
// migration 171: 2 x Extra cheese), and an optional group may wait behind a
// button instead of showing straight away (on_request).
//
// Combos (kind 'combo', shared/combos.js) are priced here too: the combo's
// price (or its own base options), its own extras, then each step's picks:
// the choice's extra charge plus that dish's own extras, its options as the
// deal asks them (partOptions(); a part's base options don't change the
// deal's price).

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

// The price a base option ("Option price is the dish price") sets, or null
// when it sets none: an option left empty or at £0 keeps the dish's own
// price (a flavour group with every flavour at £0 must not make the dish
// free). Every price that reads a base option goes through this.
export function basePrice(o) {
  const p = o?.price_pence
  return p == null || Number(p) === 0 ? null : Number(p)
}

export function itemChoices(item, rules = {}) {
  const keep = o => !(rules.hideUnpriced && isUnpriced(o.price_pence))
  const out = []
  const adhoc = (Array.isArray(item.variants) ? item.variants : []).filter(keep)
  if (adhoc.length) {
    out.push({
      key: 'variants', name: 'Choose', mode: 'base', min: 1, max: 1, repeat: false, on_request: false, hide_zero_price: !!rules.hideZeroPrice,
      options: adhoc.map(v => ({ id: variantOptionId(v.label), label: v.label, price_pence: v.price_pence ?? null })),
    })
  }
  for (const g of item.variant_groups || []) {
    const opts = (g.options || []).filter(keep).map(o => ({ id: o.option_id ?? o.id, label: o.label, price_pence: o.price_pence ?? null }))
    if (!opts.length) continue
    // With repeat an option can count more than once, so max isn't capped at the number of options.
    const max = Math.max(1, g.allow_repeat ? Number(g.max_select ?? 1) : Math.min(opts.length, Number(g.max_select ?? 1)))
    const min = Math.max(0, Math.min(max, Number(g.min_select ?? 1)))
    out.push({
      key: g.group_id ?? g.id, name: g.name, mode: g.price_mode === 'extra' ? 'extra' : 'base',
      min, max, repeat: !!g.allow_repeat, on_request: min === 0 && !!g.on_request,
      hide_zero_price: !!rules.hideZeroPrice, options: opts,
    })
  }
  return out
}

// Price text for one option on the guest page ('' = show no price).
export function optionPriceText(choice, option, money) {
  const p = option.price_pence
  if (p == null) return ''
  // A base option at £0 is the dish's own price: no price beside it.
  if (Number(p) === 0 && (choice.mode === 'extra' || choice.mode === 'base' || choice.hide_zero_price)) return ''
  return choice.mode === 'extra' ? '+' + money(p) : money(p)
}

// A dish from the ordering API already carries its choices (the browser
// never sees the raw variants); a dish straight from the menu does not.
function choicesOf(item) {
  return Array.isArray(item.choices) ? item.choices : itemChoices(item)
}

// A meal deal's part as the deal asks it (shared/combos.js dealChoices()):
// the dish's choices with the combo choice's changes (groups). A group the
// deal asks instead comes with the combo (combo.deal_groups: { groupId:
// choice }, from the server: services/orderSvc.js loadOrderingMenu()).
export function partOptions(combo, part, groups) {
  return dealChoices(choicesOf(part), groups, id => (combo && combo.deal_groups && combo.deal_groups[id]) || null)
}

// Lowest price a guest can pay for the dish ("from £9.50"), or null when
// it has no price at all (then it can't be ordered). A combo adds its
// steps' cheapest picks (ctx: { itemsById, sectionItems } for its dishes).
export function fromPrice(item, choices = choicesOf(item), ctx = null) {
  if (isCombo(item)) return comboFromPrice(item, ownFromPrice({ ...item, price_pence: item.price_pence ?? 0 }, choices), ctx || {}).pence
  return ownFromPrice(item, choices)
}

// Does the price shown need "from"? Base options with a choice of price, or
// a combo whose picks can cost extra.
export function priceVaries(item, choices = choicesOf(item), ctx = null) {
  // Only when the base options' prices differ (options at £0 or empty are
  // the dish's own price, so a flavour group doesn't make "from").
  const own = item.price_pence ?? null
  if (choices.some(c => c.mode === 'base' && new Set(c.options.map(o => basePrice(o) ?? own)).size > 1)) return true
  return isCombo(item) && comboFromPrice(item, 0, ctx || {}).varies
}

// A combo's price as a menu shows it (website, print, screens): its
// cheapest price, and whether "from" goes before it. Its dishes are found
// in the same menu.
export function comboMenuPrice(item, menu) {
  const ctx = menuCtx(menu)
  const choices = itemChoices(item, variantRules(menu))
  return { pence: fromPrice(item, choices, ctx), from: priceVaries(item, choices, ctx) }
}

function ownFromPrice(item, choices) {
  const base = choices.filter(c => c.mode === 'base')
  let price = null
  for (const c of base) {
    if (c.min < 1) continue
    // A base option with no price leaves the dish at its own price.
    const sorted = c.options.map(o => basePrice(o) ?? item.price_pence ?? null)
      .filter(p => p != null).sort((a, b) => a - b)
    const cheapest = c.repeat && sorted.length ? Array(c.min).fill(sorted[0]) : sorted.slice(0, c.min)
    if (cheapest.length < c.min) continue
    price = (price ?? 0) + cheapest.reduce((s, p) => s + p, 0)
  }
  if (price == null) price = item.price_pence ?? null
  if (price == null) return null
  for (const c of choices.filter(c => c.mode === 'extra' && c.min > 0)) {
    const sorted = c.options.map(o => o.price_pence ?? 0).sort((a, b) => a - b)
    const cheapest = c.repeat && sorted.length ? Array(c.min).fill(sorted[0]) : sorted.slice(0, c.min)
    price += cheapest.reduce((s, p) => s + p, 0)
  }
  return price
}

export function isPriced(item, choices = choicesOf(item)) {
  if (item.price_pence != null || isCombo(item)) return true
  return choices.some(c => c.mode === 'base' && c.min >= 1 && c.options.some(o => basePrice(o) != null))
}

// A set of choices: { ok, base, extras, options } or { ok: false, error }.
// picked: { [key]: [optionId, ...] }; an id may repeat in a repeat group.
function priceChoiceSet(choices, picked) {
  const options = []
  let base = null
  let extras = 0
  for (const c of choices) {
    const raw = Array.isArray(picked[c.key]) ? picked[c.key] : []
    const ids = c.repeat ? raw : [...new Set(raw)]
    if (ids.length < c.min) {
      const what = c.key === 'variants' ? 'an option' : c.name.toLowerCase()
      return { ok: false, error: c.min === 1 ? 'Choose ' + what : 'Choose at least ' + c.min + ' for ' + c.name }
    }
    if (ids.length > c.max) return { ok: false, error: 'Choose up to ' + c.max + ' for ' + c.name }
    // The same option picked more than once shows once: "2 x Cheese" at twice the price.
    const counts = new Map()
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1)
    for (const [id, n] of counts) {
      const o = c.options.find(x => x.id === id)
      if (!o) return { ok: false, error: 'An option is no longer available: please choose again' }
      options.push({
        group: c.name, label: (n > 1 ? n + ' x ' : '') + o.label,
        price_pence: o.price_pence == null ? o.price_pence : o.price_pence * n, mode: c.mode, ...(n > 1 ? { qty: n } : {}),
      })
      // A base option with no price (or £0) leaves the dish at its own price.
      if (c.mode === 'base') { if (basePrice(o) != null) base = (base ?? 0) + basePrice(o) * n }
      else extras += (o.price_pence ?? 0) * n
    }
  }
  return { ok: true, base, extras, options }
}

// One basket line: { choices: { [key]: [optionId, ...] }, combo }.
// Returns { ok: true, unit_pence, base_pence, options, parts } or { ok: false, error }.
// ctx (combos): { itemsById, sectionItems } to find a combo's dishes.
export function priceLine(item, selection, choices = choicesOf(item), ctx = null) {
  const r = priceChoiceSet(choices, (selection && selection.choices) || {})
  if (!r.ok) return r
  let base = r.base ?? item.price_pence ?? null
  if (isCombo(item)) {
    const pc = priceCombo(item, selection || {}, ctx || {}, (part, picked, groups) => {
      // What the deal picks itself (one option left) is on the line too.
      const options = partOptions(item, part, groups)
      const pr = priceChoiceSet(options, withDealPicks(options, picked || {}))
      return pr.ok ? { ok: true, extras: pr.extras, detail: pr.options } : pr
    })
    if (!pc.ok) return pc
    base = base ?? 0
    const parts = pc.parts.map(p => ({
      step: p.step, step_id: p.step_id, option_id: p.option_id, item_id: p.item_id, section_id: p.section_id,
      name: p.name, kitchen_name: p.kitchen_name, upcharge_pence: p.upcharge, extras_pence: p.extras,
      options: (p.detail || []).filter(o => o.mode !== 'base' || o.label),
    }))
    return { ok: true, unit_pence: base + r.extras + pc.upcharge + pc.extras, base_pence: base, options: r.options, parts }
  }
  if (base == null) return { ok: false, error: 'This dish has no price' }
  return { ok: true, unit_pence: base + r.extras, base_pence: base, options: r.options, parts: null }
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
// lines: [{ item_id, qty, choices, combo, note }].
// combos: { ctx: { itemsById, sectionItems } to find combos' dishes (every
// dish of the menus, orderable alone or not), auto: [combo items] to spot
// among separate dishes (shared/combos.js findAutoCombos) }.
// Automatic combos come off first, then promotions (`promos` + `promoCtx`,
// see shared/promotions.js) on what is left: subtotal stays the full price,
// discount_pence is what combos and promotions take off, VAT is on what is
// paid per line, the tip is a % of the discounted subtotal,
// total = subtotal - discount + tip.
export function priceBasket(itemsById, lines, { tipPercent = 0, promos = null, promoCtx = {}, combos = null } = {}) {
  const out = []
  const outPicks = []   // each priced line's picks ({ groupKey: [optionId] }), for automatic combos
  const errors = []
  let subtotal = 0
  let vat = 0
  const comboCtx = (combos && combos.ctx) || { itemsById }
  for (const [i, line] of (lines || []).entries()) {
    const item = itemsById[line.item_id]
    if (!item) { errors.push({ index: i, error: 'This dish is no longer on the menu' }); continue }
    if (item.sold_out) { errors.push({ index: i, error: item.name + ' is sold out' }); continue }
    const qty = Math.max(1, Math.min(99, Math.floor(Number(line.qty) || 1)))
    const priced = priceLine(item, line, choicesOf(item), comboCtx)
    if (!priced.ok) { errors.push({ index: i, error: item.name + ': ' + priced.error }); continue }
    const lineTotal = priced.unit_pence * qty
    const rate = Number(item.vat_rate) || 0
    const lineVat = vatIncluded(lineTotal, rate)
    subtotal += lineTotal
    vat += lineVat
    out.push({
      item_id: item.id, section_id: item.section_id ?? null, name: item.name, qty, options: priced.options,
      parts: priced.parts || null,
      unit_pence: priced.unit_pence, base_pence: priced.base_pence, line_total_pence: lineTotal,
      vat_rate: rate, vat_pence: lineVat, note: line.note ? String(line.note).slice(0, 300) : null,
    })
    outPicks.push(line.choices || {})
  }
  // A dish's minimum order quantity (item.min_qty, migration 133) counts
  // every line of that dish, whatever its options.
  const perDish = new Map()
  out.forEach((l, i) => {
    const d = perDish.get(l.item_id) || { qty: 0, index: i }
    d.qty += l.qty
    perDish.set(l.item_id, d)
  })
  for (const [id, d] of perDish) {
    const min = Number(itemsById[id]?.min_qty) || 0
    if (min > 1 && d.qty < min) errors.push({ index: d.index, code: 'min_qty', error: itemsById[id].name + ': the minimum order is ' + min })
  }
  // Automatic combos among separate dishes (a combo line is already one).
  const comboOff = out.map(() => 0)
  let comboList = []
  const autoCombos = (combos && combos.auto || []).filter(c => autoMatchable(c) && !c.sold_out)
  if (autoCombos.length && out.length) {
    const found = findAutoCombos(
      out.map((l, i) => ({ key: i, item_id: l.item_id, section_id: l.section_id, qty: l.parts ? 0 : l.qty, unit_base: l.base_pence, picks: outPicks[i] })),
      autoCombos, comboCtx, c => fromPrice({ ...c, combo: null, kind: 'dish', price_pence: c.price_pence ?? 0 }, choicesOf(c)) ?? 0,
    )
    for (const f of found) {
      for (const [k, p] of Object.entries(f.lines)) comboOff[Number(k)] += p
    }
    comboList = found.map(f => ({ combo_id: f.combo_id, name: f.name, count: f.count, discount_pence: f.saving }))
  }
  const comboTotal = comboOff.reduce((s, x) => s + x, 0)
  let discount = comboTotal
  let promo = null
  if (promos && promos.length && out.length) {
    promo = applyPromotions(out.map((l, i) => ({ ...l, line_total_pence: l.line_total_pence - comboOff[i] })), promos, promoCtx)
    discount += promo.discount_pence
  }
  if (discount) {
    vat = 0
    out.forEach((l, i) => {
      l.discount_pence = comboOff[i] + (promo ? promo.line_discounts[i] || 0 : 0)
      l.vat_pence = vatIncluded(l.line_total_pence - l.discount_pence, l.vat_rate)
      vat += l.vat_pence
    })
  } else {
    out.forEach(l => { l.discount_pence = 0 })
  }
  const net = subtotal - discount
  const tip = tipFor(net, tipPercent)
  return {
    lines: out, errors, subtotal_pence: subtotal, discount_pence: discount, vat_pence: vat, tip_pence: tip, total_pence: net + tip,
    combos: comboList, combo_discount_pence: comboTotal,
    promotions: promo ? promo.applied : [], promo_offers: promo ? promo.offers : [], promo_notices: promo ? promo.notices : [],
  }
}

export function formatPence(pence, currency = 'GBP') {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : ''
  const n = (Number(pence) || 0) / 100
  return (n < 0 ? '-' : '') + symbol + Math.abs(n).toFixed(2)
}
