// src/routes/platform.js
//
// Platform admin routes + /api/me endpoint.
// Mounted at /api in app.js (mixed prefixes).
//
//   GET  /api/me                          — current user info + available tenants
//   GET  /api/platform/tenants            — list all tenants (platform admin)
//   POST /api/platform/tenants            — create tenant (platform admin)
//   PATCH /api/platform/tenants/:id       — update tenant (platform admin)
//   GET  /api/platform/tenants/:id/stats  — tenant stats (platform admin)

import { z } from 'zod'
import { sql } from '../config/db.js'
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import {
  isConfigured as auth0IsConfigured,
  provisionTenantOrg,
} from '../services/auth0MgmtSvc.js'
import { MODULES, MODULE_KEYS } from '../config/modules.js'

const TenantBody = z.object({
  name:              z.string().min(1).max(200),
  slug:              z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  plan:              z.enum(['starter', 'pro', 'enterprise']).default('starter'),
  auth0_org_id:      z.string().optional(),
  stripe_account_id: z.string().nullable().optional(),
  is_active:         z.boolean().default(true),
  // When true (default), creates the Auth0 organization automatically
  // and enables Username-Password + Google connections on it.
  auto_provision:    z.boolean().default(true),
})

const TenantPatch = z.object({
  name:              z.string().min(1).max(200).optional(),
  slug:              z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  plan:              z.enum(['starter', 'pro', 'enterprise']).optional(),
  auth0_org_id:      z.string().nullable().optional(),
  stripe_account_id: z.string().nullable().optional(),
  is_active:         z.boolean().optional(),
})

