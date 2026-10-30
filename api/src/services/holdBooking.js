// src/services/holdBooking.js
//
// A booking hold becomes a booking. Shared by the reservations widget's
// free booking (routes/widgetApi.js, POST .../holds/:id/confirm) and a paid
// deposit (services/depositSvc.js, from the widget's confirm or the Stripe
// webhook), so both make the same booking and send the same emails.
//
// bookFromHold() runs inside the caller's transaction, after confirm_hold()
// has passed; afterNewBooking() runs once that transaction has committed.

import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { upsertCustomer } from '../routes/customers.js'
import { notificationQueue } from '../jobs/queues.js'
import { broadcastBooking } from './broadcastSvc.js'

/**
 * The booking for a hold that confirm_hold() passed, and the hold gone.
 * `details` may change the guest's name, email, phone, notes and covers
 * (the widget's confirm sends them again); the hold's are used otherwise.
 */
export async function bookFromHold(tx, h, details = {}) {
  // Holds get a table when they are made; one without is from before that.
  if (!h.table_id) throw httpError(409, 'This hold has no table: please start a new booking')
  const [rules] = await tx`SELECT enable_unconfirmed_flow FROM booking_rules WHERE venue_id = ${h.venue_id}`
  const status = rules?.enable_unconfirmed_flow ? 'unconfirmed' : 'confirmed'
  const [booking] = await tx`
    INSERT INTO bookings
      (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
       guest_name, guest_email, guest_phone, guest_notes, status)
    VALUES
      (${h.venue_id}, ${h.table_id}, ${h.combination_id ?? null}, ${h.tenant_id},
       ${h.starts_at}, ${h.ends_at}, ${details.covers ?? h.covers},
       ${details.name ?? h.guest_name},
       ${details.email || h.guest_email || null},
       ${details.phone ?? h.guest_phone ?? null},
       ${details.notes ?? h.guest_notes ?? null},
       ${status}::booking_status)
    RETURNING *
  `
  await tx`DELETE FROM booking_holds WHERE id = ${h.id} AND tenant_id = ${h.tenant_id}`
  return booking
}

/** The customer record, the confirmation and reminder emails and the timeline, best effort. */
export function afterNewBooking(tenantId, booking) {
  withTenant(tenantId, async tx => {
    const customerId = await upsertCustomer(tx, tenantId, {
      name: booking.guest_name, email: booking.guest_email, phone: booking.guest_phone,
    })
    if (customerId) await tx`UPDATE bookings SET customer_id = ${customerId} WHERE id = ${booking.id} AND tenant_id = ${tenantId}`
  }).catch(() => {})
  notificationQueue.add('booking_email', {
    bookingId: booking.id, tenantId, venueId: booking.venue_id,
    type: 'confirmation', guestEmail: booking.guest_email,
  }).catch(() => {})
  scheduleReminder(tenantId, booking).catch(() => {})
  broadcastBooking('booking.created', booking)
}

/**
 * The reminder email as a delayed job, `reminder_hours_before` hours before
 * the booking (24 when the venue has no email settings). One per booking
 * (jobId), so confirming again doesn't send two.
 */
export async function scheduleReminder(tenantId, booking) {
  const [settings] = await withTenant(tenantId, tx => tx`
    SELECT reminder_enabled, reminder_hours_before
      FROM venue_email_settings
     WHERE venue_id = ${booking.venue_id} AND tenant_id = ${tenantId}
  `)
  if (settings && !settings.reminder_enabled) return
  const hoursBefore = settings?.reminder_hours_before ?? 24
  const reminderAt  = new Date(booking.starts_at).getTime() - hoursBefore * 3600_000
  const delay       = Math.max(reminderAt - Date.now(), 5000)
  await notificationQueue.add('booking_email', {
    bookingId: booking.id, tenantId, venueId: booking.venue_id, type: 'reminder',
  }, {
    delay,
    jobId: `reminder-${booking.id}`,
    removeOnComplete: true,
  })
}

/** What the public widget gets back about its booking (no internal fields). */
export function widgetBooking(booking, extra = {}) {
  return {
    id:           booking.id,
    reference:    booking.id.slice(0, 8).toUpperCase(),
    manage_token: booking.manage_token,
    starts_at:    booking.starts_at,
    covers:       booking.covers,
    guest_name:   booking.guest_name,
    guest_email:  booking.guest_email,
    status:       booking.status,
    ...extra,
  }
}
