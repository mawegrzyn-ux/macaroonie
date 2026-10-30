// src/routes/ops.js
//
// The ops front door's data (docs/CHAT_FIRST.md). GET /api/ops/today: what
// needs doing at a venue today, from data and rules (services/opsToday.js),
// so the Today page works with the AI switched off or down (P1, Q1). Open to
// everyone signed in: each part checks its own module.

import { z } from 'zod'
import { requireAuth, permissionLevels } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { tenantSql } from '../config/db.js'
import { makeContext } from '../ai/context.js'
import { opsToday, OPS_MODULES } from '../services/opsToday.js'

const realDay = d => { const t = Date.parse(d + 'T12:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d }

const TodayQuery = z.object({
  venue_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDay, 'Not a real date').optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
})

export default async function opsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/today', async req => {
    const q = TodayQuery.parse(req.query || {})
    if (!req.tenantId) throw httpError(404, 'Choose a restaurant group first')
    const venues = await tenantSql(req.tenantId)`
      SELECT id, name, timezone FROM venues
       WHERE tenant_id = ${req.tenantId} AND is_active = true
       ORDER BY name
    `
    const venue = q.venue_id ? venues.find(v => v.id === q.venue_id) : venues[0]
    if (!venue) throw httpError(404, q.venue_id ? 'Venue not found' : 'No venues yet')
    const ctx = makeContext({
      app, channel: 'staff_chat', tenantId: req.tenantId, log: req.log,
      auth: { authorization: req.headers.authorization },
      principal: { sub: req.user.sub, email: req.user.email, isPlatformAdmin: !!req.isPlatformAdmin },
      actor: req.user.email || req.user.sub,
    })
    const levels = await permissionLevels(req, OPS_MODULES)
    const today = await opsToday(ctx, venue, { date: q.date, time: q.time, levels })
    return { ...today, venues: venues.map(v => ({ id: v.id, name: v.name })) }
  })
}
