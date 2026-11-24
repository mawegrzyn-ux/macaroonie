// src/routes/square.js
//
// Square accounts for sales from other tills (docs/SALES_IMPORT.md 5, sales
// import phase 5, migration 294). Mounted at /api/square. What every system
// shares (venue links, renaming, pausing, the webhook address, removing) is
// on /api/integrations (routes/integrations.js).
//
//   GET   /oauth                     { available, environment, redirect_url }: whether
//                                    Sign in with Square is switched on here
//   POST  /oauth/start               { name } -> { url }: Square's authorize page, with
//                                    a state signed for this tenant and person
//   POST  /oauth/finish              { code, state } from the page Square sent the person
//                                    back to: the state must be this tenant's and
//                                    this person's; ObtainToken; the account saved
//   POST  /connections               { name, access_token, environment } a pasted token,
//                                    checked with Square first
//   PATCH /connections/:id           { access_token?, environment?, signature_key? }
//   POST  /connections/:id/test      check the saved token again
//   GET   /oauth/callback            (squareReturnRoutes, no sign-in) where Square sends the
//                                    person back: redirects to /integrations with
//                                    ?square_code=&square_state= (or square_error=) and
//                                    does nothing else; the page then calls /oauth/finish
//
// All owner/admin with Cash reconciliation manage (as Loyverse's setup).
// Tokens, refresh tokens and the webhook signature key are sealed (rule 10)
// and never returned. A new account gets a webhook address (registered with
// Square when the token may, else shown to paste in Square's dashboard) and
// a first sync, queued.

import { z }          from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'
import { seal }       from '../services/vault.js'
import { officeOrigin } from '../services/platformHost.js'
import { requestSync, setupWebhook, markRequested, clientFor } from '../services/salesImportSvc.js'
import {
  connector, ConnectorError, ENVIRONMENTS, oauthConfig, signState, readState, authorizeUrl, obtainToken, redirectPath, RETURN_PAGE,
} from '../services/connectors/square.js'

/**
 * Square's redirect back after Sign in with Square: the browser comes here
 * with ?code=&state= (or ?error=&error_description=). Nothing is checked or
 * stored here (the person isn't signed in on this request); the values are
 * only renamed onto the Integrations page, which hands them to POST
 * /api/square/oauth/finish with the person's sign-in, where the state is
 * checked. Registered at the root, outside squareRoutes' sign-in hook.
 */
