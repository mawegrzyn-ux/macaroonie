// src/areas/loyalty.js
//
// The loyalty area's route plugins (docs/claude/areas/loyalty.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import loyaltyRoutes from '../routes/loyalty.js'
import loyaltyApiRoutes from '../routes/loyaltyApi.js'

export const routes = [
  [loyaltyRoutes, { prefix: '/api/loyalty' }],
  [loyaltyApiRoutes, { prefix: '/loyalty-api' }],
]
