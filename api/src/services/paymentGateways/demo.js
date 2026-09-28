// src/services/paymentGateways/demo.js
//
// A pretend card payment for pre-production testing. The ordering page
// shows a "test card" panel with Pay and "Simulate a failed payment"
// buttons; nothing is charged. It exercises the same path a real online
// gateway takes (pending payment, confirm, refund), so the order flow can
// be tested end to end before a real gateway is wired in.
//
// Turn it off in Ordering setup before taking real orders.

import { randomUUID } from 'node:crypto'

export default {
  key: 'demo',
  label: 'Card (test payment)',
  adminLabel: 'Test payment (no money moves)',
  online: true,
  description: 'Pre-production only: a pretend card payment to test the ordering flow. Nothing is charged.',

  isAvailable() { return true },

  async start({ order }) {
    return {
      status: 'pending',
      ref: 'demo_' + randomUUID(),
      amount_pence: order.total_pence,
      client: { type: 'demo', amount_pence: order.total_pence, currency: order.currency },
    }
  },

  // Trusting the browser is only acceptable because no money moves.
  async confirmFromClient({ body }) {
    return { status: body?.outcome === 'fail' ? 'failed' : 'succeeded', raw: { outcome: body?.outcome ?? 'succeed' } }
  },

  async refund({ amount_pence }) {
    return { ref: 'demo_refund_' + randomUUID(), amount_pence }
  },

  async cancel() {},
}
