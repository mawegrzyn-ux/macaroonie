// shared/stock.js
//
// The stock rules (inventory phase 4a, migrations 305 to 307;
// docs/INVENTORY.md 6.1 to 6.4), plain ESM for the API, the admin and the
// tests. Stock is read from documents, never stored as a level (principle
// 2): each delivery, count and adjustment is a "move" of one item at one
// venue, and on hand is the item's last approved count plus every move
// after it. Quantities are in the item's base unit (g, ml or each).
//
//   MOVE_KINDS             the kinds of move and how each acts: a count sets
//                          the quantity, the others add to it (signed). Phase
//                          4b added waste and transfers here and as sources in
//                          services/stockSvc.js
//   stockOnHand({ moves, at })   one item at one venue: the last count (at or
//                          before `at`, else any) plus the moves after it ->
//                          { on_hand, counted, counted_at, received_since,
//                            adjusted_since, since: { kind: qty }, used_since,
//                            sales_counted }
//   runningBalance(moves)  the ledger: each move in time order with its
//                          change and the balance after it (null before the
//                          first count)
//   countUnits(item, packs)      the units an item can be counted in: its
//                          standard units, its own (inv_item_units) and the
//                          packs its supplier prices come in
//   unitChoice(choices, unit)    the choice a typed unit names (key, label, a pack's name)
//   entriesToBase(entries, choices, item)   a line typed in several units
//                          (2 cases + 3 each + 400 g) -> { qty_base, entries,
//                          problem }: each unit must be one of the choices
//   countReview(lines, { expected, cost })   expected against counted per
//                          item, with each difference's value and the totals
//   notCounted(scope, lines)      a full count's items with no line yet (to
//                          confirm as zero before it is submitted)
//   approvalProblem(count, lines, who, settings)  why this person (a name, or
//                          every form of it) may not approve the count (the
//                          second person setting), or null
//   countDueOn(settings, weekday)  the venue counts on this weekday (Today)
//   lineSaves(send, { delay })   a count sheet's line saves: each line sent a
//                          moment after it is typed; flush() sends what is
//                          waiting and resolves once every save has its answer
//                          (a submit awaits it)
//   COUNT_KINDS, COUNT_STATUSES, MAX_ENTRIES, signedBase()
//
// Waste and transfers (inventory phase 4b, migrations 308 and 309; 6.3, 6.4):
//   WASTE_KINDS, WASTE_KIND_KEYS, WASTE_REASON_SEEDS   WRAP's three kinds and
//                          the reasons every group starts with
//   (itemsOf(), what a wasted dish or batch is in items, is shared/stockItems.js:
//   it needs the cost engine, which this file can't import)
//   voidReason(text, reasons)   the reason a till void marked wasted counts
//                          under: the group's reason of that name, else its
//                          words with the kind preparation (made, not served)
//   wasteUndo(entry, { today, me, canManage, canUse })   what may be done to a
//                          logged entry: undo on its trading day (whoever
//                          logged it, or Manage), reverse after it (Manage)
//   wasteTotals(rows, by)  waste added up by reason, kind, item, dish, person
//                          or day: quantity, value, entries (the summary and
//                          Pepper's waste_summary)
//   TRANSFER_STATUSES, transferLineMoves(transfer, line)   a transfer line's
//                          moves: out of the sender when sent (what arrived),
//                          lost in transit (what didn't) at the same moment, in
//                          at the receiver when received, back at the sender
//                          when a sent transfer is cancelled
//   lostInTransit(sent, received)   what didn't arrive (never below zero)
//
// Never import from procurement.js at the top level here (it re-exports
// stockOnHand(), so the two modules load each other): use its bindings only
// inside functions. Nor from costing.js at all (it imports procurement.js
// and uses its bindings as it loads): what needs the cost engine is
// shared/stockItems.js.

import { UNITS, formatBase, packLabel, fmtNum } from './procurement.js'

