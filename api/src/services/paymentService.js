// src/services/paymentService.js
import Stripe from 'stripe'
import { env } from '../config/env.js'

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' })

export async function cancelPaymentIntent(piId, stripeAccountId) {
  try {
    await stripe.paymentIntents.cancel(piId, {}, stripeAccountId ? { stripeAccount: stripeAccountId } : {})
  } catch (err) {
    // PI may already be cancelled or succeeded — log but don't throw
    console.warn(`Could not cancel PI ${piId}:`, err.message)
  }
}
