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
import { sql, withTenant } from '../config/db.js'

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

// Role hierarchy — higher index = more privilege
const ROLE_HIERARCHY = ['viewer', 'operator', 'admin', 'owner']

/**
 * Fastify preHandler — validates JWT, resolves tenant, attaches to request.
 *
 * Attaches:
 *   req.user            = { sub, email, role, isPlatformAdmin }
 *   req.tenantId        = uuid from our tenants table (null for platform admin without org)
 *   req.auth0OrgId      = Auth0 org ID (used to resolve tenant)
 *   req.isPlatformAdmin = true if the user is in platform_admins
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

    // Try the custom claim first (injected by Auth0 Login Action).
    // Fall back to the standard `org_id` claim that Auth0 always includes
    // when a user logs in within an organisation — this means tenant
    // resolution works even when the Login Action is not deployed.
    const auth0OrgId = payload[`${CLAIM_NS}tenant_id`] ?? payload.org_id ?? null
    const role       = payload[`${CLAIM_NS}role`] ?? 'operator'
    const auth0Sub   = payload.sub

    // Check platform admin status (global — not tenant-scoped). 3s race timeout
    // so a stuck DB query can never produce ERR_EMPTY_RESPONSE upstream.
    const [platformAdmin] = await Promise.race([
      sql`
        SELECT id FROM platform_admins
         WHERE auth0_user_id = ${auth0Sub}
           AND is_active = true
         LIMIT 1
      `,
      new Promise((_, rej) => setTimeout(() => rej(new Error('platform_admins lookup timeout')), 3000)),
    ])
    const isPlatformAdmin = !!platformAdmin

    // Platform admins may operate without an org (for tenant management).
    // Normal users must always have an org claim.
    if (!auth0OrgId && !isPlatformAdmin) {
      return reply.code(401).send({ error: 'Token missing tenant claim — ensure user belongs to an organization' })
    }

    let tenantId = null
    if (auth0OrgId) {
      const [tenant] = await Promise.race([
        sql`
          SELECT id FROM tenants
           WHERE auth0_org_id = ${auth0OrgId}
             AND is_active = true
          LIMIT 1
        `,
        new Promise((_, rej) => setTimeout(() => rej(new Error('tenants lookup timeout')), 3000)),
      ])
      if (!tenant && !isPlatformAdmin) {
        return reply.code(401).send({ error: 'Tenant not found or inactive' })
      }
      tenantId = tenant?.id ?? null
    }

    // Platform admin tenant override — allows a platform admin to work in a
    // specific tenant without re-authenticating through that tenant's Auth0 org.
    // Only honoured when the caller IS a platform admin and has no org claim.
    if (isPlatformAdmin && !tenantId) {
      const overrideId = req.headers['x-platform-tenant']
      if (overrideId) {
        const [overrideTenant] = await sql`
          SELECT id FROM tenants WHERE id = ${overrideId} AND is_active = true LIMIT 1
        `.catch(() => [null])
        if (overrideTenant) tenantId = overrideTenant.id
      }
    }

    // Reconcile local user row with Auth0 identity.
    //
    // Runs for ALL authenticated users who have a tenant context —
    // including platform admins (they may also have an invited users row
    // in the tenant and need their auth0_user_id linked on first login).
    //
    // For tenant users:
    //   1. Already linked → bump last_login_at, use local role.
    //   2. First login after invite (auth0_user_id NULL, email matches) → link sub.
    //   3. is_active=false locally → deny.
    //   4. No users row found after full reconcile attempt → deny non-platform-admins
    //      (user was never invited). Platform admins operate fine without a row.
    //
    // Both reads use Promise.race timeouts so a stuck DB query can never
    // produce ERR_EMPTY_RESPONSE upstream. last_login_at is fire-and-forget.
    let dbRole = null
    let userNotFound = false
    if (tenantId && auth0Sub) {
      const withTimeout = (p, ms, label) => Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms)),
      ])
      try {
        const [localUser] = await withTimeout(
          withTenant(tenantId, tx => tx`
            SELECT id, role, is_active FROM users
             WHERE auth0_user_id = ${auth0Sub} AND tenant_id = ${tenantId}
             LIMIT 1`),
          2000, 'user lookup',
        )
        let resolved = localUser
        if (!resolved && payload.email) {
          const [linked] = await withTimeout(
            withTenant(tenantId, tx => tx`
              UPDATE users
                 SET auth0_user_id = ${auth0Sub}, last_login_at = now()
               WHERE tenant_id = ${tenantId}
                 AND lower(email) = lower(${payload.email})
                 AND auth0_user_id IS NULL
              RETURNING id, role, is_active`),
            2000, 'invite link',
          )
          if (linked) resolved = linked
        }
        if (resolved) {
          if (!resolved.is_active) {
            return reply.code(403).send({ error: 'Your account has been deactivated' })
          }
          dbRole = resolved.role
          withTenant(tenantId, tx => tx`UPDATE users SET last_login_at = now() WHERE id = ${resolved.id}`)
            .catch(e => req.log.warn({ err: e }, 'last_login_at update failed'))
        } else if (!isPlatformAdmin) {
          // Reconcile completed cleanly but no matching user row exists —
          // this user was never invited. Block them.
          // Platform admins operate without a tenant users row — allow through.
          userNotFound = true
        }
      } catch (e) {
        // Timeout or DB error — allow through with JWT role fallback rather
        // than blocking a legitimate user due to infra failure.
        req.log.warn({ err: e?.message || e }, 'User reconcile failed (non-fatal)')
      }
    }

    // Block users who logged into the org but were never invited.
    // (userNotFound is only set when reconcile ran cleanly — DB timeouts
    //  leave it false so we don't block legitimate users during infra issues.)
    if (userNotFound) {
      return reply.code(403).send({ error: 'Your account has not been set up for this organisation. Ask your administrator to invite you.' })
    }

    req.user = {
      sub:             auth0Sub,
      email:           payload.email,
      role:            isPlatformAdmin ? 'owner' : (dbRole ?? role),
      isPlatformAdmin,
    }
    req.tenantId       = tenantId
    req.auth0OrgId     = auth0OrgId
    req.isPlatformAdmin = isPlatformAdmin

  } catch (err) {
    req.log.warn({ err: err?.message || err }, 'Auth failed')
    return reply.code(401).send({ error: 'Invalid or expired token' })
  }
}

/**
 * Role guard factory. Checks the RBAC hierarchy.
 * Platform admins bypass all role checks.
 *
 * @example
 *   preHandler: [requireAuth, requireRole('admin', 'owner')]
 *   // allows admin, owner, and platform admins
 */
