// src/routes/techBoard.js
//
// A venue's Tech board (22 Nov 2026, OUTSTANDING 44.7): its kit on one page,
// each piece with whether it is up and the last thing it did, from what is
// already stored (no live feed). /api/tech-board:
//
//   GET /venues/:venueId   the tills, kitchen screens, kiosks and venue hubs,
//                          the printers, the card machines (Store tech view)
//                          and the menu screens (Screens view), as
//                          services/techBoardSvc.js loadTechBoard() reads them
//                          (also the menu screen Store status block's source)
//
// The page turns it into tiles with shared/techBoard.js techTiles() and
// draws the honeycomb with shared/techHex.js (28 Nov 2026). The platform's
// own light is GET /api/status/light (routes/platform.js).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireAnyPermission, permissionLevels } from '../middleware/auth.js'
import { permissionAtLeast } from '../config/modules.js'
import { requireOwnVenue } from '../middleware/venue.js'
import { loadTechBoard } from '../services/techBoardSvc.js'

const UUID = z.string().uuid()

export default async function techBoardRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/venues/:venueId', {
    preHandler: [requireOwnVenue('venueId'), requireAnyPermission(['pos_setup', 'screens'], 'view')],
  }, async req => {
    const venueId = UUID.parse(req.params.venueId)
    const levels = await permissionLevels(req, ['pos_setup', 'screens'])
    const can = { kit: permissionAtLeast(levels.pos_setup, 'view'), screens: permissionAtLeast(levels.screens, 'view') }
    return withTenant(req.tenantId, tx => loadTechBoard(tx, req.tenantId, venueId, can))
  })
}
