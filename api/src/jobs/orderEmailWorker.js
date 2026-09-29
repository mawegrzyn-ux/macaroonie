// src/jobs/orderEmailWorker.js
//
// Web ordering emails (migration 122), sent through the same per-venue
// email provider as booking emails. Job data: { orderId, tenantId, type }
// where type is:
//   order_confirmation  the order is placed: receipt with a VAT breakdown
//   order_ready         ready to collect
//   order_cancelled     rejected or cancelled (says if money is coming back)
//
// Built-in templates only for now (not editable on the Emails page).

import { withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { sendEmail, emailCredentials } from '../services/emailSvc.js'
import { guestManageOrigin } from './emailWorker.js'
import { formatPence } from '../../../shared/orderPricing.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function when(order, tz) {
  const d = new Date(order.promised_at)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { day, time }
}

function itemsTable(order, items, promotions = []) {
  const money = p => formatPence(p, order.currency)
  const rows = items.map(i => {
    const opts = (i.options || []).map(o => esc(o.label)).join(', ')
    return `<tr>
      <td style="padding:6px 0;vertical-align:top;">${i.qty} &times; ${esc(i.name)}${opts ? `<div style="color:#6b7280;font-size:13px;">${opts}</div>` : ''}${i.note ? `<div style="color:#6b7280;font-size:13px;">Note: ${esc(i.note)}</div>` : ''}</td>
      <td style="padding:6px 0;text-align:right;vertical-align:top;white-space:nowrap;">${money(i.line_total_pence)}</td>
    </tr>`
  }).join('')
  const vatByRate = {}
  for (const i of items) {
    const r = Number(i.vat_rate)
    if (r > 0) vatByRate[r] = (vatByRate[r] || 0) + i.vat_pence
  }
  const vatRows = Object.entries(vatByRate).map(([r, v]) =>
    `<tr><td style="color:#6b7280;font-size:13px;">Includes VAT at ${Number(r)}%</td><td style="color:#6b7280;font-size:13px;text-align:right;">${money(v)}</td></tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;font-size:15px;">
    ${rows}
    <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:8px;"></td></tr>
    <tr><td>Subtotal</td><td style="text-align:right;">${money(order.subtotal_pence)}</td></tr>
    ${promotions.map(p => `<tr><td style="color:#047857;">${esc(p.name)}${p.code ? ` (${esc(p.code)})` : ''}</td><td style="color:#047857;text-align:right;">-${money(p.discount_pence)}</td></tr>`).join('')}
    ${order.tip_pence ? `<tr><td>Tip</td><td style="text-align:right;">${money(order.tip_pence)}</td></tr>` : ''}
    <tr><td style="font-weight:700;">Total</td><td style="text-align:right;font-weight:700;">${money(order.total_pence)}</td></tr>
    ${vatRows}
  </table>`
}

function layout({ venueName, heading, body, statusUrl }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:10px;padding:28px 24px;">
      <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${esc(venueName)}</div>
      <h1 style="font-size:22px;margin:6px 0 16px;">${heading}</h1>
      ${body}
      ${statusUrl ? `<p style="margin-top:24px;"><a href="${esc(statusUrl)}" style="display:inline-block;background:#1f2937;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">View your order</a></p>` : ''}
    </div>
  </div></body></html>`
}

function render(type, { order, items, promotions, venue, settings, statusUrl }) {
  const tz = venue.timezone
  const { day, time } = when(order, tz)
  const num = `#${order.order_number}`
  const payLine = order.payment_status === 'paid'
    ? 'Paid online.'
    : order.payment_method === 'pay_at_venue' ? 'Please pay when you collect.' : ''
  if (type === 'order_confirmation') {
    const body = `
      <p>Thanks ${esc(order.guest_name)}, we have your order.</p>
      <p style="font-size:17px;"><strong>Collect ${order.is_asap ? 'from' : 'at'} ${time}</strong>, ${esc(day)}.</p>
      ${settings?.collection_instructions ? `<p style="color:#4b5563;">${esc(settings.collection_instructions)}</p>` : ''}
      ${itemsTable(order, items, promotions)}
      ${payLine ? `<p style="color:#4b5563;">${payLine}</p>` : ''}
      ${order.allergy_note ? `<p style="color:#4b5563;">Allergy note: ${esc(order.allergy_note)}</p>` : ''}
      ${settings?.confirmation_note ? `<p style="color:#4b5563;">${esc(settings.confirmation_note)}</p>` : ''}`
    return { subject: `Order ${num} confirmed – ${venue.name}`, html: layout({ venueName: venue.name, heading: `Order ${num} confirmed`, body, statusUrl }) }
  }
  if (type === 'order_ready') {
    const body = `
      <p>${esc(order.guest_name)}, your order is ready to collect.</p>
      ${settings?.collection_instructions ? `<p style="color:#4b5563;">${esc(settings.collection_instructions)}</p>` : ''}
      ${order.payment_status !== 'paid' && order.payment_method === 'pay_at_venue' ? '<p>Please pay when you collect.</p>' : ''}`
    return { subject: `Order ${num} is ready – ${venue.name}`, html: layout({ venueName: venue.name, heading: `Order ${num} is ready`, body, statusUrl }) }
  }
  if (type === 'order_cancelled') {
    const refunded = order.refunded_pence > 0
      ? `<p>We have refunded ${formatPence(order.refunded_pence, order.currency)}. It can take a few days to reach your account.</p>` : ''
    const body = `
      <p>Sorry ${esc(order.guest_name)}, we can't make your order this time.</p>
      ${order.cancel_reason ? `<p style="color:#4b5563;">${esc(order.cancel_reason)}</p>` : ''}
      ${refunded}`
    return { subject: `Order ${num} cancelled – ${venue.name}`, html: layout({ venueName: venue.name, heading: `Order ${num} cancelled`, body, statusUrl }) }
  }
  throw new Error(`Unknown order email type '${type}'`)
}

export async function processOrderEmailJob({ data, log }) {
  const { orderId, tenantId, type } = data
  const ctx = await withTenant(tenantId, async tx => {
    const [order] = await tx`SELECT * FROM orders WHERE id = ${orderId}`
    if (!order) return null
    const items = await tx`SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY sort_order`
    const promotions = await tx`SELECT name, code, discount_pence FROM order_promotions WHERE order_id = ${orderId} ORDER BY created_at, name`
    const [venue] = await tx`SELECT id, name, timezone FROM venues WHERE id = ${order.venue_id}`
    const [settings] = await tx`SELECT * FROM venue_email_settings WHERE venue_id = ${order.venue_id} AND tenant_id = ${tenantId}`
    const [ordering] = await tx`SELECT collection_instructions, confirmation_note FROM ordering_settings WHERE venue_id = ${order.venue_id}`
    const [site] = await tx`SELECT subdomain_slug, custom_domain, custom_domain_verified FROM tenant_site WHERE tenant_id = ${tenantId} LIMIT 1`
    return { order, items, promotions, venue, settings, ordering, site }
  })
  if (!ctx?.order?.guest_email) return { status: 'skipped' }

  const { order, items, promotions, venue, settings, ordering, site } = ctx
  const statusUrl = `${guestManageOrigin(site)}/order/status/${order.public_token}`
  const { subject, html } = render(type, { order, items, promotions, venue, settings: ordering, statusUrl })
  const { provider, credentials } = emailCredentials(settings, env)
  const from = { name: settings?.from_name || venue.name || 'Macaroonie', email: settings?.from_email || env.EMAIL_FROM }

  let result
  let error = null
  try {
    result = await sendEmail({ provider, credentials, from, to: order.guest_email, replyTo: settings?.reply_to || null, subject, html })
  } catch (err) {
    error = err
  }
  await withTenant(tenantId, tx => tx`
    INSERT INTO email_log (tenant_id, order_id, template_type, recipient, subject, provider, provider_id, status, error, sent_at)
    VALUES (${tenantId}, ${orderId}, ${type}, ${order.guest_email}, ${subject}, ${result?.provider ?? provider},
            ${result?.providerId ?? null}, ${error ? 'failed' : 'sent'}, ${error?.message ?? null},
            ${error ? null : new Date()})
  `).catch(e => log?.(`email_log insert failed: ${e.message}`))
  if (error) throw error
  return result
}

// Exposed for tests and the admin preview.
export { render as renderOrderEmail }
