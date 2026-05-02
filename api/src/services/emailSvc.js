// src/services/emailSvc.js
//
// Pluggable email delivery service.
//
// Supports five providers, selectable per-venue via venue_email_settings.email_provider:
//   sendgrid  — SendGrid Web API v3 (default, uses SENDGRID_API_KEY env)
//   postmark  — Postmark transactional API (recommended for low-volume + branded click domain)
//   mailgun   — Mailgun API (US or EU region)
//   ses       — AWS SES via @aws-sdk/client-ses (lazy-loaded, same as S3)
//   smtp      — generic SMTP via nodemailer (lazy-loaded)
//
// Usage:
//   const { sendEmail } = await import('./services/emailSvc.js')
//   await sendEmail({
//     provider: 'sendgrid',
//     credentials: { apiKey: '...' },   // per-venue or from env
//     from:    { name: 'Wingstop', email: 'noreply@wingstop.com' },
//     to:      'guest@example.com',
//     replyTo: 'hello@wingstop.com',
//     subject: 'Your booking is confirmed',
//     html:    '<html>...</html>',
//   })
//   → { provider: 'sendgrid', providerId: 'sg_abc123', status: 'sent' }

import { env } from '../config/env.js'

// ── SendGrid ────────────────────────────────────────────────

async function sendViaSendGrid({ credentials, from, to, replyTo, subject, html }) {
  const apiKey = credentials?.apiKey || env.SENDGRID_API_KEY
  if (!apiKey) throw new Error('SendGrid API key not configured')

  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from.email, name: from.name },
    subject,
    content: [{ type: 'text/html', value: html }],
  }
  if (replyTo) body.reply_to = { email: replyTo }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`SendGrid ${res.status}: ${err}`)
  }

  return {
    provider:   'sendgrid',
    providerId: res.headers.get('x-message-id') || null,
    status:     'sent',
  }
}

// ── Postmark ────────────────────────────────────────────────
//
// Postmark uses a single Server Token per "server" (in their UI). Each
// server has one or more message streams — by default `outbound` for
// transactional. We pass `MessageStream` so booking emails always go
// through the transactional stream (better deliverability, separate IP
// pool from broadcast/marketing).
//
// Custom domains: configured via Sender Signatures in the Postmark UI.
// Once a Sender Signature is verified, any From address on that domain
// works. Postmark auto-rotates DKIM and manages return-path.
//
// Branded click domain: configured per-server in Postmark UI as
// "Custom Tracking Domain". Postmark provides a CNAME, you add it to
// your DNS, Postmark provisions the cert. Unlike SendGrid this Just
// Works — no manual cert dance.

async function sendViaPostmark({ credentials, from, to, replyTo, subject, html }) {
  const serverToken  = credentials?.apiKey
  const messageStream = credentials?.stream || 'outbound'
  if (!serverToken) throw new Error('Postmark server token required')

  const body = {
    From:          from.name ? `"${from.name}" <${from.email}>` : from.email,
    To:            to,
    Subject:       subject,
    HtmlBody:      html,
    MessageStream: messageStream,
  }
  if (replyTo) body.ReplyTo = replyTo

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept':                 'application/json',
      'Content-Type':           'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Postmark error shape: { ErrorCode, Message }
    throw new Error(`Postmark ${res.status} (${data.ErrorCode}): ${data.Message || 'unknown error'}`)
  }

  return {
    provider:   'postmark',
    providerId: data.MessageID || null,
    status:     data.ErrorCode === 0 ? 'sent' : 'queued',
  }
}

// ── Mailgun ─────────────────────────────────────────────────

async function sendViaMailgun({ credentials, from, to, replyTo, subject, html }) {
  const apiKey = credentials?.apiKey
  const domain = credentials?.domain
  const region = (credentials?.region || 'us').toLowerCase()
  // EU customers MUST use api.eu.mailgun.net — the US endpoint will silently
  // return 401 on EU keys with no helpful error.
  const apiBase = region === 'eu' ? 'https://api.eu.mailgun.net/v3' : 'https://api.mailgun.net/v3'
  if (!apiKey || !domain) throw new Error('Mailgun API key and domain required')

  const form = new URLSearchParams()
  form.append('from', `${from.name} <${from.email}>`)
  form.append('to', to)
  form.append('subject', subject)
  form.append('html', html)
  if (replyTo) form.append('h:Reply-To', replyTo)

  const res = await fetch(`${apiBase}/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
    },
    body: form,
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Mailgun ${res.status}: ${err}`)
  }

  const data = await res.json().catch(() => ({}))
  return {
    provider:   'mailgun',
    providerId: data.id || null,
    status:     'sent',
  }
}

// ── AWS SES ─────────────────────────────────────────────────

