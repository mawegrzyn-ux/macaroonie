// src/routes/aiApi.js
//
// The website chat (migration 148), mounted at /ai-api. Public: called by
// the chat block on a tenant's own site (views/site/blocks/ai_chat.eta).
// A guest's conversation is theirs by its id plus a random guest_key the
// browser keeps (localStorage); nothing else identifies them. The chat is
// on only when the tenant switched it on (ai_settings.guest_chat_enabled)
// and the server has an Anthropic key, and stops at the monthly limit.
//
//   GET  /tenants/:tenantId/status          { enabled } (the block hides itself when off)
//   POST /chat                              { tenant_id, conversation_id?, guest_key?, message }
//   GET  /conversations/:id?key=            the conversation's display items (page reload)
//   POST /actions/:id/confirm               { conversation_id, guest_key }
//   POST /actions/:id/cancel                { conversation_id, guest_key }

import { z } from 'zod'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { sql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { ToolError } from '../ai/context.js'
import { getAiSettings, chatConfigured, chatTokensLeft } from '../ai/settings.js'
import {
  createConversation, loadConversation, runTurn, confirmAction, cancelAction, displayItems, chatContext,
} from '../ai/chat.js'
import { guestInstructions } from '../ai/prompts.js'

const Uuid = z.string().uuid()
const KeyBody = z.object({ conversation_id: Uuid, guest_key: z.string().min(10).max(100) })
const ChatBody = z.object({
  tenant_id:       Uuid,
  conversation_id: Uuid.optional(),
  guest_key:       z.string().min(10).max(100).optional(),
  message:         z.string().trim().min(1).max(1000),
})

async function run(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ToolError) throw httpError(err.status || 400, err.message)
    throw err
  }
}

async function chatTenant(tenantId) {
  const [t] = await sql`
    SELECT t.id, COALESCE(NULLIF(ts.brand_name, ''), NULLIF(ts.site_name, ''), t.name) AS brand
      FROM tenants t
      LEFT JOIN tenant_site ts ON ts.tenant_id = t.id
     WHERE t.id = ${tenantId} AND t.is_active = true
  `
  if (!t) return null
  const settings = await getAiSettings(t.id)
  return { ...t, enabled: settings.guest_chat_enabled && await chatConfigured() }
}

const sameKey = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

async function guestConversation(tenantId, id, key) {
  const conv = await loadConversation(tenantId, id)
  if (!conv || conv.channel !== 'guest_chat' || !sameKey(conv.guest_key, key)) throw httpError(404, 'Conversation not found')
  return conv
}

/** The action's conversation, checked against the guest's key. */
async function actionConversation(body) {
  const [c] = await sql`SELECT tenant_id FROM ai_conversations WHERE id = ${body.conversation_id}`
  if (!c) throw httpError(404, 'Conversation not found')
  return guestConversation(c.tenant_id, body.conversation_id, body.guest_key)
}

export default async function aiApiRoutes(app) {
  const limited = max => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } })

  app.get('/tenants/:tenantId/status', limited(60), async req => {
    const t = Uuid.safeParse(req.params.tenantId).success ? await chatTenant(req.params.tenantId) : null
    return { enabled: !!t?.enabled }
  })

  app.post('/chat', limited(20), async req => {
    const body = ChatBody.parse(req.body)
    const tenant = await chatTenant(body.tenant_id)
    if (!tenant?.enabled) throw httpError(403, 'Chat isn\'t available on this site.')
    if (await chatTokensLeft(tenant.id) <= 0) throw httpError(429, 'Chat is resting for now. Please use the booking form instead.')

    let conv, guestKey = body.guest_key
    if (body.conversation_id) {
      conv = await guestConversation(tenant.id, body.conversation_id, body.guest_key)
    } else {
      guestKey = randomBytes(24).toString('hex')
      conv = await createConversation({
        tenantId: tenant.id, channel: 'guest_chat', guestKey,
        systemPrompt: guestInstructions({ restaurant: tenant.brand, chat: true }),
      })
    }
    const out = await run(() => runTurn(chatContext(app, conv, { req }), conv, body.message))
    return { conversation_id: conv.id, guest_key: guestKey, stop_reason: out.stopReason, items: await displayItems(conv) }
  })

  app.get('/conversations/:id', limited(60), async req => {
    const id = Uuid.parse(req.params.id)
    const [c] = await sql`SELECT tenant_id FROM ai_conversations WHERE id = ${id}`
    if (!c) throw httpError(404, 'Conversation not found')
    const conv = await guestConversation(c.tenant_id, id, req.query.key)
    return { conversation_id: conv.id, items: await displayItems(conv) }
  })

  app.post('/actions/:id/confirm', limited(20), async req => {
    const body = KeyBody.parse(req.body)
    const conv = await actionConversation(body)
    const tenant = await chatTenant(conv.tenant_id)
    if (!tenant?.enabled) throw httpError(403, 'Chat isn\'t available on this site.')
    await run(() => confirmAction(chatContext(app, conv, { req }), conv, Uuid.parse(req.params.id)))
    return { conversation_id: conv.id, items: await displayItems(conv) }
  })

  app.post('/actions/:id/cancel', limited(20), async req => {
    const body = KeyBody.parse(req.body)
    const conv = await actionConversation(body)
    await run(() => cancelAction(chatContext(app, conv, { req }), conv, Uuid.parse(req.params.id)))
    return { conversation_id: conv.id, items: await displayItems(conv) }
  })
}
