// src/routes/payments.js
//
// Booking deposits, staff side (/api/payments). Guests pay deposits in the
// reservations widget (routes/widgetApi.js, services/depositSvc.js) on the
// group's own Stripe account; the Connect webhook is
// POST /webhooks/payments/stripe (paymentWebhookRoutes in orderApi.js).
//
// POST /payments/:id/refund   { amount_pence? }  give some or all of a
//                             deposit back to the guest's card

import { z } from 'zod'
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { refundDeposit } from '../services/depositSvc.js'

// Refunds move money: bookings manage, owner or admin.
const PERM = {
  adminManage: [requireRole('admin', 'owner'), requirePermission('bookings', 'manage')],
}

export default async function paymentsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/:id/refund', { preHandler: PERM.adminManage }, async (req) => {
    const { amount_pence } = z.object({
      amount_pence: z.number().int().positive().optional(),  // omit = what is left
    }).parse(req.body || {})
    const payment = await refundDeposit(req.tenantId, req.params.id, { amountPence: amount_pence })
    return {
      ok: true,
      status: payment.status,
      refunded_pence: Math.round(Number(payment.refunded_amount) * 100),
    }
  })
}