async function sendViaSES({ credentials, from, to, replyTo, subject, html }) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses')
  const client = new SESClient({
    region:      credentials?.region || env.S3_REGION || 'eu-west-1',
    credentials: (credentials?.accessKeyId && credentials?.secretAccessKey) ? {
      accessKeyId:     credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    } : undefined,
  })

  const params = {
    Source:      `${from.name} <${from.email}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body:    { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }
  if (replyTo) params.ReplyToAddresses = [replyTo]

  const result = await client.send(new SendEmailCommand(params))
  return {
    provider:   'ses',
    providerId: result.MessageId || null,
    status:     'sent',
  }
}

// ── SMTP (nodemailer) ───────────────────────────────────────

async function sendViaSMTP({ credentials, from, to, replyTo, subject, html }) {
  const nodemailer = await import('nodemailer')
  const transport  = nodemailer.default.createTransport({
    host:   credentials?.host,
    port:   credentials?.port || 587,
    secure: credentials?.secure ?? true,
    auth: {
      user: credentials?.user,
      pass: credentials?.pass,
    },
  })

  const info = await transport.sendMail({
    from:    `"${from.name}" <${from.email}>`,
    to,
    replyTo: replyTo || undefined,
    subject,
    html,
  })

  return {
    provider:   'smtp',
    providerId: info.messageId || null,
    status:     'sent',
  }
}

// ── Public API ──────────────────────────────────────────────

const PROVIDERS = {
  sendgrid: sendViaSendGrid,
  postmark: sendViaPostmark,
  mailgun:  sendViaMailgun,
  ses:      sendViaSES,
  smtp:     sendViaSMTP,
}

export async function sendEmail({ provider = 'sendgrid', credentials, from, to, replyTo, subject, html }) {
  const fn = PROVIDERS[provider]
  if (!fn) throw new Error(`Unknown email provider: ${provider}`)
  return fn({ credentials, from, to, replyTo, subject, html })
}

// ── Template rendering ──────────────────────────────────────
// Simple mustache-style {{field}} replacer. No logic blocks — just
// string interpolation. Safe for user-authored templates since we
// HTML-escape the values.

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderTemplate(template, fields) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = fields[key]
    return val !== undefined && val !== null ? escapeHtml(String(val)) : ''
  })
}

// Available merge fields for the admin template editor.
export const MERGE_FIELDS = [
  { key: 'guest_name',         label: 'Guest name',         example: 'John Smith' },
  { key: 'guest_email',        label: 'Guest email',        example: 'john@example.com' },
  { key: 'guest_phone',        label: 'Guest phone',        example: '+44 7700 900000' },
  { key: 'venue_name',         label: 'Venue name',         example: 'Wingstop Covent Garden' },
  { key: 'venue_address',      label: 'Venue address',      example: '42 Long Acre, London WC2E 9LG' },
  { key: 'booking_date',       label: 'Booking date',       example: 'Friday 15 May 2026' },
  { key: 'booking_time',       label: 'Start time',         example: '19:30' },
  { key: 'booking_end_time',   label: 'End time',           example: '21:00' },
  { key: 'covers',             label: 'Number of guests',   example: '4' },
  { key: 'table_label',        label: 'Table name',         example: 'T5' },
  { key: 'status',             label: 'Booking status',     example: 'confirmed' },
  { key: 'guest_notes',        label: 'Guest notes',        example: 'Window seat please' },
  { key: 'booking_reference',  label: 'Booking reference',  example: 'WS-A3F2' },
  { key: 'manage_link',        label: 'Manage booking URL', example: 'https://macaroonie.com/manage/abc-123' },
  { key: 'venue_phone',        label: 'Venue phone',        example: '+44 20 7946 0958' },
  { key: 'venue_email',        label: 'Venue email',        example: 'hello@wingstop.com' },
]

// Build the merge fields object from a booking + venue + customer.
export function buildMergeFields({ booking, venue, customer, manageBaseUrl }) {
  const startDate = new Date(booking.starts_at)
  const endDate   = booking.ends_at ? new Date(booking.ends_at) : null

  const dateOpts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  const timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false }

  const ref = `${(venue?.name || 'BK').slice(0, 2).toUpperCase()}-${booking.id.slice(0, 4).toUpperCase()}`

  return {
    guest_name:        customer?.name || booking.guest_name || 'Guest',
    guest_email:       customer?.email || booking.email || '',
    guest_phone:       customer?.phone || booking.phone || '',
    venue_name:        venue?.name || '',
    venue_address:     [venue?.address_line1, venue?.city, venue?.postcode].filter(Boolean).join(', '),
    booking_date:      startDate.toLocaleDateString('en-GB', dateOpts),
    booking_time:      startDate.toLocaleTimeString('en-GB', timeOpts),
    booking_end_time:  endDate ? endDate.toLocaleTimeString('en-GB', timeOpts) : '',
    covers:            String(booking.covers || ''),
    table_label:       booking.table_label || '',
    status:            booking.status || '',
    guest_notes:       booking.guest_notes || '',
    booking_reference: ref,
    manage_link:       `${manageBaseUrl}/manage/${booking.manage_token}`,
    venue_phone:       venue?.phone || '',
    venue_email:       venue?.email || '',
  }
}
