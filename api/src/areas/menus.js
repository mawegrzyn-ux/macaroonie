// src/areas/menus.js
//
// The menus area's route plugins (docs/claude/areas/menus.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import menusRoutes from '../routes/menus.js'
import deliverooRoutes from '../routes/deliveroo.js'
import menuTimesRoutes from '../routes/menuTimes.js'

export const routes = [
  [menusRoutes, { prefix: '/api/menus' }],
  [deliverooRoutes, { prefix: '/api/deliveroo' }],
  [menuTimesRoutes, { prefix: '/api/menu-times' }],
]
