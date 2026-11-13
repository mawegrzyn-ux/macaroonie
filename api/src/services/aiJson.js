// src/services/aiJson.js
//
// One model call answered as JSON in a fixed shape (structured outputs), for
// Pepper's readers of documents: supplier invoices on receiving
// (invoiceReadAi.js) and petty cash receipts (receiptReadAi.js). Checks the
// tenant's monthly AI allowance and the person's daily share first, counts
// the usage after, and turns the API's failures into replies the admin can
// show.
//
//   askForJson({ tenantId, person, system, schema, content, maxTokens, effort, what, model, thinking, words })
//     system:   the instructions; a list of texts is sent as one block each,
//               each cached (fixed instructions first, then what changes)
//     content:  the user message's blocks (images, documents, text)
//     what:     what is being read, for the messages ("invoice", "receipt")
//     model:    'main' (AI_MODEL, the default) or 'fast' (AI_MODEL_FAST, for
//               quick everyday answers such as the menu search)
//     thinking: true lets the model think first (adaptive thinking)
//     words:    the messages for a refusal, a request Claude can't take and
//               an answer too long, when the "read a file" ones don't fit
//               ({ badRequest, refusal, tooLong })
//     Returns the parsed answer (an object), or throws an httpError.
//
//   pepperOn(tenantId)  throws unless the AI key is set and Pepper is on for
//                       the group (every route that asks Pepper checks it)

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { activeKey, chatConfigured } from '../ai/apiKey.js'
import { addUsage, searchesIn } from '../ai/context.js'
import { chatUnitsLeft, personUnitsLeft, getAiSettings } from '../ai/settings.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

// Helpers for the answer shapes: every property required, nothing nullable
// ('' = not set), as structured outputs want.
export const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })
export const str = { type: 'string' }
export const bool = { type: 'boolean' }
export const arr = items => ({ type: 'array', items })
export const oneOf = values => ({ type: 'string', enum: values })

let client = null, clientKey = null
async function anthropic() {
  const { key } = await activeKey()
  if (!key) throw httpError(503, 'AI isn\'t set up on this server: a platform admin adds the key on the Platform page.')
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 280_000 })
    clientKey = key
  }
  return client
}

async function callClaude(params) {
  const api = await anthropic()
  try {
    return await api.messages.stream(params).finalMessage()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw httpError(503, 'The AI key isn\'t working. A platform admin needs to update it.')
    }
    if (err instanceof Anthropic.BadRequestError) throw err
    throw httpError(503, 'Claude is busy or can\'t be reached right now. Try again in a moment.')
  }
}

function jsonIn(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/** Trimmed, single-spaced, cut to n characters ('' for anything not a string). */
export const clip = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '')

