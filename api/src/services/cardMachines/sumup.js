// src/services/cardMachines/sumup.js
//
// SumUp Solo readers through SumUp's Cloud API. Built from SumUp's own
// TypeScript SDK (@sumup/sdk 0.2.0, generated from their OpenAPI);
// developer.sumup.com couldn't be reached from the build environment.
//
// A reader is paired by the code the Solo shows (Connections, API, Connect)
// typed into Store tech: POST /v0.1/merchants/:code/readers. A sale is a
// reader checkout (POST .../readers/:id/checkout) whose state we read back
// (GET .../readers/:id/checkout/:checkout_id); once successful the
// transaction (GET /v2.1/merchants/:code/transactions?client_transaction_id=)
// gives the card and the id refunds need. The key is the merchant's API key
// (sup_sk_...).

import { env } from '../../config/env.js'
import { call, CardMachineError, providerMessage, brandName, last4 } from './http.js'

const NAME = 'SumUp'
// The Cloud API gives the reader 60 seconds to start a checkout; past this
// with no transaction at all it never started.
const NEVER_STARTED_MS = 3 * 60_000

function api(account, path, opts = {}) {
  return call(NAME, env.SUMUP_API_URL, path, { ...opts, auth: 'Bearer ' + account.secret })
}

function must(r, what) {
  if (!r.ok) throw new CardMachineError(providerMessage(r.json, NAME + ' refused ' + what + ' (' + r.status + ')'))
  return r.json
}

const merchant = account => {
  const code = account.settings?.merchant_code
  if (!code) throw new CardMachineError('The SumUp merchant code is missing: check the account in Store tech')
  return encodeURIComponent(code)
}

function readerView(r) {
  return {
    ref: r.id,
    name: r.name || r.device?.identifier || r.id,
    model: r.device?.model || null,
    serial: r.device?.identifier || null,
    online: r.status === 'paired' ? null : false,
    paired: r.status === 'paired',
    state: r.status,
  }
}

async function transaction(account, payment) {
  const r = await api(account, '/v2.1/merchants/' + merchant(account) + '/transactions', {
    query: { client_transaction_id: payment.provider_ref },
  })
  if (r.status === 404) return null
  return must(r, 'the transaction')
}

const STATUS = { SUCCESSFUL: 'approved', PAID_OUT: 'approved', FAILED: 'declined', CANCELLED: 'cancelled', REFUNDED: 'approved', PENDING: 'pending' }

const sumup = {
  key: 'sumup',
  label: 'SumUp',
  canPair: true,

  async check(account) {
    const r = must(await api(account, '/v0.1/memberships'), 'the key')
    const merchants = (r.items || [])
      .filter(m => (m.type || m.resource?.type) === 'merchant')
      .map(m => ({ code: m.resource?.id || m.resource_id, name: m.resource?.name || m.resource_id }))
      .filter(m => m.code)
    const wanted = account.settings?.merchant_code
    if (wanted && !merchants.some(m => m.code === wanted)) {
      throw new CardMachineError('This key doesn\'t belong to merchant ' + wanted)
    }
    if (!wanted && merchants.length !== 1) {
      throw new CardMachineError(merchants.length ? 'This key works for several merchants: type the merchant code' : 'No SumUp merchant account found for this key')
    }
    const m = wanted ? merchants.find(x => x.code === wanted) : merchants[0]
    return { mode: null, merchant_code: m.code, merchant_name: m.name }
  },

  async listReaders(account) {
    const r = must(await api(account, '/v0.1/merchants/' + merchant(account) + '/readers'), 'the reader list')
    return (r.items || []).map(readerView)
  },

  async pairReader(account, { code, name }) {
    const r = must(await api(account, '/v0.1/merchants/' + merchant(account) + '/readers', {
      method: 'POST', body: { pairing_code: String(code).trim().toUpperCase(), name },
    }), 'the pairing code')
    return readerView(r)
  },

  async startSale(account, reader, payment) {
    const r = await api(account, '/v0.1/merchants/' + merchant(account) + '/readers/' + encodeURIComponent(reader.provider_reader_id) + '/checkout', {
      method: 'POST',
      body: {
        total_amount: { currency: 'GBP', minor_unit: 2, value: payment.amount + payment.tip },
        description: payment.reference || undefined,
      },
    })
    if (!r.ok) {
      const msg = providerMessage(r.json, 'The card machine didn\'t take the payment')
      return { status: 'failed', message: /offline/i.test(msg) ? 'The card machine is offline' : msg }
    }
    const d = r.json?.data || {}
    if (!d.client_transaction_id) return { status: 'failed', message: 'SumUp didn\'t start the payment' }
    return { provider_ref: d.client_transaction_id, provider_ref2: d.checkout_id || null, status: 'pending' }
  },

  async saleStatus(account, reader, payment) {
    let state = null
    let reason = null
    if (payment.provider_ref2) {
      const r = await api(account, '/v0.1/merchants/' + merchant(account) + '/readers/' + encodeURIComponent(reader.provider_reader_id) + '/checkout/' + encodeURIComponent(payment.provider_ref2))
      if (r.ok) { state = r.json?.data?.status || null; reason = r.json?.data?.payment_failure_reason || null }
    }
    if (state === 'pending') return { status: 'pending' }
    if (state === 'cancelled') return { status: 'cancelled', message: 'Cancelled on the card machine' }
    const t = await transaction(account, payment)
    if (!t) {
      if (state === 'failed') return { status: 'declined', message: reason || 'Declined' }
      if (Date.now() - new Date(payment.created_at).getTime() > NEVER_STARTED_MS) {
        return { status: 'cancelled', message: 'The card machine didn\'t start the payment' }
      }
      return { status: 'pending' }
    }
    const status = STATUS[t.simple_status] || STATUS[t.status] || 'pending'
    if (status === 'approved') {
      return { status, card_brand: brandName(t.card?.type), card_last4: last4(t.card?.last_4_digits), provider_ref2: t.id || null }
    }
    return { status, message: status === 'declined' ? reason || 'Declined' : status === 'cancelled' ? 'Cancelled' : undefined }
  },

  async cancelSale(account, reader) {
    await api(account, '/v0.1/merchants/' + merchant(account) + '/readers/' + encodeURIComponent(reader.provider_reader_id) + '/terminate', {
      method: 'POST', body: {},
    }).catch(() => {})
  },

  async refund(account, sale, { amount }) {
    // The transaction id comes from the transaction itself (saleStatus).
    const id = sale.provider_ref2 || (await transaction(account, sale))?.id
    if (!id) return { status: 'failed', message: 'SumUp has no transaction for this payment' }
    // A full refund sends no amount (SumUp refunds all of it); a part
    // refund sends it in pounds, as SumUp's transaction amounts are.
    const full = amount >= sale.amount + sale.tip - (sale.refunded || 0) && !(sale.refunded > 0)
    const r = await api(account, '/v1.0/merchants/' + merchant(account) + '/payments/' + encodeURIComponent(id) + '/refunds', {
      method: 'POST', body: full ? {} : { amount: amount / 100 },
    })
    if (!r.ok) return { status: 'failed', message: providerMessage(r.json, 'SumUp refused the refund') }
    return { status: 'approved', provider_ref: r.json?.id || r.json?.transaction_id || id }
  },
}

export default sumup
