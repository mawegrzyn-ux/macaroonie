// src/ai/context.js
//
// What every AI booking tool runs with (migration 148). The same tools
// serve four front ends:
//
//   guest_mcp    /mcp                        any AI app, any guest, platform wide
//   guest_chat   website chat block          one tenant's site
//   staff_mcp    /mcp/staff/:tenantSlug      a staff member's own AI app
//   staff_chat   admin assistant panel       a logged-in staff member
//
// Staff tools never touch bookings with their own SQL when an admin route
// already does the job: they call that route in-process (app.inject) with
// the caller's own Authorization header and X-Tenant-Id, so the route's
// role checks, RLS and side effects (emails, live timeline updates) are
// exactly the admin portal's. Guest tools call the public /widget-api the
// same way. INTERNAL_CALL_HEADER marks these calls: it lets a staff access
// token through (tokens are refused on the admin API otherwise) and keeps
// them out of the global rate limit (the outer request is counted).

import { sql, withTenant } from '../config/db.js'
import { permissionLevel, INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../middleware/auth.js'

export const CHANNELS = ['guest_mcp', 'guest_chat', 'staff_mcp', 'staff_chat']

export class ToolError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const RANK = { none: 0, view: 1, manage: 2 }

/**
 * ctx fields:
 *   app             the Fastify instance (for app.inject)
 *   channel         one of CHANNELS
 *   tenantId        staff: the staff member's tenant; guest_chat: the site's
 *                   tenant; guest_mcp: null (platform wide)
 *   auth            staff only: { authorization } (the caller's own header)
 *   principal       staff only: { sub, email, isPlatformAdmin } for
 *                   permission checks (same shape permissionLevel() reads)
 *   actor           text for the audit log (staff email, or 'guest')
 *   conversationId  chats only
 */
export function makeContext(fields) {
  return { tenantId: null, auth: null, principal: null, actor: null, conversationId: null, ...fields }
}

export const isStaff = ctx => ctx.channel === 'staff_mcp' || ctx.channel === 'staff_chat'
export const isChat  = ctx => ctx.channel === 'staff_chat' || ctx.channel === 'guest_chat'

/** In-process call to one of our own routes. Throws ToolError on 4xx/5xx
 *  with the route's own message. */
export async function callApi(ctx, method, url, { body } = {}) {
  const headers = { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (isStaff(ctx) && ctx.auth?.authorization) {
    headers.authorization = ctx.auth.authorization
    if (ctx.tenantId) headers['x-tenant-id'] = ctx.tenantId
  }
  const res = await ctx.app.inject({
    method, url, headers,
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = res.json() } catch { data = null }
  if (res.statusCode >= 400) {
    const issues = data?.issues ? ' (' + Object.entries(data.issues).map(([k, v]) => k + ': ' + [].concat(v).join(', ')).join('; ') + ')' : ''
    throw new ToolError((data?.error || data?.message || 'Request failed') + issues, res.statusCode)
  }
  return data
}

// What a refused permission says, per module and level.
const DENIED = {
  bookings:      { view: 'see bookings',              manage: 'change bookings' },
  customers:     { view: 'see customers',             manage: 'change customers' },
  checklists:    { view: 'see checklists',            manage: 'tick checklists' },
  food_safety:   { view: 'see food safety logs',      manage: 'log food safety checks' },
  hs_action_log: { view: 'see the H&S action log',    manage: 'change the H&S action log' },
}

/** This staff member's level for a module ('none' | 'view' | 'manage'),
 *  same rule as requirePermission(). */
export async function staffPermissionLevel(ctx, moduleKey) {
  if (!isStaff(ctx)) return 'none'
  const req = {
    isPlatformAdmin: !!ctx.principal?.isPlatformAdmin,
    tenantId: ctx.tenantId,
    user: { sub: ctx.principal?.sub },
  }
  return permissionLevel(req, moduleKey)
}

export const levelAtLeast = (have, level) => RANK[have] >= RANK[level]

/** Staff permission check: throws unless the person has `level` on the module. */
export async function requireStaffPermission(ctx, moduleKey, level) {
  if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
  const have = await staffPermissionLevel(ctx, moduleKey)
  if (!levelAtLeast(have, level)) {
    const what = DENIED[moduleKey]?.[level] || 'use this'
    throw new ToolError('You don\'t have permission to ' + what + '. Ask an owner or admin.', 403)
  }
}

/** Audit log row for a tool call that changed (or tried to change) something:
 *  a booking, or (H&S tools) a check, checklist or action log entry. */
export async function audit(ctx, { tenantId, tool, input, ok, result, bookingId }) {
  const tid = tenantId ?? ctx.tenantId ?? null
  const row = {
    tenant_id: tid, channel: ctx.channel, actor: ctx.actor ?? null, tool,
    input: input ?? null, ok: !!ok, result: result ?? null,
    booking_id: bookingId ?? null, conversation_id: ctx.conversationId ?? null,
  }
  const insert = tx => tx`
    INSERT INTO ai_actions (tenant_id, channel, actor, tool, input, ok, result, booking_id, conversation_id)
    VALUES (${row.tenant_id}, ${row.channel}, ${row.actor}, ${row.tool},
            ${row.input === null ? null : tx.json(row.input)}, ${row.ok},
            ${row.result === null ? null : tx.json(row.result)}, ${row.booking_id}, ${row.conversation_id})
  `
  try {
    if (tid) await withTenant(tid, insert)
    else await insert(sql)
  } catch { /* the audit log never fails a booking */ }
}

/** First day of the current month (UTC), the ai_usage period key. */
export function usageMonth(d = new Date()) {
  return d.toISOString().slice(0, 8) + '01'
}

/** Add to this month's usage for a tenant + channel. */
export async function addUsage(tenantId, channel, { requests = 1, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = {}) {
  if (!tenantId) return
  const month = usageMonth()
  try {
    await withTenant(tenantId, tx => tx`
      INSERT INTO ai_usage (tenant_id, month, channel, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
      VALUES (${tenantId}, ${month}, ${channel}, ${requests}, ${input}, ${output}, ${cacheRead}, ${cacheWrite})
      ON CONFLICT (tenant_id, month, channel) DO UPDATE SET
        requests           = ai_usage.requests           + EXCLUDED.requests,
        input_tokens       = ai_usage.input_tokens       + EXCLUDED.input_tokens,
        output_tokens      = ai_usage.output_tokens      + EXCLUDED.output_tokens,
        cache_read_tokens  = ai_usage.cache_read_tokens  + EXCLUDED.cache_read_tokens,
        cache_write_tokens = ai_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
        updated_at         = now()
    `)
  } catch { /* usage counting never fails a request */ }
}
