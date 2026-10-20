// Stand-in card machine providers for the tests: Stripe Terminal, SumUp's
// Cloud API and Dojo on one local server, in the shapes the adapters
// (src/services/cardMachines/) expect. The tests move payments along with
// the helpers it returns (a card tapped, declined, a signature asked for).
import http from 'node:http'

export async function startFakeCardProviders({ port = 0 } = {}) {
  const calls = []
  const stripe = {
    readers: { tmr_1: { id: 'tmr_1', object: 'terminal.reader', label: 'Counter reader', status: 'online', device_type: 'bbpos_wisepos_e', serial_number: 'WPE-1', location: 'tml_1', action: null } },
    pis: {}, refunds: [], idem: {}, n: 0,
  }
  const sumup = { readers: {}, checkouts: {}, transactions: {}, refunds: [], n: 0 }
  const dojo = { sessions: {}, pis: {}, refunds: [], n: 0 }

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const formParse = text => {
    const out = {}
    for (const part of text.split('&').filter(Boolean)) {
      const [k, v] = part.split('=').map(decodeURIComponent)
      out[k] = v
    }
    return out
  }

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      const auth = req.headers.authorization || ''
      calls.push({ method: req.method, path: p, auth, headers: req.headers, body: raw })
      const json = () => { try { return JSON.parse(raw || '{}') } catch { return {} } }

      // ── Stripe ────────────────────────────────────────
      if (p.startsWith('/v1/') && !p.startsWith('/v1.0/')) {
        if (!/^Bearer sk_test_good/.test(auth)) return send(res, 401, { error: { message: 'Invalid API Key provided' } })
        const f = formParse(raw)
        const idem = req.headers['idempotency-key']
        if (idem && stripe.idem[idem]) return send(res, 200, stripe.idem[idem])
        const keep = body => { if (idem) stripe.idem[idem] = body; return body }
        let m
        if (p === '/v1/terminal/locations') return send(res, 200, { data: [{ id: 'tml_1', display_name: 'Ware' }] })
        if (p === '/v1/terminal/readers' && req.method === 'GET') return send(res, 200, { data: Object.values(stripe.readers) })
        if (p === '/v1/terminal/readers' && req.method === 'POST') {
          if (f.registration_code !== 'simulated-wpe') return send(res, 400, { error: { message: 'Invalid registration code' } })
          const id = 'tmr_' + (++stripe.n + 10)
          stripe.readers[id] = { id, label: f.label, status: 'online', device_type: 'simulated_wisepos_e', serial_number: 'SIM-' + id, location: f.location, action: null }
          return send(res, 200, stripe.readers[id])
        }
        if ((m = /^\/v1\/terminal\/readers\/([^/]+)$/.exec(p))) return send(res, 200, stripe.readers[m[1]] || {})
        if (p === '/v1/payment_intents' && req.method === 'POST') {
          const id = 'pi_' + (++stripe.n)
          stripe.pis[id] = { id, status: 'requires_payment_method', amount: Number(f.amount), currency: f.currency, payment_method_types: [f['payment_method_types[]']], capture_method: f.capture_method, latest_charge: null, last_payment_error: null }
          return send(res, 200, keep(stripe.pis[id]))
        }
        if ((m = /^\/v1\/terminal\/readers\/([^/]+)\/process_payment_intent$/.exec(p))) {
          const r = stripe.readers[m[1]]
          if (!r || r.status !== 'online') return send(res, 400, { error: { message: 'Reader is currently offline', code: 'terminal_reader_offline' } })
          if (r.action?.status === 'in_progress') return send(res, 409, { error: { message: 'Reader is currently busy' } })
          r.action = { type: 'process_payment_intent', status: 'in_progress', failure_code: null, failure_message: null, process_payment_intent: { payment_intent: f.payment_intent } }
          return send(res, 200, keep(r))
        }
        if ((m = /^\/v1\/terminal\/readers\/([^/]+)\/cancel_action$/.exec(p))) {
          const r = stripe.readers[m[1]]; if (r) r.action = null
          return send(res, 200, r || {})
        }
        if ((m = /^\/v1\/test_helpers\/terminal\/readers\/([^/]+)\/present_payment_method$/.exec(p))) {
          const r = stripe.readers[m[1]]
          const pi = stripe.pis[r?.action?.process_payment_intent?.payment_intent]
          if (!pi) return send(res, 400, { error: { message: 'No action' } })
          if (f['card_present[number]'] === '4000000000000002') {
            r.action = { ...r.action, status: 'failed', failure_code: 'card_declined', failure_message: 'Your card was declined.' }
            pi.last_payment_error = { message: 'Your card was declined.' }
          } else {
            r.action = { ...r.action, status: 'succeeded' }
            pi.status = 'succeeded'
            pi.latest_charge = { id: 'ch_' + pi.id, payment_method_details: { card_present: { brand: 'visa', last4: '4242' } } }
          }
          return send(res, 200, r)
        }
        if ((m = /^\/v1\/payment_intents\/([^/]+)\/cancel$/.exec(p))) {
          const pi = stripe.pis[m[1]]; if (pi && pi.status !== 'succeeded') pi.status = 'canceled'
          return send(res, 200, pi || {})
        }
        if ((m = /^\/v1\/payment_intents\/([^/]+)$/.exec(p))) {
          const pi = stripe.pis[m[1]]
          return pi ? send(res, 200, pi) : send(res, 404, { error: { message: 'No such payment_intent' } })
        }
        if (p === '/v1/refunds') {
          const r = { id: 're_' + (++stripe.n), status: 'succeeded', amount: Number(f.amount), payment_intent: f.payment_intent }
          stripe.refunds.push(r)
          return send(res, 200, keep(r))
        }
        return send(res, 404, { error: { message: 'Unknown ' + p } })
      }

      // ── SumUp ─────────────────────────────────────────
      if (p.startsWith('/v0.1/') || p.startsWith('/v2.1/') || p.startsWith('/v1.0/')) {
        if (!/^Bearer sup_sk_good/.test(auth)) return send(res, 401, { title: 'Unauthorized', detail: 'Invalid token' })
        let m
        if (p === '/v0.1/memberships') return send(res, 200, { items: [{ id: 'mem_1', resource_id: 'MXYZ', type: 'merchant', resource: { id: 'MXYZ', name: 'Zqx Thai', type: 'merchant' } }] })
        if (!/\/MXYZ\//.test(p + '/')) return send(res, 404, { detail: 'Merchant not found' })
        if (p === '/v0.1/merchants/MXYZ/readers' && req.method === 'POST') {
          const b = json()
          if (b.pairing_code !== 'PAIR42') return send(res, 422, { errors: { detail: 'Invalid pairing code', type: 'INVALID' } })
          const id = 'rdr_' + (++sumup.n)
          sumup.readers[id] = { id, name: b.name, status: 'paired', device: { identifier: 'SOLO-' + id, model: 'solo' } }
          return send(res, 201, sumup.readers[id])
        }
        if (p === '/v0.1/merchants/MXYZ/readers') return send(res, 200, { items: Object.values(sumup.readers) })
        if ((m = /^\/v0\.1\/merchants\/MXYZ\/readers\/([^/]+)\/checkout$/.exec(p))) {
          const b = json()
          const cid = 'chk_' + (++sumup.n)
          const ctid = 'ctid-' + sumup.n
          sumup.checkouts[cid] = { checkout_id: cid, client_transaction_id: ctid, status: 'pending', total_amount: b.total_amount, reader: m[1] }
          return send(res, 201, { data: { checkout_id: cid, client_transaction_id: ctid } })
        }
        if ((m = /^\/v0\.1\/merchants\/MXYZ\/readers\/([^/]+)\/checkout\/([^/]+)$/.exec(p))) {
          const c = sumup.checkouts[m[2]]
          return c ? send(res, 200, { data: { ...c } }) : send(res, 404, {})
        }
        if ((m = /^\/v0\.1\/merchants\/MXYZ\/readers\/([^/]+)\/terminate$/.exec(p))) {
          for (const c of Object.values(sumup.checkouts)) if (c.reader === m[1] && c.status === 'pending') c.status = 'cancelled'
          return send(res, 202)
        }
        if (p === '/v2.1/merchants/MXYZ/transactions') {
          const t = sumup.transactions[url.searchParams.get('client_transaction_id')]
          return t ? send(res, 200, t) : send(res, 404, { detail: 'Not found' })
        }
        if ((m = /^\/v1\.0\/merchants\/MXYZ\/payments\/([^/]+)\/refunds$/.exec(p))) {
          sumup.refunds.push({ id: m[1], body: json() })
          return send(res, 204)
        }
        return send(res, 404, { detail: 'Unknown ' + p })
      }

      // ── Dojo ──────────────────────────────────────────
      if (auth !== 'Basic sk_sandbox_good') return send(res, 401, { errors: [{ message: 'Unauthorised' }] })
      let m
      if (p === '/terminals') return send(res, 200, [{ terminalId: 'term_1', status: 'Available', tid: '1234ABCD' }])
      if (p === '/payment-intents' && req.method === 'POST') {
        const b = json()
        const id = 'pi_sandbox_' + (++dojo.n)
        dojo.pis[id] = { id, status: 'Created', amount: b.amount, reference: b.reference, captureMode: b.captureMode }
        return send(res, 200, dojo.pis[id])
      }
      if (p === '/terminal-sessions' && req.method === 'POST') {
        const b = json()
        const id = 'ts_' + (++dojo.n)
        dojo.sessions[id] = { terminalSessionId: id, status: 'InitiateRequested', details: b.details, terminalId: b.terminalId }
        return send(res, 200, dojo.sessions[id])
      }
      if ((m = /^\/terminal-sessions\/([^/]+)\/signature$/.exec(p))) {
        dojo.sessions[m[1]].status = json().accepted ? 'Captured' : 'SignatureVerificationRejected'
        return send(res, 200, dojo.sessions[m[1]])
      }
      if ((m = /^\/terminal-sessions\/([^/]+)\/cancel$/.exec(p))) {
        dojo.sessions[m[1]].status = 'Canceled'
        return send(res, 200, dojo.sessions[m[1]])
      }
      if ((m = /^\/terminal-sessions\/([^/]+)$/.exec(p))) return send(res, 200, dojo.sessions[m[1]] || {})
      if ((m = /^\/payment-intents\/([^/]+)\/refunds$/.exec(p))) {
        dojo.refunds.push({ pi: m[1], body: json(), idem: req.headers.idempotencykey })
        return send(res, 200, { refundId: 'rf_' + dojo.refunds.length })
      }
      if ((m = /^\/payment-intents\/([^/]+)$/.exec(p))) {
        return send(res, 200, { ...dojo.pis[m[1]], paymentDetails: { card: { cardName: 'MASTERCARD', cardNumber: '************4444' } } })
      }
      return send(res, 404, { errors: [{ message: 'Unknown ' + p }] })
    })
  })
  await new Promise(r => server.listen(port, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port

  return {
    base, calls, stripe, sumup, dojo,
    /** SumUp: the guest's card on the Solo. */
    sumupFinish(checkoutId, status) {
      const c = sumup.checkouts[checkoutId]
      c.status = status
      if (status === 'successful') {
        sumup.transactions[c.client_transaction_id] = { id: 'tx_' + checkoutId, status: 'SUCCESSFUL', simple_status: 'SUCCESSFUL', amount: c.total_amount.value / 100, card: { type: 'VISA', last_4_digits: '0005' } }
      }
    },
    dojoSet(sessionId, status) { dojo.sessions[sessionId].status = status },
    close: () => new Promise(r => server.close(r)),
  }
}
