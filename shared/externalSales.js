// shared/externalSales.js
//
// Sales from other tills (docs/SALES_IMPORT.md, migrations 288 to 290): the
// rules every connector and reader shares, so each is worked out once.
//
//   toPence(v)          a decimal amount as the other till recorded it
//                       (12.5, "12.50", -3.1) in integer pence, exactly: read
//                       from its digits, never through a float multiply
//   stripPersonal(v)    a copy with customer details taken out (decision D3:
//                       a customer is kept as the other till's id only)
//   stableJson(v)       JSON with keys sorted, for hashing a document
//   SALE_KINDS, DOC_KINDS, LINE_KINDS   the values the tables allow
//   syncLate(conn, now) whether a connection's last good sync is overdue
//   historyProgress(v)  0..1 of a venue's history import
//   allocateNet(net, weights)   a line's net over the parts it maps to
//                       (the item mapping, shared/itemMapping.js)
//   dayFiguresFromStored(checks, itemCategory)   a trading day's Cash Recon
//                       figures from stored checks (phase 4: the Loyverse
//                       fill reads ext_checks, never the till's API)
//   dayCovered(cover, window)   whether a day has been fully synced
//   SALE_SOURCES        who sold it, in the "every till" report subjects

export const DOC_KINDS = ['sale', 'item', 'variant', 'modifier', 'category', 'tax', 'discount',
  'payment_type', 'store', 'employee', 'pos_device', 'dining_option']
export const CATALOG_KINDS = ['item', 'variant', 'modifier', 'modifier_option', 'category', 'tax', 'discount',
  'payment_type', 'store', 'employee', 'pos_device', 'dining_option']
export const SALE_KINDS = ['sale', 'refund']
export const LINE_KINDS = ['item', 'modifier', 'condiment', 'discount', 'charge']

export const SYSTEMS = {
  loyverse: { label: 'Loyverse' },
  square:   { label: 'Square' },
  simphony: { label: 'Oracle Simphony' },
}

// How often the catch-up runs, and how long without a good sync is late.
export const CATCH_UP_MINUTES = 15
export const LATE_AFTER_MINUTES = 3 * CATCH_UP_MINUTES + 5
// How far back a newly linked venue's history goes (decision D4).
export const HISTORY_MONTHS = 13

/**
 * Integer pence from a decimal amount. Reads the digits, so 1.005 is 101
 * (half away from zero on the third decimal) and 0.1 + 0.2 never shows up.
 * null, '' and anything unreadable are 0.
 */
export function toPence(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0
    // Exponent forms (1e-7, 1e21) are too small or too large to be money.
    v = /e/i.test(String(v)) ? v.toFixed(6) : String(v)
  }
  const m = /^\s*([+-])?(\d*)(?:\.(\d*))?\s*$/.exec(String(v))
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return 0
  const sign = m[1] === '-' ? -1 : 1
  const whole = Number(m[2] || '0')
  const frac = (m[3] || '').padEnd(3, '0')
  let p = whole * 100 + Number(frac.slice(0, 2))
  if (Number(frac[2]) >= 5) p += 1
  return p === 0 ? 0 : sign * p
}

// Keys that name, reach or place a person. Taken out wherever they are.
const PERSONAL = new Set([
  'customer', 'customer_name', 'customer_email', 'customer_phone', 'customer_phone_number', 'customer_address',
  'email', 'phone', 'phone_number', 'address', 'postal_code', 'city', 'first_name', 'last_name', 'full_name',
  'cardholder_name', 'card_holder_name', 'birthday', 'customer_code', 'note_to_customer',
])

/** A deep copy without the PERSONAL keys (and `extra` keys at the top level). */
export function stripPersonal(v, extra = []) {
  const top = new Set(extra)
  const walk = (x, depth) => {
    if (Array.isArray(x)) return x.map(y => walk(y, depth + 1))
    if (!x || typeof x !== 'object') return x
    const out = {}
    for (const [k, y] of Object.entries(x)) {
      if (PERSONAL.has(k)) continue
      if (depth === 0 && top.has(k)) continue
      out[k] = walk(y, depth + 1)
    }
    return out
  }
  return walk(v, 0)
}

/** JSON with object keys sorted (arrays keep their order). */
export function stableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}

/** A quantity as a number with at most 3 decimals. */
export function toQty(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0
}

/** Is this connection's last good sync overdue? `conn`: { status, last_sync_ok_at, created_at }. */
export function syncLate(conn, now = Date.now()) {
  if (!conn || conn.status === 'paused') return false
  const at = conn.last_sync_ok_at || conn.created_at
  if (!at) return false
  return now - new Date(at).getTime() > LATE_AFTER_MINUTES * 60_000
}

/** How far a venue's history import has gone, 0..1 (1 when done). */
export function historyProgress(v) {
  if (!v || !v.history_from) return 0
  if (v.history_done_at) return 1
  const from = new Date(v.history_from).getTime()
  const to = new Date(v.history_to).getTime()
  const next = new Date(v.history_next_from || v.history_from).getTime()
  if (!(to > from)) return 1
  return Math.max(0, Math.min(1, (next - from) / (to - from)))
}

