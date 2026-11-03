// shared/pos/orderFlows.js
//
// Order flows (migration 235, Store tech > Order flows): rules that act on
// an order by themselves. ONE implementation for the till, the cloud's
// sequencer, the venue hub, the admin's designer and the API.
//
// Two kinds:
//   ask   a prompt offering a dish or a choice of dishes ("Add a drink?"),
//         shown when a dish is added (trigger dish_added) or at checkout
//         (trigger checkout: before payment starts). No thanks is always
//         there; once per order (or, when a dish is added, every time).
//   add   dishes and charges put on the order by themselves while it
//         matches (trigger match): taken off again when it stops matching
//         (a dish only while it hasn't gone to the kitchen). Each can be
//         one staff may take off (removable), or not (a manager every time).
//
// A flow (normaliseOrderFlow() is the one shape; the API keeps name,
// is_active and sort_order as columns, the rest in pos_order_flows.flow):
//   { id, name, on, kind: 'ask' | 'add', trigger: 'dish_added' | 'checkout' | 'match',
//     venue_ids:  null | [uuid]   every location, or these
//     device_ids: null | [uuid]   every till at them, or these tills
//     apps: ['till']              where it runs (kiosks and online ordering to come)
//     match: {                    what the order needs, all optional: each
//       stream_names, type_ids,   kind given must hold (and), any of its
//       item_ids, section_ids,    entries will do (or). Dishes: the order has
//       not_item_ids,             one of them (dish_added: the dish added is
//       not_section_ids }         one); not_*: the order has none of them
//     ask: { title, message, item_ids (the dishes offered, in order),
//            pick: 'one' | 'several',
//            every_time,          dish_added: ask again for each dish added
//            skip_if_has }        not when the order has one of the dishes offered
//     adds: [{ kind: 'dish', item_id, qty, removable }
//          | { kind: 'charge', charge_id, removable }] }
// Channels are revenue streams, by name: each location has its own streams,
// so "Delivery" means every location's stream called Delivery (any case).
//
// On a check (shared/pos/checks.js): a dish an add flow put on is a line
// with flow { id, key, removable }; a charge carries flow { id, key } and
// optional = removable. check.flows_off remembers, by key, what staff took
// off, so the flow doesn't put it back; check.flows_asked, by flow id, the
// prompts asked. Dishes a flow put on never count towards any flow's dish
// conditions (no flow feeds another, or itself).
//
// Pure: no I/O.

import { isActiveLine } from './pricing.js'

export const FLOW_KINDS = ['ask', 'add']
export const ASK_TRIGGERS = ['dish_added', 'checkout']
export const FLOW_APPS = ['till']
export const ASK_PICKS = ['one', 'several']
export const FLOWS_MAX = 60          // per company
export const FLOW_NAME_MAX = 80
export const ASK_TITLE_MAX = 80
export const ASK_MESSAGE_MAX = 200
export const ASK_CHOICES_MAX = 24
export const FLOW_ADDS_MAX = 8
export const FLOW_ADD_QTY_MAX = 20
export const MATCH_ITEMS_MAX = 100
export const MATCH_SECTIONS_MAX = 40
export const MATCH_LIST_MAX = 40     // streams, order types
export const FLOW_PLACES_MAX = 300   // venues, devices

const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const ids = (v, max) => [...new Set(Array.isArray(v) ? v : [])].filter(isUuid).slice(0, max)
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}

const EMPTY_MATCH = () => ({ stream_names: [], type_ids: [], item_ids: [], section_ids: [], not_item_ids: [], not_section_ids: [] })

/** A channel's name as flows compare it. */
export const channelKey = name => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

