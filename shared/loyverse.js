// shared/loyverse.js
//
// Loyverse POS figures for Cash Reconciliation (migration 154), shared by
// the API (routes/loyverse.js sums a day's mapped fields) and the admin
// (mapping editor, preview). A day's figures come from the stored receipts
// (dayFiguresFromStored() in shared/externalSales.js, sales import phase 4).
//
// A Cash Recon field (income source, payment channel, SC source) maps to a
// list of terms; its value is the sum of the terms. A term is
//   { sign: 1 | -1, kind, ref?, label? }
// where kind is one of TOTAL_KINDS (no ref) or REF_KINDS (ref = a Loyverse
// item, category or payment type id; label = its name when picked, shown
// if Loyverse no longer has it).
//
// All money here is in pence (integers) to keep sums exact.

export const TOTAL_KINDS = {
  gross_sales:     { label: 'Gross sales',     hint: 'Every item sold, before discounts and refunds (as in Loyverse\'s sales summary).' },
  net_sales:       { label: 'Net sales',       hint: 'Gross sales less refunds and discounts.' },
  refunds:         { label: 'Refunds',         hint: 'Items refunded that day, at their full price.' },
  discounts:       { label: 'Discounts',       hint: 'Discounts given, less discounts on refunded sales.' },
  taxes:           { label: 'Taxes',           hint: 'Tax on receipts, less tax on refunds.' },
  tips:            { label: 'Tips',            hint: 'Tips added at payment, less tips refunded.' },
  surcharges:      { label: 'Surcharges',      hint: 'Surcharges on receipts, less refunded surcharges.' },
  total_collected: { label: 'Total collected', hint: 'Money taken by every payment type, less money refunded.' },
}

export const REF_KINDS = {
  item:         { label: 'Item',         hint: 'One item\'s sales after discounts, less refunds of it.' },
  category:     { label: 'Category',     hint: 'Sales of every item in a category after discounts, less refunds.' },
  payment_type: { label: 'Payment type', hint: 'Money taken by one payment type, less money refunded to it.' },
}

export const MAPPING_GROUPS = ['income', 'takings', 'sc']

export function isValidTerm(t) {
  if (!t || (t.sign !== 1 && t.sign !== -1)) return false
  if (TOTAL_KINDS[t.kind]) return true
  return !!REF_KINDS[t.kind] && typeof t.ref === 'string' && t.ref.length > 0
}

/** "Gross sales", "Item: Gratuity", "Payment type: Card". */
export function termLabel(t, names = {}) {
  if (TOTAL_KINDS[t.kind]) return TOTAL_KINDS[t.kind].label
  const kind = REF_KINDS[t.kind]?.label || t.kind
  const name = names[t.kind]?.[t.ref] || t.label || 'unknown'
  return kind + ': ' + name
}

/** A term's value in a day's figures (pence). */
export function termValue(day, t) {
  if (!day) return 0
  if (TOTAL_KINDS[t.kind]) return day[t.kind] || 0
  if (t.kind === 'item')         return day.items?.[t.ref]?.amount || 0
  if (t.kind === 'category')     return day.categories?.[t.ref] || 0
  if (t.kind === 'payment_type') return day.payment_types?.[t.ref]?.amount || 0
  return 0
}

/** A field's value: the signed sum of its terms (pence). */
export function sumTerms(day, terms) {
  return (terms || []).reduce((sum, t) => sum + t.sign * termValue(day, t), 0)
}

/** Every term in a mapping that needs the item list (category terms). */
export function needsCategories(mappings) {
  return MAPPING_GROUPS.some(g => Object.values(mappings?.[g] || {}).some(ts => (ts || []).some(t => t.kind === 'category')))
}