export const COUNT_KINDS = {
  full: { label: 'Full count', hint: 'Every item at the venue. What isn\'t counted is confirmed as zero before it is submitted.' },
  key: { label: 'Key items', hint: 'A short list (proteins, cheese, what goes missing). Items not on it keep their figures.' },
}
export const COUNT_STATUSES = {
  draft: 'Counting',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  cancelled: 'Cancelled',
}
// How each kind of move acts on the quantity. `sets`: a count replaces it.
export const MOVE_KINDS = {
  count: { label: 'Count', sets: true },
  delivery: { label: 'Delivery' },
  adjustment: { label: 'Adjustment' },
  // Phase 4b (migrations 308 and 309): each signed, minus takes stock off.
  waste: { label: 'Waste' },
  transfer_out: { label: 'Sent to another venue' },
  transfer_in: { label: 'Received from another venue' },
  lost_in_transit: { label: 'Lost in transit' },
}
// Units on one line of a count (2 cases + 3 each + 400 g).
export const MAX_ENTRIES = 6
// A count's moment may be set a little earlier (the sheet filled in after closing), never later.
export const COUNT_BACK_DAYS = 14

const num = v => (v == null || v === '' ? 0 : Number(v))
const round4 = n => Math.round(Number(n) * 10000) / 10000
const lower = s => String(s ?? '').trim().toLowerCase()
const time = at => (at == null ? null : new Date(at).getTime())
// Moves in time order; at the same moment a count comes last (what was there once the rest had happened).
const inOrder = moves => [...(moves || [])].sort((a, b) => (time(a.at) - time(b.at))
  || ((MOVE_KINDS[a.kind]?.sets ? 1 : 0) - (MOVE_KINDS[b.kind]?.sets ? 1 : 0)))

/** "+2 kg", "-500 g", "0 each". */
export function signedBase(qty, baseUnit) {
  const v = round4(num(qty))
  return (v > 0 ? '+' : v < 0 ? '-' : '') + formatBase(Math.abs(v), baseUnit)
}

/**
 * One item at one venue from its moves ({ kind, qty_base, at }; a count's
 * qty_base is what was counted, every other's is signed). `at`: as it stood
 * then (the expected quantity at a count's moment); left out, now.
 */
export function stockOnHand({ moves = [], at = null } = {}) {
  const until = time(at)
  const upTo = until == null ? inOrder(moves) : inOrder(moves).filter(m => time(m.at) <= until)
  let count = null
  for (const m of upTo) if (MOVE_KINDS[m.kind]?.sets) count = m
  const after = count ? upTo.filter(m => m !== count && time(m.at) > time(count.at) && !MOVE_KINDS[m.kind]?.sets) : upTo.filter(m => !MOVE_KINDS[m.kind]?.sets)
  const since = {}
  for (const m of after) since[m.kind] = round4((since[m.kind] || 0) + num(m.qty_base))
  const moved = after.reduce((s, m) => s + num(m.qty_base), 0)
  return {
    on_hand: count ? round4(num(count.qty_base) + moved) : null,
    counted: count ? round4(num(count.qty_base)) : null,
    counted_at: count?.at ?? null,
    received_since: since.delivery || 0,
    adjusted_since: since.adjustment || 0,
    // Phase 4b: what was wasted (taken off: below zero) and what moved between venues since the count.
    wasted_since: since.waste || 0,
    transferred_since: round4((since.transfer_out || 0) + (since.transfer_in || 0) + (since.lost_in_transit || 0)),
    since,
    // Usage from sales comes with phase 5 (recipes linked to what sold).
    used_since: null,
    sales_counted: false,
  }
}

/** The ledger: every move in time order with { change, balance } (null before the first count). */
export function runningBalance(moves) {
  let balance = null
  return inOrder(moves).map(m => {
    const q = num(m.qty_base)
    let change
    if (MOVE_KINDS[m.kind]?.sets) {
      change = balance == null ? null : round4(q - balance)
      balance = round4(q)
    } else {
      change = round4(q)
      balance = balance == null ? null : round4(balance + q)
    }
    return { ...m, change, balance }
  })
}

// ── Counting in the item's own units ───────────────────────────────────

/**
 * The units an item can be counted in, each with how many of its base unit
 * one is: its standard units (kg and g for an item kept in grams), its own
 * (1 slice = 20 g, migration 298) and the packs its supplier prices come in
 * (a case of 6 x 2 kg), keyed 'pack:<quote id>'. A pack's size is the
 * quote's pack_base_qty; two prices in the same pack are one choice.
 */
