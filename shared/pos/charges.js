// shared/pos/charges.js
//
// Charges on a check (migration 225): a service charge, a packaging or
// delivery fee... Set per order type (order_types.charges, Store tech >
// Order types), several per type, each a percent of what the check comes to
// after its discounts or a fixed amount. ONE implementation for the till, the
// cloud's sequencer, the venue hub, the admin and the API.
//
// An order type's charge (order_types.charges[], in the order they show):
//   { id: uuid, name, kind: 'percent' | 'amount', value: percent | pence,
//     optional: bool       staff may take it off the bill
//     min_covers: 0-100    0 = every check; else only from that many guests
//     tax_rate_id: uuid | null   null = no VAT on it }
//
// A charge on a check (check.charges[], shared/pos/checks.js): the same, plus
//   vat_rate     the tax rate's % at the venue when it went on the check
//   added        typed on the till (Charges > Add a charge), not the order type's
//   removed      taken off (reason, removed_by, approved_by, removed_at)
// check.charges_off remembers charges taken off that left the check when its
// order type changed, so they stay off if it changes back (switchCharges()).
//
// What a charge comes to (chargeAmount()): a percent of the check after every
// discount and offer (never of other charges), or its amount while the check
// has anything on it. A charge for parties of N waits until the check has N
// covers; a removed one counts nothing. Charges aren't sales: they add to the
// total, not to the net (shared/pos/pricing.js checkTotals()).
//
// Pure: no I/O.

import { isId } from './ids.js'
import { ratePercent } from '../tax.js'

export const CHARGE_KINDS = ['percent', 'amount']
export const CHARGE_PERCENT_MAX = 50
export const CHARGE_AMOUNT_MAX = 100_000 // £1,000
export const TYPE_CHARGES_MAX = 6        // per order type
export const CHECK_CHARGES_MAX = 12      // per check
export const MIN_COVERS_MAX = 100

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isRef = v => isUuid(v) || isId(v)

/** A percent kept to two decimals (12.5, 2.25). */
const pct2 = v => Math.round((Number(v) || 0) * 100) / 100

/**
 * What is wrong with a charge's shape (order type setting or check event),
 * or null. Says the field, for the event's "Bad ..." message.
 */
export function chargeProblem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'charge'
  if (!isRef(x.id)) return 'charge.id'
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 60) return 'charge.name'
  if (!CHARGE_KINDS.includes(x.kind)) return 'charge.kind'
  if (x.kind === 'percent' && !(typeof x.value === 'number' && x.value > 0 && x.value <= CHARGE_PERCENT_MAX)) return 'charge.value'
  if (x.kind === 'amount' && !(Number.isInteger(x.value) && x.value > 0 && x.value <= CHARGE_AMOUNT_MAX)) return 'charge.value'
  if (x.optional != null && typeof x.optional !== 'boolean') return 'charge.optional'
  if (x.min_covers != null && !(Number.isInteger(x.min_covers) && x.min_covers >= 0 && x.min_covers <= MIN_COVERS_MAX)) return 'charge.min_covers'
  if (x.vat_rate != null && !(typeof x.vat_rate === 'number' && x.vat_rate >= 0 && x.vat_rate <= 100)) return 'charge.vat_rate'
  if (x.tax_rate_id != null && !isUuid(x.tax_rate_id)) return 'charge.tax_rate_id'
  return null
}

/** An order type's charge as stored (the API saves only this). */
export function cleanTypeCharge(x) {
  const kind = CHARGE_KINDS.includes(x?.kind) ? x.kind : 'percent'
  return {
    id: x.id,
    name: String(x.name || '').trim(),
    kind,
    value: kind === 'amount' ? Math.round(Number(x.value) || 0) : pct2(x.value),
    optional: !!x.optional,
    min_covers: Math.max(0, Math.min(MIN_COVERS_MAX, Math.round(Number(x.min_covers) || 0))),
    tax_rate_id: isUuid(x.tax_rate_id) ? x.tax_rate_id : null,
  }
}

