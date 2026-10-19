// src/ai/chat.js
//
// The chats (migration 148): the staff assistant in the admin portal and
// the guest chat block on a restaurant's website. One loop for both:
//
//   1. the person's message is stored, then the conversation goes to Claude
//      with the tools for its audience (src/ai/tools)
//   2. read tools run straight away; a tool marked `confirm` doesn't run: it
//      becomes an ai_pending_actions row (its card: describe()) and the model
//      is told a card is waiting. The person presses Confirm or Cancel
//      (confirmAction / cancelAction), the server runs the tool itself with
//      the input the model gave, and the outcome is added to the
//      conversation as a note the model reads on the next turn
//   3. repeat until the model stops calling tools (at most MAX_STEPS)
//
// Pepper (the staff chat) has well over a hundred tools, so only CORE_TOOLS
// are sent in full; the rest are sent with defer_loading and the model finds
// them with the tool search tool (tool_search_tool_bm25). The search runs on
// Anthropic's side: its server_tool_use and tool_search_tool_result blocks
// come back in the reply and are stored and replayed with it like any other
// block (they need no tool_result from us). The guest chat's few tools are
// all sent in full.
//
// Messages are stored exactly as the API returned them and only ever
// appended, with the conversation's own system prompt, so each request
// replays the conversation unchanged (thinking blocks stay valid, the
// prompt cache keeps hitting). Every response's tokens go to ai_usage; a
// chat is refused once the tenant's monthly limit is used up.
//
// Attached files (staff chat, src/ai/attachments.js) are stored as image /
// document blocks that reference an ai_attachments row; apiMessages() fills
// the file's data in on every request, so the bytes sent are always the same.
//
// Every model call streams (callModel()). When the person's browser asked for
// a stream (routes send `emit`), the reply's text goes out as it is written,
// with what Pepper is doing (thinking, looking something up, a card) and
// each step and card as it happens; the route then sends the finished
// conversation. Without `emit` the turn runs the same and the route answers
// once at the end.
//
// Model routing: a chat starts on the everyday model (AI_MODEL_FAST) and
// moves to the main one (AI_MODEL) for good when it needs it: a file is
// attached, a big job comes up (HEAVY_TOOLS: the everyday model's call is
// handed over, not run), the chat gets long, or the everyday model refuses.
// A chat never moves back down: the main model reads the everyday model's
// earlier thinking, but not the other way round.

import Anthropic from '@anthropic-ai/sdk'
import { sql, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { ToolError, makeContext, addUsage } from './context.js'
import { toolsFor, findTool, jsonSchemaOf, parseInput, errorText, CORE_TOOLS } from './tools/index.js'
import { chatUnitsLeft, personUnitsLeft } from './settings.js'
import { activeKey } from './apiKey.js'
import { longDate, localParts } from './tools/util.js'
import { ROUTE_CATALOG } from '../routes/nav.js'
import {
  claimAttachments, releaseAttachments, attachmentBlocks, loadAttachmentData, withFileData, attachmentItems,
} from './attachments.js'

const MAX_STEPS      = 12
const MAX_TOKENS     = 32000
const ACTION_MINUTES = 30
const MAX_MESSAGES   = 300   // stored rows per conversation; then start a new one

// A tool call cut off by MAX_TOKENS never ran: say how to fit it.
const CUT_OFF = 'Not done: your reply was cut off before this call was complete, so it was too big for one reply. ' +
  'Split it into smaller calls (fewer dishes, rows or changes per call: for a menu, a section or two at a time) and carry on.'

// The key is the one a platform admin saved, else ANTHROPIC_API_KEY
// (src/ai/apiKey.js); the client is rebuilt when it changes. The timeout
// covers waiting for a reply to start; a streaming reply can then run on.
let client = null, clientKey = null
async function anthropic() {
  const { key } = await activeKey()
  if (!key) throw new ToolError('The AI assistant isn\'t set up on this server.', 503)
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 })
    clientKey = key
  }
  return client
}

/**
 * One model call, streamed. `onEvent` (when the person's browser is
 * listening) gets the raw stream events; the whole message comes back as
 * create() would return it. A rejected key is the platform's problem, not
 * the person's: say so.
 */
async function callModel(params, onEvent, log) {
  const api = await anthropic()
  try {
    const stream = api.beta.messages.stream(params)
    if (onEvent) stream.on('streamEvent', onEvent)
    return await stream.finalMessage()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ToolError('The AI assistant\'s key isn\'t working. A platform admin needs to update it.', 503)
    }
    // Overloaded, rate limited, down or cut off mid-reply (after the SDK's
    // own retries): nothing the person can fix but wait.
    if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.RateLimitError ||
        (err instanceof Anthropic.APIError && (err.status == null || err.status >= 500))) {
      log?.warn({ status: err.status, type: err.error?.error?.type, message: err.message }, 'Claude API error')
      throw new ToolError('Claude is busy or can\'t be reached right now. Try again in a moment.', 503)
    }
    throw err
  }
}

