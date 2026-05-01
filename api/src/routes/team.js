// src/routes/team.js
//
// In-app user/team management within a tenant.
// Mounted at /api/team in app.js.
//
// RBAC: only owner + platform_admin can invite, change roles, remove.
// Admin can view the team list.
//
//   GET    /api/team                — list team members
//   POST   /api/team/invite         — invite a new user
//   PATCH  /api/team/:userId        — update role / active status
//   DELETE /api/team/:userId        — remove from tenant
//   GET    /api/team/roles          — list available roles

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const ROLES = ['viewer', 'operator', 'admin', 'owner']

const InviteBody = z.object({
  email:     z.string().email(),
  full_name: z.string().min(1).max(200).optional(),
  role:      z.enum(['viewer', 'operator', 'admin', 'owner']).default('operator'),
})

const UpdateBody = z.object({
  role:      z.enum(['viewer', 'operator', 'admin', 'owner']).optional(),
  full_name: z.string().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
})

export default async function teamRoutes(app) {

  app.addHook('preHandler', requireAuth)

  // ── GET /team/roles ─────────────────────────────────────
  app.get('/roles', async () => ROLES.map(r => ({
    value: r,
    label: r.charAt(0).toUpperCase() + r.slice(1),
    description: {
      owner:    'Full access. Can manage team, billing, and all settings.',
      admin:    'Can manage venues, rules, website, emails. Cannot manage team.',
      operator: 'Front-of-house. Can manage bookings and view the timeline.',
      viewer:   'Read-only access to bookings and timeline.',
    }[r],
  })))

  // ── GET /team ───────────────────────────────────────────
  // List all team members for the current tenant.
  // Accessible by admin, owner (and platform admin via requireRole bypass).
  app.get('/', {
    preHandler: requireRole('admin', 'owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context — select a tenant first')
    return withTenant(req.tenantId, tx => tx`
      SELECT id, email, full_name, role, is_active,
             auth0_user_id, last_login_at, invited_at, invited_by,
             created_at
        FROM users
       WHERE tenant_id = ${req.tenantId}
       ORDER BY
         CASE role
           WHEN 'owner'    THEN 1
           WHEN 'admin'    THEN 2
           WHEN 'operator' THEN 3
           WHEN 'viewer'   THEN 4
         END,
         full_name, email
    `)
  })

  // ── POST /team/invite ───────────────────────────────────
  // Creates a local user record. In a full setup this would also
  // call the Auth0 Management API to create/invite the user and
  // add them to the Auth0 organization. For now we create the
  // local record and the Auth0 invitation is handled separately
  // (or via the Auth0 dashboard).
  app.post('/invite', {
    preHandler: requireRole('owner'),
  }, async (req, reply) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = InviteBody.parse(req.body)

    // Prevent inviting someone who's already a member
    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM users
       WHERE tenant_id = ${req.tenantId} AND email = ${body.email}
    `)
    if (existing) throw httpError(409, 'User already exists in this tenant')

    // Only owners can invite other owners
    if (body.role === 'owner' && req.user.role !== 'owner' && !req.isPlatformAdmin) {
      throw httpError(403, 'Only owners can invite other owners')
    }

    // Find the inviting user's local ID
    let invitedBy = null
    if (req.user.sub) {
      const [me] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM users WHERE auth0_user_id = ${req.user.sub}
      `)
      invitedBy = me?.id ?? null
    }

    const [user] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO users (tenant_id, email, full_name, role, invited_at, invited_by)
      VALUES (${req.tenantId}, ${body.email}, ${body.full_name ?? null},
              ${body.role}::user_role, now(), ${invitedBy})
      RETURNING *
    `)

    return reply.code(201).send(user)
  })

  // ── PATCH /team/:userId ─────────────────────────────────
  app.patch('/:userId', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body   = UpdateBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    // Cannot demote yourself
    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM users WHERE id = ${req.params.userId}
    `)
    if (!target) throw httpError(404, 'User not found')

    if (target.auth0_user_id === req.user.sub && body.role && body.role !== target.role) {
      throw httpError(422, 'Cannot change your own role')
    }
    if (target.auth0_user_id === req.user.sub && body.is_active === false) {
      throw httpError(422, 'Cannot deactivate yourself')
    }

    // Only owners can promote to owner
    if (body.role === 'owner' && req.user.role !== 'owner' && !req.isPlatformAdmin) {
      throw httpError(403, 'Only owners can promote to owner')
    }

    const [updated] = await withTenant(req.tenantId, tx => tx`
      UPDATE users
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.userId}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!updated) throw httpError(404, 'User not found')
    return updated
  })

  // ── DELETE /team/:userId ────────────────────────────────
  // Soft-delete (deactivate). Hard delete would require cleaning
  // up Auth0 org membership too.
  app.delete('/:userId', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT auth0_user_id FROM users WHERE id = ${req.params.userId}
    `)
    if (!target) throw httpError(404, 'User not found')
    if (target.auth0_user_id === req.user.sub) {
      throw httpError(422, 'Cannot remove yourself')
    }

    await withTenant(req.tenantId, tx => tx`
      UPDATE users SET is_active = false, updated_at = now()
       WHERE id = ${req.params.userId} AND tenant_id = ${req.tenantId}
    `)
    return { ok: true }
  })
}
