// src/services/receiptSvc.js
//
// Receipts on the guest's phone (migration 209). After paying on a kiosk the
// order done screen shows a QR code of the order's receipt page, or emails
// the receipt (kiosk design done.receipt_qr / done.receipt_email).
//   kioskReceipt(device, { check_id, email })   the order's receipt page, made
//       once per order, and the email sent (the kiosk waits for it)
//   receiptPage(token)                          the page itself, as HTML, or null
//   cleanUpReceipts(log)                        hourly: receipts after 400 days
//
// The page is drawn from the check as it is now, in the kiosk receipt design
// (services/printDesignSvc.js printLayouts(), shared/pos/printing.js
// billOps()), laid out in the receipt printer's columns
// (shared/pos/ticketHtml.js previewHtml()). An order paid at the counter shows
// as a bill until it is paid. The email address is used to send and never
// stored: only its first letter and domain (emailHint()).

import crypto from 'node:crypto'
import { withTenant, systemSql } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { billOps } from '../../../shared/pos/printing.js'
import { previewHtml, PREVIEW_CSS } from '../../../shared/pos/ticketHtml.js'
import { toText, DEFAULT_COLS } from '../../../shared/pos/tickets.js'
import { isEmail, emailHint } from '../../../shared/kiosk.js'
import { printConfig } from './posSvc.js'
import { sendEmail, emailCredentials } from './emailSvc.js'
import { deviceOrigin } from './platformHost.js'

export const MAX_EMAILS = 3                  // emails per order, so a kiosk can't be used to send mail
export const TOKEN = /^[A-Za-z0-9_-]{32}$/

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const receiptUrl = token => deviceOrigin('kiosk') + '/receipt/' + token

/** The receipt as print operations, and whether it is still a bill (not paid yet). */
async function receiptOps(tx, tenantId, venueId, check) {
  const cfg = await printConfig(tx, tenantId, venueId)
  const preBill = check.status === 'open'
  const ops = billOps(check, cfg, { preBill, layout: cfg.layouts?.kiosk_receipt || null })
  return { ops, preBill, cfg }
}

/**
 * A kiosk asks for the receipt of an order it placed: the receipt's page
 * (made once per order; the same link however often it is asked), and with
 * `email` the receipt sent there. -> { url, sent_to }
 */
export async function kioskReceipt(device, { check_id: checkId, email = null }) {
  const d = device
  const wantMail = email != null
  if (wantMail && !isEmail(email)) throw httpError(400, 'That isn\'t an email address')
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
    if (c.status === 'open') throw httpError(422, 'This order isn\'t paid yet: its receipt can be emailed once it is')
    if (row.emails >= MAX_EMAILS) throw httpError(429, 'This order\'s receipt has been emailed ' + MAX_EMAILS + ' times already')
    // Counted before sending, so a failing address can't be tried for ever.
    await tx`UPDATE pos_receipts SET emails = emails + 1 WHERE id = ${row.id} AND tenant_id = ${d.tenant_id}`
    const { ops, cfg } = await receiptOps(tx, d.tenant_id, d.venue_id, c.state)
    const [settings] = await tx`SELECT * FROM venue_email_settings WHERE venue_id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
    const [venue] = await tx`SELECT name FROM venues WHERE id = ${d.venue_id} AND tenant_id = ${d.tenant_id}`
    return { token: row.token, id: row.id, ops, cfg, settings, venue }
  })
  const url = receiptUrl(prep.token)
  if (!wantMail) return { url, sent_to: null }

  const to = email.trim()
  const venueName = prep.venue?.name || prep.cfg.venue?.name || 'Your order'
  const { provider, credentials } = emailCredentials(prep.settings, env)
  const from = { name: prep.settings?.from_name || venueName, email: prep.settings?.from_email || env.EMAIL_FROM }
  const replyTo = prep.settings?.reply_to || null
  try {
    await sendEmail({ provider, credentials, from, to, replyTo, subject: 'Your receipt from ' + venueName, html: receiptEmail(venueName, prep.ops, url) })
  } catch (err) {
    throw httpError(422, 'The receipt couldn\'t be sent: ' + String(err.message || err).slice(0, 200))
  }
  await withTenant(d.tenant_id, tx => tx`
    UPDATE pos_receipts SET email_hint = ${emailHint(to)}, emailed_at = now() WHERE id = ${prep.id} AND tenant_id = ${d.tenant_id}`)
  return { url, sent_to: emailHint(to) }
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
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">You asked for this receipt on our self-order kiosk. We haven't kept your email address.</p>
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
