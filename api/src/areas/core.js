// src/areas/core.js
//
// The core area's route plugins (docs/claude/areas/core.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import platformRoutes from '../routes/platform.js'
import teamRoutes from '../routes/team.js'
import accessRoutes from '../routes/access.js'
import backlogRoutes from '../routes/backlog.js'
import issueLogRoutes from '../routes/issueLog.js'
import featureRequestsRoutes from '../routes/featureRequests.js'
import changelogRoutes from '../routes/changelog.js'

export const routes = [
  [platformRoutes, { prefix: '/api' }],
  [teamRoutes, { prefix: '/api/team' }],
  [accessRoutes, { prefix: '/api/access' }],
  [backlogRoutes, { prefix: '/api/backlog' }],
  [issueLogRoutes, { prefix: '/api/issues' }],
  [featureRequestsRoutes, { prefix: '/api/feature-requests' }],
  [changelogRoutes, { prefix: '/api/changelog' }],
]
