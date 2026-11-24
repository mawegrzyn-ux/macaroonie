// src/routes/suggestions.js
//
// Home's suggestions (Pepper-first step 7a, services/suggestions.js),
// mounted at /api/suggestions. The suggestions themselves come with the
// Today feed (GET /api/ops/today); here is what a person does to them.
// Open to everyone signed in to a group: each person only ever changes
// their own.
//
//   POST /hide   { key }   dismiss one: off the person's Home for HIDE_DAYS
//                          (a team suggestion, 'team:<id>', for good) -> 204

import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { FREE } from '../middleware/sharedDevice.js'
import { httpError } from '../middleware/error.js'
import { hideSuggestion } from '../services/suggestions.js'

// A suggestion's key: a page ('/rota', '/food-safety#holds'), 'report:<ref>',
// 'setup:<gap>' or 'team:<id>'.
const Key = z.string().trim().min(1).max(200).regex(/^(\/[a-z0-9/_-]*(#[a-z0-9_-]+)?|(report|setup|team):[A-Za-z0-9:_-]+)$/)

export default async function suggestionRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // A person's own preference, like the usage record: no person switch needed on a shared device.
  app.post('/hide', { config: { sharedDevice: FREE } }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
    const parsed = z.object({ key: Key }).safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(422, 'That isn\'t a suggestion.')
    await hideSuggestion(req.tenantId, req.user.sub, parsed.data.key)
    return reply.code(204).send()
  })
}
