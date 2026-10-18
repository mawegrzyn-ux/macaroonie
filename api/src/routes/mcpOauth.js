// src/routes/mcpOauth.js
//
// OAuth sign-in for the staff MCP connector (migration 181), for AI apps
// that can only connect with OAuth: Claude's custom connectors (claude.ai,
// the Claude apps) and ChatGPT. Macaroonie is its own authorization server;
// the access token the app ends up with is an ordinary connector token
// (ai_access_tokens, mcp_...), so everything after sign-in is the same as a
// token made on the Pepper page.
//
//   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata (also at
//        /.well-known/openid-configuration and with a path after it)
//   POST /oauth/register      dynamic client registration (RFC 7591): public
//                             clients, https redirect addresses (or http on
//                             localhost), no secret
//   GET  /oauth/authorize     checks the app and its redirect address, keeps
//                             the request (ai_oauth_grants, 15 minutes) and
//                             sends the person to the admin's Connect page
//                             (office.<domain>/connect-ai?request=...)
//   POST /oauth/token         authorization_code + PKCE (S256) -> the token;
//                             a code works once (a second try revokes it)
//
//   GET  /api/ai/oauth/requests/:id         the Connect page: the app, the
//                                           restaurant group, what's allowed
//   POST /api/ai/oauth/requests/:id/allow   { read_only, expires_in_days }
//   POST /api/ai/oauth/requests/:id/deny
//
// The public routes find their rows by id or code in system mode; the
// Connect page's routes are the person's own login (requireAuth) and check
// the same things as making a token on the Pepper page.

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { systemSql, withSystem, withTenant } from '../config/db.js'
import { env } from '../config/env.js'
import { requireAuth, permissionLevel, newAccessToken } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { getAiSettings } from '../ai/settings.js'
import { officeOrigin } from '../services/platformHost.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

const REQUEST_MINUTES = 15
const CODE_MINUTES = 5
const DAYS = [30, 90, 180, 365]
const SCOPE = 'pepper'

const sha256 = s => createHash('sha256').update(s).digest('hex')
const randomId = (bytes = 24) => randomBytes(bytes).toString('base64url')
const base64urlSha256 = s => createHash('sha256').update(s).digest('base64url')

/** The address the app used (proxy headers first), which is the issuer. */
export function publicOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || env.PUBLIC_ROOT_DOMAIN
  const proto = req.headers['x-forwarded-proto'] || env.PUBLIC_SITE_SCHEME || 'https'
  return proto + '://' + host
}

// Apps call these from servers and browsers alike.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version',
}
const preflight = (req, reply) => reply.headers(CORS).code(204).send()

/** An OAuth error response (RFC 6749 5.2): 400 unless said. */
function oauthError(reply, error, description, status = 400) {
  return reply.headers({ ...CORS, 'Cache-Control': 'no-store' }).code(status)
    .send({ error, ...(description ? { error_description: description } : {}) })
}

/** An https address, or http on this machine (apps running locally). */
function redirectAllowed(uri) {
  let u
  try { u = new URL(uri) } catch { return false }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
}

/** The tenant a connector address names: <origin>/mcp/staff/<slug>. */
async function tenantOfResource(resource) {
  if (!resource) return null
  let path
  try { path = new URL(resource).pathname } catch { return undefined }
  const m = path.match(/^\/mcp\/staff\/([a-z0-9-]+)\/?$/i)
  if (!m) return undefined
  const [t] = await systemSql`SELECT id, name, slug FROM tenants WHERE slug = ${m[1].toLowerCase()} AND is_active = true LIMIT 1`
  return t ?? undefined
}

