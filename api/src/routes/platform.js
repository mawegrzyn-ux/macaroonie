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

const TenantBody = z.object({
  name:              z.string().min(1).max(200),
  slug:              z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  plan:              z.enum(['starter', 'pro', 'enterprise']).default('starter'),
  auth0_org_id:      z.string().optional(),
  stripe_account_id: z.string().nullable().optional(),
  is_active:         z.boolean().default(true),
})

const TenantPatch = z.object({
  name:              z.string().min(1).max(200).optional(),
  slug:              z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  plan:              z.enum(['starter', 'pro', 'enterprise']).optional(),
  auth0_org_id:      z.string().optional(),
  stripe_account_id: z.string().nullable().optional(),
  is_active:         z.boolean().optional(),
})

export default async function platformRoutes(app) {

  // ── GET /api/me ─────────────────────────────────────────
  // Returns the current user's profile + available tenants.
  // Used by the frontend org-switcher to know which tenants
  // the user can access.
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const { sub, email, role, isPlatformAdmin } = req.user

    // Current tenant info (if in a tenant context)
    let currentTenant = null
    if (req.tenantId) {
      [currentTenant] = await sql`
        SELECT id, name, slug, plan, is_active FROM tenants WHERE id = ${req.tenantId}
      `
    }

    // Local user record (if exists)
    let localUser = null
    if (req.tenantId) {
      [localUser] = await sql`
        SELECT id, full_name, role, is_active FROM users
         WHERE auth0_user_id = ${sub} AND tenant_id = ${req.tenantId}
      `
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
    }
  })

  // ── Platform admin routes ───────────────────────────────

  // GET /api/platform/tenants
  app.get('/platform/tenants', {
    preHandler: [requireAuth, requirePlatformAdmin],
  }, async () => {
    const tenants = await sql`
      SELECT t.*,
             COUNT(DISTINCT v.id) AS venue_count,
             COUNT(DISTINCT u.id) AS user_count
        FROM tenants t
        LEFT JOIN venues v ON v.tenant_id = t.id AND v.is_active = true
        LEFT JOIN users  u ON u.tenant_id = t.id AND u.is_active = true
       GROUP BY t.id
       ORDER BY t.name
    `
    return tenants
  })

  // POST /api/platform/tenants
  app.post('/platform/tenants', {
    preHandler: [requireAuth, requirePlatformAdmin],
  }, async (req, reply) => {
    const body = TenantBody.parse(req.body)
    const [tenant] = await sql`
      INSERT INTO tenants (name, slug, plan, auth0_org_id, stripe_account_id, is_active)
      VALUES (${body.name}, ${body.slug}, ${body.plan},
              ${body.auth0_org_id ?? null},
              ${body.stripe_account_id ?? null},
              ${body.is_active})
      RETURNING *
    `
    return reply.code(201).send(tenant)
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