// ── Which model ──────────────────────────────────────────

// Tools whose calls are big jobs worth the main model (building a menu,
// importing a price list): the everyday model's call is handed back unrun,
// and the main model makes it again.
const HEAVY_TOOLS = new Set(['create_menu', 'add_dishes', 'import_price_list'])
// A request this many prompt tokens long makes it a long chat.
const LONG_CHAT_TOKENS = 60_000
const HANDOVER = 'Not run yet: big jobs like this one are done with more care. Make this call again now, checking every detail.'

const routing = () => !!env.AI_MODEL_FAST && env.AI_MODEL_FAST !== env.AI_MODEL
/** The tier a new chat starts on. */
export const startTier = () => (routing() ? 'fast' : 'main')
const onFast  = conv => routing() && conv.model_tier === 'fast'
export const modelOf = conv => (onFast(conv) ? env.AI_MODEL_FAST : env.AI_MODEL)

/** Moves a chat to the main model, for good. */
async function upgradeChat(ctx, conv, why) {
  if (!onFast(conv)) return
  await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_conversations SET model_tier = 'main' WHERE id = ${conv.id} AND tenant_id = ${conv.tenant_id}
  `)
  conv.model_tier = 'main'
  ctx.log?.info({ conversation: conv.id, why }, 'AI chat moved to the main model')
}

const promptTokens = usage =>
  (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0)

// Server-side fallback (a refused request re-run on another model) isn't
// offered for every model; those are sent without it.
const NO_FALLBACK = model => /^claude-haiku/.test(model)

function requestFor(conv, model, tools, messages) {
  return {
    model,
    max_tokens:    MAX_TOKENS,
    ...(NO_FALLBACK(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    output_config: { effort: env.AI_EFFORT },
    cache_control: { type: 'ephemeral' },
    system:        conv.system_prompt,
    tools,
    messages,
  }
}

// One writer at a time per conversation, across every API process (PM2 runs
// one per CPU): a turn, a Confirm and a Cancel each hold
// ai_conversations.running_until while they write to the history. A second
// message meanwhile would interleave the turns, and a Confirm note landing
// between a tool call and its result breaks every later request in the chat.
// The hold is renewed while the turn runs and lapses by itself if the
// process dies (a restart mid-turn blocks the chat for LOCK_SECONDS at most).
const LOCK_SECONDS = 90
const BEAT_MS      = 30_000
// A turn stops starting new steps after this, so its reply gets back before
// the proxy gives up on the request (nginx gives /api/ai/ 300 s). A streamed
// turn keeps the connection busy, so it can run longer.
const TURN_MS        = 240_000
const STREAM_TURN_MS = 600_000

async function holdConversation(conv, busyText) {
  const until = LOCK_SECONDS + ' seconds'
  const [row] = await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_conversations SET running_until = date_trunc('milliseconds', now() + ${until}::interval)
     WHERE id = ${conv.id} AND tenant_id = ${conv.tenant_id}
       AND (running_until IS NULL OR running_until < now())
    RETURNING running_until
  `)
  if (!row) throw new ToolError(busyText, 409)
  let held = row.running_until
  let beat = Promise.resolve()
  const timer = setInterval(() => {
    beat = beat.then(async () => {
      const [r] = await withTenant(conv.tenant_id, tx => tx`
        UPDATE ai_conversations SET running_until = date_trunc('milliseconds', now() + ${until}::interval)
         WHERE id = ${conv.id} AND running_until = ${held}
        RETURNING running_until
      `)
      if (r) held = r.running_until
    }).catch(() => {})
  }, BEAT_MS)
  timer.unref?.()
  return async () => {
    clearInterval(timer)
    await beat
    await withTenant(conv.tenant_id, tx => tx`
      UPDATE ai_conversations SET running_until = NULL WHERE id = ${conv.id} AND running_until = ${held}
    `).catch(() => {})
  }
}

async function withHold(conv, busyText, fn) {
  const release = await holdConversation(conv, busyText)
  try {
    return await fn()
  } finally {
    await release()
  }
}

const BUSY_TURN = 'Still working on your last message.'
const BUSY_CARD = 'Still working on the last message: press it again in a moment.'

// ── Storage ──────────────────────────────────────────────

