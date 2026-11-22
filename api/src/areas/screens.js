// src/areas/screens.js
//
// The screens area's route plugins (docs/claude/areas/screens.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import screensRoutes from '../routes/screens.js'
import screenApiRoutes from '../routes/screenApi.js'

export const routes = [
  [screensRoutes, { prefix: '/api/screens' }],
  [screenApiRoutes, { prefix: '/screen-api' }],
]
