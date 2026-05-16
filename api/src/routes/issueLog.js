// src/routes/issueLog.js
//
// ITIL-style incident and problem tracking.
// Mounted at /api/issues in app.js.

import { z }          from 'zod'
import { sql, withTenant } from '../config/db.js'
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

// ── ITIL priority matrix ──────────────────────────────────────
//
//  impact \ urgency  critical  high   medium  low
//  critical          p1        p1     p2      p2
//  high              p1        p2     p2      p3
//  medium            p2        p2     p3      p3
//  low               p3        p3     p4      p4

const PRIORITY_MATRIX = {
  critical: { critical: 'p1', high: 'p1', medium: 'p2', low: 'p2' },
  high:     { critical: 'p1', high: 'p2', medium: 'p2', low: 'p3' },
  medium:   { critical: 'p2', high: 'p2', medium: 'p3', low: 'p3' },
  low:      { critical: 'p3', high: 'p3', medium: 'p4', low: 'p4' },
}

function calcPriority(impact, urgency) {
  return PRIORITY_MATRIX[impact]?.[urgency] ?? 'p4'
}

/* map p1-p4 → backlog priority levels */
function itilToBacklogPriority(p) {
  return { p1: 'critical', p2: 'high', p3: 'medium', p4: 'low' }[p] ?? 'medium'
}

// ── Schemas ───────────────────────────────────────────────────

const IssueBody = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().nullable().optional(),
  category:    z.enum(['incident','problem','change_request','service_request']).default('incident'),
  impact:      z.enum(['critical','high','medium','low']).default('low'),
  urgency:     z.enum(['critical','high','medium','low']).default('low'),
})

const IssuePatch = z.object({
  title:            z.string().min(1).max(300).optional(),
  description:      z.string().nullable().optional(),
  /* platform admin only */
  status:           z.enum(['new','acknowledged','in_progress','resolved','closed']).optional(),
  resolution_notes: z.string().nullable().optional(),
})

function parseIntParam(v, def) {
  const n = parseInt(v, 10)
  return isNaN(n) ? def : n
}

// ── Plugin ────────────────────────────────────────────────────

export default async function issueLogRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── GET /issues ───────────────────────────────────────────
  app.get('/', async (req) => {
    const { status, category, priority, limit = '50', offset = '0' } = req.query
    const lim = parseIntParam(limit, 50)
    const off = parseIntParam(offset, 0)

    const sFilter = status   ? sql`AND i.status   = ${status}`   : sql``
    const cFilter = category ? sql`AND i.category = ${category}` : sql``
    const pFilter = priority ? sql`AND i.priority = ${priority}` : sql``

    if (req.isPlatformAdmin) {
      /* platform admin: see all issues across tenants */
      return sql`
        SELECT i.*, t.name AS tenant_name
          FROM issue_log i
          LEFT JOIN tenants t ON t.id = i.tenant_id
         WHERE true ${sFilter} ${cFilter} ${pFilter}
         ORDER BY i.created_at DESC
         LIMIT  ${lim}
         OFFSET ${off}
      `
    }

    return withTenant(req.tenantId, tx => tx`
      SELECT i.*
        FROM issue_log i
       WHERE i.tenant_id = ${req.tenantId}
         ${sFilter} ${cFilter} ${pFilter}
       ORDER BY i.created_at DESC
       LIMIT  ${lim}
       OFFSET ${off}
    `)
  })

  // ── POST /issues ──────────────────────────────────────────
  app.post('/', async (req) => {
    const body     = IssueBody.parse(req.body)
    const priority = calcPriority(body.impact, body.urgency)

    const [issue] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO issue_log
        (tenant_id, title, description, category, impact, urgency, priority)
      VALUES
        (${req.tenantId}, ${body.title}, ${body.description ?? null},
         ${body.category}, ${body.impact}, ${body.urgency}, ${priority})
      RETURNING *
    `)
    return issue
  })

  // ── PATCH /issues/:id ─────────────────────────────────────
  app.patch('/:id', async (req) => {
    const body = IssuePatch.parse(req.body)

    /* tenants can only update title / description */
    if (!req.isPlatformAdmin) {
      delete body.status
      delete body.resolution_notes
    }

    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const setResolved = body.status === 'resolved' || body.status === 'closed'

    if (req.isPlatformAdmin) {
      const [issue] = await sql`
        UPDATE issue_log
           SET ${sql(
             Object.fromEntries(fields.map(k => [k, body[k]])),
             ...fields
           )},
               updated_at  = now()
               ${setResolved ? sql`, resolved_at = COALESCE(resolved_at, now())` : sql``}
         WHERE id = ${req.params.id}
         RETURNING *
      `
      if (!issue) throw httpError(404, 'Issue not found')
      return issue
    }

    const [issue] = await withTenant(req.tenantId, tx => tx`
      UPDATE issue_log
         SET ${tx(
           Object.fromEntries(fields.map(k => [k, body[k]])),
           ...fields
         )},
             updated_at = now()
       WHERE id      = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!issue) throw httpError(404, 'Issue not found')
    return issue
  })

  // ── POST /issues/:id/promote ──────────────────────────────
  // Platform admin only. Creates a backlog_items row from the issue.
  app.post('/:id/promote', { preHandler: requirePlatformAdmin }, async (req) => {
    const [existing] = await sql`
      SELECT * FROM issue_log WHERE id = ${req.params.id}
    `
    if (!existing) throw httpError(404, 'Issue not found')
    if (existing.promoted_to_backlog_id) {
      throw httpError(422, 'Issue is already promoted to the backlog')
    }

    const backlogPriority = itilToBacklogPriority(existing.priority)

    const [backlogItem, issue] = await sql.begin(async tx => {
      const [bi] = await tx`
        INSERT INTO backlog_items
          (title, description, type, priority, promoted_from_issue_id, reporter_tenant_id)
        VALUES
          (${existing.title}, ${existing.description ?? null},
           'bug', ${backlogPriority}, ${existing.id}, ${existing.tenant_id})
        RETURNING *
      `
      const [iss] = await tx`
        UPDATE issue_log
           SET promoted_to_backlog_id = ${bi.id}, updated_at = now()
         WHERE id = ${existing.id}
         RETURNING *
      `
      return [bi, iss]
    })

    return { backlog_item: backlogItem, issue }
  })
}