export async function createConversation({ tenantId, channel, userSub = null, userEmail = null, guestKey = null, venueId = null, systemPrompt }) {
  const [row] = await withTenant(tenantId, tx => tx`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, guest_key, venue_id, system_prompt, model_tier)
    VALUES (${tenantId}, ${channel}, ${userSub}, ${userEmail}, ${guestKey}, ${venueId}, ${systemPrompt}, ${startTier()})
    RETURNING *
  `)
  return row
}

/** Whether a turn, a Confirm or a Cancel holds the chat right now. */
export const isRunning = conv => !!conv.running_until && new Date(conv.running_until).getTime() > Date.now()

export async function loadConversation(tenantId, id) {
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT * FROM ai_conversations WHERE id = ${id} AND tenant_id = ${tenantId}
  `)
  return row ?? null
}

async function loadMessages(conv) {
  return withTenant(conv.tenant_id, tx => tx`
    SELECT seq, role, content, created_at FROM ai_messages
     WHERE conversation_id = ${conv.id} AND tenant_id = ${conv.tenant_id}
     ORDER BY seq
  `)
}

async function appendMessage(conv, role, content) {
  return withTenant(conv.tenant_id, async tx => {
    const [{ next }] = await tx`
      SELECT COALESCE(max(seq), 0) + 1 AS next FROM ai_messages WHERE conversation_id = ${conv.id}
    `
    await tx`
      INSERT INTO ai_messages (conversation_id, tenant_id, seq, role, content)
      VALUES (${conv.id}, ${conv.tenant_id}, ${next}, ${role}, ${tx.json(content)})
    `
    await tx`UPDATE ai_conversations SET updated_at = now() WHERE id = ${conv.id}`
    return next
  })
}

// Our own markers on stored user blocks (never sent to the API):
//   _note: 'action'   the outcome of a Confirm / Cancel press
//   _context          the app's lines before a message (contextNote(): the date
//                     and time now, the page it was sent from): sent to the
//                     model, not shown in the chat (_page on older messages)
//   _attachment       an attached file: its data is filled in from `files`
const clean = (block, files) => {
  if (!block || typeof block !== 'object') return block
  if (block._attachment) return withFileData(block, files)
  const { _note, _page, _context, ...rest } = block
  return rest
}

/**
 * "Ask about this page": the page the person sent a message from (the
 * drawer sends { path, venue_id, date, week }) as a line for the model,
 * stored with the message as a hidden _page block. The page's name comes
 * from the route catalogue, the venue's from the tenant's own venues (an id
 * that isn't theirs is left out), so nothing the browser sends is passed on
 * as given. Null when there is nothing worth saying.
 */
export async function pageNote(tenantId, page) {
  if (!page?.path) return null
  const path = page.path
  let best = null
  for (const r of ROUTE_CATALOG) {
    if ((path === r.route || (r.route !== '/' && path.startsWith(r.route + '/'))) && (!best || r.route.length > best.route.length)) best = r
  }
  let venue = null
  if (page.venue_id) {
    const [v] = await withTenant(tenantId, tx => tx`
      SELECT id, name FROM venues WHERE id = ${page.venue_id} AND tenant_id = ${tenantId}
    `)
    venue = v || null
  }
  const bits = []
  if (venue) bits.push('venue ' + venue.name + ' (venue_id ' + venue.id + ')')
  if (page.date) bits.push(longDate(page.date) + ' (' + page.date + ')')
  else if (page.week) bits.push('the week starting ' + longDate(page.week) + ' (' + page.week + ')')
  if (!best && !bits.length) return null
  return '[Sent from ' + (best ? 'the ' + best.label + ' page (' + path + ')' : 'the page ' + path) +
    (bits.length ? ', showing ' + bits.join(', ') : '') + '.]'
}

/**
 * The date and time now at the tenant's venues, as a line for the model:
 * it has no clock of its own, and "today", "tonight" or "Saturday" can only
 * be worked out from this (without it the model guessed a date and blamed
 * "the app's clock"). Venues in one time zone share one date; venues in
 * several zones each get theirs. It goes with each message, never into the
 * system prompt, which is stored once and replayed with the cache.
 */
export async function nowNote(tenantId, now = new Date()) {
  const venues = await withTenant(tenantId, tx => tx`
    SELECT name, timezone FROM venues WHERE tenant_id = ${tenantId} AND is_active = true ORDER BY name
  `)
  const zones = new Map()
  for (const v of venues) {
    const tz = v.timezone || 'UTC'
    if (!zones.has(tz)) zones.set(tz, [])
    zones.get(tz).push(v.name)
  }
  if (!zones.size) zones.set('Europe/London', [])
  const parts = [...zones].map(([tz, names]) => {
    const p = localParts(now, tz)
    return longDate(p.date) + ' (' + p.date + '), ' + p.time + (zones.size > 1 ? ' at ' + names.join(', ') : '')
  })
  return '[Now: ' + parts.join('; ') + '.]'
}

/** The app's hidden lines before a staff message: now, then the page. */
export async function contextNote(tenantId, page) {
  const [now, from] = await Promise.all([nowNote(tenantId), pageNote(tenantId, page)])
  return [now, from].filter(Boolean).join('\n')
}

/** The stored history as API messages: our markers stripped, attached files'
 *  data filled in, back-to-back user rows (a note after the last reply, then
 *  the next message) merged. Merging only ever joins rows at the end, so
 *  earlier requests' messages are unchanged. */
function apiMessages(rows, files = new Map()) {
  const out = []
  for (const r of rows) {
    const content = (Array.isArray(r.content) ? r.content : [r.content]).map(b => clean(b, files))
    const last = out[out.length - 1]
    if (last && last.role === r.role && r.role === 'user') last.content = [...last.content, ...content]
    else out.push({ role: r.role, content })
  }
  return out
}

/** After a mid-output fallback, blocks the declining model wrote before the
 *  last fallback block are not echoed back (text is kept). */
function storableContent(content) {
  const blocks = content || []
  const lastFallback = blocks.map(b => b.type).lastIndexOf('fallback')
  if (lastFallback < 0) return blocks
  return blocks.filter((b, i) => i > lastFallback || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type))
}

// ── The loop ─────────────────────────────────────────────

// The tool search tool (Anthropic's BM25 search over the deferred tools'
// names, descriptions and inputs).
const TOOL_SEARCH = { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' }

export function toolDefs(ctx) {
  const tools = toolsFor(ctx)
  const defs = tools.map(t => ({ name: t.name, description: t.description, input_schema: jsonSchemaOf(t) }))
  if (ctx.channel !== 'staff_chat') return defs
  return [TOOL_SEARCH, ...defs.map(d => (CORE_TOOLS.has(d.name) ? d : { ...d, defer_loading: true }))]
}

async function recordUsage(conv, response) {
  const usage = response.usage
  if (!usage) return
  await addUsage(conv.tenant_id, conv.channel, {
    requests:   1,
    input:      usage.input_tokens || 0,
    output:     usage.output_tokens || 0,
    cacheRead:  usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    model:      response.model,
    person:     conv.channel === 'staff_chat' ? { sub: conv.user_sub, email: conv.user_email } : null,
  })
}

/** Runs one tool call from the model. Returns the tool_result block. A
 *  listening browser (`emit`) gets the step's line or the card. */
async function handleToolUse(ctx, conv, block, emit) {
  const tool = findTool(ctx, block.name)
  const result = (text, isError = false) => ({
    type: 'tool_result', tool_use_id: block.id,
    content: [{ type: 'text', text }],
    ...(isError ? { is_error: true } : {}),
  })
  if (!tool) return result('There is no tool called ' + block.name + '.', true)
  try {
    const input = parseInput(tool, block.input)
    if (!tool.confirm) return result(JSON.stringify(await tool.run(ctx, input)))

    const card = await tool.describe(ctx, input)
    const expires = card.expiresAt
      ? new Date(Math.min(new Date(card.expiresAt).getTime(), Date.now() + ACTION_MINUTES * 60_000))
      : new Date(Date.now() + ACTION_MINUTES * 60_000)
    // pin: what the card was worked out with (the day, the week, which order or
    // check time) replaces "today" / "now" / a day's order number in the stored
    // input, so Confirm does what the card says even after midnight.
    const { expiresAt, pin, ...cardData } = card
    const stored = pin ? parseInput(tool, { ...input, ...pin }) : input
    const [row] = await withTenant(conv.tenant_id, tx => tx`
      INSERT INTO ai_pending_actions (tenant_id, conversation_id, tool_use_id, tool, input, card, expires_at)
      VALUES (${conv.tenant_id}, ${conv.id}, ${block.id}, ${tool.name}, ${tx.json(stored)}, ${tx.json(cardData)}, ${expires})
      RETURNING *
    `)
    emit?.({ type: 'card', card: actionView(row) })
    const mins = Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000))
    return result('Not done yet: the ' + (ctx.channel === 'guest_chat' ? 'guest' : 'staff member') +
      ' now sees a card "' + card.title + '" with the details and a Confirm button, valid for ' + mins +
      ' minutes. Nothing changes until they press it; you will see the outcome in their next message. ' +
      'Do not call ' + tool.name + ' again for the same change.')
  } catch (err) {
    return result(errorText(err, ctx.log), true)
  } finally {
    if (!tool.confirm && TOOL_LABELS[tool.name]) emit?.({ type: 'step', text: TOOL_LABELS[tool.name] })
  }
}

/**
 * Adds the person's message (with any attached files: ids of their unsent
 * uploads) and runs the model until it answers. `ctx` is the tool context
 * for this conversation (makeContext()). `emit`, when the browser is
 * listening, gets the turn as it happens (see streamEvents()). Returns
 * { stopReason, notice }: notice is a line to show the person that isn't
 * part of the conversation (the turn stopped early, or was refused).
 */
export async function runTurn(ctx, conv, text, { attachments = [], emit = null, page = null } = {}) {
  return withHold(conv, BUSY_TURN, () => turn(ctx, conv, text, attachments, emit, page))
}

// What a listening browser hears while the model writes: its text as it
// comes (key: step and block, so the browser can put each piece in its
// place) and what it is doing. The browser's stream never stops the turn.
function streamEvents(ctx, emit, step) {
  return event => {
    try {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        emit({ type: 'text', key: step + '-' + event.index, delta: event.delta.text })
      } else if (event.type === 'content_block_start') {
        const b = event.content_block
        if (b.type === 'text') emit({ type: 'text', key: step + '-' + event.index, delta: b.text || '' })
        else if (b.type === 'thinking' || b.type === 'redacted_thinking') emit({ type: 'activity', text: 'Thinking...' })
        else if (b.type === 'server_tool_use') emit({ type: 'activity', text: 'Finding the right tool...' })
        else if (b.type === 'tool_use') {
          emit({ type: 'activity', text: findTool(ctx, b.name)?.confirm ? 'Getting a card ready...' : 'Looking it up...' })
        }
      }
    } catch { /* ignore */ }
  }
}

const NOTICES = {
  refusal:   'Sorry, I can\'t help with that one.',
  withdrawn: 'Sorry, I can\'t help with that one. I\'ve left that message out of the chat, so you can carry on with something else.',
  time:      'This is taking a while, so I\'ve stopped here. Tell me to carry on and I\'ll pick up where I left off.',
  max_steps: 'That took more steps than I can do at once. Tell me what to do next.',
}

async function turn(ctx, conv, text, attachments, emit, page) {
  const started = Date.now()
  const budget = emit ? STREAM_TURN_MS : TURN_MS
  if (conv.closed_at) {
    throw new ToolError('This chat had a guest\'s details erased from it, so it can\'t carry on. Start a new chat.', 409)
  }
  if (await chatUnitsLeft(conv.tenant_id) <= 0) {
    throw new ToolError('The AI assistant has used this month\'s allowance. It will be back next month.', 429)
  }
  if (conv.channel === 'staff_chat') {
    const mine = await personUnitsLeft(conv.tenant_id, conv.user_sub)
    if (mine !== null && mine <= 0) {
      throw new ToolError('You\'ve used your share of the AI allowance for today, so the rest of the team still has theirs. ' +
        'It starts again tomorrow; an owner or admin can change the share in the assistant\'s settings.', 429)
    }
  }
  const [{ n }] = await withTenant(conv.tenant_id, tx => tx`
    SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = ${conv.id}
  `)
  if (n >= MAX_MESSAGES) throw new ToolError('This conversation is getting long. Start a new one.', 422)
  const files = await claimAttachments(conv, ctx.principal?.sub, attachments)
  if (!files.length && !text) throw new ToolError('Type a message or attach a file.', 422)
  const note = conv.channel === 'staff_chat' ? await contextNote(conv.tenant_id, page) : null
  const userContent = [
    ...attachmentBlocks(files),
    ...(note ? [{ type: 'text', text: note, _context: true }] : []),
    ...(text ? [{ type: 'text', text }] : []),
  ]
  const userSeq = await appendMessage(conv, 'user', userContent)
  const newTitle = !conv.title
  if (newTitle) {
    const title = (text || files.map(f => f.filename).join(', ')).replace(/\s+/g, ' ').trim().slice(0, 80)
    await withTenant(conv.tenant_id, tx => tx`UPDATE ai_conversations SET title = ${title} WHERE id = ${conv.id}`)
    conv.title = title
  }
  // From here on the message is in the conversation: a listening browser can
  // show the turn as it happens (before this, a refusal is a plain error).
  emit?.({ type: 'start', conversation_id: conv.id, title: conv.title })
  const fileData = await loadAttachmentData(conv)
  // Reading a photo, a PDF or a spreadsheet is the main model's job.
  if (files.length) await upgradeChat(ctx, conv, 'files')

  const tools = toolDefs(ctx)
  let replied = false   // something of this turn's reply is in the history
  for (let step = 0; step < MAX_STEPS; step++) {
    const rows = await loadMessages(conv)
    let response
    try {
      response = await callModel(
        requestFor(conv, modelOf(conv), tools, apiMessages(rows, fileData)),
        emit && streamEvents(ctx, emit, step),
        ctx.log,
      )
    } catch (err) {
      // The model never read the new message (a file it can't take, a
      // request over the size limit): take the message back out, so the
      // conversation isn't left with something every later request trips on.
      if (step === 0 && (err instanceof Anthropic.BadRequestError || err?.status === 413)) {
        await withdrawMessage(conv, userSeq, files.map(f => f.id), newTitle)
        // withdrawn: a streaming browser puts the message back in the box.
        throw Object.assign(new ToolError((files.length
          ? 'Claude couldn\'t take the attached file' + (files.length > 1 ? 's' : '') + ' (' + apiErrorText(err) + '). Try a smaller file, or a screenshot of the part you need.'
          : 'Claude couldn\'t take that message (' + apiErrorText(err) + ').'), 422), { withdrawn: true })
      }
      throw err
    }
    await recordUsage(conv, response)

    if (response.stop_reason === 'refusal') {
      // Nothing of a refused reply is kept. The everyday model has no
      // server-side fallback: the main model takes the step again.
      emit?.({ type: 'discard', key: step + '-' })
      if (onFast(conv)) {
        await upgradeChat(ctx, conv, 'refusal')
        continue
      }
      // A refused message left in the history would be sent again with the
      // next one, and most likely refused again: take it back out.
      if (!replied) {
        await withdrawMessage(conv, userSeq, files.map(f => f.id), newTitle)
        return { stopReason: 'refusal', notice: NOTICES.withdrawn }
      }
      return { stopReason: 'refusal', notice: NOTICES.refusal }
    }
    const content = storableContent(response.content)
    if (!content.length) return { stopReason: response.stop_reason, notice: null }
    await appendMessage(conv, 'assistant', content)
    replied = true
    if (onFast(conv) && promptTokens(response.usage) >= LONG_CHAT_TOKENS) await upgradeChat(ctx, conv, 'long')

    // A long server-side step (a tool search) can pause the turn: send the
    // conversation back as it is and the model carries on.
    if (response.stop_reason === 'pause_turn') continue
    const toolUses = content.filter(b => b.type === 'tool_use')
    if (!toolUses.length) return { stopReason: response.stop_reason, notice: null }
    // Every tool_use needs its result in the next user message, even when
    // the reply was cut off (max_tokens), is handed over or we stop here.
    const handOver = response.stop_reason !== 'max_tokens' && onFast(conv) && toolUses.some(b => HEAVY_TOOLS.has(b.name))
    const results = []
    for (const b of toolUses) {
      results.push(response.stop_reason === 'max_tokens' ? errorResult(b, CUT_OFF)
        : handOver ? errorResult(b, HANDOVER)
        : await handleToolUse(ctx, conv, b, emit))
    }
    await appendMessage(conv, 'user', results)
    if (handOver) await upgradeChat(ctx, conv, 'heavy')
    // Stop between steps (every tool call answered), never after a paused
    // server step: the next message carries on from here.
    if (Date.now() - started > budget) return { stopReason: 'time', notice: NOTICES.time }
  }
  return { stopReason: 'max_steps', notice: NOTICES.max_steps }
}

const errorResult = (block, text) => ({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: [{ type: 'text', text }] })

const apiErrorText = err => String(err?.error?.error?.message || err?.message || 'request refused').slice(0, 300)

/** Takes back a message the model never read: only when it is still the
 *  last row, its files go back to unsent, and a chat left empty is removed. */
async function withdrawMessage(conv, seq, fileIds, clearTitle) {
  await withTenant(conv.tenant_id, async tx => {
    const [last] = await tx`SELECT max(seq) AS seq FROM ai_messages WHERE conversation_id = ${conv.id}`
    if (last?.seq !== seq) return
    await tx`DELETE FROM ai_messages WHERE conversation_id = ${conv.id} AND seq = ${seq} AND tenant_id = ${conv.tenant_id}`
    if (clearTitle) await tx`UPDATE ai_conversations SET title = NULL WHERE id = ${conv.id}`
  })
  await releaseAttachments(conv, fileIds)
  const [{ n }] = await withTenant(conv.tenant_id, tx => tx`
    SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = ${conv.id}
  `)
  if (n === 0) await withTenant(conv.tenant_id, tx => tx`DELETE FROM ai_conversations WHERE id = ${conv.id} AND tenant_id = ${conv.tenant_id}`)
}

// ── Confirm / Cancel on a card ───────────────────────────

async function loadAction(conv, actionId) {
  const [a] = await withTenant(conv.tenant_id, tx => tx`
    SELECT * FROM ai_pending_actions
     WHERE id = ${actionId} AND conversation_id = ${conv.id} AND tenant_id = ${conv.tenant_id}
  `)
  if (!a) throw new ToolError('That card no longer exists.', 404)
  return a
}

async function settle(conv, action, status, result, note) {
  await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_pending_actions
       SET status = ${status}, result = ${result ? tx.json(result) : null}, decided_at = now()
     WHERE id = ${action.id} AND status = 'pending'
  `)
  await appendMessage(conv, 'user', [{ type: 'text', text: note, _note: 'action' }])
}

