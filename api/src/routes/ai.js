// src/routes/ai.js
//
// The admin side of the AI assistant (migration 148), mounted at /api/ai.
//
//   GET    /status                     can this person chat? (assistant panel)
//   GET    /conversations              their own recent chats
//   GET    /conversations/:id          one chat as display items (+ running)
//   DELETE /conversations/:id
//   POST   /chat                       { conversation_id?, message, attachments? } -> items;
//                                      streamed with Accept: text/event-stream
//   POST   /attachments                multipart file -> { id, name, kind } (migration 150)
//   GET    /attachments/:id            the file itself (its uploader only)
//   DELETE /attachments/:id            an upload not sent yet
//   POST   /actions/:id/confirm        Confirm on a card (runs the change)
//   POST   /actions/:id/cancel
//   POST   /actions/:id/undo           Undo on a done card: a reversible change, for
//                                      UNDO_MINUTES, its own person only (step 4d)
//   POST   /conversations/:id/forms/:toolUseId   { summary } a form opened from the
//                                      chat's form card was saved: the card shows the
//                                      line with Edit (saveFormCard(), step 3c)
//
//   GET    /settings                   switches, this month's usage (units) and each
//                                      person's (a manager sees everyone), MCP addresses
//   PATCH  /settings                   switches (incl. web_search: web search in the
//                                      staff chat), daily share per person, how long
//                                      chats are kept (ai_assistant manage)
//   GET    /tokens                     access tokens for the staff MCP
//   POST   /tokens                     { name } -> the token, shown once
//   DELETE /tokens/:id                 revoke
//   GET    /activity                   audit log of changes made through AI
//   GET    /done                       Done by Pepper (step 4e): Pepper's changes, the
//                                      person's own (ai_assistant view) or everyone's
//                                      (manage), by venue and day, with Undo where open
//   GET    /review                     For review's Waiting list (step 5c): the person's
//                                      own cards left unanswered (WAIT_DAYS), supplier
//                                      orders waiting for their approval and invoices
//                                      read for a delivery not booked in, each part
//                                      read as the person; ?count=1 for Home's slot
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
import { sql, withTenant, systemSql, tenantSql } from '../config/db.js'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { requireAuth, requirePermission, requirePlatformAdmin, permissionLevel, newAccessToken } from '../middleware/auth.js'
import { FREE } from '../middleware/sharedDevice.js'
import { ToolError, usageMonth, makeContext, callApi, staffAuthOf, staffPrincipalOf } from '../ai/context.js'
import {
  getAiSettings, saveAiSettings, monthUsage, chatConfigured, chatUnitsLeft, personUnitsLeft, dailyShare, peopleUsage,
} from '../ai/settings.js'
import { activeKey, keyInfo, checkKey, saveKey, removeKey } from '../ai/apiKey.js'
import {
  createConversation, loadConversation, runTurn, confirmAction, cancelAction, displayItems, chatContext, isRunning,
  saveFormCard, FORM_SUMMARY_MAX, undoAction, undoUntil, WAIT_DAYS, CHECK_TOOLS,
} from '../ai/chat.js'
import { audienceTools } from '../ai/tools/index.js'
import { ACTION_LABELS } from '../../../shared/pepperActions.js'
import { wantsStream, eventStream, errorEvent } from '../ai/sse.js'
import { staffInstructions } from '../ai/prompts.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'
import { saveUpload, loadOwnAttachment, deleteUnsent, MAX_BYTES, MAX_PER_MESSAGE } from '../ai/attachments.js'