export function countUnits(item, packs = []) {
  const kind = UNITS[item?.base_unit]?.kind
  const base = UNITS[item?.base_unit]
  if (!kind || !base) return []
  const out = Object.keys(UNITS).filter(k => UNITS[k].kind === kind)
    .map(k => ({ key: k, label: UNITS[k].label, base_qty: UNITS[k].factor / base.factor, kind: 'standard' }))
  for (const u of item.units || []) {
    if (out.some(o => lower(o.key) === lower(u.name)) || !(num(u.base_qty) > 0)) continue
    out.push({ key: u.name, label: u.name + ' (' + formatBase(u.base_qty, item.base_unit) + ')', base_qty: num(u.base_qty), kind: 'own' })
  }
  for (const q of packs || []) {
    if (!(num(q.pack_base_qty) > 0)) continue
    const label = packLabel(q)
    if (out.some(o => o.kind === 'pack' && o.label === label && o.base_qty === num(q.pack_base_qty))) continue
    out.push({ key: 'pack:' + q.id, label, base_qty: num(q.pack_base_qty), kind: 'pack', name: lower(q.pack_name) || 'pack' })
  }
  return out
}

/** The unit a count starts in: the item's usual count unit when it has one, else kg / l / each. */
export function defaultCountUnit(item, choices) {
  const want = item?.count_unit || (item?.base_unit === 'g' ? 'kg' : item?.base_unit === 'ml' ? 'l' : 'each')
  return (choices || []).find(c => lower(c.key) === lower(want))?.key ?? choices?.[0]?.key ?? item?.base_unit
}

/**
 * A line typed in several units as one quantity in the item's base unit.
 * entries [{ qty, unit }], unit a choice's key. Each unit's size comes from
 * the choices (the server's own list, never what a browser says), and the
 * entries are kept as typed with their label and size. An empty list is
 * nothing counted (qty_base null); a unit that isn't a choice is named.
 */
export function entriesToBase(entries, choices, item = null) {
  const list = (entries || []).filter(e => e && e.qty !== '' && e.qty != null)
  if (list.length > MAX_ENTRIES) return { qty_base: null, entries: [], problem: 'A line takes at most ' + MAX_ENTRIES + ' units' }
  if (!list.length) return { qty_base: null, entries: [], problem: null }
  const out = []
  let total = 0
  for (const e of list) {
    const q = Number(e.qty)
    if (!Number.isFinite(q) || q < 0) return { qty_base: null, entries: [], problem: 'A quantity isn\'t a number' }
    const c = unitChoice(choices, e.unit)
    if (!c) {
      const article = /^[aeiou]/i.test(String(e.unit || '').trim()) ? 'an ' : 'a '
      return { qty_base: null, entries: [], problem: (item?.name || 'This item') + ' has no size for ' + article + (String(e.unit || '').trim() || 'blank unit') }
    }
    out.push({ qty: round4(q), unit: c.key, label: c.label, base_qty: c.base_qty })
    total += q * c.base_qty
  }
  return { qty_base: round4(total), entries: out, problem: null }
}

/**
 * The choice a typed unit names: its key ('kg', 'slice', 'pack:<id>'), its
 * label, or a pack's name ("case") when only one pack has that name. Null
 * when none fits.
 */
export function unitChoice(choices, unit) {
  const list = choices || []
  const u = lower(unit)
  const named = list.filter(x => x.kind === 'pack' && (x.name === u || x.name + 's' === u))
  return list.find(x => x.key === unit) || list.find(x => lower(x.key) === u) || list.find(x => lower(x.label) === u)
    || (named.length === 1 ? named[0] : null)
}

/** "2 Case · 6 × 2 kg + 3 each + 400 g" */
export function entriesText(entries) {
  return (entries || []).map(e => fmtNum(e.qty) + ' ' + (e.label || e.unit)).join(' + ')
}

// ── Reviewing and approving a count ─────────────────────────────────────

/**
 * Expected against counted per item: lines [{ item_id, qty_base }] (an
 * item counted in two areas has two lines, added), expected { item_id:
 * qty | null }, cost { item_id: pounds per base unit | null }. Returns rows
 * [{ item_id, counted, expected, diff, value }] (value = diff x cost, null
 * when there is no cost or no expected figure) and totals { gain, loss, net,
 * valued, unvalued }: what was found over what was expected, what was missing,
 * and the net, in pounds.
 */
