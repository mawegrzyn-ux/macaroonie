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
