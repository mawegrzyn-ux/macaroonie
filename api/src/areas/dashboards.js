// src/areas/dashboards.js
//
// The dashboards area's route plugins (docs/claude/areas/dashboards.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import hsDashboardsRoutes from '../routes/hsDashboards.js'
import dashboardTilesRoutes from '../routes/dashboardTiles.js'

export const routes = [
  [hsDashboardsRoutes, { prefix: '/api/hs-dashboards', kind: 'hs', moduleKey: 'hs_dashboard' }],
  [hsDashboardsRoutes, { prefix: '/api/cash-dashboards', kind: 'cash', moduleKey: 'cash_dashboard' }],
  [hsDashboardsRoutes, { prefix: '/api/rota-dashboards', kind: 'rota', moduleKey: 'rota_dashboard' }],
  [hsDashboardsRoutes, { prefix: '/api/custom-dashboards', kind: 'custom', moduleKey: 'custom_dashboard' }],
  [dashboardTilesRoutes, { prefix: '/api/dashboard-tiles' }],
]
