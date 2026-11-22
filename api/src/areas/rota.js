// src/areas/rota.js
//
// The rota area's route plugins (docs/claude/areas/rota.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import rotaRoutes from '../routes/rota.js'

export const routes = [
  [rotaRoutes, { prefix: '/api/rota' }],
]
