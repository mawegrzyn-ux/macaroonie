// src/routes/hsActionLog.js
//
// H&S Action Log — a general facilities/compliance to-do list per venue
// (migrated from the legacy "ActionLog" spreadsheet tab). Categories are a
// small tenant-managed reorderable list (same pattern as fs_hold_stations),
// not a fixed enum. Mounted at /api/hs-action-log in app.js.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const PRIORITIES = ['low', 'medium', 'high', 'critical']

const CategoryBody = z.object({
  name:       z.string().min(1).max(100),
  sort_order: z.number().int().optional(),
})
const CategoryPatch = z.object({
  name:       z.string().min(1).max(100).optional(),
  sort_order: z.number().int().optional(),
  is_active:  z.boolean().optional(),
})

const EntryBody = z.object({
  venue_id:            z.string().uuid(),
  category_id:         z.string().uuid().nullable().optional(),
  logged_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  task:                z.string().min(1).max(300),
  details:             z.string().max(4000).nullable().optional(),
  assigned_to:         z.string().max(200).nullable().optional(),
  due_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority:            z.enum(PRIORITIES).optional(),
  notes:               z.string().max(4000).nullable().optional(),
  attachment_media_id: z.string().uuid().nullable().optional(),
})

const EntryPatch = z.object({
  category_id:         z.string().uuid().nullable().optional(),
  logged_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  task:                z.string().min(1).max(300).optional(),
  details:             z.string().max(4000).nullable().optional(),
  assigned_to:         z.string().max(200).nullable().optional(),
  due_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority:            z.enum(PRIORITIES).optional(),
  notes:               z.string().max(4000).nullable().optional(),
  attachment_media_id: z.string().uuid().nullable().optional(),
})

export default async function hsActionLogRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Categories ────────────────────────────────────────────

  app.get('/categories', {
    preHandler: requirePermission('hs_action_log', 'view'),
  }, async (req) => {
    const { active } = req.query
    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND is_active = true`
      return tx`
        SELECT * FROM hs_action_categories
         WHERE tenant_id = ${req.tenantId}
           ${activeFilter}
         ORDER BY sort_order, name
      `
    })
  })

  app.post('/categories', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const body = CategoryBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      const [{ max_sort }] = await tx`
        SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM hs_action_categories WHERE tenant_id = ${req.tenantId}
      `
      const [row] = await tx`
        INSERT INTO hs_action_categories (tenant_id, name, sort_order)
        VALUES (${req.tenantId}, ${body.name}, ${body.sort_order ?? max_sort + 1})
        RETURNING *
      `
      return row
    })
  })

  // Must be registered before /categories/:id.
  app.patch('/categories/reorder', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body)
    await withTenant(req.tenantId, async tx => {
      const owned = await tx`SELECT id FROM hs_action_categories WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${req.tenantId}`
      if (owned.length !== ids.length) throw httpError(404, 'One or more categories not found')
      for (let i = 0; i < ids.length; i++) {
        await tx`UPDATE hs_action_categories SET sort_order = ${i}, updated_at = now() WHERE id = ${ids[i]} AND tenant_id = ${req.tenantId}`
      }
    })
    return { ok: true }
  })

  app.patch('/categories/:id', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const body = CategoryPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_action_categories
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Category not found')
    return row
  })

  app.delete('/categories/:id', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_action_categories
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Category not found')
    return row
  })

  // ── Entries ───────────────────────────────────────────────

  app.get('/entries', {
    preHandler: requirePermission('hs_action_log', 'view'),
  }, async (req) => {
    const { venue_id, status, category_id } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const statusFilter = status === 'completed'
        ? tx`AND l.is_completed = true`
        : status === 'all'
          ? tx``
          : tx`AND l.is_completed = false`
      const categoryFilter = category_id ? tx`AND l.category_id = ${category_id}` : tx``
      return tx`
        SELECT l.*, c.name AS category_name, m.url AS attachment_url
          FROM hs_action_log l
          LEFT JOIN hs_action_categories c ON c.id = l.category_id
          LEFT JOIN media_items m ON m.id = l.attachment_media_id
         WHERE l.tenant_id = ${req.tenantId}
           AND l.venue_id  = ${venue_id}
           ${statusFilter}
           ${categoryFilter}
         ORDER BY l.is_completed, l.priority = 'critical' DESC, l.priority = 'high' DESC,
                  l.due_date NULLS LAST, l.logged_date DESC
      `
    })
  })

  app.post('/entries', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const body = EntryBody.parse(req.body)

    return withTenant(req.tenantId, async tx => {
      if (body.category_id) {
        const [cat] = await tx`SELECT id FROM hs_action_categories WHERE id = ${body.category_id} AND tenant_id = ${req.tenantId}`
        if (!cat) throw httpError(422, 'Invalid category_id')
      }
      const [row] = await tx`
        INSERT INTO hs_action_log
          (tenant_id, venue_id, category_id, logged_date, task, details, assigned_to,
           due_date, priority, notes, attachment_media_id, created_by)
        VALUES
          (${req.tenantId}, ${body.venue_id}, ${body.category_id ?? null},
           ${body.logged_date ?? new Date().toISOString().slice(0, 10)}, ${body.task},
           ${body.details ?? null}, ${body.assigned_to ?? null}, ${body.due_date ?? null},
           ${body.priority ?? 'medium'}, ${body.notes ?? null}, ${body.attachment_media_id ?? null},
           ${req.user?.email ?? null})
        RETURNING *
      `
      return row
    })
  })

  app.patch('/entries/:id', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const body = EntryPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    return withTenant(req.tenantId, async tx => {
      if (body.category_id) {
        const [cat] = await tx`SELECT id FROM hs_action_categories WHERE id = ${body.category_id} AND tenant_id = ${req.tenantId}`
        if (!cat) throw httpError(422, 'Invalid category_id')
      }
      const [row] = await tx`
        UPDATE hs_action_log
           SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
               updated_at = now()
         WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
         RETURNING *
      `
      if (!row) throw httpError(404, 'Action log entry not found')
      return row
    })
  })

  // Dedicated toggle so completed_by/completed_at are always set server-side,
  // never trusted from the client (matches checklist_instances' convention).
  app.patch('/entries/:id/complete', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const { is_completed } = z.object({ is_completed: z.boolean() }).parse(req.body)
    const completedBy = req.user?.email ?? null
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE hs_action_log
         SET is_completed = ${is_completed},
             completed_by = ${is_completed ? completedBy : null},
             completed_at = ${is_completed ? tx`now()` : null},
             updated_at   = now()
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Action log entry not found')
    return row
  })

  app.delete('/entries/:id', {
    preHandler: requirePermission('hs_action_log', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM hs_action_log WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId} RETURNING id
    `)
    if (!row) throw httpError(404, 'Action log entry not found')
    return { ok: true }
  })
}
