// src/areas/kiosk.js
//
// The kiosk area's route plugins (docs/claude/areas/kiosk.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import kioskAnalyticsRoutes from '../routes/kioskAnalytics.js'

export const routes = [
  [kioskAnalyticsRoutes, { prefix: '/api/pos/kiosk-analytics' }],
]
