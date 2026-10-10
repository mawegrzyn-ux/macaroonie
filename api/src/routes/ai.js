// src/routes/ai.js
//
// The admin side of the AI assistant (migration 148), mounted at /api/ai.
//
//   GET    /status                     can this person chat? (assistant panel)
//   GET    /conversations              their own recent chats
//   GET    /conversations/:id          one chat as display items
//   DELETE /conversations/:id
//   POST   /chat                       { conversation_id?, message } -> items
//   POST   /actions/:id/confirm        Confirm on a card (runs the change)
//   POST   /actions/:id/cancel
//
//   GET    /settings                   switches, this month's usage, MCP addresses
//   PATCH  /settings                   switches (ai_assistant manage)
//   GET    /tokens                     access tokens for the staff MCP
//   POST   /tokens                     { name } -> the token, shown once
//   DELETE /tokens/:id                 revoke
//   GET    /activity                   audit log of AI booking changes
//
//   GET    /platform/tenants           every tenant's limit and usage (platform admin)
//   PATCH  /platform/tenants/:id       { monthly_token_limit } (platform admin)
//   GET    /platform/key               where the Anthropic key comes from (platform admin)
//   PUT    /platform/key               { api_key } checked with Anthropic, then saved
//   POST   /platform/key/test          checks the key the chats use now
//   DELETE /platform/key               removes the saved key (back to .env)
//
// Chats are gated by ai_settings.staff_enabled and the ai_assistant module
// (view); each booking tool then checks the person's Bookings permission.

import { z } from 'zod'
import { sql, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { requireAuth, requirePermission, requirePlatformAdmin, permissionLevel, newAccessToken } from '../middleware/auth.js'
import { ToolError, usageMonth } from '../ai/context.js'
import { getAiSettings, saveAiSettings, monthUsage, chatConfigured, chatTokensLeft } from '../ai/settings.js'
import { activeKey, keyInfo, checkKey, saveKey, removeKey } from '../ai/apiKey.js'
import {
  createConversation, loadConversation, runTurn, confirmAction, cancelAction, displayItems, chatContext,
} from '../ai/chat.js'
import { staffInstructions } from '../ai/prompts.js'

const ChatBody = z.object({
  conversation_id: z.string().uuid().optional(),
  message:         z.string().trim().min(1).max(2000),
})

const SettingsBody = z.object({
  guest_mcp_enabled:  z.boolean().optional(),
  guest_chat_enabled: z.boolean().optional(),
  staff_enabled:      z.boolean().optional(),
})

/** ToolError -> httpError, so the admin gets the message. */
async function run(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ToolError) throw httpError(err.status || 400, err.message)
    throw err
  }
}

function mcpOrigin() {
  return (env.PUBLIC_SITE_SCHEME || 'https') + '://' + env.PUBLIC_ROOT_DOMAIN
}

async function staffChatAllowed(req) {
  if (!(await chatConfigured())) throw httpError(503, 'The AI assistant isn\'t set up on this server yet.')
  const settings = await getAiSettings(req.tenantId)
  if (!settings.staff_enabled) throw httpError(403, 'The AI assistant is switched off for this restaurant group.')
  if (await permissionLevel(req, 'ai_assistant') === 'none') throw httpError(403, 'You don\'t have access to the AI assistant.')
}

/** The caller's own staff chat. */
async function ownConversation(req, id) {
  const conv = await loadConversation(req.tenantId, id)
  if (!conv || conv.channel !== 'staff_chat' || conv.user_sub !== req.user.sub) throw httpError(404, 'Conversation not found')
  return conv
}

async function actionConversation(req, actionId) {
  const [a] = await withTenant(req.tenantId, tx => tx`
    SELECT conversation_id FROM ai_pending_actions WHERE id = ${actionId} AND tenant_id = ${req.tenantId}
  `)
  if (!a) throw httpError(404, 'That card no longer exists.')
  return ownConversation(req, a.conversation_id)
}

