// src/routes/itemMappingAi.js
//
// Pepper's proposals for the item mapping (sales from other tills, phase 3,
// docs/SALES_IMPORT.md 4.3). Mounted at /api/ai/sales-mapping (under
// /api/ai/ for the proxy's 5 minute timeout, rule 19).
//
//   POST /:connectionId/propose   { venue_id, keys?: [thing keys] }: one
//                                 askForJson() call for up to 40 things still
//                                 open at the venue (services/itemMappingAi.js);
//                                 { proposals, dropped, couldnt, asked }.
//                                 Nothing is saved: accepted proposals go
//                                 through POST /api/integrations/mapping/
//                                 :connectionId/rules/bulk.
//
// Needs Cash reconciliation manage (proposals are for making rules) and
// Pepper view; refused when Pepper is off or the AI key isn't set
// (pepperOn()), and when the allowance is used up (askForJson()).

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { pepperOn } from '../services/aiJson.js'
import { proposeMappings, BATCH } from '../services/itemMappingAi.js'
import { ownConnection, ownLinkedVenue } from './itemMapping.js'

const Body = z.object({
  venue_id: z.string().uuid(),
  keys: z.array(z.string().trim().min(3).max(220)).max(BATCH).optional(),
})

export default async function itemMappingAiRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/:connectionId/propose', {
    preHandler: [requirePermission('cash_recon', 'manage'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async req => {
    const body = Body.parse(req.body || {})
    const { connectionId, venueId } = await withTenant(req.tenantId, async tx => {
      const conn = await ownConnection(tx, req.tenantId, req.params.connectionId)
      return { connectionId: conn.id, venueId: await ownLinkedVenue(tx, req.tenantId, conn.id, body.venue_id) }
    })
    await pepperOn(req.tenantId)
    return proposeMappings({
      tenantId: req.tenantId, person: { sub: req.user.sub, email: req.user.email }, connectionId, venueId, keys: body.keys || null,
    })
  })
}
