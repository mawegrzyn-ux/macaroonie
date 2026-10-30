// src/services/depositSvc.js
//
// Booking deposits (migration 220), paid by the guest in the reservations
// widget with Stripe's payment form, on the group's own Stripe account
// (Stripe Connect, services/stripeConnect.js: the platform's key with the
// group's account in the Stripe-Account header). No platform fee is taken
// on deposits.
//
//   1. The widget holds the table (POST /widget-api/venues/:id/holds), then
//      startDeposit() makes a PaymentIntent for the venue's deposit rule
//      (deposit_rules: fixed or per guest) and gives the hold at least
//      DEPOSIT_HOLD_SECS to be paid in. Payment methods that leave the page
//      are off (allow_redirects never), so the widget never navigates away;
//      3D Secure opens over it.
//   2. The guest pays; the widget asks the server to confirm. The server
//      reads the PaymentIntent back from Stripe (never the browser's word)
//      and settleDeposit() turns the hold into the booking with its
//      payments row. The Connect webhook (payment_intent.succeeded with
//      metadata.kind 'deposit') does the same, for a guest who closed the
//      tab; whichever comes first books it, the other finds the payment.
//   3. A paid hold that can't be booked any more (gone, or its table taken
//      after it ran out) is refunded straight away.
//
// Refunds go through refundDeposit(): staff (POST /api/payments/:id/refund)
// and a guest cancelling on the manage page more than the venue's
// refund_hours_before ahead (cancelBooking() in guestBookingSvc.js).

import { randomUUID } from 'node:crypto'
import { withTenant, systemSql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { providerMessage } from './cardMachines/http.js'
import { stripeCall, platformKeys, paymentContext } from './stripeConnect.js'
import { bookFromHold, afterNewBooking, widgetBooking } from './holdBooking.js'

/** How long a hold waits for its deposit once the payment form is shown. */
export const DEPOSIT_HOLD_SECS = 900

// A PaymentIntent the guest can still pay.
const PAYABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action'])

/** The deposit, in pence, a venue's rule asks of a party of `covers` (0 = none). */
export function depositFor(rule, covers) {
  if (!rule?.requires_deposit) return 0
  const each = Math.round(Number(rule.deposit_amount) * 100)
  if (!(each > 0)) return 0
  return rule.deposit_type === 'per_cover' ? each * Math.max(1, Math.trunc(covers) || 1) : each
}

/** What guests see about a venue's deposit: { required, online, type, amount_pence, currency, refund_hours_before }. */
export function depositPublic(rule, online) {
  const required = !!rule?.requires_deposit && Number(rule.deposit_amount) > 0
  return {
    required,
    online:   required && !!online,
    type:     required ? rule.deposit_type : null,
    amount_pence: required ? Math.round(Number(rule.deposit_amount) * 100) : null,
    currency: rule?.currency || 'GBP',
    refund_hours_before: required ? (rule.refund_hours_before ?? null) : null,
  }
}

/** Whether the group's Stripe account can take deposits now. */
export async function depositsOnline(tenantId) {
  return (await paymentContext(tenantId)).tenant.stripe_ready
}

export async function loadDepositRule(tx, tenantId, venueId) {
  const [rule] = await tx`
    SELECT requires_deposit, deposit_type, deposit_amount, currency, refund_hours_before
      FROM deposit_rules WHERE venue_id = ${venueId} AND tenant_id = ${tenantId}
  `
  return rule || null
}

/** "£12.50" */
export function money(pence, currency = 'GBP') {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100)
  } catch {
    return (pence / 100).toFixed(2) + ' ' + currency
  }
}

function whenText(startsAt, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(startsAt))
  } catch {
    return new Date(startsAt).toISOString()
  }
}

async function readIntent(id, account) {
  const r = await stripeCall('/v1/payment_intents/' + encodeURIComponent(id), { account })
  if (r.status === 404 || r.status === 403) return null
  if (!r.ok) throw httpError(502, providerMessage(r.json, 'Stripe couldn\'t say how the payment went'))
  return r.json
}

/** Cancels a deposit's PaymentIntent that won't be paid (a hold given up). Best effort. */
export async function cancelDepositIntent(hold) {
  if (!hold?.stripe_pi_id) return
  await stripeCall('/v1/payment_intents/' + encodeURIComponent(hold.stripe_pi_id) + '/cancel', {
    method: 'POST', account: hold.stripe_account || undefined,
  })
}

