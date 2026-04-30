// src/jobs/emailWorker.js
//
// BullMQ worker for sending booking emails.
//
// Job data shape:
//   { bookingId, tenantId, venueId, type, manageBaseUrl }
//
// where type is 'confirmation' | 'reminder' | 'modification' | 'cancellation'.
//
// The worker:
//   1. Loads the booking, venue, customer from the DB
//   2. Resolves the email template (venue-specific → tenant default → built-in)
//   3. Resolves the email provider + credentials (venue settings → env fallback)
//   4. Renders merge fields
//   5. Sends via the pluggable emailSvc
//   6. Logs to email_log
//   7. Marks reminder_sent_at (for type='reminder')

import { sql, withTenant } from '../config/db.js'
import { env }             from '../config/env.js'
import { sendEmail, renderTemplate, buildMergeFields } from '../services/emailSvc.js'
import { DEFAULT_TEMPLATES } from '../services/emailTemplateDefaults.js'

export async function processEmailJob(job) {
  const { bookingId, tenantId, venueId, type, manageBaseUrl } = job.data
  if (!bookingId || !tenantId || !type) {
    throw new Error('Email job missing required fields: bookingId, tenantId, type')
  }

  const baseUrl = manageBaseUrl || `${env.PUBLIC_SITE_SCHEME}://${env.PUBLIC_ROOT_DOMAIN}`

  // 1. Load data inside tenant context
  const data = await withTenant(tenantId, async tx => {
    const [booking] = await tx`
      SELECT b.*, t.label AS table_label
        FROM bookings b
        LEFT JOIN tables t ON t.id = b.table_id
       WHERE b.id = ${bookingId}
    `
    if (!booking) return null

    const [venue] = await tx`
      SELECT v.*, wc.phone AS site_phone, wc.email AS site_email,
             wc.address_line1, wc.city, wc.postcode
        FROM venues v
        LEFT JOIN website_config wc ON wc.venue_id = v.id
       WHERE v.id = ${venueId || booking.venue_id}
    `

    const [customer] = booking.customer_id
      ? await tx`SELECT * FROM customers WHERE id = ${booking.customer_id}`
      : [null]

    // 2. Resolve template: venue-specific → tenant default → built-in
    const [tpl] = await tx`
      SELECT * FROM email_templates
       WHERE tenant_id = ${tenantId}
         AND type = ${type}
         AND is_active = true
         AND (venue_id = ${venueId || booking.venue_id} OR venue_id IS NULL)
       ORDER BY venue_id NULLS LAST
       LIMIT 1
    `

    // 3. Resolve email settings
    const [settings] = await tx`
      SELECT * FROM venue_email_settings
       WHERE venue_id = ${venueId || booking.venue_id}
         AND tenant_id = ${tenantId}
    `

    return { booking, venue, customer, tpl, settings }
  })

  if (!data?.booking) {
    job.log(`Booking ${bookingId} not found — skipping`)
    return { status: 'skipped', reason: 'booking_not_found' }
  }

  const { booking, venue, customer, tpl, settings } = data

  // Skip if no email address
  const recipientEmail = customer?.email || booking.email
  if (!recipientEmail || recipientEmail === 'walkin@walkin.com') {
    job.log(`No email for booking ${bookingId} — skipping`)
    return { status: 'skipped', reason: 'no_email' }
  }

  // Skip reminder if already sent
  if (type === 'reminder' && booking.reminder_sent_at) {
    job.log(`Reminder already sent for ${bookingId} — skipping`)
    return { status: 'skipped', reason: 'already_sent' }
  }

  // 4. Render
  const template = tpl
    ? { subject: tpl.subject, body_html: tpl.body_html }
    : DEFAULT_TEMPLATES[type]
  if (!template) throw new Error(`No template for type '${type}'`)

  const venueForFields = {
    name:          venue?.name,
    address_line1: venue?.address_line1 || settings?.from_name,
    city:          venue?.city,
    postcode:      venue?.postcode,
    phone:         venue?.site_phone || settings?.from_email,
    email:         venue?.site_email || settings?.reply_to,
  }

  const fields    = buildMergeFields({ booking, venue: venueForFields, customer, manageBaseUrl: baseUrl })
  const subject   = renderTemplate(template.subject, fields)
  const html      = renderTemplate(template.body_html, fields)
  const provider  = settings?.email_provider || 'sendgrid'

  // Build credentials from venue settings or fall back to env
  const credentials = {}
  if (provider === 'sendgrid') {
    credentials.apiKey = settings?.provider_api_key || env.SENDGRID_API_KEY
  } else if (provider === 'mailgun') {
    credentials.apiKey = settings?.provider_api_key
    credentials.domain = settings?.provider_domain
  } else if (provider === 'ses') {
    credentials.region          = settings?.provider_region || env.S3_REGION
    credentials.accessKeyId     = settings?.provider_api_key
    credentials.secretAccessKey = settings?.provider_domain // reused field
  } else if (provider === 'smtp') {
    credentials.host   = settings?.smtp_host
    credentials.port   = settings?.smtp_port
    credentials.user   = settings?.smtp_user
    credentials.pass   = settings?.smtp_pass
    credentials.secure = settings?.smtp_secure
  }

  const fromName  = settings?.from_name  || venue?.name || 'Macaroonie'
  const fromEmail = settings?.from_email || env.EMAIL_FROM
  const replyTo   = settings?.reply_to   || null

  // 5. Send
  let result
  try {
    result = await sendEmail({
      provider,
      credentials,
      from:    { name: fromName, email: fromEmail },
      to:      recipientEmail,
      replyTo,
      subject,
      html,
    })
  } catch (err) {
    // Log failure + rethrow so BullMQ retries
    await logEmail(tenantId, bookingId, type, recipientEmail, subject, provider, null, 'failed', err.message)
    throw err
  }

  // 6. Log success
  await logEmail(tenantId, bookingId, type, recipientEmail, subject, result.provider, result.providerId, 'sent', null)

  // 7. Mark reminder
  if (type === 'reminder') {
    await withTenant(tenantId, tx => tx`
      UPDATE bookings SET reminder_sent_at = now() WHERE id = ${bookingId}
    `)
  }

  return result
}

async function logEmail(tenantId, bookingId, templateType, recipient, subject, provider, providerId, status, error) {
  try {
    await withTenant(tenantId, tx => tx`
      INSERT INTO email_log
        (tenant_id, booking_id, template_type, recipient, subject,
         provider, provider_id, status, error, sent_at)
      VALUES
        (${tenantId}, ${bookingId}, ${templateType}, ${recipient}, ${subject},
         ${provider}, ${providerId}, ${status}, ${error},
         ${status === 'sent' ? sql`now()` : null})
    `)
  } catch (e) {
    // Best-effort logging — never crash the worker over a log INSERT
    console.error('Failed to write email_log:', e.message)
  }
}
