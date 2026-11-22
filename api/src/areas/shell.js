// src/areas/shell.js
//
// The shell area's route plugins (docs/claude/areas/shell.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import navRoutes from '../routes/nav.js'
import navAiRoutes from '../routes/navAi.js'
import opsRoutes from '../routes/ops.js'
import noticesRoutes from '../routes/notices.js'
import usageRoutes from '../routes/usage.js'

export const routes = [
  [navRoutes, { prefix: '/api/nav' }],
  [navAiRoutes, { prefix: '/api/ai' }],
  [opsRoutes, { prefix: '/api/ops' }],
  [noticesRoutes, { prefix: '/api/notices' }],
  [usageRoutes, { prefix: '/api/usage' }],
]
