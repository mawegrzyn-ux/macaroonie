// src/services/paymentGateways/index.js
//
// Pluggable payment gateways for web ordering. The order flow
// (services/orderSvc.js) only ever talks to this interface, so adding a
// real provider (Stripe, Dojo, Adyen...) means adding one file here and
// one line to GATEWAYS. Nothing else changes.
//
// A gateway is a plain object:
//
//   key          'stripe'          stored in orders.payment_method and
//                                  order_payments.gateway
//   label        'Card'            what the guest sees at checkout
//   adminLabel   'Card (Stripe)'   what staff see
//   online       true              false = paid at the counter later
//   description  one line for the ordering settings page
//
//   isAvailable({ tenant, venue })            -> boolean
//       Can this venue use it right now? (e.g. Stripe needs a connected
//       account). Unavailable gateways are hidden at checkout.
//
//   async start({ order, venue, tenant })     -> result
//       Called once the order row exists. Returns one of:
//         { status: 'none' }       nothing to pay now (pay at venue)
//         { status: 'succeeded', ref, amount_pence }
//         { status: 'pending', ref, amount_pence, client }
//       `client` is handed to the guest's browser as is, so it may only
//       hold public values (a client secret, a publishable key, a redirect
//       URL). The ordering page switches on client.type.
//
//   async confirmFromClient({ payment, body }) -> { status, raw? }   optional
//       The guest's browser says "done". A real gateway must NOT trust the
//       body: it asks the provider for the payment's state and returns
//       that ('succeeded' | 'failed' | 'pending').
//
//   async parseWebhook({ rawBody, headers })   -> { ref, status, raw } | null   optional
//       POST /webhooks/payments/:key. Verify the signature, map the event
//       to the payment's ref and a status. Return null to ignore an event.
//
//   async refund({ payment, amount_pence })    -> { ref }            optional
//       Throw to refuse. Gateways without refund() can't be refunded
//       online; staff refund at the counter.
//
//   async cancel({ payment })                  -> void               optional
//       Called when an unpaid online order expires.

import payAtVenue from './payAtVenue.js'
import demo from './demo.js'

const GATEWAYS = {
  [payAtVenue.key]: payAtVenue,
  [demo.key]:       demo,
}

// Counter payments staff record by hand ("Mark paid"). Not gateways: they
// never appear at checkout.
export const COUNTER_METHODS = {
  cash:          'Cash',
  card_terminal: 'Card (terminal)',
}

export function getGateway(key) {
  return GATEWAYS[key] ?? null
}

export function listGateways() {
  return Object.values(GATEWAYS).map(g => ({
    key: g.key, label: g.label, adminLabel: g.adminLabel ?? g.label,
    online: !!g.online, description: g.description ?? '',
    refundable: typeof g.refund === 'function',
  }))
}

// The gateways a venue offers at checkout, in the order set in its
// ordering settings, skipping unknown or unavailable ones.
export function checkoutGateways(settings, ctx) {
  return (settings.payment_methods || [])
    .map(getGateway)
    .filter(g => g && (!g.isAvailable || g.isAvailable(ctx)))
}
