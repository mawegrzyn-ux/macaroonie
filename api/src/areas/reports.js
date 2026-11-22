// src/areas/reports.js
//
// The reports area's route plugins (docs/claude/areas/reports.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import reportAiRoutes from '../routes/reportAi.js'
import reportRoutes, { reportPrintRoutes } from '../routes/reports.js'
import reportScheduleRoutes from '../routes/reportSchedules.js'
import reportLayoutRoutes from '../routes/reportLayouts.js'
import reportDataLinkRoutes, { reportDataPublicRoutes } from '../routes/reportDataLinks.js'

export const routes = [
  [reportAiRoutes, { prefix: '/api/ai/reports' }],
  [reportRoutes, { prefix: '/api/reports' }],
  // Schedules and Email it now (src/reports/send.js sends).
  [reportScheduleRoutes, { prefix: '/api/reports' }],
  // Layout templates and a report's layout pick.
  [reportLayoutRoutes, { prefix: '/api/reports' }],
  [reportDataLinkRoutes, { prefix: '/api/reports' }],
  // Data links: no login, the link's own key (src/reports/dataLinks.js).
  [reportDataPublicRoutes, { prefix: '/api/report-data' }],
  // The print page (no login: its link is the key).
  [reportPrintRoutes, { prefix: '/api/reports' }],
]
