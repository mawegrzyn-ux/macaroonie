// shared/pos/numbers.js
//
// Every till and kiosk numbers its own checks (migration 217, docs/POS.md
// 8.4), so a device working alone, the venue hub and the cloud can all give
// out numbers at the same time and never give the same one twice:
//
//   check number   the device's code and its own count for the trading day:
//                  T2-47 (codes from Store tech: T1, KS1, ...). Starts again
//                  at 1 each trading day.
//   order number   counter orders (tills and kiosks) only: a short number for
//                  calling out and the order ready boards, from the device's
//                  own range (settings.order_numbers, e.g. 100-199), going
//                  round within it.
//
// The device keeps { date, check, order } (the last ones it gave out) and
// puts the numbers in the check.opened event; the sequencer stamps the
// device's code on the check and remembers each device's highest numbers,
// which go back to a device that lost its storage (mergeNumbers()).
//
// Pure: no I/O, no clock.

export const CHECK_NO_MAX = 99999
export const ORDER_NO_MAX = 9999
export const ORDER_BLOCK = 100

const int = v => (Number.isInteger(v) ? v : Number.isInteger(Number(v)) && v !== '' && v != null ? Number(v) : null)
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** The n-th till or kiosk's range at a location (0-based): 1-99, 100-199, 200-299, ... */
export function defaultOrderRange(index) {
  const i = Math.max(0, Math.min(Math.floor(ORDER_NO_MAX / ORDER_BLOCK) - 1, Number(index) || 0))
  return { from: i === 0 ? 1 : i * ORDER_BLOCK, to: i * ORDER_BLOCK + ORDER_BLOCK - 1 }
}

/** { from, to } within 1..ORDER_NO_MAX with from <= to, else null. */
export function cleanOrderRange(r) {
  const from = int(r?.from)
  const to = int(r?.to)
  if (from == null || to == null || from < 1 || to > ORDER_NO_MAX || from > to) return null
  return { from, to }
}

export const rangesOverlap = (a, b) => !!(a && b && a.from <= b.to && b.from <= a.to)

/** The first default block that doesn't overlap any of these ranges. */
export function freeOrderRange(taken = []) {
  const used = taken.map(cleanOrderRange).filter(Boolean)
  for (let i = 0; i < Math.floor(ORDER_NO_MAX / ORDER_BLOCK); i++) {
    const r = defaultOrderRange(i)
    if (!used.some(u => rangesOverlap(u, r))) return r
  }
  return defaultOrderRange(0)
}

/** A device's numbers { date, check, order } (the last given out), or null. */
export function cleanNumbers(n) {
  if (!n || !isDate(n.date)) return null
  const check = int(n.check)
  const order = int(n.order)
  return {
    date: n.date,
    check: check != null && check >= 0 && check <= CHECK_NO_MAX ? check : 0,
    order: order != null && order >= 1 && order <= ORDER_NO_MAX ? order : null,
  }
}

/**
 * The device's own numbers with what the server last saw from it: the later
 * trading day wins; on the same day the higher check number, and the order
 * number the device has (else the server's: it lost its storage).
 */
export function mergeNumbers(local, server) {
  const a = cleanNumbers(local)
  const b = cleanNumbers(server)
  if (!a) return b
  if (!b || b.date < a.date) return a
  if (b.date > a.date) return b
  return { date: a.date, check: Math.max(a.check, b.check), order: a.order ?? b.order }
}

/**
 * The next numbers for a new check on this device's trading day `date`:
 * { numbers (to keep), number, order_no }. order_no only for a counter order,
 * the next in `range` after the last one (back to its start at the end).
 */
export function nextNumbers(numbers, { date, counter = false, range = null }) {
  const n = cleanNumbers(numbers)
  const today = n && n.date === date ? n : { date, check: 0, order: null }
  const number = today.check >= CHECK_NO_MAX ? 1 : today.check + 1
  let order = today.order
  let order_no = null
  if (counter) {
    const r = cleanOrderRange(range) || defaultOrderRange(0)
    order_no = order != null && order >= r.from && order < r.to ? order + 1 : r.from
    order = order_no
  }
  return { numbers: { date, check: number, order }, number, order_no }
}

/**
 * What the sequencer remembers for a device once one of its checks is
 * accepted: { [deviceId]: { date, check, order } }. Returns the new map, or
 * the same one when nothing changed.
 */
export function noteNumbers(all, deviceId, date, { number, order_no }) {
  if (!deviceId || !isDate(date) || !Number.isInteger(number)) return all || {}
  const map = all || {}
  const prev = cleanNumbers(map[deviceId])
  if (prev && prev.date > date) return map
  const same = prev && prev.date === date
  const next = {
    date,
    check: same ? Math.max(prev.check, number) : number,
    order: order_no ?? (same ? prev.order : null),
  }
  if (same && next.check === prev.check && next.order === prev.order) return map
  return { ...map, [deviceId]: next }
}

/** A check's number in words: T2-47 (or 47 for a check without a device code). */
export function numberText(c) {
  if (c?.number == null) return null
  return c.number_code ? c.number_code + '-' + c.number : String(c.number)
}
