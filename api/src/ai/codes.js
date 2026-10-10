// src/ai/codes.js
//
// How a guest proves a booking is theirs before an AI changes or cancels
// it (migration 148). The AI never sees the booking's manage link:
//
//   1. request_booking_code(reference, email): if a booking matches, a
//      6-digit code goes to that email. The reply is the same whether or
//      not anything matched, so nobody can probe for bookings.
//   2. verify_booking_code(reference, email, code): returns an access key
//      for that one booking, valid ACCESS_MINUTES.
//   3. get_booking / change_booking / cancel_booking take the access key.
//
// Codes and keys are stored only as hashes. A code is good for CODE_MINUTES
// and MAX_ATTEMPTS wrong guesses; at most MAX_CODES_PER_HOUR are sent per
// booking.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { sql, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { sendEmail, emailCredentials } from '../services/emailSvc.js'
import { ToolError } from './context.js'

const CODE_MINUTES       = 15
const ACCESS_MINUTES     = 30
const MAX_ATTEMPTS       = 5
const MAX_CODES_PER_HOUR = 3

export const GENERIC_CODE_REPLY =
  'If a booking with that reference and email exists, a 6-digit code has been emailed to that address. ' +
  'Ask the guest for the code, then call verify_booking_code. The code expires in ' + CODE_MINUTES + ' minutes.'

const hash = s => createHash('sha256').update(s).digest('hex')
const codeHash = (bookingId, code) => hash(bookingId + ':' + code)