/** Runs the card's tool with the stored input. Returns the updated card. */
export async function confirmAction(ctx, conv, actionId) {
  return withHold(conv, BUSY_CARD, () => confirmCard(ctx, conv, actionId))
}

export async function cancelAction(ctx, conv, actionId) {
  return withHold(conv, BUSY_CARD, () => cancelCard(ctx, conv, actionId))
}

async function confirmCard(ctx, conv, actionId) {
  const action = await loadAction(conv, actionId)
  if (action.status !== 'pending') throw new ToolError('This card has already been ' + (action.status === 'done' ? 'confirmed' : action.status) + '.', 409)
  const who = ctx.channel === 'guest_chat' ? 'The guest' : 'The staff member'
  if (new Date(action.expires_at).getTime() <= Date.now()) {
    await settle(conv, action, 'cancelled', { error: 'expired' },
      `[${who} pressed Confirm on "${action.card.title}" too late: the card had expired and nothing was changed.]`)
    throw new ToolError('This card has expired. Ask the assistant again.', 410)
  }
  // Claim it first so a double press can't run it twice.
  const [claimed] = await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_pending_actions SET decided_at = now()
     WHERE id = ${action.id} AND status = 'pending' AND decided_at IS NULL
    RETURNING id
  `)
  if (!claimed) throw new ToolError('This card is already being confirmed.', 409)

  const tool = findTool(ctx, action.tool)
  let result
  try {
    result = await tool.run(ctx, parseInput(tool, action.input))
  } catch (err) {
    const message = errorText(err, ctx.log)
    await withTenant(conv.tenant_id, tx => tx`
      UPDATE ai_pending_actions SET status = 'failed', result = ${tx.json({ error: message })} WHERE id = ${action.id}
    `)
    await appendMessage(conv, 'user', [{ type: 'text', _note: 'action',
      text: `[${who} pressed Confirm on "${await titleNow(conv, action)}" but it failed: ${message}]` }])
    return { ...(await cardView(conv, action.id)), error: message }
  }
  await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_pending_actions SET status = 'done', result = ${tx.json(result)} WHERE id = ${action.id}
  `)
  await appendMessage(conv, 'user', [{ type: 'text', _note: 'action',
    text: `[${who} pressed Confirm on "${await titleNow(conv, action)}". Done: ${JSON.stringify(result)}]` }])
  return cardView(conv, action.id)
}

