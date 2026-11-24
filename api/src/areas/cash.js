// src/areas/cash.js
//
// The cash area's route plugins (docs/claude/areas/cash.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import cashReconRoutes from '../routes/cashRecon.js'
import loyverseRoutes from '../routes/loyverse.js'
import gloriafoodRoutes from '../routes/gloriafood.js'
import integrationsRoutes, { salesWebhookRoutes } from '../routes/integrations.js'

export const routes = [
  [cashReconRoutes, { prefix: '/api/venues' }],
  [loyverseRoutes, { prefix: '/api/loyverse' }],
  [gloriafoodRoutes, { prefix: '/api/gloriafood' }],
  [integrationsRoutes, { prefix: '/api/integrations' }],
  // Sales from other tills' webhooks at the root: POST /webhooks/loyverse/:token
  [salesWebhookRoutes, {}],
]