export function countReview(lines, { expected = {}, cost = {} } = {}) {
  const counted = new Map()
  for (const l of lines || []) counted.set(l.item_id, round4((counted.get(l.item_id) || 0) + num(l.qty_base)))
  let gain = 0, loss = 0, valued = 0, unvalued = 0
  const rows = [...counted.entries()].map(([item_id, c]) => {
    const e = expected[item_id] ?? null
    const diff = e == null ? null : round4(c - num(e))
    const per = cost[item_id] ?? null
    const value = diff == null || per == null ? null : Math.round(diff * num(per) * 100) / 100
    if (value == null) { if (diff) unvalued++ } else {
      valued++
      if (value > 0) gain += value
      else loss += value
    }
    return { item_id, counted: c, expected: e, diff, value }
  })
  const r2 = n => Math.round(n * 100) / 100
  return { rows, totals: { gain: r2(gain), loss: r2(loss), net: r2(gain + loss), valued, unvalued } }
}

/** A full count's items (scope: ids) with no line yet: to be confirmed as zero. */
export function notCounted(scope, lines) {
  const have = new Set((lines || []).map(l => l.item_id))
  return [...new Set(scope || [])].filter(id => !have.has(id))
}

/**
 * Why `who` may not approve a submitted count, or null. With the group's
 * second person setting on, the approver must be someone who neither
 * counted a line nor submitted it. `who`: the approver as the documents
 * keep people (the API's stockPerson(): their email), or a list of every
 * form their name takes (email and sub), any of which matching is them.
 */
export function approvalProblem(count, lines, who, { second_person_approves = false } = {}) {
  if (!count || count.status !== 'submitted') return { code: 'not_submitted', message: 'Only a submitted count can be approved' }
  if (second_person_approves) {
    const counters = new Set([count.submitted_by, ...(lines || []).map(l => l.counted_by)].filter(Boolean).map(lower))
    const mine = [].concat(who ?? []).filter(Boolean).map(lower)
    if (mine.some(m => counters.has(m))) {
      return { code: 'second_person', message: 'Someone who didn\'t count or submit it has to approve this count (the second person setting is on)' }
    }
  }
  return null
}

