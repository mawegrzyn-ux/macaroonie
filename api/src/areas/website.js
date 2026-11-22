// src/areas/website.js
//
// The website area's route plugins (docs/claude/areas/website.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import websiteRoutes from '../routes/website.js'
import publicSiteRoutes from '../routes/publicSite.js'
import mediaRoutes from '../routes/media.js'
import reviewsRoutes from '../routes/reviews.js'
import themeRoutes from '../routes/themes.js'

export const routes = [
  [websiteRoutes, { prefix: '/api/website' }],
  [publicSiteRoutes, { prefix: '/api/site' }],
  [mediaRoutes, { prefix: '/api/media' }],
  [reviewsRoutes, { prefix: '/api/reviews' }],
  [themeRoutes, { prefix: '/api/ai/themes' }],
]
