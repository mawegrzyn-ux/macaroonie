// shared/gloriafood.js
//
// GloriaFood online orders (migration 159), shared by the API (stores the
// orders GloriaFood sends, turns them into day figures and fills Cash
// Recon) and the admin (mapping editor, preview, board labels).
//
// A Cash Recon field (income source, payment channel, SC source) maps to a
// list of terms, as with Loyverse; its value is the sum of the terms. A term
// is { sign: 1 | -1, kind, ref?, label? } where kind is one of TOTAL_KINDS
// (no ref) or REF_KINDS (ref = a GloriaFood payment method such as 'ONLINE',
// or an order type such as 'delivery').
//
// Only accepted orders count, and never GloriaFood's test orders (source
// 'admin', placed from the menu editor preview). All money is in pence.

export const TOTAL_KINDS = {
  total:         { label: 'Order totals',           hint: 'What customers paid: food after discounts, tax, tips, delivery and service fees (GloriaFood\'s total).' },
  net_total:     { label: 'Totals excluding tax',   hint: 'Order totals less the tax on them.' },
  subtotal:      { label: 'Food subtotal',          hint: 'Items after discounts, without tips, delivery or service fees (GloriaFood\'s sub-total).' },
  items:         { label: 'Items before discounts', hint: 'Every dish ordered at its full price with its options.' },
  discounts:     { label: 'Discounts',              hint: 'Promotions and coupons taken off dishes and baskets.' },
  delivery_fees: { label: 'Delivery fees',          hint: 'Delivery charges on delivery orders.' },
  tips:          { label: 'Tips',                   hint: 'Tips added by customers.' },
  service_fees:  { label: 'Service fees',           hint: 'Service fees on the basket or the order total, less cash discounts.' },
  tax:           { label: 'Tax',                    hint: 'All tax on the orders, as GloriaFood works it out.' },
}

export const REF_KINDS = {
  payment:    { label: 'Payment',    hint: 'Order totals paid this way. An order paid two ways counts under its main payment method.' },
  order_type: { label: 'Order type', hint: 'Order totals of one type of order.' },
}

export const PAYMENT_LABELS = {
  ONLINE:     'Paid online',
  CASH:       'Cash',
  CARD:       'Card at the counter',
  CARD_PHONE: 'Card by phone',
}

export const TYPE_LABELS = {
  pickup:            'Pickup',
  delivery:          'Delivery',
  dine_in:           'Dine in',
  order_ahead:       'Order ahead',
  table_reservation: 'Table reservation',
}

export const MAPPING_GROUPS = ['income', 'takings', 'sc']

export const paymentLabel = p => PAYMENT_LABELS[p] || p || 'Unknown'
export const typeLabel    = t => TYPE_LABELS[t] || t || 'Order'

export function isValidTerm(t) {
  if (!t || (t.sign !== 1 && t.sign !== -1)) return false
  if (TOTAL_KINDS[t.kind]) return true
  return !!REF_KINDS[t.kind] && typeof t.ref === 'string' && t.ref.length > 0 && t.ref.length <= 100
}

/** "Order totals", "Payment: Paid online", "Order type: Delivery". */
export function termLabel(t) {
  if (TOTAL_KINDS[t.kind]) return TOTAL_KINDS[t.kind].label
  const kind = REF_KINDS[t.kind]?.label || t.kind
  const name = t.kind === 'payment' ? paymentLabel(t.ref)
    : t.kind === 'order_type' ? typeLabel(t.ref)
      : (t.label || t.ref)
  return kind + ': ' + name
}

/** A term's value in a day's figures (pence). */
export function termValue(day, t) {
  if (!day) return 0
  if (TOTAL_KINDS[t.kind]) return day[t.kind] || 0
  if (t.kind === 'payment')    return day.payments?.[t.ref]?.amount || 0
  if (t.kind === 'order_type') return day.types?.[t.ref]?.amount || 0
  return 0
}

