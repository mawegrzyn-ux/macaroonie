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

import { sql, systemSql, withTenant } from '../config/db.js'
import { permissionLevel, permissionLevels, INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../middleware/auth.js'
import { MODULES, PERMISSION_RANK } from '../config/modules.js'
import { sharedHeaders } from '../middleware/sharedDevice.js'

export const CHANNELS = ['guest_mcp', 'guest_chat', 'staff_mcp', 'staff_chat']

export class ToolError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}


/**
 * ctx fields:
 *   app             the Fastify instance (for app.inject)
 *   channel         one of CHANNELS
 *   tenantId        staff: the staff member's tenant; guest_chat: the site's
 *                   tenant; guest_mcp: null (platform wide)
 *   auth            staff only: { authorization, shared } (the caller's own
 *                   header, and on a shared device its X-Shared-Device and
 *                   X-Acting-Person, passed on to every in-process call)
 *   principal       staff only: { sub, email, isPlatformAdmin, acting } for
 *                   permission checks (same shape permissionLevel() reads;
 *                   acting = the person switched in on a shared device)
 *   actor           text for the audit log (staff email, or 'guest')
 *   conversationId  chats only
 *   rule            a rule's run (step 8B2): { id, name }, named in the audit
 */
export function makeContext(fields) {
  // said: the person's own words this chat turn (chat.js), for open_form's measured values.
  return { tenantId: null, auth: null, principal: null, actor: null, conversationId: null, said: '', ...fields }
}

/** A staff context's auth and principal from the request it serves (the
 *  chat, Confirm, Today's task actions, For review). */
export const staffAuthOf = req => ({ authorization: req.headers.authorization, shared: sharedHeaders(req) })
export const staffPrincipalOf = req => ({
  sub: req.user.sub, email: req.user.email, isPlatformAdmin: !!req.isPlatformAdmin, acting: req.acting ?? null,
})

export const isStaff = ctx => ctx.channel === 'staff_mcp' || ctx.channel === 'staff_chat'
export const isChat  = ctx => ctx.channel === 'staff_chat' || ctx.channel === 'guest_chat'

/** In-process call to one of our own routes. Throws ToolError on 4xx/5xx
 *  with the route's own message. */
