// src/areas/hs.js
//
// The hs area's route plugins (docs/claude/areas/hs.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import foodSafetyRoutes from '../routes/foodSafety.js'
import checklistsRoutes from '../routes/checklists.js'
import hsActionLogRoutes from '../routes/hsActionLog.js'
import hsSettingsRoutes from '../routes/hsSettings.js'
import legacyImportRoutes from '../routes/legacyImport.js'

export const routes = [
  [foodSafetyRoutes, { prefix: '/api/food-safety' }],
  [checklistsRoutes, { prefix: '/api/checklists' }],
  [hsActionLogRoutes, { prefix: '/api/hs-action-log' }],
  [hsSettingsRoutes, { prefix: '/api/hs-settings' }],
  [legacyImportRoutes, { prefix: '/api/legacy-import' }],
]
