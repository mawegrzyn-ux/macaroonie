// src/routes/featureRequests.js
//
// Cross-tenant feature request board with upvoting.
// Mounted at /api/feature-requests in app.js.

import { z }          from 'zod'
import { sql, withTenant, withSystem } from '../config/db.js'
import { requireAuth, requirePlatformAdmin, requirePermission } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

// Feature requests permission: view reads, manage submits, edits and upvotes
// (platform admins always pass).
const PERM = {
  view:   requirePermission('feature_requests', 'view'),
  manage: requirePermission('feature_requests', 'manage'),
}

// ── Schemas ───────────────────────────────────────────────────

const RequestBody = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().nullable().optional(),
})

const RequestPatch = z.object({
  title:       z.string().min(1).max(300).optional(),
  description: z.string().nullable().optional(),
  /* platform admin only */
  status:      z.enum(['submitted','under_review','planned','in_progress','shipped','declined']).optional(),
  admin_notes: z.string().nullable().optional(),
})

function parseIntParam(v, def) {
  const n = parseInt(v, 10)
  return isNaN(n) ? def : n
}

// ── Plugin ────────────────────────────────────────────────────

export default async function featureRequestsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /feature-requests ─────────────────────────────────
  // All tenants see all requests (cross-tenant feature board).
  // has_upvoted is derived from feature_request_upvotes for req.user.id.
  app.get('/', { preHandler: PERM.view }, async (req) => {
    const { status, sort = 'votes' } = req.query
    const userId = req.user?.id ?? null

    const sFilter = status ? sql`AND fr.status = ${status}` : sql``
    const orderBy = sort === 'newest'
      ? sql`fr.created_at DESC`
      : sql`fr.upvotes DESC, fr.created_at DESC`

    return sql`
      SELECT fr.*,
             t.name AS tenant_name,
             (
               SELECT TRUE FROM feature_request_upvotes u
                WHERE u.request_id = fr.id AND u.user_id = ${req.user.sub}
                LIMIT 1
             ) AS has_upvoted
        FROM feature_requests fr
        LEFT JOIN tenants t ON t.id = fr.tenant_id
       WHERE true ${sFilter}
       ORDER BY ${orderBy}
       LIMIT 200
    `
  })

  // ── POST /feature-requests ────────────────────────────────
  app.post('/', { preHandler: PERM.manage }, async (req) => {
    if (!req.tenantId) throw httpError(400, 'No tenant context')
    const body = RequestBody.parse(req.body)

    const [item] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO feature_requests
        (tenant_id, title, description)
      VALUES
        (${req.tenantId}, ${body.title}, ${body.description ?? null})
      RETURNING *
    `)
    return item
  })

  // ── PATCH /feature-requests/:id ───────────────────────────
  app.patch('/:id', { preHandler: PERM.manage }, async (req) => {
    const body = RequestPatch.parse(req.body)

    if (!req.isPlatformAdmin) {
      /* tenants can only edit title/description of their own submitted requests */
      const [existing] = await sql`
        SELECT tenant_id, status FROM feature_requests WHERE id = ${req.params.id}
      `
      if (!existing) throw httpError(404, 'Feature request not found')
      if (String(existing.tenant_id) !== String(req.tenantId)) {
        throw httpError(403, 'You can only edit your own feature requests')
      }
      if (existing.status !== 'submitted') {
        throw httpError(422, 'You can only edit requests that are still in submitted status')
      }
      delete body.status
      delete body.admin_notes
    }

    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    // A platform admin changes any tenant's request (system mode); a tenant
    // only its own (the board is read by everyone, written by its owner).
    const values = Object.fromEntries(fields.map(k => [k, body[k]]))
    const [item] = req.isPlatformAdmin
      ? await withSystem(tx => tx`
          UPDATE feature_requests SET ${tx(values, ...fields)}, updated_at = now()
           WHERE id = ${req.params.id}
           RETURNING *`)
      : await withTenant(req.tenantId, tx => tx`
          UPDATE feature_requests SET ${tx(values, ...fields)}, updated_at = now()
           WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
           RETURNING *`)
    if (!item) throw httpError(404, 'Feature request not found')
    return item
  })

  // ── POST /feature-requests/:id/upvote ─────────────────────
  // Toggle upvote for the current user. Returns { upvoted, upvotes }.
  app.post('/:id/upvote', { preHandler: PERM.manage }, async (req) => {
    const requestId = req.params.id
    const userId    = req.user.sub
    const tenantId  = req.tenantId

    // One board for every tenant: the vote row is the voter's tenant's, the
    // count is on the request's (any tenant's), so system mode.
    const { upvoted, upvotes } = await withSystem(async tx => {
      const [existing] = await tx`
        SELECT 1 FROM feature_request_upvotes
         WHERE request_id = ${requestId} AND user_id = ${userId}
         LIMIT 1
      `
      if (existing) {
        await tx`
          DELETE FROM feature_request_upvotes
           WHERE request_id = ${requestId} AND user_id = ${userId}
        `
        const [row] = await tx`
          UPDATE feature_requests
             SET upvotes = GREATEST(0, upvotes - 1), updated_at = now()
           WHERE id = ${requestId}
           RETURNING upvotes
        `
        return { upvoted: false, upvotes: row?.upvotes ?? 0 }
      }
      await tx`
        INSERT INTO feature_request_upvotes (request_id, user_id, tenant_id)
        VALUES (${requestId}, ${userId}, ${tenantId ?? tx`(SELECT tenant_id FROM feature_requests WHERE id = ${requestId})`})
        ON CONFLICT DO NOTHING
      `
      const [row] = await tx`
        UPDATE feature_requests
           SET upvotes = upvotes + 1, updated_at = now()
         WHERE id = ${requestId}
         RETURNING upvotes
      `
      return { upvoted: true, upvotes: row?.upvotes ?? 0 }
    })

    return { upvoted, upvotes }
  })

  // ── POST /feature-requests/:id/promote ───────────────────
  // Platform admin only. Creates a backlog_items row from the request.
  app.post('/:id/promote', { preHandler: requirePlatformAdmin }, async (req) => {
    const [existing] = await sql`
      SELECT * FROM feature_requests WHERE id = ${req.params.id}
    `
    if (!existing) throw httpError(404, 'Feature request not found')
    if (existing.promoted_to_backlog_id) {
      throw httpError(422, 'Feature request is already promoted to the backlog')
    }

    const [backlogItem, request] = await withSystem(async tx => {
      const [bi] = await tx`
        INSERT INTO backlog_items
          (title, description, type, priority, promoted_from_request_id, reporter_tenant_id)
        VALUES
          (${existing.title}, ${existing.description ?? null},
           'story', 'medium', ${existing.id}, ${existing.tenant_id})
        RETURNING *
      `
      const [req_] = await tx`
        UPDATE feature_requests
           SET promoted_to_backlog_id = ${bi.id}, updated_at = now()
         WHERE id = ${existing.id}
         RETURNING *
      `
      return [bi, req_]
    })

    return { backlog_item: backlogItem, request }
  })
}