/** The card's title after its tool ran: an erasure the tool made (anonymise)
 *  has redacted the guest's name in it, and the note mustn't put it back. */
async function titleNow(conv, action) {
  const [a] = await withTenant(conv.tenant_id, tx => tx`
    SELECT card FROM ai_pending_actions WHERE id = ${action.id} AND tenant_id = ${conv.tenant_id}
  `)
  return a?.card?.title ?? action.card.title
}

async function cancelCard(ctx, conv, actionId) {
  const action = await loadAction(conv, actionId)
  if (action.status !== 'pending' || action.decided_at) throw new ToolError('This card has already been answered.', 409)
  const who = ctx.channel === 'guest_chat' ? 'The guest' : 'The staff member'
  await settle(conv, action, 'cancelled', null, `[${who} pressed Cancel on "${action.card.title}". Nothing was changed.]`)
  // A booking card that was turned down frees its held table straight away.
  if (action.tool === 'confirm_booking') {
    const release = findTool(ctx, 'release_hold')
    release?.run(ctx, { venue_id: action.input.venue_id, hold_id: action.input.hold_id }).catch(() => {})
  }
  return cardView(conv, action.id)
}

async function cardView(conv, actionId) {
  const [a] = await withTenant(conv.tenant_id, tx => tx`
    SELECT * FROM ai_pending_actions WHERE id = ${actionId} AND tenant_id = ${conv.tenant_id}
  `)
  return actionView(a)
}

