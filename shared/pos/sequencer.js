// shared/pos/sequencer.js
//
// Puts a venue's till events in one order. The cloud runs it now
// (api/src/services/posSvc.js, Postgres); the venue hub will run the same
// code over SQLite (docs/POS.md). Each event is:
//   1. looked up by id: an event sent twice gets its first answer again
//   2. checked (shape, staff, permissions, the check rules in checks.js)
//      against the current state, so an event made offline on a check that
//      changed elsewhere is refused with a reason (a conflict for a manager)
//   3. numbered (seq), given the trading day, a check number for a new
//      check and an order number for counter orders
//   4. stored with the checks it changed and the print jobs it makes
//
// The store does the I/O. Every method may be async; `run(venueId, fn)` must
// run fn with the venue locked (one event at a time per venue) and inside
// one transaction:
//   findEvent(id)          -> stored event | null
//   findRejection(id)      -> { error, code } | null
//   context()              -> { staffById, print (printing.js cfg), timezone, settings }
//   venueState()           -> { last_seq, next_check_no, next_order_no, day | null }
//   openDay({ business_date, at }) -> day { id, business_date }
//   loadChecks(ids)        -> { [id]: check }
//   openCheckCount(dayId)  -> number
//   saveEvent(event)       (event has seq and assigned)
//   saveChecks({ [id]: check }, event)
//   saveJobs(jobs, event)
//   saveRejection(event, error, code)
//   saveVenueState({ last_seq, next_check_no, next_order_no })
//   closeDay(day, event)   end the trading day (Z report)
// Kitchen screens (shared/pos/kitchen.js; context().kitchen.enabled when the
// venue has kitchen stations):
//   loadKitchenOrders(ids)               -> { [id]: kitchen order }
//   saveKitchenOrders({ [id]: order }, event)
//   saveKitchenLog(rows, event, orders)  speed of service (bumps, recalls, remakes)
// With a Splitter in the flow in use (migration 183), for events that send
// dishes to the kitchen:
//   loadOpenKitchenOrders()   -> { [id]: kitchen order } (still in the kitchen)
//   loadBalanceTurns()        -> { [boxId]: station id it picked last }
//   saveBalanceTurns({ [boxId]: station id })
// and with a Smart one (share_mode 'speed'), to measure each station's pace:
//   loadRecentKitchenOrders(minutes) -> { [id]: kitchen order } changed in
//                                       the last `minutes` (any status)
// Kitchen events (bump, recall, ...) come from kitchen screens, which nobody
// signs in to: they need no staff member and don't open a trading day.
// Kitchen printers in the flow (kitchenPrint.js, migration 191): after every
// kitchen change the changed orders print what has reached a printer; the
// jobs carry station_id and kitchen_order_id. kitchen.print_due (the minute
// sweep, when a dish's time has come) prints from loadOpenKitchenOrders().
// Card machine payments (shared/pos/cards.js, migration 193): an event that
// puts a card machine payment on a check, or refunds one, names its attempt;
//   loadCardPayment(id)            -> the attempt (pos_card_payments row) | null
//   useCardPayment(id, event)      the attempt is now on a check (used once)
// A store without them (the venue hub, offline) refuses such events: card
// machines need the internet anyway.
// Loyalty rewards (shared/loyalty.js, migration 211): a discount.applied
// that spends a reward names the redemption the server reserved;
//   loadLoyaltyRedemption(id)      -> the redemption (loyalty_redemptions row) | null
//   useLoyaltyRedemption(id, event) the redemption is now on a check (used once)
// Without them the event is refused the same way.

import { applyEvent, checksTouched, eventProblem, CHECK_EVENTS } from './checks.js'
import { permissionProblem } from './permissions.js'
import { jobsForEvent } from './printing.js'
import { businessDate } from './reports.js'
import { cardNeed, cardProblem } from './cards.js'
import { loyaltyNeed, loyaltyProblem } from '../loyalty.js'
import {
  KITCHEN_EVENTS, applyKitchenEvent, kitchenEventProblem, kitchenOrdersTouched,
  kitchenForCheckEvent, kitchenOrdersForCheckEvent, PACE_MINUTES,
} from './kitchen.js'
import { kitchenPrintJobs, hasPrinters } from './kitchenPrint.js'

