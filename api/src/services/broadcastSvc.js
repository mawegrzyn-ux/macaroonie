// src/services/broadcastSvc.js
// Thin wrapper around ws.broadcast().
// Call after any booking create / update / delete so the timeline
// auto-refreshes without polling.
//
// Import and call from:
//   - routes/bookings.js  (POST /bookings, PATCH status, PATCH move)
//   - routes/payments.js  (webhook: payment_intent.succeeded)

import { broadcast } from '../config/ws.js'

export function broadcastBooking(type, booking) {
  // type: 'booking.created' | 'booking.updated' | 'booking.deleted'
  if (!booking?.venue_id) return
  broadcast(booking.venue_id, { type, data: booking })
}
