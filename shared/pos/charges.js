// shared/pos/charges.js
//
// Charges on a check: a service charge, a packaging or delivery fee, a cup
// deposit... ONE implementation for the till, the cloud's sequencer, the venue
// hub, the admin and the API.
//
// The company keeps one list of charges (migration 231, Store tech > Charges,
// pos_charges). Each location says which of them a check gets, in a matrix of
// its revenue streams by order types (pos_charge_rules): a check of that
// stream and type gets those charges when it opens, and again when its order
// type or stream changes. Staff can also add a charge from the list on the
// till (the Charges window, or a till layout button) or type one in.
//
// A charge on the list (settings.charges in every till, sequencer and hub
// config; normaliseCharge() is the one shape):
//   { id: uuid, name, kind: 'percent' | 'amount', value: percent | pence,
//     optional: bool       staff may take it off the bill
//     min_covers: 0-100    0 = every check; else only from that many guests
//     tax_rate_id: uuid | null   null = no VAT on it
//     basis: 'check' | 'dishes'  every dish on the check, or only the dishes named
//     per: 'check' | 'dish'      an amount once, or for each dish it counts
//     item_ids, section_ids      the dishes named (basis 'dishes'): a dish, or
//                                every dish of a menu section
//     where: [{ stream, type }]  this location's matrix cells it is on }
//
// A charge on a check (check.charges[], shared/pos/checks.js): the same
// (without where), plus
//   vat_rate     the tax rate's % at the venue when it went on the check
//   list         added on the till from the list (the sequencer checks it is on the list)
//   added        added on the till (from the list or typed in), not the matrix's
//   removed      taken off (reason, removed_by, approved_by, removed_at)
// check.charges_off remembers charges taken off that left the check when its
// order type or stream changed, so they stay off if it changes back
// (switchCharges()).
//
// What a charge comes to (chargeBase() + chargeAmount()): a percent of the
// dishes it counts after every discount and offer (never of other charges),
// or its amount: once while it counts any dish, or for each dish it counts.
// A dish counts once for each of its quantity; a meal deal counts as itself
// when the deal is named, else each of its parts that is (a cup deposit on a
// meal deal's drink). A percent counts dishes on their own lines: a meal deal
// counts when the deal itself is named. A charge for parties of N waits until
// the check has N covers; a removed one counts nothing. Charges aren't sales:
// they add to the total, not to the net (shared/pos/pricing.js checkTotals()).
//
// Pure: no I/O.

import { isId } from './ids.js'
import { ratePercent } from '../tax.js'

export const CHARGE_KINDS = ['percent', 'amount']
export const CHARGE_BASES = ['check', 'dishes']
export const CHARGE_PERS = ['check', 'dish']
export const CHARGE_PERCENT_MAX = 50
export const CHARGE_AMOUNT_MAX = 100_000 // £1,000
export const CHARGES_MAX = 40            // on the company's list
export const CHECK_CHARGES_MAX = 12      // per check
export const MIN_COVERS_MAX = 100
export const CHARGE_ITEMS_MAX = 100      // dishes a charge names
export const CHARGE_SECTIONS_MAX = 30    // sections a charge names

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isRef = v => isUuid(v) || isId(v)
const idList = (v, max) => Array.isArray(v) && v.length <= max && v.every(isUuid)

/** A percent kept to two decimals (12.5, 2.25). */
const pct2 = v => Math.round((Number(v) || 0) * 100) / 100

/** Whether a charge counts named dishes only (a cup deposit) or the whole check. */
export const onDishes = x => x?.basis === 'dishes'
/** Whether an amount is for each dish it counts, not once. */
export const perDish = x => x?.per === 'dish'

/**
 * What is wrong with a charge's shape (list entry or check event), or null.
 * Says the field, for the event's "Bad ..." message.
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
  if (x.basis != null && !CHARGE_BASES.includes(x.basis)) return 'charge.basis'
  if (x.per != null && !CHARGE_PERS.includes(x.per)) return 'charge.per'
  if (x.item_ids != null && !idList(x.item_ids, CHARGE_ITEMS_MAX)) return 'charge.item_ids'
  if (x.section_ids != null && !idList(x.section_ids, CHARGE_SECTIONS_MAX)) return 'charge.section_ids'
  if (x.basis === 'dishes' && !(x.item_ids?.length || x.section_ids?.length)) return 'charge.dishes'
  if (x.list != null && typeof x.list !== 'boolean') return 'charge.list'
  return null
}

const uniq = list => [...new Set(list || [])]

/**
 * A charge on the company's list as stored and sent to the tills (the API
 * saves only this), or null when it can't be one. `where` is kept when given
 * (the location's matrix cells, settings.charges).
 */
