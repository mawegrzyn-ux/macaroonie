// src/routes/hsSettings.js
//
// Tenant-wide H&S settings (migration 124), mounted at /api/hs-settings.
//
//   GET   /?venue_id=&date=   { follow_opening_days, closed }
//                             closed = checks are not required at that venue
//                             on that date (setting on + venue closed); false
//                             when venue_id/date are left out
//   PATCH /                   { follow_opening_days } (owner/admin)
//
// When follow_opening_days is on, food safety checks and daily checklists
// are not expected on days a venue is closed. Closed days come from the
// booking schedule via services/openDays.js, the same source Cash Recon and
// the Rota use.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireAnyPermission, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { hsClosedDates, hsFollowsOpeningDays } from '../services/openDays.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const H_AND_S_MODULES = ['food_safety', 'checklists', 'hs_dashboard', 'dashboard']

const PatchBody = z.object({
  follow_opening_days: z.boolean(),
})

export default async function hsSettingsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', {
    preHandler: requireAnyPermission(H_AND_S_MODULES, 'view'),
  }, async (req) => {
    const { venue_id, date } = req.query
    if (date && !DATE_RE.test(date)) throw httpError(400, 'date must be YYYY-MM-DD')

    return withTenant(req.tenantId, async tx => {
      const follows = await hsFollowsOpeningDays(tx, req.tenantId)
      const closed = follows && venue_id && date
        ? (await hsClosedDates(tx, req.tenantId, venue_id, [date], follows)).has(date)
        : false
      return { follow_opening_days: follows, closed }
    })
  })

  app.patch('/', {
    preHandler: requireRole('admin', 'owner'),
  }, async (req) => {
    const body = PatchBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await tx`
        UPDATE tenants SET hs_follow_opening_days = ${body.follow_opening_days}
         WHERE id = ${req.tenantId}
      `
      return { follow_opening_days: body.follow_opening_days }
    })
  })
}
