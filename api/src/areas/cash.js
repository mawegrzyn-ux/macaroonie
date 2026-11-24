// src/areas/cash.js
//
// The cash area's route plugins (docs/claude/areas/cash.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import cashReconRoutes from '../routes/cashRecon.js'
import loyverseRoutes from '../routes/loyverse.js'
import squareRoutes from '../routes/square.js'
import gloriafoodRoutes from '../routes/gloriafood.js'
import integrationsRoutes, { salesWebhookRoutes } from '../routes/integrations.js'
import itemMappingRoutes from '../routes/itemMapping.js'
import itemMappingAiRoutes from '../routes/itemMappingAi.js'

export const routes = [
  [cashReconRoutes, { prefix: '/api/venues' }],
  [loyverseRoutes, { prefix: '/api/loyverse' }],
  // Square accounts for sales from other tills (phase 5, migration 294).
  [squareRoutes, { prefix: '/api/square' }],
  [gloriafoodRoutes, { prefix: '/api/gloriafood' }],
  [integrationsRoutes, { prefix: '/api/integrations' }],
  // The item mapping (sales import phase 2, migration 292).
  [itemMappingRoutes, { prefix: '/api/integrations/mapping' }],
  // Pepper's mapping proposals (phase 3): under /api/ai/ for the proxy timeout.
  [itemMappingAiRoutes, { prefix: '/api/ai/sales-mapping' }],
  // Sales from other tills' webhooks at the root: POST /webhooks/loyverse/:token, /webhooks/square/:token
  [salesWebhookRoutes, {}],
]