export function normaliseCharge(x) {
  if (!x || typeof x !== 'object' || !isUuid(x.id)) return null
  const kind = CHARGE_KINDS.includes(x.kind) ? x.kind : 'percent'
  const value = kind === 'amount' ? Math.round(Number(x.value) || 0) : pct2(x.value)
  const basis = x.basis === 'dishes' ? 'dishes' : 'check'
  const out = {
    id: x.id,
    name: String(x.name || '').trim(),
    kind,
    value,
    optional: !!x.optional,
    min_covers: Math.max(0, Math.min(MIN_COVERS_MAX, Math.round(Number(x.min_covers) || 0))),
    tax_rate_id: isUuid(x.tax_rate_id) ? x.tax_rate_id : null,
    basis,
    per: x.per === 'dish' ? 'dish' : 'check',
    item_ids: basis === 'dishes' ? uniq(x.item_ids).filter(isUuid).slice(0, CHARGE_ITEMS_MAX) : [],
    section_ids: basis === 'dishes' ? uniq(x.section_ids).filter(isUuid).slice(0, CHARGE_SECTIONS_MAX) : [],
  }
  if (Array.isArray(x.where)) {
    out.where = x.where.filter(w => isUuid(w?.stream) && isUuid(w?.type)).map(w => ({ stream: w.stream, type: w.type }))
  }
  if (chargeProblem(out)) return null
  return out
}

/** The charges on a list (settings.charges or anything else), each as normaliseCharge() leaves it. */
export function chargeList(list) {
  return (Array.isArray(list) ? list : []).map(normaliseCharge).filter(Boolean)
}

/**
 * One list charge as it goes on a check: the tax rate's % where the till is
 * (rates: the till config's tax_rates); a rate the till doesn't know any
 * more counts as no VAT rather than a guess.
 */
export function chargeFromList(x, venueId = null, rates = []) {
  const rate = x.tax_rate_id ? (rates || []).find(r => r.id === x.tax_rate_id) : null
  return {
    id: x.id, name: x.name, kind: x.kind, value: x.value, optional: !!x.optional, min_covers: x.min_covers || 0,
    tax_rate_id: x.tax_rate_id || null, vat_rate: rate ? ratePercent(rate, venueId) : 0,
    ...(onDishes(x) ? { basis: 'dishes', item_ids: [...(x.item_ids || [])], section_ids: [...(x.section_ids || [])] } : {}),
    ...(perDish(x) ? { per: 'dish' } : {}),
  }
}

/**
 * The charges a check of this revenue stream and order type gets on the
 * till: the list charges whose matrix cells (where) name both. A check
 * without a stream or an order type gets none.
 */
export function chargesWhere(list, { streamId = null, typeId = null } = {}, venueId = null, rates = []) {
  if (!streamId || !typeId) return []
  return chargeList(list)
    .filter(x => (x.where || []).some(w => w.stream === streamId && w.type === typeId))
    .map(x => chargeFromList(x, venueId, rates))
}

// What makes a list charge the one on the list (vat_rate is worked out by the till).
const listKey = x => JSON.stringify([
  String(x.name || '').trim(), x.kind, x.kind === 'amount' ? x.value : pct2(x.value), !!x.optional, x.min_covers || 0,
  x.tax_rate_id || null, onDishes(x) ? 'dishes' : 'check', perDish(x) ? 'dish' : 'check',
  onDishes(x) ? uniq(x.item_ids).sort() : [], onDishes(x) ? uniq(x.section_ids).sort() : [],
])

/**
 * Why a charge added on the till "from the list" can't be taken (the
 * sequencer checks charge.added with list: true against settings.charges),
 * or null.
 */
export function chargeMismatch(x, list) {
  const own = chargeList(list).find(y => y.id === x?.id)
  if (!own) return 'This charge isn\'t on the till\'s list any more'
  if (listKey(own) !== listKey(x)) return 'This charge has changed on the list: open the Charges window again'
  return null
}

/** A charge as it goes on a check (checks.js), from a check.opened / order type / stream / added event. */
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
    ...(onDishes(x) ? { basis: 'dishes', item_ids: uniq(x.item_ids), section_ids: uniq(x.section_ids) } : {}),
    ...(perDish(x) ? { per: 'dish' } : {}),
    ...(x.list ? { list: true } : {}),
    added: false,
    removed: false,
    reason: null,
    ...extra,
  }
}

/** A check's charge as another check gets it (a split): the same charge, not taken off. */
export function copyOfCharge(x) {
  return {
    id: x.id, name: x.name, kind: x.kind, value: x.value, optional: !!x.optional, min_covers: x.min_covers || 0,
    vat_rate: x.vat_rate || 0, tax_rate_id: x.tax_rate_id || null,
    ...(onDishes(x) ? { basis: 'dishes', item_ids: [...(x.item_ids || [])], section_ids: [...(x.section_ids || [])] } : {}),
    ...(perDish(x) ? { per: 'dish' } : {}),
    ...(x.list ? { list: true } : {}),
  }
}

const offPart = x => ({ reason: x.reason ?? null, removed_by: x.removed_by ?? null, approved_by: x.approved_by ?? null, removed_at: x.removed_at ?? null })