// Events that can send dishes through a Splitter.
const BALANCE_EVENTS = ['lines.sent', 'course.fired', 'kitchen.order_in']
const hasBalanceBox = k => !!k?.enabled && Object.values(k.stations || {}).some(s => s.kind === 'balance')
const hasSmartBox = k => Object.values(k.stations || {}).some(s => s.kind === 'balance' && s.settings?.share_mode === 'speed')

/**
 * The kitchen config with what a Splitter needs (the open orders, its last
 * picks, and for a Smart one the orders bumped lately), when it can matter.
 * The recent orders go back a while before the pace window, so its first
 * bumps have the bump before them.
 */
async function kitchenWithBalance(store, kitchen, event) {
  if (!hasBalanceBox(kitchen) || !BALANCE_EVENTS.includes(event.type) || !store.loadOpenKitchenOrders) return kitchen
  const recent = hasSmartBox(kitchen) && store.loadRecentKitchenOrders ? await store.loadRecentKitchenOrders(PACE_MINUTES * 2) : null
  return { ...kitchen, balance: { open: await store.loadOpenKitchenOrders(), recent, last: await store.loadBalanceTurns(), picks: {} } }
}

const ORDER_NO_MAX = 999

export function createSequencer(store) {
  async function submit(event, { now = new Date() } = {}) {
    return store.run(event.venue_id, async () => {
      const dup = await store.findEvent(event.id)
      if (dup) return { ok: true, duplicate: true, seq: dup.seq, event: dup, checks: {}, jobs: [] }
      const rej = await store.findRejection(event.id)
      if (rej) return { ok: false, duplicate: true, error: rej.error, code: rej.code }

      const refuse = async (error, code) => {
        await store.saveRejection(event, error, code)
        return { ok: false, error, code }
      }

      const isKitchen = KITCHEN_EVENTS.includes(event?.type)
      const shape = isKitchen ? kitchenEventProblem(event) : eventProblem(event)
      if (shape) return refuse(shape, 'invalid')
      const ctx = await store.context()
      if (!isKitchen && !ctx.staffById[event.staff_id]) return refuse('Unknown staff member', 'staff')
      if (isKitchen && !ctx.kitchen?.enabled) return refuse('Kitchen screens aren\'t set up at this venue', 'kitchen_off')

      const vs = await store.venueState()
      let day = vs.day
      let nextOrderNo = vs.next_order_no || 1
      if (!day && !isKitchen) {
        const settings = ctx.settings || {}
        day = await store.openDay({ business_date: businessDate(now, ctx.timezone, settings.day_starts_at), at: now })
        nextOrderNo = Number(settings.order_no_start) || 1
      }
      const assigned = { day_id: day?.id ?? null }
      let nextCheckNo = vs.next_check_no || 1
      if (event.type === 'check.opened') {
        assigned.number = nextCheckNo++
        if (event.payload?.mode === 'counter') {
          assigned.order_no = nextOrderNo
          nextOrderNo = nextOrderNo >= ORDER_NO_MAX ? 1 : nextOrderNo + 1
        }
      }
      const stored = { ...event, assigned, received_at: now.toISOString() }

      let changed = {}
      let before = {}
      let kitchen = {}
      let kitchenLog = []
      let kcfg = ctx.kitchen
      let kitchenJobs = null
      let card = null
      let reward = null
      if (event.type === 'kitchen.print_due') {
        // Nothing to bump or change: only what a printer is waiting for.
        if (!hasPrinters(ctx.kitchen) || !store.loadOpenKitchenOrders) return { ok: true, nothing: true, checks: {}, jobs: [] }
        const open = await store.loadOpenKitchenOrders()
        const due = kitchenPrintJobs(open, ctx.kitchen, stored.received_at)
        if (!due.jobs.length) return { ok: true, nothing: true, checks: {}, jobs: [] }
        kitchen = Object.fromEntries(due.changed.map(id => [id, open[id]]))
        kitchenJobs = due.jobs
      } else if (isKitchen) {
        const orders = await store.loadKitchenOrders(kitchenOrdersTouched(stored))
        kcfg = await kitchenWithBalance(store, ctx.kitchen, stored)
        const r = applyKitchenEvent(orders, stored, kcfg)
        if (!r.ok) return refuse(r.error, r.code)
        kitchen = r.orders
        kitchenLog = r.log
      } else if (CHECK_EVENTS.includes(event.type)) {
        before = await store.loadChecks(checksTouched(event))
        card = cardNeed(stored, before)
        if (card) {
          if (!store.loadCardPayment) return refuse('Card machine payments need the internet', 'card')
          const why = cardProblem(stored, card, await store.loadCardPayment(card.id))
          if (why) return refuse(why, 'card')
        }
        reward = loyaltyNeed(stored, before)
        if (reward) {
          if (!store.loadLoyaltyRedemption) return refuse('Loyalty rewards need the internet', 'loyalty')
          const why = loyaltyProblem(stored, reward, await store.loadLoyaltyRedemption(reward.id))
          if (why) return refuse(why, 'loyalty')
        }
        const r = applyEvent(before, stored, ctx)
        if (!r.ok) return refuse(r.error, r.code)
        changed = r.checks
        const kitchenIds = ctx.kitchen?.enabled ? kitchenOrdersForCheckEvent(stored) : []
        if (kitchenIds.length) {
          const orders = await store.loadKitchenOrders(kitchenIds)
          kcfg = await kitchenWithBalance(store, ctx.kitchen, stored)
          kitchen = kitchenForCheckEvent(stored, before, changed, orders, kcfg)
        }
      } else if (event.type === 'drawer.opened') {
        const why = permissionProblem(ctx.staffById, event, 'open_drawer')
        if (why) return refuse(why, 'permission')
      } else if (event.type === 'day.closed') {
        const why = permissionProblem(ctx.staffById, event, 'close_day')
        if (why) return refuse(why, 'permission')
        const open = await store.openCheckCount(day.id)
        if (open) return refuse(open === 1 ? 'A check is still open: close it first' : open + ' checks are still open: close them first', 'open_checks')
      }

      const jobs = jobsForEvent(stored, before, changed, ctx.print || {})
      // The kitchen's own printers: what has reached them now.
      if (!kitchenJobs && hasPrinters(kcfg) && Object.keys(kitchen).length) kitchenJobs = kitchenPrintJobs(kitchen, kcfg, stored.received_at).jobs
      if (kitchenJobs) jobs.push(...kitchenJobs)
      const seq = (Number(vs.last_seq) || 0) + 1
      stored.seq = seq
      await store.saveEvent(stored)
      if (Object.keys(changed).length) await store.saveChecks(changed, stored)
      if (card) await store.useCardPayment(card.id, stored)
      if (reward) await store.useLoyaltyRedemption(reward.id, stored)
      if (Object.keys(kitchen).length) await store.saveKitchenOrders(kitchen, stored)
      if (kitchenLog.length) await store.saveKitchenLog(kitchenLog, stored, kitchen)
      if (kcfg?.balance && Object.keys(kcfg.balance.picks).length) await store.saveBalanceTurns(kcfg.balance.picks)
      if (jobs.length) await store.saveJobs(jobs, stored)
      await store.saveVenueState({ last_seq: seq, next_check_no: nextCheckNo, next_order_no: nextOrderNo })
      if (event.type === 'day.closed') await store.closeDay(day, stored)
      return { ok: true, seq, event: stored, checks: changed, jobs, kitchen }
    })
  }

  /** Submit events in order; each gets its own answer. */
  async function submitAll(events, opts) {
    const results = []
    for (const e of events) results.push({ id: e.id, ...(await submit(e, opts)) })
    return results
  }

  return { submit, submitAll }
}
