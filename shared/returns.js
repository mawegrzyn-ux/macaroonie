// shared/returns.js
//
// Returns to the supplier and their credit notes (inventory phase 9b,
// migration 321; docs/INVENTORY.md 6.4), plain ESM for the API, the admin,
// Pepper and reports. One implementation (CLAUDE.md rule 12): the routes
// (api/src/routes/purchaseReturns.js), the Purchasing page's returns
// (admin/src/components/purchasing/returns.jsx), Pepper's start_return and
// Today all call these functions.
//
// A return is against a delivery that was booked in: each line is a line of
// that delivery with the packs going back (never more than arrived, less what
// other returns not cancelled already took back), a reason and the credit
// expected (packs x the price paid before VAT: lineAmounts()). The stock goes
// out when the return is made (a 'return' move on the ledger, shared/stock.js
// MOVE_KINDS); a cancelled return moves nothing.
//
//   RETURN_REASONS, RETURN_REASON_KEYS, RETURN_STATUSES, RETURN_SENT_VIA
//   CREDIT_OVERDUE_DAYS 14, RETURN_BACK_DAYS 14, RETURN_NOTE_MAX 500, MAX_RETURN_LINES
//   returnNumberLabel(n)                       'RT-00012'
//   returnedOf(lines)                          packs already going back, by delivery line
//   returnableLines(poLines, returned)         the delivery's lines with what can still go back
//   returnPrefill(line)                        a damaged (or substituted) line's return, filled in
//   returnLinesProblem(lines, returnable)      why a return's lines can't be saved, or null
//   returnedAtProblem(at, { now, receivedAt }) why that moment can't be the return's, or null
//   paidPrice(poLine)                          the price paid per pack: the invoice's, else the price ordered at
//   returnTotals(lines)                        { net, vat, total } of the credit expected
//   returnActions(ret, { canStart, canApprove })  what may be done with a return now
//   creditOwed(ret), creditOverdue(ret, now, days), daysWaiting(ret, now)
//   creditDifference(ret)                      the amount credited less the credit expected
//   returnWords(ret, { prices })               a line about a return, for Today and Pepper

import { lineAmounts, round2 } from './procurement.js'

export const RETURN_REASONS = {
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  short_dated: 'Short dated',
  quality: 'Quality',
  other: 'Other',
}
export const RETURN_REASON_KEYS = Object.keys(RETURN_REASONS)

export const RETURN_STATUSES = {
  open: 'Open',
  sent: 'Sent',
  credited: 'Credited',
  refused: 'Refused',
  cancelled: 'Cancelled',
}

/** How a return reached the supplier (sent_via): emailed from here, or marked sent another way. */
export const RETURN_SENT_VIA = {
  email: 'Emailed',
  driver: 'Handed to the driver',
  phone: 'Phoned',
  website: 'On their website',
  print: 'Printed and handed over',
  other: 'Another way',
}

// A credit note not in after this many days from the return is overdue (Today).
export const CREDIT_OVERDUE_DAYS = 14
// A return can be dated up to this many days back (never before the delivery was booked in).
export const RETURN_BACK_DAYS = 14
export const RETURN_NOTE_MAX = 500
export const MAX_RETURN_LINES = 200

const DAY = 86400000
const num = v => (v == null || v === '' ? 0 : Number(v))
const round3 = n => Math.round(Number(n) * 1000) / 1000
const time = at => (at == null ? null : new Date(at).getTime())

/** RT-00012. */
export function returnNumberLabel(n) {
  return 'RT-' + String(n ?? 0).padStart(5, '0')
}

/** The price paid per pack before VAT: the invoice's where one was read, else the price ordered at. */
export function paidPrice(l) {
  return l?.invoice_price != null ? Number(l.invoice_price) : num(l?.price)
}

/** The VAT rate paid: the invoice's where one was read, else the line's. */
export function paidVatRate(l) {
  return l?.invoice_vat_rate != null ? Number(l.invoice_vat_rate) : num(l?.vat_rate)
}

/**
 * Packs already going back for each delivery line, from the lines of
 * returns not cancelled: [{ po_line_id, qty, status? }] -> Map(po_line_id -> packs).
 * A line whose return is cancelled (status 'cancelled') is left out.
 */