/** A field's value: the signed sum of its terms (pence). */
export function sumTerms(day, terms) {
  return (terms || []).reduce((sum, t) => sum + t.sign * termValue(day, t), 0)
}

const pence = v => {
  const n = Math.round(Number(v || 0) * 100)
  return Number.isFinite(n) ? n : 0
}
const text = (v, max = 500) => (v == null || v === '' ? null : String(v).slice(0, max))
const when = v => {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

const PROMO_TYPES = new Set(['promo_cart', 'promo_item', 'promo_cart_item'])
const FEE_TYPES = new Set(['service_fee_subtotal', 'service_fee_total', 'cash_discount'])

// Guest details GloriaFood sends that we never keep in the stored payload
// (name, phone and address are kept in their own columns for the board and
// cleared after 30 days).
const PERSONAL = [
  'client_first_name', 'client_last_name', 'client_email', 'client_phone', 'client_address',
  'client_address_parts', 'client_ip_address', 'billing_details', 'latitude', 'longitude',
]

/**
 * A GloriaFood order (Accepted Orders API v2) as the row we store: money in
 * pence, figures worked out from its items, the dishes for the board, the
 * payload without guest details. Returns null when it isn't an order.
 */
export function orderFromPayload(o) {
  if (!o || typeof o !== 'object') return null
  const id = Number(o.id)
  if (!Number.isSafeInteger(id) || id <= 0) return null

  let items = 0, discounts = 0, delivery = 0, tips = 0, fees = 0
  const dishes = []
  for (const it of Array.isArray(o.items) ? o.items : []) {
    const type = it?.type
    const total = pence(it?.total_item_price)
    if (type === 'item') {
      items += total
      dishes.push({
        name: text(it.name, 200) || 'Item',
        qty: Math.max(1, Number(it.quantity) || 1),
        total_pence: total,
        options: (Array.isArray(it.options) ? it.options : []).map(op => ({
          name: text(op?.name, 200) || '',
          group: text(op?.group_name, 200),
          qty: Math.max(1, Number(op?.quantity) || 1),
        })),
        note: text(it.instructions, 500),
        promo: it.parent_id != null,
      })
    } else if (PROMO_TYPES.has(type)) {
      discounts += Math.abs(pence(it.item_discount))
    } else if (type === 'delivery_fee') {
      delivery += total
    } else if (type === 'tip') {
      tips += total
    } else if (FEE_TYPES.has(type)) {
      fees += total
    }
  }

  const payload = { ...o }
  for (const k of PERSONAL) delete payload[k]
  const name = [o.client_first_name, o.client_last_name].filter(Boolean).join(' ').trim()

  return {
    gf_order_id: id,
    gf_restaurant_id: Number.isSafeInteger(Number(o.restaurant_id)) && o.restaurant_id != null ? Number(o.restaurant_id) : null,
    restaurant_name: text(o.restaurant_name, 200),
    status: text(o.status, 40) || 'accepted',
    order_type: text(o.type, 40),
    source: text(o.source, 40),
    payment: text(o.payment, 60),
    used_payment_methods: (Array.isArray(o.used_payment_methods) ? o.used_payment_methods : [])
      .map(p => text(p, 60)).filter(Boolean).slice(0, 5),
    card_type: text(o.card_type, 60),
    gateway_type: text(o.gateway_type, 60),
    currency: text(o.currency, 3),
    total_pence: pence(o.total_price),
    subtotal_pence: pence(o.sub_total_price),
    items_pence: items,
    discount_pence: discounts,
    delivery_fee_pence: delivery,
    tip_pence: tips,
    service_fee_pence: fees,
    tax_pence: pence(o.tax_value),
    accepted_at: when(o.accepted_at),
    fulfill_at: when(o.fulfill_at) || when(o.accepted_at),
    gf_updated_at: when(o.updated_at),
    for_later: o.for_later === true,
    client_name: text(name, 200),
    client_phone: text(o.client_phone, 60),
    client_address: text(o.client_address, 500),
    instructions: text(o.instructions, 1000),
    table_number: text(o.table_number, 40),
    persons: Number.isSafeInteger(Number(o.persons)) ? Number(o.persons) : null,
    items: dishes,
    payload,
  }
}

/** Does a stored order count in Cash Recon? Accepted, and not a GloriaFood test order. */
export const countsInRecon = r => r.status === 'accepted' && r.source !== 'admin'

/**
 * One trading day's figures from its stored orders (rows with the pence
 * columns of gloriafood_orders).
 */
export function summariseOrders(rows) {
  const day = {
    orders: 0, test_orders: 0, cancelled: 0, split_payments: 0,
    total: 0, net_total: 0, subtotal: 0, items: 0, discounts: 0,
    delivery_fees: 0, tips: 0, service_fees: 0, tax: 0,
    payments: {}, types: {},
  }
  for (const r of rows || []) {
    if (r.status === 'canceled' || r.status === 'cancelled') { day.cancelled++; continue }
    if (r.status !== 'accepted') continue
    if (r.source === 'admin') { day.test_orders++; continue }
    day.orders++
    day.total         += r.total_pence || 0
    day.subtotal      += r.subtotal_pence || 0
    day.items         += r.items_pence || 0
    day.discounts     += r.discount_pence || 0
    day.delivery_fees += r.delivery_fee_pence || 0
    day.tips          += r.tip_pence || 0
    day.service_fees  += r.service_fee_pence || 0
    day.tax           += r.tax_pence || 0
    if ((r.used_payment_methods || []).length > 1) day.split_payments++
    const pay = r.payment || 'UNKNOWN'
    const p = day.payments[pay] || (day.payments[pay] = { amount: 0, count: 0 })
    p.amount += r.total_pence || 0
    p.count++
    const type = r.order_type || 'other'
    const t = day.types[type] || (day.types[type] = { amount: 0, count: 0 })
    t.amount += r.total_pence || 0
    t.count++
  }
  day.net_total = day.total - day.tax
  return day
}

// ── Importing GloriaFood's order export ──────────────────────
//
// GloriaFood's API only hands over orders as they are accepted, so days
// before the link can be filled from the order list GloriaFood's admin
// exports (CSV, or the same saved as Excel). Columns are found by their
// heading (case, spacing and the "(YYYY-MM-DD)" notes don't matter); columns
// can be in any order, and any not listed here are ignored (guest names,
// emails, phones and addresses are never read). Dates are the restaurant's
// local time; the API turns them into instants with the venue's time zone.

export const IMPORT_COLUMNS = [
  { key: 'order_id',       header: 'Order ID',                      need: 'required', names: ['order id', 'order', 'id', 'order number'],
    hint: 'GloriaFood\'s order number. Orders already imported are updated, never doubled.' },
  { key: 'outcome',        header: 'Outcome',                       need: 'required', names: ['outcome', 'status'],
    hint: 'accepted, canceled, rejected... Only accepted orders count.' },
  { key: 'total',          header: 'Total',                         need: 'required', names: ['total', 'total price', 'order total'],
    hint: 'What the customer paid.' },
  { key: 'fulfill_date',   header: 'Fulfillment date (YYYY-MM-DD)', need: 'date', names: ['fulfillment date', 'fulfilment date', 'fulfill date'],
    hint: 'The day the order was collected or delivered.' },
  { key: 'fulfill_time',   header: 'Fulfillment time',              need: 'date', names: ['fulfillment time', 'fulfilment time', 'fulfill time'] },
  { key: 'confirmed_date', header: 'Confirmed date (YYYY-MM-DD)',   need: 'date', names: ['confirmed date', 'accepted date'],
    hint: 'The day the order was accepted.' },
  { key: 'confirmed_time', header: 'Confirmed time',                need: 'date', names: ['confirmed time', 'accepted time'] },
  { key: 'placed_date',    header: 'Placed date (YYYY-MM-DD)',      need: 'optional', names: ['placed date'],
    hint: 'Used only when an order has neither of the dates above.' },
  { key: 'placed_time',    header: 'Placed time (hh:mm)',           need: 'optional', names: ['placed time'] },
  { key: 'payment',        header: 'Payment method',                need: 'recommended', names: ['payment method', 'payment'],
    hint: 'Needed to fill Cash Recon fields mapped to a payment method.' },
  { key: 'type',           header: 'Type',                          need: 'recommended', names: ['type', 'order type'],
    hint: 'pickup, delivery... Needed for fields mapped to an order type.' },
  { key: 'channel',        header: 'Channel',                       need: 'optional', names: ['channel', 'source'],
    hint: 'Where the order was placed. Channel "admin" is a GloriaFood test order and never counts.' },
  { key: 'subtotal',       header: 'Subtotal',                      need: 'optional', names: ['subtotal', 'sub total'] },
  { key: 'tax',            header: 'Total taxes',                   need: 'optional', names: ['total taxes', 'taxes', 'tax'] },
  { key: 'tip',            header: 'Tip amount - gross',            need: 'optional', names: ['tip amount gross', 'tip amount', 'tip', 'tips'] },
  { key: 'delivery_fee',   header: 'Delivery fee',                  need: 'optional', names: ['delivery fee', 'delivery fees'] },
  { key: 'sf_subtotal',    header: 'Service fees on subtotal',      need: 'optional', names: ['service fees on subtotal'] },
  { key: 'sf_total',       header: 'Service fees on total',         need: 'optional', names: ['service fees on total'] },
  { key: 'cash_discounts', header: 'Cash discounts',                need: 'optional', names: ['cash discounts', 'cash discount'] },
  { key: 'currency',       header: 'Currency',                      need: 'optional', names: ['currency'] },
  { key: 'card_type',      header: 'Card type',                     need: 'optional', names: ['card type'] },
  { key: 'extra_payment',  header: 'Additional payment method',     need: 'optional', names: ['additional payment method'] },
]

/** "Fulfillment date (YYYY-MM-DD)" -> "fulfillment date". */
export const importHeading = h => String(h ?? '').replace(/^﻿/, '').toLowerCase()
  .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

/** Where each import column is in a header row: { key: index }, plus what's missing. */
export function matchImportColumns(header) {
  const names = (header || []).map(importHeading)
  const at = {}
  for (const c of IMPORT_COLUMNS) {
    const i = names.findIndex(n => c.names.includes(n))
    if (i >= 0) at[c.key] = i
  }
  const missing = IMPORT_COLUMNS.filter(c => c.need === 'required' && at[c.key] == null).map(c => c.header)
  const hasFulfil = at.fulfill_date != null && at.fulfill_time != null
  const hasConfirmed = at.confirmed_date != null && at.confirmed_time != null
  if (!hasFulfil && !hasConfirmed) missing.push('Fulfillment date + Fulfillment time (or Confirmed date + Confirmed time)')
  const absent = IMPORT_COLUMNS.filter(c => c.need !== 'required' && c.need !== 'date' && at[c.key] == null).map(c => c.key)
  return { at, missing, absent }
}

/** Figures (TOTAL_KINDS / REF_KINDS keys) an import can't supply, given the columns it has. */
export function importMissingFigures(at) {
  const out = ['items', 'discounts']
  if (at.subtotal == null) out.push('subtotal')
  if (at.tax == null) out.push('tax', 'net_total')
  if (at.tip == null) out.push('tips')
  if (at.delivery_fee == null) out.push('delivery_fees')
  if (at.sf_subtotal == null && at.sf_total == null && at.cash_discounts == null) out.push('service_fees')
  if (at.payment == null) out.push('payment')
  if (at.type == null) out.push('order_type')
  return out
}

/** "£1,234.50", "(2.00)", "-3" -> pence; '' -> 0; null when it isn't a number. */
export function importPence(v) {
  let s = String(v ?? '').trim()
  if (s === '') return 0
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[£$€\s,]/g, '')
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const p = Math.round(Number(s) * 100)
  return neg ? -p : p
}

