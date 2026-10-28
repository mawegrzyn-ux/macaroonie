// src/routes/androidApp.js
//
// The Macaroonie Android app's download (services/androidAppSvc.js,
// migration 213). Registered without a prefix:
//
//   GET    /api/platform/android-app   platform admin: what is offered, and the device addresses
//   PUT    /api/platform/android-app   platform admin: { link } copy the app from a link (an APK,
//                                      or the build's page on expo.dev) and offer it
//   DELETE /api/platform/android-app   platform admin: stop offering it, remove the copy
//   GET    /pos-api/android-app        public: { available, path, bytes, updated_at } for the
//                                      setup screens of tills, kitchen screens and kiosks
//
// The file itself is downloaded from /android on pos., kitchen. and kiosk.
// (routes/posSite.js).

import { z } from 'zod'
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js'
import { deviceOrigin } from '../services/platformHost.js'
import { androidApp, saveAndroidApp, removeAndroidApp, publicView } from '../services/androidAppSvc.js'

const SaveBody = z.object({ link: z.string().min(1).max(2000) })

function adminView(app) {
  return {
    app: app ? {
      bytes: app.bytes,
      sha256: app.sha256,
      source_url: app.source_url,
      file_url: app.file_url || null,
      updated_by: app.updated_by,
      updated_at: app.updated_at,
    } : null,
    addresses: ['terminal', 'kds', 'kiosk'].map(kind => deviceOrigin(kind) + '/android'),
  }
}

export default async function androidAppRoutes(app) {
  const admin = { preHandler: [requireAuth, requirePlatformAdmin] }

  app.get('/api/platform/android-app', admin, async () => adminView(await androidApp()))

  app.put('/api/platform/android-app', {
    ...admin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const { link } = SaveBody.parse(req.body)
    const saved = await saveAndroidApp(link, { by: req.user?.email || null })
    req.log.info({ bytes: saved.bytes, by: saved.updated_by }, 'Android app copied for download')
    return adminView(saved)
  })

  app.delete('/api/platform/android-app', admin, async () => {
    await removeAndroidApp()
    return adminView(null)
  })

  app.get('/pos-api/android-app', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache')
    return publicView(await androidApp())
  })
}