export function normaliseReference(ref) {
  return String(ref || '').trim().replace(/^#/, '').toUpperCase()
}

/**
 * The booking a reference + email points to, or null. `tenantId` limits the
 * search to one tenant (the website chat); `guestMcp` limits it to tenants
 * with AI booking switched on.
 */
async function findBooking({ reference, email, tenantId = null, guestMcp = false }) {
  const ref = normaliseReference(reference)
  const mail = String(email || '').trim().toLowerCase()
  if (!/^[0-9A-F]{8}$/.test(ref) || !mail.includes('@')) return null
  const [row] = await sql`
    SELECT b.id, b.tenant_id, b.venue_id, b.guest_name, b.guest_email, b.starts_at
      FROM bookings b
      JOIN tenants t ON t.id = b.tenant_id AND t.is_active = true
      LEFT JOIN ai_settings s ON s.tenant_id = b.tenant_id
     WHERE lower(b.guest_email) = ${mail}
       AND upper(left(b.id::text, 8)) = ${ref}
       AND (${tenantId}::uuid IS NULL OR b.tenant_id = ${tenantId}::uuid)
       AND (${!guestMcp} OR COALESCE(s.guest_mcp_enabled, true))
     ORDER BY b.created_at DESC
     LIMIT 1
  `
  return row ?? null
}

/** Step 1. Always resolves to GENERIC_CODE_REPLY's meaning; returns the
 *  booking it emailed (for the audit log) or null. */
export async function requestCode({ reference, email, tenantId, guestMcp, log }) {
  const booking = await findBooking({ reference, email, tenantId, guestMcp })
  if (!booking) return null

  const [{ n }] = await withTenant(booking.tenant_id, tx => tx`
    SELECT count(*)::int AS n FROM ai_booking_codes
     WHERE booking_id = ${booking.id} AND created_at > now() - interval '1 hour'
  `)
  if (n >= MAX_CODES_PER_HOUR) return booking

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await withTenant(booking.tenant_id, tx => tx`
    INSERT INTO ai_booking_codes (tenant_id, booking_id, code_hash, expires_at)
    VALUES (${booking.tenant_id}, ${booking.id}, ${codeHash(booking.id, code)},
            now() + ${CODE_MINUTES + ' minutes'}::interval)
  `)
  sendCodeEmail(booking, code).catch(err => log?.warn({ err: err?.message }, 'AI booking code email failed'))
  return booking
}

async function sendCodeEmail(booking, code) {
  const { venue, settings } = await withTenant(booking.tenant_id, async tx => {
    const [venue] = await tx`SELECT id, name FROM venues WHERE id = ${booking.venue_id}`
    const [settings] = await tx`
      SELECT * FROM venue_email_settings WHERE venue_id = ${booking.venue_id} AND tenant_id = ${booking.tenant_id}
    `
    return { venue, settings }
  })
  const name = venue?.name || 'the restaurant'
  const subject = 'Your code to change your booking at ' + name
  const html =
    '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">' +
    '<p>Hi ' + escapeHtml(booking.guest_name || '') + ',</p>' +
    '<p>Someone asked an AI assistant to change or cancel your booking at ' + escapeHtml(name) + '. ' +
    'If that was you, give it this code:</p>' +
    '<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">' + code + '</p>' +
    '<p>The code works for ' + CODE_MINUTES + ' minutes. If it wasn\'t you, ignore this email: nothing changes without the code.</p>' +
    '</div>'
  const { provider, credentials } = emailCredentials(settings, env)
  const from = { name: settings?.from_name || name, email: settings?.from_email || env.EMAIL_FROM }
  let result = null
  let error = null
  try {
    result = await sendEmail({ provider, credentials, from, to: booking.guest_email, replyTo: settings?.reply_to || null, subject, html })
  } catch (err) {
    error = err
  }
  await withTenant(booking.tenant_id, tx => tx`
    INSERT INTO email_log (tenant_id, booking_id, template_type, recipient, subject, provider, provider_id, status, error, sent_at)
    VALUES (${booking.tenant_id}, ${booking.id}, 'ai_access_code', ${booking.guest_email}, ${subject},
            ${result?.provider ?? provider}, ${result?.providerId ?? null}, ${error ? 'failed' : 'sent'},
            ${error?.message ?? null}, ${error ? null : new Date()})
  `).catch(() => {})
  if (error) throw error
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Step 2. Returns { accessKey, bookingId, tenantId } or throws ToolError. */
export async function verifyCode({ reference, email, code, tenantId, guestMcp }) {
  const clean = String(code || '').replace(/\s+/g, '')
  const fail = () => new ToolError('That code is wrong or has expired. Ask for a new code with request_booking_code.', 422)
  if (!/^\d{6}$/.test(clean)) throw fail()
  const booking = await findBooking({ reference, email, tenantId, guestMcp })
  if (!booking) throw fail()

  return withTenant(booking.tenant_id, async tx => {
    const [row] = await tx`
      SELECT id, code_hash, attempts FROM ai_booking_codes
       WHERE booking_id = ${booking.id} AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE
    `
    if (!row || row.attempts >= MAX_ATTEMPTS) throw fail()
    const expected = Buffer.from(row.code_hash, 'hex')
    const given    = Buffer.from(codeHash(booking.id, clean), 'hex')
    if (!timingSafeEqual(expected, given)) {
      await tx`UPDATE ai_booking_codes SET attempts = attempts + 1 WHERE id = ${row.id}`
      throw fail()
    }
    await tx`UPDATE ai_booking_codes SET used_at = now() WHERE id = ${row.id}`
    const accessKey = 'bk_' + randomBytes(24).toString('hex')
    await tx`
      INSERT INTO ai_booking_grants (token_hash, tenant_id, booking_id, expires_at)
      VALUES (${hash(accessKey)}, ${booking.tenant_id}, ${booking.id},
              now() + ${ACCESS_MINUTES + ' minutes'}::interval)
    `
    return { accessKey, bookingId: booking.id, tenantId: booking.tenant_id }
  })
}

/** Step 3. The booking id an access key opens, or throws ToolError. */
export async function bookingIdForKey(accessKey, { tenantId = null } = {}) {
  const key = String(accessKey || '').trim()
  const expired = new ToolError('That access key is invalid or has expired. Start again with request_booking_code.', 401)
  if (!key.startsWith('bk_')) throw expired
  const [row] = await sql`
    SELECT booking_id, tenant_id FROM ai_booking_grants
     WHERE token_hash = ${hash(key)} AND expires_at > now()
     LIMIT 1
  `
  if (!row) throw expired
  if (tenantId && row.tenant_id !== tenantId) throw expired
  return row.booking_id
}

export const ACCESS_KEY_MINUTES = ACCESS_MINUTES