/** "2026-10-13", "13/10/2026", "2026-10-13 00:00:00" -> "2026-10-13"; null otherwise. */
export function importDate(v) {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/)
  let y, mo, d
  if (m) [, y, mo, d] = m
  else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/)   // UK day first
    if (!m) return null
    ;[, d, mo, y] = m
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const t = new Date(iso + 'T00:00:00Z')
  return isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso
}

/** "19:16", "7:16", "19:16:00", "7:16 PM" -> "19:16"; null otherwise. */
export function importTime(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[3]?.toLowerCase().replace(/\./g, '')
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0')
}

const cellText = (row, i, max = 120) => (i == null ? null : (String(row[i] ?? '').trim().slice(0, max) || null))

/**
 * One export row as an order to store (money in pence, local date/times as
 * { date, time } for the API to place in the venue's time zone), or
 * { problem } when it can't be used. `at` comes from matchImportColumns().
 */
export function importOrderFromRow(row, at) {
  const idText = cellText(row, at.order_id, 40) || ''
  if (/e\+?\d+$/i.test(idText)) return { problem: `Order ID "${idText}" was shortened by Excel; export the file again, or format the column as a number before saving` }
  if (!/^\d{1,15}$/.test(idText)) return { problem: idText ? `"${idText}" isn't a GloriaFood order number` : 'No order number' }
  const total = importPence(row[at.total])
  if (total == null) return { problem: `Total "${cellText(row, at.total)}" isn't an amount` }

  const money = {}
  for (const k of ['subtotal', 'tax', 'tip', 'delivery_fee', 'sf_subtotal', 'sf_total', 'cash_discounts']) {
    if (at[k] == null) { money[k] = 0; continue }
    const p = importPence(row[at[k]])
    if (p == null) return { problem: `${IMPORT_COLUMNS.find(c => c.key === k).header} "${cellText(row, at[k])}" isn't an amount` }
    money[k] = p
  }

  const local = (dk, tk) => {
    if (at[dk] == null || at[tk] == null) return null
    const date = importDate(row[at[dk]])
    const time = importTime(row[at[tk]])
    return date && time ? { date, time } : null
  }
  const fulfil = local('fulfill_date', 'fulfill_time')
  const confirmed = local('confirmed_date', 'confirmed_time')
  const placed = local('placed_date', 'placed_time')
  if (!fulfil && !confirmed && !placed) return { problem: 'No date and time it was collected, delivered or accepted' }

  const status = (cellText(row, at.outcome, 40) || '').toLowerCase().replace(/\s+/g, '_')
  if (!status) return { problem: 'No outcome (accepted, canceled...)' }
  const payment = cellText(row, at.payment, 60)
  const extra = cellText(row, at.extra_payment, 60)

  return {
    order: {
      gf_order_id: Number(idText),
      status,
      order_type: (cellText(row, at.type, 40) || '').toLowerCase() || null,
      source: (cellText(row, at.channel, 40) || '').toLowerCase() || null,
      payment,
      used_payment_methods: [payment, extra].filter(Boolean),
      card_type: cellText(row, at.card_type, 60),
      currency: (cellText(row, at.currency, 3) || '').toUpperCase() || null,
      total_pence: total,
      subtotal_pence: money.subtotal,
      items_pence: 0,
      discount_pence: 0,
      delivery_fee_pence: money.delivery_fee,
      tip_pence: money.tip,
      service_fee_pence: money.sf_subtotal + money.sf_total - Math.abs(money.cash_discounts),
      tax_pence: money.tax,
      fulfill_local: fulfil || confirmed || placed,
      accepted_local: confirmed || null,
    },
  }
}
