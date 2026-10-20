// src/services/cardMachines/dojo.js
//
// Dojo card machines through Dojo's cloud API (payment intents + terminal
// sessions). docs.dojo.tech couldn't be reached from the build environment
// and Dojo publishes no SDK on npm, so this follows Dojo's API as known
// before (version 2024-02-05) and reads replies loosely; check it against
// a Dojo sandbox before first use (Outstanding items, POS).
//
// A sale: POST /payment-intents (amount, reference, captureMode Auto),
// then POST /terminal-sessions { terminalId, details: { sessionType: 'Sale',
// sale: { paymentIntentId } } }; the session's status says where it is. A
// machine may ask for the signature to be checked
// (SignatureVerificationRequired): staff answer on the till.
// Headers: Authorization: Basic <secret key>, version, and the till
// software's software-house-id / reseller-id from Dojo (env).

import { env } from '../../config/env.js'
import { call, CardMachineError, providerMessage, brandName, last4 } from './http.js'

const NAME = 'Dojo'
const VERSION = '2024-02-05'

function api(account, path, opts = {}) {
  const s = account.settings || {}
  const house = s.software_house_id || env.DOJO_SOFTWARE_HOUSE_ID
  const reseller = s.reseller_id || env.DOJO_RESELLER_ID
  return call(NAME, env.DOJO_API_URL, path, {
    ...opts,
    auth: 'Basic ' + account.secret,
    headers: {
      version: VERSION,
      ...(house ? { 'software-house-id': house } : {}),
      ...(reseller ? { 'reseller-id': reseller } : {}),
      ...(opts.idempotency ? { idempotencyKey: opts.idempotency } : {}),
    },
  })
}

function must(r, what) {
  if (!r.ok) throw new CardMachineError(providerMessage(r.json, NAME + ' refused ' + what + ' (' + r.status + ')'))
  return r.json
}

const modeOf = secret => /^sk_sandbox_/.test(secret) ? 'test' : /^sk_prod_/.test(secret) ? 'live' : null

const listOf = j => Array.isArray(j) ? j : j?.terminals || j?.items || j?.data || []

function readerView(t) {
  const st = String(t.status || '')
  return {
    ref: t.terminalId || t.id,
    name: t.name || t.tid || t.terminalId || t.id,
    model: t.properties?.model || t.model || null,
    serial: t.tid || t.properties?.serialNumber || null,
    online: st ? !/offline|unavailable/i.test(st) : null,
    state: st || null,
  }
}

// Terminal session statuses. Authorized and Captured are money taken
// (captureMode Auto captures straight away).
const SESSION = {
  InitiateRequested: 'pending', Initiated: 'pending', Processing: 'pending',
  SignatureVerificationRequired: 'signature', SignatureVerificationAccepted: 'pending',
  Authorized: 'approved', Captured: 'approved', Completed: 'approved',
  Declined: 'declined', SignatureVerificationRejected: 'declined',
  Canceled: 'cancelled', Cancelled: 'cancelled', Expired: 'cancelled', Rejected: 'cancelled', Reversed: 'cancelled',
  Failed: 'failed', Error: 'failed',
}

const dojo = {
  key: 'dojo',
  label: 'Dojo',
  canPair: false,
  signature: true,

  async check(account) {
    if (!/^sk_(sandbox|prod)_/.test(account.secret || '')) {
      throw new CardMachineError('That isn\'t a Dojo secret key: it starts with sk_sandbox_ or sk_prod_ (Dojo developer portal, API keys)')
    }
    must(await api(account, '/terminals'), 'the key')
    return { mode: modeOf(account.secret) }
  },

  async listReaders(account) {
    return listOf(must(await api(account, '/terminals'), 'the card machine list')).map(readerView).filter(r => r.ref)
  },

  async startSale(account, reader, payment) {
    const pi = must(await api(account, '/payment-intents', {
      method: 'POST',
      idempotency: 'macaroonie-pi-' + payment.id,
      body: {
        amount: { value: payment.amount + payment.tip, currencyCode: 'GBP' },
        reference: (payment.reference || payment.id).slice(0, 60),
        captureMode: 'Auto',
      },
    }), 'the payment')
    const piId = pi.id || pi.paymentIntentId
    if (!piId) return { status: 'failed', message: 'Dojo didn\'t start the payment' }
    const r = await api(account, '/terminal-sessions', {
      method: 'POST',
      idempotency: 'macaroonie-ts-' + payment.id,
      body: { terminalId: reader.provider_reader_id, details: { sessionType: 'Sale', sale: { paymentIntentId: piId } } },
    })
    if (!r.ok) {
      const msg = providerMessage(r.json, 'The card machine didn\'t take the payment')
      return { provider_ref: piId, status: 'failed', message: /busy|offline|unavailable/i.test(msg) ? 'The card machine is busy or offline' : msg }
    }
    const sid = r.json?.terminalSessionId || r.json?.id
    if (!sid) return { provider_ref: piId, status: 'failed', message: 'Dojo didn\'t start the card machine' }
    return { provider_ref: piId, provider_ref2: sid, status: SESSION[r.json?.status] === 'failed' ? 'failed' : 'pending' }
  },

  async saleStatus(account, reader, payment) {
    const s = must(await api(account, '/terminal-sessions/' + encodeURIComponent(payment.provider_ref2)), 'the session')
    const status = SESSION[s.status] || 'pending'
    if (status !== 'approved') {
      return { status, message: status === 'declined' ? 'Declined' : status === 'cancelled' ? 'Cancelled on the card machine' : status === 'failed' ? 'The card machine stopped the payment' : undefined }
    }
    // The card, best effort: the payment intent's details.
    const pi = await api(account, '/payment-intents/' + encodeURIComponent(payment.provider_ref)).catch(() => null)
    const d = pi?.ok ? pi.json?.paymentDetails || pi.json?.paymentDetail || {} : {}
    const card = d.card || d
    return {
      status,
      card_brand: brandName(card.cardName || card.cardType || card.scheme || card.brand),
      card_last4: last4(card.last4, card.cardNumber, card.maskedPan, card.pan),
    }
  },

  async cancelSale(account, reader, payment) {
    if (!payment.provider_ref2) return
    await api(account, '/terminal-sessions/' + encodeURIComponent(payment.provider_ref2) + '/cancel', { method: 'PUT' }).catch(() => {})
  },

  async answerSignature(account, reader, payment, accepted) {
    must(await api(account, '/terminal-sessions/' + encodeURIComponent(payment.provider_ref2) + '/signature', {
      method: 'PUT', body: { accepted: !!accepted },
    }), 'the signature answer')
  },

  async refund(account, sale, { amount, refund_id }) {
    const r = await api(account, '/payment-intents/' + encodeURIComponent(sale.provider_ref) + '/refunds', {
      method: 'POST',
      idempotency: 'macaroonie-refund-' + refund_id,
      body: { amount, refundReason: 'Refund from the till' },
    })
    if (!r.ok) return { status: 'failed', message: providerMessage(r.json, 'Dojo refused the refund') }
    return { status: 'approved', provider_ref: r.json?.refundId || r.json?.id || null }
  },
}

export default dojo