export function returnedOf(lines = []) {
  const out = new Map()
  for (const l of lines || []) {
    if (l.status === 'cancelled') continue
    out.set(l.po_line_id, round3((out.get(l.po_line_id) || 0) + num(l.qty)))
  }
  return out
}

/**
 * The delivery's lines that can go back: those that arrived (received_qty
 * over 0) and are still an inventory item, each with what is already going
 * back (returned_qty) and what is left (left, never below 0). poLines: the
 * purchase order's lines (loadPoLines()); returned: returnedOf()'s map.
 */
export function returnableLines(poLines = [], returned = new Map()) {
  return (poLines || [])
    .filter(l => num(l.received_qty) > 0 && l.item_id)
    .map(l => {
      const back = returned.get(l.id) || 0
      return { ...l, returned_qty: back, left: Math.max(0, round3(num(l.received_qty) - back)) }
    })
}

/**
 * A return line filled in from how the line was booked in: a damaged line
 * goes back as damaged, a substituted one as the wrong item, with what is
 * left of it and the delivery's note. Null for any other line (nothing to
 * suggest) or one with nothing left.
 */
export function returnPrefill(line) {
  if (!line || !(num(line.left ?? line.received_qty) > 0)) return null
  const reason = line.receive_status === 'damaged' ? 'damaged' : line.receive_status === 'substituted' ? 'wrong_item' : null
  if (!reason) return null
  return { po_line_id: line.id, qty: round3(num(line.left ?? line.received_qty)), reason, note: line.receive_note || null }
}

/**
 * Why a return's lines can't be saved, or null. lines: [{ po_line_id, qty,
 * reason, note }]; returnable: returnableLines()'s. At least one line, each
 * a line of the delivery once, packs above 0 and no more than is left, a
 * reason of the list, a note for Other.
 */
export function returnLinesProblem(lines = [], returnable = []) {
  if (!lines?.length) return 'Pick at least one line to return'
  if (lines.length > MAX_RETURN_LINES) return 'A return holds up to ' + MAX_RETURN_LINES + ' lines'
  const by = new Map((returnable || []).map(l => [l.id, l]))
  const seen = new Set()
  for (const l of lines) {
    const line = by.get(l.po_line_id)
    if (!line) return 'A line isn\'t on this delivery, or nothing of it arrived'
    if (seen.has(l.po_line_id)) return line.item_name + ' is on the return twice'
    seen.add(l.po_line_id)
    if (!(num(l.qty) > 0)) return 'Say how many of ' + line.item_name + ' go back'
    if (num(l.qty) > line.left + 1e-9) {
      return line.left > 0
        ? 'Only ' + round3(line.left) + ' of ' + line.item_name + ' can go back (' + round3(num(line.received_qty)) + ' arrived' +
          (line.returned_qty ? ', ' + round3(line.returned_qty) + ' already going back' : '') + ')'
        : 'All of ' + line.item_name + ' is already going back'
    }
    if (!RETURN_REASONS[l.reason]) return 'Pick why ' + line.item_name + ' goes back'
    if (l.reason === 'other' && !String(l.note || '').trim()) return 'Say why ' + line.item_name + ' goes back (Other needs a note)'
    if (l.note && String(l.note).length > RETURN_NOTE_MAX) return 'A note is up to ' + RETURN_NOTE_MAX + ' characters'
  }
  return null
}

/**
 * Why `at` can't be when the goods went back, or null: not in the future
 * (5 minutes' grace), not over RETURN_BACK_DAYS back, never before the
 * delivery was booked in (receivedAt).
 */
export function returnedAtProblem(at, { now = new Date(), receivedAt = null } = {}) {
  const t = time(at)
  if (t == null || !Number.isFinite(t)) return 'That time doesn\'t exist'
  const n = time(now)
  if (t > n + 5 * 60000) return 'Goods can\'t go back in the future'
  if (t < n - RETURN_BACK_DAYS * DAY) return 'A return is made now or up to ' + RETURN_BACK_DAYS + ' days back'
  if (receivedAt != null && t < time(receivedAt) - 60000) return 'Goods can\'t go back before the delivery was booked in'
  return null
}

