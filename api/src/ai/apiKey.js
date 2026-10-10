// src/ai/apiKey.js
//
// The Anthropic API key the chats use (migration 149). A platform admin can
// save one on the Platform page (AI usage tab), stored in platform_secrets
// as 'anthropic_api_key'; it wins over ANTHROPIC_API_KEY in the server's
// .env, which stays as the fallback. The key never leaves the server: the
// admin only ever sees its last four characters.
//
// The API runs as several processes (PM2 cluster), so each process keeps the
// key for KEY_TTL_MS and then reads it again: a key saved or removed in one
// process reaches the others within that time.

import Anthropic from '@anthropic-ai/sdk'
import { sql } from '../config/db.js'
import { env } from '../config/env.js'

const SECRET     = 'anthropic_api_key'
const KEY_TTL_MS = 15_000

let cached = null   // { key, source: 'platform' | 'env' | null, at }

function fromEnv() {
  const key = env.ANTHROPIC_API_KEY || null
  return { key, source: key ? 'env' : null, at: Date.now() }
}

/** The key the chats use now, and where it came from. */
export async function activeKey() {
  if (cached && Date.now() - cached.at < KEY_TTL_MS) return cached
  try {
    const [row] = await sql`SELECT value FROM platform_secrets WHERE name = ${SECRET}`
    cached = row ? { key: row.value, source: 'platform', at: Date.now() } : fromEnv()
  } catch {
    cached = fromEnv()   // table not there yet (migration 149 not run)
  }
  return cached
}

function forgetKey() {
  cached = null
}

/** Whether the server can run chats at all (a key is saved or in .env). */
export async function chatConfigured() {
  return !!(await activeKey()).key
}

export const hintOf = key => key.slice(-4)

/** What the platform admin sees: where the key comes from, never the key. */
export async function keyInfo() {
  const [row] = await sql`SELECT hint, updated_by, updated_at FROM platform_secrets WHERE name = ${SECRET}`
  const envKey = env.ANTHROPIC_API_KEY || null
  return {
    source:   row ? 'platform' : envKey ? 'env' : null,
    saved:    row ? { hint: row.hint, updated_by: row.updated_by, updated_at: row.updated_at } : null,
    env_hint: envKey ? hintOf(envKey) : null,
    model:    env.AI_MODEL,
  }
}

/**
 * Asks Anthropic whether a key works, by looking up the chat model (free, no
 * tokens). Returns { ok, message?, warning? }.
 */
export async function checkKey(key) {
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 })
  try {
    await client.models.retrieve(env.AI_MODEL)
    return { ok: true }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: 'Anthropic rejected this key. Check you copied all of it, and that it hasn\'t been deleted.' }
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, message: 'Anthropic says this key isn\'t allowed to use the API. Check the account in the Anthropic Console.' }
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: true, warning: 'The key works, but this Anthropic account can\'t use the chat model (' + env.AI_MODEL + '). Set AI_MODEL on the server to a model it can use.' }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, message: 'Couldn\'t reach Anthropic to check the key. Try again in a moment.' }
    }
    return { ok: false, message: 'Anthropic answered with an error' + (err.status ? ' (' + err.status + ')' : '') + ' while checking the key. Try again in a moment.' }
  }
}

export async function saveKey(key, updatedBy) {
  await sql`
    INSERT INTO platform_secrets (name, value, hint, updated_by)
    VALUES (${SECRET}, ${key}, ${hintOf(key)}, ${updatedBy})
    ON CONFLICT (name) DO UPDATE SET
      value      = EXCLUDED.value,
      hint       = EXCLUDED.hint,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `
  forgetKey()
}

export async function removeKey() {
  await sql`DELETE FROM platform_secrets WHERE name = ${SECRET}`
  forgetKey()
}
