// src/areas/purchasing.js
//
// The purchasing area's route plugins (docs/claude/areas/purchasing.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import inventoryRoutes from '../routes/inventory.js'
import supplierRoutes from '../routes/suppliers.js'
import purchasingRoutes from '../routes/purchasing.js'

export const routes = [
  [inventoryRoutes, { prefix: '/api/inventory' }],
  [supplierRoutes, { prefix: '/api/suppliers' }],
  [purchasingRoutes, { prefix: '/api/purchasing' }],
  // Stock on hand and counts are the stock area's since inventory phase 4a (src/areas/stock.js).
]