/** The credit expected for lines [{ qty, price, vat_rate }]: { net, vat, total }, by lineAmounts(). */
export function returnTotals(lines = []) {
  let net = 0, vat = 0
  for (const l of lines || []) {
    const a = lineAmounts(l)
    net += a.net
    vat += a.vat
  }
  net = round2(net); vat = round2(vat)
  return { net, vat, total: round2(net + vat) }
}

/**
 * What may be done with a return now (the API's checks and the page's
 * buttons): canStart is Purchasing Use, canApprove Purchasing approval
 * Manage. Sending (email, or marked sent), the credit note and refused are
 * an approver's; an open return can be cancelled by whoever may start one,
 * a sent one by an approver. A credit note can be recorded again (a
 * correction), also after a refusal (the supplier changed their mind).
 */
export function returnActions(ret, { canStart = false, canApprove = false } = {}) {
  const s = ret?.status
  return {
    can_email: canApprove && (s === 'open' || s === 'sent'),
    can_mark_sent: canApprove && s === 'open',
    can_credit: canApprove && ['open', 'sent', 'refused', 'credited'].includes(s),
    can_refuse: canApprove && (s === 'open' || s === 'sent'),
    can_cancel: (s === 'open' && (canStart || canApprove)) || (s === 'sent' && canApprove),
  }
}

/** A credit is still expected: the return is open or sent. */
export function creditOwed(ret) {
  return ret?.status === 'open' || ret?.status === 'sent'
}

/** Whole days since the goods went back, at `now`. */
export function daysWaiting(ret, now = new Date()) {
  const t = time(ret?.returned_at)
  return t == null ? null : Math.max(0, Math.floor((time(now) - t) / DAY))
}

/** A credit still expected CREDIT_OVERDUE_DAYS (or `days`) or more after the goods went back. */
export function creditOverdue(ret, now = new Date(), days = CREDIT_OVERDUE_DAYS) {
  if (!creditOwed(ret)) return false
  const t = time(ret.returned_at)
  return t != null && time(now) - t >= days * DAY
}

/** The amount credited less the credit expected (both before VAT), or null while either isn't known. */
export function creditDifference(ret) {
  if (ret?.credit_amount == null || ret?.credit_expected == null) return null
  return round2(Number(ret.credit_amount) - Number(ret.credit_expected))
}

const money = n => '£' + num(n).toFixed(2)
const shortDay = at => {
  try {
    return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })
  } catch {
    return String(at).slice(0, 10)
  }
}

/**
 * A line about a return: "RT-00003 to Brakes: 2 lines, returned 3 Nov,
 * sent 4 Nov, £24.50 expected". prices: whether the credit may be said.
 */
export function returnWords(ret, { prices = false, now = new Date() } = {}) {
  if (!ret) return ''
  const n = ret.lines?.length ?? ret.line_count ?? null
  const bits = [
    n != null ? n + ' line' + (n === 1 ? '' : 's') : null,
    ret.returned_at ? 'returned ' + shortDay(ret.returned_at) : null,
    ret.status === 'open' ? 'not sent to the supplier yet' : null,
    ret.status === 'sent' && ret.sent_at ? 'sent ' + shortDay(ret.sent_at) : null,
    ret.status === 'credited' ? 'credit note ' + (ret.credit_note_number || '') : null,
    ret.status === 'refused' ? 'refused' : null,
    ret.status === 'cancelled' ? 'cancelled' : null,
    prices && creditOwed(ret) && ret.credit_expected != null ? money(ret.credit_expected) + ' expected' : null,
    prices && ret.status === 'credited' && ret.credit_amount != null ? money(ret.credit_amount) + ' credited' : null,
    creditOverdue(ret, now) ? 'waiting ' + daysWaiting(ret, now) + ' days' : null,
  ].filter(Boolean)
  return returnNumberLabel(ret.number) + (ret.supplier_name ? ' to ' + ret.supplier_name : '') + (bits.length ? ': ' + bits.join(', ') : '')
}
