// shared/pos/deviceRules.js
//
// What a device may send, before the sequencer decides it: the cloud's
// POST /pos-api/events and /hub/events (api/src/routes/posApi.js) and the
// venue hub's own POST /pos-api/events on the venue network (hub/src/lan.js)
// use this one rule, so an event refused at one is refused at the other.
//
//   - the event belongs to its device whatever it says (venue, device; the
//     cloud's or hub's own fields stripped)
//   - online orders reach the kitchen from the server only
//   - a kiosk is its own "staff member" (shared/kiosk.js) and only sends
//     check events (the kiosk rules in checks.js decide which)
//   - nobody else acts as a kiosk

import { KITCHEN_SERVER_EVENTS } from './kitchen.js'
import { CHECK_EVENTS } from './checks.js'

const STRIP = ['seq', 'assigned', 'received_at', 'hub_printed', 'hub_at']

/**
 * The event as the venue's sequencer should see it, or why not:
 * { event } | { error, code }. device: { id, kind }; venueId: its venue;
 * kioskIds: a Set of the venue's kiosk device ids (null when the event names
 * no staff member, so it isn't needed).
 */
export function deviceEvent(raw, device, venueId, kioskIds = null) {
  const e = { ...raw, venue_id: venueId, device_id: device.id }
  for (const k of STRIP) delete e[k]
  if (KITCHEN_SERVER_EVENTS.includes(e.type)) return { error: 'Not allowed from a device', code: 'invalid' }
  if (device.kind === 'kiosk') {
    e.staff_id = device.id
    if (!CHECK_EVENTS.includes(e.type)) return { error: 'A kiosk can\'t do this', code: 'kiosk' }
    return { event: e }
  }
  if (e.staff_id && kioskIds?.has(e.staff_id)) return { error: 'Only the kiosk itself can do this', code: 'kiosk' }
  return { event: e }
}
