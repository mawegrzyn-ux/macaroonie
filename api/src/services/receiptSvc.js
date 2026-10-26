// src/services/receiptSvc.js
//
// Receipts on the guest's phone (migration 209). After ordering on a kiosk the
// order done screen shows a QR code of the order's receipt page, or emails
// the receipt (kiosk design done.receipt_qr / done.receipt_email).
//   kioskReceipt(device, { check_id, email })   the order's receipt page, made
//       once per order, and the email: sent while the kiosk waits when the
//       order is paid, else kept until it is (migration 210)
//   sendWaitingReceipts({ tenantId, venueId })  emails the receipts of orders
//       paid at the counter since the guest asked (after a till's events, and
//       the minute sweep with no venue)
//   receiptPage(token)                          the page itself, as HTML, or null
//   cleanUpReceipts(log)                        hourly: receipts after 400 days
//
// The page is drawn from the check as it is now, in the kiosk receipt design
// (services/printDesignSvc.js printLayouts(), shared/pos/printing.js
// billOps()), laid out in the receipt printer's columns
// (shared/pos/ticketHtml.js previewHtml()). An order paid at the counter shows
// as a bill until it is paid. The email address is used to send and then
// forgotten: an order paid on the kiosk is sent at once and the address never
// stored; an order to pay at the counter keeps it sealed (services/vault.js)
// only until its receipt goes, it is cancelled, or a day passes. What stays is
// its first letter and domain (emailHint()).

import crypto from 'node:crypto'
import { withTenant, systemSql } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { billOps } from '../../../shared/pos/printing.js'
import { isActiveLine } from '../../../shared/pos/pricing.js'
import { previewHtml, PREVIEW_CSS } from '../../../shared/pos/ticketHtml.js'
import { toText, DEFAULT_COLS } from '../../../shared/pos/tickets.js'
import { isEmail, emailHint } from '../../../shared/kiosk.js'
import { printConfig } from './posSvc.js'
import { sendEmail, emailCredentials } from './emailSvc.js'
import { seal, unseal } from './vault.js'
import { deviceOrigin } from './platformHost.js'

export const MAX_EMAILS = 3                  // emails per order, so a kiosk can't be used to send mail
export const TOKEN = /^[A-Za-z0-9_-]{32}$/
export const WAIT_HOURS = 24                 // an address waiting for payment is forgotten after a day
export const MAX_TRIES = 6                   // failed sends of a waiting receipt before it is given up

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const receiptUrl = token => deviceOrigin('kiosk') + '/receipt/' + token

/** The receipt as print operations, and whether it is still a bill (not paid yet). */
async function receiptOps(tx, tenantId, venueId, check) {
  const cfg = await printConfig(tx, tenantId, venueId)
  const preBill = check.status === 'open'
  const ops = billOps(check, cfg, { preBill, layout: cfg.layouts?.kiosk_receipt || null })
  return { ops, preBill, cfg }
}