export default async function platformRoutes(app) {

  // ── GET /api/me ─────────────────────────────────────────
  // Returns the current user's profile + available tenants +
  // effective module permissions (for the frontend to gate nav).
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const { sub, email, role, isPlatformAdmin } = req.user

    // Current tenant info (if in a tenant context)
    let currentTenant = null
    if (req.tenantId) {
      [currentTenant] = await sql`
        SELECT id, name, slug, plan, is_active FROM tenants WHERE id = ${req.tenantId}
      `
    }

    // Local user + custom_role (if any). Fall back to a built-in
    // role keyed by users.role enum when custom_role_id is NULL.
    let localUser = null
    let effectiveRole = null
    if (req.tenantId) {
      [localUser] = await sql`
        SELECT u.id, u.full_name, u.role, u.is_active, u.custom_role_id,
               r_custom.id          AS r_id,
               r_custom.key         AS r_key,
               r_custom.label       AS r_label,
               r_custom.permissions AS r_permissions,
               r_builtin.id          AS rb_id,
               r_builtin.key         AS rb_key,
               r_builtin.label       AS rb_label,
               r_builtin.permissions AS rb_permissions
          FROM users u
     LEFT JOIN tenant_roles r_custom  ON r_custom.id  = u.custom_role_id
     LEFT JOIN tenant_roles r_builtin ON r_builtin.tenant_id = u.tenant_id
                                     AND r_builtin.key       = u.role::text
                                     AND r_builtin.is_builtin = true
         WHERE u.auth0_user_id = ${sub} AND u.tenant_id = ${req.tenantId}
      `
      if (localUser) {
        if (localUser.r_id) {
          effectiveRole = { id: localUser.r_id, key: localUser.r_key, label: localUser.r_label, permissions: localUser.r_permissions }
        } else if (localUser.rb_id) {
          effectiveRole = { id: localUser.rb_id, key: localUser.rb_key, label: localUser.rb_label, permissions: localUser.rb_permissions }
        }
      }
    }

    // Tenant module enablement
    let enabledModules = MODULE_KEYS
    if (req.tenantId) {
      const rows = await sql`
        SELECT module_key, is_enabled FROM tenant_modules WHERE tenant_id = ${req.tenantId}
      `
      const map = Object.fromEntries(rows.map(r => [r.module_key, r.is_enabled]))
      enabledModules = MODULE_KEYS.filter(k => map[k] !== false)
    }

    // Effective permissions = role permissions intersected with module enablement.
    // Platform admins get full 'manage' on everything regardless.
    const permissions = {}
    for (const k of MODULE_KEYS) {
      if (isPlatformAdmin) {
        permissions[k] = 'manage'
        continue
      }
      if (!enabledModules.includes(k)) { permissions[k] = 'none'; continue }
      permissions[k] = effectiveRole?.permissions?.[k] ?? 'none'
    }

    // Available tenants — for platform admins, all active tenants.
    // For normal users, only tenants they're members of (via users table).
    let availableTenants
    if (isPlatformAdmin) {
      availableTenants = await sql`
        SELECT id, name, slug, plan, auth0_org_id, is_active FROM tenants
         WHERE is_active = true
         ORDER BY name
      `
    } else {
      availableTenants = await sql`
        SELECT t.id, t.name, t.slug, t.plan, t.auth0_org_id, t.is_active, u.role
          FROM users u
          JOIN tenants t ON t.id = u.tenant_id AND t.is_active = true
         WHERE u.auth0_user_id = ${sub}
           AND u.is_active = true
         ORDER BY t.name
      `
    }

    return {
      auth0_sub:        sub,
      email,
      role,
      is_platform_admin: isPlatformAdmin,
      full_name:         localUser?.full_name || null,
      current_tenant:    currentTenant,
      available_tenants: availableTenants,
      effective_role:    effectiveRole,
      enabled_modules:   enabledModules,
      permissions,
    }
  })

  // ── Platform admin routes ───────────────────────────────

  // GET /api/platform/tenants
  app.get('/platform/tenants', {
    preHandler: [requireAuth, requirePlatformAdmin],
  }, async (req, reply) => {
    const t0 = Date.now()

    // Hard 8s timeout on the whole route — return [] rather than hang.
    const timeoutPromise = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('listTenants total timeout')), 8000)
    )

    const queryPromise = (async () => {
      const tenants = await sql`
        SELECT id, name, slug, plan, auth0_org_id, stripe_account_id,
               is_active, created_at, updated_at
          FROM tenants
         ORDER BY name
      `

      // Now enrich with counts in parallel — each as its own short-timeout
      // call so a slow one can't take down the whole response.
      const enriched = await Promise.all(tenants.map(async (t) => {
        const safeCount = async (q) => {
          try {
            const [{ c }] = await Promise.race([
              q,
              new Promise((_, r) => setTimeout(() => r(new Error('count timeout')), 1500)),
            ])
            return Number(c) || 0
          } catch {
            return 0
          }
        }
        const [venue_count, user_count] = await Promise.all([
          safeCount(sql`SELECT COUNT(*)::int AS c FROM venues WHERE tenant_id = ${t.id} AND is_active = true`),
          safeCount(sql`SELECT COUNT(*)::int AS c FROM users  WHERE tenant_id = ${t.id} AND is_active = true`),
        ])
        return { ...t, venue_count, user_count }
      }))
      return enriched
    })()

    try {
      return await Promise.race([queryPromise, timeoutPromise])
    } catch (err) {
      req.log.error({ err: err.message, ms: Date.now() - t0 }, 'listTenants: failed')
      // Final fallback — always respond with valid JSON, never hang.
      return reply.code(200).send([])
    }
  })

  // POST /api/platform/tenants
  // When `auto_provision` is true (default) AND Auth0 mgmt is configured AND
  // no auth0_org_id was supplied, this also:
  //   1. Creates an Auth0 organization (display_name = name, name = slug)
  //   2. Enables Username-Password + Google connections with auto-membership
  //   3. Stores the resulting org_... id on the tenant row
  //
  // The tenant is created in the DB FIRST so a partial Auth0 failure leaves
  // the platform admin a clear path forward (edit the tenant, paste an existing
  // org id, or click "Retry provision"). The Auth0 work is best-effort but
  // failures are surfaced in the response under `auth0_provisioning_error`.
  app.post('/platform/tenants', {
    preHandler: [requireAuth, requirePlatformAdmin],
  }, async (req, reply) => {
    const body = TenantBody.parse(req.body)

    let auth0OrgId = body.auth0_org_id ?? null
    let auth0ProvisioningError = null
    let enabledConnections = []

    if (body.auto_provision && !auth0OrgId && auth0IsConfigured()) {
      try {
        const result = await provisionTenantOrg({
          name:        body.slug,        // Auth0 org "name" must be slug-shaped
          displayName: body.name,
          log:         req.log,
        })
        auth0OrgId         = result.org.id
        enabledConnections = result.enabled
      } catch (err) {
        req.log.warn({ err: err.message }, 'Auto-provision Auth0 org failed')
        auth0ProvisioningError = err.message
      }
    }

    const [tenant] = await sql`
      INSERT INTO tenants (name, slug, plan, auth0_org_id, stripe_account_id, is_active)
      VALUES (${body.name}, ${body.slug}, ${body.plan},
              ${auth0OrgId},
              ${body.stripe_account_id ?? null},
              ${body.is_active})
      RETURNING *
    `

    return reply.code(201).send({
      ...tenant,
      auth0_provisioning: {
        attempted: body.auto_provision && auth0IsConfigured(),
        org_created: !!(body.auto_provision && auth0OrgId && !body.auth0_org_id),
        enabled_connections: enabledConnections,
        error: auth0ProvisioningError,
      },
    })
  })

  // PATCH /api/platform/tenants/:id
  app.patch('/platform/tenants/:id', {
    preHandler: [requireAuth, requirePlatformAdmin],
  }, async (req) => {
    const body   = TenantPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [tenant] = await sql`
      UPDATE tenants
         SET ${sql(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id}
      RETURNING *
    `
    if (!tenant) throw httpError(404, 'Tenant not found')
    return tenant
  })

  // GET /api/platform/tenants/:id/stats
  app.get('/platform/tenants/:id/stats', {
    preHandler: [requireAuth, requirePlatformAdmin],
  }, async (req) => {
    const tid = req.params.id
    const [tenant] = await sql`SELECT * FROM tenants WHERE id = ${tid}`
    if (!tenant) throw httpError(404, 'Tenant not found')

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*) FROM venues    WHERE tenant_id = ${tid} AND is_active = true)::int AS venues,
        (SELECT COUNT(*) FROM users     WHERE tenant_id = ${tid} AND is_active = true)::int AS users,
        (SELECT COUNT(*) FROM bookings  WHERE tenant_id = ${tid})::int AS bookings,
        (SELECT COUNT(*) FROM customers WHERE tenant_id = ${tid})::int AS customers,
        (SELECT COUNT(*) FROM website_config WHERE tenant_id = ${tid})::int AS websites
    `

    return { tenant, stats: counts }
  })
}