export default async function aiRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Chat ────────────────────────────────────────────────
  app.get('/status', async req => {
    const configured = await chatConfigured()
    if (!req.tenantId) return { configured, enabled: false, permission: 'none', can_chat: false, tokens_left: null }
    const settings = await getAiSettings(req.tenantId)
    const level = await permissionLevel(req, 'ai_assistant')
    return {
      configured,
      enabled:      settings.staff_enabled,
      permission:   level,
      can_chat:     configured && settings.staff_enabled && level !== 'none',
      tokens_left:  level === 'none' ? null : Math.max(0, await chatTokensLeft(req.tenantId)),
    }
  })

  app.get('/conversations', async req => {
    return withTenant(req.tenantId, tx => tx`
      SELECT id, title, created_at, updated_at FROM ai_conversations
       WHERE tenant_id = ${req.tenantId} AND channel = 'staff_chat' AND user_sub = ${req.user.sub}
       ORDER BY updated_at DESC
       LIMIT 30
    `)
  })

  app.get('/conversations/:id', async req => {
    const conv = await ownConversation(req, req.params.id)
    return { id: conv.id, title: conv.title, items: await displayItems(conv) }
  })

  app.delete('/conversations/:id', async req => {
    const conv = await ownConversation(req, req.params.id)
    await withTenant(req.tenantId, tx => tx`DELETE FROM ai_conversations WHERE id = ${conv.id} AND tenant_id = ${req.tenantId}`)
    return { ok: true }
  })

  app.post('/chat', async req => {
    const body = ChatBody.parse(req.body)
    await staffChatAllowed(req)
    let conv
    if (body.conversation_id) {
      conv = await ownConversation(req, body.conversation_id)
    } else {
      const [t] = await sql`SELECT name FROM tenants WHERE id = ${req.tenantId}`
      const [u] = await withTenant(req.tenantId, tx => tx`
        SELECT full_name FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} LIMIT 1
      `)
      conv = await createConversation({
        tenantId: req.tenantId, channel: 'staff_chat', userSub: req.user.sub, userEmail: req.user.email,
        systemPrompt: staffInstructions({ tenant: t?.name, person: u?.full_name || null, chat: true }),
      })
    }
    const out = await run(() => runTurn(chatContext(app, conv, { req }), conv, body.message))
    return { conversation_id: conv.id, title: conv.title, stop_reason: out.stopReason, items: await displayItems(conv) }
  })

  app.post('/actions/:id/confirm', async req => {
    await staffChatAllowed(req)
    const conv = await actionConversation(req, req.params.id)
    await run(() => confirmAction(chatContext(app, conv, { req }), conv, req.params.id))
    return { conversation_id: conv.id, items: await displayItems(conv) }
  })

  app.post('/actions/:id/cancel', async req => {
    const conv = await actionConversation(req, req.params.id)
    await run(() => cancelAction(chatContext(app, conv, { req }), conv, req.params.id))
    return { conversation_id: conv.id, items: await displayItems(conv) }
  })

  // ── Settings ────────────────────────────────────────────
  app.get('/settings', { preHandler: requirePermission('ai_assistant', 'view') }, async req => {
    const [t] = await sql`SELECT slug FROM tenants WHERE id = ${req.tenantId}`
    const [settings, usage] = await Promise.all([getAiSettings(req.tenantId), monthUsage(req.tenantId)])
    return {
      settings,
      usage,
      chat_configured: await chatConfigured(),
      guest_mcp_url:   mcpOrigin() + '/mcp',
      staff_mcp_url:   mcpOrigin() + '/mcp/staff/' + t.slug,
      can_manage:      await permissionLevel(req, 'ai_assistant') === 'manage',
    }
  })

  app.patch('/settings', { preHandler: requirePermission('ai_assistant', 'manage') }, async req => {
    const body = SettingsBody.parse(req.body)
    return { settings: await saveAiSettings(req.tenantId, body) }
  })

  // ── Access tokens (staff MCP) ───────────────────────────
  // Each person makes and revokes their own; a manager of the module sees
  // and can revoke everyone's.
  app.get('/tokens', { preHandler: requirePermission('ai_assistant', 'view') }, async req => {
    const manage = await permissionLevel(req, 'ai_assistant') === 'manage'
    return withTenant(req.tenantId, tx => tx`
      SELECT k.id, k.name, k.token_prefix, k.created_at, k.last_used_at, k.revoked_at,
             u.email AS user_email, (u.auth0_user_id = ${req.user.sub}) AS mine
        FROM ai_access_tokens k
        JOIN users u ON u.id = k.user_id
       WHERE k.tenant_id = ${req.tenantId}
         AND (${manage} OR u.auth0_user_id = ${req.user.sub})
       ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC
    `)
  })

  app.post('/tokens', { preHandler: requirePermission('ai_assistant', 'view') }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body)
    const [user] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} AND is_active = true LIMIT 1
    `)
    if (!user) throw httpError(422, 'Access tokens are for team members of this restaurant group. Ask an owner to invite you.')
    const { token, hash, prefix } = newAccessToken()
    const [row] = await sql`
      INSERT INTO ai_access_tokens (tenant_id, user_id, name, token_prefix, token_hash)
      VALUES (${req.tenantId}, ${user.id}, ${name}, ${prefix}, ${hash})
      RETURNING id, name, token_prefix, created_at
    `
    return reply.code(201).send({ ...row, token })
  })

  app.delete('/tokens/:id', { preHandler: requirePermission('ai_assistant', 'view') }, async req => {
    const manage = await permissionLevel(req, 'ai_assistant') === 'manage'
    const [row] = await sql`
      UPDATE ai_access_tokens k SET revoked_at = now()
        FROM users u
       WHERE k.id = ${req.params.id} AND k.tenant_id = ${req.tenantId} AND k.revoked_at IS NULL
         AND u.id = k.user_id
         AND (${manage} OR u.auth0_user_id = ${req.user.sub})
      RETURNING k.id
    `
    if (!row) throw httpError(404, 'Token not found')
    return { ok: true }
  })

  // ── Activity (audit log) ────────────────────────────────
  app.get('/activity', { preHandler: requirePermission('ai_assistant', 'manage') }, async req => {
    return withTenant(req.tenantId, tx => tx`
      SELECT a.id, a.channel, a.actor, a.tool, a.input, a.ok, a.result, a.booking_id, a.created_at,
             b.guest_name, b.starts_at, v.name AS venue_name, v.timezone
        FROM ai_actions a
        LEFT JOIN bookings b ON b.id = a.booking_id AND b.tenant_id = a.tenant_id
        LEFT JOIN venues   v ON v.id = b.venue_id
       WHERE a.tenant_id = ${req.tenantId}
       ORDER BY a.created_at DESC
       LIMIT 100
    `)
  })

  // ── Platform admin: monthly limits ──────────────────────
  app.get('/platform/tenants', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await sql`
      SELECT t.id, t.name, t.slug,
             COALESCE(s.monthly_token_limit, 2000000) AS monthly_token_limit,
             COALESCE(s.staff_enabled, true)          AS staff_enabled,
             COALESCE(s.guest_mcp_enabled, true)      AS guest_mcp_enabled,
             COALESCE(s.guest_chat_enabled, false)    AS guest_chat_enabled,
             COALESCE((SELECT sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens)
                         FROM ai_usage u
                        WHERE u.tenant_id = t.id AND u.month = ${usageMonth()}
                          AND u.channel IN ('staff_chat', 'guest_chat')), 0) AS chat_tokens,
             COALESCE((SELECT sum(u.requests) FROM ai_usage u
                        WHERE u.tenant_id = t.id AND u.month = ${usageMonth()}
                          AND u.channel IN ('staff_mcp', 'guest_mcp')), 0) AS mcp_calls
        FROM tenants t
        LEFT JOIN ai_settings s ON s.tenant_id = t.id
       WHERE t.is_active = true
       ORDER BY t.name
    `
    return {
      month: usageMonth(),
      chat_configured: await chatConfigured(),
      tenants: rows.map(r => ({ ...r, monthly_token_limit: Number(r.monthly_token_limit), chat_tokens: Number(r.chat_tokens), mcp_calls: Number(r.mcp_calls) })),
    }
  })

  app.patch('/platform/tenants/:id', { preHandler: requirePlatformAdmin }, async req => {
    const { monthly_token_limit } = z.object({
      monthly_token_limit: z.number().int().min(0).max(1_000_000_000),
    }).parse(req.body)
    const [t] = await sql`SELECT id FROM tenants WHERE id = ${req.params.id}`
    if (!t) throw httpError(404, 'Tenant not found')
    return { settings: await saveAiSettings(t.id, { monthly_token_limit }) }
  })

  // ── Platform admin: the Anthropic API key ───────────────
  // Saved keys are checked with Anthropic first and never sent back: the
  // admin sees where the key comes from and its last four characters.
  app.get('/platform/key', { preHandler: requirePlatformAdmin }, async () => keyInfo())

  app.put('/platform/key', { preHandler: requirePlatformAdmin }, async req => {
    const parsed = z.object({
      api_key: z.string().trim().min(20, 'That doesn\'t look like a whole key.').max(300, 'That\'s too long for a key.')
        .regex(/^\S+$/, 'A key has no spaces in it.'),
    }).safeParse(req.body)
    if (!parsed.success) throw httpError(422, parsed.error.issues[0].message)
    const { api_key } = parsed.data
    const check = await checkKey(api_key)
    if (!check.ok) throw httpError(422, check.message)
    await saveKey(api_key, req.user?.email || null)
    req.log.info({ by: req.user?.email }, 'Anthropic API key saved')
    return { ...(await keyInfo()), warning: check.warning || null }
  })

  app.post('/platform/key/test', { preHandler: requirePlatformAdmin }, async () => {
    const { key, source } = await activeKey()
    if (!key) return { ok: false, source: null, message: 'There is no key to check.' }
    return { source, ...(await checkKey(key)) }
  })

  app.delete('/platform/key', { preHandler: requirePlatformAdmin }, async req => {
    await removeKey()
    req.log.info({ by: req.user?.email }, 'Anthropic API key removed')
    return keyInfo()
  })
}
