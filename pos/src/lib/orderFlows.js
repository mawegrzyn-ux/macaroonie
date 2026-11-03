// pos/src/lib/orderFlows.js
//
// Order flows on the till (migration 235; the rules are
// shared/pos/orderFlows.js, Store tech > Order flows): the venue's flows come
// in settings.flows; each till keeps the ones that run here.
//
//   Prompts (kind ask): a dish added, or checkout (before payment starts),
//   queues the prompts due for the check; the check screen shows them one
//   after another (components/FlowPrompt.jsx) and records each one asked
//   (check.flow_asked), so it isn't asked again on the order.
//   Things added by themselves (kind add): whenever an open check changes on
//   this till's screen, syncFlows() puts on what the flows want and takes off
//   what they don't any more (a dish only until it is sent). They follow the
//   order (orderOrigin()): the flows of the till that opened it, or of the
//   kiosk a kiosk order came from, whichever till shows it.

import { useSyncExternalStore } from 'react'
import { askFlowsFor, askChoices, flowAddsFor, flowSyncPlan, planEmpty, addedDishes, orderFlowList, orderOrigin } from '@shared/pos/orderFlows.js'
import { MANAGER_ALWAYS } from '@shared/pos/permissions.js'
import { getState, dispatch, currentChecks, toast } from './store.js'
import { addItem, listCharges, listCharge, tillItem, needsChoices } from './checkOps.js'

/** Where this till is, as flows see it: { venueId, deviceId, app, streams }. */
export function flowPlace(config, device = getState().device) {
  return {
    venueId: config?.venue?.id || null,
    deviceId: device?.id || null,
    app: 'till',
    streams: Object.fromEntries((config?.revenue_streams || []).map(s => [s.id, s.name])),
  }
}

/** The flows of the venue's settings, as normaliseOrderFlow() leaves them. */
export const tillFlows = config => orderFlowList(config?.settings?.flows)

// ── The prompts waiting, per check ─────────────────────────────

let queue = []        // [{ id, checkId, flow, then }]
const listeners = new Set()
const emit = () => listeners.forEach(fn => fn())
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }

/** The prompts waiting for a check (the first one shows). */
export function useFlowPrompts(checkId) {
  const all = useSyncExternalStore(subscribe, () => queue)
  return all.filter(p => p.checkId === checkId)
}

/** A prompt's dishes the till can offer now (known, not sold out, on the menus shown). */
export function promptChoices(config, flow, shownIds = null) {
  return askChoices(flow, config?.items || {}, { soldOut: config?.sold_out || {}, shownIds })
}

/**
 * Queue the prompts due on a check: trigger 'dish_added' (added: the dish,
 * or the line, as addedDishes() takes it) or 'checkout' (then: what happens
 * once they are answered, e.g. open Pay). Prompts with no dish the till can
 * offer are left out. Returns how many were queued.
 */
export function queueFlowPrompts(checkId, trigger, { added = null, then = null, shownIds = null } = {}) {
  const { config } = getState()
  const check = currentChecks()[checkId]
  if (!check) return 0
  const waiting = new Set(queue.filter(p => p.checkId === checkId).map(p => p.flow.id))
  const due = askFlowsFor(config?.settings?.flows, check, {
    trigger, here: flowPlace(config), added: added ? addedDishes(added) : null,
  }).filter(f => !waiting.has(f.id) && promptChoices(config, f, shownIds).length)
  if (!due.length) return 0
  queue = [...queue, ...due.map((flow, i) => ({ id: checkId + ':' + flow.id + ':' + Date.now() + ':' + i, checkId, flow, then: i === due.length - 1 ? then : null }))]
  emit()
  return due.length
}

/**
 * The first prompt of a check answered: recorded on the check, taken off the
 * queue. Returns what was to happen after it (the last one's then), or null.
 */
export function answerFlowPrompt(prompt, { answer, itemIds = [] }) {
  dispatch('check.flow_asked', { flow_id: prompt.flow.id, answer, item_ids: itemIds.slice(0, 24) }, { check_id: prompt.checkId })
  queue = queue.filter(p => p.id !== prompt.id)
  // The rest of the check's prompts carry the then on when this one had it.
  const rest = queue.filter(p => p.checkId === prompt.checkId)
  if (prompt.then && rest.length) {
    queue = queue.map(p => (p.id === rest[rest.length - 1].id ? { ...p, then: prompt.then } : p))
    emit()
    return null
  }
  emit()
  return prompt.then
}

/** Drop a check's prompts (its screen left, or the check closed). */
export function dropFlowPrompts(checkId) {
  if (!queue.some(p => p.checkId === checkId)) return
  queue = queue.filter(p => p.checkId !== checkId)
  emit()
}