/**
 * A line's net spread over the parts it maps to (docs/SALES_IMPORT.md 4.4):
 * by `weights` (our list prices, part 0 the main part), whole pence, each
 * other part rounded toward zero and the remainder on the main part, so the
 * shares add up to `net` exactly (a refund's negative net too). With no
 * weight anywhere the main part takes it all. shared/combos.js
 * spreadPence() puts its remainder on the largest fractions instead, which
 * would move pence off the dish onto an option.
 */
export function allocateNet(net, weights) {
  const total = Math.trunc(Number(net) || 0)
  const w = (weights || []).map(x => Math.max(0, Number(x) || 0))
  if (!w.length) return []
  const sum = w.reduce((s, x) => s + x, 0)
  const out = w.map(() => 0)
  if (sum > 0) {
    for (let i = 1; i < w.length; i++) out[i] = Math.trunc((total * w[i]) / sum)
  }
  out[0] = total - out.slice(1).reduce((s, x) => s + x, 0)
  return out
}

/**
 * A trading day's figures from another till's stored checks, for Cash
 * Recon (the Loyverse fill: sumTerms() in shared/loyverse.js reads them).
 * It gives exactly what summing the till's receipts live gave before phase
 * 4 (api/test/sales-every-till.test.mjs holds the two against each other on
 * the stand-in's receipts). Cancelled checks are left out; a refund counts
 * against the day it was made on, as the other till's own reports have it,
 * its amounts taken as positive whichever way the till signs them. Pence.
 *   checks        [{ kind: 'sale' | 'refund', cancelled, discount_pence,
 *                 tax_pence, tip_pence, charge_pence, total_pence,
 *                 lines: [{ line_kind, item_ref, name, gross_pence, net_pence }],
 *                 payments: [{ payment_type_ref, name, amount_pence }] }]
 *                 (only item lines count: an item line's money holds its
 *                 modifiers')
 *   itemCategory  { [item_ref]: category_ref } for category terms, else null
 * Gives { sales, refund_receipts, gross_sales, net_sales, refunds,
 * discounts, taxes, tips, surcharges, total_collected, items: { ref: { name,
 * amount } }, categories: { ref: amount }, payment_types: { ref: { name,
 * amount } } }.
 */
export function dayFiguresFromStored(checks, itemCategory = null) {
  const day = {
    sales: 0, refund_receipts: 0,
    gross_sales: 0, net_sales: 0, refunds: 0, discounts: 0, taxes: 0,
    tips: 0, surcharges: 0, total_collected: 0,
    items: {}, categories: {}, payment_types: {},
  }
  const abs = v => Math.abs(Math.trunc(Number(v) || 0))
  for (const c of checks || []) {
    if (c.cancelled) continue
    const refund = c.kind === 'refund'
    if (refund) day.refund_receipts++
    else day.sales++
    const sign = refund ? -1 : 1
    const amt = v => sign * abs(v)

    day.discounts       += amt(c.discount_pence)
    day.taxes           += amt(c.tax_pence)
    day.tips            += amt(c.tip_pence)
    day.surcharges      += amt(c.charge_pence)
    day.total_collected += amt(c.total_pence)

    for (const l of c.lines || []) {
      if (l.line_kind !== 'item') continue
      const gross = abs(l.gross_pence)
      if (refund) day.refunds += gross
      else day.gross_sales += gross
      if (!l.item_ref) continue
      const after = sign * abs(l.net_pence)
      const it = day.items[l.item_ref] || (day.items[l.item_ref] = { name: l.name || '', amount: 0 })
      it.amount += after
      const cat = itemCategory?.[l.item_ref]
      if (cat) day.categories[cat] = (day.categories[cat] || 0) + after
    }
    for (const p of c.payments || []) {
      if (!p.payment_type_ref) continue
      const pt = day.payment_types[p.payment_type_ref] || (day.payment_types[p.payment_type_ref] = { name: p.name || '', amount: 0 })
      pt.amount += amt(p.amount_pence)
    }
  }
  day.net_sales = day.gross_sales - day.refunds - day.discounts
  return day
}

/**
 * Has a venue's trading day [start, end) been fully synced from the other
 * till? cover: { synced_to (pos_connections.sales_synced_to), history_from,
 * history_to, history_next_from, history_done_at (pos_connection_venues) }.
 * The catch-up must have run past the day's end, and when the day falls in
 * the months the history import reads, the import must have passed it. A
 * day older than the history reaches is covered: nothing more will come.
 * Cash Recon refuses to fill a day that has no stored checks and isn't
 * covered, instead of filling it with zeros.
 */
export function dayCovered(cover, { start, end }) {
  const ms = v => (v == null || v === '' ? null : new Date(v).getTime())
  const s = ms(start), e = ms(end), synced = ms(cover?.synced_to)
  if (synced == null || e == null || synced < e) return false
  if (!cover.history_from || cover.history_done_at) return true
  if (e <= ms(cover.history_from)) return true
  if (cover.history_to && s >= ms(cover.history_to)) return true
  return e <= ms(cover.history_next_from || cover.history_from)
}

/** Who sold it, in the "every till" report subjects: our own till, then each system. */
export const SALE_SOURCES = {
  macaroonie: 'Macaroonie',
  ...Object.fromEntries(Object.entries(SYSTEMS).map(([k, v]) => [k, v.label])),
}