// A real day: 2026-02-31 matches the pattern but isn't one.
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(s => !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s, 'Not a real date')
const ChatBody = z.object({
  conversation_id: z.string().uuid().optional(),
  message:         z.string().trim().max(2000).default(''),
  attachments:     z.array(z.string().uuid()).max(MAX_PER_MESSAGE).default([]),
  // The page the message was sent from (the Ask Pepper drawer): see pageNote().
  // Context only: a page that doesn't fit is dropped, never a reason to refuse
  // the message (a starter report's address holds a colon).
  page: z.object({
    path:     z.string().max(200).regex(/^\/[A-Za-z0-9/_:%.-]*$/),
    venue_id: z.string().uuid().optional(),
    date:     YMD.optional(),
    week:     YMD.optional(),
    // A report page: the report open (a saved report's id or starter:<key>),
    // what a new one in the builder is about, the period and venues it shows.
    report: z.object({
      id:      z.string().max(80).regex(/^(starter:[a-z0-9_]{1,70}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/).optional(),
      subject: z.string().max(60).regex(/^[a-z_]+(\.[a-z_]+)?$/).optional(),
      from:    YMD.optional(),
      to:      YMD.optional(),
      venue_ids: z.array(z.string().uuid()).max(50).optional(),
    }).optional().catch(undefined),
  }).optional().catch(undefined),
  // Said aloud (talk mode, migration 261): Pepper answers in a sentence or two.
  voice: z.boolean().optional(),
}).refine(b => b.message || b.attachments.length, { message: 'Type a message or attach a file' })

// Largest single upload (the PDF limit); detectFile() then applies the
// limit for what the file turns out to be.
const MAX_UPLOAD = Math.max(...Object.values(MAX_BYTES))

const SettingsBody = z.object({
  guest_mcp_enabled:   z.boolean().optional(),
  guest_chat_enabled:  z.boolean().optional(),
  staff_enabled:       z.boolean().optional(),
  web_search:          z.boolean().optional(),
  person_daily_pct:    z.number().int().min(1).max(100).nullable().optional(),
  chat_retention_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).optional(),
  voice_confirm:       z.boolean().optional(),
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
  if (!(await chatConfigured())) throw httpError(503, ASSISTANT_NAME + ' isn\'t set up on this server yet.')
  const settings = await getAiSettings(req.tenantId)
  if (!settings.staff_enabled) throw httpError(403, ASSISTANT_NAME + ' is switched off for this restaurant group.')
  if (await permissionLevel(req, 'ai_assistant') === 'none') throw httpError(403, 'You don\'t have access to ' + ASSISTANT_NAME + '.')
}

/** The caller's own staff chat. */
async function ownConversation(req, id) {
  const conv = await loadConversation(req.tenantId, id)
  if (!conv || conv.channel !== 'staff_chat' || conv.user_sub !== req.user.sub) throw httpError(404, 'Conversation not found')
  return conv
}

const closedNow = async (req, conv) => !!(await loadConversation(req.tenantId, conv.id))?.closed_at

/** A till PIN on a shared device may answer a check card only (CHECK_TOOLS:
 *  docs/PEPPER_FIRST.md 13 decision 6); any other card needs an office PIN. */
async function checkCardOnly(req) {
  const id = z.string().uuid().safeParse(req.params?.id)
  if (!id.success || !req.tenantId) return false
  const [a] = await withTenant(req.tenantId, tx => tx`
    SELECT tool FROM ai_pending_actions WHERE id = ${id.data} AND tenant_id = ${req.tenantId}`)
  return !!a && CHECK_TOOLS.has(a.tool)
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
    if (!req.tenantId) return { configured, enabled: false, permission: 'none', can_chat: false, web_search: false, units_left: null, share_left: null }
    const settings = await getAiSettings(req.tenantId)
    const level = await permissionLevel(req, 'ai_assistant')
    const share = level === 'none' ? null : await personUnitsLeft(req.tenantId, req.user.sub)
    return {
      configured,
      enabled:      settings.staff_enabled,
      permission:   level,
      can_chat:     configured && settings.staff_enabled && level !== 'none',
      // Web search is on for the group's staff chats (Settings; migration 242).
      web_search:   settings.staff_enabled && settings.web_search,
      // A spoken yes confirms check cards (migration 261; VOICE_CONFIRM_TOOLS).
      voice_confirm: settings.staff_enabled && settings.voice_confirm,
      units_left:   level === 'none' ? null : Math.max(0, await chatUnitsLeft(req.tenantId)),
      share_left:   share === null ? null : Math.max(0, share),
    }
  })

  app.get('/conversations', async req => {
    return withTenant(req.tenantId, tx => tx`
      SELECT id, title, created_at, updated_at, closed_at IS NOT NULL AS closed FROM ai_conversations
       WHERE tenant_id = ${req.tenantId} AND channel = 'staff_chat' AND user_sub = ${req.user.sub}
       ORDER BY updated_at DESC
       LIMIT 30
    `)
  })

  // running: a turn is still going (another tab, or a stream that dropped):
  // the chat asks again until it isn't.
  app.get('/conversations/:id', async req => {
    const conv = await ownConversation(req, req.params.id)
    return {
      id: conv.id, title: conv.title, closed: !!conv.closed_at, running: isRunning(conv),
      items: await displayItems(conv),
    }
  })

  app.delete('/conversations/:id', async req => {
    const conv = await ownConversation(req, req.params.id)
    await withTenant(req.tenantId, tx => tx`DELETE FROM ai_conversations WHERE id = ${conv.id} AND tenant_id = ${req.tenantId}`)
    return { ok: true }
  })

  // With Accept: text/event-stream the turn streams (src/ai/sse.js): start,
  // text, activity, step, card, discard, then done (the same body the JSON
  // reply has) or error.
  // The chat, its files, Cancel and a form card's saved line change nothing
  // themselves: no person needed on a shared device. Confirm and Undo do.
  app.post('/chat', { config: { sharedDevice: FREE } }, async (req, reply) => {
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
    const stream = wantsStream(req) ? eventStream(reply) : null
    // conversation_id null: a new chat's only message was refused and taken
    // back out, so there is no chat any more.
    const done = async out => {
      const gone = !(await loadConversation(req.tenantId, conv.id))
      return {
        conversation_id: gone ? null : conv.id, title: gone ? null : conv.title, stop_reason: out.stopReason, notice: out.notice,
        items: gone ? [] : await displayItems(conv),
      }
    }
    if (!stream) {
      return done(await run(() => runTurn(chatContext(app, conv, { req }), conv, body.message, { attachments: body.attachments, page: body.page, voice: !!body.voice })))
    }
    try {
      const out = await runTurn(chatContext(app, conv, { req }), conv, body.message, { attachments: body.attachments, page: body.page, voice: !!body.voice, emit: stream.send })
      stream.send({ type: 'done', ...(await done(out)) })
    } catch (err) {
      if (!stream.open) throw err instanceof ToolError ? httpError(err.status || 400, err.message) : err
      stream.send({ ...errorEvent(req, err), conversation_id: conv.id })
    }
    stream.end()
    return reply
  })

  // ── Attached files ──────────────────────────────────────
  app.post('/attachments', { config: { sharedDevice: FREE } }, async (req, reply) => {
    await staffChatAllowed(req)
    if (!req.isMultipart()) throw httpError(400, 'Expected multipart/form-data')
    let file = null
    for await (const part of req.parts()) {
      if (part.type !== 'file' || part.fieldname !== 'file') continue
      const chunks = []
      let total = 0
      for await (const chunk of part.file) {
        total += chunk.length
        if (total > MAX_UPLOAD) throw httpError(413, 'Files can be up to ' + Math.round(MAX_UPLOAD / 1024 / 1024) + ' MB.')
        chunks.push(chunk)
      }
      file = { buffer: Buffer.concat(chunks), filename: part.filename }
    }
    if (!file) throw httpError(400, 'No file provided')
    const saved = await run(() => saveUpload({ tenantId: req.tenantId, userSub: req.user.sub, ...file }))
    return reply.code(201).send(saved)
  })

  app.get('/attachments/:id', async (req, reply) => {
    const id = z.string().uuid().safeParse(req.params.id)
    const file = id.success ? await loadOwnAttachment(req.tenantId, req.user.sub, id.data) : null
    if (!file) throw httpError(404, 'File not found')
    return reply
      .header('Content-Type', file.kind === 'text' ? 'text/plain; charset=utf-8' : file.media_type)
      .header('Content-Disposition', 'inline; filename="' + file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') + '"')
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .send(file.data)
  })

  app.delete('/attachments/:id', { config: { sharedDevice: FREE } }, async req => {
    const id = z.string().uuid().safeParse(req.params.id)
    if (!id.success || !(await deleteUnsent(req.tenantId, req.user.sub, id.data))) throw httpError(404, 'File not found')
    return { ok: true }
  })

  app.post('/actions/:id/confirm', { config: { sharedDevice: { till: checkCardOnly } } }, async req => {
    await staffChatAllowed(req)
    // via: 'voice' = a spoken yes (talk mode): only check cards, only when the
    // group allows it (confirmAction() checks both).
    // word: what the person typed on a destructive card; values: fields they
    // changed on the card (its tool's editable ones, step 4b), checked by the
    // tool's own schema in confirmAction().
    const body = req.body ?? {}
    const via = z.object({ via: z.enum(['tap', 'voice']).optional() }).catch({}).parse(body).via ?? 'tap'
    const parsed = z.object({
      word:   z.string().max(100).optional(),
      values: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
        .refine(v => Object.keys(v).length <= 10, 'Too many fields').optional(),
    }).safeParse(body)
    if (!parsed.success) throw httpError(422, 'The card\'s fields couldn\'t be read: ' + parsed.error.issues[0].message)
    const conv = await actionConversation(req, req.params.id)
    await run(() => confirmAction(chatContext(app, conv, { req }), conv, req.params.id, { via, word: parsed.data.word ?? null, values: parsed.data.values ?? null }))
    // An anonymise card closes the chat it ran in (ai/erase.js).
    return { conversation_id: conv.id, closed: await closedNow(req, conv), items: await displayItems(conv) }
  })

  // Undo on a done card (step 4d): a reversible change, within UNDO_MINUTES,
  // the person's own card only (another person's is not found). No model call,
  // so it needs only access to Pepper, not the chat being set up.
  app.post('/actions/:id/undo', { config: { sharedDevice: { till: checkCardOnly } } }, async req => {
    if (await permissionLevel(req, 'ai_assistant') === 'none') throw httpError(403, 'You don\'t have access to ' + ASSISTANT_NAME + '.')
    const conv = await actionConversation(req, req.params.id)
    await run(() => undoAction(chatContext(app, conv, { req }), conv, req.params.id))
    return { conversation_id: conv.id, closed: await closedNow(req, conv), items: await displayItems(conv) }
  })

  app.post('/actions/:id/cancel', { config: { sharedDevice: FREE } }, async req => {
    const conv = await actionConversation(req, req.params.id)
    await run(() => cancelAction(chatContext(app, conv, { req }), conv, req.params.id))
    return { conversation_id: conv.id, closed: await closedNow(req, conv), items: await displayItems(conv) }
  })

  // A form opened from a form card was saved: what was saved, for the card.
  app.post('/conversations/:id/forms/:toolUseId', { config: { sharedDevice: FREE } }, async req => {
    await staffChatAllowed(req)
    const { summary } = z.object({ summary: z.string().trim().min(1).max(FORM_SUMMARY_MAX * 2) }).parse(req.body ?? {})
    const toolUseId = z.string().max(120).regex(/^[A-Za-z0-9_-]+$/).parse(req.params.toolUseId)
    const conv = await ownConversation(req, req.params.id)
    await run(() => saveFormCard(chatContext(app, conv, { req }), conv, toolUseId, summary))
    return { conversation_id: conv.id, closed: await closedNow(req, conv), items: await displayItems(conv) }
  })

  // ── Settings ────────────────────────────────────────────
  app.get('/settings', { preHandler: requirePermission('ai_assistant', 'view') }, async req => {
    const [t] = await sql`SELECT slug FROM tenants WHERE id = ${req.tenantId}`
    const [settings, usage, people, level] = await Promise.all([
      getAiSettings(req.tenantId), monthUsage(req.tenantId), peopleUsage(req.tenantId), permissionLevel(req, 'ai_assistant'),
    ])
    const canManage = level === 'manage'
    return {
      settings,
      usage,
      daily_share:     dailyShare(settings),
      // Who uses how much: everyone for a manager, else just the caller.
      people:          canManage ? people : people.filter(p => p.user_sub === req.user.sub),
      chat_configured: await chatConfigured(),
      guest_mcp_url:   mcpOrigin() + '/mcp',
      staff_mcp_url:   mcpOrigin() + '/mcp/staff/' + t.slug,
      can_manage:      canManage,
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
      SELECT k.id, k.name, k.token_prefix, k.created_at, k.last_used_at, k.revoked_at, k.expires_at, k.read_only,
             (k.expires_at <= now()) AS expired,
             u.email AS user_email, (u.auth0_user_id = ${req.user.sub}) AS mine
        FROM ai_access_tokens k
        JOIN users u ON u.id = k.user_id
       WHERE k.tenant_id = ${req.tenantId}
         AND (${manage} OR u.auth0_user_id = ${req.user.sub})
       ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC
    `)
  })

  app.post('/tokens', { preHandler: requirePermission('ai_assistant', 'view') }, async (req, reply) => {
    // Every token expires (migration 179); a read-only one offers and runs
    // only the tools that read.
    const { name, expires_in_days, read_only } = z.object({
      name:            z.string().trim().min(1).max(80),
      expires_in_days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).default(90),
      read_only:       z.boolean().default(false),
    }).parse(req.body)
    const [user] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} AND is_active = true LIMIT 1
    `)
    if (!user) throw httpError(422, 'Access tokens are for team members of this restaurant group. Ask an owner to invite you.')
    const { token, hash, prefix } = newAccessToken()
    const [row] = await tenantSql(req.tenantId)`
      INSERT INTO ai_access_tokens (tenant_id, user_id, name, token_prefix, token_hash, expires_at, read_only)
      VALUES (${req.tenantId}, ${user.id}, ${name}, ${prefix}, ${hash},
              now() + make_interval(days => ${expires_in_days}), ${read_only})
      RETURNING id, name, token_prefix, created_at, expires_at, read_only
    `
    return reply.code(201).send({ ...row, token })
  })

  app.delete('/tokens/:id', { preHandler: requirePermission('ai_assistant', 'view') }, async req => {
    const manage = await permissionLevel(req, 'ai_assistant') === 'manage'
    const [row] = await tenantSql(req.tenantId)`
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

  // ── Done by Pepper (Pepper-first step 4e) ───────────────
  // The audit's staff changes (chat and the staff connector), newest first:
  // who, when, which tool and its class, what the card said (title, lines,
  // before and after), how it went, and Undo while it is open on the
  // person's own reversible changes. Everyone's only with Manage on Pepper;
  // listed by time, never ranked or counted per person (decision 8).
  const DoneQuery = z.object({
    venue_id: z.string().uuid().optional(),
    day:      YMD.optional(),
    who:      z.enum(['mine', 'all']).default('mine'),
  })
  app.get('/done', { preHandler: requirePermission('ai_assistant', 'view') }, async req => {
    const q = DoneQuery.safeParse(req.query ?? {})
    if (!q.success) throw httpError(422, 'Pick a venue, a day (YYYY-MM-DD) and whose changes.')
    const { venue_id: venueId, day, who } = q.data
    const canAll = await permissionLevel(req, 'ai_assistant') === 'manage'
    if (who === 'all' && !canAll) throw httpError(403, 'Only a manager of ' + ASSISTANT_NAME + ' sees everyone\'s changes.')
    return withTenant(req.tenantId, async tx => {
      let tz = 'UTC'
      if (venueId) {
        const [v] = await tx`SELECT timezone FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}`
        if (!v) throw httpError(404, 'Venue not found')
        tz = v.timezone || 'UTC'
      } else {
        const [v] = await tx`SELECT timezone FROM venues WHERE tenant_id = ${req.tenantId} AND is_active = true ORDER BY name LIMIT 1`
        tz = v?.timezone || 'UTC'
      }
      const me = req.user.sub
      const email = req.user.email || null
      const rows = await tx`
        SELECT a.id, a.created_at, a.channel, a.actor, a.user_sub, a.tool, a.ok, a.result, a.action_id, a.undo_of,
               v.id AS venue_id, v.name AS venue_name,
               p.id AS card_id, p.tool AS card_tool, p.card, p.status AS card_status, p.result AS card_result,
               p.decided_at, p.undone_at, c.user_sub AS card_owner
          FROM ai_actions a
          LEFT JOIN bookings b ON b.id = a.booking_id AND b.tenant_id = a.tenant_id
          LEFT JOIN venues v ON v.id = COALESCE(a.venue_id, b.venue_id) AND v.tenant_id = a.tenant_id
          LEFT JOIN ai_pending_actions p ON p.id = COALESCE(a.action_id, a.undo_of) AND p.tenant_id = a.tenant_id
          LEFT JOIN ai_conversations c ON c.id = p.conversation_id AND c.tenant_id = a.tenant_id
         WHERE a.tenant_id = ${req.tenantId}
           AND a.channel IN ('staff_chat', 'staff_mcp')
           AND (${who === 'all'} OR a.user_sub = ${me} OR (a.user_sub IS NULL AND ${email}::text IS NOT NULL AND a.actor = ${email}))
           AND (${!venueId} OR v.id = ${venueId ?? null}::uuid)
           AND (${!day} OR (a.created_at AT TIME ZONE COALESCE(v.timezone, ${tz}))::date = ${day ?? null}::date)
         ORDER BY a.created_at DESC
         LIMIT 200
      `
      const classOf = new Map(audienceTools('staff').map(t => [t.name, t.class]))
      const lines = v => (Array.isArray(v) ? v.map(String) : [])
      return {
        can_see_all: canAll,
        who,
        rows: rows.map(r => {
          const mine = r.user_sub === me
          const card = r.card || null
          const pending = r.card_id ? { tool: r.card_tool, status: r.card_status, result: r.card_result, decided_at: r.decided_at, undone_at: r.undone_at } : null
          // Undo from here: the person's own card, on its own row (not an Undo's), while it is open.
          const until = mine && r.card_owner === me && r.action_id && !r.undo_of && pending ? undoUntil(pending) : null
          return {
            id: r.id,
            at: r.created_at,
            who: mine ? null : (r.actor || null),
            mine,
            channel: r.channel,
            tool: r.tool,
            label: r.undo_of ? 'Undid: ' + (ACTION_LABELS[r.tool] || r.tool) : (ACTION_LABELS[r.tool] || r.tool),
            class: classOf.get(r.tool) || null,
            ok: r.ok,
            title: card?.title ?? null,
            lines: r.undo_of ? [] : lines(card?.lines),
            before: r.undo_of ? [] : lines(card?.before),
            after: r.undo_of ? [] : lines(card?.after),
            message: r.ok ? (r.result?.message ?? null) : (r.result?.error ?? null),
            venue: r.venue_name ?? null,
            venue_id: r.venue_id ?? null,
            undo: !!r.undo_of,
            undone: !r.undo_of && !!r.undone_at,
            card_id: until ? r.card_id : null,
            undo_until: until ? until.toISOString() : null,
          }
        }),
      }
    })
  })

  // ── For review (Pepper-first step 5c) ──────────────────
  // Waiting: what a person has to look at before it takes effect. Each item
  // says what it is, where it came from and why, and how to answer it: a card
  // is approved through its own Confirm (POST /actions/:id/confirm: the typed
  // word for a destructive one, one write per card) or Cancel; a supplier
  // order opens its own approval (or goes back with a note); an invoice opens
  // its delivery. Cards of one kind that can be undone (class reversible) may
  // be approved together, one Confirm each; nothing above that is (never
  // money, pay, allergens or a deletion). Open to everyone signed in: each
  // part needs its own module and is left out (named) without it.
  app.get('/review', async req => {
    if (!req.tenantId) throw httpError(404, 'Choose a restaurant group first')
    const countOnly = req.query?.count === '1'
    const items = []
    const notIncluded = []
    const errors = []
    if (await permissionLevel(req, 'ai_assistant') !== 'none') {
      const cards = await withTenant(req.tenantId, tx => tx`
        SELECT p.id, p.tool, p.card, p.created_at, p.expires_at, p.conversation_id, c.title AS chat_title
          FROM ai_pending_actions p
          JOIN ai_conversations c ON c.id = p.conversation_id AND c.tenant_id = p.tenant_id
         WHERE p.tenant_id = ${req.tenantId} AND c.channel = 'staff_chat' AND c.user_sub = ${req.user.sub}
           AND c.closed_at IS NULL AND p.status = 'pending' AND p.decided_at IS NULL AND p.expires_at > now()
         ORDER BY p.created_at DESC
         LIMIT 100`)
      for (const a of cards) {
        const klass = a.card?.class || 'consequential'
        items.push({
          kind: 'card', id: a.id, tool: a.tool, label: ACTION_LABELS[a.tool] || a.tool,
          title: a.card?.title || ACTION_LABELS[a.tool] || a.tool,
          lines: Array.isArray(a.card?.lines) ? a.card.lines.slice(0, 8).map(String) : [],
          before: Array.isArray(a.card?.before) ? a.card.before.map(String) : [],
          after: Array.isArray(a.card?.after) ? a.card.after.map(String) : [],
          warnings: Array.isArray(a.card?.warnings) ? a.card.warnings.map(String) : [],
          class: klass, confirm_word: klass === 'destructive' ? (a.card?.confirm_word || 'CONFIRM') : null,
          confirm_label: a.card?.confirmLabel || 'Confirm',
          source: 'Proposed by ' + ASSISTANT_NAME + ' in the chat' + (a.chat_title ? ' "' + a.chat_title + '"' : ''),
          conversation_id: a.conversation_id, at: a.created_at, waits_until: a.expires_at,
          together: klass === 'reversible',
        })
      }
    } else notIncluded.push('cards')

    const ctx = makeContext({
      app, channel: 'staff_chat', tenantId: req.tenantId, log: req.log,
      auth: staffAuthOf(req),
      principal: staffPrincipalOf(req),
      actor: req.user.email || req.user.sub,
    })
    const part = async (name, fn) => {
      try { await fn() } catch (err) {
        if (err instanceof ToolError && err.status === 403) notIncluded.push(name)
        else errors.push({ part: name, message: err instanceof ToolError ? err.message : 'Couldn\'t load this part' })
      }
    }
    if (await permissionLevel(req, 'purchasing_approve') === 'manage') {
      await part('supplier_orders', async () => {
        const orders = await callApi(ctx, 'GET', '/api/purchasing/orders?status=requested')
        for (const o of orders) {
          items.push({
            kind: 'supplier_order', id: o.id, label: 'Supplier order',
            title: 'Supplier order for ' + o.venue_name + (o.list_name ? ' (' + o.list_name + ')' : ''),
            lines: [o.line_count + (o.line_count === 1 ? ' line' : ' lines') + (o.notes ? ' · ' + String(o.notes).slice(0, 120) : '')],
            source: 'Asked for by ' + (o.requested_by || 'someone') + ', waiting for approval',
            venue_id: o.venue_id, at: o.requested_at, open: '/purchasing?order=' + o.id, can_reject: true, together: false,
          })
        }
      })
    } else notIncluded.push('supplier_orders')
    await part('invoices', async () => {
      const rows = await callApi(ctx, 'GET', '/api/purchasing/invoices/waiting')
      for (const r of rows) {
        items.push({
          kind: 'invoice', id: r.id, label: 'Invoice read',
          title: 'Invoice from ' + r.supplier_name + (r.invoice_number ? ' ' + r.invoice_number : '') + ' for ' + r.venue_name,
          lines: [r.line_count + (r.line_count === 1 ? ' line read' : ' lines read') + (r.delivery_date ? ' · delivery ' + r.delivery_date : '')],
          source: 'Read by ' + ASSISTANT_NAME + ' from a photo or PDF' + (r.read_by ? ' for ' + r.read_by : '') + ': not booked in yet',
          venue_id: r.venue_id, at: r.read_at, open: '/purchasing?po=' + r.po_id, can_reject: false, together: false,
        })
      }
    })
    if (countOnly) return { count: items.length }
    return {
      wait_days: WAIT_DAYS, count: items.length,
      items: items.sort((a, b) => new Date(b.at) - new Date(a.at)),
      ...(notIncluded.length ? { not_included: notIncluded } : {}),
      ...(errors.length ? { errors } : {}),
    }
  })

  // ── Platform admin: monthly limits ──────────────────────
  app.get('/platform/tenants', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await systemSql`
      SELECT t.id, t.name, t.slug,
             COALESCE(s.monthly_token_limit, 2000000) AS monthly_token_limit,
             COALESCE(s.staff_enabled, true)          AS staff_enabled,
             COALESCE(s.guest_mcp_enabled, true)      AS guest_mcp_enabled,
             COALESCE(s.guest_chat_enabled, false)    AS guest_chat_enabled,
             COALESCE(s.web_search, false)            AS web_search,
             COALESCE((SELECT sum(u.web_searches) FROM ai_usage u
                        WHERE u.tenant_id = t.id AND u.month = ${usageMonth()}), 0) AS web_searches,
             COALESCE((SELECT sum(u.units) FROM ai_usage u
                        WHERE u.tenant_id = t.id AND u.month = ${usageMonth()}
                          AND u.channel IN ('staff_chat', 'guest_chat')), 0) AS chat_units,
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
      tenants: rows.map(r => ({
        ...r, monthly_token_limit: Number(r.monthly_token_limit), chat_units: Number(r.chat_units),
        mcp_calls: Number(r.mcp_calls), web_searches: Number(r.web_searches),
      })),
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
