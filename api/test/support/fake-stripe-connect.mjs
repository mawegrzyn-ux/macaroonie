// A stand-in for Stripe's API with Connect, in the shapes
// services/stripeConnect.js, paymentGateways/stripe.js and
// cardMachines/stripe.js expect: the platform's key ('sk_test_platform'),
// connected accounts made and checked by the platform, account links,
// payment method domains, PaymentIntents and refunds on a connected account
// (the Stripe-Account header), and Terminal locations, readers and a test
// card on one. The tests move payments along with the helpers it returns.
import http from 'node:http'

export const PLATFORM_KEY = 'sk_test_platform_key_1234'

export async function startFakeStripe({ port = 0 } = {}) {
  const calls = []
  const st = { accounts: {}, pis: {}, refunds: [], domains: [], links: [], locations: {}, readers: {}, idem: {}, n: 0 }

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const formParse = text => {
    const out = {}
    for (const part of text.split('&').filter(Boolean)) {
      const [k, v = ''] = part.split('=').map(x => decodeURIComponent(x.replace(/\+/g, ' ')))
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
      const acct = req.headers['stripe-account'] || null
      calls.push({ method: req.method, path: p, account: acct, auth: req.headers.authorization || '', body: raw, idem: req.headers['idempotency-key'] || null })
      // Test controls (the browser checks' Stripe.js stand-in pays through these).
      let t
      if ((t = /^\/__test\/(succeed|decline|enable)\/([^/]+)$/.exec(p))) {
        if (t[1] === 'enable' && st.accounts[t[2]]) Object.assign(st.accounts[t[2]], { charges_enabled: true, details_submitted: true, business_profile: { name: 'Zqx Thai Ltd' } })
        else if (t[1] === 'succeed' && st.pis[t[2]]) st.pis[t[2]].status = 'succeeded'
        else if (t[1] === 'decline' && st.pis[t[2]]) st.pis[t[2]].last_payment_error = { message: 'Your card was declined.' }
        else return send(res, 404, { error: 'unknown' })
        return send(res, 200, { ok: true })
      }
      if ((req.headers.authorization || '') !== 'Bearer ' + PLATFORM_KEY) return send(res, 401, { error: { message: 'Invalid API Key provided' } })
      const f = formParse(raw)
      const idem = req.headers['idempotency-key']
      if (idem && st.idem[idem]) return send(res, 200, st.idem[idem])
      const keep = body => { if (idem) st.idem[idem] = body; return body }
      if (acct && !st.accounts[acct]) return send(res, 403, { error: { message: 'The provided key does not have access to account ' + acct } })
      let m

      if (p === '/v1/account') return send(res, 200, { id: 'acct_platform', object: 'account' })
      if (p === '/v1/accounts' && req.method === 'POST') {
        const id = 'acct_' + (++st.n)
        st.accounts[id] = {
          id, object: 'account', type: f.type, country: f.country, email: f.email || null,
          business_profile: { name: f['business_profile[name]'] || null }, metadata: { tenant_id: f['metadata[tenant_id]'] },
          charges_enabled: false, details_submitted: false,
        }
        return send(res, 200, keep(st.accounts[id]))
      }
      if ((m = /^\/v1\/accounts\/([^/]+)$/.exec(p))) {
        return st.accounts[m[1]] ? send(res, 200, st.accounts[m[1]]) : send(res, 404, { error: { message: 'No such account' } })
      }
      if (p === '/v1/account_links') {
        if (!st.accounts[f.account]) return send(res, 400, { error: { message: 'No such account' } })
        st.links.push(f)
        return send(res, 200, { object: 'account_link', url: 'https://connect.stripe.test/setup/' + f.account, expires_at: Math.floor(Date.now() / 1000) + 300 })
      }
      if (p === '/v1/payment_method_domains') {
        if (!acct) return send(res, 400, { error: { message: 'Needs an account' } })
        const d = { id: 'pmd_' + (++st.n), domain_name: f.domain_name, account: acct, enabled: true }
        st.domains.push(d)
        return send(res, 200, d)
      }

      // PaymentIntents and refunds live on the account in the header.
      if (p === '/v1/payment_intents' && req.method === 'POST') {
        const id = 'pi_' + (++st.n)
        st.pis[id] = {
          id, object: 'payment_intent', account: acct, status: 'requires_payment_method', client_secret: id + '_secret_' + st.n,
          amount: Number(f.amount), currency: f.currency, application_fee_amount: f.application_fee_amount ? Number(f.application_fee_amount) : null,
          automatic: f['automatic_payment_methods[enabled]'] === 'true', allow_redirects: f['automatic_payment_methods[allow_redirects]'] || null,
          receipt_email: f.receipt_email || null, payment_method_types: f['payment_method_types[]'] ? [f['payment_method_types[]']] : ['card'],
          description: f.description || null, metadata: Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])),
          last_payment_error: null, latest_charge: null,
        }
        return send(res, 200, keep(st.pis[id]))
      }
      if ((m = /^\/v1\/payment_intents\/([^/]+)\/cancel$/.exec(p))) {
        const pi = st.pis[m[1]]
        if (!pi || pi.account !== acct) return send(res, 404, { error: { message: 'No such payment_intent' } })
        if (pi.status !== 'succeeded') pi.status = 'canceled'
        return send(res, 200, pi)
      }
      if ((m = /^\/v1\/payment_intents\/([^/]+)$/.exec(p))) {
        const pi = st.pis[m[1]]
        if (!pi || pi.account !== acct) return send(res, 404, { error: { message: 'No such payment_intent' } })
        return send(res, 200, pi)
      }
      if (p === '/v1/refunds') {
        const pi = st.pis[f.payment_intent]
        if (!pi || pi.account !== acct) return send(res, 404, { error: { message: 'No such payment_intent' } })
        const r = { id: 're_' + (++st.n), status: 'succeeded', amount: f.amount ? Number(f.amount) : pi.amount, payment_intent: pi.id, account: acct, refund_application_fee: f.refund_application_fee === 'true' }
        st.refunds.push(r)
        return send(res, 200, keep(r))
      }

      // Terminal on a connected account.
      if (p === '/v1/terminal/locations' && req.method === 'GET') return send(res, 200, { data: Object.values(st.locations).filter(l => l.account === acct) })
      if (p === '/v1/terminal/locations' && req.method === 'POST') {
        if (!f['address[line1]'] || !f['address[postal_code]']) return send(res, 400, { error: { message: 'Missing address' } })
        const id = 'tml_' + (++st.n)
        st.locations[id] = { id, display_name: f.display_name, account: acct, address: { line1: f['address[line1]'], city: f['address[city]'], postal_code: f['address[postal_code]'], country: f['address[country]'] } }
        return send(res, 200, st.locations[id])
      }
      if (p === '/v1/terminal/readers' && req.method === 'GET') return send(res, 200, { data: Object.values(st.readers).filter(r => r.account === acct) })
      if (p === '/v1/terminal/readers' && req.method === 'POST') {
        if (f.registration_code !== 'simulated-wpe') return send(res, 400, { error: { message: 'Invalid registration code' } })
        if (!st.locations[f.location] || st.locations[f.location].account !== acct) return send(res, 400, { error: { message: 'No such location' } })
        const id = 'tmr_' + (++st.n)
        st.readers[id] = { id, account: acct, label: f.label, status: 'online', device_type: 'simulated_wisepos_e', serial_number: 'SIM-' + id, location: f.location, action: null }
        return send(res, 200, st.readers[id])
      }
      if ((m = /^\/v1\/terminal\/readers\/([^/]+)\/process_payment_intent$/.exec(p))) {
        const r = st.readers[m[1]]
        if (!r || r.account !== acct) return send(res, 404, { error: { message: 'No such reader' } })
        r.action = { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: f.payment_intent } }
        return send(res, 200, keep(r))
      }
      if ((m = /^\/v1\/terminal\/readers\/([^/]+)$/.exec(p))) {
        const r = st.readers[m[1]]
        return r && r.account === acct ? send(res, 200, r) : send(res, 404, { error: { message: 'No such reader' } })
      }
      if ((m = /^\/v1\/test_helpers\/terminal\/readers\/([^/]+)\/present_payment_method$/.exec(p))) {
        const r = st.readers[m[1]]
        const pi = st.pis[r?.action?.process_payment_intent?.payment_intent]
        if (!pi || r.account !== acct) return send(res, 400, { error: { message: 'No action' } })
        r.action = { ...r.action, status: 'succeeded' }
        pi.status = 'succeeded'
        pi.latest_charge = { id: 'ch_' + pi.id, payment_method_details: { card_present: { brand: 'visa', last4: '4242' } } }
        return send(res, 200, r)
      }
      return send(res, 404, { error: { message: 'Unknown ' + p } })
    })
  })
  await new Promise(r => server.listen(port, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port

  return {
    base, calls, st,
    /** Stripe finished the group's sign-up. */
    enable(id) { Object.assign(st.accounts[id], { charges_enabled: true, details_submitted: true, business_profile: { name: 'Zqx Thai Ltd' } }) },
    /** The guest's card went through (as Stripe.js confirmPayment would). */
    succeed(id) { st.pis[id].status = 'succeeded' },
    decline(id) { st.pis[id].last_payment_error = { message: 'Your card was declined.' } },
    lastPi() { return Object.values(st.pis).at(-1) },
    close: () => new Promise(r => server.close(r)),
  }
}