function actionView(a) {
  const expired = a.status === 'pending' && new Date(a.expires_at).getTime() <= Date.now()
  return {
    type:   'action',
    id:     a.id,
    tool:   a.tool,
    ...a.card,
    status: expired ? 'expired' : a.status,
    result: a.status === 'done' ? (a.result?.message || 'Done.') : null,
    error:  a.status === 'failed' ? a.result?.error : null,
  }
}

// ── What the person sees ─────────────────────────────────

const TOOL_LABELS = {
  find_restaurants: 'Searched restaurants', get_restaurant: 'Looked up the restaurant',
  check_availability: 'Checked availability', hold_table: 'Held a table', release_hold: 'Released the table',
  request_booking_code: 'Emailed a code', verify_booking_code: 'Checked the code',
  get_booking: 'Looked up the booking', list_venues: 'Looked up venues', find_bookings: 'Searched bookings',
  day_overview: 'Looked at the day',
  hs_status: 'Looked at H&S for the day', food_safety_day: 'Looked at the food safety log',
  checklists_due: 'Looked at the checklists', get_checklist: 'Opened the checklist',
  list_hs_actions: 'Looked at the action log',
  find_inventory_items: 'Searched the inventory', list_suppliers: 'Looked up suppliers',
  order_lists: 'Looked at the order lists', order_form: 'Opened the order', purchase_orders: 'Looked up supplier orders',
  order_requests: 'Looked at orders waiting for approval',
  list_menus: 'Looked at the menus', get_menu: 'Opened the menu', find_dishes: 'Searched the menus',
  open_page: 'Found the page',
  how_do_i: 'Looked it up in Help',
  day_briefing: 'Put the day together',
  list_staff: 'Looked at the staff', whos_working: 'Looked at who is working', rota_week: 'Looked at the rota',
  rota_pay: 'Looked at rota pay', rota_tips: 'Looked at the tips',
  cash_day: 'Looked at the cash up', cash_week: 'Looked at the cash week', wages_week: 'Looked at the wages',
  online_orders: 'Looked at the online orders', online_orders_report: 'Looked at the online orders report',
  sold_out: 'Looked at what is sold out', till_day: 'Looked at the till figures', till_checks: 'Looked at the till checks',
  kitchen_report: 'Looked at kitchen speed',
  find_customers: 'Searched customers', customer_details: 'Opened the customer',
  opening_times: 'Looked at the opening times', list_tables: 'Looked at the tables', booking_rules: 'Looked at the booking rules',
  website_status: 'Looked at the website', list_promotions: 'Looked at the promotions', list_reviews: 'Looked at the reviews',
  screens_status: 'Looked at the menu screens', email_log: 'Looked at the booking emails', list_issues: 'Looked at the issue log',
  plan_new_location: 'Scoped the new location', answer_location_questions: 'Passed on the answers',
  change_location_plan: 'Changed the new location\'s plan', location_openings: 'Looked at the new locations',
}

