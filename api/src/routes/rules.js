// src/routes/rules.js
//
// Rules made from a sentence (Pepper-first step 8B2, migration 286), mounted
// at /api/ai/rules (under /api/ai/ for the proxy's 5 minute timeout: reading
// a sentence is a model call). Settings' Rules list and its "from a sentence"
// box; Pepper's make_rule does the same through services/rules.js.
//
//   GET    /          the group's rules in words, with the last run (View on Pepper)
//   POST   /parse     { sentence } -> { rule, lines }: read, never saved (Manage)
//   POST   /          { rule, sentence }: the rule the person confirmed, checked
//                    again in full (Manage; they must be able to use its action)
//   PATCH  /:id       { enabled }: switch it off or on; { rule }: the whole rule
//                    changed in place, checked as a save is (Manage; step 9a)
//   DELETE /:id       the rule and its runs; the changes it made stay (Manage)

import { z } from 'zod'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { pepperOn } from '../services/aiJson.js'
import { parseRule, saveRule, listRules, changeRule, switchRule, deleteRule } from '../services/rules.js'
import { ruleLines, TRIGGERS, RULE_ACTIONS } from '../../../shared/rules.js'

const Change = z.union([
  z.object({ enabled: z.boolean() }).strict(),
  z.object({ rule: z.record(z.string(), z.unknown()) }).strict(),
])

const canView = requirePermission('ai_assistant', 'view')
const canManage = requirePermission('ai_assistant', 'manage')
const Sentence = z.object({ sentence: z.string().trim().min(8).max(500) })

export default async function ruleRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/', { preHandler: canView }, async req => ({
    rules: await listRules(req.tenantId),
    triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([k, t]) => [k, t.label])),
    actions: Object.fromEntries(Object.entries(RULE_ACTIONS).map(([k, a]) => [k, a.label])),
  }))

  app.post('/parse', { preHandler: canManage }, async req => {
    const { sentence } = Sentence.parse(req.body || {})
    await pepperOn(req.tenantId)
    const { rule, venue } = await parseRule({ tenantId: req.tenantId, person: { sub: req.user.sub, email: req.user.email }, sentence })
    return { rule, lines: ruleLines(rule, { venueName: venue?.name }) }
  })

  app.post('/', { preHandler: canManage }, async (req, reply) => {
    const b = z.object({ rule: z.record(z.string(), z.unknown()), sentence: z.string().trim().max(500).nullable().optional() }).parse(req.body || {})
    const saved = await saveRule(req, b.rule, b.sentence || null)
    return reply.code(201).send(saved)
  })

  app.patch('/:id', { preHandler: canManage }, async req => {
    const b = Change.parse(req.body || {})
    if ('rule' in b) return changeRule(req, req.params.id, b.rule)
    return switchRule(req.tenantId, req.params.id, b.enabled)
  })

  app.delete('/:id', { preHandler: canManage }, async req => {
    return deleteRule(req.tenantId, req.params.id)
  })
}