/**
 * Shows the deposit's payment form for a hold: a PaymentIntent on the
 * group's account (the hold's own, when it can still be paid), and at
 * least DEPOSIT_HOLD_SECS to pay it in. Returns what Stripe.js needs.
 */
export async function startDeposit({ tenantId, venue, holdId, notes }) {
  const loaded = await withTenant(tenantId, async tx => {
    const [h] = await tx`
      SELECT * FROM booking_holds
       WHERE id = ${holdId} AND tenant_id = ${tenantId} AND venue_id = ${venue.id}
    `
    if (!h) return { missing: true }
    return { h, rule: await loadDepositRule(tx, tenantId, venue.id) }
  })
  if (loaded.missing) throw httpError(404, 'This hold has gone: please choose your time again')
  const { h, rule } = loaded
  if (new Date(h.expires_at).getTime() < Date.now()) throw httpError(410, 'Your table was held for too long: please choose your time again')
  const amount = depositFor(rule, h.covers)
  if (!amount) throw httpError(422, 'This booking doesn\'t need a deposit')
  if (!h.guest_email) throw httpError(422, 'An email address is needed for a deposit, for the receipt')

  const ctx = await paymentContext(tenantId)
  if (!ctx.tenant.stripe_ready) {
    throw httpError(422, 'This restaurant can\'t take deposits online just now. Please call them to book.')
  }
  const account = ctx.tenant.stripe_account_id
  const currency = String(rule.currency || 'GBP').toLowerCase()

  // The hold's own PaymentIntent, when it is still for this deposit and can be paid.
  let pi = null
  if (h.stripe_pi_id) {
    const old = h.stripe_account === account ? await readIntent(h.stripe_pi_id, account) : null
    if (old?.status === 'succeeded') return { paid: true, payment_intent: old.id }
    if (old && old.status === 'processing') return { processing: true, payment_intent: old.id }
    if (old && PAYABLE.has(old.status) && old.amount === amount && old.currency === currency) pi = old
    else cancelDepositIntent(h).catch(() => {})
  }
  if (!pi) {
    const r = await stripeCall('/v1/payment_intents', {
      method: 'POST',
      account,
      idempotency: 'mcrn-deposit-' + h.id + '-' + randomUUID(),
      form: {
        amount,
        currency,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: 'Deposit: ' + venue.name + ', ' + whenText(h.starts_at, venue.timezone) + ', ' + h.covers + (h.covers === 1 ? ' guest' : ' guests'),
        receipt_email: h.guest_email,
        metadata: { kind: 'deposit', hold_id: h.id, tenant_id: tenantId, venue_id: venue.id },
      },
    })
    if (!r.ok) throw httpError(502, providerMessage(r.json, 'Stripe refused the deposit'))
    pi = r.json
  }

  const [kept] = await withTenant(tenantId, tx => tx`
    UPDATE booking_holds
       SET stripe_pi_id   = ${pi.id},
           stripe_account = ${account},
           deposit_pence  = ${amount},
           guest_notes    = COALESCE(${notes ?? null}, guest_notes),
           expires_at     = GREATEST(expires_at, now() + ${DEPOSIT_HOLD_SECS + ' seconds'}::interval)
     WHERE id = ${h.id} AND tenant_id = ${tenantId}
    RETURNING expires_at
  `)
  if (!kept) {
    cancelDepositIntent({ stripe_pi_id: pi.id, stripe_account: account }).catch(() => {})
    throw httpError(410, 'Your table was held for too long: please choose your time again')
  }
  return {
    payment_intent:  pi.id,
    client_secret:   pi.client_secret,
    publishable_key: (await platformKeys()).keys.publishable,
    account,
    amount_pence:    amount,
    currency:        rule.currency || 'GBP',
    expires_at:      kept.expires_at,
    refund_hours_before: rule.refund_hours_before ?? null,
  }
}

async function refundIntent(pi, account) {
  const r = await stripeCall('/v1/refunds', {
    method: 'POST',
    account,
    // One refund per payment that couldn't become a booking, however often asked.
    idempotency: 'mcrn-deposit-unbooked-' + pi.id,
    form: { payment_intent: pi.id },
  })
  if (!r.ok) throw httpError(502, providerMessage(r.json, 'Stripe refused the refund'))
  return r.json
}

const UNBOOKABLE = {
  gone:          'Sorry, your table was let go before your payment came through.',
  hold_not_found:'Sorry, your table was let go before your payment came through.',
  slot_conflict: 'Sorry, someone else booked that table while you were paying.',
  no_table:      'Sorry, that table can\'t be booked any more.',
}

