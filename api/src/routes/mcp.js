// src/routes/mcp.js
//
// MCP connectors for AI apps (Claude, ChatGPT and any other MCP client),
// migration 148. Streamable HTTP, stateless (one MCP server per request,
// JSON responses, no sessions), tools from src/ai/tools.
//
//   POST /mcp                       guest connector, no login. Book, change
//                                   and cancel at any restaurant whose tenant
//                                   has AI booking on (ai_settings.guest_mcp_enabled,
//                                   default on). Changes need the emailed code.
//   POST /mcp/staff/:tenantSlug     staff connector for one tenant. Bearer
//                                   token: a personal access token made on the
//                                   Pepper page (mcp_...), or an Auth0
//                                   access token for a member of the tenant.
//                                   Needs the ai_assistant module and
//                                   ai_settings.staff_enabled; each tool then
//                                   checks the person's permission for its area
//                                   (Pepper's tools, src/ai/tools). The list
//                                   holds only the tools the person can use
//                                   (toolAllowed(): View on one of the area's
//                                   modules, Manage for a change tool), and a
//                                   read-only access token gets and runs only
//                                   the reading tools (migration 179). Tokens
//                                   expire (auth.js).
//   GET  /.well-known/oauth-protected-resource/mcp/staff/:tenantSlug
//                                   OAuth protected-resource metadata pointing
//                                   at Macaroonie's own sign-in
//                                   (routes/mcpOauth.js, migration 181), for
//                                   apps that can only connect with OAuth.
//                                   Its tokens are ordinary access tokens.
//
// GET and DELETE on the MCP paths answer 405 (no sessions, no server push).

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { sql } from '../config/db.js'
import { requireAuth, permissionLevel, permissionLevels, ACCESS_TOKEN_PREFIX } from '../middleware/auth.js'
import { makeContext, addUsage, ToolError } from '../ai/context.js'
import { audienceTools, jsonSchemaOf, parseInput, errorText, toolAllowed, SECTION_MODULES } from '../ai/tools/index.js'
import { getAiSettings } from '../ai/settings.js'
import { guestInstructions, staffInstructions } from '../ai/prompts.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'
import { publicOrigin } from './mcpOauth.js'

const VERSION = '1.0.0'

/**
 * listed(tools) -> the tools to list (default all). refuse(tool) -> a
 * message when this caller may not run the tool, else null.
 */
function buildServer({ name, instructions, tools, makeCtx, onCall, listed = async t => t, refuse = () => null }) {
  const server = new Server({ name, version: VERSION }, { capabilities: { tools: {} }, instructions })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await listed(tools)).map(t => ({
      name:        t.name,
      title:       t.title,
      description: t.description,
      inputSchema: jsonSchemaOf(t),
      annotations: {
        title:           t.title,
        readOnlyHint:    !!t.readOnly,
        destructiveHint: !!t.destructive,
        idempotentHint:  !!t.readOnly,
        openWorldHint:   false,
      },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = tools.find(t => t.name === request.params.name)
    const ctx = makeCtx()
    let result
    try {
      if (!tool) throw new ToolError('Unknown tool ' + request.params.name, 404)
      const why = refuse(tool)
      if (why) throw new ToolError(why, 403)
      const out = await tool.run(ctx, parseInput(tool, request.params.arguments))
      result = { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out }
    } catch (err) {
      result = { content: [{ type: 'text', text: errorText(err, ctx.log) }], isError: true }
    }
    await onCall(ctx)
    return result
  })

  return server
}

// Any origin: browser-based MCP clients call these directly. No cookies
// are involved (guests have no login, staff send a bearer token).
const CORS = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Methods':  'POST, OPTIONS',
  'Access-Control-Allow-Headers':  'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
}
const preflight = (req, reply) => reply.headers(CORS).code(204).send()

/** Hands the raw request to a fresh MCP server + transport. */
async function serve(req, reply, server) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  reply.hijack()
  for (const [k, v] of Object.entries(CORS)) reply.raw.setHeader(k, v)
  reply.raw.on('close', () => {
    transport.close().catch(() => {})
    server.close().catch(() => {})
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  } catch (err) {
    req.log.error({ err }, 'MCP request failed')
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'content-type': 'application/json' })
      reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }))
    }
  }
}

const notAllowed = (req, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'Use POST' })

