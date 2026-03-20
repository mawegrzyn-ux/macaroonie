// src/routes/payments.js
// POST /payments/intent        create Stripe PaymentIntent for a hold
// POST /payments/confirm       (client confirms via Stripe.js — webhook does the real work)
// POST /payments/:id/refund    admin: trigger refund
//
// src/routes/webhooks.js (exported from same file for clarity)
// POST /webhooks/stripe        Stripe → payment_intent.succeeded / payment_intent.payment_failed

import Stripe from 'stripe'
import { z } from 'zod'
import { withTenant, sql } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { notificationQueue } from '../jobs/queues.js'
import { broadcastBooking } from '../services/broadcastSvc.js'
import { env } from '../config/env.js'

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' })

// ── Payment intent route ──────────────────────────────────────

export default async function paymentsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // POST /payments/intent
  // Called after hold is created and deposit is required.
  // Returns client_secret for Stripe.js to complete payment.
  app.post('/intent', async (req, reply) => {
    const { hold_id } = z.object({ hold_id: z.string().uuid() }).parse(req.body)

    const result = await withTenant(req.tenantId, async tx => {
      // Load hold
      const [hold] = await tx`
        SELECT h.*, dr.deposit_type, dr.deposit_amount, dr.currency
          FROM booking_holds h
          JOIN deposit_rules dr ON dr.venue_id = h.venue_id
         WHERE h.id = ${hold_id}
           AND h.tenant_id = ${req.tenantId}
           AND h.expires_at > now()
      `
      if (!hold) throw httpError(404, 'Hold not found or expired')

      if (!hold.deposit_amount) throw httpError(422, 'No deposit configured for this venue')

      // Load Stripe Connect account for tenant
      const [tenant] = await sql`
        SELECT stripe_account_id FROM tenants WHERE id = ${req.tenantId}
      `
      if (!tenant?.stripe_account_id) throw httpError(422, 'Stripe not configured for this tenant')

      // Calculate deposit amount in smallest currency unit (pence/cents)
      const depositMinor = hold.deposit_type === 'per_cover'
        ? Math.round(hold.deposit_amount * hold.covers * 100)
        : Math.round(hold.deposit_amount * 100)

      // Create PaymentIntent on the tenant's Connect account
      const pi = await stripe.paymentIntents.create({
        amount:               depositMinor,
        currency:             hold.currency.toLowerCase(),
        metadata: {
          hold_id:            hold_id,
          tenant_id:          req.tenantId,
          venue_id:           hold.venue_id,
          guest_email:        hold.guest_email,
        },
        receipt_email:        hold.guest_email,
        capture_method:       'automatic',
      }, {
        stripeAccount: tenant.stripe_account_id,
      })

      // Attach PI to hold so we can cancel it if user abandons
      await tx`
        UPDATE booking_holds
           SET stripe_pi_id = ${pi.id}
         WHERE id = ${hold_id}
      `

      return { client_secret: pi.client_secret, amount: depositMinor, currency: hold.currency }
    })

    return reply.code(201).send(result)
  })

  // POST /payments/:id/refund  (admin)
  app.post('/:id/refund', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const { amount } = z.object({
      amount: z.number().positive().optional(),  // in major currency unit; omit = full refund
    }).parse(req.body)

    const [payment] = await withTenant(req.tenantId, tx => tx`
      SELECT p.*, t.stripe_account_id
        FROM payments p
        JOIN tenants t ON t.id = p.tenant_id
       WHERE p.id = ${req.params.id}
         AND p.tenant_id = ${req.tenantId}
    `)
    if (!payment) throw httpError(404, 'Payment not found')
    if (!['succeeded'].includes(payment.status)) throw httpError(422, 'Payment cannot be refunded in its current state')

    const refundMinor = amount ? Math.round(amount * 100) : undefined

    const refund = await stripe.refunds.create({
      payment_intent: payment.stripe_pi_id,
      ...(refundMinor ? { amount: refundMinor } : {}),
    }, {
      stripeAccount: payment.stripe_account_id,
    })

    const isFullRefund = !refundMinor || refundMinor >= Math.round((payment.amount - payment.refunded_amount) * 100)

    await withTenant(req.tenantId, tx => tx`
      UPDATE payments
         SET status           = ${isFullRefund ? 'refunded' : 'partially_refunded'},
             refunded_amount  = refunded_amount + ${amount ?? payment.amount - payment.refunded_amount},
             refunded_at      = now(),
             updated_at       = now()
       WHERE id = ${req.params.id}
    `)

    return { ok: true, refund_id: refund.id }
  })
}

