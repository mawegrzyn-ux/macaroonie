// src/routes/usage.js
//
// The usage record (migration 270, services/usageRecord.js), mounted at
// /api/usage. Open to everyone signed in to a group: each person only ever
// adds to their own record. Reading it is the report builder's job (the
// subjects in reports/catalogue/usage.js).
//
//   POST /events   { events: [{ kind: 'page', path, at }
//                             | { kind: 'search', query, results, pepper, picked, path, at }] }
//                  at most 50 a batch; events that say nothing are dropped,
//                  never refused, so a page never has to care -> 204

import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { recordUsage, MAX_EVENTS } from '../services/usageRecord.js'

// The shape only: each event is cleaned (or dropped) by usageRow().
const Body = z.object({ events: z.array(z.record(z.unknown())).max(MAX_EVENTS) })

export default async function usageRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/events', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const { events } = Body.parse(req.body ?? {})
    await recordUsage(req.tenantId, req.user.sub, events)
    return reply.code(204).send()
  })
}
