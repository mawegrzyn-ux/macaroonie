// src/services/notificationSvc.js
// Loads booking + venue details, renders email, sends via SendGrid.
// Logs result to notification_log.

import { withTenant, sql } from '../config/db.js'
import { env } from '../config/env.js'

const TEMPLATES = {
  confirmation:    'd-xxxxx',   // replace with your SendGrid template IDs
  reminder_24h:    'd-xxxxx',
  reminder_2h:     'd-xxxxx',
  cancellation:    'd-xxxxx',
  no_show_followup:'d-xxxxx',
}

export async function sendNotification({ bookingId, tenantId, type }) {
  // Load booking details
  const [booking] = await withTenant(tenantId, tx => tx`
    SELECT b.*, v.name AS venue_name, v.timezone,
           t.label AS table_label
      FROM bookings b
      JOIN venues v ON v.id = b.venue_id
      JOIN tables t ON t.id = b.table_id
     WHERE b.id = ${bookingId}
  `)
  if (!booking) throw new Error(`Booking ${bookingId} not found`)

  const templateId = TEMPLATES[type]
  if (!templateId || templateId === 'd-xxxxx') {
    console.warn(`No SendGrid template configured for ${type} — skipping send`)
    return
  }

  const payload = {
    to:           booking.guest_email,
    from:         env.EMAIL_FROM,
    templateId,
    dynamicTemplateData: {
      guest_name:   booking.guest_name,
      venue_name:   booking.venue_name,
      reference:    booking.reference,
      starts_at:    booking.starts_at,
      covers:       booking.covers,
      table_label:  booking.table_label,
    },
  }

  let sentAt   = null
  let failedAt = null
  let error    = null

  try {
    if (env.SENDGRID_API_KEY) {
      // Lazy import — only needed when actually sending
      const sgMail = (await import('@sendgrid/mail')).default
      sgMail.setApiKey(env.SENDGRID_API_KEY)
      await sgMail.send(payload)
    }
    sentAt = new Date().toISOString()
  } catch (err) {
    failedAt = new Date().toISOString()
    error    = err.message
    throw err  // re-throw so BullMQ retries
  } finally {
    await withTenant(tenantId, tx => tx`
      INSERT INTO notification_log
        (booking_id, tenant_id, type, recipient_email, sent_at, failed_at, error)
      VALUES
        (${bookingId}, ${tenantId}, ${type}::notification_type,
         ${booking.guest_email}, ${sentAt}, ${failedAt}, ${error})
    `)
  }
}
