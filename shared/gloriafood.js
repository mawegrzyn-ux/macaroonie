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
