// src/services/paymentGateways/payAtVenue.js
//
// No online payment: the order is placed straight away and paid at the
// counter. Staff record the payment with "Mark paid" (cash or card
// terminal) on the order.

export default {
  key: 'pay_at_venue',
  label: 'Pay when you collect',
  adminLabel: 'Pay at the counter',
  online: false,
  description: 'The guest pays by cash or card when they collect. Staff mark the order paid.',

  isAvailable() { return true },

  async start() {
    return { status: 'none' }
  },
}
