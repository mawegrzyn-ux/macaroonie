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
// Messages are stored exactly as the API returned them and only ever
// appended, with the conversation's own system prompt, so each request
// replays the conversation unchanged (thinking blocks stay valid, the
// prompt cache keeps hitting). Every response's tokens go to ai_usage; a
// chat is refused once the tenant's monthly limit is used up.

import Anthropic from '@anthropic-ai/sdk'
import { sql, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { ToolError, makeContext, addUsage } from './context.js'
import { toolsFor, findTool, jsonSchemaOf, parseInput, errorText } from './tools/index.js'
import { chatTokensLeft } from './settings.js'
import { activeKey } from './apiKey.js'

const MAX_STEPS      = 8
const MAX_TOKENS     = 16000
const ACTION_MINUTES = 30
const MAX_MESSAGES   = 300   // stored rows per conversation; then start a new one

// The key is the one a platform admin saved, else ANTHROPIC_API_KEY
// (src/ai/apiKey.js); the client is rebuilt when it changes.
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

/** A rejected key is the platform's problem, not the person's: say so. */
async function createMessage(params) {
  const api = await anthropic()
  try {
    return await api.beta.messages.create(params)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ToolError('The AI assistant\'s key isn\'t working. A platform admin needs to update it.', 503)
    }
    throw err
  }
}

// One turn at a time per conversation (a second message while the first is
// still running would interleave the history).
const running = new Set()

// ── Storage ──────────────────────────────────────────────

export async function createConversation({ tenantId, channel, userSub = null, userEmail = null, guestKey = null, venueId = null, systemPrompt }) {
  const [row] = await withTenant(tenantId, tx => tx`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, guest_key, venue_id, system_prompt)
    VALUES (${tenantId}, ${channel}, ${userSub}, ${userEmail}, ${guestKey}, ${venueId}, ${systemPrompt})
    RETURNING *
  `)
  return row
}

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
const clean = block => {
  if (!block || typeof block !== 'object') return block
  const { _note, ...rest } = block
  return rest
}

/** The stored history as API messages: our markers stripped, back-to-back
 *  user rows (a note after the last reply, then the next message) merged.
 *  Merging only ever joins rows at the end, so earlier requests' messages
 *  are unchanged. */
function apiMessages(rows) {
  const out = []
  for (const r of rows) {
    const content = (Array.isArray(r.content) ? r.content : [r.content]).map(clean)
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

function toolDefs(ctx) {
  return toolsFor(ctx).map(t => ({ name: t.name, description: t.description, input_schema: jsonSchemaOf(t) }))
}

async function recordUsage(conv, usage) {
  if (!usage) return
  await addUsage(conv.tenant_id, conv.channel, {
    requests:   1,
    input:      usage.input_tokens || 0,
    output:     usage.output_tokens || 0,
    cacheRead:  usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
  })
}

/** Runs one tool call from the model. Returns the tool_result block. */
async function handleToolUse(ctx, conv, block) {
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
    const { expiresAt, ...cardData } = card
    await withTenant(conv.tenant_id, tx => tx`
      INSERT INTO ai_pending_actions (tenant_id, conversation_id, tool_use_id, tool, input, card, expires_at)
      VALUES (${conv.tenant_id}, ${conv.id}, ${block.id}, ${tool.name}, ${tx.json(input)}, ${tx.json(cardData)}, ${expires})
    `)
    const mins = Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000))
    return result('Not done yet: the ' + (ctx.channel === 'guest_chat' ? 'guest' : 'staff member') +
      ' now sees a card "' + card.title + '" with the details and a Confirm button, valid for ' + mins +
      ' minutes. Nothing changes until they press it; you will see the outcome in their next message. ' +
      'Do not call ' + tool.name + ' again for the same change.')
  } catch (err) {
    return result(errorText(err, ctx.log), true)
  }
}

/**
 * Adds the person's message and runs the model until it answers.
 * `ctx` is the tool context for this conversation (makeContext()).
 * Returns { reply, stopReason }.
 */
export async function runTurn(ctx, conv, text) {
  if (running.has(conv.id)) throw new ToolError('Still working on your last message.', 409)
  running.add(conv.id)
  try {
    if (await chatTokensLeft(conv.tenant_id) <= 0) {
      throw new ToolError('The AI assistant has used this month\'s allowance. It will be back next month.', 429)
    }
    const [{ n }] = await withTenant(conv.tenant_id, tx => tx`
      SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id = ${conv.id}
    `)
    if (n >= MAX_MESSAGES) throw new ToolError('This conversation is getting long. Start a new one.', 422)
    await appendMessage(conv, 'user', [{ type: 'text', text }])
    if (!conv.title) {
      const title = text.replace(/\s+/g, ' ').trim().slice(0, 80)
      await withTenant(conv.tenant_id, tx => tx`UPDATE ai_conversations SET title = ${title} WHERE id = ${conv.id}`)
      conv.title = title
    }

    const tools = toolDefs(ctx)
    for (let step = 0; step < MAX_STEPS; step++) {
      const rows = await loadMessages(conv)
      const response = await createMessage({
        model:         env.AI_MODEL,
        max_tokens:    MAX_TOKENS,
        betas:         ['server-side-fallback-2026-07-01'],
        fallbacks:     'default',
        output_config: { effort: env.AI_EFFORT },
        cache_control: { type: 'ephemeral' },
        system:        conv.system_prompt,
        tools,
        messages:      apiMessages(rows),
      })
      await recordUsage(conv, response.usage)

      if (response.stop_reason === 'refusal') {
        return { reply: 'Sorry, I can\'t help with that one.', stopReason: 'refusal' }
      }
      const content = storableContent(response.content)
      if (!content.length) return { reply: null, stopReason: response.stop_reason }
      await appendMessage(conv, 'assistant', content)

      const toolUses = content.filter(b => b.type === 'tool_use')
      if (!toolUses.length) {
        return { reply: textOf(content), stopReason: response.stop_reason }
      }
      // Every tool_use needs its result in the next user message, even when
      // the reply was cut off (max_tokens) or we stop here.
      const results = []
      for (const b of toolUses) {
        results.push(response.stop_reason === 'max_tokens'
          ? { type: 'tool_result', tool_use_id: b.id, is_error: true, content: [{ type: 'text', text: 'Your reply was cut off. Try again with a shorter answer.' }] }
          : await handleToolUse(ctx, conv, b))
      }
      await appendMessage(conv, 'user', results)
    }
    return { reply: 'That took more steps than I can do at once. Tell me what to do next.', stopReason: 'max_steps' }
  } finally {
    running.delete(conv.id)
  }
}

const textOf = content => content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim()

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
      text: `[${who} pressed Confirm on "${action.card.title}" but it failed: ${message}]` }])
    return { ...(await cardView(conv, action.id)), error: message }
  }
  await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_pending_actions SET status = 'done', result = ${tx.json(result)} WHERE id = ${action.id}
  `)
  await appendMessage(conv, 'user', [{ type: 'text', _note: 'action',
    text: `[${who} pressed Confirm on "${action.card.title}". Done: ${JSON.stringify(result)}]` }])
  return cardView(conv, action.id)
}

export async function cancelAction(ctx, conv, actionId) {
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
  day_overview: 'Looked at the day', find_customer: 'Searched customers',
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
      for (const b of blocks) {
        if (b.type !== 'text') continue
        items.push(b._note ? { type: 'note', text: b.text.replace(/^\[|\]$/g, '') } : { type: 'user', text: b.text })
      }
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
