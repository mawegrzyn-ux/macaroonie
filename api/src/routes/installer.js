// src/routes/installer.js
//
// The installer app (installer.<root>, admin/src/pages/installer; migration
// 184): a phone for linking the tills, kitchen screens, kiosks and menu
// screens at a venue. /api/installer:
//
//   GET  /venues/:venueId   the venue's tills, kitchen screens, kiosks (pos_setup
//                           view) and menu screens (screens view), each with its
//                           state; kitchen stations, kiosk designs, boards and
//                           playlists to pick from; what the person may change;
//                           the device addresses
//   POST /lookup            { code } what a code shown on a device belongs to: a
//                           menu screen or a till / kitchen screen / kiosk, and
//                           whether it is still waiting (pos_setup or screens manage)
//
// Linking goes through each area's own route, with its own permission:
// POST /api/pos/venues/:venueId/link (tills, kitchen screens, kiosks) and
// POST /api/screens/screens/claim (menu screens). Every query filters tenant_id.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireAnyPermission, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { deviceOrigin, screensOrigin } from '../services/platformHost.js'
import { findLinkCode } from '../services/linkCodes.js'
import { loadScreens } from './screens.js'
import { BUMP_KINDS } from '../../../shared/pos/kitchen.js'

const UUID = z.string().uuid()
// A till or kitchen screen counts as online when it called the API this
// recently (it says so at most once a minute).
const DEVICE_ONLINE_MS = 5 * 60_000

const rank = { none: 0, view: 1, manage: 2 }

function deviceView(d) {
  const s = d.settings || {}
  return {
    id: d.id, name: d.name, kind: d.kind, short_code: d.short_code,
    paired: !!d.secret_hash, paired_at: d.paired_at, last_seen_at: d.last_seen_at,
    online: !!d.secret_hash && !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < DEVICE_ONLINE_MS,
    app_version: d.app_version,
    // Whole: PATCH /api/pos/devices/:id replaces the settings, so a change
    // made here is sent back with everything else the device has.
    settings: s,
  }
}

export default async function installerRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/venues/:venueId', {
    preHandler: [requireOwnVenue('venueId'), requireAnyPermission(['pos_setup', 'screens'], 'view')],
  }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const levels = await permissionLevels(req, ['pos_setup', 'screens'])
    const canDevices = rank[levels.pos_setup] >= rank.view
    const canScreens = rank[levels.screens] >= rank.view
    return withTenant(req.tenantId, async tx => {
      const [venue] = await tx`SELECT id, name FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}`
      if (!venue) throw httpError(404, 'Venue not found')
      const [devices, stations, kioskDesigns, screens, designs, playlists] = await Promise.all([
        canDevices ? tx`
          SELECT * FROM pos_devices
           WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND revoked_at IS NULL AND kind <> 'hub'
           ORDER BY created_at` : null,
        canDevices ? tx`
          SELECT id, name FROM kds_stations
           WHERE tenant_id = ${req.tenantId} AND venue_id = ${venueId} AND is_active AND kind = ANY(${BUMP_KINDS})
           ORDER BY sort_order, name` : null,
        canDevices ? tx`SELECT id, name FROM kiosk_designs WHERE tenant_id = ${req.tenantId} ORDER BY created_at` : null,
        canScreens ? loadScreens(tx, req.tenantId) : null,
        canScreens ? tx`SELECT id, name, width, height FROM screen_designs WHERE tenant_id = ${req.tenantId} ORDER BY name` : null,
        canScreens ? tx`SELECT id, name FROM screen_playlists WHERE tenant_id = ${req.tenantId} ORDER BY name` : null,
      ])
      return {
        venue,
        can: { devices: levels.pos_setup, screens: levels.screens },
        devices: devices ? devices.map(deviceView) : null,
        stations,
        kiosk_designs: kioskDesigns,
        screens: screens ? screens.filter(s => s.venue_id === venueId).map(s => ({
          id: s.id, name: s.name, short_code: s.short_code, width: s.width, height: s.height, rotation: s.rotation, fit: s.fit,
          design_id: s.design_id, playlist_id: s.playlist_id, shows: s.shows, wall: s.wall,
          paired: s.paired, online: s.online, last_seen_at: s.last_seen_at, app_version: s.app_version,
        })) : null,
        designs, playlists,
        addresses: {
          terminal: deviceOrigin('terminal'), kds: deviceOrigin('kds'), kiosk: deviceOrigin('kiosk'), screen: screensOrigin(),
        },
      }
    })
  })

  app.post('/lookup', {
    preHandler: requireAnyPermission(['pos_setup', 'screens'], 'manage'),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async req => {
    const { code } = z.object({ code: z.string().trim().min(4).max(20) }).parse(req.body)
    const found = await withTenant(req.tenantId, tx => findLinkCode(tx, code))
    if (!found) throw httpError(404, 'That code isn\'t right: check it against the device')
    const levels = await permissionLevels(req, ['pos_setup', 'screens'])
    const kind = found.type === 'screen' ? 'screen' : (found.app || null)
    const status = found.claimed ? 'linked' : new Date(found.expires_at) <= new Date() ? 'expired' : 'waiting'
    const info = found.device_info || {}
    return {
      kind,                     // 'screen' | 'terminal' | 'kds' | 'kiosk' | null (any of the three)
      status,
      expires_at: found.expires_at,
      device: {
        width: info.width ? Math.round(info.width * (info.dpr || 1)) : null,
        height: info.height ? Math.round(info.height * (info.dpr || 1)) : null,
        ua: info.ua || null,
      },
      can_link: found.type === 'screen' ? levels.screens === 'manage' : levels.pos_setup === 'manage',
    }
  })
}
