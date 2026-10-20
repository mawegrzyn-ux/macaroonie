// src/services/cardMachines/test.js
//
// The test card machine: no account, no money. The till or kiosk waiting on
// it shows Approve and Decline (simulate()), which stand in for the guest's
// card. Its payments are recorded like any other card machine payment
// (Card machine, ref "Test card"), so it is for training and trying the
// till, never for a real sale.

const test = {
  key: 'test',
  label: 'Test card machine',
  canPair: false,
  test: true,

  async check() { return { mode: 'test' } },
  async listReaders() { return [] },

  async startSale(account, reader, payment) {
    return { provider_ref: 'test-' + payment.id, status: 'pending' }
  },

  // The answer is the stored one: simulate() writes it (cardSvc.js).
  async saleStatus(account, reader, payment) {
    return { status: payment.status }
  },

  async cancelSale() {},

  async refund(account, sale, { refund_id }) {
    return { status: 'approved', provider_ref: 'test-refund-' + refund_id }
  },
}

export default test