/**
 * A deposit's PaymentIntent, as Stripe has it (read back from Stripe, or
 * from a signed webhook), becomes its booking. Returns
 *   { status: 'booked', booking, created }   booked now or already
 *   { status: 'pending' | 'failed', message } not paid (yet)
 *   { status: 'refunded', message }          paid, couldn't be booked, refunded
 *   { status: 'mismatch' }                   not this tenant's / this hold's deposit
 */
export async function settleDeposit({ tenantId, pi, account, holdId = null }) {
  const meta = pi?.metadata || {}
  if (meta.kind !== 'deposit' || meta.tenant_id !== tenantId || !meta.hold_id) return { status: 'mismatch' }
  if (holdId && meta.hold_id !== holdId) return { status: 'mismatch' }
  if (pi.status !== 'succeeded') {
    if (pi.status === 'requires_payment_method' && pi.last_payment_error) {
      return { status: 'failed', message: pi.last_payment_error.message || 'The payment didn\'t go through. Please try again.' }
    }
    if (pi.status === 'canceled') return { status: 'failed', message: 'This payment was cancelled. Please choose your time again.' }
    return { status: 'pending' }
  }

  const out = await withTenant(tenantId, async tx => {
    // One settle per payment at a time (the widget and the webhook can race).
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'deposit:' + pi.id}, 0))`
    const [paid] = await tx`SELECT booking_id FROM payments WHERE stripe_pi_id = ${pi.id} AND tenant_id = ${tenantId}`
    if (paid) {
      const [booking] = await tx`SELECT * FROM bookings WHERE id = ${paid.booking_id} AND tenant_id = ${tenantId}`
      return { booking, created: false }
    }
    // Two payments for one hold (two tabs): the second waits here, then finds it gone.
    const [locked] = await tx`
      SELECT id, stripe_account FROM booking_holds WHERE id = ${meta.hold_id} AND tenant_id = ${tenantId} FOR UPDATE
    `
    if (!locked) return { refund: 'gone' }
    if (account && locked.stripe_account && locked.stripe_account !== account) return { mismatch: true }
    const [check] = await tx`SELECT is_valid, reason FROM confirm_hold(${meta.hold_id}::uuid, ${tenantId}::uuid, true)`
    if (!check?.is_valid) return { refund: check?.reason || 'gone' }
    const [h] = await tx`SELECT * FROM booking_holds WHERE id = ${meta.hold_id} AND tenant_id = ${tenantId}`
    if (!h.table_id) return { refund: 'no_table' }
    const rule = await loadDepositRule(tx, tenantId, h.venue_id)
    const booking = await bookFromHold(tx, h)
    await tx`
      INSERT INTO payments
        (booking_id, tenant_id, stripe_pi_id, amount, currency, status, stripe_account, refund_hours_before)
      VALUES
        (${booking.id}, ${tenantId}, ${pi.id}, ${pi.amount / 100}, ${String(pi.currency || 'gbp').toUpperCase()},
         'succeeded', ${account || h.stripe_account || null}, ${rule?.refund_hours_before ?? null})
    `
    return { booking, created: true }
  })

  if (out.mismatch) return { status: 'mismatch' }
  if (out.refund) {
    await refundIntent(pi, account || undefined)
    return { status: 'refunded', reason: out.refund, message: (UNBOOKABLE[out.refund] || UNBOOKABLE.gone) + ' Your deposit has been refunded.' }
  }
  if (out.created) afterNewBooking(tenantId, out.booking)
  return { status: 'booked', booking: out.booking, created: out.created }
}

/** The Connect webhook's deposit events (paymentGateways/stripe.js). */
export async function depositWebhook({ type, pi, account }) {
  if (type !== 'payment_intent.succeeded') return null
  const tenantId = pi?.metadata?.tenant_id
  const venueId = pi?.metadata?.venue_id
  if (!tenantId || !venueId) return null
  // The venue must be the group's (a payment that doesn't add up is left alone).
  const [v] = await systemSql`SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${tenantId}`
  if (!v) return null
  return settleDeposit({ tenantId, pi, account })
}

/** The widget's confirm: reads the PaymentIntent from Stripe and settles it. */
export async function confirmDeposit({ tenantId, venueId, holdId, paymentIntent }) {
  // Which account the payment is on: the hold's, else the booking it made, else the group's.
  const where = await withTenant(tenantId, async tx => {
    const [h] = await tx`SELECT stripe_account FROM booking_holds WHERE id = ${holdId} AND tenant_id = ${tenantId} AND venue_id = ${venueId}`
    if (h?.stripe_account) return h.stripe_account
    const [p] = await tx`SELECT stripe_account FROM payments WHERE stripe_pi_id = ${paymentIntent} AND tenant_id = ${tenantId}`
    return p?.stripe_account || null
  })
  const account = where || (await paymentContext(tenantId)).tenant.stripe_account_id
  if (!account) throw httpError(404, 'Payment not found')
  const pi = await readIntent(paymentIntent, account)
  if (!pi || pi.metadata?.venue_id !== venueId) throw httpError(404, 'Payment not found')
  const res = await settleDeposit({ tenantId, pi, account, holdId })
  if (res.status === 'mismatch') throw httpError(404, 'Payment not found')
  if (res.status === 'booked') {
    return { status: 'booked', booking: widgetBooking(res.booking, { deposit_pence: pi.amount, deposit_currency: String(pi.currency || 'gbp').toUpperCase() }) }
  }
  return res
}

/** Whether a guest cancelling now gets their deposit back: { refundable, until } (until = null when never). */
export function refundRule(payment, startsAt, now = Date.now()) {
  if (!payment || payment.refund_hours_before == null) return { refundable: false, until: null }
  const until = new Date(new Date(startsAt).getTime() - payment.refund_hours_before * 3600_000)
  return { refundable: now < until.getTime(), until }
}

const left = p => Math.round(Number(p.amount) * 100) - Math.round(Number(p.refunded_amount || 0) * 100)

/**
 * Gives some or all of a deposit back to the guest's card (on the account
 * the money went to). `amountPence` omitted = what is left. Returns the
 * payment row as it is now.
 */
export async function refundDeposit(tenantId, paymentId, { amountPence } = {}) {
  const [p] = await withTenant(tenantId, tx => tx`
    SELECT p.*, t.stripe_account_id AS tenant_account
      FROM payments p JOIN tenants t ON t.id = p.tenant_id
     WHERE p.id = ${paymentId} AND p.tenant_id = ${tenantId}
  `)
  if (!p) throw httpError(404, 'Payment not found')
  if (!['succeeded', 'partially_refunded'].includes(p.status)) throw httpError(422, 'This deposit has already been refunded')
  const remaining = left(p)
  const amount = amountPence == null ? remaining : amountPence
  if (!(amount > 0) || amount > remaining) {
    throw httpError(422, 'You can refund up to ' + money(remaining, p.currency) + ' of this deposit')
  }
  const r = await stripeCall('/v1/refunds', {
    method: 'POST',
    account: p.stripe_account || p.tenant_account || undefined,
    // The same refund asked twice is one refund; a later one of the same amount is another.
    idempotency: 'mcrn-deposit-refund-' + p.id + '-' + (Math.round(Number(p.refunded_amount || 0) * 100)) + '-' + amount,
    form: { payment_intent: p.stripe_pi_id, amount },
  })
  if (!r.ok) throw httpError(422, 'Stripe refused the refund: ' + providerMessage(r.json, 'try again, or refund it in your Stripe dashboard'))
  const refundId = r.json?.id || null
  const [row] = await withTenant(tenantId, tx => tx`
    UPDATE payments
       SET refunded_amount = refunded_amount + ${amount / 100},
           status          = CASE WHEN refunded_amount + ${amount / 100} >= amount THEN 'refunded' ELSE 'partially_refunded' END::payment_status,
           refunded_at     = now(),
           refund_ids      = array_append(refund_ids, ${refundId})
     WHERE id = ${p.id} AND tenant_id = ${tenantId}
       AND NOT (${refundId}::text = ANY (refund_ids))
    RETURNING *
  `)
  if (row) return row
  const [same] = await withTenant(tenantId, tx => tx`SELECT * FROM payments WHERE id = ${p.id} AND tenant_id = ${tenantId}`)
  return same
}

/** A booking's deposit, if it has one (the newest payment). */
export async function bookingDeposit(tenantId, bookingId) {
  const [p] = await withTenant(tenantId, tx => tx`
    SELECT * FROM payments WHERE booking_id = ${bookingId} AND tenant_id = ${tenantId}
     ORDER BY created_at DESC LIMIT 1
  `)
  return p || null
}
