// src/areas/hub.js
//
// The hub area's route plugins (docs/claude/areas/hub.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import androidAppRoutes from '../routes/androidApp.js'

export const routes = [
  // The Android app's download (Platform page, /android on the device addresses).
  [androidAppRoutes],
]