function names(v, max) {
  const out = []
  const seen = new Set()
  for (const n of Array.isArray(v) ? v : []) {
    const t = text(n, 60)
    if (!t || seen.has(channelKey(t))) continue
    seen.add(channelKey(t))
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

function normaliseMatch(m) {
  const x = m && typeof m === 'object' ? m : {}
  return {
    stream_names: names(x.stream_names, MATCH_LIST_MAX),
    type_ids: ids(x.type_ids, MATCH_LIST_MAX),
    item_ids: ids(x.item_ids, MATCH_ITEMS_MAX),
    section_ids: ids(x.section_ids, MATCH_SECTIONS_MAX),
    not_item_ids: ids(x.not_item_ids, MATCH_ITEMS_MAX),
    not_section_ids: ids(x.not_section_ids, MATCH_SECTIONS_MAX),
  }
}

function normaliseAsk(a) {
  const x = a && typeof a === 'object' ? a : {}
  return {
    title: text(x.title, ASK_TITLE_MAX),
    message: text(x.message, ASK_MESSAGE_MAX),
    item_ids: ids(x.item_ids, ASK_CHOICES_MAX),
    pick: x.pick === 'several' ? 'several' : 'one',
    every_time: !!x.every_time,
    skip_if_has: x.skip_if_has !== false,
  }
}

function normaliseAdd(a) {
  if (!a || typeof a !== 'object') return null
  const removable = a.removable !== false
  if (a.kind === 'charge') return isUuid(a.charge_id) ? { kind: 'charge', charge_id: a.charge_id, removable } : null
  if (!isUuid(a.item_id)) return null
  return { kind: 'dish', item_id: a.item_id, qty: clampInt(a.qty, 1, FLOW_ADD_QTY_MAX, 1), removable }
}

/**
 * A flow as stored and sent to the tills, or null when it can't be one.
 * Takes the API's row ({ id, name, is_active, sort_order, flow }) or a flow.
 */
export function normaliseOrderFlow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const f = raw.flow && typeof raw.flow === 'object' ? { ...raw.flow, ...raw, flow: undefined } : raw
  if (!isUuid(f.id)) return null
  const kind = f.kind === 'add' ? 'add' : 'ask'
  const trigger = kind === 'add' ? 'match' : ASK_TRIGGERS.includes(f.trigger) ? f.trigger : 'dish_added'
  const apps = [...new Set(Array.isArray(f.apps) ? f.apps : [])].filter(a => FLOW_APPS.includes(a))
  const adds = []
  const seen = new Set()
  for (const a of Array.isArray(f.adds) ? f.adds : []) {
    const x = normaliseAdd(a)
    if (!x) continue
    const k = x.kind + ':' + (x.item_id || x.charge_id)
    if (seen.has(k)) continue
    seen.add(k)
    adds.push(x)
    if (adds.length >= FLOW_ADDS_MAX) break
  }
  return {
    id: f.id,
    name: text(f.name, FLOW_NAME_MAX),
    on: (f.on ?? f.is_active) !== false,
    ...(Number.isFinite(Number(f.sort_order)) ? { sort_order: Number(f.sort_order) } : {}),
    kind,
    trigger,
    venue_ids: f.venue_ids == null ? null : ids(f.venue_ids, FLOW_PLACES_MAX),
    device_ids: f.device_ids == null ? null : ids(f.device_ids, FLOW_PLACES_MAX),
    apps: apps.length ? apps : ['till'],
    match: normaliseMatch(f.match),
    ask: kind === 'ask' ? normaliseAsk(f.ask) : null,
    adds: kind === 'add' ? adds : [],
  }
}

/** The flows on a list (settings.flows or anything else), each as normaliseOrderFlow() leaves it, in their order. */
export function orderFlowList(list) {
  return (Array.isArray(list) ? list : []).map(normaliseOrderFlow).filter(Boolean)
}

/** A new flow's starting point (the designer's New flow). */
export function newOrderFlow(id, kind = 'ask', name = '') {
  return normaliseOrderFlow({
    id, kind, name: name || (kind === 'add' ? 'Add by itself' : 'Suggest a dish'),
    trigger: 'dish_added', venue_ids: null, device_ids: null, apps: ['till'],
    match: EMPTY_MATCH(),
    // No question yet: the designer asks for one (an example question left in
    // would be typed after, or go out to guests unchanged).
    ask: kind === 'ask' ? { title: '', item_ids: [], pick: 'one', skip_if_has: true } : null,
    adds: [],
  })
}

/**
 * What stops a flow being saved: [{ code, message }]. A flow saved with
 * none of these can always run.
 */
export function flowProblems(f) {
  const out = []
  if (!f) return [{ code: 'flow', message: 'This isn\'t a flow' }]
  if (!f.name) out.push({ code: 'name', message: 'Give the flow a name' })
  if (f.device_ids && !f.device_ids.length) out.push({ code: 'devices', message: 'Pick at least one till, or let it run on every till' })
  if (f.venue_ids && !f.venue_ids.length) out.push({ code: 'venues', message: 'Pick at least one location, or let it run everywhere' })
  if (f.kind === 'ask') {
    if (!f.ask?.title) out.push({ code: 'ask_title', message: 'The prompt needs a question, e.g. "Add a drink?"' })
    if (!f.ask?.item_ids?.length) out.push({ code: 'ask_choices', message: 'Pick the dishes the prompt offers' })
  } else if (!f.adds.length) {
    out.push({ code: 'adds', message: 'Pick what the flow adds: a dish or a charge' })
  }
  return out
}

/**
 * Things worth knowing about a flow that don't stop it: [{ code, message }].
 * With what the company has (`channels`: { [channelKey(name)]: [venue id] },
 * the locations with a channel of that name; `tills`: { [device id]: venue id }),
 * it also says when a channel or a till can never match.
 */
export function flowWarnings(f, { channels = null, tills = null } = {}) {
  const out = []
  if (!f) return out
  const m = f.match
  const anyMatch = m.stream_names.length || m.type_ids.length || m.item_ids.length || m.section_ids.length
    || m.not_item_ids.length || m.not_section_ids.length
  if (f.kind === 'add' && !anyMatch) {
    out.push({ code: 'every_order', message: 'With nothing under If, this goes on every order at the tills it runs on' })
  }
  if (f.kind === 'ask' && f.trigger === 'checkout' && !anyMatch && !f.ask?.skip_if_has) {
    out.push({ code: 'every_checkout', message: 'With nothing under If, every order is asked at checkout' })
  }
  if (f.kind === 'ask' && f.trigger === 'dish_added' && !m.item_ids.length && !m.section_ids.length) {
    out.push({
      code: 'every_dish',
      message: f.ask?.every_time
        ? 'With no dish under If, it asks each time any dish is added'
        : 'With no dish under If, the first dish added to an order sets it off',
    })
  }
  if (channels) {
    for (const n of m.stream_names) {
      const at = channels[channelKey(n)] || []
      if (!at.some(v => f.venue_ids == null || f.venue_ids.includes(v))) {
        out.push({ code: 'no_channel', message: 'No location it runs at has a channel called ' + n })
      }
    }
  }
  if (tills && f.device_ids && f.venue_ids) {
    const away = f.device_ids.filter(id => tills[id] && !f.venue_ids.includes(tills[id]))
    if (away.length) {
      out.push({ code: 'tills_elsewhere', message: (away.length === 1 ? 'A till it names is' : away.length + ' tills it names are') + ' at a location it doesn\'t run at' })
    }
  }
  const offered = new Set(f.ask?.item_ids || [])
  if (f.kind === 'ask' && f.trigger === 'dish_added' && m.item_ids.some(id => offered.has(id)) && !f.ask?.skip_if_has) {
    out.push({ code: 'offers_itself', message: 'The prompt offers the dish that sets it off: it may ask again when that dish is added' })
  }
  if (!f.on) out.push({ code: 'off', message: 'This flow is switched off' })
  return out
}

// ── Where it runs ──────────────────────────────────────────────

/**
 * Whether a flow runs here: { venueId, deviceId, app: 'till', streams }
 * (streams: { [revenue stream id]: name }, the channels' names here).
 */
export function flowRunsHere(f, here = {}) {
  if (!f || !f.on) return false
  if (!f.apps.includes(here.app || 'till')) return false
  if (f.venue_ids && !f.venue_ids.includes(here.venueId)) return false
  if (f.device_ids && !f.device_ids.includes(here.deviceId)) return false
  return true
}

/** The flows of a list that run here, in their order. */
export function flowsHere(list, here) {
  return orderFlowList(list).filter(f => flowRunsHere(f, here))
}

// ── The order ──────────────────────────────────────────────────

/**
 * The dishes on an order as flows see them: [{ item_id, section_id }] for
 * each active line and each of a meal deal's parts. Lines a flow put on
 * are left out unless `flowLines`.
 */
export function orderDishes(order, { flowLines = false } = {}) {
  const out = []
  for (const l of order?.lines || []) {
    if (!isActiveLine(l)) continue
    if (l.flow && !flowLines) continue
    out.push({ item_id: l.item_id || null, section_id: l.section_id || null })
    for (const p of l.combo || []) if (p.item_id) out.push({ item_id: p.item_id, section_id: p.section_id || null })
  }
  return out
}

/** A dish added (a line, or a till item) and its meal deal parts, for dish_added. */
export function addedDishes(lineOrItem) {
  if (!lineOrItem) return []
  const out = [{ item_id: lineOrItem.item_id || lineOrItem.id || null, section_id: lineOrItem.section_id || null }]
  for (const p of lineOrItem.combo || []) if (p?.item_id) out.push({ item_id: p.item_id, section_id: p.section_id || null })
  return out
}

const namedBy = (itemIds, sectionIds) => {
  const items = new Set(itemIds || [])
  const sections = new Set(sectionIds || [])
  return d => (!!d.item_id && items.has(d.item_id)) || (!!d.section_id && sections.has(d.section_id))
}

/**
 * Whether an order matches a flow's If. For dish_added, `added` is the dish
 * added (addedDishes()): the flow's dishes name it. Channels are revenue
 * streams by name (streams: { [id]: name }, here.streams), order types the
 * order's.
 */
export function flowMatches(f, order, { added = null, streams = {} } = {}) {
  if (!f || !order) return false
  const m = f.match || EMPTY_MATCH()
  if (m.stream_names.length) {
    const mine = channelKey(streams?.[order.revenue_stream_id])
    if (!mine || !m.stream_names.some(n => channelKey(n) === mine)) return false
  }
  if (m.type_ids.length && !m.type_ids.includes(order.order_type_id)) return false
  const dishes = orderDishes(order)
  if (m.item_ids.length || m.section_ids.length) {
    const named = namedBy(m.item_ids, m.section_ids)
    if (f.kind === 'ask' && f.trigger === 'dish_added') {
      if (!(added || []).some(named)) return false
    } else if (!dishes.some(named)) return false
  }
  if (m.not_item_ids.length || m.not_section_ids.length) {
    const named = namedBy(m.not_item_ids, m.not_section_ids)
    if (dishes.some(named)) return false
  }
  if (f.kind === 'ask' && f.ask?.skip_if_has) {
    const offered = new Set(f.ask.item_ids)
    if (orderDishes(order, { flowLines: true }).some(d => d.item_id && offered.has(d.item_id))) return false
  }
  return true
}

/** Whether a prompt was asked on this order already. */
export const flowAsked = (order, flowId) => !!order?.flows_asked?.[flowId]

/**
 * The prompts to show now, in their order: ask flows of `trigger` that run
 * here, match the order (and the dish added) and weren't asked on it yet
 * (a dish_added one with every_time is asked each time).
 */
export function askFlowsFor(list, order, { trigger, here, added = null } = {}) {
  if (!order || order.status && order.status !== 'open') return []
  return flowsHere(list, here)
    .filter(f => f.kind === 'ask' && f.trigger === trigger)
    .filter(f => !(flowAsked(order, f.id) && !(trigger === 'dish_added' && f.ask.every_time)))
    .filter(f => flowMatches(f, order, { added, streams: here?.streams }))
}

/**
 * The dishes a prompt can offer here, in its order: the ones the till knows
 * (items: { [id]: item }), not sold out (soldOut: { [id]: true }) and on the
 * menus shown now (shownIds: a Set, or null for any).
 */
export function askChoices(f, items = {}, { soldOut = {}, shownIds = null } = {}) {
  return (f?.ask?.item_ids || [])
    .map(id => items[id])
    .filter(it => it && !soldOut[it.id] && (!shownIds || shownIds.has(it.id)))
}

// ── Adding by itself ───────────────────────────────────────────

/** What a flow's add is known by on an order (flows_off, a line's flow.key). */
export const addKey = (flowId, a) => flowId + ':' + a.kind + ':' + (a.kind === 'charge' ? a.charge_id : a.item_id)

/**
 * What add flows want on the order now, in their order: [{ key, flow_id,
 * kind, item_id | charge_id, qty, removable }], leaving out what staff took
 * off (flows_off).
 */
export function flowAddsFor(list, order, here) {
  if (!order || order.status && order.status !== 'open') return []
  const off = order.flows_off || {}
  const out = []
  for (const f of flowsHere(list, here)) {
    if (f.kind !== 'add' || !flowMatches(f, order, { streams: here?.streams })) continue
    for (const a of f.adds) {
      const key = addKey(f.id, a)
      if (off[key]) continue
      out.push({ key, flow_id: f.id, ...a })
    }
  }
  return out
}

/**
 * How to bring an order in line with what its add flows want (flowAddsFor()):
 * { addDishes: [want], removeLines: [line id], addCharges: [want], dropCharges: [charge id] }.
 * A dish comes off only while it hasn't gone to the kitchen; a charge
 * another way put on (the location's matrix, staff) is never doubled or
 * taken off, and one staff took off stays (taken off) until put back.
 */
export function flowSyncPlan(order, wanted = []) {
  const plan = { addDishes: [], removeLines: [], addCharges: [], dropCharges: [] }
  if (!order) return plan
  const keys = new Set(wanted.map(w => w.key))
  const lines = (order.lines || []).filter(l => l.flow && isActiveLine(l))
  const lineKeys = new Set(lines.map(l => l.flow.key))
  const charges = order.charges || []
  const chargeIds = new Set(charges.map(x => x.id))
  for (const w of wanted) {
    if (w.kind === 'dish' && !lineKeys.has(w.key)) plan.addDishes.push(w)
    if (w.kind === 'charge' && !chargeIds.has(w.charge_id)) {
      plan.addCharges.push(w)
      chargeIds.add(w.charge_id)
    }
  }
  const seen = new Set()
  for (const l of lines) {
    // Not wanted any more, or a second one with the same key (two tills
    // acting on the order at once): off while not sent.
    const twice = seen.has(l.flow.key)
    seen.add(l.flow.key)
    if ((!keys.has(l.flow.key) || twice) && l.status === 'new') plan.removeLines.push(l.id)
  }
  // One staff took off stays on the check as taken off (Put back works).
  for (const x of charges) if (x.flow && !x.removed && !keys.has(x.flow.key)) plan.dropCharges.push(x.id)
  return plan
}

/** Whether a sync plan changes anything. */
export const planEmpty = p => !p.addDishes.length && !p.removeLines.length && !p.addCharges.length && !p.dropCharges.length

/**
 * The flow and add a charge put on by a flow names, when the flows say so:
 * the flow (switched on), and its add of this charge with `removable` equal
 * to the charge's optional. The check rules let it go on as optional or not
 * only then; otherwise it is judged as the list has it.
 */
export function flowChargeAdd(list, charge) {
  if (!charge?.flow?.id) return null
  const f = orderFlowList(list).find(x => x.id === charge.flow.id)
  if (!f || !f.on || f.kind !== 'add') return null
  const a = f.adds.find(x => x.kind === 'charge' && x.charge_id === charge.id)
  if (!a || a.removable !== !!charge.optional || addKey(f.id, a) !== charge.flow.key) return null
  return { flow: f, add: a }
}

// ── The company's own ids (the API keeps only those) ───────────

/** Every id a flow names, by kind. */
export function flowIds(f) {
  const m = f?.match || EMPTY_MATCH()
  return {
    items: [...new Set([...m.item_ids, ...m.not_item_ids, ...(f?.ask?.item_ids || []), ...(f?.adds || []).filter(a => a.kind === 'dish').map(a => a.item_id)])],
    sections: [...new Set([...m.section_ids, ...m.not_section_ids])],
    types: [...m.type_ids],
    charges: [...new Set((f?.adds || []).filter(a => a.kind === 'charge').map(a => a.charge_id))],
    venues: [...(f?.venue_ids || [])],
    devices: [...(f?.device_ids || [])],
  }
}

/**
 * A flow naming only ids the company has (own: { items, sections, types,
 * charges, venues, devices }, each a Set): the rest are dropped. Channels are
 * names, kept as they are.
 */
export function ownFlow(f, own = {}) {
  const has = (k, id) => !!own[k]?.has(id)
  const keep = (k, list) => list.filter(id => has(k, id))
  const m = f.match
  return normaliseOrderFlow({
    ...f,
    venue_ids: f.venue_ids == null ? null : keep('venues', f.venue_ids),
    device_ids: f.device_ids == null ? null : keep('devices', f.device_ids),
    match: {
      stream_names: m.stream_names, type_ids: keep('types', m.type_ids),
      item_ids: keep('items', m.item_ids), section_ids: keep('sections', m.section_ids),
      not_item_ids: keep('items', m.not_item_ids), not_section_ids: keep('sections', m.not_section_ids),
    },
    ask: f.ask ? { ...f.ask, item_ids: keep('items', f.ask.item_ids) } : null,
    adds: f.adds.filter(a => (a.kind === 'charge' ? has('charges', a.charge_id) : has('items', a.item_id))),
  })
}

// ── In words (the designer, the list) ──────────────────────────

/** "A", "A or B", "A, B or C". */
export function orList(words, joiner = 'or') {
  const w = words.filter(Boolean)
  if (w.length <= 1) return w[0] || ''
  return w.slice(0, -1).join(', ') + ' ' + joiner + ' ' + w[w.length - 1]
}

const nameOf = (names, kind, id, gone) => names?.[kind]?.[id] || gone

/** The dishes and sections a condition names, in words: "Coke or a dish from Drinks". */
export function dishesText(itemIds = [], sectionIds = [], names = {}, joiner = 'or') {
  return orList([
    ...itemIds.map(id => nameOf(names, 'items', id, 'a dish no longer on the menu')),
    ...sectionIds.map(id => 'a dish from ' + nameOf(names, 'sections', id, 'a section no longer on the menu')),
  ], joiner)
}

/** When a flow acts, in words. */
export function flowWhenText(f) {
  if (f.kind === 'add') return 'As soon as the order matches'
  return f.trigger === 'checkout' ? 'At checkout, before payment' : 'When a dish is added'
}

/** A flow's If, as lines in words ([] = every order). */
export function flowIfLines(f, names = {}) {
  const m = f.match
  const out = []
  if (m.stream_names.length) out.push('The channel is ' + orList(m.stream_names))
  if (m.type_ids.length) out.push('The order type is ' + orList(m.type_ids.map(id => nameOf(names, 'types', id, 'an order type no longer there'))))
  if (m.item_ids.length || m.section_ids.length) {
    const what = dishesText(m.item_ids, m.section_ids, names)
    out.push(f.kind === 'ask' && f.trigger === 'dish_added' ? 'The dish added is ' + what : 'The order has ' + what)
  }
  if (m.not_item_ids.length || m.not_section_ids.length) out.push('Not when the order has ' + dishesText(m.not_item_ids, m.not_section_ids, names))
  if (f.kind === 'ask' && f.ask?.skip_if_has) out.push('Not when the order has one of the dishes offered')
  return out
}

/** A flow's Then, as lines in words. */
export function flowThenLines(f, names = {}) {
  if (f.kind === 'ask') {
    const a = f.ask
    const dishes = a.item_ids.map(id => nameOf(names, 'items', id, 'a dish no longer on the menu'))
    return [
      'Ask "' + (a.title || '…') + '"',
      dishes.length ? 'Offer ' + orList(dishes) + (a.pick === 'several' ? ' (any of them)' : dishes.length > 1 ? ' (one of them)' : '') : 'No dishes picked yet',
    ]
  }
  if (!f.adds.length) return ['Nothing picked yet']
  return f.adds.map(a => {
    const name = a.kind === 'charge'
      ? nameOf(names, 'charges', a.charge_id, 'a charge no longer on the list')
      : (a.qty > 1 ? a.qty + ' x ' : '') + nameOf(names, 'items', a.item_id, 'a dish no longer on the menu')
    return 'Add ' + name + (a.removable ? '' : ' (can\'t be taken off)')
  })
}

/** Where a flow runs, in words: "Every location · every till". */
export function flowWhereText(f, names = {}) {
  const places = f.venue_ids == null ? 'Every location' : f.venue_ids.length
    ? orList(f.venue_ids.map(id => nameOf(names, 'venues', id, 'a location no longer there')), 'and')
    : 'No location'
  const tills = f.device_ids == null ? 'every till' : f.device_ids.length
    ? orList(f.device_ids.map(id => nameOf(names, 'devices', id, 'a till no longer there')), 'and')
    : 'no till'
  return places + ' · ' + tills
}

/** One line for the list: "When a dish is added: Ask "Add a drink?"". */
export function flowSummary(f, names = {}) {
  const ifs = flowIfLines(f, names)
  return flowWhenText(f) + (ifs.length ? ', if ' + ifs.map(s => s[0].toLowerCase() + s.slice(1)).join(' and ') : '') + ': '
    + flowThenLines(f, names).join(', ')
}