export async function squareReturnRoutes(app) {
  const clean = (v, max) => (typeof v === 'string' && v.length <= max && /^[A-Za-z0-9._~+/=-]+$/.test(v) ? v : null)
  app.get(redirectPath, async (req, reply) => {
    const q = req.query || {}
    const out = new URLSearchParams()
    const code = clean(q.code, 500), state = clean(q.state, 2000)
    if (code && state) {
      out.set('square_code', code)
      out.set('square_state', state)
    } else {
      out.set('square_error', clean(q.error, 100) || 'no_code')
      const said = typeof q.error_description === 'string' ? q.error_description.replace(/[^\w .,'-]/g, '').slice(0, 200) : ''
      if (said) out.set('square_error_description', said)
    }
    return reply.code(302).header('location', RETURN_PAGE + '?' + out.toString()).send()
  })
}

const UUID = z.string().uuid()
const canSetup = [requireRole('admin', 'owner'), requirePermission('cash_recon', 'manage')]
const by = req => req.user?.email ?? null

const Environment = z.enum(ENVIRONMENTS)
const ConnectionBody = z.object({
  name:         z.string().trim().min(1).max(120),
  access_token: z.string().trim().min(8).max(500),
  environment:  Environment.default('production'),
})
const ConnectionPatch = z.object({
  access_token:  z.string().trim().min(8).max(500).optional(),
  environment:   Environment.optional(),
  // Square's webhook signature key, pasted from its dashboard; null clears it.
  signature_key: z.string().trim().min(8).max(200).nullable().optional(),
})
const StartBody  = z.object({ name: z.string().trim().min(1).max(120).default('Square') })
const FinishBody = z.object({ code: z.string().trim().min(4).max(500), state: z.string().trim().min(10).max(2000) })

export const redirectUrl = () => officeOrigin() + redirectPath

const hint = t => String(t).slice(-4)

/** Square's failures become 422 with its message; anything else is rethrown. */
function asHttp(e) {
  if (e instanceof ConnectorError) return httpError(422, e.message)
  return e
}

async function checkToken(token, environment) {
  try { return await connector({ token, environment }).merchant() } catch (e) { throw asHttp(e) }
}

async function ownSquare(tx, tenantId, id) {
  const [c] = await tx`SELECT id, auth_kind, environment FROM pos_connections WHERE id = ${id} AND tenant_id = ${tenantId} AND system = 'square'`
  if (!c) throw httpError(404, 'Square account not found')
  return c
}

const view = c => ({
  id: c.id, system: 'square', name: c.name, environment: c.environment, auth_kind: c.auth_kind, token_hint: c.token_hint,
  business_name: c.business_name, currency: c.currency, merchant_id: c.merchant_id, created_at: c.created_at,
})

/** Saves a new account, or new tokens on the tenant's account for that merchant; then its webhook and a first sync. */
async function saveAccount(req, { name, environment, authKind, token, refresh = null, expiresAt = null, info }) {
  const row = await withTenant(req.tenantId, async tx => {
    const [same] = info.merchant_id ? await tx`
      SELECT id FROM pos_connections
       WHERE tenant_id = ${req.tenantId} AND system = 'square' AND merchant_id = ${info.merchant_id}` : []
    if (same && authKind === 'token') throw httpError(409, 'This Square account is already connected. Replace its token there instead.')
    if (same) {
      const [c] = await tx`
        UPDATE pos_connections
           SET access_token = ${seal(token)}, token_hint = ${hint(token)}, refresh_token = ${seal(refresh)},
               token_expires_at = ${expiresAt ? new Date(expiresAt) : null}, auth_kind = ${authKind}, environment = ${environment},
               business_name = ${info.business_name}, currency = ${info.currency}, last_checked_at = now(), last_error = NULL,
               status = CASE WHEN status = 'error' THEN 'active' ELSE status END, updated_at = now()
         WHERE id = ${same.id} AND tenant_id = ${req.tenantId}
        RETURNING *`
      return { ...c, existed: true }
    }
    const [c] = await tx`
      INSERT INTO pos_connections (tenant_id, system, environment, auth_kind, name, access_token, token_hint, refresh_token, token_expires_at,
                                   merchant_id, business_name, currency, last_checked_at, created_by)
      VALUES (${req.tenantId}, 'square', ${environment}, ${authKind}, ${name}, ${seal(token)}, ${hint(token)}, ${seal(refresh)},
              ${expiresAt ? new Date(expiresAt) : null}, ${info.merchant_id}, ${info.business_name}, ${info.currency}, now(), ${by(req)})
      RETURNING *`
    return c
  })
  const webhook = row.existed ? null : await setupWebhook(req.tenantId, row.id).catch(e => ({ registered: false, error: e.message }))
  if (row.existed) await withTenant(req.tenantId, tx => markRequested(tx, req.tenantId, row.id))
  requestSync(req.tenantId, row.id, req.log)
  return { ...view(row), webhook }
}

export default async function squareRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.get('/oauth', { preHandler: [requirePermission('cash_recon', 'view')] }, async () => {
    const cfg = oauthConfig()
    return cfg ? { available: true, environment: cfg.environment, redirect_url: redirectUrl() } : { available: false }
  })

  app.post('/oauth/start', { preHandler: canSetup }, async req => {
    const cfg = oauthConfig()
    if (!cfg) throw httpError(422, 'Sign in with Square isn\'t switched on here. Paste an access token instead.')
    const body = StartBody.parse(req.body ?? {})
    const state = signState({ tenantId: req.tenantId, userSub: req.user?.sub, name: body.name }, cfg)
    return { url: authorizeUrl({ state, redirectUri: redirectUrl() }, cfg) }
  })

  app.post('/oauth/finish', { preHandler: canSetup }, async (req, reply) => {
    const cfg = oauthConfig()
    if (!cfg) throw httpError(422, 'Sign in with Square isn\'t switched on here.')
    const body = FinishBody.parse(req.body)
    // The state names the tenant and person who started: anyone else's (or
    // a changed or old one) is refused before Square is asked anything.
    const state = readState(body.state, { tenantId: req.tenantId, userSub: req.user?.sub }, cfg)
    if (!state) throw httpError(403, 'This Square sign-in wasn\'t started here (or took too long). Start it again.')
    let t
    try { t = await obtainToken({ code: body.code, redirectUri: redirectUrl() }, cfg) } catch (e) { throw asHttp(e) }
    const info = await checkToken(t.access_token, cfg.environment)
    reply.code(201)
    return saveAccount(req, {
      name: state.name || info.business_name || 'Square', environment: cfg.environment, authKind: 'oauth',
      token: t.access_token, refresh: t.refresh_token, expiresAt: t.expires_at, info: { ...info, merchant_id: info.merchant_id || t.merchant_id },
    })
  })

  app.post('/connections', { preHandler: canSetup }, async (req, reply) => {
    const body = ConnectionBody.parse(req.body)
    const info = await checkToken(body.access_token, body.environment)
    reply.code(201)
    return saveAccount(req, { name: body.name, environment: body.environment, authKind: 'token', token: body.access_token, info })
  })

  app.patch('/connections/:id', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    const body = ConnectionPatch.parse(req.body)
    const c = await withTenant(req.tenantId, tx => ownSquare(tx, req.tenantId, id))
    const environment = body.environment || c.environment || 'production'
    const info = body.access_token ? await checkToken(body.access_token, environment) : null
    if (body.environment && !body.access_token && body.environment !== c.environment) {
      throw httpError(422, 'A token is for one Square environment: paste the other environment\'s token with it.')
    }
    return withTenant(req.tenantId, async tx => {
      if (info) {
        await tx`
          UPDATE pos_connections
             SET access_token = ${seal(body.access_token)}, token_hint = ${hint(body.access_token)}, environment = ${environment},
                 auth_kind = 'token', refresh_token = NULL, token_expires_at = NULL,
                 merchant_id = ${info.merchant_id}, business_name = ${info.business_name}, currency = ${info.currency},
                 last_checked_at = now(), last_error = NULL, status = CASE WHEN status = 'error' THEN 'active' ELSE status END,
                 updated_at = now()
           WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
      if (body.signature_key !== undefined) {
        await tx`
          UPDATE pos_connections
             SET webhook_signature_key = ${body.signature_key ? seal(body.signature_key) : null},
                 webhook_signature_hint = ${body.signature_key ? hint(body.signature_key) : null}, updated_at = now()
           WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      }
      const [row] = await tx`SELECT * FROM pos_connections WHERE id = ${id} AND tenant_id = ${req.tenantId}`
      return view(row)
    })
  })

  app.post('/connections/:id/test', { preHandler: canSetup }, async req => {
    const id = UUID.parse(req.params.id)
    await withTenant(req.tenantId, tx => ownSquare(tx, req.tenantId, id))
    const [conn] = await withTenant(req.tenantId, tx => tx`SELECT * FROM pos_connections WHERE id = ${id} AND tenant_id = ${req.tenantId}`)
    let info = null, error = null
    try { info = await (await clientFor(conn)).merchant() } catch (e) {
      if (!(e instanceof ConnectorError)) throw e
      error = e.message
    }
    return withTenant(req.tenantId, async tx => {
      const [row] = info
        ? await tx`
            UPDATE pos_connections
               SET business_name = ${info.business_name}, currency = ${info.currency}, last_checked_at = now(), last_error = NULL
             WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
        : await tx`
            UPDATE pos_connections SET last_checked_at = now(), last_error = ${error}
             WHERE id = ${id} AND tenant_id = ${req.tenantId} RETURNING *`
      return { ok: !!info, error, connection: view(row) }
    })
  })
}