/** An order type's charges (a stored list or anything else). */
export function typeCharges(type) {
  return (Array.isArray(type?.charges) ? type.charges : []).filter(x => !chargeProblem(x)).map(cleanTypeCharge)
}

/**
 * The charges a check of this order type gets on the till, with each tax
 * rate's % at the venue (rates: the till config's tax_rates).
 */
export function chargesForType(type, venueId, rates = []) {
  return typeCharges(type).map(x => {
    const rate = x.tax_rate_id ? (rates || []).find(r => r.id === x.tax_rate_id) : null
    return { ...x, tax_rate_id: rate ? rate.id : null, vat_rate: rate ? ratePercent(rate, venueId) : 0 }
  })
}

/** A charge as it goes on a check (checks.js), from a check.opened / order type / added event. */
export function onCheck(x, extra = {}) {
  return {
    id: x.id,
    name: x.name.trim(),
    kind: x.kind,
    value: x.kind === 'amount' ? x.value : pct2(x.value),
    optional: !!x.optional,
    min_covers: x.min_covers || 0,
    vat_rate: Number(x.vat_rate) || 0,
    tax_rate_id: x.tax_rate_id || null,
    added: false,
    removed: false,
    reason: null,
    ...extra,
  }
}

const offPart = x => ({ reason: x.reason ?? null, removed_by: x.removed_by ?? null, approved_by: x.approved_by ?? null, removed_at: x.removed_at ?? null })

/**
 * A check's charges after its order type changes to one with `next`
 * charges: the new type's, then charges typed on the till. A charge taken
 * off stays off, also through a round trip (Eat in, Take out, Eat in): `off`
 * (check.charges_off) remembers, by charge id, those taken off that left the
 * check with its old type. Returns { charges, off }.
 */
export function switchCharges(current = [], next = [], off = {}) {
  const had = new Map((current || []).filter(x => !x.added).map(x => [x.id, x]))
  const memory = { ...(off || {}) }
  for (const x of had.values()) if (x.removed) memory[x.id] = offPart(x)
  const charges = next.map(x => {
    const old = had.get(x.id)
    const fresh = onCheck(x)
    const gone = old ? (old.removed ? memory[x.id] : null) : memory[x.id]
    return gone ? { ...fresh, removed: true, ...gone } : fresh
  })
  // What is on the check now (taken off or not) is the check's own business again.
  for (const x of next) delete memory[x.id]
  return { charges: [...charges, ...(current || []).filter(x => x.added)], off: memory }
}

/** Whether a charge counts on a check with `covers` guests. */
export function chargeApplies(x, covers) {
  return !x.removed && (Number(x.min_covers) || 0) <= (Number(covers) || 0)
}

/**
 * What a charge comes to on a check whose dishes come to `net` after
 * discounts (pence). An amount only while the check has something on it.
 */
export function chargeAmount(x, net, hasLines = true) {
  if (x.kind === 'amount') return hasLines ? Math.max(0, Math.round(Number(x.value) || 0)) : 0
  return Math.max(0, Math.round(Math.max(0, Number(net) || 0) * (Number(x.value) || 0) / 100))
}

const pctText = v => String(pct2(v)).replace(/\.0+$/, '')
const pounds = p => '£' + ((Number(p) || 0) / 100).toFixed(2)

/** The charge's line on a bill: "Service charge 12.5%", "Packaging". */
export function chargeLabel(x) {
  return x.kind === 'percent' ? x.name + ' ' + pctText(x.value) + '%' : x.name
}

/** How much, in words: "12.5%" or "£0.50". */
export function chargeValueText(x) {
  return x.kind === 'percent' ? pctText(x.value) + '%' : pounds(x.value)
}

/** A charge in a few words for lists: "Service charge 12.5%, optional, from 6 guests". */
export function chargeSummary(x) {
  const bits = [x.name + ' ' + chargeValueText(x)]
  if (x.optional) bits.push('optional')
  if (x.min_covers) bits.push('from ' + x.min_covers + ' guests')
  return bits.join(', ')
}