export function requireRole(...roles) {
  return async function (req, reply) {
    if (req.isPlatformAdmin) return  // platform admins pass all role gates
    if (!roles.includes(req.user?.role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' })
    }
  }
}

/**
 * Platform admin guard — only platform admins pass.
 *
 * MUST be async. A sync hook with no `done` parameter chains
 * unreliably in Fastify v4 preHandler arrays — the next hook
 * (route handler) sometimes never runs.
 */
export async function requirePlatformAdmin(req, reply) {
  if (!req.isPlatformAdmin) {
    return reply.code(403).send({ error: 'Platform admin access required' })
  }
}

/**
 * Module-level permission gate. Reads tenant_modules + the
 * caller's tenant_roles permissions and rejects with 403 if:
 *   - the module is disabled at the tenant level, OR
 *   - the caller's role permission for that module is below the required level.
 *
 * Platform admins always pass.
 *
 * Required level: 'view' (default) or 'manage'.
 *
 * @example
 *   preHandler: [requireAuth, requirePermission('cash_recon', 'manage')]
 */
const PERMISSION_RANK = { none: 0, view: 1, manage: 2 }

export function requirePermission(moduleKey, requiredLevel = 'view') {
  return async function (req, reply) {
    if (req.isPlatformAdmin) return
    if (!req.tenantId) return reply.code(400).send({ error: 'No tenant context' })

    const [moduleRow] = await sql`
      SELECT is_enabled FROM tenant_modules
       WHERE tenant_id = ${req.tenantId} AND module_key = ${moduleKey}
       LIMIT 1
    `
    // Default to enabled if no row exists yet (legacy tenants).
    if (moduleRow && !moduleRow.is_enabled) {
      return reply.code(403).send({ error: `Module "${moduleKey}" is disabled for this tenant` })
    }

    // Lookup permissions: prefer custom_role_id, fall back to built-in matching users.role.
    const [permRow] = await sql`
      SELECT COALESCE(r_custom.permissions, r_builtin.permissions, '{}'::jsonb) AS permissions
        FROM users u
   LEFT JOIN tenant_roles r_custom  ON r_custom.id  = u.custom_role_id
   LEFT JOIN tenant_roles r_builtin ON r_builtin.tenant_id = u.tenant_id
                                   AND r_builtin.key       = u.role::text
                                   AND r_builtin.is_builtin = true
       WHERE u.auth0_user_id = ${req.user.sub}
         AND u.tenant_id     = ${req.tenantId}
         AND u.is_active     = true
       LIMIT 1
    `
    const actual = permRow?.permissions?.[moduleKey] ?? 'none'
    if (PERMISSION_RANK[actual] < PERMISSION_RANK[requiredLevel]) {
      return reply.code(403).send({ error: `Insufficient permission for ${moduleKey} (have: ${actual}, need: ${requiredLevel})` })
    }
  }
}
