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

import { applyEvent, checksTouched, eventProblem, CHECK_EVENTS } from './checks.js'
import { permissionProblem } from './permissions.js'
import { jobsForEvent } from './printing.js'
import { businessDate } from './reports.js'

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

      const shape = eventProblem(event)
      if (shape) return refuse(shape, 'invalid')
      const ctx = await store.context()
      if (!ctx.staffById[event.staff_id]) return refuse('Unknown staff member', 'staff')

      const vs = await store.venueState()
      let day = vs.day
      let nextOrderNo = vs.next_order_no || 1
      if (!day) {
        const settings = ctx.settings || {}
        day = await store.openDay({ business_date: businessDate(now, ctx.timezone, settings.day_starts_at), at: now })
        nextOrderNo = Number(settings.order_no_start) || 1
      }
      const assigned = { day_id: day.id }
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
      if (CHECK_EVENTS.includes(event.type)) {
        before = await store.loadChecks(checksTouched(event))
        const r = applyEvent(before, stored, ctx)
        if (!r.ok) return refuse(r.error, r.code)
        changed = r.checks
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
      const seq = (Number(vs.last_seq) || 0) + 1
      stored.seq = seq
      await store.saveEvent(stored)
      if (Object.keys(changed).length) await store.saveChecks(changed, stored)
      if (jobs.length) await store.saveJobs(jobs, stored)
      await store.saveVenueState({ last_seq: seq, next_check_no: nextCheckNo, next_order_no: nextOrderNo })
      if (event.type === 'day.closed') await store.closeDay(day, stored)
      return { ok: true, seq, event: stored, checks: changed, jobs }
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