async function tenantBySlug(slug) {
  const [t] = await sql`
    SELECT id, name, slug FROM tenants WHERE slug = ${String(slug || '').toLowerCase()} AND is_active = true LIMIT 1
  `
  return t ?? null
}

export default async function mcpRoutes(app) {
  // ── Guest connector ─────────────────────────────────────
  app.post('/mcp', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const server = buildServer({
      name: 'macaroonie-bookings',
      instructions: guestInstructions(),
      tools: audienceTools('guest'),
      makeCtx: () => makeContext({ app, channel: 'guest_mcp', actor: 'guest', log: req.log }),
      onCall: ctx => addUsage(ctx.touchedTenantId, 'guest_mcp'),
    })
    return serve(req, reply, server)
  })
  app.get('/mcp', notAllowed)
  app.delete('/mcp', notAllowed)
  app.options('/mcp', preflight)

  // ── Staff connector ─────────────────────────────────────
  const staffPath = '/mcp/staff/:tenantSlug'

  app.post(staffPath, {
    config: { allowAccessToken: true, rateLimit: { max: 120, timeWindow: '1 minute' } },
    // An Auth0 login has no X-Tenant-Id from an MCP client: take the tenant
    // from the URL so requireAuth checks membership of that tenant.
    onRequest: async req => {
      const auth = req.headers.authorization || ''
      if (auth.startsWith('Bearer ') && !auth.slice(7).startsWith(ACCESS_TOKEN_PREFIX)) {
        const t = await tenantBySlug(req.params.tenantSlug)
        if (t) req.headers['x-tenant-id'] = t.id
      }
    },
    preHandler: requireAuth,
    onSend: async (req, reply, payload) => {
      reply.headers(CORS)
      if (reply.statusCode === 401) {
        reply.header('WWW-Authenticate',
          'Bearer resource_metadata="' + publicOrigin(req) + '/.well-known/oauth-protected-resource/mcp/staff/' + req.params.tenantSlug + '"')
      }
      return payload
    },
  }, async (req, reply) => {
    const tenant = await tenantBySlug(req.params.tenantSlug)
    if (!tenant || req.tenantId !== tenant.id) {
      return reply.code(403).send({ error: 'This login or access token isn\'t for this restaurant group' })
    }
    const settings = await getAiSettings(tenant.id)
    if (!settings.staff_enabled) return reply.code(403).send({ error: ASSISTANT_NAME + ' is switched off for this restaurant group' })
    if (await permissionLevel(req, 'ai_assistant') === 'none') {
      return reply.code(403).send({ error: 'You don\'t have access to ' + ASSISTANT_NAME })
    }

    const principal = { sub: req.user.sub, email: req.user.email, isPlatformAdmin: !!req.isPlatformAdmin }
    const readOnly = !!req.user.accessTokenReadOnly
    const server = buildServer({
      name: 'macaroonie-staff-' + tenant.slug,
      instructions: staffInstructions({ tenant: tenant.name }),
      tools: audienceTools('staff'),
      // Only the tools this person can use (their module levels, the same
      // check each tool makes when it runs), and only the reading ones for a
      // read-only access token (migration 179).
      listed: async tools => {
        const levels = await permissionLevels(req, Object.values(SECTION_MODULES).flat())
        return tools.filter(t => toolAllowed(t, levels) && !(readOnly && t.confirm))
      },
      refuse: tool => (readOnly && tool.confirm
        ? 'This access token can only read. To make changes, make a token without "Read only" on the ' + ASSISTANT_NAME + ' page (Connect).'
        : null),
      makeCtx: () => makeContext({
        app, channel: 'staff_mcp', tenantId: tenant.id, log: req.log,
        auth: { authorization: req.headers.authorization }, principal,
        actor: req.user.email || req.user.sub,
      }),
      onCall: () => addUsage(tenant.id, 'staff_mcp'),
    })
    return serve(req, reply, server)
  })
  app.get(staffPath, notAllowed)
  app.delete(staffPath, notAllowed)
  app.options(staffPath, preflight)

  // ── OAuth protected-resource metadata (RFC 9728) ────────
  app.get('/.well-known/oauth-protected-resource/mcp/staff/:tenantSlug', async req => ({
    resource:                 publicOrigin(req) + '/mcp/staff/' + req.params.tenantSlug,
    authorization_servers:    [publicOrigin(req)],
    bearer_methods_supported: ['header'],
    scopes_supported:         ['pepper'],
    resource_name:            ASSISTANT_NAME + ' (Macaroonie staff assistant)',
  }))
}
