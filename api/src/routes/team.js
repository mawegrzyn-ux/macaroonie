// src/routes/team.js
//
// In-app user/team management within a tenant.
// Mounted at /api/team in app.js.
//
// RBAC: only owner + platform_admin can invite, change roles, remove.
// Admin can view the team list.
//
// Full lifecycle is driven from this UI — operators never need the
// Auth0 dashboard. Auth0 Management API integration handles:
//   - Invitation emails (POST /invite)
//   - Role sync to Auth0 app_metadata (PATCH role)
//   - Org membership removal on deactivate (DELETE)
//   - Password reset emails (POST /:userId/reset-password)
//
// If AUTH0_MGMT_CLIENT_ID/SECRET are unset, every Auth0 step degrades
// gracefully (logged warning, local op still runs) — useful for local
// dev. In production these env vars MUST be set.
//
//   GET    /api/team                          — list members
//   POST   /api/team/invite                   — invite a new user
//   PATCH  /api/team/:userId                  — update role / active status
//   DELETE /api/team/:userId                  — deactivate + remove from Auth0 org
//   POST   /api/team/:userId/reset-password   — send password reset email
//   GET    /api/team/roles                    — list available roles
//   GET    /api/team/auth0-status             — feature flags for the UI

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import {
  isConfigured     as auth0IsConfigured,
  canInvite        as auth0CanInvite,
  inviteUserToOrg,
  removeUserFromOrg,
  updateUserAppMetadata,
  sendPasswordResetEmail,
} from '../services/auth0MgmtSvc.js'

const ROLES = ['viewer', 'operator', 'admin', 'owner']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const InviteBody = z.object({
  email:     z.string().email(),
  full_name: z.string().min(1).max(200).optional(),
  role:      z.string().default('operator'), // built-in enum value OR custom role UUID
})

const UpdateBody = z.object({
  role:      z.string().optional(), // built-in enum value OR custom role UUID
  full_name: z.string().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
})

