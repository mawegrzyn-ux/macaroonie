// src/routes/backlog.js
//
// Global Kanban backlog — platform admin only.
// Mounted at /api/backlog in app.js.

import { z }          from 'zod'
import { sql }        from '../config/db.js'
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js'
import { httpError }  from '../middleware/error.js'

// ── Schemas ───────────────────────────────────────────────────

const BacklogBody = z.object({
  title:        z.string().min(1).max(300),
  description:  z.string().nullable().optional(),
  type:         z.enum(['epic','story','task','bug','spike']).default('task'),
  status:       z.enum(['backlog','todo','in_progress','in_review','done']).default('backlog'),
  priority:     z.enum(['critical','high','medium','low']).default('medium'),
  labels:       z.array(z.string().max(50)).max(10).default([]),
  story_points: z.number().int().min(1).max(100).nullable().optional(),
  sort_order:   z.number().int().default(0),
})

const BacklogPatch = z.object({
  title:        z.string().min(1).max(300).optional(),
  description:  z.string().nullable().optional(),
  type:         z.enum(['epic','story','task','bug','spike']).optional(),
  status:       z.enum(['backlog','todo','in_progress','in_review','done']).optional(),
  priority:     z.enum(['critical','high','medium','low']).optional(),
  labels:       z.array(z.string().max(50)).max(10).optional(),
  story_points: z.number().int().min(1).max(100).nullable().optional(),
  sort_order:   z.number().int().optional(),
})

const MoveBody = z.object({
  status:     z.enum(['backlog','todo','in_progress','in_review','done']),
  sort_order: z.number().int().min(0),
})

// ── Plugin ────────────────────────────────────────────────────

export default async function backlogRoutes(app) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requirePlatformAdmin)

  // ── GET /backlog ──────────────────────────────────────────
  // Returns items grouped by status, ordered by sort_order ASC.
  app.get('/', async () => {
    const rows = await sql`
      SELECT * FROM backlog_items
      ORDER BY sort_order ASC, created_at ASC
    `
    const grouped = {
      backlog:     [],
      todo:        [],
      in_progress: [],
      in_review:   [],
      done:        [],
    }
    for (const row of rows) {
      if (grouped[row.status]) grouped[row.status].push(row)
    }
    return grouped
  })

  // ── POST /backlog ─────────────────────────────────────────
  app.post('/', async (req) => {
    const body = BacklogBody.parse(req.body)
    const [item] = await sql`
      INSERT INTO backlog_items
        (title, description, type, status, priority, labels, story_points, sort_order)
      VALUES
        (${body.title}, ${body.description ?? null}, ${body.type}, ${body.status},
         ${body.priority}, ${body.labels}, ${body.story_points ?? null}, ${body.sort_order})
      RETURNING *
    `
    return item
  })

  // ── PATCH /backlog/:id ────────────────────────────────────
  app.patch('/:id', async (req) => {
    const body   = BacklogPatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [item] = await sql`
      UPDATE backlog_items
         SET ${sql(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id}
       RETURNING *
    `
    if (!item) throw httpError(404, 'Backlog item not found')
    return item
  })

  // ── DELETE /backlog/:id ───────────────────────────────────
  app.delete('/:id', async (req) => {
    const [row] = await sql`
      DELETE FROM backlog_items WHERE id = ${req.params.id} RETURNING id
    `
    if (!row) throw httpError(404, 'Backlog item not found')
    return { deleted: true }
  })

  // ── PATCH /backlog/:id/move ───────────────────────────────
  // Change status column + sort_order.
  // Shifts existing items in target column to make room.
  app.patch('/:id/move', async (req) => {
    const { status, sort_order } = MoveBody.parse(req.body)

    const [item] = await sql.begin(async tx => {
      /* shift items in the target column at or after the insertion point */
      await tx`
        UPDATE backlog_items
           SET sort_order = sort_order + 1, updated_at = now()
         WHERE status = ${status}
           AND sort_order >= ${sort_order}
           AND id <> ${req.params.id}
      `
      return tx`
        UPDATE backlog_items
           SET status = ${status}, sort_order = ${sort_order}, updated_at = now()
         WHERE id = ${req.params.id}
         RETURNING *
      `
    })
    if (!item) throw httpError(404, 'Backlog item not found')
    return item
  })
}