/** What a receipt email needs, read inside the tenant's transaction: the receipt, the venue's email provider and its name. */
async function mailParts(tx, tenantId, venueId, checkState) {
  const { ops, cfg } = await receiptOps(tx, tenantId, venueId, checkState)
  const [settings] = await tx`SELECT * FROM venue_email_settings WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}`
  const [venue] = await tx`SELECT name FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  return { ops, cfg, settings, venue }
}

/** Sends the receipt email through the venue's provider (never inside a transaction). Throws the provider's error. */
async function sendMail(parts, to, url) {
  const venueName = parts.venue?.name || parts.cfg.venue?.name || 'Your order'
  const { provider, credentials } = emailCredentials(parts.settings, env)
  const from = { name: parts.settings?.from_name || venueName, email: parts.settings?.from_email || env.EMAIL_FROM }
  const replyTo = parts.settings?.reply_to || null
  await sendEmail({ provider, credentials, from, to, replyTo, subject: 'Your receipt from ' + venueName, html: receiptEmail(venueName, parts.ops, url) })
}

/**
 * A kiosk asks for the receipt of an order it placed: the receipt's page
 * (made once per order; the same link however often it is asked), and with
 * `email` the receipt sent there. An order still to pay at the counter keeps
 * the address, sealed, until the till takes payment (sendWaitingReceipts()).
 * -> { url, sent_to } when sent, { url, will_send_to } when it waits
 */
export async function kioskReceipt(device, { check_id: checkId, email = null }) {
  const d = device
  const wantMail = email != null
  if (wantMail && !isEmail(email)) throw httpError(400, 'That isn\'t an email address')
  const to = wantMail ? email.trim() : null
  const prep = await withTenant(d.tenant_id, async tx => {
    const [c] = await tx`
      SELECT id, server_id, status, state FROM pos_checks
       WHERE tenant_id = ${d.tenant_id} AND venue_id = ${d.venue_id} AND id = ${checkId}`
    // A kiosk's orders name the kiosk as their server (shared/kiosk.js kioskStaff()).
    if (!c || c.server_id !== d.id) throw httpError(404, 'This kiosk didn\'t take that order')
    const [row] = await tx`
      INSERT INTO pos_receipts (tenant_id, venue_id, check_id, device_id, token)
      VALUES (${d.tenant_id}, ${d.venue_id}, ${c.id}, ${d.id}, ${crypto.randomBytes(24).toString('base64url')})
      ON CONFLICT (tenant_id, check_id) DO UPDATE SET check_id = EXCLUDED.check_id
      RETURNING id, token, emails`
    if (!wantMail) return { token: row.token }
    if (c.status === 'void') throw httpError(422, 'This order was cancelled, so it has no receipt to email')
    if (row.emails >= MAX_EMAILS) throw httpError(429, 'This order\'s receipt has been emailed ' + MAX_EMAILS + ' times already')
    // Counted before sending, so a failing address can't be tried for ever.
    await tx`UPDATE pos_receipts SET emails = emails + 1 WHERE id = ${row.id} AND tenant_id = ${d.tenant_id}`
    if (c.status === 'open') {
      // Paid at the counter later: the address waits, sealed, and replaces any
      // earlier one for this order. Its tries start again.
      await tx`
        UPDATE pos_receipts
           SET email_to = ${seal(to)}, email_hint = ${emailHint(to)}, email_wanted_at = now(),
               email_claimed_at = NULL, email_tries = 0, email_error = NULL
         WHERE id = ${row.id} AND tenant_id = ${d.tenant_id}`
      return { token: row.token, waiting: true }
    }
    return { token: row.token, id: row.id, parts: await mailParts(tx, d.tenant_id, d.venue_id, c.state) }
  })
  const url = receiptUrl(prep.token)
  if (!wantMail) return { url, sent_to: null }
  if (prep.waiting) return { url, sent_to: null, will_send_to: emailHint(to) }

  try {
    await sendMail(prep.parts, to, url)
  } catch (err) {
    throw httpError(422, 'The receipt couldn\'t be sent: ' + String(err.message || err).slice(0, 200))
  }
  // Sent: an address still waiting for this order (asked for before it was paid) goes.
  await withTenant(d.tenant_id, tx => tx`
    UPDATE pos_receipts SET email_hint = ${emailHint(to)}, emailed_at = now(), email_to = NULL, email_claimed_at = NULL, email_error = NULL
     WHERE id = ${prep.id} AND tenant_id = ${d.tenant_id}`)
  return { url, sent_to: emailHint(to) }
}

/**
 * Receipts waiting for their order to be paid at the counter (migration 210):
 * each one whose check has closed is emailed, then its address forgotten; one
 * whose order was cancelled is forgotten unsent; a failed send is tried again
 * after 2, 4, 6... minutes, up to MAX_TRIES. With no venue (the minute sweep,
 * every tenant in system mode) addresses waiting longer than WAIT_HOURS are
 * forgotten too. A row is taken by one process at a time (email_claimed_at),
 * so two processes never send the same receipt. Never throws. -> number sent
 */
export async function sendWaitingReceipts({ tenantId = null, venueId = null, log } = {}) {
  let sent = 0
  try {
    if (!venueId) {
      await systemSql`
        UPDATE pos_receipts SET email_to = NULL, email_claimed_at = NULL, email_error = 'Not paid within a day'
         WHERE email_to IS NOT NULL AND email_wanted_at < now() - make_interval(hours => ${WAIT_HOURS})`
    }
    const rows = await systemSql`
      UPDATE pos_receipts r SET email_claimed_at = now()
       WHERE r.id IN (
         SELECT w.id FROM pos_receipts w
           JOIN pos_checks c ON c.tenant_id = w.tenant_id AND c.venue_id = w.venue_id AND c.id = w.check_id
          WHERE w.email_to IS NOT NULL AND c.status <> 'open'
            AND (w.email_claimed_at IS NULL OR w.email_claimed_at < now() - make_interval(mins => 2 * GREATEST(w.email_tries, 1)))
            ${tenantId ? systemSql`AND w.tenant_id = ${tenantId}` : systemSql``}
            ${venueId ? systemSql`AND w.venue_id = ${venueId}` : systemSql``}
          ORDER BY w.email_wanted_at
          LIMIT 25
          FOR UPDATE OF w SKIP LOCKED)
      RETURNING r.id, r.tenant_id, r.venue_id, r.check_id, r.token, r.email_to, r.email_tries`
    for (const r of rows) {
      if (await sendWaiting(r, log)) sent++
    }
  } catch (err) {
    log?.warn({ err }, 'Waiting kiosk receipts not sent')
  }
  return sent
}

/** Sends one claimed waiting receipt. -> true when sent */
async function sendWaiting(r, log) {
  const done = fields => withTenant(r.tenant_id, tx => tx`
    UPDATE pos_receipts SET ${tx(fields)} WHERE id = ${r.id} AND tenant_id = ${r.tenant_id}`)
  try {
    const parts = await withTenant(r.tenant_id, async tx => {
      const [c] = await tx`
        SELECT status, state FROM pos_checks WHERE tenant_id = ${r.tenant_id} AND venue_id = ${r.venue_id} AND id = ${r.check_id}`
      // Cancelled, or every dish taken off: there is no receipt to send.
      if (!c || c.status === 'void' || !(c.state?.lines || []).some(isActiveLine)) return null
      return mailParts(tx, r.tenant_id, r.venue_id, c.state)
    })
    if (!parts) {
      await done({ email_to: null, email_claimed_at: null, email_error: 'Order cancelled' })
      return false
    }
    const to = unseal(r.email_to)
    await sendMail(parts, to, receiptUrl(r.token))
    await done({ email_to: null, email_claimed_at: null, email_error: null, emailed_at: new Date(), email_hint: emailHint(to) })
    return true
  } catch (err) {
    const tries = (r.email_tries || 0) + 1
    const why = String(err.message || err).slice(0, 200)
    log?.warn({ err: why, receipt: r.id, tries }, 'Kiosk receipt email failed')
    // email_claimed_at stays: the next try waits 2 minutes per failed try.
    await done(tries >= MAX_TRIES
      ? { email_to: null, email_claimed_at: null, email_tries: tries, email_error: why }
      : { email_tries: tries, email_error: why }).catch(() => {})
    return false
  }
}

/** The receipt email: the receipt as the printer lays it out, and the link to its page. */
export function receiptEmail(venueName, ops, url) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:10px;padding:24px 20px;">
      <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${esc(venueName)}</div>
      <h1 style="font-size:20px;margin:6px 0 16px;">Your receipt</h1>
      <pre style="font-family:ui-monospace,Menlo,Consolas,'Courier New',monospace;font-size:12px;line-height:1.35;white-space:pre;overflow-x:auto;margin:0;color:#111;">${esc(toText(ops, DEFAULT_COLS))}</pre>
      <p style="margin-top:20px;"><a href="${esc(url)}" style="display:inline-block;background:#1f2937;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600;">View it online</a></p>
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">You asked for this receipt on our self-order kiosk. We don't keep your email address once this is sent.</p>
    </div>
  </div></body></html>`
}

