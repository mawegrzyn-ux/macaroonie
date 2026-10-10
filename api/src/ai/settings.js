// src/ai/settings.js
//
// Per-tenant AI switches and the monthly token limit (ai_settings, one row
// per tenant, no row = DEFAULTS), and this month's usage (ai_usage).
// Chats are paid by the platform, so the limit counts the model tokens of
// both chat channels. MCP calls are counted but not limited (the guest's or
// staff member's own AI app does the talking).

import { withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { usageMonth } from './context.js'

export const DEFAULTS = {
  guest_mcp_enabled:   true,
  guest_chat_enabled:  false,
  staff_enabled:       true,
  monthly_token_limit: 2_000_000,
}

/** Whether the server can run chats at all (an Anthropic key is set). */
export function chatConfigured() {
  return !!env.ANTHROPIC_API_KEY
}

export async function getAiSettings(tenantId) {
  if (!tenantId) return { ...DEFAULTS }
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT guest_mcp_enabled, guest_chat_enabled, staff_enabled, monthly_token_limit
      FROM ai_settings WHERE tenant_id = ${tenantId}
  `)
  return row ? { ...row, monthly_token_limit: Number(row.monthly_token_limit) } : { ...DEFAULTS }
}

/** Upsert some settings fields for a tenant. */
export async function saveAiSettings(tenantId, fields) {
  const merged = { ...(await getAiSettings(tenantId)), ...fields }
  await withTenant(tenantId, tx => tx`
    INSERT INTO ai_settings (tenant_id, guest_mcp_enabled, guest_chat_enabled, staff_enabled, monthly_token_limit)
    VALUES (${tenantId}, ${merged.guest_mcp_enabled}, ${merged.guest_chat_enabled},
            ${merged.staff_enabled}, ${merged.monthly_token_limit})
    ON CONFLICT (tenant_id) DO UPDATE SET
      guest_mcp_enabled   = EXCLUDED.guest_mcp_enabled,
      guest_chat_enabled  = EXCLUDED.guest_chat_enabled,
      staff_enabled       = EXCLUDED.staff_enabled,
      monthly_token_limit = EXCLUDED.monthly_token_limit
  `)
  return getAiSettings(tenantId)
}

/** This month's usage rows plus the chat token total the limit applies to. */
export async function monthUsage(tenantId) {
  const rows = await withTenant(tenantId, tx => tx`
    SELECT channel, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
      FROM ai_usage
     WHERE tenant_id = ${tenantId} AND month = ${usageMonth()}
  `)
  const channels = {}
  let chatTokens = 0
  for (const r of rows) {
    const c = {
      requests:           Number(r.requests),
      input_tokens:       Number(r.input_tokens),
      output_tokens:      Number(r.output_tokens),
      cache_read_tokens:  Number(r.cache_read_tokens),
      cache_write_tokens: Number(r.cache_write_tokens),
    }
    channels[r.channel] = c
    if (r.channel === 'staff_chat' || r.channel === 'guest_chat') {
      chatTokens += c.input_tokens + c.output_tokens + c.cache_read_tokens + c.cache_write_tokens
    }
  }
  return { month: usageMonth(), channels, chat_tokens: chatTokens }
}

/** Remaining chat tokens this month (0 or less = limit reached). */
export async function chatTokensLeft(tenantId) {
  const [settings, usage] = await Promise.all([getAiSettings(tenantId), monthUsage(tenantId)])
  return settings.monthly_token_limit - usage.chat_tokens
}
