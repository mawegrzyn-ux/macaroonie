// src/services/cardMachines/index.js
//
// Card machines on the till and the kiosks (migration 193, docs/POS.md 2.5).
// A card payment is started by our server, never by the device: the device
// asks /pos-api/card/payments to take an amount, the server tells the
// provider's cloud to show it on the card machine, and the device waits for
// the result. A payment only reaches a check through a `payment.added`
// event naming that attempt (card_payment_id), which the sequencer accepts
// only for an approved attempt of the same venue and amount, once.
//
// One file per provider. A provider is a plain object:
//
//   key, label        'stripe', 'Stripe Terminal'
//   canPair           true when a card machine is added by typing the code it shows
//   needsLocation     Stripe: pairing needs a Stripe location
//   signature         Dojo: a signature can be asked for, answered on the till
//
//   async check(account)                      -> { mode: 'test' | 'live' | null, merchant_code?, locations? }
//       Is the key good? Called before an account is saved.
//   async listReaders(account)                -> [{ ref, name, model, serial, online }]
//   async pairReader(account, { code, name, location })   -> { ref, name, model, serial, online }   (canPair)
//   async startSale(account, reader, payment) -> { provider_ref, provider_ref2?, status, message? }
//   async saleStatus(account, reader, payment) -> { status, message?, card_brand?, card_last4?, provider_ref2? }
//   async cancelSale(account, reader, payment)            best effort: the next saleStatus() says
//   async answerSignature(account, reader, payment, ok)   (signature)
//   async refund(account, sale, { amount, refund_id })    -> { status, provider_ref, message? }
//   async simulate(account, reader, payment, result)      a test card on a test machine (test mode only)
//
// `account` = { provider, secret (unsealed), settings, mode }; `reader` =
// pos_card_readers row; `payment` = pos_card_payments row (amount + tip is
// what the card is charged, in pence). Statuses are ours:
//   pending     sent to the card machine, waiting for the card
//   signature   the machine asks staff to check the signature (Dojo)
//   approved    the money was taken
//   declined    the card was declined
//   cancelled   cancelled on the till or the machine, or it timed out
//   failed      it never reached the machine, or the provider gave up
// Providers' own words never leave the adapter except as `message`.

import dojo from './dojo.js'
import stripe from './stripe.js'
import sumup from './sumup.js'
import test from './test.js'
import { CardMachineError } from './http.js'

export { CardMachineError, call, formEncode, providerMessage, last4, brandName } from './http.js'

export const PROVIDERS = { dojo, stripe, sumup, test }
export const PROVIDER_KEYS = ['dojo', 'stripe', 'sumup']
export const FINAL = ['approved', 'declined', 'cancelled', 'failed']

export function provider(key) {
  const p = PROVIDERS[key]
  if (!p) throw new CardMachineError('Unknown card machine provider')
  return p
}
