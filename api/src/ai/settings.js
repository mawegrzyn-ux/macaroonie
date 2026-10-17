// src/ai/settings.js
//
// Per-tenant AI switches, the monthly allowance and each person's daily
// share of it (ai_settings, one row per tenant, no row = DEFAULTS), and the
// usage they are measured against (ai_usage per month and channel,
// ai_usage_people per person and day). Chats are paid by the platform, so
// the allowance counts both chat channels, in units: tokens weighted by
// price (usageUnits() in context.js). MCP calls are counted but not limited
// (the guest's or staff member's own AI app does the talking).

import { withTenant } from '../config/db.js'
import { usageMonth, usageDay } from './context.js'

export { chatConfigured } from './apiKey.js'

export const DEFAULTS = {
  guest_mcp_enabled:   true,
  guest_chat_enabled:  false,
  staff_enabled:       true,
  monthly_token_limit: 2_000_000,
  person_daily_pct:    25,
  chat_retention_days: 90,
}

export async function getAiSettings(tenantId) {
  if (!tenantId) return { ...DEFAULTS }
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT guest_mcp_enabled, guest_chat_enabled, staff_enabled, monthly_token_limit, person_daily_pct, chat_retention_days
      FROM ai_settings WHERE tenant_id = ${tenantId}
  `)
  return row ? { ...row, monthly_token_limit: Number(row.monthly_token_limit) } : { ...DEFAULTS }
}

/** Upsert some settings fields for a tenant. */
export async function saveAiSettings(tenantId, fields) {
  const merged = { ...(await getAiSettings(tenantId)), ...fields }
  await withTenant(tenantId, tx => tx`
    INSERT INTO ai_settings (tenant_id, guest_mcp_enabled, guest_chat_enabled, staff_enabled, monthly_token_limit,
                             person_daily_pct, chat_retention_days)
    VALUES (${tenantId}, ${merged.guest_mcp_enabled}, ${merged.guest_chat_enabled},
            ${merged.staff_enabled}, ${merged.monthly_token_limit}, ${merged.person_daily_pct}, ${merged.chat_retention_days})
    ON CONFLICT (tenant_id) DO UPDATE SET
      guest_mcp_enabled   = EXCLUDED.guest_mcp_enabled,
      guest_chat_enabled  = EXCLUDED.guest_chat_enabled,
      staff_enabled       = EXCLUDED.staff_enabled,
      monthly_token_limit = EXCLUDED.monthly_token_limit,
      person_daily_pct    = EXCLUDED.person_daily_pct,
      chat_retention_days = EXCLUDED.chat_retention_days,
      updated_at          = now()
  `)
  return getAiSettings(tenantId)
}

/** This month's usage rows plus the chat units the allowance applies to. */
export async function monthUsage(tenantId) {
  const rows = await withTenant(tenantId, tx => tx`
    SELECT channel, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, units
      FROM ai_usage
     WHERE tenant_id = ${tenantId} AND month = ${usageMonth()}
  `)
  const channels = {}
  let chatUnits = 0
  for (const r of rows) {
    const c = {
      requests:           Number(r.requests),
      input_tokens:       Number(r.input_tokens),
      output_tokens:      Number(r.output_tokens),
      cache_read_tokens:  Number(r.cache_read_tokens),
      cache_write_tokens: Number(r.cache_write_tokens),
      units:              Number(r.units),
    }
    channels[r.channel] = c
    if (r.channel === 'staff_chat' || r.channel === 'guest_chat') chatUnits += c.units
  }
  return { month: usageMonth(), channels, chat_units: chatUnits }
}

/** Remaining chat units this month (0 or less = allowance used up). */
export async function chatUnitsLeft(tenantId) {
  const [settings, usage] = await Promise.all([getAiSettings(tenantId), monthUsage(tenantId)])
  return settings.monthly_token_limit - usage.chat_units
}

/** A person's daily share in units, or null when there is no cap. */
export const dailyShare = settings =>
  settings.person_daily_pct ? Math.floor(settings.monthly_token_limit * settings.person_daily_pct / 100) : null

/** What this person can still use today, or null when there is no cap. */
export async function personUnitsLeft(tenantId, userSub) {
  const settings = await getAiSettings(tenantId)
  const share = dailyShare(settings)
  if (share == null || !userSub) return null
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT units FROM ai_usage_people WHERE tenant_id = ${tenantId} AND day = ${usageDay()} AND user_sub = ${userSub}
  `)
  return share - Number(row?.units || 0)
}

/** Each person's chat use this month and today, most first. */
export async function peopleUsage(tenantId) {
  const rows = await withTenant(tenantId, tx => tx`
    SELECT p.user_sub, max(p.user_email) AS user_email, max(u.full_name) AS full_name,
           sum(p.requests)::int AS requests, sum(p.units)::bigint AS units,
           COALESCE(sum(p.units) FILTER (WHERE p.day = ${usageDay()}), 0)::bigint AS today
      FROM ai_usage_people p
      LEFT JOIN users u ON u.tenant_id = p.tenant_id AND u.auth0_user_id = p.user_sub
     WHERE p.tenant_id = ${tenantId} AND p.day >= ${usageMonth()}
     GROUP BY p.user_sub
     ORDER BY sum(p.units) DESC
  `)
  return rows.map(r => ({
    user_sub: r.user_sub, name: r.full_name || r.user_email || 'Someone', email: r.user_email,
    requests: r.requests, units: Number(r.units), today: Number(r.today),
  }))
}