export default async function teamRoutes(app) {

  app.addHook('preHandler', requireAuth)

  // ── GET /team/roles ─────────────────────────────────────
  app.get('/roles', async (req) => {
    const builtins = ROLES.map(r => ({
      value: r,
      label: r.charAt(0).toUpperCase() + r.slice(1),
      is_builtin: true,
      description: {
        owner:    'Full access. Can manage team, billing, and all settings.',
        admin:    'Can manage venues, rules, website, emails. Cannot manage team.',
        operator: 'Front-of-house. Can manage bookings and view the timeline.',
        viewer:   'Read-only access to bookings and timeline.',
      }[r],
    }))
    if (!req.tenantId) return builtins
    const customs = await withTenant(req.tenantId, tx => tx`
      SELECT id, label FROM tenant_roles
       WHERE tenant_id = ${req.tenantId} AND NOT is_builtin
       ORDER BY label
    `)
    return [
      ...builtins,
      ...customs.map(r => ({ value: r.id, label: r.label, is_builtin: false, description: null })),
    ]
  })

  // ── GET /team/auth0-status ──────────────────────────────
  // Lets the UI decide whether to show "send invite via email" vs
  // "create local row, invite manually in Auth0".
  app.get('/auth0-status', async () => ({
    mgmt_configured:   auth0IsConfigured(),
    invitations_ready: auth0CanInvite(),
  }))

  // ── GET /team ───────────────────────────────────────────
  app.get('/', {
    preHandler: requireRole('admin', 'owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context — select a tenant first')
    return withTenant(req.tenantId, tx => tx`
      SELECT u.id, u.email, u.full_name, u.role,
             CASE WHEN tr.is_builtin = false THEN u.custom_role_id ELSE NULL END AS custom_role_id,
             CASE WHEN tr.is_builtin = false THEN tr.label        ELSE NULL END AS custom_role_name,
             u.is_active, u.auth0_user_id, u.last_login_at,
             u.invited_at, u.invited_by, u.created_at
        FROM users u
   LEFT JOIN tenant_roles tr ON tr.id = u.custom_role_id
       WHERE u.tenant_id = ${req.tenantId}
       ORDER BY
         CASE u.role
           WHEN 'owner'    THEN 1
           WHEN 'admin'    THEN 2
           WHEN 'operator' THEN 3
           WHEN 'viewer'   THEN 4
         END,
         u.full_name, u.email
    `)
  })

  // ── POST /team/invite ───────────────────────────────────
  // Sends an Auth0 organization invitation email AND creates the
  // local users row. If Auth0 fails the local row is rolled back.
  // Falls back to a "local-only" invite if Auth0 mgmt creds are
  // missing (dev convenience).
  app.post('/invite', {
    preHandler: requireRole('owner'),
  }, async (req, reply) => {
    if (!req.tenantId)    throw httpError(400, 'No tenant context')
    if (!req.auth0OrgId)  throw httpError(400, 'Tenant has no Auth0 org configured')
    const body = InviteBody.parse(req.body)
    const email = body.email.trim().toLowerCase()

    // Prevent inviting someone who's already a member
    const [existing] = await withTenant(req.tenantId, tx => tx`
      SELECT id, is_active FROM users
       WHERE tenant_id = ${req.tenantId} AND email = ${email}
    `)
    if (existing) throw httpError(409, 'User already exists in this tenant')

    // Only owners can invite other owners
    if (body.role === 'owner' && req.user.role !== 'owner' && !req.isPlatformAdmin) {
      throw httpError(403, 'Only owners can invite other owners')
    }

    // Find the inviting user's local ID (best effort — used for audit only)
    let invitedBy = null
    let inviterName = null
    if (req.user.sub) {
      const [me] = await withTenant(req.tenantId, tx => tx`
        SELECT id, full_name, email FROM users WHERE auth0_user_id = ${req.user.sub}
      `)
      invitedBy   = me?.id ?? null
      inviterName = me?.full_name || me?.email || null
    }

    // Insert local row first so a unique-conflict surfaces before we
    // hit Auth0. If Auth0 fails we DELETE this row before returning.
    const [user] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO users (tenant_id, email, full_name, role, invited_at, invited_by)
      VALUES (${req.tenantId}, ${email}, ${body.full_name ?? null},
              ${body.role}::user_role, now(), ${invitedBy})
      RETURNING *
    `)

    // Send Auth0 invitation if configured. The Login Action reads
    // app_metadata.role and injects it as a JWT claim, so seeding it
    // at invitation time means the role is correct on first login.
    let invitation = null
    if (auth0CanInvite()) {
      try {
        invitation = await inviteUserToOrg({
          orgId:       req.auth0OrgId,
          email,
          role:        body.role,
          inviterName,
        })
      } catch (err) {
        // Roll back the local insert so the operator can retry cleanly.
        await withTenant(req.tenantId, tx => tx`
          DELETE FROM users WHERE id = ${user.id}
        `).catch(() => {})
        req.log.warn({ err: err.message, auth0Detail: err.auth0Detail }, 'Auth0 invitation failed')
        // err.message already starts with "Auth0 invitation failed:" — pass through verbatim.
        // 422 (not 502) so Nginx doesn't replace our JSON body with its default Bad Gateway page.
        throw httpError(422, err.message)
      }
    } else {
      req.log.warn({ email }, 'Auth0 mgmt API not configured — local row created, no email sent')
    }

    return reply.code(201).send({
      ...user,
      auth0_invitation: invitation
        ? { id: invitation.id, url: invitation.invitation_url, expires_at: invitation.expires_at }
        : null,
      auth0_skipped: !auth0CanInvite(),
    })
  })

  // ── PATCH /team/:userId ─────────────────────────────────
  // Updates role / active / name. If role changes AND the user has
  // an Auth0 account linked, syncs app_metadata.role to Auth0 so the
  // next JWT issued reflects the new role.
  app.patch('/:userId', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body   = UpdateBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM users WHERE id = ${req.params.userId}
    `)
    if (!target) throw httpError(404, 'User not found')

    if (target.auth0_user_id === req.user.sub && body.role !== undefined) {
      throw httpError(422, 'Cannot change your own role')
    }
    if (target.auth0_user_id === req.user.sub && body.is_active === false) {
      throw httpError(422, 'Cannot deactivate yourself')
    }

    const isCustomRole = body.role && UUID_RE.test(body.role)

    if (!isCustomRole && body.role && !ROLES.includes(body.role)) {
      throw httpError(400, 'Invalid role')
    }
    if (!isCustomRole && body.role === 'owner' && req.user.role !== 'owner' && !req.isPlatformAdmin) {
      throw httpError(403, 'Only owners can promote to owner')
    }

    let updated
    if (isCustomRole) {
      const [customRole] = await withTenant(req.tenantId, tx => tx`
        SELECT id FROM tenant_roles WHERE id = ${body.role} AND tenant_id = ${req.tenantId}
      `)
      if (!customRole) throw httpError(404, 'Custom role not found')

      const nonRoleFields = fields.filter(f => f !== 'role')
      ;[updated] = await withTenant(req.tenantId, tx => {
        const extraUpdate = nonRoleFields.length
          ? tx`${tx(Object.fromEntries(nonRoleFields.map(f => [f, body[f]])), ...nonRoleFields)}, `
          : tx``
        return tx`
          UPDATE users
             SET ${extraUpdate} custom_role_id = ${body.role}, updated_at = now()
           WHERE id = ${req.params.userId} AND tenant_id = ${req.tenantId}
          RETURNING *
        `
      })
    } else {
      const dbBody = { ...body }
      if (body.role) dbBody.custom_role_id = null  // clear custom role when reverting to built-in
      const dbFields = Object.keys(dbBody)
      ;[updated] = await withTenant(req.tenantId, tx => tx`
        UPDATE users
           SET ${tx(dbBody, ...dbFields)}, updated_at = now()
         WHERE id = ${req.params.userId} AND tenant_id = ${req.tenantId}
        RETURNING *
      `)
    }
    if (!updated) throw httpError(404, 'User not found')

    // Sync built-in role to Auth0 app_metadata (skip for custom roles —
    // the auth middleware resolves permissions from DB on every request).
    if (!isCustomRole && body.role && body.role !== target.role && updated.auth0_user_id && auth0IsConfigured()) {
      try {
        await updateUserAppMetadata({
          auth0UserId: updated.auth0_user_id,
          appMetadata: { role: body.role },
        })
      } catch (err) {
        req.log.warn({ err: err.message, userId: updated.id }, 'Auth0 role sync failed')
      }
    }

    return updated
  })

  // ── DELETE /team/:userId ────────────────────────────────
  // Soft-deactivate locally + remove from Auth0 org so they can no
  // longer get a JWT for this tenant. The Auth0 user itself is NOT
  // deleted — only their org membership.
  app.delete('/:userId', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT id, auth0_user_id FROM users WHERE id = ${req.params.userId}
    `)
    if (!target) throw httpError(404, 'User not found')
    if (target.auth0_user_id === req.user.sub) {
      throw httpError(422, 'Cannot remove yourself')
    }

    await withTenant(req.tenantId, tx => tx`
      UPDATE users SET is_active = false, updated_at = now()
       WHERE id = ${req.params.userId} AND tenant_id = ${req.tenantId}
    `)

    if (target.auth0_user_id && req.auth0OrgId && auth0IsConfigured()) {
      try {
        await removeUserFromOrg({
          orgId:       req.auth0OrgId,
          auth0UserId: target.auth0_user_id,
        })
      } catch (err) {
        req.log.warn({ err: err.message, userId: target.id }, 'Auth0 org-removal failed')
      }
    }

    return { ok: true }
  })

  // ── DELETE /team/:userId/permanent ──────────────────────
  // Hard-delete: removes the users row entirely + removes from Auth0 org.
  // Use for cleaning up pending invites or test accounts.
  // Cannot delete yourself.
  app.delete('/:userId/permanent', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT id, auth0_user_id FROM users WHERE id = ${req.params.userId}
    `)
    if (!target) throw httpError(404, 'User not found')
    if (target.auth0_user_id === req.user.sub) {
      throw httpError(422, 'Cannot delete yourself')
    }

    await withTenant(req.tenantId, tx => tx`
      DELETE FROM users WHERE id = ${req.params.userId} AND tenant_id = ${req.tenantId}
    `)

    if (target.auth0_user_id && req.auth0OrgId && auth0IsConfigured()) {
      try {
        await removeUserFromOrg({ orgId: req.auth0OrgId, auth0UserId: target.auth0_user_id })
      } catch (err) {
        req.log.warn({ err: err.message, userId: target.id }, 'Auth0 org-removal failed on hard delete')
      }
    }

    return { ok: true }
  })

  // ── POST /team/:userId/resend-invite ────────────────────
  // Creates a fresh Auth0 org invitation for a pending user
  // (auth0_user_id IS NULL). Returns the invitation URL so the
  // admin can copy-paste it if email delivery is unreliable.
  app.post('/:userId/resend-invite', {
    preHandler: requireRole('owner'),
  }, async (req, reply) => {
    if (!req.tenantId)   throw httpError(400, 'No tenant context')
    if (!req.auth0OrgId) throw httpError(400, 'Tenant has no Auth0 org configured')
    if (!auth0CanInvite()) throw httpError(503, 'Auth0 invitations not configured')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT email, full_name, role FROM users
       WHERE id = ${req.params.userId} AND tenant_id = ${req.tenantId}
         AND auth0_user_id IS NULL
    `)
    if (!target) throw httpError(404, 'User not found or already accepted invite')

    let inviterName = null
    if (req.user.sub) {
      const [me] = await withTenant(req.tenantId, tx => tx`
        SELECT full_name, email FROM users WHERE auth0_user_id = ${req.user.sub}
      `)
      inviterName = me?.full_name || me?.email || null
    }

    try {
      const invitation = await inviteUserToOrg({
        orgId:       req.auth0OrgId,
        email:       target.email,
        role:        target.role,
        inviterName,
      })
      return reply.send({
        ok: true,
        invitation: { id: invitation.id, url: invitation.invitation_url, expires_at: invitation.expires_at },
      })
    } catch (err) {
      req.log.warn({ err: err.message }, 'Auth0 resend invitation failed')
      throw httpError(422, err.message)
    }
  })

  // ── POST /team/:userId/reset-password ───────────────────
  // Operator-triggered password reset. Auth0 emails the user a
  // one-time link to set a new password. The user does not need
  // to remember their old one.
  app.post('/:userId/reset-password', {
    preHandler: requireRole('owner'),
  }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')

    const [target] = await withTenant(req.tenantId, tx => tx`
      SELECT email FROM users WHERE id = ${req.params.userId}
       AND tenant_id = ${req.tenantId}
    `)
    if (!target) throw httpError(404, 'User not found')
    if (!auth0IsConfigured() || !auth0CanInvite()) {
      throw httpError(503, 'Auth0 password reset not configured')
    }

    try {
      await sendPasswordResetEmail({ email: target.email })
    } catch (err) {
      req.log.warn({ err: err.message }, 'Auth0 password reset email failed')
      throw httpError(422, `Password reset failed: ${err.message}`)
    }

    return { ok: true, sent_to: target.email }
  })
}
