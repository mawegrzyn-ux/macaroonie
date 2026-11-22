// src/areas/local-info.js
//
// The local-info area's route plugins (docs/claude/areas/local-info.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import localInfoRoutes from '../routes/localInfo.js'

export const routes = [
  [localInfoRoutes, { prefix: '/api/local-info' }],
]