// ── Stripe webhook (separate plugin, raw body required) ───────

export async function webhookRoutes(app) {
  // Raw body parsing — must happen before Fastify's JSON parser
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body)
  })

  app.post('/webhooks/stripe', async (req, reply) => {
    const sig = req.headers['stripe-signature']

    let event
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      req.log.warn({ err }, 'Stripe webhook signature verification failed')
      return reply.code(400).send({ error: 'Invalid signature' })
    }

    req.log.info({ type: event.type }, 'Stripe webhook received')

    if (event.type === 'payment_intent.succeeded') {
      await handlePaymentSucceeded(event.data.object, req.log)
    }

    if (event.type === 'payment_intent.payment_failed') {
      await handlePaymentFailed(event.data.object, req.log)
    }

    return reply.send({ received: true })
  })
}

// ── Webhook handlers ──────────────────────────────────────────

async function handlePaymentSucceeded(pi, log) {
  const { hold_id, tenant_id } = pi.metadata
  if (!hold_id || !tenant_id) return log.warn({ pi_id: pi.id }, 'PI missing metadata')

  await withTenant(tenant_id, async tx => {
    // confirm_hold() — FOR UPDATE NOWAIT, re-validates conflict.
    // Only select is_valid + reason — composite type column would be unparseable.
    const [result] = await tx`
      SELECT is_valid, reason FROM confirm_hold(${hold_id}::uuid, ${tenant_id}::uuid)
    `

    if (!result.is_valid) {
      log.error({ hold_id, reason: result.reason }, 'Hold invalid at webhook confirm — refund needed')
      // In production: trigger automatic refund here
      return
    }

    // Fetch hold as a plain row (composite type from confirm_hold is unparseable)
    const [h] = await tx`SELECT * FROM booking_holds WHERE id = ${hold_id}`
    if (!h) { log.error({ hold_id }, 'Hold missing after confirmation'); return }

    const [booking] = await tx`
      INSERT INTO bookings
        (venue_id, table_id, combination_id, tenant_id, starts_at, ends_at, covers,
         guest_name, guest_email, guest_phone, guest_notes, status)
      VALUES
        (${h.venue_id}, ${h.table_id}, ${h.combination_id ?? null}, ${tenant_id},
         ${h.starts_at}, ${h.ends_at}, ${h.covers},
         ${h.guest_name}, ${h.guest_email}, ${h.guest_phone}, ${h.guest_notes ?? null},
         'confirmed')
      RETURNING *
    `

    await tx`
      INSERT INTO payments (booking_id, tenant_id, stripe_pi_id, amount, currency, status)
      VALUES (
        ${booking.id}, ${tenant_id}, ${pi.id},
        ${pi.amount / 100}, ${pi.currency.toUpperCase()}, 'succeeded'
      )
    `

    await tx`DELETE FROM booking_holds WHERE id = ${hold_id}`
    broadcastBooking('booking.created', booking)

    // Enqueue confirmation email + reminders
    await notificationQueue.add('confirmation', { bookingId: booking.id, tenantId: tenant_id, type: 'confirmation' })
    await notificationQueue.add('reminder', {
      bookingId:   booking.id,
      tenantId:    tenant_id,
      type:        'reminder_24h',
      runAt:       new Date(new Date(h.starts_at).getTime() - 24 * 60 * 60 * 1000).toISOString(),
    }, { delay: Math.max(0, new Date(h.starts_at).getTime() - 24 * 60 * 60 * 1000 - Date.now()) })
  })
}

async function handlePaymentFailed(pi, log) {
  const { hold_id, tenant_id } = pi.metadata
  if (!hold_id || !tenant_id) return

  log.warn({ pi_id: pi.id, hold_id }, 'Payment failed — hold released')
  // Delete hold so slot is freed
  await withTenant(tenant_id, tx => tx`
    DELETE FROM booking_holds WHERE id = ${hold_id} AND tenant_id = ${tenant_id}
  `)
}
