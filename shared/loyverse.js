// shared/loyverse.js
//
// Loyverse POS figures for Cash Reconciliation (migration 154), shared by
// the API (services/loyverseSvc.js turns receipts into day figures and
// writes them) and the admin (mapping editor, preview).
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

const pence = v => Math.round(Number(v || 0) * 100)

/**
 * One trading day's figures from its receipts. Cancelled receipts are left
 * out. Refund receipts count against the day they were refunded on, as
 * Loyverse's own reports do. Amounts on a refund receipt are taken as
 * positive whichever way the API signs them.
 *   itemCategory: { [item_id]: category_id } (only for category terms)
 */
export function summariseReceipts(receipts, itemCategory = null) {
  const day = {
    sales: 0, refund_receipts: 0,
    gross_sales: 0, net_sales: 0, refunds: 0, discounts: 0, taxes: 0,
    tips: 0, surcharges: 0, total_collected: 0,
    items: {}, categories: {}, payment_types: {},
  }
  for (const r of receipts || []) {
    if (r.cancelled_at) continue
    const refund = r.receipt_type === 'REFUND'
    if (refund) day.refund_receipts++
    else day.sales++
    const sign = refund ? -1 : 1
    const amt = v => sign * Math.abs(pence(v))

    day.discounts       += amt(r.total_discount)
    day.taxes           += amt(r.total_tax)
    day.tips            += amt(r.tip)
    day.surcharges      += amt(r.surcharge)
    day.total_collected += amt(r.total_money)

    for (const l of r.line_items || []) {
      const gross = Math.abs(pence(l.gross_total_money))
      if (refund) day.refunds += gross
      else day.gross_sales += gross
      const after = l.total_money != null
        ? Math.abs(pence(l.total_money))
        : Math.max(0, gross - Math.abs(pence(l.total_discount)))
      if (l.item_id) {
        const it = day.items[l.item_id] || (day.items[l.item_id] = { name: l.item_name || '', amount: 0 })
        it.amount += sign * after
        if (itemCategory) {
          const cat = itemCategory[l.item_id]
          if (cat) day.categories[cat] = (day.categories[cat] || 0) + sign * after
        }
      }
    }
    for (const p of r.payments || []) {
      if (!p.payment_type_id) continue
      const pt = day.payment_types[p.payment_type_id] || (day.payment_types[p.payment_type_id] = { name: p.name || '', amount: 0 })
      pt.amount += amt(p.money_amount)
    }
  }
  day.net_sales = day.gross_sales - day.refunds - day.discounts
  return day
}