/** "12.50", "£1,212.50", "12,50", "-3.00" -> a number; anything else -> undefined. */
export function readAmount(v, { negative = false, max = 10_000_000 } = {}) {
  let t = String(v ?? '').replace(/[£$€\s]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  let sign = 1
  if (negative && /^(-|\(.*\)$)/.test(t)) { sign = -1; t = t.replace(/^-|^\(|\)$/g, '') }
  if (!/^\d{1,9}(\.\d{1,4})?$/.test(t)) return undefined
  const n = Number(t)
  return n <= max ? sign * n : undefined
}

export async function pepperOn(tenantId) {
  if (!(await chatConfigured())) throw httpError(503, ASSISTANT_NAME + ' isn\'t set up on this server: a platform admin adds the AI key on the Platform page.')
  if (!(await getAiSettings(tenantId)).staff_enabled) throw httpError(403, ASSISTANT_NAME + ' is switched off for your group (' + ASSISTANT_NAME + ' > Settings).')
}

export async function askForJson({ tenantId, person, system, schema, content, maxTokens = 16000, effort = 'medium', what = 'file', model = 'main', thinking = false, words = {} }) {
  if ((await chatUnitsLeft(tenantId)) <= 0) throw httpError(429, 'This month\'s AI allowance is used up.')
  const mine = person?.sub ? await personUnitsLeft(tenantId, person.sub) : null
  if (mine !== null && mine <= 0) throw httpError(429, 'You\'ve used your share of the AI allowance for today. It starts again tomorrow.')

  const texts = Array.isArray(system) ? system.filter(Boolean) : [system]
  const blocks = extra => texts.map((text, i) => ({
    type: 'text', text: i === texts.length - 1 ? text + extra : text, cache_control: { type: 'ephemeral' },
  }))
  const params = {
    model: model === 'fast' ? (env.AI_MODEL_FAST || env.AI_MODEL) : env.AI_MODEL,
    max_tokens: maxTokens,
    system: blocks(''),
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  }
  let res
  try {
    res = await callClaude(params)
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError) || !/schema|output_config|format/i.test(err.message || '')) {
      if (err instanceof Anthropic.BadRequestError) throw httpError(422, words.badRequest || 'Claude couldn\'t read that ' + what + '. Try a clearer photo (JPEG or PNG) or a PDF.')
      throw err
    }
    res = await callClaude({
      ...params,
      output_config: { effort },
      system: blocks('\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n' + JSON.stringify(schema)),
    })
  }
  const u = res.usage || {}
  await addUsage(tenantId, 'staff_chat', {
    input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0, model: res.model, person,
  })
  if (res.stop_reason === 'refusal') throw httpError(422, words.refusal || ASSISTANT_NAME + ' can\'t read this one. Try another photo or a PDF of the ' + what + '.')
  if (res.stop_reason === 'max_tokens') throw httpError(422, words.tooLong || 'That ' + what + ' is too long to read in one go. Send it a few pages at a time.')
  const out = jsonIn((res.content || []).filter(b => b.type === 'text').map(b => b.text).join(''))
  if (!out) throw httpError(502, ASSISTANT_NAME + '\'s answer couldn\'t be read. Try again.')
  return out
}

/**
 * One web search answered as JSON (local info captures, localInfoSvc.js):
 * the model searches the web (optionally one site) and answers with a JSON
 * object matching the schema. Structured outputs don't ride along with the
 * web search tool, so the schema goes in the system prompt and the answer is
 * read out of the text (jsonIn). A turn the API pauses (stop_reason
 * pause_turn) is carried on with the content so far, a few times at most.
 * `person` is null for scheduled runs: they count the tenant's monthly
 * allowance, never anyone's daily share. The searches themselves count too
 * (addUsage's `searches`), as they do in Pepper's chat.
 */
export async function searchForJson({ tenantId, person = null, system, schema, prompt, site, maxUses = 5, maxTokens = 8000, effort = 'medium', what = 'search' }) {
  if ((await chatUnitsLeft(tenantId)) <= 0) throw httpError(429, 'This month\'s AI allowance is used up.')
  const mine = person?.sub ? await personUnitsLeft(tenantId, person.sub) : null
  if (mine !== null && mine <= 0) throw httpError(429, 'You\'ve used your share of the AI allowance for today. It starts again tomorrow.')

  const tools = [{
    type: 'web_search_20250305', name: 'web_search', max_uses: maxUses,
    ...(site ? { allowed_domains: [site] } : {}),
  }]
  const sys = [{
    type: 'text',
    text: system + '\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n' + JSON.stringify(schema),
    cache_control: { type: 'ephemeral' },
  }]
  let messages = [{ role: 'user', content: prompt }]
  let res
  for (let round = 0; round < 5; round++) {
    res = await callClaude({
      model: env.AI_MODEL, max_tokens: maxTokens, system: sys, tools,
      output_config: { effort }, messages,
    })
    const u = res.usage || {}
    await addUsage(tenantId, 'staff_chat', {
      input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0, searches: searchesIn(u), model: res.model, person,
    })
    if (res.stop_reason !== 'pause_turn') break
    messages = [...messages, { role: 'assistant', content: res.content }]
  }
  if (res.stop_reason === 'refusal') throw httpError(422, ASSISTANT_NAME + ' can\'t run this ' + what + '.')
  if (res.stop_reason === 'max_tokens') throw httpError(422, 'The ' + what + ' found too much to answer in one go.')
  const out = jsonIn((res.content || []).filter(b => b.type === 'text').map(b => b.text).join(''))
  if (!out) throw httpError(502, ASSISTANT_NAME + '\'s answer couldn\'t be read. Try again.')
  return out
}

/** Image / PDF blocks for the model from checked files [{ media_type, data }]. */
export function fileBlocks(files) {
  return files.map(f => f.media_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
    : { type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } })
}
