// src/services/cardMachines/stripe.js
//
// Stripe Terminal, server-driven: smart readers (WisePOS E, S700, S710)
// controlled from our server. Built from the shapes in Stripe's own
// Node SDK (stripe 23.0.0, its OpenAPI types); docs.stripe.com couldn't be
// reached from the build environment.
//
// A sale: create a PaymentIntent (card_present, automatic capture), then
// POST /v1/terminal/readers/:id/process_payment_intent; the reader shows
// the amount. The result is the PaymentIntent's status (succeeded), or the
// reader's action (failed with a failure_message when the card is
// declined). The key is the tenant's own Stripe secret or restricted key
// (the tenant is the merchant), or, for an account in connect mode
// (migration 215), the platform's key on the group's connected Stripe
// account: `account.connect` is sent as the Stripe-Account header
// (cardSvc.js cardAccount(), services/stripeConnect.js).

import { env } from '../../config/env.js'
import { call, CardMachineError, providerMessage, brandName } from './http.js'

const NAME = 'Stripe'
const VERSION = '2024-06-20'

function api(account, path, opts = {}) {
  return call(NAME, env.STRIPE_API_URL, path, {
    ...opts,
    auth: 'Bearer ' + account.secret,
    headers: {
      'Stripe-Version': VERSION,
      ...(account.connect ? { 'Stripe-Account': account.connect } : {}),
      ...(opts.idempotency ? { 'Idempotency-Key': opts.idempotency } : {}),
      ...(opts.headers || {}),
    },
  })
}

function must(r, what) {
  if (!r.ok) throw new CardMachineError(providerMessage(r.json, NAME + ' refused ' + what + ' (' + r.status + ')'))
  return r.json
}

const modeOf = secret => /_test_/.test(secret) ? 'test' : /_live_/.test(secret) ? 'live' : null

function readerView(r) {
  return {
    ref: r.id,
    name: r.label || r.serial_number || r.id,
    model: r.device_type || null,
    serial: r.serial_number || null,
    online: r.status === 'online',
    location: typeof r.location === 'string' ? r.location : r.location?.id || null,
  }
}

