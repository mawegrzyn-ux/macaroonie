// src/services/paymentGateways/stripe.js
//
// Card payments for web ordering through the group's own Stripe account
// (Stripe Connect, direct charges; services/stripeConnect.js, migration
// 215). The guest pays on the ordering page with Stripe's Payment Element
// (cards, Apple Pay, Google Pay, whatever the group's account offers); the
// money goes to the group's account, with the platform's online ordering
// fee (orders.platform_fee_pence) taken as an application fee.
//
// start() makes a PaymentIntent on the group's account; the page gets its
// client secret, the publishable key and the account. The browser saying
// "done" (confirmFromClient) is never trusted: the PaymentIntent is read
// back from Stripe. Webhooks (POST /webhooks/payments/stripe, the
// platform's Connect endpoint) settle what the page never reported (a
// closed tab, a payment that was still processing), hand booking deposits
// to services/depositSvc.js and keep the group's account details fresh
// (account.updated).

import { randomUUID } from 'node:crypto'
import { httpError } from '../../middleware/error.js'
import { providerMessage } from '../cardMachines/http.js'
import { platformKeys, stripeCall, verifySignature, applyAccountEvent } from '../stripeConnect.js'

const STATUS = {
  succeeded: 'succeeded',
  canceled: 'cancelled',
  processing: 'pending',
  requires_capture: 'pending',
  requires_action: 'pending',
  requires_confirmation: 'pending',
}

/** A PaymentIntent's state, in the order flow's words. */
export function piStatus(pi) {
  if (!pi) return 'pending'
  if (pi.status === 'requires_payment_method') return pi.last_payment_error ? 'failed' : 'pending'
  return STATUS[pi.status] || 'pending'
}

const accountOf = payment => payment?.raw?.account || null

export default {
  key: 'stripe',
  label: 'Card',
  adminLabel: 'Card (Stripe)',
  online: true,
  description: 'Card, Apple Pay and Google Pay, paid to your own Stripe account. Connect Stripe below first.',

  isAvailable({ tenant } = {}) {
    return !!tenant?.stripe_ready
  },

  async start({ order, venue, tenant }) {
    const account = tenant?.stripe_account_id
    if (!account) throw httpError(422, 'Card payments aren\'t set up here')
    const fee = Math.max(0, Math.min(Number(order.platform_fee_pence) || 0, order.total_pence - 1))
    const r = await stripeCall('/v1/payment_intents', {
      method: 'POST',
      account,
      idempotency: 'mcrn-order-' + order.id + '-' + randomUUID(),
      form: {
        amount: order.total_pence,
        currency: String(order.currency || 'GBP').toLowerCase(),
        automatic_payment_methods: { enabled: true },
        application_fee_amount: fee > 0 ? fee : undefined,
        description: 'Order ' + order.order_number + (venue?.name ? ' at ' + venue.name : ''),
        metadata: {
          order_id: order.id, tenant_id: order.tenant_id, venue_id: order.venue_id,
          order_number: String(order.order_number), service_date: String(order.service_date || ''),
        },
      },
    })
    if (!r.ok) throw httpError(502, providerMessage(r.json, 'Stripe refused the payment'))
    const pi = r.json
    return {
      status: 'pending',
      ref: pi.id,
      amount_pence: pi.amount,
      raw: { account, application_fee_pence: fee },
      client: {
        type: 'stripe',
        publishable_key: (await platformKeys()).keys.publishable,
        account,
        client_secret: pi.client_secret,
        amount_pence: pi.amount,
        currency: order.currency,
      },
    }
  },

  // Asks Stripe, never the browser.
  async confirmFromClient({ payment }) {
    const r = await stripeCall('/v1/payment_intents/' + encodeURIComponent(payment.gateway_ref), { account: accountOf(payment) })
    if (!r.ok) throw httpError(502, providerMessage(r.json, 'Stripe couldn\'t say how the payment went'))
    const pi = r.json
    if (pi.metadata?.order_id && pi.metadata.order_id !== payment.order_id) return { status: 'failed', raw: { mismatch: true } }
    return { status: piStatus(pi), raw: { pi_status: pi.status, decline: pi.last_payment_error?.message || null } }
  },

  async parseWebhook({ rawBody, headers }) {
    const event = verifySignature(rawBody, headers['stripe-signature'], (await platformKeys()).keys.webhook)
    const obj = event?.data?.object
    if (event.type === 'account.updated' || event.type === 'account.application.deauthorized') {
      await applyAccountEvent(event.type, event.type === 'account.updated' ? obj : { id: event.account })
      return null
    }
    // Booking deposits (services/depositSvc.js): the route settles them.
    if (obj?.object === 'payment_intent' && obj.metadata?.kind === 'deposit') {
      return { deposit: { type: event.type, pi: obj, account: event.account || null } }
    }
    // Only online orders' payments (card machine ones come here too).
    if (!obj || obj.object !== 'payment_intent' || !obj.metadata?.order_id) return null
    const status = event.type === 'payment_intent.succeeded' ? 'succeeded'
      : event.type === 'payment_intent.payment_failed' ? 'failed'
      : event.type === 'payment_intent.canceled' ? 'cancelled' : null
    if (!status) return null
    return { ref: obj.id, status, raw: { event: event.id, event_type: event.type, account: event.account || null } }
  },

  async refund({ payment, amount_pence }) {
    const r = await stripeCall('/v1/refunds', {
      method: 'POST',
      account: accountOf(payment),
      // Same refund retried = one refund; a later refund of the same amount is a new one.
      idempotency: 'mcrn-refund-' + payment.id + '-' + (payment.refunded_pence || 0) + '-' + amount_pence,
      form: { payment_intent: payment.gateway_ref, amount: amount_pence, refund_application_fee: true },
    })
    if (!r.ok) throw httpError(422, 'Stripe refused the refund: ' + providerMessage(r.json, 'try again, or refund it in your Stripe dashboard'))
    return { ref: r.json.id, amount_pence }
  },

  async cancel({ payment }) {
    await stripeCall('/v1/payment_intents/' + encodeURIComponent(payment.gateway_ref) + '/cancel', {
      method: 'POST', account: accountOf(payment),
    })
  },
}