/** The receipt page for a token (system mode: the token names its tenant), or null. Counts the view. */
export async function receiptPage(token) {
  if (!TOKEN.test(String(token || ''))) return null
  const [r] = await systemSql`
    SELECT id, tenant_id, venue_id, check_id FROM pos_receipts
     WHERE token = ${token} AND created_at > now() - interval '400 days'`
  if (!r) return null
  return withTenant(r.tenant_id, async tx => {
    const [c] = await tx`SELECT state FROM pos_checks WHERE tenant_id = ${r.tenant_id} AND venue_id = ${r.venue_id} AND id = ${r.check_id}`
    if (!c) return null
    const { ops, preBill, cfg } = await receiptOps(tx, r.tenant_id, r.venue_id, c.state)
    await tx`UPDATE pos_receipts SET views = views + 1, last_viewed_at = now() WHERE id = ${r.id} AND tenant_id = ${r.tenant_id}`
    return pageHtml(cfg.settings?.receipt_name || cfg.venue?.name || 'Receipt', ops, preBill)
  })
}

function pageHtml(venueName, ops, preBill) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Receipt · ${esc(venueName)}</title>
<style>
  body { margin: 0; background: #f4f4f5; color: #111; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 460px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; margin: 4px 0 12px; }
  .paper { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.12); overflow-x: auto; }
  .tk { font-size: min(13px, 3.3vw); }
  ${PREVIEW_CSS}
  .note { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin: 0 0 12px; }
  .bar { margin: 14px 0; }
  button { min-height: 48px; padding: 0 18px; border-radius: 10px; border: 0; background: #111; color: #fff; font-size: 15px; font-weight: 600; }
  .small { color: #6b7280; font-size: 12px; }
  @media print { body { background: #fff; } .wrap { padding: 0; } .bar, .small, .note { display: none; } .paper { box-shadow: none; } }
</style></head><body><div class="wrap">
<h1>${esc(venueName)}</h1>
${preBill ? '<p class="note">Not paid yet. Once it is paid at the counter, this page shows the receipt.</p>' : ''}
<div class="paper"><div class="tk">${previewHtml(ops, DEFAULT_COLS)}</div></div>
<div class="bar"><button type="button" id="print">Print or save as PDF</button></div>
<p class="small">Keep this link to see your receipt again.</p>
</div>
<script>document.getElementById('print').addEventListener('click', function () { window.print() })</script>
</body></html>`
}

/** Hourly (jobs/queues.js): a receipt's page goes after 400 days. */
export async function cleanUpReceipts(log) {
  try {
    const removed = await systemSql`DELETE FROM pos_receipts WHERE created_at < now() - interval '400 days' RETURNING id`
    return { removed: removed.length }
  } catch (err) {
    log?.warn({ err }, 'Receipt clean-up failed')
    return { removed: 0 }
  }
}