/** Whether a venue counts on a weekday (0 Sunday to 6 Saturday). */
export function countDueOn(settings, weekday) {
  return settings?.count_weekday != null && Number(settings.count_weekday) === Number(weekday)
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Saving a count's lines as they are typed ────────────────────────────

/**
 * A count sheet's line saves (the one place a count saves itself, line by
 * line). save(key, body) sends the line `delay` ms after its last change (a
 * newer change of the same line starts the wait again). flush() sends every
 * waiting line at once and resolves, once every line sent or already being
 * sent has its answer, to true when all of them saved. A submit awaits
 * flush() and stops on false: sent after a fixed pause instead, it could
 * reach the server before a line typed just before it, and the late line
 * was then refused (the count no longer a draft), dropped from a key count
 * or confirmed as zero on a full one.
 *   send(key, body) -> a promise that rejects when the line didn't save
 */
export function lineSaves(send, { delay = 900, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const timers = new Map()
  const waiting = new Map()
  const sending = new Set()
  const go = (key, body) => {
    waiting.delete(key)
    clearTimer(timers.get(key))
    timers.delete(key)
    const p = Promise.resolve().then(() => send(key, body)).then(() => true, () => false)
    sending.add(p)
    p.then(() => sending.delete(p))
    return p
  }
  return {
    save(key, body) {
      waiting.set(key, body)
      clearTimer(timers.get(key))
      timers.set(key, setTimer(() => go(key, body), delay))
    },
    async flush() {
      for (const [key, body] of [...waiting]) go(key, body)
      return (await Promise.all([...sending])).every(Boolean)
    },
    /** Lines typed and not sent yet, and lines being sent. */
    pending: () => waiting.size + sending.size,
  }
}

// ── Waste (phase 4b, migration 308; docs/INVENTORY.md 6.3) ──────────────

/** WRAP's three kinds of food waste in hospitality. */
export const WASTE_KINDS = {
  spoilage: { label: 'Spoilage', hint: 'Gone off or out of date before it was used: stored too long, a fridge that failed.' },
  preparation: { label: 'Preparation', hint: 'Lost in the kitchen: trim and peelings, made too much, dropped, burnt, a dish made and not served.' },
  plate: { label: 'Plate', hint: 'What guests leave or send back.' },
}
export const WASTE_KIND_KEYS = Object.keys(WASTE_KINDS)

/** The reasons every group starts with (migration 308 seeds the same list). */
export const WASTE_REASON_SEEDS = [
  { name: 'Out of date', kind: 'spoilage' },
  { name: 'Gone off', kind: 'spoilage' },
  { name: 'Damaged in storage', kind: 'spoilage' },
  { name: 'Trim and peelings', kind: 'preparation' },
  { name: 'Made too much', kind: 'preparation' },
  { name: 'Dropped or spilt', kind: 'preparation' },
  { name: 'Burnt or cooked wrong', kind: 'preparation' },
  { name: 'Sent back by a guest', kind: 'plate' },
  { name: 'Left on the plate', kind: 'plate' },
]

/** What a waste entry names: an inventory item, a prep batch or a menu dish. */
export const WASTE_WHAT = { item: 'Item', recipe: 'Prep batch', dish: 'Dish' }

/**
 * The reason a till void marked wasted counts under: the group's reason of
 * the same name (any case), else the void's own words with the kind
 * preparation (the dish was made and not served). reasons: [{ id, name, kind }].
 */
export function voidReason(text, reasons = []) {
  const words = String(text ?? '').trim() || 'Voided on the till'
  const hit = (reasons || []).find(r => lower(r.name) === lower(words))
  return hit ? { reason_id: hit.id, reason: hit.name, kind: hit.kind } : { reason_id: null, reason: words, kind: 'preparation' }
}

/**
 * What may be done to a logged waste entry ({ day, wasted_by, undone_at,
 * reverses_id, reversed }) by this person: undo on the entry's trading day
 * (today, YYYY-MM-DD at the venue) by whoever logged it or Stock manage, or
 * after that a reversing entry (Stock manage). me: the person's names (a
 * name or a list: email and sub). -> { undo, reverse, why }
 */
export function wasteUndo(entry, { today, me, canUse = false, canManage = false } = {}) {
  const no = why => ({ undo: false, reverse: false, why })
  if (!entry) return no('Waste entry not found')
  if (entry.undone_at) return no('This entry was undone')
  if (entry.reverses_id) return no('This entry reverses another: log the waste again instead')
  if (entry.reversed) return no('This entry is reversed already')
  const mine = [].concat(me ?? []).filter(Boolean).map(lower)
  const own = !!entry.wasted_by && mine.includes(lower(entry.wasted_by))
  if (String(entry.day).slice(0, 10) === String(today).slice(0, 10)) {
    if (canManage || (canUse && own)) return { undo: true, reverse: false, why: null }
    return no('Only whoever logged it, or someone with Stock manage, can undo it')
  }
  if (canManage) return { undo: false, reverse: true, why: null }
  return no('Its trading day is over: someone with Stock manage can reverse it')
}

/**
 * Waste added up by `by` (reason, kind, item, dish, person, day, what):
 * rows [{ key, label, entries, qty, unit, value, unvalued }], biggest value
 * first (then most entries). rows: [{ reason, reason_kind, name, what,
 * dish_id, by, day, qty, unit, value }]; for `item` a row per item of an
 * entry: { item_id, item_name, qty_base, base_unit, value }. qty is added
 * only while every row of a group has the same unit (else null).
 */
export function wasteTotals(rows, by = 'reason') {
  const keyOf = {
    reason: r => [lower(r.reason), r.reason],
    kind: r => [r.reason_kind, WASTE_KINDS[r.reason_kind]?.label || r.reason_kind],
    item: r => [r.item_id, r.item_name],
    dish: r => [r.what === 'dish' ? r.dish_id || lower(r.name) : null, r.name],
    person: r => [lower(r.by || '') || '-', r.by || 'Not known'],
    day: r => [String(r.day).slice(0, 10), String(r.day).slice(0, 10)],
    what: r => [r.what, WASTE_WHAT[r.what] || r.what],
  }[by] || (r => [lower(r.reason), r.reason])
  const out = new Map()
  for (const r of rows || []) {
    const [key, label] = keyOf(r)
    if (key == null) continue
    const u = by === 'item' ? r.base_unit : r.unit
    const t = out.get(key) || { key, label, entries: 0, qty: 0, unit: u, mixed: false, value: 0, valued: 0, unvalued: 0 }
    t.entries++
    if (u !== t.unit) t.mixed = true
    t.qty += num(by === 'item' ? r.qty_base : r.qty)
    if (r.value == null) t.unvalued++
    else { t.value += num(r.value); t.valued++ }
    out.set(key, t)
  }
  return [...out.values()].map(t => ({
    key: t.key, label: t.label, entries: t.entries, qty: t.mixed ? null : round4(t.qty), unit: t.mixed ? null : t.unit,
    value: t.valued ? Math.round(t.value * 100) / 100 : null, unvalued: t.unvalued,
  })).sort((a, b) => (num(b.value) - num(a.value)) || (b.entries - a.entries) || String(a.label).localeCompare(String(b.label)))
}

// ── Transfers (phase 4b, migration 309; docs/INVENTORY.md 6.4) ──────────

export const TRANSFER_STATUSES = {
  sent: 'In transit',
  received: 'Received',
  cancelled: 'Cancelled',
}

/** What didn't arrive of a line: sent less received, never below zero (more arriving is the receiver's gain). */
export function lostInTransit(sent, received) {
  if (received == null) return 0
  return round4(Math.max(0, num(sent) - num(received)))
}

/**
 * A transfer line's moves. transfer: { id, number, from_venue_id,
 * to_venue_id, status, sent_at, received_at, cancelled_at, sent_by,
 * received_by, cancelled_by, from_name, to_name }; line: { item_id,
 * qty_base (sent), received_base (null until received), cost_per_base (the
 * sender's average when it was sent) }.
 *   sent       the sender: transfer_out of what was sent, at sent_at
 *   received   the sender: transfer_out of what arrived and lost_in_transit
 *              of the rest, both at sent_at (it all left then, so a count at
 *              the sender in between keeps its figure); the receiver:
 *              transfer_in of what arrived, at received_at
 *   cancelled  the sender: transfer_out at sent_at, and transfer_in of the
 *              same back at cancelled_at (it came back then)
 * Each move { venue_id, item_id, at, kind, qty_base (signed), cost_per_base,
 * source: { type: 'transfer', id, label }, by }.
 */
export function transferLineMoves(t, line) {
  const label = t.number ? 'Transfer ' + t.number : 'Transfer'
  const sent = num(line.qty_base)
  const per = line.cost_per_base == null ? null : num(line.cost_per_base)
  const move = (venue_id, at, kind, qty, words, by) => ({
    venue_id, item_id: line.item_id, at, kind, qty_base: round4(qty), cost_per_base: per,
    source: { type: 'transfer', id: t.id, label: label + ' ' + words }, by: by ?? null,
  })
  const out = []
  const to = t.to_name || 'another venue'
  if (t.status === 'received') {
    const got = num(line.received_base)
    const lost = lostInTransit(sent, got)
    if (sent - lost > 0) out.push(move(t.from_venue_id, t.sent_at, 'transfer_out', -(sent - lost), 'to ' + to, t.sent_by))
    if (lost > 0) out.push(move(t.from_venue_id, t.sent_at, 'lost_in_transit', -lost, 'to ' + to + ': didn\'t arrive', t.received_by))
    if (got > 0) out.push(move(t.to_venue_id, t.received_at, 'transfer_in', got, 'from ' + (t.from_name || 'another venue'), t.received_by))
  } else {
    out.push(move(t.from_venue_id, t.sent_at, 'transfer_out', -sent, 'to ' + to + (t.status === 'sent' ? ' (in transit)' : ''), t.sent_by))
    if (t.status === 'cancelled') out.push(move(t.from_venue_id, t.cancelled_at || t.sent_at, 'transfer_in', sent, 'cancelled: back from transit', t.cancelled_by))
  }
  return out
}
