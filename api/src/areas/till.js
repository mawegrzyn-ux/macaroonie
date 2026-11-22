// src/areas/till.js
//
// The till area's route plugins (docs/claude/areas/till.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import posSetupRoutes from '../routes/posSetup.js'
import printDesignRoutes from '../routes/printDesigns.js'
import tillLayoutRoutes from '../routes/tillLayouts.js'
import orderFlowRoutes from '../routes/orderFlows.js'
import cardSetupRoutes from '../routes/cardSetup.js'
import taxSetupRoutes from '../routes/taxSetup.js'
import posApiRoutes from '../routes/posApi.js'
import installerRoutes from '../routes/installer.js'
import techBoardRoutes from '../routes/techBoard.js'

export const routes = [
  // Till (POS): admin setup + reports, and the tills' own API (device auth).
  [posSetupRoutes, { prefix: '/api/pos' }],
  [printDesignRoutes, { prefix: '/api/pos' }],
  [tillLayoutRoutes, { prefix: '/api/pos' }],
  [orderFlowRoutes, { prefix: '/api/pos' }],
  [cardSetupRoutes, { prefix: '/api/pos' }],
  [taxSetupRoutes, { prefix: '/api' }],
  [posApiRoutes, { prefix: '/pos-api' }],
  [installerRoutes, { prefix: '/api/installer' }],
  [techBoardRoutes, { prefix: '/api/tech-board' }],
]