const stripe = {
  key: 'stripe',
  label: 'Stripe Terminal',
  canPair: true,
  needsLocation: true,

  async check(account) {
    if (!account.connect && !/^(sk|rk)_(test|live)_/.test(account.secret || '')) {
      throw new CardMachineError('That isn\'t a Stripe secret key: it starts with sk_ or rk_ (Developers, API keys)')
    }
    const r = must(await api(account, '/v1/terminal/locations', { query: { limit: 100 } }), 'the key')
    return {
      mode: modeOf(account.secret),
      locations: (r.data || []).map(l => ({ id: l.id, name: l.display_name || l.id })),
    }
  },

  /** A Terminal location (readers belong to one) from a venue's address. */
  async createLocation(account, { name, address }) {
    const r = must(await api(account, '/v1/terminal/locations', {
      method: 'POST', form: { display_name: name, address },
    }), 'the location')
    return { id: r.id, name: r.display_name || name }
  },

  async listReaders(account) {
    const r = must(await api(account, '/v1/terminal/readers', { query: { limit: 100 } }), 'the reader list')
    return (r.data || []).map(readerView)
  },

  async pairReader(account, { code, name, location }) {
    if (!location) throw new CardMachineError('Pick the Stripe location the reader belongs to')
    const r = must(await api(account, '/v1/terminal/readers', {
      method: 'POST', form: { registration_code: code, label: name, location },
    }), 'the registration code')
    return readerView(r)
  },

  async startSale(account, reader, payment) {
    const pi = must(await api(account, '/v1/payment_intents', {
      method: 'POST',
      idempotency: 'macaroonie-pi-' + payment.id,
      form: {
        amount: payment.amount + payment.tip,
        currency: 'gbp',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        description: payment.reference || undefined,
        metadata: { macaroonie_payment: payment.id },
      },
    }), 'the payment')
    const r = await api(account, '/v1/terminal/readers/' + encodeURIComponent(reader.provider_reader_id) + '/process_payment_intent', {
      method: 'POST',
      idempotency: 'macaroonie-proc-' + payment.id,
      form: { payment_intent: pi.id, process_config: { skip_tipping: true } },
    })
    if (!r.ok) {
      // The reader is busy or offline: nothing can be taken on this intent.
      await api(account, '/v1/payment_intents/' + pi.id + '/cancel', { method: 'POST' }).catch(() => {})
      const msg = providerMessage(r.json, 'The card machine didn\'t take the payment')
      return { provider_ref: pi.id, status: 'failed', message: /offline/i.test(msg) ? 'The card machine is offline' : msg }
    }
    return { provider_ref: pi.id, status: 'pending' }
  },

  async saleStatus(account, reader, payment) {
    const pi = must(await api(account, '/v1/payment_intents/' + encodeURIComponent(payment.provider_ref), {
      query: { 'expand[]': 'latest_charge' },
    }), 'the payment')
    if (pi.status === 'succeeded') {
      const card = pi.latest_charge?.payment_method_details?.card_present || {}
      return { status: 'approved', card_brand: brandName(card.brand), card_last4: card.last4 || null, provider_ref2: pi.latest_charge?.id || null }
    }
    if (pi.status === 'canceled') return { status: 'cancelled', message: 'Cancelled' }
    if (pi.status === 'requires_capture') {
      // Automatic capture should never stop here; take it so it settles.
      const c = await api(account, '/v1/payment_intents/' + pi.id + '/capture', { method: 'POST', idempotency: 'macaroonie-cap-' + payment.id })
      return c.ok ? stripe.saleStatus(account, reader, payment) : { status: 'pending' }
    }
    // Not paid yet: the reader says whether it is still waiting.
    const rd = must(await api(account, '/v1/terminal/readers/' + encodeURIComponent(reader.provider_reader_id)), 'the reader')
    const a = rd.action
    const ours = a?.type === 'process_payment_intent' && (a.process_payment_intent?.payment_intent === pi.id || a.process_payment_intent?.payment_intent?.id === pi.id)
    if (ours && a.status === 'failed') {
      const declined = /declin|insufficient|card_error|do_not_honor|expired_card|incorrect/i.test((a.failure_code || '') + ' ' + (a.failure_message || ''))
      return { status: declined ? 'declined' : 'failed', message: a.failure_message || 'The card machine stopped the payment' }
    }
    if (ours && a.status === 'in_progress') return { status: 'pending' }
    if (pi.status === 'processing' || pi.status === 'requires_confirmation') return { status: 'pending' }
    // The reader moved on (cancelled on the machine, or another action):
    // the intent can't be paid any more.
    if (!ours && pi.last_payment_error) return { status: 'declined', message: pi.last_payment_error.message || 'Declined' }
    if (!ours) return { status: 'cancelled', message: 'The card machine stopped waiting for the card' }
    return { status: 'pending' }
  },

  async cancelSale(account, reader, payment) {
    await api(account, '/v1/terminal/readers/' + encodeURIComponent(reader.provider_reader_id) + '/cancel_action', { method: 'POST' }).catch(() => {})
    if (payment.provider_ref) {
      await api(account, '/v1/payment_intents/' + encodeURIComponent(payment.provider_ref) + '/cancel', { method: 'POST' }).catch(() => {})
    }
  },

  async refund(account, sale, { amount, refund_id }) {
    const r = await api(account, '/v1/refunds', {
      method: 'POST',
      idempotency: 'macaroonie-refund-' + refund_id,
      form: { payment_intent: sale.provider_ref, amount, metadata: { macaroonie_refund: refund_id } },
    })
    if (!r.ok) return { status: 'failed', message: providerMessage(r.json, 'Stripe refused the refund') }
    const st = r.json?.status
    if (st === 'failed' || st === 'canceled') return { status: 'failed', provider_ref: r.json.id, message: r.json.failure_reason || 'Stripe couldn\'t refund the card' }
    return { status: 'approved', provider_ref: r.json?.id || null }
  },

  async simulate(account, reader, payment, result) {
    if (account.mode !== 'test') throw new CardMachineError('A test card only works with a Stripe test key')
    const r = await api(account, '/v1/test_helpers/terminal/readers/' + encodeURIComponent(reader.provider_reader_id) + '/present_payment_method', {
      method: 'POST',
      form: result === 'decline' ? { card_present: { number: '4000000000000002' }, type: 'card_present' } : { type: 'card_present' },
    })
    must(r, 'the test card')
  },
}
export default stripe