function withParams(uri, params) {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v)
  return u.toString()
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** A plain page for a sign-in link that can't go back to the app. */
function problemPage(reply, message) {
  return reply.code(400).type('text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Can't connect</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}h1{font-size:1.25rem}</style>
</head><body><h1>This sign-in link doesn't work</h1><p>${escapeHtml(message)}</p>
<p>Start connecting again from your AI app.</p></body></html>`)
}

function metadata(req) {
  const issuer = publicOrigin(req)
  return {
    issuer,
    authorization_endpoint:                issuer + '/oauth/authorize',
    token_endpoint:                        issuer + '/oauth/token',
    registration_endpoint:                 issuer + '/oauth/register',
    response_types_supported:              ['code'],
    grant_types_supported:                 ['authorization_code'],
    code_challenge_methods_supported:      ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported:                      [SCOPE],
    service_documentation:                 officeOrigin() + '/help#pepper',
  }
}

const RegisterBody = z.object({
  redirect_uris:              z.array(z.string().max(2000)).min(1).max(10),
  client_name:                z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.string().max(60).optional(),
}).passthrough()

const AllowBody = z.object({
  read_only:       z.boolean().default(false),
  expires_in_days: z.union(DAYS.map(d => z.literal(d))).default(90),
})

/** A sign-in request the Connect page may still decide. */
async function openGrant(id) {
  const [g] = await systemSql`
    SELECT g.*, c.client_name FROM ai_oauth_grants g
      JOIN ai_oauth_clients c ON c.id = g.client_id
     WHERE g.id = ${String(id)} LIMIT 1
  `
  if (!g) throw httpError(404, 'This sign-in request was not found. Start connecting again from your AI app.')
  if (g.decided_at) throw httpError(409, 'This sign-in request has already been answered. Start connecting again from your AI app.')
  if (new Date(g.expires_at) <= new Date()) throw httpError(410, 'This sign-in request has expired. Start connecting again from your AI app.')
  return g
}

export default async function mcpOauthRoutes(app) {
  // ── Metadata ─────────────────────────────────────────────
  const meta = async (req, reply) => reply.headers(CORS).send(metadata(req))
  app.get('/.well-known/oauth-authorization-server', meta)
  app.get('/.well-known/oauth-authorization-server/*', meta)
  app.get('/.well-known/openid-configuration', meta)

  // ── Dynamic client registration ──────────────────────────
  app.post('/oauth/register', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body || {})
    if (!parsed.success) return oauthError(reply, 'invalid_client_metadata', 'redirect_uris is needed')
    const b = parsed.data
    const bad = b.redirect_uris.find(u => !redirectAllowed(u))
    if (bad) return oauthError(reply, 'invalid_redirect_uri', 'Redirect addresses must be https (or http on localhost): ' + bad.slice(0, 200))
    if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none') {
      return oauthError(reply, 'invalid_client_metadata', 'Only public clients (token_endpoint_auth_method none, with PKCE) are supported')
    }
    const id = 'mcpc_' + randomBytes(16).toString('hex')
    const name = (b.client_name || 'AI app').replace(/\s+/g, ' ').slice(0, 100)
    const [c] = await systemSql`
      INSERT INTO ai_oauth_clients (id, client_name, redirect_uris)
      VALUES (${id}, ${name}, ${[...new Set(b.redirect_uris)]})
      RETURNING created_at
    `
    return reply.headers({ ...CORS, 'Cache-Control': 'no-store' }).code(201).send({
      client_id: id,
      client_id_issued_at: Math.floor(new Date(c.created_at).getTime() / 1000),
      client_name: name,
      redirect_uris: [...new Set(b.redirect_uris)],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
  })
  app.options('/oauth/register', preflight)

  // ── Authorization ────────────────────────────────────────
  app.get('/oauth/authorize', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = req.query || {}
    const [client] = q.client_id ? await systemSql`SELECT * FROM ai_oauth_clients WHERE id = ${String(q.client_id)} LIMIT 1` : []
    if (!client) return problemPage(reply, 'The app asking to connect isn\'t known here.')
    const redirect = q.redirect_uri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : null)
    if (!redirect || !client.redirect_uris.includes(redirect)) {
      return problemPage(reply, 'The app asked to come back to an address it didn\'t register.')
    }
    // From here problems go back to the app (RFC 6749 4.1.2.1).
    const fail = (error, description) => reply.redirect(withParams(redirect, { error, error_description: description, state: q.state, iss: publicOrigin(req) }))
    if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return fail('invalid_request', 'PKCE with code_challenge_method S256 is required')
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge))) return fail('invalid_request', 'code_challenge is not valid')
    const tenant = await tenantOfResource(q.resource)
    if (tenant === undefined) return fail('invalid_target', 'resource is not a Macaroonie staff connector address')

    const id = randomId()
    await systemSql`
      INSERT INTO ai_oauth_grants (id, client_id, issuer, redirect_uri, state, code_challenge, scope, resource, tenant_id, expires_at)
      VALUES (${id}, ${client.id}, ${publicOrigin(req)}, ${redirect}, ${q.state ?? null}, ${String(q.code_challenge)},
              ${q.scope ? String(q.scope).slice(0, 500) : null}, ${q.resource ? String(q.resource).slice(0, 500) : null},
              ${tenant?.id ?? null}, now() + make_interval(mins => ${REQUEST_MINUTES}))
    `
    return reply.redirect(officeOrigin() + '/connect-ai?request=' + encodeURIComponent(id))
  })

  // ── Token ────────────────────────────────────────────────
  app.post('/oauth/token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {}
    if (b.grant_type !== 'authorization_code') return oauthError(reply, 'unsupported_grant_type', 'Only authorization_code is supported')
    if (!b.code || !b.client_id || !b.code_verifier || !b.redirect_uri) {
      return oauthError(reply, 'invalid_request', 'code, client_id, redirect_uri and code_verifier are needed')
    }
    const out = await withSystem(async tx => {
      const [g] = await tx`
        SELECT g.*, c.client_name FROM ai_oauth_grants g JOIN ai_oauth_clients c ON c.id = g.client_id
         WHERE g.code_hash = ${sha256(String(b.code))} FOR UPDATE OF g
      `
      if (!g || g.client_id !== String(b.client_id) || g.redirect_uri !== String(b.redirect_uri)) return { error: 'invalid_grant' }
      if (g.used_at) {
        // A code used twice: take back the token the first use made.
        if (g.access_token_id) await tx`UPDATE ai_access_tokens SET revoked_at = now() WHERE id = ${g.access_token_id} AND revoked_at IS NULL`
        return { error: 'invalid_grant', description: 'This code has already been used' }
      }
      if (new Date(g.expires_at) <= new Date()) return { error: 'invalid_grant', description: 'This code has expired' }
      const verifier = String(b.code_verifier)
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || base64urlSha256(verifier) !== g.code_challenge) {
        return { error: 'invalid_grant', description: 'code_verifier does not match' }
      }
      const [user] = await tx`
        SELECT u.id FROM users u JOIN tenants t ON t.id = u.tenant_id AND t.is_active
         WHERE u.id = ${g.user_id} AND u.tenant_id = ${g.tenant_id} AND u.is_active LIMIT 1
      `
      if (!user) return { error: 'invalid_grant', description: 'The person who allowed this no longer has access' }
      const { token, hash, prefix } = newAccessToken()
      const name = (g.client_name.slice(0, 60) + ' (connected app)').slice(0, 80)
      const [t] = await tx`
        INSERT INTO ai_access_tokens (tenant_id, user_id, name, token_prefix, token_hash, expires_at, read_only, oauth_client_id, oauth_grant_id)
        VALUES (${g.tenant_id}, ${g.user_id}, ${name}, ${prefix}, ${hash}, now() + make_interval(days => ${g.expires_in_days}),
                ${g.read_only}, ${g.client_id}, ${g.id})
        RETURNING id
      `
      await tx`UPDATE ai_oauth_grants SET used_at = now(), access_token_id = ${t.id} WHERE id = ${g.id}`
      await tx`UPDATE ai_oauth_clients SET last_used_at = now() WHERE id = ${g.client_id}`
      return { token, days: g.expires_in_days, scope: g.scope }
    })
    if (out.error) return oauthError(reply, out.error, out.description)
    return reply.headers({ ...CORS, 'Cache-Control': 'no-store', Pragma: 'no-cache' }).send({
      access_token: out.token,
      token_type: 'Bearer',
      expires_in: out.days * 86400,
      scope: out.scope || SCOPE,
    })
  })
  app.options('/oauth/token', preflight)

  // ── The Connect page (the person's own login) ────────────
  /** Can this person use the connector in their current restaurant group? */
  async function connectProblem(req) {
    const settings = await getAiSettings(req.tenantId)
    if (!settings.staff_enabled) return ASSISTANT_NAME + ' is switched off for this restaurant group, so its connector is off too.'
    if (await permissionLevel(req, 'ai_assistant') === 'none') return 'Your role doesn\'t include ' + ASSISTANT_NAME + '. Ask an owner or admin.'
    const [user] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} AND is_active = true LIMIT 1
    `)
    if (!user) return 'Connected apps are for team members of this restaurant group. Ask an owner to invite you.'
    return null
  }

  app.get('/api/ai/oauth/requests/:id', { preHandler: requireAuth }, async req => {
    const g = await openGrant(req.params.id)
    let tenant = null
    let member = true
    if (g.tenant_id) {
      ;[tenant] = await systemSql`SELECT id, name, slug FROM tenants WHERE id = ${g.tenant_id}`
      const [m] = await systemSql`
        SELECT 1 FROM users WHERE tenant_id = ${g.tenant_id} AND auth0_user_id = ${req.user.sub} AND is_active LIMIT 1
      `
      member = !!m || !!req.isPlatformAdmin
    }
    const here = g.tenant_id ? g.tenant_id === req.tenantId : !!req.tenantId
    let current = null
    if (req.tenantId) [current] = await systemSql`SELECT id, name FROM tenants WHERE id = ${req.tenantId}`
    return {
      client_name: g.client_name,
      redirect_host: new URL(g.redirect_uri).host,
      tenant: tenant ?? current,
      current_tenant: current,
      member,
      needs_switch: member && !here,
      problem: member && here ? await connectProblem(req) : null,
      email: req.user.email ?? null,
      expires_at: g.expires_at,
      days: DAYS,
    }
  })

  app.post('/api/ai/oauth/requests/:id/allow', { preHandler: requireAuth }, async req => {
    const b = AllowBody.parse(req.body || {})
    const g = await openGrant(req.params.id)
    if (!req.tenantId) throw httpError(400, 'Pick a restaurant group first')
    if (g.tenant_id && g.tenant_id !== req.tenantId) throw httpError(409, 'This connection is for another restaurant group: switch to it first')
    const problem = await connectProblem(req)
    if (problem) throw httpError(403, problem)
    const [user] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} AND is_active = true LIMIT 1
    `)
    const code = randomId(32)
    const [done] = await systemSql`
      UPDATE ai_oauth_grants
         SET tenant_id = ${req.tenantId}, user_id = ${user.id}, read_only = ${b.read_only}, expires_in_days = ${b.expires_in_days},
             code_hash = ${sha256(code)}, decided_at = now(), expires_at = now() + make_interval(mins => ${CODE_MINUTES})
       WHERE id = ${g.id} AND decided_at IS NULL
      RETURNING id
    `
    if (!done) throw httpError(409, 'This sign-in request has already been answered. Start connecting again from your AI app.')
    return { redirect: withParams(g.redirect_uri, { code, state: g.state, iss: g.issuer }) }
  })

  app.post('/api/ai/oauth/requests/:id/deny', { preHandler: requireAuth }, async req => {
    const g = await openGrant(req.params.id)
    await systemSql`UPDATE ai_oauth_grants SET decided_at = now(), denied = true WHERE id = ${g.id} AND decided_at IS NULL`
    return {
      redirect: withParams(g.redirect_uri, { error: 'access_denied', error_description: 'The person cancelled', state: g.state, iss: g.issuer }),
    }
  })
}