/**
 * A check's charges after its order type or stream changes to one with
 * `next` charges: the new ones, then charges added on the till (a charge
 * added on the till stays, and isn't put on twice). A charge taken off stays
 * off, also through a round trip (Eat in, Take out, Eat in): `off`
 * (check.charges_off) remembers, by charge id, those taken off that left the
 * check with its old type. Returns { charges, off }.
 */
export function switchCharges(current = [], next = [], off = {}) {
  const had = new Map((current || []).filter(x => !x.added).map(x => [x.id, x]))
  const kept = (current || []).filter(x => x.added)
  const keptIds = new Set(kept.map(x => x.id))
  const memory = { ...(off || {}) }
  for (const x of had.values()) if (x.removed) memory[x.id] = offPart(x)
  const charges = next.filter(x => !keptIds.has(x.id)).map(x => {
    const old = had.get(x.id)
    const fresh = onCheck(x)
    const gone = old ? (old.removed ? memory[x.id] : null) : memory[x.id]
    return gone ? { ...fresh, removed: true, ...gone } : fresh
  })
  // What is on the check now (taken off or not) is the check's own business again.
  for (const x of next) delete memory[x.id]
  return { charges: [...charges, ...kept], off: memory }
}

/** Whether a charge counts on a check with `covers` guests. */
export function chargeApplies(x, covers) {
  return !x.removed && (Number(x.min_covers) || 0) <= (Number(covers) || 0)
}

/**
 * What a charge counts on a check: rows = [{ line, net }] (each active line
 * and what is left of it after discounts). Returns { net, count }: the net
 * of the dishes it counts (a percent's base) and how many dishes (an
 * amount's). Every dish on the check, or the named ones (item or section);
 * a meal deal named itself counts as one dish, else each named part counts.
 */
export function chargeBase(x, rows = []) {
  let net = 0
  let count = 0
  const dishes = onDishes(x)
  const items = new Set(x.item_ids || [])
  const sections = new Set(x.section_ids || [])
  const named = d => (!!d.item_id && items.has(d.item_id)) || (!!d.section_id && sections.has(d.section_id))
  for (const r of rows) {
    const l = r.line || {}
    const qty = Math.max(0, Number(l.qty) || 0)
    if (!dishes || named(l)) {
      net += Number(r.net) || 0
      count += qty
      continue
    }
    for (const p of l.combo || []) if (named(p)) count += qty
  }
  return { net, count }
}

/**
 * What a charge comes to (pence) from its base ({ net, count }, chargeBase()):
 * a percent of the net, or its amount once while it counts any dish, or for
 * each dish it counts.
 */
export function chargeAmount(x, base = {}) {
  const count = Number(base.count) || 0
  if (x.kind === 'amount') {
    if (!count) return 0
    const v = Math.max(0, Math.round(Number(x.value) || 0))
    return perDish(x) ? v * count : v
  }
  return Math.max(0, Math.round(Math.max(0, Number(base.net) || 0) * (Number(x.value) || 0) / 100))
}

const pctText = v => String(pct2(v)).replace(/\.0+$/, '')
const pounds = p => '£' + ((Number(p) || 0) / 100).toFixed(2)

/**
 * The charge's line on a bill: "Service charge 12.5%", "Packaging",
 * "Cup deposit x 2" (an amount for each dish, with the count from checkTotals()).
 */
export function chargeLabel(x) {
  if (x.kind === 'percent') return x.name + ' ' + pctText(x.value) + '%'
  return perDish(x) && x.count > 1 ? x.name + ' x ' + x.count : x.name
}

/** How much, in words: "12.5%", "£0.50" or "£0.25 a dish". */
export function chargeValueText(x) {
  if (x.kind === 'percent') return pctText(x.value) + '%'
  return pounds(x.value) + (perDish(x) ? ' a dish' : '')
}

/**
 * What a charge counts, in words: "the whole check", or the dishes and
 * sections it names (names: { items: { id: name }, sections: { id: title } }).
 */
export function chargeOnText(x, names = {}) {
  if (!onDishes(x)) return 'the whole check'
  const bits = [
    ...(x.section_ids || []).map(id => names.sections?.[id] || 'a section'),
    ...(x.item_ids || []).map(id => names.items?.[id] || 'a dish'),
  ]
  if (bits.length <= 3) return bits.join(', ')
  return bits.slice(0, 3).join(', ') + ' and ' + (bits.length - 3) + ' more'
}

/** A charge in a few words for lists: "Cup deposit £0.25 a dish, on Hot drinks, optional, from 6 guests". */
export function chargeSummary(x, names = {}) {
  const bits = [x.name + ' ' + chargeValueText(x)]
  if (onDishes(x)) bits.push('on ' + chargeOnText(x, names))
  if (x.optional) bits.push('optional')
  if (x.min_covers) bits.push('from ' + x.min_covers + ' guests')
  return bits.join(', ')
}