/** The conversation as display items: user / assistant text, a short line
 *  per lookup, a card per proposed change (where the model proposed it), and
 *  the outcome notes. Tool results and thinking are not shown. */
export async function displayItems(conv) {
  const [rows, actions] = await Promise.all([
    loadMessages(conv),
    withTenant(conv.tenant_id, tx => tx`
      SELECT * FROM ai_pending_actions WHERE conversation_id = ${conv.id} AND tenant_id = ${conv.tenant_id}
    `),
  ])
  const byToolUse = new Map(actions.map(a => [a.tool_use_id, a]))
  const items = []
  for (const r of rows) {
    const blocks = Array.isArray(r.content) ? r.content : []
    if (r.role === 'user') {
      const files = attachmentItems(blocks)
      let shownFiles = false
      for (const b of blocks) {
        if (b.type !== 'text') continue
        if (b._context || b._page) continue
        if (b._note) { items.push({ type: 'note', text: b.text.replace(/^\[|\]$/g, '') }); continue }
        items.push({ type: 'user', text: b.text, ...(files.length && !shownFiles ? { attachments: files } : {}) })
        shownFiles = true
      }
      if (files.length && !shownFiles) items.push({ type: 'user', text: '', attachments: files })
      continue
    }
    for (const b of blocks) {
      if (b.type === 'text' && b.text.trim()) items.push({ type: 'assistant', text: b.text })
      else if (b.type === 'tool_use') {
        const a = byToolUse.get(b.id)
        if (a) items.push(actionView(a))
        else if (TOOL_LABELS[b.name]) items.push({ type: 'step', text: TOOL_LABELS[b.name] })
      }
    }
  }
  return items
}

/** A tool context for a conversation (staff: from the request's login). */
export function chatContext(app, conv, { req = null } = {}) {
  if (conv.channel === 'staff_chat') {
    return makeContext({
      app, channel: 'staff_chat', tenantId: conv.tenant_id, conversationId: conv.id, log: req?.log,
      auth: { authorization: req.headers.authorization },
      principal: { sub: req.user.sub, email: req.user.email, isPlatformAdmin: !!req.isPlatformAdmin },
      actor: req.user.email || req.user.sub,
    })
  }
  return makeContext({ app, channel: 'guest_chat', tenantId: conv.tenant_id, conversationId: conv.id, actor: 'guest', log: req?.log })
}
