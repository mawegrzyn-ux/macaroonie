// src/middleware/auth.js
//
// Validates Auth0 JWTs using JWKS.
// Extracts tenant_id from the custom claim injected by an Auth0 Action.
//
// Auth0 Action (add to Login flow):
// ─────────────────────────────────
// exports.onExecutePostLogin = async (event, api) => {
//   const ns = 'https://macaroonie.com/claims/'
//   api.idToken.setCustomClaim(ns + 'tenant_id', event.organization?.id ?? null)
//   api.accessToken.setCustomClaim(ns + 'tenant_id', event.organization?.id ?? null)
//   api.accessToken.setCustomClaim(ns + 'role', event.user.app_metadata?.role ?? 'operator')
// }
//
// The claim namespace matches AUTH0_CLAIM_NAMESPACE below.

import jwksClient from 'jwks-rsa'
import { createVerifier } from 'fast-jwt'   // fast-jwt ships with fastify/jwt, no extra dep
import { env } from '../config/env.js'
import { sql } from '../config/db.js'

const CLAIM_NS = 'https://macaroonie.com/claims/'

const jwks = jwksClient({
  jwksUri: `https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache:   true,
  rateLimit: true,
})

// Standalone RS256 verifier using JWKS — bypasses the @fastify/jwt HS256 secret
const verify = createVerifier({
  algorithms: ['RS256'],
  audience:   env.AUTH0_AUDIENCE,
  issuer:     `https://${env.AUTH0_DOMAIN}/`,
  key: async ({ header }) => {
    const key = await jwks.getSigningKey(header.kid)
    return key.getPublicKey()
  },
})

/**
 * Fastify preHandler — validates JWT, resolves tenant, attaches to request.
 *
 * Attaches:
 *   req.user        = { sub, email, role }
 *   req.tenantId    = uuid from our tenants table
 *   req.auth0OrgId  = Auth0 org ID (used to resolve tenant)
 */
export async function requireAuth(req, reply) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing authorization header' })
    }

    const token = authHeader.slice(7)

    // Verify signature + expiry via JWKS (RS256)
    const payload = await verify(token)

    const auth0OrgId = payload[`${CLAIM_NS}tenant_id`]
    const role       = payload[`${CLAIM_NS}role`] ?? 'operator'

    if (!auth0OrgId) {
      return reply.code(401).send({ error: 'Token missing tenant claim — ensure user belongs to an organization' })
    }

    // Resolve Auth0 org ID → internal tenant UUID
    const [tenant] = await sql`
      SELECT id FROM tenants
       WHERE auth0_org_id = ${auth0OrgId}
         AND is_active = true
      LIMIT 1
    `

    if (!tenant) {
      return reply.code(401).send({ error: 'Tenant not found or inactive' })
    }

    req.user       = { sub: payload.sub, email: payload.email, role }
    req.tenantId   = tenant.id
    req.auth0OrgId = auth0OrgId

  } catch (err) {
    req.log.warn({ err }, 'Auth failed')
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }
}

/**
 * Role guard factory.
 * @example
 *   preHandler: [requireAuth, requireRole('admin')]
 */
export function requireRole(...roles) {
  return async function (req, reply) {
    if (!roles.includes(req.user?.role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' })
    }
  }
}
