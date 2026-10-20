// shared/pos/cards.js
//
// Card machine payments on checks (migration 193, docs/POS.md 2.5). The
// money moves on the card machine; the server records every attempt
// (pos_card_payments) and the sequencer lets an event put one on a check,
// or take one off, only when the attempt says so:
//
//   payment.added   tender card_integrated, card_payment_id: an approved
//                   sale of this venue for exactly the payment's amount and
//                   tip, for this check (or a kiosk's, made before its check
//                   existed), not on any check yet
//   refund.added    tender card_integrated, card_refund_id: an approved
//                   refund of this amount, of a card payment on this check
//   payment.voided  of a card_integrated payment, card_refund_id: an
//                   approved refund of the whole payment (amount and tip)
//
// cardNeed() says which attempt an event needs (null: none), cardProblem()
// what is wrong with the attempt the store loaded. Each attempt is used by
// one event only (used_event_id), so a payment can't be counted twice.

export function cardNeed(event, checks) {
  const p = event.payload || {}
  if (event.type === 'payment.added' && p.payment?.tender === 'card_integrated') {
    return { id: p.payment.card_payment_id, kind: 'sale', amount: p.payment.amount, tip: p.payment.tip || 0, payment_id: p.payment.id }
  }
  if (event.type === 'refund.added' && p.refund?.tender === 'card_integrated') {
    const c = checks[event.check_id]
    const sales = (c?.payments || []).filter(x => x.card_payment_id).map(x => x.card_payment_id)
    return { id: p.refund.card_refund_id, kind: 'refund', amount: p.refund.amount, sales, payment_id: p.refund.id }
  }
  if (event.type === 'payment.voided' && p.card_refund_id) {
    const x = (checks[event.check_id]?.payments || []).find(y => y.id === p.payment_id)
    if (!x || x.tender !== 'card_integrated') return null   // applyEvent says what's wrong
    return { id: p.card_refund_id, kind: 'refund', amount: x.amount + (x.tip || 0), sales: [x.card_payment_id], whole: true }
  }
  return null
}

const money = p => '£' + (p / 100).toFixed(2)

/** What is wrong with the attempt `row` for this event (null = fine). */
export function cardProblem(event, need, row) {
  if (!row || row.kind !== need.kind) return need.kind === 'sale' ? 'The card machine has no record of this payment' : 'The card machine has no record of this refund'
  if (row.venue_id && event.venue_id && row.venue_id !== event.venue_id) return 'This card payment belongs to another venue'
  if (row.used_event_id && row.used_event_id !== event.id) return need.kind === 'sale' ? 'This card payment is already on a check' : 'This card refund is already recorded'
  if (row.status !== 'approved') return need.kind === 'sale' ? 'The card machine didn\'t approve this payment' : 'The card refund didn\'t go through'
  if (row.check_id && row.check_id !== event.check_id) return need.kind === 'sale' ? 'This card payment was taken for another check' : 'This card refund was for another check'
  if (need.kind === 'sale') {
    if (row.payment_id && need.payment_id && row.payment_id !== need.payment_id) return 'This card payment was taken for another payment'
    if (row.amount !== need.amount || (row.tip || 0) !== need.tip) {
      return 'The card machine took ' + money(row.amount + (row.tip || 0)) + ', not ' + money(need.amount + need.tip)
    }
    return null
  }
  if (!need.sales.includes(row.sale_id)) return 'This card refund is for a payment that isn\'t on this check'
  if (row.amount !== need.amount) return 'The card refund was ' + money(row.amount) + ', not ' + money(need.amount)
  return null
}