// ── Adding by itself ───────────────────────────────────────────

// Dishes that couldn't go on (one that needs choices, one the till doesn't
// know): not tried again on that check, so a sync never loops.
const failed = new Set()

/**
 * Bring an open check in line with its add flows: the dishes and charges
 * they want on (marked with the flow, removable or not), what they don't
 * want any more off. Returns the number of changes made.
 */
export function syncFlows(checkId) {
  const { config } = getState()
  const flows = config?.settings?.flows
  if (!flows?.length) return 0
  const check = currentChecks()[checkId]
  if (!check || check.status !== 'open') return 0
  // Where the order was taken: a check another till opened keeps that
  // till's flows, a kiosk order the kiosk's.
  const place = flowPlace(config)
  const here = { ...place, ...orderOrigin(check, config?.devices, { app: 'till', deviceId: place.deviceId }) }
  const wanted = flowAddsFor(flows, check, here)
  const plan = flowSyncPlan(check, wanted)
  if (planEmpty(plan)) return 0
  const names = Object.fromEntries(tillFlows(config).map(f => [f.id, f.name]))
  let changes = 0
  for (const id of plan.removeLines) {
    const line = check.lines.find(l => l.id === id)
    const r = dispatch('line.deleted', { line_id: id, by_flow: true }, { check_id: checkId })
    if (r.ok) { changes++; toast((line ? line.name : 'A dish') + ' came off: ' + (names[line?.flow?.id] || 'its flow') + ' no longer applies', 'info') }
  }
  for (const id of plan.dropCharges) {
    const x = (check.charges || []).find(y => y.id === id)
    const r = dispatch('charge.removed', { charge_id: id, by_flow: true }, { check_id: checkId })
    if (r.ok) { changes++; toast((x?.name || 'A charge') + ' came off: ' + (names[x?.flow?.id] || 'its flow') + ' no longer applies', 'info') }
  }
  for (const w of plan.addDishes) {
    const tag = checkId + '|' + w.key
    if (failed.has(tag)) continue
    const it = config?.items?.[w.item_id]
    if (!it || needsChoices(config, it)) { failed.add(tag); continue }
    const now = currentChecks()[checkId]
    if (!now) break
    const r = addItem(now, tillItem(config, w.item_id), {}, { qty: w.qty, flow: { id: w.flow_id, key: w.key, removable: w.removable } })
    if (r.ok) { changes++; toast((w.qty > 1 ? w.qty + ' x ' : '') + it.name + ' added by ' + (names[w.flow_id] || 'an order flow'), 'info') }
    else failed.add(tag)
  }
  for (const w of plan.addCharges) {
    const tag = checkId + '|' + w.key
    if (failed.has(tag)) continue
    const x = listCharges(config).find(y => y.id === w.charge_id)
    if (!x) { failed.add(tag); continue }
    const r = dispatch('charge.added', {
      charge: { ...listCharge(config, x), optional: w.removable, flow: { id: w.flow_id, key: w.key } },
    }, { check_id: checkId })
    if (r.ok) { changes++; toast(x.name + ' added by ' + (names[w.flow_id] || 'an order flow'), 'info') }
    else failed.add(tag)
  }
  return changes
}

/** The flow that put a line or charge on, by name ("Added by Bag charge"), or null. */
export function flowNameOf(config, mark) {
  if (!mark?.id) return null
  return tillFlows(config).find(f => f.id === mark.id)?.name || 'an order flow'
}

// What dish_added prompts get from a dish add: the dish (with a combo's parts).
export const addedOf = (item, r) => {
  const e = (r?.events || []).find(x => x.type === 'line.added')
  return e ? e.payload.line : { item_id: item?.id, section_id: item?.section_id }
}

/** Whether a line is a dish an order flow put on that staff may not take off. */
export const fixedFlowLine = line => !!(line?.flow && line.flow.removable === false)

/**
 * What taking a line off (or fewer of it) asks of useApproval(): the venue's
 * switches, plus a manager every time for a dish a flow put on as one staff
 * can't take off. Returns [label, actions].
 */
export function offApproval(line, label, actions) {
  if (!fixedFlowLine(line)) return [label, actions]
  return [line.name + ' was put on by an order flow: taking it off needs a manager.', [...actions, MANAGER_ALWAYS]]
}

/** The dishes on the menus shown now (a prompt offers only those), as a Set. */
export const shownItemIds = shown => new Set((shown || []).flatMap(m => (m.sections || []).flatMap(s => s.item_ids || [])))
