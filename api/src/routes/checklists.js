// src/routes/checklists.js
//
// Operator-defined recurring checklists (opening/closing/cleaning etc.),
// per venue. Mounted at /api/checklists in app.js.
//
// Templates — the checklist definition (name, department, frequency,
//   advisory due day) — plus their ordered item list:
//   GET    /templates?venue_id=&active=
//   POST   /templates
//   PATCH  /templates/:id
//   DELETE /templates/:id                        (soft — is_active=false)
//   PUT    /templates/reorder                     { venue_id, ids }
//   GET    /templates/:id/items
//   POST   /templates/:id/items
//   PATCH  /templates/:id/items/:itemId
//   DELETE /templates/:id/items/:itemId           (soft — is_active=false)
//   PUT    /templates/:id/items/reorder            { ids }
//
// Occurrences — one instance of a template for a given period:
//   GET    /due?venue_id=&date=                   dashboard: every active
//                                                  template + its instance
//                                                  status for that date
//   GET    /instance?template_id=&date=
//   PUT    /instance                               { template_id, date,
//                                                    items, notes,
//                                                    mark_complete }

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pad(n) { return String(n).padStart(2, '0') }

/** Monday (ISO week start) of the week containing the given YYYY-MM-DD, as a string. */
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** First of the month containing the given YYYY-MM-DD, as a string. */
function monthStartOf(dateStr) {
  return dateStr.slice(0, 7) + '-01'
}

/** The period_start an instance of this frequency is keyed by, for a given date. */
function periodStartFor(frequency, dateStr) {
  if (frequency === 'weekly')  return mondayOf(dateStr)
  if (frequency === 'monthly') return monthStartOf(dateStr)
  return dateStr
}

const TemplateBody = z.object({
  venue_id:         z.string().uuid(),
  name:             z.string().min(1).max(200),
  department:       z.string().max(100).nullable().optional(),
  frequency:        z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  due_day_of_week:  z.number().int().min(0).max(6).nullable().optional(),
  due_day_of_month: z.number().int().min(1).max(28).nullable().optional(),
  sort_order:       z.number().int().optional(),
})

const TemplatePatch = TemplateBody.partial().omit({ venue_id: true }).extend({
  is_active: z.boolean().optional(),
})

const ItemBody = z.object({
  label:       z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  sort_order:  z.number().int().optional(),
})

const ItemPatch = ItemBody.partial().extend({
  is_active: z.boolean().optional(),
})

const InstanceItemInput = z.object({
  template_item_id: z.string().uuid(),
  checked:           z.boolean().default(false),
  notes:             z.string().max(1000).nullable().optional(),
})

const InstancePutBody = z.object({
  template_id:    z.string().uuid(),
  date:           z.string().regex(DATE_RE),
  items:          z.array(InstanceItemInput).default([]),
  notes:          z.string().max(2000).nullable().optional(),
  mark_complete:  z.boolean().optional(),
})

/** Loads a template (must belong to this tenant) or throws 404. */
async function loadTemplate(tx, tenantId, templateId) {
  const [t] = await tx`
    SELECT * FROM checklist_templates
     WHERE id = ${templateId} AND tenant_id = ${tenantId}
  `
  if (!t) throw httpError(404, 'Checklist not found')
  return t
}

