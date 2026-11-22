// src/areas/ordering.js
//
// The ordering area's route plugins (docs/claude/areas/ordering.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import orderApiRoutes from '../routes/orderApi.js'
import ordersRoutes from '../routes/orders.js'
import promotionsRoutes from '../routes/promotions.js'
import stripeRoutes from '../routes/stripe.js'

export const routes = [
  [orderApiRoutes, { prefix: '/order-api' }],
  [ordersRoutes, { prefix: '/api/orders' }],
  [promotionsRoutes, { prefix: '/api/promotions' }],
  // The group's Stripe account (Connect) and the platform's Stripe keys.
  [stripeRoutes],
]