export async function callApi(ctx, method, url, { body, headers: extra } = {}) {
  const headers = { ...extra, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (isStaff(ctx) && ctx.auth?.authorization) {
    headers.authorization = ctx.auth.authorization
    if (ctx.tenantId) headers['x-tenant-id'] = ctx.tenantId
    // A shared device's token and its person: the route checks them again.
    Object.assign(headers, ctx.auth.shared || {})
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
  checklists:    { view: 'see checklists',            use: 'tick checklists',               manage: 'change how checklists are set up' },
  food_safety:   { view: 'see food safety logs',      use: 'log food safety checks',        manage: 'change food safety setup or delete readings' },
  hs_action_log: { view: 'see the H&S action log',    use: 'add to or tick off the H&S action log', manage: 'delete H&S actions or change their categories' },
  purchasing:    { view: 'see supplier orders',       manage: 'fill in, send or receive supplier orders' },
  purchasing_approve: { view: 'approve supplier orders', manage: 'approve supplier orders (change, place, split or cancel them)' },
  purchasing_setup: { view: 'see the inventory, suppliers and prices', manage: 'change the inventory, suppliers, prices or order lists' },
  menus:         { view: 'see menus',                 manage: 'change menus' },
  staff:         { view: 'see staff',                 manage: 'change staff' },
  rota:          { view: 'see the rota',              manage: 'change the rota' },
  rota_pay:      { view: 'see rota pay',              manage: 'change rota pay or fill wages' },
  rota_tips:     { view: 'see tips',                  manage: 'change tips' },
  cash_recon:    { view: 'see cash reconciliation',   use: 'fill in cash reconciliation',   manage: 'change how cash reconciliation is set up' },
  web_orders:    { view: 'see online orders',         manage: 'change online orders' },
  pos_reports:   { view: 'see till reports',          manage: 'change till reports' },
  pos_setup:     { view: 'see till setup',            manage: 'change till setup' },
  reports:       { view: 'see reports',               use: 'build, save, change, delete, schedule or email reports', manage: 'share reports, offer them to the team or send them to others' },
}

// Any other module is named by its label from the module registry.
const MODULE_LABEL = Object.fromEntries(MODULES.map(m => [m.key, m.label]))

/** This staff member's level for a module ('none' | 'view' | 'use' | 'manage'),
 *  same rule as requirePermission(). */
export async function staffPermissionLevel(ctx, moduleKey) {
  if (!isStaff(ctx)) return 'none'
  return permissionLevel(staffReq(ctx), moduleKey)
}

/** staffPermissionLevel() for several modules at once: { [moduleKey]: level }. */
export async function staffPermissionLevels(ctx, moduleKeys) {
  if (!isStaff(ctx)) return Object.fromEntries(moduleKeys.map(k => [k, 'none']))
  return permissionLevels(staffReq(ctx), moduleKeys)
}

// The person behind a staff context, in the shape the permission checks take
// (and navTreeFor(): open_page reads the person's own menu with it).
export const staffReq = ctx => ({
  isPlatformAdmin: !!ctx.principal?.isPlatformAdmin,
  tenantId: ctx.tenantId,
  user: { sub: ctx.principal?.sub },
  acting: ctx.principal?.acting ?? null,
})

export const levelAtLeast = (have, level) => (PERMISSION_RANK[have] ?? 0) >= PERMISSION_RANK[level]

/** Staff permission check: throws unless the person has `level` on the module. */
export async function requireStaffPermission(ctx, moduleKey, level) {
  if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
  const have = await staffPermissionLevel(ctx, moduleKey)
  if (!levelAtLeast(have, level)) {
    const what = DENIED[moduleKey]?.[level] ||
      (MODULE_LABEL[moduleKey] ? (level === 'view' ? 'see ' : 'change ') + MODULE_LABEL[moduleKey] : 'use this')
    throw new ToolError('You don\'t have permission to ' + what + '. Ask an owner or admin.', 403)
  }
}

/** Audit log row for a tool call that changed (or tried to change) something:
 *  a booking, or (H&S tools) a check, checklist or action log entry. */
//  Since migration 276 it also keeps the card it ran from (ctx.action, set by
//  the chat's Confirm: the card is the idempotency key), the person (their
//  sub) and the venue the tool worked at (ctx.venue, set by venueFor()), for
//  the Done by Pepper log; an Undo's own row names the card it undid (undoOf).
export async function audit(ctx, { tenantId, tool, input, ok, result, bookingId, undoOf, venueId }) {
  const tid = tenantId ?? ctx.tenantId ?? null
  const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  const venue = venueId ?? ctx.venue?.id ?? null
  // On a shared device the change is the switched-in person's (migration 280):
  // their name, their own sub with an office PIN, none with a till PIN.
  const acting = isStaff(ctx) ? (ctx.principal?.acting ?? null) : null
  const row = {
    tenant_id: tid, channel: ctx.channel, actor: acting ? acting.name : (ctx.actor ?? null), tool,
    input: input ?? null, ok: !!ok, result: result ?? null,
    booking_id: bookingId ?? null, conversation_id: ctx.conversationId ?? null,
    action_id: isUuid(ctx.action?.id) ? ctx.action.id : null,
    user_sub: acting ? (acting.sub ?? null) : isStaff(ctx) ? (ctx.principal?.sub ?? null) : null,
    venue_id: isUuid(venue) ? venue : null,
    undo_of: isUuid(undoOf) ? undoOf : null,
    shared_device_id: acting && isUuid(acting.deviceId) ? acting.deviceId : null,
    // A rule's run (migration 286, step 8B2): the rule it came from.
    rule_id: isUuid(ctx.rule?.id) ? ctx.rule.id : null,
  }
  const insert = tx => tx`
    INSERT INTO ai_actions (tenant_id, channel, actor, tool, input, ok, result, booking_id, conversation_id,
                            action_id, user_sub, venue_id, undo_of, shared_device_id, rule_id)
    VALUES (${row.tenant_id}, ${row.channel}, ${row.actor}, ${row.tool},
            ${row.input === null ? null : tx.json(row.input)}, ${row.ok},
            ${row.result === null ? null : tx.json(row.result)}, ${row.booking_id}, ${row.conversation_id},
            ${row.action_id}, ${row.user_sub}, ${row.venue_id}, ${row.undo_of}, ${row.shared_device_id}, ${row.rule_id})
  `
  try {
    if (tid) await withTenant(tid, insert)
    else await insert(systemSql)
  } catch { /* the audit log never fails a booking */ }
}

/** First day of the current month (UTC), the ai_usage period key. */
export function usageMonth(d = new Date()) {
  return d.toISOString().slice(0, 8) + '01'
}

export function usageDay(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

// Usage is counted in units: what the tokens cost, in steps of $4 per
// million units, whichever model answered. On the default main model a unit
// is one input token; output there costs 5 units, a cache write (5-minute)
// 1.25 and a cache read 0.05, while the everyday model (AI_MODEL_FAST) costs
// a fraction of that. So a long chat re-reading its cached history counts for
// what it costs, not its raw size, and a chat routed to the cheaper model
// uses less of the allowance. A web search counts SEARCH_UNITS on top of the
// tokens its results add. The monthly allowance
// (ai_settings.monthly_token_limit) and each person's daily share are in units.
const UNIT_PRICE = 4   // $ per million units
// $ per million tokens: input, output, cache read, cache write (5-minute).
const PRICES = {
  'claude-opus-5-5':   [4, 20, 0.2, 5],
  'claude-opus-5':     [5, 25, 0.5, 6.25],
  'claude-opus-4-8':   [5, 25, 0.5, 6.25],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-sonnet-5':   [2, 10, 0.2, 2.5],
  'claude-haiku-5-5':  [0.1, 0.5, 0.01, 0.125],
  'claude-fable-5-2':  [8, 40, 0.2, 10],
  'claude-mythos-5-2': [8, 40, 0.2, 10],
  'claude-fable-5-1':  [10, 50, 0.25, 12.5],
  'claude-mythos-5-1': [10, 50, 0.25, 12.5],
  'claude-fable-5':    [10, 50, 1, 12.5],
  'claude-mythos-5':   [10, 50, 1, 12.5],
}
// Prompts over this many tokens are charged at 5x on the models listed here.
const LONG_PROMPT = 100_000
const LONG_PROMPT_RATE = { 'claude-haiku-5-5': 5 }
// A model not in the table: an input token is a unit, output 5, cache
// writes 1.25, cache reads 0.1.
const OTHER = [UNIT_PRICE, UNIT_PRICE * 5, UNIT_PRICE * 0.1, UNIT_PRICE * 1.25]

// A web search (Anthropic's web search tool, in Pepper's chat and the local
// info captures) costs $10 per 1,000 whichever model asked: 2,500 units each.
const SEARCH_PRICE = 10_000   // millionths of a dollar per search
export const SEARCH_UNITS = SEARCH_PRICE / UNIT_PRICE

// What a call cost, in millionths of a dollar: tokens x $ per million tokens
// at the model's prices, and each web search.
function costMicros({ input = 0, output = 0, cacheRead = 0, cacheWrite = 0, searches = 0 }, model) {
  const [pIn, pOut, pRead, pWrite] = PRICES[model] ?? OTHER
  const rate = (input + cacheRead + cacheWrite > LONG_PROMPT && LONG_PROMPT_RATE[model]) || 1
  return (input * pIn + output * pOut + cacheRead * pRead + cacheWrite * pWrite) * rate + searches * SEARCH_PRICE
}

export function usageUnits(tokens, model = null) {
  return Math.round(costMicros(tokens, model) / UNIT_PRICE)
}

/** What a call cost in dollars at the list prices (PRICES; OTHER for a model not in it). */
export function usageCost(tokens, model = null) {
  return Math.round(costMicros(tokens, model)) / 1e6
}

// What a model call was for (ai_requests.use, migration 271): the words are
// USE_LABELS in shared/pepperActions.js.
export const USES = ['chat', 'smart_builder', 'menu_reader', 'invoice_reader', 'receipt_reader', 'local_info', 'theme_maker', 'translation', 'new_location', 'rule_parser', 'other']

/** The web searches a model response made (usage.server_tool_use). */
export const searchesIn = usage => Math.max(0, Number(usage?.server_tool_use?.web_search_requests) || 0)

/** Add to this month's usage for a tenant + channel, and to the person's day
 *  (staff only: `person` = { sub, email }). `model` is the one that answered,
 *  `searches` the web searches the response made. A call with a `model` is a
 *  model request and is also kept on its own (ai_requests, migration 271):
 *  `use` says what it was for (USES), `ms` how long the call took. */
export async function addUsage(tenantId, channel, { requests = 1, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, searches = 0, model = null, person = null, use = 'other', ms = null } = {}) {
  if (!tenantId) return
  const month = usageMonth()
  const tokens = { input, output, cacheRead, cacheWrite, searches }
  const units = usageUnits(tokens, model)
  try {
    await withTenant(tenantId, async tx => {
      if (model) {
        await tx`
          INSERT INTO ai_requests (tenant_id, channel, use, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, units, cost_usd, ms)
          VALUES (${tenantId}, ${channel}, ${USES.includes(use) ? use : 'other'}, ${String(model).slice(0, 100)}, ${input}, ${output}, ${cacheRead}, ${cacheWrite},
                  ${searches}, ${units}, ${usageCost(tokens, model)}, ${Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null})
        `
      }
      await tx`
        INSERT INTO ai_usage (tenant_id, month, channel, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, units, web_searches)
        VALUES (${tenantId}, ${month}, ${channel}, ${requests}, ${input}, ${output}, ${cacheRead}, ${cacheWrite}, ${units}, ${searches})
        ON CONFLICT (tenant_id, month, channel) DO UPDATE SET
          requests           = ai_usage.requests           + EXCLUDED.requests,
          input_tokens       = ai_usage.input_tokens       + EXCLUDED.input_tokens,
          output_tokens      = ai_usage.output_tokens      + EXCLUDED.output_tokens,
          cache_read_tokens  = ai_usage.cache_read_tokens  + EXCLUDED.cache_read_tokens,
          cache_write_tokens = ai_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
          units              = ai_usage.units              + EXCLUDED.units,
          web_searches       = ai_usage.web_searches       + EXCLUDED.web_searches,
          updated_at         = now()
      `
      if (!person?.sub) return
      await tx`
        INSERT INTO ai_usage_people (tenant_id, day, user_sub, user_email, requests, units)
        VALUES (${tenantId}, ${usageDay()}, ${person.sub}, ${person.email ?? null}, ${requests}, ${units})
        ON CONFLICT (tenant_id, day, user_sub) DO UPDATE SET
          requests   = ai_usage_people.requests + EXCLUDED.requests,
          units      = ai_usage_people.units + EXCLUDED.units,
          user_email = COALESCE(EXCLUDED.user_email, ai_usage_people.user_email),
          updated_at = now()
      `
    })
  } catch { /* usage counting never fails a request */ }
}
