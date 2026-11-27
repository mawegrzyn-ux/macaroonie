// src/areas/stock.js
//
// The stock area's route plugins (docs/claude/areas/stock.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import stockRoutes from '../routes/stock.js'
import stockCountRoutes from '../routes/stockCounts.js'
import stockSetupRoutes from '../routes/stockSetup.js'

export const routes = [
  // Stock on hand and each item's ledger (migration 287; inventory phase 4a, migrations 305 to 307)
  [stockRoutes, { prefix: '/api/stock' }],
  // Stocktakes: drafts, lines as they are typed, submit, approval (phase 4a, migration 306)
  [stockCountRoutes, { prefix: '/api/stock' }],
  // Storage areas, key-item lists, the stock settings and adjustments (phase 4a, migration 306)
  [stockSetupRoutes, { prefix: '/api/stock' }],
]
