// OAuth sign-in for the staff MCP connector (migration 181), for AI apps
// that can only connect with OAuth (Claude's custom connectors, ChatGPT).
// The whole dance as an app does it: discovery from the connector's 401,
// dynamic registration, authorize (to the admin's Connect page), Allow as
// the person, the code swapped once with PKCE for a connector token, and
// that token on the connector. Also the refusals: unknown apps and redirect
// addresses, no PKCE, a wrong verifier, a code used twice (revokes the
// token), another tenant's people, Cancel, read only.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { as, getApp, ok, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { officeOrigin } from '../src/services/platformHost.js'
import { env } from '../src/config/env.js'

let ids, owner
const ROOT = env.PUBLIC_ROOT_DOMAIN.toLowerCase()
const ORIGIN = 'https://' + ROOT
const RESOURCE = ORIGIN + '/mcp/staff/thai-house'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

/** A request as an AI app (no login), on the platform's own address. */
async function raw(method, url, { body, form, headers = {} } = {}) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      host: ROOT, 'x-forwarded-proto': 'https',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(form !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    payload: body !== undefined ? JSON.stringify(body) : form !== undefined ? new URLSearchParams(form).toString() : undefined,
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json, body: res.body, headers: res.headers }
}

async function mcp(token, method) {
  return raw('POST', '/mcp/staff/thai-house', {
    body: { jsonrpc: '2.0', id: 1, method, params: {} },
    headers: { accept: 'application/json, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  })
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function register(redirect = CALLBACK, name = 'Claude') {
  return raw('POST', '/oauth/register', { body: { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none' } })
}

/** /oauth/authorize as the app; returns the Connect page's request id. */
async function authorize(clientId, challenge, extra = {}) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge,
    code_challenge_method: 'S256', state: 'st-123', scope: 'pepper', resource: RESOURCE, ...extra,
  })
  const res = await raw('GET', '/oauth/authorize?' + q)
  return res
}
const requestIdOf = res => new URL(res.headers.location).searchParams.get('request')

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
})
after(closeApp)

test('discovery: the connector points apps at Macaroonie\'s own sign-in', async () => {
  const none = await mcp(null, 'tools/list')
  assert.equal(none.status, 401)
  const meta = none.headers['www-authenticate'].match(/resource_metadata="([^"]+)"/)[1]
  assert.equal(meta, ORIGIN + '/.well-known/oauth-protected-resource/mcp/staff/thai-house')
  const pr = await raw('GET', new URL(meta).pathname)
  assert.deepEqual(pr.json.authorization_servers, [ORIGIN])
  assert.equal(pr.json.resource, RESOURCE)
  const as1 = await raw('GET', '/.well-known/oauth-authorization-server')
  assert.equal(as1.json.issuer, ORIGIN)
  assert.equal(as1.json.registration_endpoint, ORIGIN + '/oauth/register')
  assert.equal(as1.json.token_endpoint, ORIGIN + '/oauth/token')
  assert.deepEqual(as1.json.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(as1.json.token_endpoint_auth_methods_supported, ['none'])
  assert.equal((await raw('GET', '/.well-known/openid-configuration')).json.authorization_endpoint, ORIGIN + '/oauth/authorize')
})

test('registration: https or localhost redirects only, public clients only', async () => {
  assert.equal((await register('http://evil.example/cb')).status, 400)
  assert.equal((await register('javascript:alert(1)')).status, 400)
  const secret = await raw('POST', '/oauth/register', { body: { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' } })
  assert.equal(secret.status, 400)
  const local = await register('http://localhost:33418/callback', 'Claude Code')
  assert.equal(local.status, 201)
  const c = await register()
  assert.equal(c.status, 201)
  assert.match(c.json.client_id, /^mcpc_[0-9a-f]{32}$/)
  assert.equal(c.json.token_endpoint_auth_method, 'none')
})

test('the whole sign-in: authorize, Allow on the Connect page, code for a token, the token on the connector', async () => {
  const client = (await register()).json
  const { verifier, challenge } = pkce()

  // Bad requests: unknown app or address get a page, the rest go back to the app.
  assert.equal((await authorize('mcpc_nope', challenge)).status, 400)
  assert.equal((await authorize(client.client_id, challenge, { redirect_uri: 'https://claude.ai/other' })).status, 400)
  const noPkce = await authorize(client.client_id, challenge, { code_challenge_method: 'plain' })
  assert.equal(noPkce.status, 302)
  assert.equal(new URL(noPkce.headers.location).searchParams.get('error'), 'invalid_request')
  const badResource = await authorize(client.client_id, challenge, { resource: ORIGIN + '/mcp/staff/no-such-group' })
  assert.equal(new URL(badResource.headers.location).searchParams.get('error'), 'invalid_target')

  const res = await authorize(client.client_id, challenge)
  assert.equal(res.status, 302)
  assert.ok(res.headers.location.startsWith(officeOrigin() + '/connect-ai?request='), res.headers.location)
  const id = requestIdOf(res)

  // The other tenant's owner isn't a member of Thai House.
  const theirs = await ok(as(B.owner, ids.b).get('/api/ai/oauth/requests/' + id))
  assert.equal(theirs.member, false)
  assert.equal((await as(B.owner, ids.b).post('/api/ai/oauth/requests/' + id + '/allow', {})).status, 409)

  const page = await ok(owner.get('/api/ai/oauth/requests/' + id))
  assert.equal(page.client_name, 'Claude')
  assert.equal(page.redirect_host, 'claude.ai')
  assert.equal(page.tenant.name, 'Thai House')
  assert.equal(page.member, true)
  assert.equal(page.needs_switch, false)
  assert.equal(page.problem, null)
  assert.equal((await owner.post('/api/ai/oauth/requests/' + id + '/allow', { expires_in_days: 45 })).status, 400)

  const allowed = await ok(owner.post('/api/ai/oauth/requests/' + id + '/allow', { expires_in_days: 30 }))
  const back = new URL(allowed.redirect)
  assert.equal(back.origin + back.pathname, CALLBACK)
  assert.equal(back.searchParams.get('state'), 'st-123')
  assert.equal(back.searchParams.get('iss'), ORIGIN)
  const code = back.searchParams.get('code')
  assert.ok(code)
  assert.equal((await owner.get('/api/ai/oauth/requests/' + id)).status, 409, 'answered once')

  const swap = form => raw('POST', '/oauth/token', { form: { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: CALLBACK, code, code_verifier: verifier, ...form } })
  assert.equal((await swap({ code_verifier: pkce().verifier })).json.error, 'invalid_grant', 'wrong verifier')
  assert.equal((await swap({ redirect_uri: 'https://claude.ai/other' })).json.error, 'invalid_grant')
  assert.equal((await swap({ grant_type: 'refresh_token' })).json.error, 'unsupported_grant_type')
  const tok = await swap({})
  assert.equal(tok.status, 200, tok.body)
  assert.equal(tok.json.token_type, 'Bearer')
  assert.match(tok.json.access_token, /^mcp_[0-9a-f]{40}$/)
  assert.equal(tok.json.expires_in, 30 * 86400)
  assert.equal(tok.headers['cache-control'], 'no-store')

  const list = await mcp(tok.json.access_token, 'tools/list')
  assert.equal(list.status, 200, list.body)
  assert.ok(list.json.result.tools.some(t => t.name === 'create_booking'), 'a full token gets change tools')

  const tokens = await ok(owner.get('/api/ai/tokens'))
  const mine = tokens.find(t => t.name === 'Claude (connected app)')
  assert.ok(mine, 'listed with the access tokens')
  const days = (Date.parse(mine.expires_at) - Date.now()) / 86_400_000
  assert.ok(days > 29 && days <= 30, String(days))

  // The code again: refused, and the token it made is taken back.
  assert.equal((await swap({})).json.error, 'invalid_grant')
  assert.equal((await mcp(tok.json.access_token, 'tools/list')).status, 401)
})

test('read only, Cancel, and an old request', async () => {
  const client = (await register('https://chatgpt.com/connector_platform_oauth_redirect', 'ChatGPT')).json
  const { verifier, challenge } = pkce()
  const q = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'x', resource: RESOURCE,
  })
  const id = requestIdOf(await raw('GET', '/oauth/authorize?' + q))
  const r = await ok(owner.post('/api/ai/oauth/requests/' + id + '/allow', { read_only: true }))
  const code = new URL(r.redirect).searchParams.get('code')
  const tok = await raw('POST', '/oauth/token', {
    body: { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', code, code_verifier: verifier },
  })
  assert.equal(tok.status, 200, tok.body)
  const tools = (await mcp(tok.json.access_token, 'tools/list')).json.result.tools
  assert.ok(tools.length > 0)
  assert.ok(!tools.some(t => t.name === 'create_booking'), 'read only lists no change tools')

  const id2 = requestIdOf(await authorize((await register()).json.client_id, pkce().challenge))
  const d = await ok(owner.post('/api/ai/oauth/requests/' + id2 + '/deny', {}))
  assert.equal(new URL(d.redirect).searchParams.get('error'), 'access_denied')
  assert.equal((await owner.post('/api/ai/oauth/requests/' + id2 + '/allow', {})).status, 409)

  const id3 = requestIdOf(await authorize((await register()).json.client_id, pkce().challenge))
  await sql`UPDATE ai_oauth_grants SET expires_at = now() - interval '1 minute' WHERE id = ${id3}`
  assert.equal((await owner.get('/api/ai/oauth/requests/' + id3)).status, 410)
})

test('Pepper switched off: the Connect page says so and Allow is refused', async () => {
  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const id = requestIdOf(await authorize((await register()).json.client_id, pkce().challenge))
    const page = await ok(owner.get('/api/ai/oauth/requests/' + id))
    assert.match(page.problem, /switched off/)
    assert.equal((await owner.post('/api/ai/oauth/requests/' + id + '/allow', {})).status, 403)
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }
})