export default async function checklistsRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Templates ─────────────────────────────────────────────

  app.get('/templates', {
    preHandler: requirePermission('checklists', 'view'),
  }, async (req) => {
    const { venue_id, active } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')

    return withTenant(req.tenantId, tx => {
      const activeFilter = active === 'all' ? tx`` : tx`AND t.is_active = true`
      return tx`
        SELECT t.*,
               (SELECT count(*)::int FROM checklist_template_items i
                 WHERE i.template_id = t.id AND i.is_active = true) AS item_count
          FROM checklist_templates t
         WHERE t.tenant_id = ${req.tenantId}
           AND t.venue_id  = ${venue_id}
           ${activeFilter}
         ORDER BY t.sort_order, t.name
      `
    })
  })

  app.post('/templates', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const body = TemplateBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO checklist_templates
        (tenant_id, venue_id, name, department, frequency,
         due_day_of_week, due_day_of_month, sort_order)
      VALUES
        (${req.tenantId}, ${body.venue_id}, ${body.name}, ${body.department ?? null}, ${body.frequency},
         ${body.due_day_of_week ?? null}, ${body.due_day_of_month ?? null}, ${body.sort_order ?? 0})
      RETURNING *
    `)
    return row
  })

  app.patch('/templates/:id', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const body = TemplatePatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE checklist_templates
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Checklist not found')
    return row
  })

  app.delete('/templates/:id', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE checklist_templates
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Checklist not found')
    return row
  })

  app.put('/templates/reorder', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const { venue_id, ids } = z.object({
      venue_id: z.string().uuid(),
      ids:      z.array(z.string().uuid()),
    }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE checklist_templates
             SET sort_order = ${i}
           WHERE id = ${ids[i]}
             AND venue_id  = ${venue_id}
             AND tenant_id = ${req.tenantId}
        `
      }
    })
    return { ok: true }
  })

  // ── Template items ────────────────────────────────────────

  app.get('/templates/:id/items', {
    preHandler: requirePermission('checklists', 'view'),
  }, async (req) => {
    const { active } = req.query
    return withTenant(req.tenantId, async tx => {
      await loadTemplate(tx, req.tenantId, req.params.id)
      const activeFilter = active === 'all' ? tx`` : tx`AND is_active = true`
      return tx`
        SELECT * FROM checklist_template_items
         WHERE template_id = ${req.params.id}
           AND tenant_id   = ${req.tenantId}
           ${activeFilter}
         ORDER BY sort_order, created_at
      `
    })
  })

  app.post('/templates/:id/items', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const body = ItemBody.parse(req.body)
    return withTenant(req.tenantId, async tx => {
      await loadTemplate(tx, req.tenantId, req.params.id)
      const [row] = await tx`
        INSERT INTO checklist_template_items
          (tenant_id, template_id, label, description, sort_order)
        VALUES
          (${req.tenantId}, ${req.params.id}, ${body.label}, ${body.description ?? null}, ${body.sort_order ?? 0})
        RETURNING *
      `
      return row
    })
  })

  app.patch('/templates/:id/items/:itemId', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const body = ItemPatch.parse(req.body)
    const fields = Object.keys(body).filter(k => body[k] !== undefined)
    if (!fields.length) throw httpError(400, 'No fields to update')

    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE checklist_template_items
         SET ${tx(Object.fromEntries(fields.map(k => [k, body[k]])), ...fields)},
             updated_at = now()
       WHERE id = ${req.params.itemId}
         AND template_id = ${req.params.id}
         AND tenant_id   = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Checklist item not found')
    return row
  })

  app.delete('/templates/:id/items/:itemId', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE checklist_template_items
         SET is_active = false, updated_at = now()
       WHERE id = ${req.params.itemId}
         AND template_id = ${req.params.id}
         AND tenant_id   = ${req.tenantId}
       RETURNING *
    `)
    if (!row) throw httpError(404, 'Checklist item not found')
    return row
  })

  app.put('/templates/:id/items/reorder', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)

    await withTenant(req.tenantId, async tx => {
      await loadTemplate(tx, req.tenantId, req.params.id)
      for (let i = 0; i < ids.length; i++) {
        await tx`
          UPDATE checklist_template_items
             SET sort_order = ${i}
           WHERE id = ${ids[i]}
             AND template_id = ${req.params.id}
             AND tenant_id   = ${req.tenantId}
        `
      }
    })
    return { ok: true }
  })

  // ── Today / due dashboard ─────────────────────────────────
  // Every active template for the venue, each with the instance (if any)
  // covering the period that `date` falls in — the operator-facing
  // equivalent of a daily/weekly/monthly to-do rollup.

  app.get('/due', {
    preHandler: requirePermission('checklists', 'view'),
  }, async (req) => {
    const { venue_id, date } = req.query
    if (!venue_id) throw httpError(400, 'venue_id required')
    if (!date || !DATE_RE.test(date)) throw httpError(400, 'date (YYYY-MM-DD) required')

    return withTenant(req.tenantId, async tx => {
      const templates = await tx`
        SELECT t.*,
               (SELECT count(*)::int FROM checklist_template_items i
                 WHERE i.template_id = t.id AND i.is_active = true) AS item_count
          FROM checklist_templates t
         WHERE t.tenant_id  = ${req.tenantId}
           AND t.venue_id   = ${venue_id}
           AND t.is_active  = true
         ORDER BY t.sort_order, t.name
      `

      return Promise.all(templates.map(async t => {
        const periodStart = periodStartFor(t.frequency, date)
        const [instance] = await tx`
          SELECT id, status, completed_by, completed_at,
                 (SELECT count(*)::int FROM checklist_instance_items ii
                   WHERE ii.instance_id = checklist_instances.id AND ii.is_checked = true) AS checked_count
            FROM checklist_instances
           WHERE template_id  = ${t.id}
             AND period_start = ${periodStart}
             AND tenant_id    = ${req.tenantId}
        `
        return {
          template: t,
          period_start: periodStart,
          instance: instance ?? null,
        }
      }))
    })
  })

  // ── Instance detail + save ────────────────────────────────

  app.get('/instance', {
    preHandler: requirePermission('checklists', 'view'),
  }, async (req) => {
    const { template_id, date } = req.query
    if (!template_id) throw httpError(400, 'template_id required')
    if (!date || !DATE_RE.test(date)) throw httpError(400, 'date (YYYY-MM-DD) required')

    return withTenant(req.tenantId, async tx => {
      const template = await loadTemplate(tx, req.tenantId, template_id)
      const periodStart = periodStartFor(template.frequency, date)

      const items = await tx`
        SELECT * FROM checklist_template_items
         WHERE template_id = ${template_id}
           AND tenant_id   = ${req.tenantId}
           AND is_active   = true
         ORDER BY sort_order, created_at
      `

      const [instance] = await tx`
        SELECT * FROM checklist_instances
         WHERE template_id  = ${template_id}
           AND period_start = ${periodStart}
           AND tenant_id    = ${req.tenantId}
      `

      const itemValues = {}
      if (instance) {
        const rows = await tx`
          SELECT template_item_id, is_checked, notes
            FROM checklist_instance_items
           WHERE instance_id = ${instance.id}
             AND tenant_id   = ${req.tenantId}
        `
        for (const r of rows) itemValues[r.template_item_id] = { checked: r.is_checked, notes: r.notes }
      }

      return { template, period_start: periodStart, items, instance: instance ?? null, item_values: itemValues }
    })
  })

  app.put('/instance', {
    preHandler: requirePermission('checklists', 'manage'),
  }, async (req) => {
    const body = InstancePutBody.parse(req.body)

    return withTenant(req.tenantId, async tx => {
      const template = await loadTemplate(tx, req.tenantId, body.template_id)
      const periodStart = periodStartFor(template.frequency, body.date)

      const completedBy    = req.user?.email ?? null
      const shouldComplete = body.mark_complete === true
      const shouldReopen   = body.mark_complete === false

      const [instance] = await tx`
        INSERT INTO checklist_instances
          (tenant_id, venue_id, template_id, period_start, notes,
           status, completed_by, completed_at)
        VALUES
          (${req.tenantId}, ${template.venue_id}, ${template.id}, ${periodStart}, ${body.notes ?? null},
           ${shouldComplete ? 'completed' : 'in_progress'},
           ${shouldComplete ? completedBy : null},
           ${shouldComplete ? new Date() : null})
        ON CONFLICT (template_id, period_start) DO UPDATE
          SET notes        = EXCLUDED.notes,
              status       = CASE
                                WHEN ${shouldComplete} THEN 'completed'
                                WHEN ${shouldReopen}   THEN 'in_progress'
                                ELSE checklist_instances.status
                              END,
              completed_by = CASE
                                WHEN ${shouldComplete} THEN ${completedBy}
                                WHEN ${shouldReopen}   THEN NULL
                                ELSE checklist_instances.completed_by
                              END,
              completed_at = CASE
                                WHEN ${shouldComplete} THEN now()
                                WHEN ${shouldReopen}   THEN NULL
                                ELSE checklist_instances.completed_at
                              END,
              updated_at   = now()
        RETURNING *
      `

      await tx`
        DELETE FROM checklist_instance_items
         WHERE instance_id = ${instance.id}
           AND tenant_id   = ${req.tenantId}
      `

      if (body.items.length > 0) {
        await tx`
          INSERT INTO checklist_instance_items ${tx(body.items.map(it => ({
            tenant_id:        req.tenantId,
            instance_id:      instance.id,
            template_item_id: it.template_item_id,
            is_checked:       it.checked,
            notes:            it.notes ?? null,
          })))}
        `
      }

      return instance
    })
  })
}
