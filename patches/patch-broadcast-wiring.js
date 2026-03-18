// =============================================================
// PATCH 4: Wire broadcastBooking() into existing route files
//
// Add this import to the top of:
//   api/src/routes/bookings.js
//   api/src/routes/payments.js
// =============================================================

import { broadcastBooking } from '../services/broadcastSvc.js'

// =============================================================
// In api/src/routes/bookings.js
// =============================================================

// 1. After POST /bookings confirms a free booking — add after the notificationQueue call:
broadcastBooking('booking.created', booking)

// Full context (after notificationQueue.add):
//
//   await notificationQueue.add('confirmation', { ... })
//   broadcastBooking('booking.created', booking)   // ← ADD THIS
//   return reply.code(201).send(booking)


// 2. After PATCH /:id/status — add before the return:
broadcastBooking('booking.updated', booking)

// Full context:
//
//   if (status === 'cancelled') {
//     await notificationQueue.add('cancellation', { ... })
//   }
//   broadcastBooking('booking.updated', booking)   // ← ADD THIS
//   return booking


// 3. After PATCH /:id/move — add before the return:
broadcastBooking('booking.updated', updated)

// Full context (end of the withTenant block):
//
//   const [updated] = await tx` UPDATE bookings ... RETURNING * `
//   return updated
//
// Then after withTenant resolves:
//
//   const updated = await withTenant(...)
//   broadcastBooking('booking.updated', updated)   // ← ADD THIS
//   return updated


// =============================================================
// In api/src/routes/payments.js — inside handlePaymentSucceeded()
// =============================================================

// After INSERT booking + INSERT payment + DELETE hold — add:
broadcastBooking('booking.created', booking)

// Full context (inside the withTenant block in handlePaymentSucceeded):
//
//   await tx`DELETE FROM booking_holds WHERE id = ${hold_id}`
//   broadcastBooking('booking.created', booking)   // ← ADD THIS
//
//   await notificationQueue.add('confirmation', { ... })
//   await notificationQueue.add('reminder', { ... })
